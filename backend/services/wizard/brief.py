"""Pre-call brief generation (spec §5.2) with a deterministic fallback.

``generate_brief(db, meeting)`` gathers inputs (capsule facts, lead, previous conversations,
knowledge facts, suggested battlecards, optional homepage enrichment), builds a complete
deterministic brief, then asks the LLM (``llm.generate_json``) to sharpen it in one call that
also produces the deal-tailored ``pre_rendered_cards`` (full spoken ``say`` text so Tier 0
matches are instant). Any LLM failure returns the deterministic brief with ``degraded: true``.

Never log transcript text or phone numbers.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from database import utc_isoformat
from models import CallLog, Capsule, Lead
from models_bridge import CopilotBridgeCall
from models_knowledge import KnowledgeFact
from models_wizard import WizardBattlecard, WizardDebrief, WizardMeeting
from services.transcript_manager import parse_transcript
from services.wizard import battlecards as cards_svc
from services.wizard import contracts, enrich, integrations, llm

logger = logging.getLogger(__name__)

BRIEF_TIMEOUT_S = 22.0
MAX_PRE_RENDERED = 5
MIN_PRE_RENDERED = 3

_TECH_HINTS = ("software", "saas", "technolog", "it services", "fintech", "bank", "consult", "startup", "cloud", "ai ", "analytics")
_HINGLISH_HINTS = ("ji", "bhai", "sahab", "sir ji", "kirana", "traders", "enterprises", "udyog", "stores", "agency", "mandir")


# ── language hint ────────────────────────────────────────────────────────────

def language_hint(meeting: WizardMeeting, lead: Optional[Lead] = None) -> str:
    """``"hinglish"`` by default for India; ``"en-IN"`` for clearly English-first buyers (tech firms, non-Indian numbers)."""
    phone = meeting.prospect_phone_e164 or (lead.phone_number if lead else None) or ""
    if phone.startswith("+") and not phone.startswith("+91"):
        return "en-IN"
    text = " ".join(filter(None, [meeting.company, meeting.industry, meeting.role, lead.category if lead else None])).lower()
    if any(h in text for h in _HINGLISH_HINTS):
        return "hinglish"
    if any(h in text for h in _TECH_HINTS):
        return "en-IN"
    role = (meeting.role or "").lower()
    if any(r in role for r in ("cto", "cio", "vp", "head of", "director", "engineer", "product")):
        return "en-IN"
    return "hinglish"


# ── inputs ───────────────────────────────────────────────────────────────────

def capsule_facts(capsule: Optional[Capsule]) -> list[dict]:
    """Verbatim fact rows the coach may quote (never paraphrased)."""
    if capsule is None:
        return []
    facts = []
    for label, value in (("Product", capsule.product_name), ("Price", capsule.product_price),
                         ("Key differentiators", capsule.key_differentiators), ("Pain points solved", capsule.pain_points_solved),
                         ("Target audience", capsule.target_audience), ("Specification", capsule.product_specification),
                         ("Additional context", capsule.additional_context)):
        if value and str(value).strip():
            facts.append({"label": label, "value": str(value).strip()[:1500], "source": f"capsule:{capsule.id}"})
    return facts


def _split_points(text: Optional[str], limit: int = 5) -> list[str]:
    if not text:
        return []
    parts = re.split(r"[\n;•]+|(?<=[.!?])\s+(?=[A-Z])", text)
    return [p.strip(" -*\t") for p in parts if len(p.strip()) > 3][:limit]


def _history(db: Session, meeting: WizardMeeting) -> dict:
    """Previous conversations with the same prospect/company (case-insensitive), summarised without transcript text."""
    names = [n.strip().lower() for n in (meeting.prospect_name, meeting.company) if n and n.strip()]
    if not names:
        return {"has_history": False, "count": 0, "last_meeting_at": None, "summaries": [], "open_items": [], "quotes": []}
    conditions = []
    for name in names:
        conditions.append(func.lower(WizardMeeting.prospect_name) == name)
        conditions.append(func.lower(WizardMeeting.company) == name)
    prior = (db.query(WizardMeeting)
             .filter(WizardMeeting.user_id == meeting.user_id, WizardMeeting.id != meeting.id, or_(*conditions),
                     WizardMeeting.status.in_(["ended", "debriefed"]))
             .order_by(WizardMeeting.ended_at.desc().nullslast(), WizardMeeting.created_at.desc()).limit(5).all())
    summaries, open_items, last_at, call_log_ids = [], [], None, []
    for row in prior:
        last_at = last_at or row.ended_at or row.started_at or row.created_at
        debrief = db.query(WizardDebrief).filter(WizardDebrief.meeting_id == row.id).first()
        if debrief and debrief.summary:
            summaries.append({"when": utc_isoformat(row.ended_at or row.created_at), "summary": debrief.summary,
                              "outcome": debrief.outcome, "next_step": debrief.next_step})
            for item in debrief.action_items or []:
                if isinstance(item, dict) and item.get("text") and not item.get("done"):
                    open_items.append(item["text"])
            if isinstance(debrief.next_step, dict) and debrief.next_step.get("text"):
                open_items.append("Agreed next step: " + debrief.next_step["text"])
        if row.call_log_id:
            call_log_ids.append(row.call_log_id)
    bridge_conditions = [func.lower(CopilotBridgeCall.prospect_name) == n for n in names]
    bridge_calls = (db.query(CopilotBridgeCall)
                    .filter(CopilotBridgeCall.user_id == meeting.user_id, or_(*bridge_conditions),
                            CopilotBridgeCall.call_log_id.isnot(None))
                    .order_by(CopilotBridgeCall.created_at.desc()).limit(5).all())
    for call in bridge_calls:
        if call.call_log_id not in call_log_ids:
            call_log_ids.append(call.call_log_id)
            last_at = last_at or call.ended_at or call.created_at
    if hasattr(CallLog, "prospect_name"):
        extra = (db.query(CallLog)
                 .filter(CallLog.user_id == meeting.user_id, func.lower(CallLog.prospect_name).in_(names))
                 .order_by(CallLog.timestamp.desc()).limit(5).all())
        for log in extra:
            if log.id not in call_log_ids:
                call_log_ids.append(log.id)
                last_at = last_at or log.timestamp
    quotes: list[str] = []
    for log_id in call_log_ids[:3]:
        log = db.get(CallLog, log_id)
        if not log:
            continue
        for entry in parse_transcript(log.transcript):
            if entry["speaker"] in ("prospect", "buyer") and 30 <= len(entry["text"]) <= 220:
                quotes.append(entry["text"])
            if len(quotes) >= 6:
                break
    count = len(prior) + len([c for c in call_log_ids if c not in {p.call_log_id for p in prior}])
    return {"has_history": count > 0, "count": count, "last_meeting_at": utc_isoformat(last_at) if last_at else None,
            "summaries": summaries[:3], "open_items": list(dict.fromkeys(open_items))[:6], "quotes": quotes[:6]}


def _knowledge(db: Session, meeting: WizardMeeting) -> list[dict]:
    query = db.query(KnowledgeFact).filter(KnowledgeFact.user_id == meeting.user_id,
                                           KnowledgeFact.approval_status == "approved")
    if meeting.capsule_id:
        query = query.filter(or_(KnowledgeFact.capsule_id == meeting.capsule_id, KnowledgeFact.capsule_id.is_(None)))
    rows = query.order_by(KnowledgeFact.confidence.desc()).limit(40).all()
    tokens = {t for t in re.split(r"[^a-z0-9]+", " ".join(filter(None, [meeting.industry, meeting.objective, meeting.company])).lower()) if len(t) > 3}
    scored = []
    for row in rows:
        text = f"{row.field_name} {row.value}".lower()
        hits = sum(1 for t in tokens if t in text)
        priority = 2 if row.category in ("product", "sales") else 1
        scored.append((hits * 2 + priority, row))
    scored.sort(key=lambda item: -item[0])
    return [{"field": r.field_name, "value": (r.value or "")[:300], "category": r.category, "source": r.source_url}
            for _, r in scored[:8]]


async def collect_inputs(db: Session, meeting: WizardMeeting) -> dict:
    capsule = db.get(Capsule, meeting.capsule_id) if meeting.capsule_id else None
    if capsule is not None and capsule.user_id != meeting.user_id:
        capsule = None
    lead = db.get(Lead, meeting.lead_id) if meeting.lead_id else None
    if lead is not None and lead.user_id not in (None, meeting.user_id):
        lead = None
    suggested = cards_svc.suggest_for_meeting(db, meeting, limit=10)
    selected = cards_svc.cards_by_ids(db, meeting.user_id, meeting.battlecard_ids or [])
    enrichment = None
    try:
        enrichment = await enrich.enrich_company(meeting.company, lead.website if lead else None)
    except Exception:  # noqa: BLE001 - enrichment is optional
        enrichment = None
    all_cards = cards_svc.visible_cards(db, meeting.user_id)
    return {
        "capsule": capsule, "capsule_facts": capsule_facts(capsule), "lead": lead, "history": _history(db, meeting),
        "knowledge": _knowledge(db, meeting), "suggested": suggested, "selected": selected, "enrichment": enrichment,
        "language": language_hint(meeting, lead), "all_cards": all_cards,
    }


# ── deterministic brief ──────────────────────────────────────────────────────

_HYPOTHESES = [
    ("Follow-ups depend on someone remembering, so leads go cold between conversations.",
     "Walk me through what happens after a new enquiry comes in: who follows up, and when does it slip?"),
    ("The current process costs more in people's time than anyone has measured.",
     "Roughly how many hours a week go into this today, and whose hours are they?"),
    ("The decision will involve the owner or finance even if today's contact runs the evaluation.",
     "Who besides you will want to see this before it goes ahead, and what will they check first?"),
    ("A previous tool or vendor disappointed them, so proof and risk reversal matter more than features.",
     "What have you tried before for this, and what made you stop?"),
    ("Timing is tied to the financial year or the festive season rather than to the problem itself.",
     "Is there a date by which you want this working, and what is driving that date?"),
]

_AGENDA = ["Up-front contract: purpose, time, and what a good outcome looks like for both of us (2 min)",
           "Their current process and the 2–3 problems that matter most (10 min)",
           "Quantify one problem in INR or hours; agree the baseline (5 min)",
           "Show only the workflow that maps to the stated problem (8 min)",
           "Budget, who decides, and the pricing conversation (3 min)",
           "Agree a dated next step with the right people on the invite (2 min)"]

_PRE_RENDER_KINDS = ("objection", "india_context", "competitive", "persona", "closing")


def _pick_pre_render_cards(inputs: dict, meeting: WizardMeeting) -> list[tuple[WizardBattlecard, str]]:
    """Top 3–5 cards for Tier 0: selected cards first, then the best-scoring objection/India/competitive cards."""
    chosen: list[tuple[WizardBattlecard, str]] = []
    seen: set[str] = set()
    for card in inputs["selected"]:
        if card.kind in _PRE_RENDER_KINDS and card.id not in seen:
            chosen.append((card, "picked for this meeting"))
            seen.add(card.id)
    for card, _score, why in inputs["suggested"]:
        if len(chosen) >= MAX_PRE_RENDERED:
            break
        if card.kind in _PRE_RENDER_KINDS and card.id not in seen:
            chosen.append((card, why))
            seen.add(card.id)
    if len(chosen) < MIN_PRE_RENDERED:
        for card, _score, why in inputs["suggested"]:
            if len(chosen) >= MIN_PRE_RENDERED:
                break
            if card.id not in seen:
                chosen.append((card, why))
                seen.add(card.id)
    return chosen[:MAX_PRE_RENDERED]


def _methodology_fields(meeting: WizardMeeting, history: dict) -> list[dict]:
    fields = contracts.METHODOLOGIES.get(meeting.methodology or "meddpicc", contracts.METHODOLOGIES["none"])
    known: dict[str, str] = {}
    for summary in history.get("summaries", []):
        pass  # debrief summaries don't carry field values; coverage comes from the previous debrief fields below
    result = []
    for field, label in fields:
        value = known.get(field)
        status = "known" if value else "unknown"
        if field in ("metrics", "budget") and meeting.deal_value_inr:
            status, value = "partial", f"Deal value noted: {meeting.deal_value_text or meeting.deal_value_inr}"
        if field in ("economic_buyer", "authority", "decision_maker") and meeting.role:
            role = meeting.role.lower()
            if any(r in role for r in ("founder", "owner", "md", "ceo", "director", "proprietor", "partner")):
                status, value = "partial", f"{meeting.prospect_name or 'Contact'} is {meeting.role}: likely the economic buyer; confirm."
            else:
                status, value = "partial", f"{meeting.prospect_name or 'Contact'} is {meeting.role}: probably not the final approver."
        result.append({"field": field, "label": label, "status": status, "value": value})
    return result


def deterministic_brief(meeting: WizardMeeting, inputs: dict) -> dict:
    name = meeting.prospect_name or "the prospect"
    company = meeting.company or "their company"
    history = inputs["history"]
    facts = inputs["capsule_facts"]
    product = meeting.product_name or next((f["value"] for f in facts if f["label"] == "Product"), None)
    price = meeting.product_price or next((f["value"] for f in facts if f["label"] == "Price"), None)
    lang = inputs["language"]
    objective = (meeting.objective or "").strip() or f"Understand how {company} handles the problem today, quantify it, and agree a dated next step."
    decision_maker_hint = "the owner or finance" if lang == "hinglish" else "the economic buyer"
    sources = [{"kind": "manual", "label": "Meeting form"}]
    if facts:
        sources.append({"kind": "capsule", "label": f"Capsule: {inputs['capsule'].name}" if inputs.get("capsule") else "Product capsule"})
    if inputs["lead"]:
        sources.append({"kind": "lead", "label": f"Lead Finder: {inputs['lead'].business_name}"})
    if history["has_history"]:
        sources.append({"kind": "history", "label": f"{history['count']} previous conversation(s)"})
    if inputs["knowledge"]:
        sources.append({"kind": "knowledge", "label": f"{len(inputs['knowledge'])} knowledge fact(s)"})
    if inputs["enrichment"]:
        sources.append({"kind": "lead", "label": f"Website: {inputs['enrichment']['domain']}"})

    likely = []
    for card, _score, why in inputs["suggested"]:
        if card.kind in ("objection", "india_context", "competitive", "persona") and len(likely) < 5:
            evidence = why
            if history["quotes"] and card.kind == "objection":
                hit = cards_svc.match_triggers(" ".join(history["quotes"]), [card])
                if hit:
                    evidence = f"Raised before: \"{hit[0][1]}\" came up in an earlier conversation."
            likely.append({"battlecard_id": card.id, "title": card.title, "why_likely": why, "evidence": evidence})

    hypotheses = []
    for statement, question in _HYPOTHESES[:3]:
        hypotheses.append({"hypothesis": statement, "question": question})
    if inputs["lead"] and inputs["lead"].likely_pain_point:
        hypotheses.insert(0, {"hypothesis": inputs["lead"].likely_pain_point[:200],
                              "question": "You mentioned this earlier: is it still the biggest headache, or has something else overtaken it?"})
    hypotheses = hypotheses[:4]

    proof_points = _split_points(next((f["value"] for f in facts if f["label"] == "Key differentiators"), None), 3)
    for item in inputs["knowledge"][:3]:
        if item["value"]:
            proof_points.append(f"{item['field']}: {item['value'][:140]}")
    if not proof_points:
        proof_points.append("Add key differentiators to the product capsule so the coach can cite them with a source chip.")

    risks = []
    if not meeting.role or not any(r in (meeting.role or "").lower() for r in ("founder", "owner", "md", "ceo", "director", "proprietor")):
        risks.append({"text": f"No economic buyer identified yet; {name} may not be the final approver.", "severity": "medium"})
    if not meeting.deal_value_inr:
        risks.append({"text": "No deal value or budget known; raise budget on this call (Gong: 49% vs 7% win rate).", "severity": "medium"})
    if not history["has_history"]:
        risks.append({"text": "First conversation on record: expect trust questions and a free-trial ask.", "severity": "low"})
    if not facts:
        risks.append({"text": "No product capsule attached: the coach cannot quote prices or features safely.", "severity": "high"})
    if history["open_items"]:
        risks.append({"text": f"{len(history['open_items'])} open item(s) from earlier conversations; address them first.", "severity": "medium"})

    pricing = []
    if price:
        pricing.append(f"Quote only the capsule price: {price}. Say whether GST (18%) is included.")
    else:
        pricing.append("No price in the capsule: do not quote a number; promise a written quote after the call.")
    pricing.append("Raise budget in the last third of the call, after the problem is quantified; expect a 20–30% negotiation ritual and trade, don't cut.")

    opener = (f"Thanks for the time, {name.split()[0] if name != 'the prospect' else ''}. We have about thirty minutes: I'd like to understand how {company} "
              f"handles this today, show you one relevant thing, and by the end agree whether a next step makes sense, and no is a fine answer. Does that work?").replace(" ,", ",").replace("  ", " ")

    recap_summary = (f"{history['count']} previous conversation(s), the last on {history['last_meeting_at'][:10]}."
                     if history["has_history"] and history["last_meeting_at"] else
                     (f"{history['count']} previous conversation(s) on record." if history["has_history"] else "Nothing on file yet: this is the first conversation we have recorded."))
    if history["summaries"]:
        recap_summary += " Last time: " + history["summaries"][0]["summary"]

    consent_mode = "bridge_disclosure" if meeting.channel == "phone_bridge" else ("in_invite" if (meeting.consent or {}).get("mode") == "in_invite" else "announced")
    scripts = integrations.consent_scripts(None)
    pre_rendered = [cards_svc.pre_rendered(card, why=why, say_lang=lang) for card, why in _pick_pre_render_cards(inputs, meeting)]
    attendee_notes = []
    if inputs["lead"]:
        lead = inputs["lead"]
        attendee_notes.append(f"Lead Finder: {lead.category or ''} {('in ' + lead.city) if lead.city else ''}".strip())
        if lead.ai_summary:
            attendee_notes.append(lead.ai_summary[:240])
    if inputs["enrichment"]:
        enr = inputs["enrichment"]
        attendee_notes.append(f"Website: {enr.get('title') or enr['domain']}" + (f" — {enr['description']}" if enr.get("description") else ""))
    return {
        "objective": objective,
        "home_run": f"A dated next step with {decision_maker_hint} on the invite, plus one quantified problem in INR per month.",
        "backup_next_step": f"A 20-minute walkthrough for {decision_maker_hint} next week, or a scoped pilot with a success metric and a decision date.",
        "attendee": {"name": meeting.prospect_name, "role": meeting.role, "company": meeting.company, "notes": " ".join(attendee_notes)[:600] or None},
        "recap": {"has_history": history["has_history"], "summary": recap_summary, "open_items": history["open_items"],
                  "last_meeting_at": history["last_meeting_at"]},
        "hypotheses": hypotheses,
        "agenda": _AGENDA,
        "likely_objections": likely,
        "pricing_posture": " ".join(pricing),
        "proof_points": proof_points[:5],
        "risks": risks[:5],
        "opener": opener,
        "methodology": {"name": meeting.methodology or "meddpicc", "fields": _methodology_fields(meeting, history)},
        "sources": sources,
        "pre_rendered_cards": pre_rendered,
        "consent": {"script": scripts["hi"] if (lang == "hinglish" and consent_mode != "bridge_disclosure") else scripts["en"],
                    "script_en": scripts["en"], "script_hi": scripts["hi"], "mode_hint": consent_mode},
        "prospect_language_hint": lang,
        "product": {"name": product, "price": price},
        "generated_by": "template",
    }


# ── LLM pass ─────────────────────────────────────────────────────────────────

BRIEF_SCHEMA = {
    "type": "object",
    "required": ["objective", "home_run", "backup_next_step", "hypotheses", "agenda", "likely_objections", "pricing_posture",
                 "proof_points", "risks", "opener", "pre_rendered_cards"],
    "properties": {
        "objective": {"type": "string"}, "home_run": {"type": "string"}, "backup_next_step": {"type": "string"},
        "attendee_notes": {"type": ["string", "null"]},
        "recap_summary": {"type": ["string", "null"]},
        "hypotheses": {"type": "array", "maxItems": 5, "items": {"type": "object", "required": ["hypothesis", "question"],
                       "properties": {"hypothesis": {"type": "string"}, "question": {"type": "string"}}}},
        "agenda": {"type": "array", "maxItems": 8, "items": {"type": "string"}},
        "likely_objections": {"type": "array", "maxItems": 6, "items": {"type": "object", "required": ["battlecard_id", "title", "why_likely"],
                              "properties": {"battlecard_id": {"type": "string"}, "title": {"type": "string"},
                                             "why_likely": {"type": "string"}, "evidence": {"type": ["string", "null"]}}}},
        "pricing_posture": {"type": "string"},
        "proof_points": {"type": "array", "maxItems": 6, "items": {"type": "string"}},
        "risks": {"type": "array", "maxItems": 6, "items": {"type": "object", "required": ["text", "severity"],
                  "properties": {"text": {"type": "string"}, "severity": {"type": "string", "enum": ["low", "medium", "high"]}}}},
        "opener": {"type": "string"},
        "methodology_fields": {"type": "array", "items": {"type": "object", "required": ["field", "status"],
                               "properties": {"field": {"type": "string"}, "status": {"type": "string", "enum": ["unknown", "partial", "known"]},
                                              "value": {"type": ["string", "null"]}}}},
        "pre_rendered_cards": {"type": "array", "maxItems": 6, "items": {"type": "object", "required": ["battlecard_id", "headline", "say"],
                               "properties": {"battlecard_id": {"type": "string"}, "headline": {"type": "string"}, "say": {"type": "string"},
                                              "then_ask": {"type": ["string", "null"]}, "extra_trigger_keywords": {"type": "array", "items": {"type": "string"}}}}},
    },
}

SYSTEM_PROMPT = """You are ClozFlow's pre-call strategist for Indian B2B sales reps. You turn deal context into a one-page brief a rep reads in two minutes, and you pre-write the exact words the rep will say when a likely objection comes up live.

Rules:
- Never invent prices, discounts, features, certifications or integrations. Only state facts that appear verbatim in CAPSULE FACTS or KNOWLEDGE FACTS; otherwise say the rep should confirm.
- Hypotheses are specific to this company and industry, each with one complete discovery question.
- likely_objections must reference battlecard_id values from the AVAILABLE BATTLECARDS list only.
- pre_rendered_cards: for each listed CARD TO PRE-RENDER write `say`: 2–3 complete, natural spoken sentences (25–60 words) the rep can read aloud verbatim to this prospect, tailored to this deal (company, industry, role, stated objective). Plain Indian English when LANGUAGE is en-IN; Hinglish in Latin script when LANGUAGE is hinglish. No bullet points, no corporate tone, no "As an AI". `then_ask` is one complete question sentence. `headline` is at most 6 words.
- Keep the rep's voice confident, warm and direct. Short sentences. No jargon.
- Output only the JSON object described."""


def _render_inputs_for_llm(meeting: WizardMeeting, inputs: dict, draft: dict, cards: list[tuple[WizardBattlecard, str]]) -> str:
    lines = [
        "MEETING",
        f"- Title: {meeting.title or '-'}", f"- Prospect: {meeting.prospect_name or '-'} ({meeting.role or 'role unknown'}) at {meeting.company or '-'}",
        f"- Industry: {meeting.industry or '-'}", f"- Deal value: {meeting.deal_value_text or meeting.deal_value_inr or 'unknown'} (INR)",
        f"- Objective: {meeting.objective or '-'}", f"- Methodology: {meeting.methodology}", f"- Platform/channel: {meeting.platform}/{meeting.channel}",
        f"- LANGUAGE: {inputs['language']}",
        "", "CAPSULE FACTS (verbatim; the only numbers you may use)",
    ]
    lines += [f"- {f['label']}: {f['value']}" for f in inputs["capsule_facts"]] or ["- none"]
    lines += ["", "KNOWLEDGE FACTS"] + ([f"- {k['field']}: {k['value']}" for k in inputs["knowledge"]] or ["- none"])
    lead = inputs["lead"]
    if lead:
        lines += ["", "LEAD FINDER", f"- {lead.business_name} | {lead.category or ''} | {lead.city or ''} | rating {lead.google_rating or '-'}",
                  f"- Likely pain: {lead.likely_pain_point or '-'}", f"- Summary: {(lead.ai_summary or '-')[:400]}"]
    if inputs["enrichment"]:
        lines += ["", "WEBSITE", f"- {inputs['enrichment'].get('title') or ''}: {inputs['enrichment'].get('description') or ''}"]
    history = inputs["history"]
    lines += ["", "HISTORY", f"- {draft['recap']['summary']}"]
    for item in history["open_items"][:5]:
        lines.append(f"- Open item: {item}")
    for quote in history["quotes"][:5]:
        lines.append(f"- Prospect said earlier: \"{quote}\"")
    lines += ["", "AVAILABLE BATTLECARDS (id | title | kind | trigger)"]
    for card, _score, _why in inputs["suggested"]:
        lines.append(f"- {card.id} | {card.title} | {card.kind} | {card.trigger_description or ''}")
    lines += ["", "CARDS TO PRE-RENDER (write deal-tailored `say` for each; base text shown)"]
    for card, why in cards:
        base = card.act_hinglish if inputs["language"] == "hinglish" and card.act_hinglish else card.act
        lines.append(f"- {card.id} | {card.title} | why: {why}\n  base: {base}\n  ask: {card.question_to_ask or ''}\n  do_not: {card.do_not or ''}")
    lines += ["", "DRAFT BRIEF (improve it; keep what is right)",
              f"- objective: {draft['objective']}", f"- home_run: {draft['home_run']}", f"- opener: {draft['opener']}",
              f"- pricing_posture: {draft['pricing_posture']}"]
    return "\n".join(lines)


def _merge_llm(draft: dict, data: dict, inputs: dict, cards: list[tuple[WizardBattlecard, str]]) -> dict:
    brief = dict(draft)
    all_cards = inputs.get("all_cards") or [card for card, _s, _w in inputs["suggested"]]
    known_ids = {c.id for c in all_cards} | {card.id for card in inputs["selected"]} | {c.id for c, _ in cards}
    title_to_id = {c.title.lower(): c.id for c in all_cards}
    for key in ("objective", "home_run", "backup_next_step", "pricing_posture", "opener"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            brief[key] = value.strip()
    if isinstance(data.get("attendee_notes"), str) and data["attendee_notes"].strip():
        brief["attendee"] = {**brief["attendee"], "notes": data["attendee_notes"].strip()[:600]}
    if isinstance(data.get("recap_summary"), str) and data["recap_summary"].strip() and inputs["history"]["has_history"]:
        brief["recap"] = {**brief["recap"], "summary": data["recap_summary"].strip()[:600]}
    if data.get("hypotheses"):
        brief["hypotheses"] = [{"hypothesis": h["hypothesis"].strip(), "question": h["question"].strip()} for h in data["hypotheses"] if h.get("hypothesis") and h.get("question")][:5] or brief["hypotheses"]
    if data.get("agenda"):
        brief["agenda"] = [a.strip() for a in data["agenda"] if isinstance(a, str) and a.strip()][:8] or brief["agenda"]
    objections = []
    for item in data.get("likely_objections") or []:
        card_id = item.get("battlecard_id")
        if card_id not in known_ids:
            card_id = title_to_id.get((item.get("title") or "").lower())
        if not card_id:
            continue
        objections.append({"battlecard_id": card_id, "title": item.get("title") or card_id, "why_likely": item.get("why_likely") or "",
                           "evidence": item.get("evidence")})
    if objections:
        brief["likely_objections"] = objections[:6]
    if data.get("proof_points"):
        brief["proof_points"] = [p.strip() for p in data["proof_points"] if isinstance(p, str) and p.strip()][:6] or brief["proof_points"]
    if data.get("risks"):
        brief["risks"] = [{"text": r["text"].strip(), "severity": r.get("severity") or "medium"} for r in data["risks"] if r.get("text")][:6] or brief["risks"]
    if data.get("methodology_fields"):
        by_field = {f["field"]: f for f in data["methodology_fields"] if isinstance(f, dict) and f.get("field")}
        for entry in brief["methodology"]["fields"]:
            update = by_field.get(entry["field"])
            if update:
                entry["status"] = update.get("status") or entry["status"]
                if update.get("value"):
                    entry["value"] = str(update["value"])[:300]
    # pre-rendered cards: validate `say` length; fall back to the card's own text
    by_card = {card.id: (card, why) for card, why in cards}
    rendered = []
    for item in data.get("pre_rendered_cards") or []:
        card_why = by_card.get(item.get("battlecard_id"))
        if not card_why:
            continue
        card, why = card_why
        say = (item.get("say") or "").strip()
        words = len(say.split())
        if not (contracts.SAY_MIN_WORDS <= words <= contracts.SAY_MAX_WORDS):
            say = None
        then_ask = (item.get("then_ask") or "").strip() or None
        if then_ask and (len(then_ask.split()) > contracts.THEN_ASK_MAX_WORDS or not then_ask.endswith("?")):
            then_ask = None
        headline = contracts.clamp_words((item.get("headline") or "").strip(), contracts.HEADLINE_MAX_WORDS) or None
        entry = cards_svc.pre_rendered(card, why=why, say_lang=inputs["language"], say=say, then_ask=then_ask, headline=headline)
        extra = [k.strip().lower() for k in item.get("extra_trigger_keywords") or [] if isinstance(k, str) and 2 <= len(k.strip()) <= 40]
        entry["trigger_keywords"] = list(dict.fromkeys(entry["trigger_keywords"] + extra))[:12]
        entry["tailored"] = say is not None
        rendered.append(entry)
    covered = {r["battlecard_id"] for r in rendered}
    for card, why in cards:
        if card.id not in covered:
            rendered.append(cards_svc.pre_rendered(card, why=why, say_lang=inputs["language"]))
    brief["pre_rendered_cards"] = rendered[:MAX_PRE_RENDERED]
    brief["generated_by"] = "llm"
    return brief


# ── entry point ──────────────────────────────────────────────────────────────

async def generate_brief(db: Session, meeting: WizardMeeting, *, force: bool = False) -> dict:
    """Generate (or return the cached) brief; returns ``{brief, battlecards, generated_at, degraded, model}``."""
    if meeting.brief and not force:
        cards = cards_svc.cards_by_ids(db, meeting.user_id, meeting.battlecard_ids or [])
        return {"brief": meeting.brief, "battlecards": [cards_svc.serialize(c) for c in cards],
                "generated_at": utc_isoformat(meeting.brief_generated_at), "degraded": bool(meeting.brief.get("degraded")),
                "model": meeting.brief.get("model"), "cached": True}
    inputs = await collect_inputs(db, meeting)
    draft = deterministic_brief(meeting, inputs)
    cards = _pick_pre_render_cards(inputs, meeting)
    brief, degraded, model = draft, True, None
    if llm.is_configured():
        try:
            data = await llm.generate_json(SYSTEM_PROMPT, _render_inputs_for_llm(meeting, inputs, draft, cards), BRIEF_SCHEMA,
                                           max_tokens=2200, timeout=BRIEF_TIMEOUT_S, temperature=0.35)
            brief = _merge_llm(draft, data, inputs, cards)
            degraded, model = False, llm.describe().get("model")
        except llm.LLMUnavailable as exc:
            logger.info("wizard brief: LLM unavailable, using template (%s)", type(exc).__name__)
        except Exception as exc:  # noqa: BLE001 - never fail the request because of the model
            logger.warning("wizard brief: unexpected %s, using template", type(exc).__name__)
    brief["degraded"] = degraded
    brief["model"] = model
    now = datetime.utcnow()
    brief["generated_at"] = utc_isoformat(now)
    auto_ids = [o["battlecard_id"] for o in brief.get("likely_objections", [])] + [c["battlecard_id"] for c in brief.get("pre_rendered_cards", [])]
    merged_ids = list(dict.fromkeys((meeting.battlecard_ids or []) + auto_ids))
    meeting.brief = brief
    meeting.brief_generated_at = now
    meeting.battlecard_ids = merged_ids
    if not meeting.product_name and inputs["capsule"] is not None:
        meeting.product_name = inputs["capsule"].product_name
        meeting.product_price = inputs["capsule"].product_price
        meeting.product_specification = inputs["capsule"].product_specification
    if meeting.status in ("planned", "ready"):
        meeting.status = "ready"
    meeting.updated_at = now
    db.commit()
    db.refresh(meeting)
    cards_rows = cards_svc.cards_by_ids(db, meeting.user_id, merged_ids)
    return {"brief": brief, "battlecards": [cards_svc.serialize(c) for c in cards_rows], "generated_at": brief["generated_at"],
            "degraded": degraded, "model": model, "cached": False}


# ── rehearsal (spec §4 /rehearse) ────────────────────────────────────────────

REHEARSE_SCHEMA = {
    "type": "object", "required": ["reply"],
    "properties": {"reply": {"type": "string"}, "hint_headline": {"type": ["string", "null"]}, "hint_say": {"type": ["string", "null"]},
                   "hint_then_ask": {"type": ["string", "null"]}, "hint_battlecard_id": {"type": ["string", "null"]}, "moment": {"type": ["string", "null"]}},
}

REHEARSE_SYSTEM = """You role-play the PROSPECT in a sales rehearsal for an Indian B2B rep. Stay in character: use the persona, industry and likely objections from the brief; be realistic, a little guarded, never cartoonish; one to three sentences per reply, in the LANGUAGE given (Hinglish in Latin script when hinglish). Raise one of the likely objections naturally when it fits; soften when the rep handles it well.
Also act as a sparse coach: if (and only if) the rep's last message mishandled something or an objection is now on the table, fill hint_headline (≤ 6 words), hint_say (25–60 words the rep could say next, in LANGUAGE), hint_then_ask (one question) and hint_battlecard_id from the available ids; otherwise set them to null. Output only JSON."""


def _fallback_prospect_reply(meeting: WizardMeeting, messages: list[dict], brief: Optional[dict], cards: list[WizardBattlecard],
                             all_cards: Optional[list[WizardBattlecard]] = None) -> dict:
    turns = len([m for m in messages if m.get("role") == "rep"])
    lang = (brief or {}).get("prospect_language_hint") or "en-IN"
    likely = (brief or {}).get("likely_objections") or []
    rep_text = next((m.get("text", "") for m in reversed(messages) if m.get("role") == "rep"), "")
    hint = None
    pool = [c for c in (all_cards or cards) if cards_svc.moment_for(c) in ("objection", "pricing", "competitor", "stall")]
    hits = cards_svc.match_triggers(rep_text, cards) or cards_svc.match_triggers(rep_text, pool) if rep_text else []
    if hits:
        card, _kw = hits[0]
        pre = cards_svc.pre_rendered(card, say_lang=lang)
        hint = {"id": f"rehearse-{turns}", "moment": pre["moment"], "priority": "normal", "headline": pre["headline"], "say": pre["say"],
                "then_ask": pre["then_ask"], "detail": card.do_not, "say_lang": pre["say_lang"], "say_words": pre["say_words"],
                "battlecard_id": card.id, "sources": [{"kind": "battlecard", "label": card.title, "ref": card.id}], "confidence": 0.6,
                "ttl_ms": contracts.CARD_TTL_MS, "turn_index": turns, "trigger": "auto", "latency_ms": 0,
                "created_at": contracts.utc_now_iso(), "tier": 0, "provisional": False, "revision": 1, "late": False, "cue": None}
    scripts_en = [
        f"Hi, yes, I have about twenty minutes. We are managing with what we have at {meeting.company or 'our place'} for now, so what exactly is this about?",
        "Honestly it sounds expensive for a business our size. What would we actually get for that money?",
        "We tried a tool like this two years ago and nobody used it after the first month. Why would this be different?",
        "I would need to check with my MD before anything moves. Can you just send me the details on email?",
        "Okay, that is fair. If we did a small pilot, what would it need from my team and when would we decide?",
    ]
    scripts_hi = [
        f"Haan ji, bees minute hain mere paas. Abhi toh {meeting.company or 'hamare yahan'} kaam chal raha hai jo hai usse, toh yeh exactly kya hai?",
        "Sach kahun toh hamare size ke business ke liye yeh mehenga lagta hai. Is paise ke liye humein actually kya milega?",
        "Do saal pehle humne aisa ek tool try kiya tha, pehle mahine ke baad kisi ne use nahi kiya. Yeh alag kyun hoga?",
        "Mujhe MD sahab se poochna padega kuch bhi aage badhane se pehle. Aap details email kar dijiye?",
        "Theek hai, yeh fair hai. Agar chhota pilot karein toh meri team se kya chahiye hoga aur kab decide karenge?",
    ]
    scripts = scripts_hi if lang == "hinglish" else scripts_en
    if likely and turns == 1:
        reply = scripts[1] if any("price" in (o.get("battlecard_id") or "") for o in likely) else scripts[0]
    else:
        reply = scripts[min(turns, len(scripts) - 1)] if turns < len(scripts) else scripts[-1]
    return {"reply": reply, "hint": hint}


async def rehearse(db: Session, meeting: WizardMeeting, messages: list[dict]) -> dict:
    brief = meeting.brief or {}
    cards = cards_svc.cards_by_ids(db, meeting.user_id, meeting.battlecard_ids or []) or [c for c, _s, _w in cards_svc.suggest_for_meeting(db, meeting, limit=6)]
    fallback = _fallback_prospect_reply(meeting, messages, brief, cards, cards_svc.visible_cards(db, meeting.user_id))
    if not llm.is_configured():
        return {**fallback, "degraded": True}
    lang = brief.get("prospect_language_hint") or language_hint(meeting)
    persona = [f"PROSPECT: {meeting.prospect_name or 'Prospect'}, {meeting.role or 'decision influencer'} at {meeting.company or 'a company'} ({meeting.industry or 'industry unknown'})",
               f"LANGUAGE: {lang}", f"REP'S OBJECTIVE: {brief.get('objective') or meeting.objective or '-'}",
               "LIKELY OBJECTIONS: " + "; ".join(f"{o.get('battlecard_id')}: {o.get('title')}" for o in brief.get("likely_objections", [])[:5]),
               "AVAILABLE BATTLECARD IDS: " + ", ".join(c.id for c in cards), "", "CONVERSATION SO FAR:"]
    for message in messages[-8:]:
        persona.append(f"{'REP' if message.get('role') == 'rep' else 'PROSPECT'}: {message.get('text', '')}")
    try:
        data = await llm.generate_json(REHEARSE_SYSTEM, "\n".join(persona), REHEARSE_SCHEMA, max_tokens=500, timeout=12.0, temperature=0.6)
    except llm.LLMUnavailable:
        return {**fallback, "degraded": True}
    hint = None
    if data.get("hint_say") and contracts.SAY_MIN_WORDS <= len(data["hint_say"].split()) <= contracts.SAY_MAX_WORDS_LONG:
        card = next((c for c in cards if c.id == data.get("hint_battlecard_id")), None)
        hint = {"id": f"rehearse-{len(messages)}", "moment": data.get("moment") or (cards_svc.moment_for(card) if card else "info"),
                "priority": "normal", "headline": contracts.clamp_words(data.get("hint_headline") or (card.title if card else "Try this"), contracts.HEADLINE_MAX_WORDS),
                "say": data["hint_say"].strip(), "then_ask": data.get("hint_then_ask"), "detail": card.do_not if card else None,
                "say_lang": lang, "say_words": len(data["hint_say"].split()), "battlecard_id": card.id if card else None,
                "sources": [{"kind": "battlecard", "label": card.title, "ref": card.id}] if card else [{"kind": "brief", "label": "Brief"}],
                "confidence": 0.7, "ttl_ms": contracts.CARD_TTL_MS, "turn_index": len(messages), "trigger": "auto", "latency_ms": None,
                "created_at": contracts.utc_now_iso(), "tier": 2, "provisional": False, "revision": 1, "late": False, "cue": None}
    return {"reply": (data.get("reply") or fallback["reply"]).strip(), "hint": hint, "degraded": False}
