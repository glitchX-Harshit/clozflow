"""Post-meeting integrations: mailto / wa.me builders, HMAC-signed CRM webhook, Relay page
creation via the existing relay engine, and the env-gated Zoho CRM connector with an
approve-before-write diff (spec §4 ``/debrief/send``, ``/crm/preview``, ``/crm/push``).

Outbound HTTP goes through small factory functions (``_webhook_client``, ``_zoho_client``)
so tests can inject ``httpx.MockTransport``; nothing here logs payloads or phone numbers.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import uuid
from datetime import datetime
from typing import Any, Optional
from urllib.parse import quote, urlencode, urlsplit

import httpx
from sqlalchemy.orm import Session

from models import CallLog, Capsule, User
from models_relay import Relay
from models_wizard import WizardDebrief, WizardIntegration, WizardMeeting
from services.knowledge import url_safety

logger = logging.getLogger(__name__)

DEFAULT_NOTETAKER_NAME = "ClozFlow Notetaker"
DEFAULT_CONSENT_SCRIPT = ("Hi, quick note before we start: I'm using ClozFlow to take notes on this call "
                          "so I can focus on our conversation. Is that okay with you?")
DEFAULT_CONSENT_SCRIPT_HI = ("Shuru karne se pehle ek chhoti baat: main is call ke notes lene ke liye ClozFlow "
                             "use kar raha hoon, taaki main poora dhyan hamari baat pe de sakoon. Aapko theek hai?")
DEFAULT_COUNTRY = "+91"
WEBHOOK_TIMEOUT_S = 10.0
SIGNATURE_HEADER = "X-ClozFlow-Signature"
TIMESTAMP_HEADER = "X-ClozFlow-Timestamp"

_E164 = re.compile(r"^\+[1-9][0-9]{7,14}$")


# ── integrations row ─────────────────────────────────────────────────────────

def get_or_create_integration(db: Session, user_id: int) -> WizardIntegration:
    row = db.get(WizardIntegration, user_id)
    if row is None:
        row = WizardIntegration(user_id=user_id)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def consent_scripts(row: Optional[WizardIntegration]) -> dict:
    custom = (row.consent_script if row else None) or ""
    return {"en": custom.strip() or DEFAULT_CONSENT_SCRIPT, "hi": DEFAULT_CONSENT_SCRIPT_HI,
            "notetaker_name": (row.notetaker_name if row else None) or DEFAULT_NOTETAKER_NAME}


def serialize_integration(row: WizardIntegration) -> dict:
    return {
        "user_id": row.user_id,
        "crm_webhook_url": row.crm_webhook_url,
        "has_webhook_secret": bool(row.crm_webhook_secret),
        "crm_bcc_email": row.crm_bcc_email,
        "default_country": row.default_country or DEFAULT_COUNTRY,
        "notetaker_name": row.notetaker_name or DEFAULT_NOTETAKER_NAME,
        "consent_script": row.consent_script or DEFAULT_CONSENT_SCRIPT,
        "consent_script_hi": DEFAULT_CONSENT_SCRIPT_HI,
        "bridge_disclosure": bool(row.bridge_disclosure) if row.bridge_disclosure is not None else True,
        "retention_days_audio": int(row.retention_days_audio or 0),
        "retention_days_transcript": int(row.retention_days_transcript if row.retention_days_transcript is not None else 180),
        "zoho": {"connected": bool(row.zoho_oauth), "connected_at": row.zoho_connected_at.isoformat() + "Z" if row.zoho_connected_at else None,
                 "configured": zoho_config() is not None, "org_name": (row.zoho_oauth or {}).get("org_name") if row.zoho_oauth else None},
        "zoho_connected": bool(row.zoho_oauth),
        "updated_at": row.updated_at.isoformat() + "Z" if row.updated_at else None,
    }


# ── phone / mailto / wa.me ───────────────────────────────────────────────────

def normalize_phone(raw: Optional[str], default_country: str = DEFAULT_COUNTRY) -> Optional[str]:
    """E.164 or None. ``98765 43210`` → ``+919876543210`` with the default country; ``0091…`` → ``+91…``."""
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    text = re.sub(r"[\s().\-]", "", text)
    if text.startswith("00"):
        text = "+" + text[2:]
    if not text.startswith("+"):
        digits = re.sub(r"\D", "", text)
        if not digits:
            return None
        country = (default_country or DEFAULT_COUNTRY).strip()
        if country == "+91" and len(digits) == 11 and digits.startswith("0"):
            digits = digits[1:]
        if country == "+91" and len(digits) == 12 and digits.startswith("91"):
            text = "+" + digits
        else:
            text = country + digits
    return text if _E164.match(text) else None


def _mailto_quote(value: str) -> str:
    return quote(value, safe="")


def build_mailto(to: Optional[str], subject: str, body: str, *, bcc: Optional[str] = None, cc: Optional[str] = None) -> str:
    """RFC 6068 ``mailto:`` URL. Line breaks become %0D%0A; everything is percent-encoded (no '+')."""
    params = []
    if cc:
        params.append(("cc", cc))
    if bcc:
        params.append(("bcc", bcc))
    params.append(("subject", subject or ""))
    params.append(("body", (body or "").replace("\r\n", "\n").replace("\n", "\r\n")))
    query = "&".join(f"{key}={_mailto_quote(value)}" for key, value in params if value is not None)
    return f"mailto:{_mailto_quote(to) if to else ''}?{query}"


def build_wa_me(phone_e164: Optional[str], text: str) -> str:
    """``https://wa.me/<digits>?text=<urlencoded>``; without a number WhatsApp opens its contact picker."""
    digits = re.sub(r"\D", "", phone_e164 or "")
    encoded = quote(text or "", safe="")
    return f"https://wa.me/{digits}?text={encoded}" if digits else f"https://wa.me/?text={encoded}"


# ── CRM webhook (HMAC-SHA256) ────────────────────────────────────────────────

def sign_webhook(secret: str, body: bytes, timestamp: Optional[str] = None) -> str:
    """``sha256=<hex>`` over ``f"{timestamp}.{body}"`` when a timestamp is given, else over the body."""
    message = (f"{timestamp}.".encode("utf-8") + body) if timestamp else body
    digest = hmac.new((secret or "").encode("utf-8"), message, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def verify_webhook_signature(secret: str, body: bytes, signature: str, timestamp: Optional[str] = None) -> bool:
    expected = sign_webhook(secret, body, timestamp)
    return hmac.compare_digest(expected, signature or "")


def _webhook_client() -> httpx.AsyncClient:
    """Outbound client for the customer's webhook (patched in tests)."""
    return url_safety.safe_async_client(timeout=WEBHOOK_TIMEOUT_S, max_redirects=0)


async def _validate_outbound_url(url: str) -> str:
    """SSRF check for the webhook URL (patched in tests)."""
    return await url_safety.validate_public_url(url)


class WebhookError(RuntimeError):
    """Human-readable webhook failure."""


async def post_webhook(url: str, payload: dict, secret: Optional[str]) -> dict:
    """POST JSON with ``X-ClozFlow-Signature`` (HMAC-SHA256) and a 10 s timeout. Returns ``{status, ok, detail}``."""
    try:
        target = await _validate_outbound_url(url)
    except url_safety.UnsafeURLError as exc:
        raise WebhookError(f"The CRM webhook URL isn't allowed: {exc}")
    body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
    timestamp = str(int(datetime.utcnow().timestamp()))
    headers = {"Content-Type": "application/json", "User-Agent": "ClozFlow-Wizard/1.0", TIMESTAMP_HEADER: timestamp}
    if secret:
        headers[SIGNATURE_HEADER] = sign_webhook(secret, body, timestamp)
    try:
        async with _webhook_client() as client:
            response = await client.post(target, content=body, headers=headers)
    except httpx.TimeoutException:
        raise WebhookError("The CRM webhook didn't answer within 10 seconds.")
    except (httpx.HTTPError, url_safety.UnsafeURLError) as exc:
        raise WebhookError(f"Couldn't reach the CRM webhook ({type(exc).__name__}).")
    ok = 200 <= response.status_code < 300
    return {"status": response.status_code, "ok": ok,
            "detail": None if ok else f"The CRM webhook returned HTTP {response.status_code}."}


# ── Relay page from a debrief ────────────────────────────────────────────────

async def create_relay_for_meeting(db: Session, user: User, meeting: WizardMeeting, debrief: Optional[WizardDebrief],
                                   call_log: CallLog) -> dict:
    """Create (or reuse) the Relay page for the meeting's call log, pre-filled from the debrief."""
    existing = db.query(Relay).filter(Relay.call_id == call_log.id, Relay.user_id == user.id).first()
    if existing:
        return {"relay_id": existing.id, "slug": existing.slug, "url": f"/relay/{existing.slug}", "status": existing.status, "existing": True}
    try:
        transcript_data = json.loads(call_log.transcript or "[]")
    except (TypeError, ValueError):
        transcript_data = []
    try:
        ai_data = json.loads(call_log.ai_suggestions or "[]")
    except (TypeError, ValueError):
        ai_data = []
    capsule_dict = None
    capsule = db.get(Capsule, meeting.capsule_id) if meeting.capsule_id else None
    if capsule is None:
        capsule = db.query(Capsule).filter(Capsule.user_id == user.id, Capsule.is_default.is_(True)).first()
    if capsule:
        capsule_dict = {"product_name": capsule.product_name, "product_price": capsule.product_price,
                        "product_specification": capsule.product_specification, "target_audience": capsule.target_audience,
                        "key_differentiators": capsule.key_differentiators, "pain_points_solved": capsule.pain_points_solved}
    from services.relay_engine import generate_relay_content

    seller_name = user.full_name or user.username or (user.email or "").split("@")[0]
    content = await generate_relay_content(
        transcript_data=transcript_data if isinstance(transcript_data, list) else [],
        ai_data=ai_data if isinstance(ai_data, list) else [], capsule=capsule_dict,
        prospect_name=meeting.prospect_name or "", prospect_business=meeting.company or "",
        seller_name=seller_name, seller_company=user.company_name or "")
    if debrief is not None and (content.get("ai_fallback") or not content.get("primary_need")):
        content = _relay_content_from_debrief(debrief, content)
    relay = Relay(
        user_id=user.id, call_id=call_log.id, prospect_name=meeting.prospect_name, prospect_email=meeting.prospect_email,
        prospect_business=meeting.company, summary=content.get("summary", ""), benefits=json.dumps(content.get("benefits", [])),
        primary_need=content.get("primary_need"), interest=content.get("interest"), concern=content.get("concern"),
        buyer_context=content.get("buyer_context"), problem_statement=content.get("problem_statement"),
        conversation_points=content.get("conversation_points"), impact=content.get("impact"),
        solution_approach=content.get("solution_approach"), next_step=content.get("next_step"),
        seller_name=seller_name, seller_company=user.company_name or "")
    db.add(relay)
    db.commit()
    db.refresh(relay)
    return {"relay_id": relay.id, "slug": relay.slug, "url": f"/relay/{relay.slug}", "status": relay.status,
            "existing": False, "ai_fallback": bool(content.get("ai_fallback"))}


def _relay_content_from_debrief(debrief: WizardDebrief, content: dict) -> dict:
    fields = {f.get("field"): f for f in (debrief.methodology_fields or []) if isinstance(f, dict)}
    pain = next((f.get("value") for key, f in fields.items() if key in ("identify_pain", "pain", "need", "problem") and f.get("value")), None)
    objections = [o.get("quote") for o in (debrief.objections or []) if isinstance(o, dict) and o.get("quote")]
    signals = [s.get("quote") for s in (debrief.buying_signals or []) if isinstance(s, dict) and s.get("quote")]
    points = []
    if debrief.summary:
        points.append(debrief.summary)
    for item in (debrief.action_items or [])[:3]:
        if isinstance(item, dict) and item.get("text"):
            points.append(item["text"])
    next_step = (debrief.next_step or {}).get("text") if isinstance(debrief.next_step, dict) else None
    return {
        **content,
        "ai_fallback": False,
        "primary_need": pain or content.get("primary_need") or "Discussed in the meeting; see summary.",
        "interest": (signals[0] if signals else content.get("interest")) or "",
        "concern": (objections[0] if objections else content.get("concern")) or "",
        "buyer_context": debrief.summary or content.get("buyer_context"),
        "problem_statement": pain or debrief.summary or content.get("problem_statement"),
        "conversation_points": json.dumps(points[:5] or json.loads(content.get("conversation_points") or "[]")),
        "next_step": next_step or content.get("next_step") or "Follow-up conversation",
    }


# ── Zoho CRM connector (env-gated) ───────────────────────────────────────────

ZOHO_SCOPES = "ZohoCRM.modules.contacts.ALL,ZohoCRM.modules.deals.ALL,ZohoCRM.modules.notes.ALL,ZohoCRM.modules.tasks.ALL"
ZOHO_UNCONFIGURED = ("Zoho CRM isn't configured on this server (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET). "
                     "Use the CRM webhook or the BCC address instead.")


class ZohoError(RuntimeError):
    """Human-readable Zoho failure."""


def _env(name: str) -> str:
    return (os.getenv(name) or "").strip()


def zoho_config() -> Optional[dict]:
    client_id, client_secret = _env("ZOHO_CLIENT_ID"), _env("ZOHO_CLIENT_SECRET")
    if not client_id or not client_secret:
        return None
    base = (_env("CLOZFLOW_WIZARD_OAUTH_REDIRECT_BASE") or "http://localhost:8000").rstrip("/")
    return {
        "client_id": client_id, "client_secret": client_secret,
        "accounts_domain": (_env("ZOHO_ACCOUNTS_DOMAIN") or "https://accounts.zoho.in").rstrip("/"),
        "api_domain": (_env("ZOHO_API_DOMAIN") or "https://www.zohoapis.in").rstrip("/"),
        "redirect_uri": f"{base}/api/wizard/integrations/zoho/callback",
    }


def zoho_auth_url(state: str) -> str:
    config = zoho_config()
    if not config:
        raise LookupError(ZOHO_UNCONFIGURED)
    params = {"scope": ZOHO_SCOPES, "client_id": config["client_id"], "response_type": "code", "access_type": "offline",
              "redirect_uri": config["redirect_uri"], "state": state, "prompt": "consent"}
    return f"{config['accounts_domain']}/oauth/v2/auth?{urlencode(params)}"


def _zoho_client() -> httpx.AsyncClient:
    """Outbound client for Zoho (patched in tests)."""
    return httpx.AsyncClient(timeout=15.0, trust_env=False)


async def zoho_exchange_code(code: str) -> dict:
    config = zoho_config()
    if not config:
        raise LookupError(ZOHO_UNCONFIGURED)
    data = {"grant_type": "authorization_code", "client_id": config["client_id"], "client_secret": config["client_secret"],
            "redirect_uri": config["redirect_uri"], "code": code}
    async with _zoho_client() as client:
        response = await client.post(f"{config['accounts_domain']}/oauth/v2/token", data=data)
    payload = response.json() if response.content else {}
    if response.status_code >= 400 or "access_token" not in payload:
        raise ZohoError("Zoho rejected the sign-in. Try connecting again.")
    payload["obtained_at"] = datetime.utcnow().isoformat() + "Z"
    payload.setdefault("api_domain", config["api_domain"])
    return payload


async def zoho_refresh(tokens: dict) -> dict:
    config = zoho_config()
    refresh = (tokens or {}).get("refresh_token")
    if not config or not refresh:
        raise ZohoError("Zoho CRM needs to be reconnected.")
    data = {"grant_type": "refresh_token", "client_id": config["client_id"], "client_secret": config["client_secret"],
            "refresh_token": refresh}
    async with _zoho_client() as client:
        response = await client.post(f"{config['accounts_domain']}/oauth/v2/token", data=data)
    payload = response.json() if response.content else {}
    if response.status_code >= 400 or "access_token" not in payload:
        raise ZohoError("Zoho CRM needs to be reconnected.")
    merged = {**tokens, **payload, "obtained_at": datetime.utcnow().isoformat() + "Z"}
    merged.setdefault("refresh_token", refresh)
    return merged


class ZohoSession:
    """Minimal Zoho CRM v8 client with one refresh-on-401."""

    def __init__(self, tokens: dict):
        self.tokens = dict(tokens or {})
        self.refreshed = False

    @property
    def api_domain(self) -> str:
        config = zoho_config() or {}
        return (self.tokens.get("api_domain") or config.get("api_domain") or "https://www.zohoapis.in").rstrip("/")

    async def request(self, client: httpx.AsyncClient, method: str, path: str, **kwargs) -> httpx.Response:
        headers = {"Authorization": f"Zoho-oauthtoken {self.tokens.get('access_token', '')}"}
        response = await client.request(method, f"{self.api_domain}{path}", headers=headers, **kwargs)
        if response.status_code == 401 and not self.refreshed:
            self.tokens = await zoho_refresh(self.tokens)
            self.refreshed = True
            headers["Authorization"] = f"Zoho-oauthtoken {self.tokens.get('access_token', '')}"
            response = await client.request(method, f"{self.api_domain}{path}", headers=headers, **kwargs)
        return response


def _first_record_id(payload: Any) -> Optional[str]:
    try:
        data = payload.get("data") or []
        item = data[0]
        details = item.get("details") or item
        return str(details.get("id")) if details.get("id") else None
    except (AttributeError, IndexError, TypeError):
        return None


def _zoho_search_criteria(field: str, value: str) -> str:
    cleaned = value.replace("(", "").replace(")", "").replace(",", " ")
    return f"({field}:equals:{cleaned})"


async def zoho_push(tokens: dict, meeting: WizardMeeting, rows: list[dict]) -> dict:
    """Write approved rows to Zoho: Contact (upsert by Email), Deal (search by Deal_Name, update or insert),
    Note (on the deal, else the contact) and Task (next step). Returns ids and per-object status."""
    session = ZohoSession(tokens)
    by_object: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row.get("approved", True) and row.get("object") and row.get("field"):
            by_object.setdefault(row["object"], {})[row["field"]] = row.get("proposed")
    result: dict[str, Any] = {"contact_id": None, "deal_id": None, "note_id": None, "task_id": None, "written": [], "errors": []}
    async with _zoho_client() as client:
        contact = by_object.get("contact")
        if contact:
            data = {k: v for k, v in contact.items() if v not in (None, "")}
            data.setdefault("Last_Name", (meeting.prospect_name or "Prospect").split()[-1])
            body = {"data": [data]}
            if data.get("Email"):
                body["duplicate_check_fields"] = ["Email"]
                response = await session.request(client, "POST", "/crm/v8/Contacts/upsert", json=body)
            else:
                response = await session.request(client, "POST", "/crm/v8/Contacts", json=body)
            if response.status_code < 300:
                result["contact_id"] = _first_record_id(response.json())
                result["written"].append("contact")
            else:
                result["errors"].append(f"contact: HTTP {response.status_code}")
        deal = by_object.get("deal")
        if deal:
            data = {k: v for k, v in deal.items() if v not in (None, "")}
            name = data.get("Deal_Name") or meeting.title or f"{meeting.company or meeting.prospect_name} - ClozFlow"
            data["Deal_Name"] = name
            if result["contact_id"]:
                data["Contact_Name"] = {"id": result["contact_id"]}
            search = await session.request(client, "GET", "/crm/v8/Deals/search", params={"criteria": _zoho_search_criteria("Deal_Name", name)})
            existing_id = _first_record_id(search.json()) if search.status_code == 200 and search.content else None
            if existing_id:
                response = await session.request(client, "PUT", f"/crm/v8/Deals/{existing_id}", json={"data": [data]})
            else:
                data.setdefault("Stage", "Qualification")
                response = await session.request(client, "POST", "/crm/v8/Deals", json={"data": [data]})
            if response.status_code < 300:
                result["deal_id"] = existing_id or _first_record_id(response.json())
                result["written"].append("deal")
            else:
                result["errors"].append(f"deal: HTTP {response.status_code}")
        note = by_object.get("note")
        if note and (result["deal_id"] or result["contact_id"]):
            module = "Deals" if result["deal_id"] else "Contacts"
            parent = result["deal_id"] or result["contact_id"]
            data = {"Note_Title": note.get("Note_Title") or f"ClozFlow meeting notes: {meeting.title or ''}".strip(),
                    "Note_Content": note.get("Note_Content") or "",
                    "Parent_Id": {"module": {"api_name": module}, "id": parent}}
            response = await session.request(client, "POST", "/crm/v8/Notes", json={"data": [data]})
            if response.status_code < 300:
                result["note_id"] = _first_record_id(response.json())
                result["written"].append("note")
            else:
                result["errors"].append(f"note: HTTP {response.status_code}")
        task = by_object.get("task")
        if task and task.get("Subject"):
            data = {"Subject": task["Subject"], "Status": "Not Started", "Priority": "High"}
            if task.get("Due_Date"):
                data["Due_Date"] = task["Due_Date"]
            if result["deal_id"]:
                data["What_Id"] = {"id": result["deal_id"]}
                data["$se_module"] = "Deals"
            elif result["contact_id"]:
                data["Who_Id"] = {"id": result["contact_id"]}
            response = await session.request(client, "POST", "/crm/v8/Tasks", json={"data": [data]})
            if response.status_code < 300:
                result["task_id"] = _first_record_id(response.json())
                result["written"].append("task")
            else:
                result["errors"].append(f"task: HTTP {response.status_code}")
    result["tokens"] = session.tokens if session.refreshed else None
    return result


# ── approve-before-write CRM diff ────────────────────────────────────────────

_ZOHO_STAGE = {
    "won": "Closed Won", "lost": "Closed Lost", "next_step_set": "Needs Analysis", "follow_up_needed": "Qualification",
    "no_show": "Qualification", "unclear": "Qualification",
}
_STAGE_REACHED = {"pricing": "Proposal/Price Quote", "close": "Negotiation/Review", "next_steps": "Needs Analysis",
                  "demo": "Needs Analysis", "discovery": "Qualification"}


def _field_evidence(debrief: Optional[WizardDebrief], *names: str) -> Optional[str]:
    for item in (debrief.methodology_fields if debrief else None) or []:
        if isinstance(item, dict) and item.get("field") in names and item.get("evidence_quote"):
            return item["evidence_quote"]
    return None


def build_crm_preview(meeting: WizardMeeting, debrief: Optional[WizardDebrief], integration: Optional[WizardIntegration],
                      previous: Optional[dict] = None) -> list[dict]:
    """``[{id, object, field, label, current, proposed, evidence_quote, approved}]`` for contact, deal, note, task.

    ``current`` is ClozFlow's last known value (the meeting row / the previous push); live CRM values
    are not fetched so the preview works for the webhook path too.
    """
    previous = previous or {}
    rows: list[dict] = []

    def add(obj: str, field: str, label: str, proposed: Any, evidence: Optional[str] = None, current: Any = None):
        if proposed in (None, "", [], {}):
            return
        key = f"{obj}.{field}"
        rows.append({"id": key, "object": obj, "field": field, "label": label, "current": previous.get(key, current),
                     "proposed": proposed, "evidence_quote": evidence, "approved": True})

    name = (meeting.prospect_name or "").strip()
    first, last = (name.split(" ", 1) + [""])[:2] if " " in name else ("", name)
    add("contact", "First_Name", "First name", first or None)
    add("contact", "Last_Name", "Last name", last or name or None)
    add("contact", "Email", "Email", meeting.prospect_email)
    add("contact", "Phone", "Phone", meeting.prospect_phone_e164)
    add("contact", "Account_Name", "Company", meeting.company)
    add("contact", "Title", "Role", meeting.role)

    deal_name = meeting.title or (f"{meeting.company or name} - {meeting.product_name}" if meeting.product_name else (meeting.company or name))
    add("deal", "Deal_Name", "Deal name", deal_name)
    outcome = debrief.outcome if debrief else None
    stage = (_STAGE_REACHED.get(debrief.stage_reached or "") if debrief else None) or _ZOHO_STAGE.get(outcome or "", "Qualification")
    if outcome in ("won", "lost"):
        stage = _ZOHO_STAGE[outcome]
    add("deal", "Stage", "Stage", stage)
    add("deal", "Amount", "Amount (INR)", meeting.deal_value_inr, _field_evidence(debrief, "budget", "metrics"))
    next_step = (debrief.next_step or {}) if debrief and isinstance(debrief.next_step, dict) else {}
    if next_step.get("text"):
        text = next_step["text"] + (f" ({next_step['date']})" if next_step.get("date") else "")
        add("deal", "Next_Step", "Next step", text[:250], next_step.get("evidence_quote"))
    if next_step.get("date"):
        add("deal", "Closing_Date", "Expected close", next_step["date"])
    if debrief and debrief.summary:
        lines = [debrief.summary]
        for item in (debrief.action_items or [])[:6]:
            if isinstance(item, dict) and item.get("text"):
                owner = item.get("owner") or "rep"
                lines.append(f"- [{owner}] {item['text']}" + (f" (due {item['due']})" if item.get("due") else ""))
        for obj in (debrief.objections or [])[:3]:
            if isinstance(obj, dict) and obj.get("quote"):
                lines.append(f"Objection ({obj.get('type') or 'general'}): \"{obj['quote']}\"")
        add("note", "Note_Title", "Note title", f"ClozFlow meeting notes: {meeting.title or name}".strip())
        add("note", "Note_Content", "Note", "\n".join(lines)[:32000])
    if next_step.get("text"):
        add("task", "Subject", "Task", f"Follow up: {next_step['text']}"[:200], next_step.get("evidence_quote"))
        add("task", "Due_Date", "Due", next_step.get("date"))
    return rows


def rows_to_webhook_payload(meeting: WizardMeeting, debrief: Optional[WizardDebrief], rows: list[dict]) -> dict:
    approved = [r for r in rows if r.get("approved", True)]
    flat = {f"{r['object']}.{r['field']}": r.get("proposed") for r in approved}
    return {
        "event": "meeting.debrief",
        "sent_at": datetime.utcnow().isoformat() + "Z",
        "meeting": {"id": meeting.id, "title": meeting.title, "prospect_name": meeting.prospect_name, "company": meeting.company,
                    "prospect_email": meeting.prospect_email, "prospect_phone": meeting.prospect_phone_e164,
                    "deal_value_inr": meeting.deal_value_inr, "deal_value_text": meeting.deal_value_text,
                    "methodology": meeting.methodology, "platform": meeting.platform,
                    "ended_at": meeting.ended_at.isoformat() + "Z" if meeting.ended_at else None},
        "debrief": {"summary": debrief.summary, "outcome": debrief.outcome, "next_step": debrief.next_step,
                    "deal_health": debrief.deal_health, "crm_payload": debrief.crm_payload} if debrief else None,
        "fields": flat,
        "rows": approved,
    }


def new_row_id() -> str:
    return uuid.uuid4().hex[:12]


def host_of(url: Optional[str]) -> Optional[str]:
    try:
        return urlsplit(url or "").hostname
    except ValueError:
        return None
