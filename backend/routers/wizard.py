"""Meeting Wizard REST API (spec §4): ``/api/wizard/*``.

Meetings, briefs, live-session start/end, debriefs and send flows, battlecards, calendar
sources (ICS + env-gated Google/Microsoft OAuth), integrations (webhook/BCC + env-gated Zoho
CRM with an approve-before-write diff), pre-flight and the retention sweep. Every route needs
auth; rows that belong to another user answer 404. Dates are ISO-8601 UTC with ``Z``.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import jwt
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

import models_wizard  # noqa: F401  (registers the wizard tables + call_logs columns before create_all)
from database import SessionLocal, get_db, utc_isoformat
from models import CallLog, Capsule, Lead, User
from models_wizard import (WizardBattlecard, WizardCalendarEvent, WizardCalendarSource, WizardDebrief, WizardIntegration,
                           WizardMeeting)
from routers.auth import ALGORITHM, SECRET_KEY, create_access_token, get_current_user
from services import call_context_engine as cce
from services.bridge.config import load_config as bridge_config
from services.credit_service import is_user_superuser
from services.usage_limits import WindowRateLimiter, user_key
from services.wizard import battlecards as cards_svc
from services.wizard import brief as brief_svc
from services.wizard import calendar as calendar_svc
from services.wizard import contracts, hooks, llm
from services.wizard import debrief as debrief_svc
from services.wizard import integrations as integ
from services.wizard import retention as retention_svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/wizard", tags=["wizard"])

# The live pipeline calls hooks.session_saved(meeting_id, call_log_id, user_id) after a CallLog is written.
hooks.register_session_saved(debrief_svc.on_session_saved)

_brief_limiter = WindowRateLimiter("wizard-brief", 20, 60, "Too many brief requests. Please wait a minute.")
_debrief_limiter = WindowRateLimiter("wizard-debrief", 20, 60, "Too many debrief requests. Please wait a minute.")
_rehearse_limiter = WindowRateLimiter("wizard-rehearse", 60, 60, "Rehearsal is rate limited. Please wait a minute.")
_sync_limiter = WindowRateLimiter("wizard-calendar-sync", 12, 60, "Calendar sync is rate limited. Please wait a minute.")

STATUSES = ("planned", "ready", "live", "ended", "debriefed", "cancelled", "no_show")
METHODOLOGIES = tuple(contracts.METHODOLOGIES.keys())
PLATFORMS = ("meet", "zoom", "teams", "phone", "in_person", "whatsapp", "other")
CHANNELS = ("tab_audio", "phone_bridge", "mic", "bot")
INTENSITIES = tuple(contracts.INTENSITY_LADDER)
CONSENT_MODES = ("announced", "in_invite", "bridge_disclosure", "skipped")
_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$")


# ── helpers ──────────────────────────────────────────────────────────────────

def _parse_dt(value: Optional[str], field: str) -> Optional[datetime]:
    if value is None or value == "":
        return None
    raw = value.strip()
    try:
        if raw.endswith(("Z", "z")):
            raw = raw[:-1] + "+00:00"
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{field} must be an ISO-8601 date-time (e.g. 2026-11-14T10:30:00Z).")
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _enum(value: Optional[str], allowed: tuple, field: str, default: Optional[str] = None) -> Optional[str]:
    if value is None or value == "":
        return default
    normalized = str(value).strip().lower()
    if normalized not in allowed:
        raise HTTPException(status_code=422, detail=f"{field} must be one of: {', '.join(allowed)}.")
    return normalized


def _clean(value: Optional[str], limit: int) -> Optional[str]:
    if value is None:
        return None
    text = "".join(ch for ch in str(value) if ch in ("\n", "\t") or ch.isprintable()).strip()
    return text[:limit] or None


def _meeting_or_404(db: Session, meeting_id: str, user: User) -> WizardMeeting:
    meeting = db.get(WizardMeeting, meeting_id)
    if meeting is None or meeting.user_id != user.id:
        raise HTTPException(status_code=404, detail="Meeting not found.")
    return meeting


def _debrief_summary(debrief: Optional[WizardDebrief]) -> Optional[dict]:
    if debrief is None:
        return None
    return {"status": debrief.status, "summary": debrief.summary, "outcome": debrief.outcome,
            "deal_health_score": (debrief.deal_health or {}).get("score") if isinstance(debrief.deal_health, dict) else None,
            "next_step": debrief.next_step, "generated_at": utc_isoformat(debrief.generated_at)}


def meeting_json(meeting: WizardMeeting, debrief: Optional[WizardDebrief] = None, *, include_brief: bool = True) -> dict:
    return {
        "id": meeting.id, "user_id": meeting.user_id, "title": meeting.title, "status": meeting.status,
        "prospect_name": meeting.prospect_name, "company": meeting.company, "industry": meeting.industry, "role": meeting.role,
        "prospect_phone_e164": meeting.prospect_phone_e164, "prospect_email": meeting.prospect_email, "lead_id": meeting.lead_id,
        "deal_value_inr": meeting.deal_value_inr, "deal_value_text": meeting.deal_value_text, "objective": meeting.objective,
        "methodology": meeting.methodology, "capsule_id": meeting.capsule_id, "product_name": meeting.product_name,
        "product_price": meeting.product_price, "product_specification": meeting.product_specification,
        "platform": meeting.platform, "channel": meeting.channel,
        "scheduled_start": utc_isoformat(meeting.scheduled_start), "scheduled_end": utc_isoformat(meeting.scheduled_end),
        "meeting_link": meeting.meeting_link, "calendar_event_id": meeting.calendar_event_id, "calendar_source": meeting.calendar_source,
        "brief": meeting.brief if include_brief else None, "has_brief": bool(meeting.brief),
        "brief_generated_at": utc_isoformat(meeting.brief_generated_at), "battlecard_ids": list(meeting.battlecard_ids or []),
        "coaching_intensity": meeting.coaching_intensity, "consent": meeting.consent, "context_id": meeting.context_id,
        "call_log_id": meeting.call_log_id, "bridge_call_id": meeting.bridge_call_id,
        "started_at": utc_isoformat(meeting.started_at), "ended_at": utc_isoformat(meeting.ended_at),
        "created_at": utc_isoformat(meeting.created_at), "updated_at": utc_isoformat(meeting.updated_at),
        "debrief": _debrief_summary(debrief),
        # flat copies for list/home cards
        "debrief_summary": debrief.summary if debrief else None,
        "outcome": debrief.outcome if debrief else None,
        "deal_health_score": (debrief.deal_health or {}).get("score") if debrief and isinstance(debrief.deal_health, dict) else None,
    }


def event_json(event: WizardCalendarEvent, meeting: Optional[WizardMeeting] = None) -> dict:
    return {"id": event.id, "source_id": event.source_id, "external_id": event.external_id, "title": event.title,
            "start": utc_isoformat(event.start), "end": utc_isoformat(event.end), "attendees": event.attendees or [],
            "meeting_link": event.meeting_link, "platform": event.platform, "location": event.location,
            "meeting_id": event.meeting_id, "meeting": meeting_json(meeting, include_brief=False) if meeting else None,
            "updated_at": utc_isoformat(event.updated_at)}


def source_json(source: WizardCalendarSource) -> dict:
    return {"id": source.id, "kind": source.kind, "label": source.label, "ics_url_masked": calendar_svc.mask_ics_url(source.ics_url),
            "connected": bool(source.oauth) if source.kind != "ics" else bool(source.ics_url),
            "last_synced_at": utc_isoformat(source.last_synced_at), "status": source.status, "error": source.error,
            "created_at": utc_isoformat(source.created_at)}


def _apply_deal_value(meeting: WizardMeeting, text: Optional[str]) -> None:
    cleaned = _clean(text, 64)
    meeting.deal_value_text = cleaned
    meeting.deal_value_inr = contracts.parse_inr(cleaned) if cleaned else None


def _snapshot_capsule(db: Session, meeting: WizardMeeting, capsule_id: Optional[int], user: User) -> None:
    if capsule_id is None:
        meeting.capsule_id = None
        return
    capsule = db.get(Capsule, capsule_id)
    if capsule is None or capsule.user_id != user.id:
        raise HTTPException(status_code=404, detail="Capsule not found.")
    meeting.capsule_id = capsule.id
    meeting.product_name = capsule.product_name
    meeting.product_price = capsule.product_price
    meeting.product_specification = capsule.product_specification


def _prefill_from_lead(db: Session, meeting: WizardMeeting, lead_id: Optional[int], user: User, country: str) -> None:
    if lead_id is None:
        return
    lead = db.get(Lead, lead_id)
    if lead is None or lead.user_id not in (None, user.id):
        raise HTTPException(status_code=404, detail="Lead not found.")
    meeting.lead_id = lead.id
    meeting.company = meeting.company or lead.business_name
    meeting.prospect_name = meeting.prospect_name or lead.business_name
    meeting.industry = meeting.industry or lead.category
    meeting.prospect_phone_e164 = meeting.prospect_phone_e164 or integ.normalize_phone(lead.phone_number, country)


def _prefill_from_event(db: Session, meeting: WizardMeeting, event_id: str, user: User) -> WizardCalendarEvent:
    event = db.get(WizardCalendarEvent, event_id)
    if event is None or event.user_id != user.id:
        raise HTTPException(status_code=404, detail="Calendar event not found.")
    source = db.get(WizardCalendarSource, event.source_id)
    meeting.title = meeting.title or event.title
    meeting.scheduled_start = meeting.scheduled_start or event.start
    meeting.scheduled_end = meeting.scheduled_end or event.end
    meeting.meeting_link = meeting.meeting_link or event.meeting_link
    meeting.calendar_event_id = event.external_id
    meeting.calendar_source = source.kind if source else "ics"
    if event.platform in PLATFORMS:
        meeting.platform = event.platform
    if event.platform == "in_person":
        meeting.channel = "mic"
    external = [a for a in (event.attendees or []) if isinstance(a, dict) and a.get("email")
                and (a["email"].split("@")[-1].lower() != (user.email or "x@x").split("@")[-1].lower())]
    guess = external[0] if external else next((a for a in (event.attendees or []) if isinstance(a, dict)), None)
    if guess and not meeting.prospect_name:
        meeting.prospect_name = guess.get("name") or (guess.get("email") or "").split("@")[0]
        meeting.prospect_email = meeting.prospect_email or guess.get("email")
        domain = (guess.get("email") or "").split("@")[-1]
        if domain and not meeting.company and domain.split(".")[0] not in ("gmail", "yahoo", "outlook", "hotmail", "rediffmail", "icloud"):
            meeting.company = domain.split(".")[0].capitalize()
    return event


def _consent_dict(raw: Optional[dict], meeting: WizardMeeting, integration: Optional[WizardIntegration]) -> Optional[dict]:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise HTTPException(status_code=422, detail="consent must be an object like {\"mode\": \"announced\"}.")
    mode = _enum(raw.get("mode"), CONSENT_MODES, "consent.mode") if raw.get("mode") else None
    scripts = integ.consent_scripts(integration)
    return {"mode": mode, "announced_at": raw.get("announced_at") or (contracts.utc_now_iso() if mode == "announced" else None),
            "script": raw.get("script") or scripts["en"], "participants_notified": bool(raw.get("participants_notified", mode in ("announced", "in_invite", "bridge_disclosure")))}


# ── WizardContext for the live session (shared with main.py's /call/start) ─

def build_wizard_context(db: Session, user_id: int, *, meeting: Optional[WizardMeeting] = None, platform: Optional[str] = None,
                         deal_value: Optional[str] = None, methodology: Optional[str] = None, coaching_intensity: Optional[str] = None,
                         battlecard_ids: Optional[list[str]] = None, capsule_id: Optional[int] = None, consent: Optional[dict] = None,
                         prospect_phone: Optional[str] = None, channel: Optional[str] = None, active_battlecard: Optional[str] = None,
                         prospect_name: Optional[str] = None, company: Optional[str] = None, industry: Optional[str] = None) -> dict:
    """The ``payload["wizard"]`` sub-dict (``contracts.WizardContext``) for a call context."""
    integration = db.get(WizardIntegration, user_id)
    ids = list(dict.fromkeys([*(battlecard_ids or []), *((meeting.battlecard_ids or []) if meeting else [])]))
    if active_battlecard:
        match = db.query(WizardBattlecard).filter(or_(WizardBattlecard.id == active_battlecard, WizardBattlecard.title == active_battlecard),
                                                 or_(WizardBattlecard.user_id == user_id, WizardBattlecard.user_id.is_(None))).first()
        if match and match.id not in ids:
            ids.insert(0, match.id)
    cards = cards_svc.cards_by_ids(db, user_id, ids)
    if not cards and meeting is not None:
        cards = [c for c, _s, _w in cards_svc.suggest_for_meeting(db, meeting, limit=6)]
        ids = [c.id for c in cards]
    capsule = None
    capsule_pk = capsule_id if capsule_id is not None else (meeting.capsule_id if meeting else None)
    if capsule_pk is not None:
        capsule = db.get(Capsule, capsule_pk)
        if capsule is not None and capsule.user_id != user_id:
            capsule = None
    facts = brief_svc.capsule_facts(capsule)
    brief = meeting.brief if meeting else None
    value_text = deal_value if deal_value is not None else (meeting.deal_value_text if meeting else None)
    name = prospect_name or (meeting.prospect_name if meeting else None)
    comp = company or (meeting.company if meeting else None)
    lang = (brief or {}).get("prospect_language_hint") if brief else None
    if not lang:
        probe = meeting or WizardMeeting(prospect_name=name, company=comp, industry=industry, prospect_phone_e164=integ.normalize_phone(prospect_phone))
        lang = brief_svc.language_hint(probe)
    pre_rendered = list((brief or {}).get("pre_rendered_cards") or [])
    if not pre_rendered and cards:
        pre_rendered = [cards_svc.pre_rendered(c, say_lang=lang) for c in cards[:5]]
    keyterms = []
    for term in [name, comp, capsule.product_name if capsule else (meeting.product_name if meeting else None)] + \
                [c.title for c in cards if c.kind == "competitive"] + [kw for c in cards for kw in (c.trigger_keywords or [])[:2]]:
        if term and term not in keyterms and len(term) <= 40:
            keyterms.append(term)
    intensity = _enum(coaching_intensity, INTENSITIES, "coaching_intensity", None) or (meeting.coaching_intensity if meeting else None) or "guided"
    scripts = integ.consent_scripts(integration)
    return {
        "meeting_id": meeting.id if meeting else None,
        "platform": platform or (meeting.platform if meeting else None),
        "channel": channel or (meeting.channel if meeting else None),
        "deal_value": value_text,
        "deal_value_inr": contracts.parse_inr(value_text) if value_text else (meeting.deal_value_inr if meeting else None),
        "methodology": methodology or (meeting.methodology if meeting else None) or "meddpicc",
        "coaching_intensity": intensity,
        "intensity": intensity,
        "battlecard_ids": ids,
        "battlecards": [cards_svc.compact(c) for c in cards],
        "pre_rendered_cards": pre_rendered,
        "capsule_id": capsule.id if capsule else None,
        "capsule_facts": facts,
        "brief": brief,
        "consent": consent,
        "keyterms": keyterms[:50],
        "prospect_language_hint": lang,
        "bridge_disclosure": bool(integration.bridge_disclosure) if integration is not None and integration.bridge_disclosure is not None else True,
        "notetaker_name": scripts["notetaker_name"],
        "prospect_name": name,
        "company": comp,
    }


def attach_wizard_context(context_id: str, wizard: dict) -> bool:
    """Store ``wizard`` under ``payload["wizard"]`` of an existing call context (DB + cache)."""
    engine_obj = cce.call_context_engine
    with engine_obj._lock:  # noqa: SLF001 - same lock the engine uses for its own writes
        context = engine_obj.get_context(context_id)
        if not context:
            return False
        context["wizard"] = wizard
        with cce.engine.begin() as conn:
            conn.execute(cce.briefs.update().where(cce.briefs.c.context_id == context_id).values(payload=context))
        engine_obj.sessions[context_id] = context
    return True


def wizard_context_for_call_start(user_id: int, body: Any) -> Optional[dict]:
    """Called by ``main.start_call``: builds the sub-dict from the additive ``CallStartRequest`` fields (None when unused)."""
    extras = {k: getattr(body, k, None) for k in ("platform", "deal_value", "active_battlecard", "meeting_id", "methodology",
                                                  "coaching_intensity", "battlecard_ids", "capsule_id", "consent", "prospect_phone")}
    if not any(v not in (None, "", []) for v in extras.values()):
        return None
    with SessionLocal() as db:
        meeting = None
        if extras["meeting_id"]:
            meeting = db.get(WizardMeeting, extras["meeting_id"])
            if meeting is None or meeting.user_id != user_id:
                meeting = None
        try:
            return build_wizard_context(
                db, user_id, meeting=meeting, platform=extras["platform"], deal_value=extras["deal_value"], methodology=extras["methodology"],
                coaching_intensity=extras["coaching_intensity"], battlecard_ids=extras["battlecard_ids"], capsule_id=extras["capsule_id"],
                consent=extras["consent"] if isinstance(extras["consent"], dict) else None, prospect_phone=extras["prospect_phone"],
                active_battlecard=extras["active_battlecard"], prospect_name=getattr(body, "client_name", None),
                company=None, industry=getattr(body, "client_industry", None))
        except HTTPException:
            return None


# ── startup ──────────────────────────────────────────────────────────────────

def startup_tasks() -> dict:
    """Seed battlecards when missing and run the retention sweep (called from main's lifespan)."""
    result = {"seeded": 0, "retention": None}
    with SessionLocal() as db:
        try:
            result["seeded"] = cards_svc.seed_if_empty(db)
        except Exception as exc:  # noqa: BLE001
            logger.warning("wizard seed failed: %s", type(exc).__name__)
        if retention_svc.sweep_enabled_at_startup():
            try:
                result["retention"] = retention_svc.run_retention_sweep(db)
            except Exception as exc:  # noqa: BLE001
                logger.warning("wizard retention sweep failed: %s", type(exc).__name__)
    return result


# ── schemas ──────────────────────────────────────────────────────────────────

class MeetingBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: Optional[str] = Field(None, max_length=200)
    prospect_name: Optional[str] = Field(None, max_length=200)
    company: Optional[str] = Field(None, max_length=200)
    industry: Optional[str] = Field(None, max_length=200)
    role: Optional[str] = Field(None, max_length=200)
    prospect_phone: Optional[str] = Field(None, max_length=32)
    prospect_phone_e164: Optional[str] = Field(None, max_length=32)      # alias of prospect_phone
    prospect_email: Optional[str] = Field(None, max_length=254)
    lead_id: Optional[int] = None
    deal_value: Optional[str] = Field(None, max_length=64)
    deal_value_text: Optional[str] = Field(None, max_length=64)          # alias of deal_value
    objective: Optional[str] = Field(None, max_length=2000)
    methodology: Optional[str] = None
    capsule_id: Optional[int] = None
    product_name: Optional[str] = Field(None, max_length=500)            # product snapshot overrides
    product_price: Optional[str] = Field(None, max_length=1000)
    product_specification: Optional[str] = Field(None, max_length=8000)
    platform: Optional[str] = None
    channel: Optional[str] = None
    scheduled_start: Optional[str] = None
    scheduled_end: Optional[str] = None
    meeting_link: Optional[str] = Field(None, max_length=1000)
    calendar_event_id: Optional[str] = None
    battlecard_ids: Optional[list[str]] = None
    coaching_intensity: Optional[str] = None
    consent: Optional[dict] = None
    status: Optional[str] = None


class StartBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    channel: Optional[str] = None
    consent: Optional[dict] = None
    prospect_phone: Optional[str] = Field(None, max_length=32)
    coaching_intensity: Optional[str] = None


class EndBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    call_log_id: Optional[int] = None
    outcome: Optional[str] = None


class SendBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    channel: str
    to: Optional[str] = Field(None, max_length=254)


class RehearseMessage(BaseModel):
    role: str
    text: str = Field(max_length=2000)


class RehearseBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    messages: list[RehearseMessage] = Field(default_factory=list, max_length=16)


class BattlecardBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    kind: Optional[str] = None
    category: Optional[str] = Field(None, max_length=80)
    title: Optional[str] = Field(None, max_length=120)
    tag: Optional[str] = Field(None, max_length=40)
    accent: Optional[str] = Field(None, max_length=16)
    trigger_keywords: Optional[list[str]] = None
    trigger_description: Optional[str] = Field(None, max_length=500)
    fact: Optional[str] = Field(None, max_length=2000)
    impact: Optional[str] = Field(None, max_length=2000)
    act: Optional[str] = Field(None, max_length=2000)
    act_hinglish: Optional[str] = Field(None, max_length=2000)
    question_to_ask: Optional[str] = Field(None, max_length=500)
    proof_point: Optional[str] = Field(None, max_length=1000)
    do_not: Optional[str] = Field(None, max_length=1000)
    psychology: Optional[str] = Field(None, max_length=1000)
    methodology_field: Optional[str] = Field(None, max_length=40)
    tags: Optional[list[str]] = None
    is_active: Optional[bool] = None
    copy_of: Optional[str] = None


class SuggestBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    meeting_id: str
    limit: int = Field(8, ge=1, le=20)


class CalendarSourceBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    kind: str
    url: Optional[str] = Field(None, max_length=2048)
    label: Optional[str] = Field(None, max_length=120)


class IntegrationsBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    crm_webhook_url: Optional[str] = Field(None, max_length=1000)
    crm_webhook_secret: Optional[str] = Field(None, max_length=200)
    crm_bcc_email: Optional[str] = Field(None, max_length=254)
    default_country: Optional[str] = Field(None, max_length=8)
    notetaker_name: Optional[str] = Field(None, max_length=80)
    consent_script: Optional[str] = Field(None, max_length=1000)
    bridge_disclosure: Optional[bool] = None
    retention_days_audio: Optional[int] = Field(None, ge=0, le=3650)
    retention_days_transcript: Optional[int] = Field(None, ge=0, le=3650)


class CrmPushBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    approved: list[Any] = Field(default_factory=list)   # change ids ("deal.Amount") or row objects


# ── home ─────────────────────────────────────────────────────────────────────

@router.get("/home")
def home(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    now = datetime.utcnow()
    events = (db.query(WizardCalendarEvent)
              .filter(WizardCalendarEvent.user_id == user.id, WizardCalendarEvent.start >= now - timedelta(hours=1),
                      WizardCalendarEvent.start <= now + timedelta(hours=24))
              .order_by(WizardCalendarEvent.start).limit(20).all())
    today = []
    for event in events:
        linked = db.get(WizardMeeting, event.meeting_id) if event.meeting_id else None
        today.append({**event_json(event, linked), "starting_now": bool(event.start and abs((event.start - now).total_seconds()) <= 600)})
    live = (db.query(WizardMeeting).filter(WizardMeeting.user_id == user.id, WizardMeeting.status == "live")
            .order_by(WizardMeeting.started_at.desc()).first())
    upcoming = (db.query(WizardMeeting)
                .filter(WizardMeeting.user_id == user.id, WizardMeeting.status.in_(["planned", "ready"]),
                        or_(WizardMeeting.scheduled_start.is_(None), WizardMeeting.scheduled_start >= now - timedelta(hours=1)))
                .order_by(WizardMeeting.scheduled_start.asc().nullslast(), WizardMeeting.created_at.desc()).limit(10).all())
    recent_rows = (db.query(WizardMeeting).filter(WizardMeeting.user_id == user.id, WizardMeeting.status.in_(["ended", "debriefed", "no_show"]))
                   .order_by(WizardMeeting.ended_at.desc().nullslast(), WizardMeeting.updated_at.desc()).limit(8).all())
    recent = []
    for row in recent_rows:
        debrief = db.query(WizardDebrief).filter(WizardDebrief.meeting_id == row.id).first()
        recent.append(meeting_json(row, debrief, include_brief=False))
    since = now - timedelta(days=30)
    finished = db.query(WizardMeeting).filter(WizardMeeting.user_id == user.id, WizardMeeting.status.in_(["ended", "debriefed"]),
                                              WizardMeeting.ended_at >= since).all()
    debriefs = db.query(WizardDebrief).filter(WizardDebrief.user_id == user.id, WizardDebrief.status == "ready",
                                              WizardDebrief.generated_at >= since).all()
    ratios = [d.metrics.get("talk_ratio_rep") for d in debriefs if isinstance(d.metrics, dict) and isinstance(d.metrics.get("talk_ratio_rep"), (int, float))]
    stats = {"meetings_30d": len(finished),
             "next_step_rate": round(sum(1 for d in debriefs if d.outcome == "next_step_set") / len(debriefs), 2) if debriefs else None,
             "avg_talk_ratio": round(sum(ratios) / len(ratios), 2) if ratios else None,
             "debriefs_30d": len(debriefs)}
    return {"today": today, "live": meeting_json(live, include_brief=False) if live else None,
            "upcoming": [meeting_json(m, include_brief=False) for m in upcoming], "recent": recent, "stats": stats,
            "server_time": utc_isoformat(now)}


# ── meetings ─────────────────────────────────────────────────────────────────

@router.get("/meetings")
def list_meetings(status: Optional[str] = None, limit: int = Query(50, ge=1, le=200), db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    query = db.query(WizardMeeting).filter(WizardMeeting.user_id == user.id)
    if status:
        wanted = [s for s in status.split(",") if s in STATUSES]
        if not wanted:
            raise HTTPException(status_code=422, detail=f"status must be one of: {', '.join(STATUSES)}.")
        query = query.filter(WizardMeeting.status.in_(wanted))
    rows = query.order_by(WizardMeeting.scheduled_start.desc().nullslast(), WizardMeeting.created_at.desc()).limit(limit).all()
    out = []
    for row in rows:
        debrief = db.query(WizardDebrief).filter(WizardDebrief.meeting_id == row.id).first() if row.status in ("ended", "debriefed") else None
        out.append(meeting_json(row, debrief, include_brief=False))
    return out


def _apply_meeting_body(db: Session, meeting: WizardMeeting, body: MeetingBody, user: User, *, creating: bool) -> None:
    integration = db.get(WizardIntegration, user.id)
    country = (integration.default_country if integration else None) or integ.DEFAULT_COUNTRY
    fields = body.model_fields_set
    if "title" in fields:
        meeting.title = _clean(body.title, 200)
    if "prospect_name" in fields:
        meeting.prospect_name = _clean(body.prospect_name, 200)
    if "company" in fields:
        meeting.company = _clean(body.company, 200)
    if "industry" in fields:
        meeting.industry = _clean(body.industry, 200)
    if "role" in fields:
        meeting.role = _clean(body.role, 200)
    if "prospect_phone" in fields or "prospect_phone_e164" in fields:
        raw_phone = body.prospect_phone if "prospect_phone" in fields else body.prospect_phone_e164
        if raw_phone:
            phone = integ.normalize_phone(raw_phone, country)
            if not phone:
                raise HTTPException(status_code=422, detail="prospect_phone must be a valid phone number (e.g. +91 98765 43210).")
            meeting.prospect_phone_e164 = phone
        else:
            meeting.prospect_phone_e164 = None
    if "prospect_email" in fields:
        email = _clean(body.prospect_email, 254)
        if email and not _EMAIL_RE.match(email):
            raise HTTPException(status_code=422, detail="prospect_email must be a valid email address.")
        meeting.prospect_email = email.lower() if email else None
    if "objective" in fields:
        meeting.objective = _clean(body.objective, 2000)
    if "deal_value" in fields or "deal_value_text" in fields:
        _apply_deal_value(meeting, body.deal_value if "deal_value" in fields else body.deal_value_text)
    if "methodology" in fields:
        meeting.methodology = _enum(body.methodology, METHODOLOGIES, "methodology", meeting.methodology or "meddpicc")
    if "platform" in fields:
        meeting.platform = _enum(body.platform, PLATFORMS, "platform", meeting.platform or "meet")
    if "channel" in fields:
        meeting.channel = _enum(body.channel, CHANNELS, "channel", meeting.channel or "tab_audio")
    if "coaching_intensity" in fields:
        meeting.coaching_intensity = _enum(body.coaching_intensity, INTENSITIES, "coaching_intensity", meeting.coaching_intensity or "guided")
    if "scheduled_start" in fields:
        meeting.scheduled_start = _parse_dt(body.scheduled_start, "scheduled_start")
    if "scheduled_end" in fields:
        meeting.scheduled_end = _parse_dt(body.scheduled_end, "scheduled_end")
    if "meeting_link" in fields:
        meeting.meeting_link = _clean(body.meeting_link, 1000)
        if meeting.meeting_link and "platform" not in fields:
            _link, platform = calendar_svc.detect_link(meeting.meeting_link)
            if platform in PLATFORMS:
                meeting.platform = platform
    if "battlecard_ids" in fields:
        ids = [i for i in (body.battlecard_ids or []) if isinstance(i, str)][:40]
        found = {c.id for c in cards_svc.cards_by_ids(db, user.id, ids)}
        missing = [i for i in ids if i not in found]
        if missing:
            raise HTTPException(status_code=404, detail=f"Battlecard not found: {missing[0]}")
        meeting.battlecard_ids = ids
    if "consent" in fields:
        meeting.consent = _consent_dict(body.consent, meeting, integration)
    if "capsule_id" in fields:
        _snapshot_capsule(db, meeting, body.capsule_id, user)
    for key, limit in (("product_name", 500), ("product_price", 1000), ("product_specification", 8000)):
        if key in fields and getattr(body, key) is not None:
            setattr(meeting, key, _clean(getattr(body, key), limit))
    if "lead_id" in fields:
        _prefill_from_lead(db, meeting, body.lead_id, user, country)
    if "status" in fields and body.status is not None and not creating:
        new_status = _enum(body.status, STATUSES, "status")
        if new_status in ("live",):
            raise HTTPException(status_code=422, detail="Use POST /meetings/{id}/start to go live.")
        if new_status in ("ended", "debriefed"):
            raise HTTPException(status_code=422, detail="Use POST /meetings/{id}/end to end a meeting.")
        meeting.status = new_status
        if new_status == "no_show" and not meeting.ended_at:
            meeting.ended_at = datetime.utcnow()
    if "channel" not in fields and meeting.platform in ("phone",) and meeting.channel == "tab_audio":
        meeting.channel = "phone_bridge"
    if "channel" not in fields and meeting.platform == "in_person" and meeting.channel == "tab_audio":
        meeting.channel = "mic"
    if not meeting.title:
        who = meeting.prospect_name or meeting.company
        meeting.title = f"Meeting with {who}" if who else "New meeting"


@router.post("/meetings", status_code=201)
def create_meeting(body: MeetingBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    meeting = WizardMeeting(user_id=user.id, status="planned", methodology="meddpicc", platform="meet", channel="tab_audio",
                            coaching_intensity="guided", battlecard_ids=[])
    event = None
    if body.calendar_event_id:
        event = _prefill_from_event(db, meeting, body.calendar_event_id, user)
    _apply_meeting_body(db, meeting, body, user, creating=True)
    if not (meeting.prospect_name or meeting.company or meeting.calendar_event_id):
        raise HTTPException(status_code=422, detail="Tell us who the meeting is with: prospect_name, company, lead_id or calendar_event_id.")
    if meeting.capsule_id is None:
        default = db.query(Capsule).filter(Capsule.user_id == user.id, Capsule.is_default.is_(True)).first()
        if default:
            _snapshot_capsule(db, meeting, default.id, user)
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    if event is not None:
        event.meeting_id = meeting.id
        db.commit()
    return meeting_json(meeting)


@router.get("/meetings/{meeting_id}")
def get_meeting(meeting_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    meeting = _meeting_or_404(db, meeting_id, user)
    debrief = db.query(WizardDebrief).filter(WizardDebrief.meeting_id == meeting.id).first()
    cards = cards_svc.cards_by_ids(db, user.id, meeting.battlecard_ids or [])
    return {**meeting_json(meeting, debrief), "battlecards": [cards_svc.serialize(c) for c in cards]}


@router.patch("/meetings/{meeting_id}")
def patch_meeting(meeting_id: str, body: MeetingBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    meeting = _meeting_or_404(db, meeting_id, user)
    if meeting.status in ("live",) and any(k in body.model_fields_set for k in ("methodology", "capsule_id", "channel")):
        raise HTTPException(status_code=409, detail="This meeting is live; end it before changing its setup.")
    _apply_meeting_body(db, meeting, body, user, creating=False)
    meeting.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(meeting)
    debrief = db.query(WizardDebrief).filter(WizardDebrief.meeting_id == meeting.id).first()
    return meeting_json(meeting, debrief)


@router.delete("/meetings/{meeting_id}")
def delete_meeting(meeting_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    meeting = _meeting_or_404(db, meeting_id, user)
    if meeting.status == "live":
        raise HTTPException(status_code=409, detail="End the live meeting before deleting it.")
    db.query(WizardCalendarEvent).filter(WizardCalendarEvent.meeting_id == meeting.id).update({"meeting_id": None})
    db.query(WizardDebrief).filter(WizardDebrief.meeting_id == meeting.id).delete()
    db.delete(meeting)
    db.commit()
    return {"message": "Meeting deleted", "id": meeting_id}


# ── brief ────────────────────────────────────────────────────────────────────

@router.post("/meetings/{meeting_id}/brief")
async def generate_brief(meeting_id: str, force: int = Query(0), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    meeting = _meeting_or_404(db, meeting_id, user)
    if force or not meeting.brief:
        _brief_limiter.hit(user_key(user))
    result = await brief_svc.generate_brief(db, meeting, force=bool(force))
    return {**result, "meeting": meeting_json(meeting, include_brief=False)}


# ── start / end ──────────────────────────────────────────────────────────────

@router.post("/meetings/{meeting_id}/start")
def start_meeting(meeting_id: str, body: StartBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    meeting = _meeting_or_404(db, meeting_id, user)
    if meeting.status in ("debriefed", "cancelled"):
        raise HTTPException(status_code=409, detail=f"This meeting is {meeting.status}; create a new meeting to start another session.")
    integration = integ.get_or_create_integration(db, user.id)
    if body.channel:
        meeting.channel = _enum(body.channel, CHANNELS, "channel")
    if body.coaching_intensity:
        meeting.coaching_intensity = _enum(body.coaching_intensity, INTENSITIES, "coaching_intensity")
    if body.prospect_phone:
        phone = integ.normalize_phone(body.prospect_phone, integration.default_country or integ.DEFAULT_COUNTRY)
        if not phone:
            raise HTTPException(status_code=422, detail="prospect_phone must be a valid phone number (e.g. +91 98765 43210).")
        meeting.prospect_phone_e164 = phone
    if meeting.channel == "phone_bridge" and not meeting.prospect_phone_e164:
        raise HTTPException(status_code=422, detail="A phone bridge call needs the prospect's phone number.")
    consent = _consent_dict(body.consent, meeting, integration) if body.consent is not None else meeting.consent
    if meeting.channel == "phone_bridge" and (not consent or not consent.get("mode")):
        consent = {**(consent or {}), "mode": "bridge_disclosure", "script": integ.consent_scripts(integration)["en"],
                   "participants_notified": bool(integration.bridge_disclosure)}
    meeting.consent = consent
    brief = meeting.brief or {}
    context_id = cce.call_context_engine.create_context(
        user_id=user.id, client_name=meeting.prospect_name or meeting.company or "Prospect", client_industry=meeting.industry or "",
        client_role=meeting.role or "", product_name=meeting.product_name or "", product_price=meeting.product_price or "",
        product_specification=meeting.product_specification or "", call_goal=meeting.objective or brief.get("objective") or "Discovery call")
    wizard = build_wizard_context(db, user.id, meeting=meeting, consent=consent, channel=meeting.channel)
    attach_wizard_context(context_id, wizard)
    meeting.context_id = context_id
    meeting.status = "live"
    meeting.started_at = datetime.utcnow()
    meeting.updated_at = meeting.started_at
    db.commit()
    db.refresh(meeting)
    scripts = integ.consent_scripts(integration)
    bridge = bridge_config().public_payload()
    return {"context_id": context_id, "meeting": meeting_json(meeting), "consent_script": scripts["en"], "consent_script_hi": scripts["hi"],
            "notetaker_name": scripts["notetaker_name"], "ws": {"audio": "/ws/audio", "text": "/ws"},
            "bridge": {"enabled": bridge["enabled"], "rate_per_minute": bridge["rate_per_minute"], "reason": bridge["reason"],
                       "create_url": "/api/copilot/bridge/calls"},
            "wizard": {k: wizard[k] for k in ("prospect_language_hint", "intensity", "battlecard_ids", "bridge_disclosure")}}


@router.post("/meetings/{meeting_id}/end")
def end_meeting(meeting_id: str, body: EndBody, background: BackgroundTasks, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    meeting = _meeting_or_404(db, meeting_id, user)
    call_log_id = body.call_log_id or meeting.call_log_id
    if call_log_id is None and meeting.context_id:
        call_log_id = cce.call_context_engine.get_call_log_id(meeting.context_id)
    if call_log_id is not None:
        log = db.get(CallLog, call_log_id)
        if log is None or log.user_id != user.id:
            raise HTTPException(status_code=404, detail="Call log not found.")
        meeting.call_log_id = log.id
        if hasattr(log, "meeting_id") and not getattr(log, "meeting_id", None):
            log.meeting_id = meeting.id
    already_ended = meeting.status in ("ended", "debriefed", "no_show")
    if not already_ended:
        meeting.status = "ended"
        meeting.ended_at = datetime.utcnow()
    if body.outcome == "no_show":
        meeting.status = "no_show"
    meeting.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(meeting)
    debrief = db.query(WizardDebrief).filter(WizardDebrief.meeting_id == meeting.id).first()
    scheduled = False
    if meeting.status == "ended" and meeting.call_log_id and (debrief is None or debrief.status == "failed" or not already_ended):
        background.add_task(debrief_svc.run_debrief_job, meeting.id, meeting.call_log_id, user.id)
        scheduled = True
    return {**meeting_json(meeting, debrief), "debrief_scheduled": scheduled}


# ── debrief ──────────────────────────────────────────────────────────────────

@router.get("/meetings/{meeting_id}/debrief")
def get_debrief(meeting_id: str, background: BackgroundTasks, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    meeting = _meeting_or_404(db, meeting_id, user)
    debrief = db.query(WizardDebrief).filter(WizardDebrief.meeting_id == meeting.id).first()
    if debrief is None:
        if meeting.status in ("planned", "ready", "live"):
            # 404 (not 409): the client polls this right after session_saved and treats 404 as "not yet".
            raise HTTPException(status_code=404, detail="No debrief yet: the meeting hasn't ended. End it first, then the debrief is generated.")
        debrief = debrief_svc.get_or_create_row(db, meeting)
        background.add_task(debrief_svc.run_debrief_job, meeting.id, meeting.call_log_id, user.id)
        return JSONResponse(status_code=202, content={"status": "generating", "meeting_id": meeting.id})
    if debrief.status == "generating":
        return JSONResponse(status_code=202, content={"status": "generating", "meeting_id": meeting.id})
    return debrief_svc.serialize(debrief)


@router.post("/meetings/{meeting_id}/debrief")
async def regenerate_debrief(meeting_id: str, force: int = Query(0), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    meeting = _meeting_or_404(db, meeting_id, user)
    if meeting.status in ("planned", "ready", "live"):
        raise HTTPException(status_code=409, detail="The meeting hasn't ended yet. End it first, then generate the debrief.")
    _debrief_limiter.hit(user_key(user))
    row = await debrief_svc.generate_debrief(db, meeting, force=bool(force))
    return debrief_svc.serialize(row)


@router.patch("/meetings/{meeting_id}/debrief")
def patch_debrief(meeting_id: str, patch: dict, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    meeting = _meeting_or_404(db, meeting_id, user)
    debrief = db.query(WizardDebrief).filter(WizardDebrief.meeting_id == meeting.id).first()
    if debrief is None or debrief.status != "ready":
        raise HTTPException(status_code=409, detail="The debrief isn't ready yet.")
    if not isinstance(patch, dict):
        raise HTTPException(status_code=422, detail="Send a JSON object with the fields to change.")
    if "outcome" in patch and patch["outcome"] not in (None, "next_step_set", "follow_up_needed", "won", "lost", "no_show", "unclear"):
        raise HTTPException(status_code=422, detail="outcome must be next_step_set, follow_up_needed, won, lost, no_show or unclear.")
    debrief_svc.apply_patch(debrief, patch)
    db.commit()
    db.refresh(debrief)
    return debrief_svc.serialize(debrief)


def _ready_debrief(db: Session, meeting: WizardMeeting) -> WizardDebrief:
    debrief = db.query(WizardDebrief).filter(WizardDebrief.meeting_id == meeting.id).first()
    if debrief is None or debrief.status != "ready":
        raise HTTPException(status_code=409, detail="The debrief isn't ready yet. Generate it first.")
    return debrief


@router.post("/meetings/{meeting_id}/debrief/send")
async def send_debrief(meeting_id: str, body: SendBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    meeting = _meeting_or_404(db, meeting_id, user)
    debrief = _ready_debrief(db, meeting)
    integration = integ.get_or_create_integration(db, user.id)
    channel = (body.channel or "").strip().lower()
    sent = dict(debrief.sent or {})
    now_iso = contracts.utc_now_iso()
    if channel == "email":
        email = debrief.follow_up_email or {}
        to = body.to or meeting.prospect_email
        url = integ.build_mailto(to, email.get("subject") or f"Recap: {meeting.title or ''}", email.get("body") or "", bcc=integration.crm_bcc_email)
        sent["email_at"] = now_iso
        debrief.sent = sent
        db.commit()
        return {"channel": "email", "mailto": url, "to": to, "bcc": integration.crm_bcc_email, "sent": sent}
    if channel == "whatsapp":
        phone = integ.normalize_phone(body.to, integration.default_country or integ.DEFAULT_COUNTRY) if body.to else meeting.prospect_phone_e164
        url = integ.build_wa_me(phone, debrief.follow_up_whatsapp or "")
        sent["whatsapp_at"] = now_iso
        debrief.sent = sent
        db.commit()
        return {"channel": "whatsapp", "wa_me_url": url, "to": phone, "sent": sent}
    if channel == "relay":
        if not meeting.call_log_id:
            raise HTTPException(status_code=409, detail="No call log is linked to this meeting, so a Relay page can't be built yet.")
        log = db.get(CallLog, meeting.call_log_id)
        if log is None or log.user_id != user.id:
            raise HTTPException(status_code=404, detail="Call log not found.")
        result = await integ.create_relay_for_meeting(db, user, meeting, debrief, log)
        sent["relay_id"] = result["relay_id"]
        sent["relay_at"] = sent.get("relay_at") or now_iso
        debrief.sent = sent
        db.commit()
        return {"channel": "relay", **result, "sent": sent}
    if channel == "crm":
        rows = integ.build_crm_preview(meeting, debrief, integration, previous=(sent.get("crm_rows") or None))
        return await _push_crm(db, user, meeting, debrief, integration, rows)
    raise HTTPException(status_code=422, detail="channel must be email, whatsapp, relay or crm.")


async def _push_crm(db: Session, user: User, meeting: WizardMeeting, debrief: WizardDebrief, integration: WizardIntegration,
                    rows: list[dict]) -> dict:
    approved = [r for r in rows if r.get("approved", True)]
    if not approved:
        raise HTTPException(status_code=422, detail="Nothing approved to write.")
    sent = dict(debrief.sent or {})
    now_iso = contracts.utc_now_iso()
    if integration.zoho_oauth and integ.zoho_config():
        try:
            result = await integ.zoho_push(integration.zoho_oauth, meeting, approved)
        except integ.ZohoError as exc:
            sent.update({"crm_at": now_iso, "crm_status": "failed", "crm_target": "zoho", "crm_error": str(exc)})
            debrief.sent = sent
            db.commit()
            raise HTTPException(status_code=502, detail=str(exc))
        if result.get("tokens"):
            integration.zoho_oauth = result["tokens"]
        status = "ok" if not result["errors"] else ("partial" if result["written"] else "failed")
        sent.update({"crm_at": now_iso, "crm_status": status, "crm_target": "zoho", "crm_ids": {k: result[k] for k in ("contact_id", "deal_id", "note_id", "task_id")},
                     "crm_rows": {f"{r['object']}.{r['field']}": r.get("proposed") for r in approved}, "crm_error": "; ".join(result["errors"]) or None})
        debrief.sent = sent
        db.commit()
        written_rows = [r for r in approved if r["object"] in result["written"]]
        return {"channel": "crm", "target": "zoho", "status": status, "crm_status": status, "written": len(written_rows),
                "written_objects": result["written"], "errors": result["errors"], "ids": sent["crm_ids"], "sent": sent}
    if integration.crm_webhook_url:
        payload = integ.rows_to_webhook_payload(meeting, debrief, approved)
        try:
            result = await integ.post_webhook(integration.crm_webhook_url, payload, integration.crm_webhook_secret)
        except integ.WebhookError as exc:
            sent.update({"crm_at": now_iso, "crm_status": "failed", "crm_target": "webhook", "crm_error": str(exc)})
            debrief.sent = sent
            db.commit()
            raise HTTPException(status_code=502, detail=str(exc))
        status = "ok" if result["ok"] else "failed"
        sent.update({"crm_at": now_iso, "crm_status": status, "crm_target": "webhook", "crm_http_status": result["status"],
                     "crm_rows": {f"{r['object']}.{r['field']}": r.get("proposed") for r in approved}, "crm_error": result.get("detail")})
        debrief.sent = sent
        db.commit()
        if not result["ok"]:
            raise HTTPException(status_code=502, detail=result["detail"])
        return {"channel": "crm", "target": "webhook", "status": status, "crm_status": status, "written": len(approved),
                "http_status": result["status"], "sent": sent}
    raise HTTPException(status_code=409, detail="No CRM is connected. Add a CRM webhook URL (or connect Zoho) in Wizard settings, "
                                                "or use 'Copy for CRM'.")


@router.get("/meetings/{meeting_id}/crm/preview")
def crm_preview(meeting_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    meeting = _meeting_or_404(db, meeting_id, user)
    debrief = db.query(WizardDebrief).filter(WizardDebrief.meeting_id == meeting.id).first()
    ready = debrief if (debrief and debrief.status == "ready") else None
    integration = integ.get_or_create_integration(db, user.id)
    previous = (ready.sent or {}).get("crm_rows") if ready else None
    rows = integ.build_crm_preview(meeting, ready, integration, previous=previous)
    target = "zoho" if (integration.zoho_oauth and integ.zoho_config()) else ("webhook" if integration.crm_webhook_url else None)
    ids = ((ready.sent or {}).get("crm_ids") or {}) if ready else {}
    record_url = None
    if ids.get("deal_id") and target == "zoho":
        record_url = f"https://crm.zoho.in/crm/tab/Potentials/{ids['deal_id']}"
    return {"changes": rows, "rows": rows, "target": target, "debrief_ready": ready is not None, "record_url": record_url,
            "previous_push": {k: (ready.sent or {}).get(k) for k in ("crm_at", "crm_status", "crm_target")} if ready else None,
            "crm_bcc_email": integration.crm_bcc_email}


@router.post("/meetings/{meeting_id}/crm/push")
async def crm_push(meeting_id: str, body: CrmPushBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """``approved`` is a list of change ids (``"deal.Amount"``) from the preview, or full row objects."""
    meeting = _meeting_or_404(db, meeting_id, user)
    debrief = _ready_debrief(db, meeting)
    integration = integ.get_or_create_integration(db, user.id)
    preview = {r["id"]: r for r in integ.build_crm_preview(meeting, debrief, integration, previous=(debrief.sent or {}).get("crm_rows") or None)}
    rows = []
    for item in body.approved:
        if isinstance(item, str):
            row = preview.get(item)
            if row:
                rows.append({**row, "approved": True})
        elif isinstance(item, dict) and item.get("object") and item.get("field"):
            key = f"{item['object']}.{item['field']}"
            proposed = item["proposed"] if "proposed" in item else (preview.get(key) or {}).get("proposed")
            rows.append({"id": key, "object": str(item["object"]), "field": str(item["field"]), "proposed": proposed, "approved": True})
        elif isinstance(item, dict) and item.get("id") in preview:
            rows.append({**preview[item["id"]], "approved": True})
    return await _push_crm(db, user, meeting, debrief, integration, rows)


# ── rehearse ─────────────────────────────────────────────────────────────────

@router.post("/meetings/{meeting_id}/rehearse")
async def rehearse(meeting_id: str, body: RehearseBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    meeting = _meeting_or_404(db, meeting_id, user)
    _rehearse_limiter.hit(user_key(user))
    messages = [{"role": "rep" if m.role.lower() in ("rep", "salesperson", "user") else "prospect", "text": m.text.strip()} for m in body.messages if m.text.strip()][-8:]
    result = await brief_svc.rehearse(db, meeting, messages)
    return result


# ── battlecards ──────────────────────────────────────────────────────────────

@router.get("/battlecards")
def list_battlecards(kind: Optional[str] = None, q: Optional[str] = None, meeting_id: Optional[str] = None,
                     include_inactive: int = Query(0), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if kind and kind not in cards_svc.KINDS:
        raise HTTPException(status_code=422, detail=f"kind must be one of: {', '.join(cards_svc.KINDS)}.")
    cards = cards_svc.visible_cards(db, user.id, kind=kind, q=q, include_inactive=bool(include_inactive))
    if meeting_id:
        meeting = _meeting_or_404(db, meeting_id, user)
        scored = cards_svc.score_cards(cards, meeting)
        selected = set(meeting.battlecard_ids or [])
        return [{**cards_svc.serialize(c), "score": s, "why": w, "selected": c.id in selected} for c, s, w in scored]
    return [cards_svc.serialize(c) for c in cards]


def _card_or_404(db: Session, card_id: str, user: User) -> WizardBattlecard:
    card = db.get(WizardBattlecard, card_id)
    if card is None or (card.user_id is not None and card.user_id != user.id):
        raise HTTPException(status_code=404, detail="Battlecard not found.")
    return card


@router.post("/battlecards", status_code=201)
def create_battlecard(body: BattlecardBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    overrides = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k != "copy_of"}
    if body.copy_of:
        source = _card_or_404(db, body.copy_of, user)
        clone = cards_svc.copy_for_user(db, source, user.id, overrides)
        return cards_svc.serialize(clone)
    if not body.title or not body.act:
        raise HTTPException(status_code=422, detail="A battlecard needs at least a title and the `act` text (what to say).")
    if body.kind and body.kind not in cards_svc.KINDS:
        raise HTTPException(status_code=422, detail=f"kind must be one of: {', '.join(cards_svc.KINDS)}.")
    card = WizardBattlecard(id=str(models_wizard._uuid()), user_id=user.id, source="user", is_active=True, usage_count=0,
                            kind=body.kind or "custom", title=body.title.strip())
    for key, value in overrides.items():
        if key in cards_svc.EDITABLE_FIELDS:
            setattr(card, key, value)
    card.trigger_keywords = [k.strip() for k in (card.trigger_keywords or []) if isinstance(k, str) and k.strip()][:24]
    card.tags = [t.strip() for t in (card.tags or []) if isinstance(t, str) and t.strip()][:12]
    db.add(card)
    db.commit()
    db.refresh(card)
    return cards_svc.serialize(card)


@router.patch("/battlecards/{card_id}")
def update_battlecard(card_id: str, body: BattlecardBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    card = _card_or_404(db, card_id, user)
    if card.user_id is None:
        raise HTTPException(status_code=403, detail="Seed battlecards are read-only. Use 'Copy to edit' (POST /battlecards with copy_of).")
    if body.kind and body.kind not in cards_svc.KINDS:
        raise HTTPException(status_code=422, detail=f"kind must be one of: {', '.join(cards_svc.KINDS)}.")
    for key, value in body.model_dump(exclude_unset=True).items():
        if key in cards_svc.EDITABLE_FIELDS and value is not None:
            setattr(card, key, value)
    card.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(card)
    return cards_svc.serialize(card)


@router.delete("/battlecards/{card_id}")
def delete_battlecard(card_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    card = _card_or_404(db, card_id, user)
    if card.user_id is None:
        raise HTTPException(status_code=403, detail="Seed battlecards can't be deleted.")
    db.delete(card)
    db.commit()
    return {"message": "Battlecard deleted", "id": card_id}


@router.post("/battlecards/suggest")
def suggest_battlecards(body: SuggestBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    meeting = _meeting_or_404(db, body.meeting_id, user)
    scored = cards_svc.suggest_for_meeting(db, meeting, limit=body.limit)
    return [{"battlecard": cards_svc.serialize(c), "score": s, "why": w} for c, s, w in scored]


# ── calendar ─────────────────────────────────────────────────────────────────

def _oauth_state(user: User, provider: str) -> str:
    return create_access_token({"sub": str(user.id), "purpose": "wizard-oauth", "provider": provider}, timedelta(minutes=15))


def _decode_state(state: str, provider: str) -> int:
    try:
        payload = jwt.decode(state or "", SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=400, detail="This sign-in link has expired. Start again from Wizard settings.")
    if payload.get("purpose") != "wizard-oauth" or payload.get("provider") != provider:
        raise HTTPException(status_code=400, detail="This sign-in link isn't valid for this provider.")
    return int(payload["sub"])


@router.get("/calendar/sources")
def list_calendar_sources(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(WizardCalendarSource).filter(WizardCalendarSource.user_id == user.id).order_by(WizardCalendarSource.created_at).all()
    return {"sources": [source_json(r) for r in rows],
            "providers": {p: calendar_svc.provider_config(p) is not None for p in calendar_svc.PROVIDERS}}


@router.post("/calendar/sources", status_code=201)
async def add_calendar_source(body: CalendarSourceBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    kind = (body.kind or "").strip().lower()
    if kind == "ics":
        if not body.url:
            raise HTTPException(status_code=422, detail="Paste your calendar's private ICS link (url).")
        try:
            normalized = calendar_svc.normalize_ics_url(body.url)
        except calendar_svc.CalendarFetchError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        source = WizardCalendarSource(user_id=user.id, kind="ics", label=_clean(body.label, 120) or "Calendar (ICS)", ics_url=normalized, status="idle")
        db.add(source)
        db.commit()
        db.refresh(source)
        _sync_limiter.hit(user_key(user))
        result = await _sync_one(db, source)
        return {**source_json(source), "sync": result}
    if kind in calendar_svc.PROVIDERS:
        if calendar_svc.provider_config(kind) is None:
            return JSONResponse(status_code=501, content={"detail": calendar_svc.UNCONFIGURED_MESSAGES[kind]})
        return {"auth_url": calendar_svc.build_auth_url(kind, _oauth_state(user, kind)), "kind": kind}
    raise HTTPException(status_code=422, detail="kind must be ics, google or microsoft.")


@router.get("/calendar/oauth/{provider}/callback")
async def calendar_oauth_callback(provider: str, code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None,
                                  db: Session = Depends(get_db)):
    if provider not in calendar_svc.PROVIDERS:
        raise HTTPException(status_code=404, detail="Unknown calendar provider.")
    if calendar_svc.provider_config(provider) is None:
        return JSONResponse(status_code=501, content={"detail": calendar_svc.UNCONFIGURED_MESSAGES[provider]})
    if error or not code:
        return HTMLResponse(_oauth_page(f"{provider.title()} calendar wasn't connected ({error or 'no code'}). You can close this tab and try again."), status_code=400)
    user_id = _decode_state(state or "", provider)
    try:
        tokens = await calendar_svc.exchange_code(provider, code)
    except calendar_svc.CalendarFetchError as exc:
        return HTMLResponse(_oauth_page(str(exc)), status_code=502)
    source = db.query(WizardCalendarSource).filter(WizardCalendarSource.user_id == user_id, WizardCalendarSource.kind == provider).first()
    if source is None:
        source = WizardCalendarSource(user_id=user_id, kind=provider, label=f"{provider.title()} Calendar", status="idle")
        db.add(source)
    source.oauth = tokens
    source.error = None
    db.commit()
    db.refresh(source)
    await _sync_one(db, source)
    return HTMLResponse(_oauth_page(f"{provider.title()} calendar connected. You can close this tab and go back to ClozFlow."))


def _oauth_page(message: str) -> str:
    safe = message.replace("<", "&lt;").replace(">", "&gt;")
    return (f"<!doctype html><html><head><meta charset='utf-8'><title>ClozFlow</title></head><body style='font-family:system-ui;padding:32px'>"
            f"<h2>ClozFlow Meeting Wizard</h2><p>{safe}</p><script>setTimeout(function(){{try{{window.close()}}catch(e){{}}}},1500)</script></body></html>")


@router.delete("/calendar/sources/{source_id}")
def delete_calendar_source(source_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    source = db.get(WizardCalendarSource, source_id)
    if source is None or source.user_id != user.id:
        raise HTTPException(status_code=404, detail="Calendar source not found.")
    db.query(WizardCalendarEvent).filter(WizardCalendarEvent.source_id == source.id).delete()
    db.delete(source)
    db.commit()
    return {"message": "Calendar source removed", "id": source_id}


async def _sync_one(db: Session, source: WizardCalendarSource) -> dict:
    window_start, window_end = calendar_svc.window()
    source.status = "syncing"
    db.commit()
    try:
        if source.kind == "ics":
            text = await calendar_svc.fetch_ics(source.ics_url or "")
            parsed = calendar_svc.parse_ics(text, window_start=window_start, window_end=window_end)
            events, warnings = parsed["events"], parsed["warnings"]
        else:
            events, tokens = await calendar_svc.fetch_provider_events(source.kind, source.oauth or {}, window_start, window_end)
            source.oauth = tokens
            warnings = []
    except (calendar_svc.CalendarFetchError, LookupError) as exc:
        source.status, source.error = "error", str(exc)
        db.commit()
        return {"source_id": source.id, "ok": False, "error": str(exc), "added": 0, "updated": 0, "removed": 0, "warnings": []}
    except Exception as exc:  # noqa: BLE001
        source.status, source.error = "error", f"Sync failed ({type(exc).__name__})."
        db.commit()
        logger.warning("wizard calendar sync failed: %s", type(exc).__name__)
        return {"source_id": source.id, "ok": False, "error": source.error, "added": 0, "updated": 0, "removed": 0, "warnings": []}
    existing = {row.external_id: row for row in db.query(WizardCalendarEvent).filter(WizardCalendarEvent.source_id == source.id).all()}
    added = updated = 0
    seen: set[str] = set()
    for event in events:
        external_id = event["external_id"]
        if external_id in seen:
            continue
        seen.add(external_id)
        row = existing.get(external_id)
        payload = {"title": (event.get("title") or "")[:300], "start": event.get("start"), "end": event.get("end"),
                   "attendees": event.get("attendees") or [], "meeting_link": (event.get("meeting_link") or None),
                   "platform": event.get("platform"), "location": (event.get("location") or None), "raw_hash": event.get("raw_hash")}
        if payload["location"]:
            payload["location"] = payload["location"][:500]
        if row is None:
            row = WizardCalendarEvent(source_id=source.id, user_id=source.user_id, external_id=external_id, **payload)
            db.add(row)
            added += 1
        elif row.raw_hash != payload["raw_hash"]:
            for key, value in payload.items():
                setattr(row, key, value)
            row.updated_at = datetime.utcnow()
            updated += 1
    removed = 0
    for external_id, row in existing.items():
        if external_id not in seen and row.start and window_start <= row.start <= window_end and not row.meeting_id:
            db.delete(row)
            removed += 1
    source.status, source.error, source.last_synced_at = "ok", None, datetime.utcnow()
    db.commit()
    return {"source_id": source.id, "ok": True, "added": added, "updated": updated, "removed": removed, "warnings": warnings}


@router.post("/calendar/sync")
async def sync_calendars(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _sync_limiter.hit(user_key(user))
    sources = db.query(WizardCalendarSource).filter(WizardCalendarSource.user_id == user.id).all()
    if not sources:
        raise HTTPException(status_code=404, detail="No calendar connected yet. Add your calendar's private ICS link in Wizard settings.")
    results = [await _sync_one(db, s) for s in sources]
    return {"results": results, "synced_at": contracts.utc_now_iso()}


@router.get("/calendar/events")
def list_calendar_events(from_: Optional[str] = Query(None, alias="from"), to: Optional[str] = None, limit: int = Query(100, ge=1, le=500),
                         db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    start = _parse_dt(from_, "from") or (datetime.utcnow() - timedelta(hours=1))
    end = _parse_dt(to, "to") or (start + timedelta(days=14))
    rows = (db.query(WizardCalendarEvent).filter(WizardCalendarEvent.user_id == user.id, WizardCalendarEvent.start >= start,
                                                 WizardCalendarEvent.start <= end).order_by(WizardCalendarEvent.start).limit(limit).all())
    out = []
    for row in rows:
        linked = db.get(WizardMeeting, row.meeting_id) if row.meeting_id else None
        out.append(event_json(row, linked))
    return out


@router.post("/calendar/events/{event_id}/link", status_code=201)
def link_calendar_event(event_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    event = db.get(WizardCalendarEvent, event_id)
    if event is None or event.user_id != user.id:
        raise HTTPException(status_code=404, detail="Calendar event not found.")
    if event.meeting_id:
        existing = db.get(WizardMeeting, event.meeting_id)
        if existing is not None:
            return meeting_json(existing)
    meeting = WizardMeeting(user_id=user.id, status="planned", methodology="meddpicc", platform="meet", channel="tab_audio",
                            coaching_intensity="guided", battlecard_ids=[])
    _prefill_from_event(db, meeting, event.id, user)
    if meeting.platform == "phone":
        meeting.channel = "phone_bridge"
    meeting.title = meeting.title or event.title or "Meeting"
    default = db.query(Capsule).filter(Capsule.user_id == user.id, Capsule.is_default.is_(True)).first()
    if default:
        _snapshot_capsule(db, meeting, default.id, user)
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    event.meeting_id = meeting.id
    db.commit()
    return meeting_json(meeting)


# ── preflight ────────────────────────────────────────────────────────────────

def _stt_status() -> dict:
    try:
        from services.wizard import stt_router  # type: ignore  (Backend B)
        describe = getattr(stt_router, "describe", None)
        if describe is not None:
            info = describe()
            if isinstance(info, dict):
                return info
    except Exception:  # noqa: BLE001 - fall back to the env-based view
        pass
    for vendor, env in (("deepgram", "DEEPGRAM_API_KEY"), ("gemini", "GEMINI_API_KEY"), ("sarvam", "SARVAM_API_KEY")):
        if (os.getenv(env) or "").strip():
            return {"vendor": vendor, "ready": True, "model": None}
    return {"vendor": None, "ready": False, "model": None, "reason": "No speech-to-text key is configured (DEEPGRAM_API_KEY, GEMINI_API_KEY or SARVAM_API_KEY)."}


@router.get("/preflight")
def preflight(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    integration = integ.get_or_create_integration(db, user.id)
    scripts = integ.consent_scripts(integration)
    bridge = bridge_config().public_payload()
    return {"stt": _stt_status(), "coach": llm.describe(),
            "bridge": {"enabled": bridge["enabled"], "reason": bridge["reason"], "rate_per_minute": bridge["rate_per_minute"],
                       "min_balance": bridge["min_balance"], "country_default": bridge["country_default"]},
            "bot": {"enabled": False, "reason": "Meeting bots aren't available yet; use tab audio, the phone bridge or the mic."},
            "consent_script": scripts["en"], "consent_script_hi": scripts["hi"], "notetaker_name": scripts["notetaker_name"],
            "bridge_disclosure": bool(integration.bridge_disclosure),
            "slo": {"first_line_ms": contracts.SLO_FIRST_LINE_P50_MS}, "zoho": {"configured": integ.zoho_config() is not None, "connected": bool(integration.zoho_oauth)},
            "calendar_providers": {p: calendar_svc.provider_config(p) is not None for p in calendar_svc.PROVIDERS}}


# ── integrations ─────────────────────────────────────────────────────────────

@router.get("/integrations")
def get_integrations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return integ.serialize_integration(integ.get_or_create_integration(db, user.id))


@router.put("/integrations")
def put_integrations(body: IntegrationsBody, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = integ.get_or_create_integration(db, user.id)
    fields = body.model_fields_set
    if "crm_webhook_url" in fields:
        url = _clean(body.crm_webhook_url, 1000)
        if url:
            try:
                from services.knowledge.url_safety import normalize_url
                url = normalize_url(url)
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(status_code=422, detail=f"crm_webhook_url isn't usable: {exc}")
            if not url.startswith("https://") and not (os.getenv("ALLOW_LOCALHOST_CRAWL", "false").lower() in ("true", "1", "yes")):
                raise HTTPException(status_code=422, detail="crm_webhook_url must start with https://.")
        row.crm_webhook_url = url
    if "crm_webhook_secret" in fields:
        row.crm_webhook_secret = _clean(body.crm_webhook_secret, 200)
    if "crm_bcc_email" in fields:
        email = _clean(body.crm_bcc_email, 254)
        if email and not _EMAIL_RE.match(email):
            raise HTTPException(status_code=422, detail="crm_bcc_email must be a valid email address.")
        row.crm_bcc_email = email.lower() if email else None
    if "default_country" in fields:
        country = _clean(body.default_country, 8) or integ.DEFAULT_COUNTRY
        if not re.fullmatch(r"\+\d{1,4}", country):
            raise HTTPException(status_code=422, detail="default_country must look like +91.")
        row.default_country = country
    if "notetaker_name" in fields:
        row.notetaker_name = _clean(body.notetaker_name, 80) or integ.DEFAULT_NOTETAKER_NAME
    if "consent_script" in fields:
        row.consent_script = _clean(body.consent_script, 1000)
    if "bridge_disclosure" in fields and body.bridge_disclosure is not None:
        row.bridge_disclosure = bool(body.bridge_disclosure)
    if "retention_days_audio" in fields and body.retention_days_audio is not None:
        row.retention_days_audio = int(body.retention_days_audio)
    if "retention_days_transcript" in fields and body.retention_days_transcript is not None:
        row.retention_days_transcript = int(body.retention_days_transcript)
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return integ.serialize_integration(row)


@router.get("/integrations/zoho/connect")
def zoho_connect(user: User = Depends(get_current_user)):
    if integ.zoho_config() is None:
        return JSONResponse(status_code=501, content={"detail": integ.ZOHO_UNCONFIGURED})
    return {"auth_url": integ.zoho_auth_url(_oauth_state(user, "zoho")), "scopes": integ.ZOHO_SCOPES}


@router.get("/integrations/zoho/callback")
async def zoho_callback(code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None,
                        db: Session = Depends(get_db)):
    if integ.zoho_config() is None:
        return JSONResponse(status_code=501, content={"detail": integ.ZOHO_UNCONFIGURED})
    if error or not code:
        return HTMLResponse(_oauth_page(f"Zoho CRM wasn't connected ({error or 'no code'}). You can close this tab and try again."), status_code=400)
    user_id = _decode_state(state or "", "zoho")
    try:
        tokens = await integ.zoho_exchange_code(code)
    except integ.ZohoError as exc:
        return HTMLResponse(_oauth_page(str(exc)), status_code=502)
    row = integ.get_or_create_integration(db, user_id)
    row.zoho_oauth = tokens
    row.zoho_connected_at = datetime.utcnow()
    db.commit()
    return HTMLResponse(_oauth_page("Zoho CRM connected. You can close this tab and go back to ClozFlow."))


@router.delete("/integrations/zoho")
def zoho_disconnect(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = integ.get_or_create_integration(db, user.id)
    row.zoho_oauth = None
    row.zoho_connected_at = None
    db.commit()
    return {"message": "Zoho CRM disconnected", "zoho": {"connected": False, "configured": integ.zoho_config() is not None}}


# ── admin: retention ─────────────────────────────────────────────────────────

@router.post("/admin/retention/run")
def run_retention(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not is_user_superuser(db, user.id):
        raise HTTPException(status_code=403, detail="Only administrators can run the retention sweep.")
    return retention_svc.run_retention_sweep(db)
