"""Post-meeting debrief generation (spec §5.3) with verbatim-evidence verification and a
deterministic fallback, plus the background job the live pipeline triggers through
``hooks.register_session_saved``.

Inputs: the CallLog transcript (speaker-labelled), ``call_logs.metrics`` / ``deal_record``
written by the live pipeline (else computed with ``contracts.compute_metrics_from_transcript``),
the brief and the battlecards. Every methodology field value must carry an evidence quote that
appears verbatim in the transcript; unverified values are dropped. Transcript text is never logged.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
import uuid
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlalchemy.orm import Session

from database import SessionLocal, utc_isoformat
from models import CallLog
from models_wizard import WizardBattlecard, WizardDebrief, WizardMeeting
from services.transcript_manager import normalize_timestamp
from services.wizard import battlecards as cards_svc
from services.wizard import contracts, llm

logger = logging.getLogger(__name__)

DEBRIEF_TIMEOUT_S = 35.0
SUMMARY_MAX_WORDS = 80
EMAIL_MAX_WORDS = 180
WHATSAPP_MAX_WORDS = 90

# Gong benchmarks (see research notes Q8): directional, re-baseline on Indian calls.
BENCHMARKS = {
    "talk_ratio": {"low": 0.55, "high": 0.60, "alert": 0.65, "label": "seller talk share 55–60%"},
    "monologue_s": {"max": 150.0, "label": "longest monologue ≤ 2.5 min"},
    "questions_per_hour": {"low": 15, "high": 18, "label": "15–18 questions per hour"},
    "pause_after_objection_s": {"min": 2.0, "label": "pause ≥ 2 s after an objection (top reps pause ~5x longer)"},
}

_SPEAKER_ALIASES = {"rep": "salesperson", "seller": "salesperson", "salesperson": "salesperson", "agent": "salesperson",
                    "buyer": "prospect", "prospect": "prospect", "customer": "prospect", "client": "prospect",
                    "system": "system"}
_HINGLISH_MARKERS = (" hai ", " nahi ", " kya ", " theek ", " haan ", " bahut ", " abhi ", " karna ", " hoga ", " matlab ", " ji ")
_BUYING_SIGNALS = [
    (r"\b(how long|kitne din|kitna time).{0,40}(implement|setup|set up|onboard|start|live)", "asked about implementation time"),
    (r"\b(when can we|kab se|kab tak).{0,30}(start|begin|shuru|live)", "asked when they could start"),
    (r"\b(contract|agreement|po\b|purchase order|paperwork|sla)\b", "raised contract or SLA details unprompted"),
    (r"\b(pricing for|price for|quote for|per user|annual plan|yearly plan|kitna padega)\b", "asked for specific pricing"),
    (r"\b(our team|my team|hum log|we would|we could|we can)\b.{0,40}\b(use|try|roll|start|karenge|karein)\b", "spoke as if already using it"),
    (r"\b(send (me )?(the )?proposal|proposal bhej|next step|agle step)\b", "asked for the proposal or next step"),
    (r"\b(reference|case study|who else|aur kaun).{0,40}(client|customer|use|using)\b", "asked for references"),
    (r"\b(trial|pilot|poc)\b", "asked for a pilot or trial"),
]
_NEXT_STEP_VERBS = r"(call|meet|meeting|demo|walkthrough|follow[- ]?up|send|share|proposal|visit|connect|baat|milte|bhej|dikhao|dikhaunga|revert|decide|sign|start|kickoff)"
_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
_HINDI_DAYS = {"somvaar": 0, "somwar": 0, "mangalvaar": 1, "mangalwar": 1, "budhvaar": 2, "budhwar": 2, "guruvaar": 3, "guruwar": 3,
               "shukravaar": 4, "shukrawar": 4, "shanivaar": 5, "shaniwar": 5, "ravivaar": 6, "raviwar": 6}
_MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


# ── loading ──────────────────────────────────────────────────────────────────

def _normalize_speaker(raw: Any) -> str:
    text = str(raw or "unknown").strip().lower()
    return _SPEAKER_ALIASES.get(text, "unknown")


def load_call(call_log: Optional[CallLog]) -> dict:
    """Segments (speaker, text, t_start/t_end when present), insights, stored metrics/deal_record, duration, started_at."""
    if call_log is None:
        return {"segments": [], "insights": [], "metrics": None, "deal_record": None, "duration_s": None, "started_at": None,
                "card_feedback": {"cards_shown": 0, "cards_used": 0, "cards_dismissed": 0, "cards_up": 0, "cards_down": 0}}
    try:
        raw = json.loads(call_log.transcript or "[]")
    except (TypeError, ValueError):
        raw = []
    segments: list[dict] = []
    if isinstance(raw, list):
        for index, item in enumerate(raw):
            if not isinstance(item, dict):
                continue
            text = str(item.get("text") or item.get("content") or "").strip()
            if not text:
                continue
            segments.append({"index": index, "speaker": _normalize_speaker(item.get("speaker") or item.get("role")), "text": text,
                             "timestamp": normalize_timestamp(item.get("timestamp")),
                             "t_start": item.get("t_start") if isinstance(item.get("t_start"), (int, float)) else None,
                             "t_end": item.get("t_end") if isinstance(item.get("t_end"), (int, float)) else None})
    try:
        insights_raw = json.loads(call_log.ai_suggestions or "[]")
    except (TypeError, ValueError):
        insights_raw = []
    insights = [i for i in insights_raw if isinstance(i, dict)] if isinstance(insights_raw, list) else []
    metrics = getattr(call_log, "metrics", None)
    deal_record = getattr(call_log, "deal_record", None)
    duration = getattr(call_log, "duration_seconds", None)
    if not duration and segments:
        stamps = [s["timestamp"] for s in segments if s["timestamp"]]
        if len(stamps) >= 2:
            try:
                first = datetime.fromisoformat(stamps[0].rstrip("Z"))
                last = datetime.fromisoformat(stamps[-1].rstrip("Z"))
                duration = max(0, int((last - first).total_seconds()))
            except ValueError:
                duration = None
        if not duration:
            ends = [s["t_end"] for s in segments if s["t_end"] is not None]
            duration = int(max(ends)) if ends else None
    return {"segments": segments, "insights": insights, "metrics": metrics if isinstance(metrics, dict) else None,
            "deal_record": deal_record if isinstance(deal_record, dict) else None, "duration_s": duration,
            "started_at": getattr(call_log, "started_at", None) or call_log.timestamp, "card_feedback": card_feedback_counts(insights)}


def card_feedback_counts(insights: list[dict]) -> dict:
    """Per-card feedback from ``ai_suggestions[].feedback`` (``up|down|used|dismissed``)."""
    counts = {"cards_shown": 0, "cards_used": 0, "cards_dismissed": 0, "cards_up": 0, "cards_down": 0}
    for item in insights:
        if not isinstance(item.get("card"), dict):
            continue
        counts["cards_shown"] += 1
        feedback = str(item.get("feedback") or "").lower()
        if feedback == "used":
            counts["cards_used"] += 1
        elif feedback in ("dismissed", "dismiss"):
            counts["cards_dismissed"] += 1
        elif feedback == "up":
            counts["cards_up"] += 1
        elif feedback == "down":
            counts["cards_down"] += 1
            counts["cards_dismissed"] += 1
    return counts


def transcript_text(segments: list[dict], limit_chars: int = 14000) -> str:
    lines = [f"{'REP' if s['speaker'] == 'salesperson' else ('PROSPECT' if s['speaker'] == 'prospect' else s['speaker'].upper())}: {s['text']}"
             for s in segments if s["speaker"] != "system"]
    text = "\n".join(lines)
    if len(text) > limit_chars:
        head, tail = text[: limit_chars * 2 // 3], text[-(limit_chars // 3):]
        text = head + "\n[... middle of the call omitted ...]\n" + tail
    return text


def language_of(segments: list[dict]) -> str:
    prospect = " " + " ".join(s["text"].lower() for s in segments if s["speaker"] == "prospect") + " "
    hits = sum(prospect.count(marker) for marker in _HINGLISH_MARKERS)
    words = max(1, len(prospect.split()))
    return "hinglish" if hits >= 2 and hits / words > 0.02 else "en-IN"


# ── evidence verification ────────────────────────────────────────────────────

def _norm(text: str) -> str:
    text = re.sub(r"[\"'“”‘’]", "", text or "")
    text = re.sub(r"\s+", " ", text).strip().lower()
    return text.strip(" .,!?;:")


def quote_in_transcript(quote: Optional[str], segments: list[dict]) -> Optional[str]:
    """The speaker of the segment that contains ``quote`` verbatim (whitespace/case/quote-mark insensitive), else None."""
    needle = _norm(quote or "")
    if len(needle) < 4:
        return None
    for segment in segments:
        if needle in _norm(segment["text"]):
            return segment["speaker"]
    joined = _norm(" ".join(s["text"] for s in segments))
    return "unknown" if needle in joined else None


def verify_fields(fields: list[dict], segments: list[dict], methodology: str) -> list[dict]:
    """Keep every methodology field; drop values whose evidence quote is not verbatim in the transcript."""
    template = contracts.METHODOLOGIES.get(methodology or "none", contracts.METHODOLOGIES["none"])
    by_field = {f.get("field"): f for f in fields if isinstance(f, dict) and f.get("field")}
    verified = []
    for field, label in template:
        item = by_field.get(field) or {}
        value, quote = item.get("value"), item.get("evidence_quote")
        speaker = quote_in_transcript(quote, segments) if (value and quote) else None
        if value and speaker is None:
            value, quote, confidence = None, None, 0.0
        else:
            confidence = float(item.get("confidence") or (0.6 if value else 0.0))
        verified.append({"field": field, "label": label, "value": value, "evidence_quote": quote if value else None,
                         "speaker": item.get("speaker") or speaker if value else None, "confidence": round(min(1.0, max(0.0, confidence)), 2),
                         "confirmed": item.get("confirmed") if isinstance(item.get("confirmed"), bool) else None})
    return verified


# ── deterministic extraction ─────────────────────────────────────────────────

def detect_objections(segments: list[dict], cards: list[WizardBattlecard]) -> list[dict]:
    objection_cards = [c for c in cards if c.kind in ("objection", "india_context", "competitive", "persona")
                       and cards_svc.moment_for(c) in ("objection", "pricing", "competitor", "stall")]
    found: list[dict] = []
    seen: set[str] = set()
    for position, segment in enumerate(segments):
        if segment["speaker"] != "prospect":
            continue
        hits = cards_svc.match_triggers(segment["text"], objection_cards)
        for card, keyword in hits[:1]:
            key = f"{card.id}:{position}"
            if card.id in seen or key in seen:
                continue
            seen.add(card.id)
            reply = next((s for s in segments[position + 1: position + 4] if s["speaker"] == "salesperson"), None)
            handled = bool(reply and (contracts.is_question(reply["text"]) or contracts.word_count(reply["text"]) >= 8))
            found.append({"type": (card.category or card.kind or "objection").lower().replace(" & ", "_").replace(" ", "_"),
                          "quote": segment["text"][:240], "handled": handled, "how": reply["text"][:200] if reply else None,
                          "battlecard_id": card.id, "turn_index": segment["index"], "matched": keyword})
    return found[:8]


def detect_buying_signals(segments: list[dict]) -> list[dict]:
    signals = []
    for segment in segments:
        if segment["speaker"] != "prospect":
            continue
        lowered = " " + segment["text"].lower() + " "
        for pattern, why in _BUYING_SIGNALS:
            if re.search(pattern, lowered):
                signals.append({"quote": segment["text"][:240], "why": why, "turn_index": segment["index"]})
                break
    return signals[:6]


def _parse_date_phrase(text: str, base: datetime) -> Optional[str]:
    lowered = text.lower()
    if re.search(r"\b(tomorrow|kal)\b", lowered) and not re.search(r"\bkal (hi|tha|thi)\b", lowered):
        return (base + timedelta(days=1)).date().isoformat()
    if re.search(r"\b(day after|parson)\b", lowered):
        return (base + timedelta(days=2)).date().isoformat()
    for index, day in enumerate(_WEEKDAYS):
        if re.search(rf"\b{day}\b", lowered):
            delta = (index - base.weekday()) % 7
            delta = 7 if delta == 0 else delta
            if re.search(rf"\bnext {day}\b", lowered) and delta < 7:
                delta += 7
            return (base + timedelta(days=delta)).date().isoformat()
    for day, index in _HINDI_DAYS.items():
        if day in lowered:
            delta = (index - base.weekday()) % 7 or 7
            return (base + timedelta(days=delta)).date().isoformat()
    match = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b", lowered) or \
        re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b", lowered)
    if match:
        groups = match.groups()
        day_str, month_str = (groups[0], groups[1]) if groups[0].isdigit() else (groups[1], groups[0])
        month = _MONTHS[month_str[:3]]
        try:
            candidate = datetime(base.year, month, int(day_str))
            if candidate.date() < base.date() - timedelta(days=7):
                candidate = datetime(base.year + 1, month, int(day_str))
            return candidate.date().isoformat()
        except ValueError:
            return None
    if re.search(r"\b(next week|agle hafte|agle week)\b", lowered):
        return (base + timedelta(days=(7 - base.weekday()) % 7 or 7)).date().isoformat()
    match = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)\b", lowered)
    if match and re.search(_NEXT_STEP_VERBS, lowered):
        day = int(match.group(1))
        try:
            candidate = datetime(base.year, base.month, day)
            if candidate.date() <= base.date():
                month = base.month % 12 + 1
                candidate = datetime(base.year + (1 if month == 1 else 0), month, day)
            return candidate.date().isoformat()
        except ValueError:
            return None
    return None


def detect_next_step(segments: list[dict], base: Optional[datetime]) -> dict:
    base = base or datetime.utcnow()
    tail = segments[max(0, int(len(segments) * 0.5)):] or segments
    best: dict = {"text": None, "date": None, "evidence_quote": None, "speaker": None}
    for segment in reversed(tail):
        if segment["speaker"] == "system":
            continue
        lowered = segment["text"].lower()
        if not re.search(_NEXT_STEP_VERBS, lowered):
            continue
        date = _parse_date_phrase(segment["text"], base)
        if date and best["date"] is None:
            best = {"text": segment["text"][:200], "date": date, "evidence_quote": segment["text"][:240], "speaker": segment["speaker"]}
            break
        if best["text"] is None and re.search(r"\b(next step|follow[- ]?up|send|proposal|meeting|call|demo|milte|bhej)\b", lowered):
            best = {"text": segment["text"][:200], "date": None, "evidence_quote": segment["text"][:240], "speaker": segment["speaker"]}
    return best


def detect_stage(segments: list[dict], objections: list[dict], next_step: dict) -> str:
    text = " ".join(s["text"].lower() for s in segments)
    if re.search(r"\b(contract|agreement|purchase order|\bpo\b|sign|kickoff|onboarding)\b", text):
        return "close"
    if next_step.get("date"):
        return "next_steps"
    if re.search(r"\b(price|pricing|cost|per user|per month|kitna|rate|gst|discount)\b", text):
        return "pricing"
    if objections:
        return "objection"
    if re.search(r"\b(show you|screen|demo|dikhata|click)\b", text):
        return "demo"
    return "discovery" if segments else "rapport"


_FIELD_PATTERNS = {
    ("identify_pain", "pain", "need", "problem", "current_state"): r"\b(problem|issue|struggle|frustrat|dikkat|mushkil|pain|slow|manual|miss|lose|losing|headache|challenge)\b",
    ("metrics", "budget", "implication", "quantified_pain", "gap"): r"(₹|rs\.?|rupees|lakh|crore|per month|hours|%|percent|\b\d{2,}\b)",
    ("economic_buyer", "authority", "decision_maker", "people_map"): r"\b(my boss|my md|the owner|promoter|founder|sir se|md sahab|final decision|sign off|approve)\b",
    ("decision_process", "decision", "paper_process", "decision_and_paper"): r"\b(discuss internally|procurement|purchase order|\bpo\b|vendor registration|approval|legal|committee|process)\b",
    ("competition",): r"\b(competitor|other vendor|also evaluating|comparing|zoho|salesforce|freshworks|excel|tally|in-house|spreadsheet)\b",
    ("timeline", "dated_next_step", "next_step"): r"\b(by when|deadline|next week|next month|this quarter|march|diwali|kab tak|go live|start date)\b",
    ("champion",): r"\b(i('ll| will) push|i like it|i support|recommend this|take it to|mujhe pasand)\b",
    ("decision_criteria",): r"\b(must have|requirement|criteria|important to us|need it to|non-negotiable|zaroori)\b",
    ("situation",): r"\b(currently|today we|right now|our process|abhi hum|we use)\b",
    ("need_payoff", "future_state"): r"\b(would help|would be great|if we could|ideally|accha hoga|agar ho)\b",
    ("teach", "tailor", "take_control", "upfront_contract", "root_cause"): r"\b(because|since|reason|wajah|kyunki)\b",
}


def heuristic_fields(segments: list[dict], methodology: str) -> list[dict]:
    template = contracts.METHODOLOGIES.get(methodology or "none", contracts.METHODOLOGIES["none"])
    prospect_segments = [s for s in segments if s["speaker"] == "prospect"]
    fields = []
    for field, label in template:
        pattern = next((p for keys, p in _FIELD_PATTERNS.items() if field in keys), None)
        value, quote = None, None
        if pattern:
            for segment in prospect_segments:
                if re.search(pattern, segment["text"].lower()):
                    quote = segment["text"][:240]
                    value = segment["text"][:160]
                    break
        fields.append({"field": field, "label": label, "value": value, "evidence_quote": quote, "speaker": "prospect" if value else None,
                       "confidence": 0.5 if value else 0.0, "confirmed": None})
    return fields


def coaching_tips(metrics: dict, objections: list[dict], segments: list[dict], card_feedback: dict) -> list[dict]:
    """The four Gong benchmark comparisons (talk ratio, monologue, questions/hour, pause after objection) plus card use."""
    tips: list[dict] = []
    ratio = metrics.get("talk_ratio_rep")
    bench = BENCHMARKS["talk_ratio"]
    if ratio is not None:
        pct = round(ratio * 100)
        if ratio > bench["alert"]:
            tip = f"You spoke {pct}% of the time. Won deals sit near 55–60% seller talk; above 65% conversion drops. Ask one more question before each explanation."
        elif ratio < 0.40:
            tip = f"You spoke only {pct}% of the time. Listening is good, but make sure you also summarised and proposed the next step."
        else:
            tip = f"Talk share {pct}%: inside the 55–60% band won deals show. Keep it."
        tips.append({"tip": tip, "metric": "talk_ratio_rep", "value": round(ratio, 3), "benchmark": bench["label"], "evidence_quote": None})
    else:
        tips.append({"tip": "Talk ratio couldn't be measured (single channel or no timing). Use two channels (mic + tab / bridge) for this metric.",
                     "metric": "talk_ratio_rep", "value": None, "benchmark": bench["label"], "evidence_quote": None})
    mono = metrics.get("longest_monologue_rep_s")
    bench = BENCHMARKS["monologue_s"]
    if mono is not None:
        if mono > bench["max"]:
            tip = f"Your longest stretch was {int(mono // 60)} min {int(mono % 60)} s. Lost deals carry monologues over 2.5 minutes; break explanations with a check-in question."
        else:
            tip = f"Longest monologue {int(mono)} s: under the 2.5-minute line. Good."
        tips.append({"tip": tip, "metric": "longest_monologue_rep_s", "value": mono, "benchmark": bench["label"], "evidence_quote": None})
    questions = metrics.get("questions_rep")
    elapsed = metrics.get("elapsed_s") or 0
    bench = BENCHMARKS["questions_per_hour"]
    if questions is not None and elapsed >= 120:
        per_hour = round(questions / (elapsed / 3600.0), 1)
        if per_hour < bench["low"]:
            tip = f"You asked about {per_hour} questions per hour; won deals run 15–18, spread through the call. Plan three discovery questions for the next call."
        elif per_hour > 24:
            tip = f"About {per_hour} questions per hour feels like an interrogation (lost deals run ~20+). Go deeper on fewer problems."
        else:
            tip = f"About {per_hour} questions per hour: in the 15–18 band. Keep spreading them through the call."
        tips.append({"tip": tip, "metric": "questions_per_hour", "value": per_hour, "benchmark": bench["label"], "evidence_quote": None})
    bench = BENCHMARKS["pause_after_objection_s"]
    pauses: list[float] = []
    for objection in objections:
        turn = objection.get("turn_index")
        position = next((i for i, s in enumerate(segments) if s["index"] == turn), None)
        if position is None:
            continue
        reply = next((s for s in segments[position + 1: position + 4] if s["speaker"] == "salesperson"), None)
        if reply and segments[position]["t_end"] is not None and reply["t_start"] is not None:
            pauses.append(max(0.0, float(reply["t_start"]) - float(segments[position]["t_end"])))
    if objections:
        quote = objections[0].get("quote")
        if pauses:
            avg = round(sum(pauses) / len(pauses), 1)
            tip = (f"After objections you paused {avg} s on average. Top reps pause ~5x longer than average; aim for two full seconds before answering."
                   if avg < bench["min"] else f"You paused {avg} s on average after objections: calm and confident. Keep it.")
            tips.append({"tip": tip, "metric": "pause_after_objection_s", "value": avg, "benchmark": bench["label"], "evidence_quote": quote})
        else:
            handled = sum(1 for o in objections if o.get("handled"))
            tips.append({"tip": f"{len(objections)} objection(s) heard, {handled} answered with a question or a full reply. Pause two seconds and ask one exploring question before responding.",
                         "metric": "pause_after_objection_s", "value": None, "benchmark": bench["label"], "evidence_quote": quote})
    else:
        tips.append({"tip": "No objections were detected. Either the call stayed in discovery or the prospect wasn't challenged; invite pushback next time ('What would make this a no?').",
                     "metric": "pause_after_objection_s", "value": None, "benchmark": bench["label"], "evidence_quote": None})
    if card_feedback.get("cards_shown"):
        tips.append({"tip": f"{card_feedback['cards_shown']} live cards shown, {card_feedback.get('cards_used', 0)} marked used, {card_feedback.get('cards_dismissed', 0)} dismissed.",
                     "metric": "cards", "value": card_feedback.get("cards_used", 0), "benchmark": None, "evidence_quote": None})
    return tips


def deal_health_for(record: dict, metrics: Optional[dict]) -> dict:
    """Backend B's ``deal_record.compute_deal_health`` when importable, else the contracts implementation."""
    try:
        from services.wizard import deal_record as live_record  # type: ignore
        compute = getattr(live_record, "compute_deal_health", None)
        if compute is not None:
            return dict(compute(record, metrics))
    except Exception:  # noqa: BLE001 - fall back to the shared implementation
        pass
    return dict(contracts.compute_deal_health(record, metrics))


def _first_name(name: Optional[str]) -> str:
    return (name or "").strip().split(" ")[0] if name else ""


def compose_email(meeting: WizardMeeting, summary: str, next_step: dict, action_items: list[dict], lang: str) -> dict:
    first = _first_name(meeting.prospect_name) or "there"
    company = meeting.company or "your team"
    lines = [f"Hi {first},", "", f"Thank you for your time today. Here is what I took away from our conversation about {company}:", "", summary, ""]
    if action_items:
        lines.append("What happens next:")
        for item in action_items[:4]:
            owner = "you" if item.get("owner") == "prospect" else "I"
            due = f" by {item['due']}" if item.get("due") else ""
            lines.append(f"- {owner.capitalize() if owner == 'you' else 'I'} will {item['text'][0].lower() + item['text'][1:] if item.get('text') else ''}{due}")
        lines.append("")
    if next_step.get("text"):
        when = f" on {next_step['date']}" if next_step.get("date") else ""
        lines.append(f"Next step: {next_step['text']}{when}. I'll send a calendar invite shortly.")
    else:
        lines.append("I'd suggest a short follow-up call this week to agree the next step; let me know two slots that work for you.")
    lines += ["", "If I missed anything or got something wrong, reply here and I'll fix it.", "", "Best regards"]
    body = contracts.clamp_words("\n".join(lines), EMAIL_MAX_WORDS)
    subject = f"Recap and next step: {meeting.title or company}"[:120]
    return {"subject": subject, "body": body}


def compose_whatsapp(meeting: WizardMeeting, summary: str, next_step: dict, lang: str) -> str:
    first = _first_name(meeting.prospect_name)
    if lang == "hinglish":
        opener = f"Namaste {first} ji, aaj baat karne ke liye shukriya." if first else "Namaste, aaj baat karne ke liye shukriya."
        step = (f"Agla step: {next_step['text']}" + (f" ({next_step['date']})" if next_step.get("date") else "")) if next_step.get("text") else "Agla step hum is hafte tay kar lete hain; aap do time slots bata dijiye."
        closing = "Kuch bhi galat likha ho toh batayein, main theek kar dunga."
    else:
        opener = f"Hi {first}, thanks for your time today." if first else "Hi, thanks for your time today."
        step = (f"Next step: {next_step['text']}" + (f" ({next_step['date']})" if next_step.get("date") else "")) if next_step.get("text") else "Let's fix the next step this week; send me two slots that work."
        closing = "If I got anything wrong, tell me and I'll fix it."
    text = f"{opener}\n\nQuick recap: {contracts.clamp_words(summary, 40)}\n\n{step}\n\n{closing}"
    return contracts.clamp_words(text, WHATSAPP_MAX_WORDS)


def crm_payload_for(meeting: WizardMeeting, summary: str, outcome: str, stage: str, next_step: dict, fields: list[dict],
                    deal_health: dict, metrics: dict) -> dict:
    payload = {
        "meeting_id": meeting.id, "title": meeting.title, "prospect_name": meeting.prospect_name, "company": meeting.company,
        "prospect_email": meeting.prospect_email, "prospect_phone": meeting.prospect_phone_e164, "industry": meeting.industry,
        "role": meeting.role, "deal_value_inr": meeting.deal_value_inr, "deal_value_text": meeting.deal_value_text,
        "methodology": meeting.methodology, "outcome": outcome, "stage_reached": stage, "summary": summary,
        "next_step": next_step.get("text"), "next_step_date": next_step.get("date"),
        "deal_health_score": deal_health.get("score"), "talk_ratio_rep": metrics.get("talk_ratio_rep"),
        "duration_seconds": metrics.get("elapsed_s"), "ended_at": utc_isoformat(meeting.ended_at),
    }
    for field in fields:
        if field.get("value"):
            payload[f"field_{field['field']}"] = field["value"]
    return payload


def outcome_for(next_step: dict, segments: list[dict], llm_outcome: Optional[str]) -> str:
    if not segments:
        return "no_show"
    if llm_outcome in ("won", "lost"):
        return llm_outcome
    if next_step.get("date"):
        return "next_step_set"
    if next_step.get("text"):
        return "follow_up_needed"
    return llm_outcome if llm_outcome in ("follow_up_needed", "unclear") else "unclear"


def deterministic_debrief(meeting: WizardMeeting, inputs: dict, cards: list[WizardBattlecard]) -> dict:
    segments = inputs["segments"]
    methodology = meeting.methodology or "meddpicc"
    metrics = inputs["metrics"] or dict(contracts.compute_metrics_from_transcript(segments, inputs["duration_s"]))
    metrics = {**metrics, **inputs["card_feedback"]}
    record = inputs["deal_record"] or {}
    fields_source = record.get("fields") if isinstance(record.get("fields"), list) and record.get("fields") else heuristic_fields(segments, methodology)
    fields = verify_fields(fields_source, segments, methodology)
    objections = [o for o in (record.get("objections") or []) if isinstance(o, dict) and o.get("quote") and quote_in_transcript(o["quote"], segments)] \
        or detect_objections(segments, cards)
    signals = [s for s in (record.get("buying_signals") or []) if isinstance(s, dict) and s.get("quote") and quote_in_transcript(s["quote"], segments)] \
        or detect_buying_signals(segments)
    next_step = record.get("next_step") if isinstance(record.get("next_step"), dict) and record["next_step"].get("text") else detect_next_step(segments, inputs["started_at"])
    next_step = {"text": next_step.get("text"), "date": next_step.get("date"), "evidence_quote": next_step.get("evidence_quote")}
    stage = record.get("stage") or detect_stage(segments, objections, next_step)
    outcome = outcome_for(next_step, segments, None)
    lang = language_of(segments)
    covered = [f for f in fields if f.get("value")]
    if not segments:
        summary = f"No conversation was captured for this meeting with {meeting.prospect_name or 'the prospect'}. Mark it as a no-show or regenerate after the call log is saved."
    else:
        bits = [f"{len(segments)} turns with {meeting.prospect_name or 'the prospect'}" + (f" at {meeting.company}" if meeting.company else "") + "."]
        if covered:
            bits.append(f"Covered {len(covered)} of {len(fields)} {methodology.upper()} fields" + (f", incl. {covered[0]['label'].lower()}" if covered else "") + ".")
        if objections:
            bits.append(f"{len(objections)} objection(s) heard, {sum(1 for o in objections if o.get('handled'))} answered.")
        if signals:
            bits.append(f"{len(signals)} buying signal(s).")
        bits.append(f"Next step: {next_step['text'][:80]}" + (f" on {next_step['date']}." if next_step.get("date") else " (no date agreed).") if next_step.get("text") else "No next step was agreed.")
        summary = contracts.clamp_words(" ".join(bits), SUMMARY_MAX_WORDS)
    risks = []
    if not next_step.get("date") and segments:
        risks.append({"text": "No dated next step: close rates drop from ~20% to ~5% without one (Gong).", "severity": "high"})
    unresolved = [o for o in objections if not o.get("handled")]
    if unresolved:
        risks.append({"text": f"{len(unresolved)} objection(s) left open: {unresolved[0]['quote'][:80]}", "severity": "medium"})
    if not any(f.get("field") in ("economic_buyer", "authority", "decision_maker", "people_map") and f.get("value") for f in fields) and segments:
        risks.append({"text": "Economic buyer not identified in the conversation.", "severity": "medium"})
    action_items = []
    if next_step.get("text"):
        action_items.append({"id": uuid.uuid4().hex[:8], "text": f"Send calendar invite: {next_step['text'][:80]}", "owner": "rep", "due": next_step.get("date"), "done": False})
    action_items.append({"id": uuid.uuid4().hex[:8], "text": "Send the recap (WhatsApp + email) within the hour", "owner": "rep", "due": None, "done": False})
    for objection in unresolved[:2]:
        action_items.append({"id": uuid.uuid4().hex[:8], "text": f"Answer the open objection: {objection['quote'][:60]}", "owner": "rep", "due": None, "done": False})
    record_for_health = {"methodology": methodology, "fields": fields, "objections": objections, "buying_signals": signals, "risks": risks,
                         "next_step": next_step if next_step.get("text") else None, "stage": stage}
    health = deal_health_for(record_for_health, metrics)
    tips = coaching_tips(metrics, objections, segments, inputs["card_feedback"])
    return {
        "summary": summary, "outcome": outcome, "stage_reached": stage, "methodology_fields": fields, "objections": objections,
        "buying_signals": signals, "risks": risks, "action_items": action_items, "next_step": next_step, "metrics": metrics,
        "deal_health": health, "follow_up_email": compose_email(meeting, summary, next_step, action_items, lang),
        "follow_up_whatsapp": compose_whatsapp(meeting, summary, next_step, lang),
        "coaching": tips, "crm_payload": crm_payload_for(meeting, summary, outcome, stage, next_step, fields, health, metrics),
        "language": lang,
    }


# ── LLM pass ─────────────────────────────────────────────────────────────────

DEBRIEF_SCHEMA = {
    "type": "object",
    "required": ["summary", "outcome", "stage_reached", "methodology_fields", "objections", "buying_signals", "risks", "action_items",
                 "next_step", "follow_up_email", "follow_up_whatsapp", "coaching"],
    "properties": {
        "summary": {"type": "string"},
        "outcome": {"type": "string", "enum": ["next_step_set", "follow_up_needed", "won", "lost", "no_show", "unclear"]},
        "stage_reached": {"type": "string", "enum": ["rapport", "discovery", "demo", "pricing", "objection", "next_steps", "close"]},
        "methodology_fields": {"type": "array", "items": {"type": "object", "required": ["field", "value", "evidence_quote"],
                               "properties": {"field": {"type": "string"}, "value": {"type": ["string", "null"]}, "evidence_quote": {"type": ["string", "null"]},
                                              "speaker": {"type": ["string", "null"]}, "confidence": {"type": ["number", "null"]}}}},
        "objections": {"type": "array", "maxItems": 10, "items": {"type": "object", "required": ["type", "quote", "handled"],
                       "properties": {"type": {"type": "string"}, "quote": {"type": "string"}, "handled": {"type": "boolean"},
                                      "how": {"type": ["string", "null"]}, "battlecard_id": {"type": ["string", "null"]}}}},
        "buying_signals": {"type": "array", "maxItems": 8, "items": {"type": "object", "required": ["quote", "why"],
                           "properties": {"quote": {"type": "string"}, "why": {"type": "string"}}}},
        "risks": {"type": "array", "maxItems": 6, "items": {"type": "object", "required": ["text", "severity"],
                  "properties": {"text": {"type": "string"}, "severity": {"type": "string", "enum": ["low", "medium", "high"]}}}},
        "action_items": {"type": "array", "maxItems": 8, "items": {"type": "object", "required": ["text", "owner"],
                         "properties": {"text": {"type": "string"}, "owner": {"type": "string", "enum": ["rep", "prospect"]}, "due": {"type": ["string", "null"]}}}},
        "next_step": {"type": "object", "required": ["text"], "properties": {"text": {"type": ["string", "null"]}, "date": {"type": ["string", "null"]},
                      "evidence_quote": {"type": ["string", "null"]}}},
        "follow_up_email": {"type": "object", "required": ["subject", "body"], "properties": {"subject": {"type": "string"}, "body": {"type": "string"}}},
        "follow_up_whatsapp": {"type": "string"},
        "coaching": {"type": "array", "maxItems": 6, "items": {"type": "object", "required": ["tip"],
                     "properties": {"tip": {"type": "string"}, "evidence_quote": {"type": ["string", "null"]}}}},
    },
}

SYSTEM_PROMPT = """You are ClozFlow's post-call analyst for Indian B2B sales. From a speaker-labelled transcript you write a debrief the rep edits before anything is sent.

Rules:
- summary: BLUF, at most 80 words: outcome, what the prospect cares about, what happens next.
- methodology_fields: fill only fields the transcript supports; every value MUST carry evidence_quote copied VERBATIM (exact characters) from one transcript line; never paraphrase a quote. Unsupported fields: value null.
- objections: quote VERBATIM; handled=true only if the rep answered or asked an exploring question; map battlecard_id from the BATTLECARDS list when one fits.
- next_step.date must be an ISO date (YYYY-MM-DD) only when a specific day was agreed on the call (use CALL DATE to resolve weekdays); otherwise null. outcome is next_step_set only when next_step.date exists; won/lost only on an explicit decision; no_show only when nothing was said.
- follow_up_email ≤ 180 words, follow_up_whatsapp ≤ 90 words: warm, specific, no corporate filler; Hinglish (Latin script) is fine when the prospect used it. Never invent prices or features not in CAPSULE FACTS.
- coaching: 2–4 tips tied to what the rep actually said (quote it) and to the METRICS given, referencing Gong benchmarks (seller talk 55–60%, monologue ≤ 2.5 min, 15–18 questions/hour, pause after objections).
- Output only the JSON object described."""


def _render_debrief_inputs(meeting: WizardMeeting, inputs: dict, draft: dict, cards: list[WizardBattlecard]) -> str:
    started = inputs["started_at"] or datetime.utcnow()
    brief = meeting.brief or {}
    lines = [
        "MEETING", f"- Prospect: {meeting.prospect_name or '-'} ({meeting.role or '-'}) at {meeting.company or '-'}; industry {meeting.industry or '-'}",
        f"- Objective: {meeting.objective or brief.get('objective') or '-'}", f"- Methodology: {meeting.methodology} with fields: " +
        ", ".join(f for f, _ in contracts.METHODOLOGIES.get(meeting.methodology or 'none', contracts.METHODOLOGIES['none'])),
        f"- CALL DATE: {started.date().isoformat()} ({started.strftime('%A')})", f"- Deal value: {meeting.deal_value_text or meeting.deal_value_inr or 'unknown'}",
        "", "CAPSULE FACTS", f"- Product: {meeting.product_name or '-'}", f"- Price: {meeting.product_price or '-'}",
        "", "METRICS (deterministic)", json.dumps({k: v for k, v in draft["metrics"].items() if k in ("elapsed_s", "talk_ratio_rep", "longest_monologue_rep_s", "questions_rep", "questions_prospect", "interruptions_rep", "estimated")}),
        "", "BATTLECARDS (id | title)"] + [f"- {c.id} | {c.title}" for c in cards[:25]]
    lines += ["", "DRAFT (heuristic; improve)", f"- next_step: {draft['next_step']}", f"- stage: {draft['stage_reached']}",
              "", "TRANSCRIPT", transcript_text(inputs["segments"])]
    return "\n".join(lines)


def _merge_llm(draft: dict, data: dict, meeting: WizardMeeting, inputs: dict, cards: list[WizardBattlecard]) -> dict:
    segments = inputs["segments"]
    methodology = meeting.methodology or "meddpicc"
    out = dict(draft)
    if data.get("summary"):
        out["summary"] = contracts.clamp_words(data["summary"].strip(), SUMMARY_MAX_WORDS)
    fields = verify_fields(data.get("methodology_fields") or [], segments, methodology)
    # keep heuristic values where the model left a field empty but we had verified evidence
    by_field = {f["field"]: f for f in draft["methodology_fields"]}
    for field in fields:
        if not field.get("value") and by_field.get(field["field"], {}).get("value"):
            field.update({k: by_field[field["field"]][k] for k in ("value", "evidence_quote", "speaker", "confidence")})
    out["methodology_fields"] = fields
    known_ids = {c.id for c in cards}
    objections = []
    for item in data.get("objections") or []:
        if quote_in_transcript(item.get("quote"), segments) is None:
            continue
        card_id = item.get("battlecard_id") if item.get("battlecard_id") in known_ids else None
        if card_id is None:
            hit = cards_svc.match_triggers(item.get("quote", ""), cards)
            card_id = hit[0][0].id if hit else None
        objections.append({"type": (item.get("type") or "objection").lower().replace(" ", "_"), "quote": item["quote"][:240],
                           "handled": bool(item.get("handled")), "how": item.get("how"), "battlecard_id": card_id})
    out["objections"] = objections or draft["objections"]
    signals = [{"quote": s["quote"][:240], "why": s.get("why") or ""} for s in data.get("buying_signals") or [] if quote_in_transcript(s.get("quote"), segments)]
    out["buying_signals"] = signals or draft["buying_signals"]
    if data.get("risks"):
        out["risks"] = [{"text": r["text"].strip(), "severity": r.get("severity") or "medium"} for r in data["risks"] if r.get("text")][:6]
    next_step = data.get("next_step") or {}
    date = next_step.get("date")
    if date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(date)):
        date = None
    evidence = next_step.get("evidence_quote")
    if evidence and quote_in_transcript(evidence, segments) is None:
        evidence = None
    merged_step = {"text": (next_step.get("text") or "").strip() or draft["next_step"].get("text"), "date": date or (draft["next_step"].get("date") if not next_step.get("text") else date),
                   "evidence_quote": evidence or (draft["next_step"].get("evidence_quote") if not next_step.get("text") else None)}
    out["next_step"] = merged_step
    out["outcome"] = outcome_for(merged_step, segments, data.get("outcome"))
    out["stage_reached"] = data.get("stage_reached") or draft["stage_reached"]
    items = []
    for item in data.get("action_items") or []:
        if item.get("text"):
            due = item.get("due") if item.get("due") and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(item["due"])) else None
            items.append({"id": uuid.uuid4().hex[:8], "text": item["text"].strip()[:200], "owner": item.get("owner") or "rep", "due": due, "done": False})
    out["action_items"] = items or draft["action_items"]
    email = data.get("follow_up_email") or {}
    if email.get("body") and email.get("subject"):
        out["follow_up_email"] = {"subject": email["subject"].strip()[:160], "body": contracts.clamp_words(email["body"].strip(), EMAIL_MAX_WORDS)}
    if data.get("follow_up_whatsapp"):
        out["follow_up_whatsapp"] = contracts.clamp_words(data["follow_up_whatsapp"].strip(), WHATSAPP_MAX_WORDS)
    llm_tips = []
    for tip in data.get("coaching") or []:
        if tip.get("tip"):
            quote = tip.get("evidence_quote")
            if quote and quote_in_transcript(quote, segments) is None:
                continue  # a tip built on words nobody said is dropped
            llm_tips.append({"tip": tip["tip"].strip()[:400], "evidence_quote": quote, "metric": None, "value": None, "benchmark": None})
    out["coaching"] = (llm_tips + draft["coaching"])[:9]
    record = {"methodology": methodology, "fields": out["methodology_fields"], "objections": out["objections"], "buying_signals": out["buying_signals"],
              "risks": out["risks"], "next_step": merged_step if merged_step.get("text") else None, "stage": out["stage_reached"]}
    out["deal_health"] = deal_health_for(record, out["metrics"])
    out["crm_payload"] = crm_payload_for(meeting, out["summary"], out["outcome"], out["stage_reached"], merged_step, out["methodology_fields"],
                                         out["deal_health"], out["metrics"])
    return out


# ── entry points ─────────────────────────────────────────────────────────────

def serialize(debrief: WizardDebrief) -> dict:
    return {
        "id": debrief.id, "meeting_id": debrief.meeting_id, "status": debrief.status, "error": debrief.error,
        "summary": debrief.summary, "outcome": debrief.outcome, "stage_reached": debrief.stage_reached,
        "methodology_fields": debrief.methodology_fields or [], "objections": debrief.objections or [],
        "buying_signals": debrief.buying_signals or [], "risks": debrief.risks or [], "action_items": debrief.action_items or [],
        "next_step": debrief.next_step or {"text": None, "date": None}, "metrics": debrief.metrics or {},
        "deal_health": debrief.deal_health or {"score": None, "rationale": [], "coverage": {}},
        "follow_up_email": debrief.follow_up_email or {"subject": "", "body": ""}, "follow_up_whatsapp": debrief.follow_up_whatsapp or "",
        "coaching": debrief.coaching or [], "crm_payload": debrief.crm_payload or {}, "sent": debrief.sent or {},
        "degraded": bool(debrief.degraded), "model": debrief.model, "generated_at": utc_isoformat(debrief.generated_at),
        "edited_at": utc_isoformat(debrief.edited_at), "created_at": utc_isoformat(debrief.created_at),
    }


def get_or_create_row(db: Session, meeting: WizardMeeting) -> WizardDebrief:
    row = db.query(WizardDebrief).filter(WizardDebrief.meeting_id == meeting.id).first()
    if row is None:
        row = WizardDebrief(meeting_id=meeting.id, user_id=meeting.user_id, status="generating")
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


async def generate_debrief(db: Session, meeting: WizardMeeting, *, force: bool = False) -> WizardDebrief:
    """(Re)generate the debrief row for ``meeting``; marks the meeting ``debriefed`` when ready."""
    row = get_or_create_row(db, meeting)
    if row.status == "ready" and not force:
        return row
    row.status, row.error = "generating", None
    db.commit()
    try:
        call_log = db.get(CallLog, meeting.call_log_id) if meeting.call_log_id else None
        if call_log is not None and call_log.user_id != meeting.user_id:
            call_log = None
        inputs = load_call(call_log)
        cards = cards_svc.visible_cards(db, meeting.user_id)
        draft = deterministic_debrief(meeting, inputs, cards)
        result, degraded, model = draft, True, None
        if inputs["segments"] and llm.is_configured():
            try:
                data = await llm.generate_json(SYSTEM_PROMPT, _render_debrief_inputs(meeting, inputs, draft, cards), DEBRIEF_SCHEMA,
                                               max_tokens=2600, timeout=DEBRIEF_TIMEOUT_S, temperature=0.25)
                result = _merge_llm(draft, data, meeting, inputs, cards)
                degraded, model = False, llm.describe().get("model")
            except llm.LLMUnavailable as exc:
                logger.info("wizard debrief: LLM unavailable, using heuristics (%s)", type(exc).__name__)
            except Exception as exc:  # noqa: BLE001
                logger.warning("wizard debrief: unexpected %s, using heuristics", type(exc).__name__)
        for key in ("summary", "outcome", "stage_reached", "methodology_fields", "objections", "buying_signals", "risks", "action_items",
                    "next_step", "metrics", "deal_health", "follow_up_email", "follow_up_whatsapp", "coaching", "crm_payload"):
            setattr(row, key, result[key])
        row.degraded = degraded
        row.model = model
        row.status = "ready"
        row.generated_at = datetime.utcnow()
        row.sent = row.sent or {}
        if meeting.status in ("live", "ended", "debriefed", "ready", "planned"):
            meeting.status = "debriefed" if inputs["segments"] else ("no_show" if result["outcome"] == "no_show" and meeting.status != "debriefed" else meeting.status)
            if meeting.status == "no_show" and not meeting.ended_at:
                meeting.ended_at = datetime.utcnow()
        meeting.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(row)
    except Exception as exc:  # noqa: BLE001 - never leave the row in "generating"
        db.rollback()
        row = get_or_create_row(db, meeting)
        row.status, row.error = "failed", f"Debrief generation failed ({type(exc).__name__}). Try again."
        db.commit()
        logger.exception("wizard debrief failed for meeting (type only): %s", type(exc).__name__)
    return row


_IN_FLIGHT: set[str] = set()


async def run_debrief_job(meeting_id: str, call_log_id: Optional[int], user_id: Optional[int]) -> None:
    """Background job with its own DB session: link the call log, end the meeting, generate the debrief."""
    if meeting_id in _IN_FLIGHT:
        return
    _IN_FLIGHT.add(meeting_id)
    try:
        with SessionLocal() as db:
            meeting = db.get(WizardMeeting, meeting_id)
            if meeting is None or (user_id is not None and meeting.user_id != user_id):
                return
            if call_log_id and not meeting.call_log_id:
                log = db.get(CallLog, call_log_id)
                if log is not None and log.user_id == meeting.user_id:
                    meeting.call_log_id = call_log_id
                    if hasattr(log, "meeting_id") and not getattr(log, "meeting_id", None):
                        log.meeting_id = meeting.id
            if meeting.status in ("planned", "ready", "live"):
                meeting.status = "ended"
                meeting.ended_at = meeting.ended_at or datetime.utcnow()
            db.commit()
            await generate_debrief(db, meeting, force=True)
    except Exception as exc:  # noqa: BLE001
        logger.warning("wizard debrief job failed: %s", type(exc).__name__)
    finally:
        _IN_FLIGHT.discard(meeting_id)


def schedule_debrief(meeting_id: str, call_log_id: Optional[int], user_id: Optional[int]):
    """Run ``run_debrief_job`` in the background: an asyncio task on the running loop, else a daemon thread."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if loop is not None:
        return loop.create_task(run_debrief_job(meeting_id, call_log_id, user_id))
    thread = threading.Thread(target=lambda: asyncio.run(run_debrief_job(meeting_id, call_log_id, user_id)), daemon=True, name="wizard-debrief")
    thread.start()
    return thread


def on_session_saved(meeting_id: Optional[str], call_log_id: int, user_id: int) -> None:
    """Hook for ``hooks.register_session_saved``: returns None so the live pipeline is never awaited on."""
    if not meeting_id:
        return None
    schedule_debrief(meeting_id, call_log_id, user_id)
    return None


def apply_patch(row: WizardDebrief, patch: dict) -> WizardDebrief:
    """Partial edit: scalar fields replace; ``action_items`` / ``methodology_fields`` merge by id / field."""
    simple = ("summary", "outcome", "stage_reached", "objections", "buying_signals", "risks", "next_step", "follow_up_email",
              "follow_up_whatsapp", "coaching", "crm_payload", "deal_health")
    for key in simple:
        if key in patch and patch[key] is not None:
            setattr(row, key, patch[key])
    if "action_items" in patch and isinstance(patch["action_items"], list):
        # The list is authoritative (clients send the whole array): items are matched by id and merged,
        # items without an id are appended with a new id, items missing from the list are removed.
        existing = {item.get("id"): dict(item) for item in (row.action_items or []) if isinstance(item, dict)}
        result = []
        for incoming in patch["action_items"]:
            if not isinstance(incoming, dict):
                continue
            item_id = incoming.get("id")
            if item_id and item_id in existing:
                merged = existing[item_id]
                merged.update({k: v for k, v in incoming.items() if k != "id"})
            else:
                item_id = item_id or uuid.uuid4().hex[:8]
                merged = {"id": item_id, "text": incoming.get("text", ""), "owner": incoming.get("owner", "rep"),
                          "due": incoming.get("due"), "done": bool(incoming.get("done"))}
            result.append(merged)
        row.action_items = result
    if "methodology_fields" in patch and isinstance(patch["methodology_fields"], list):
        current = {f.get("field"): dict(f) for f in (row.methodology_fields or []) if isinstance(f, dict)}
        for incoming in patch["methodology_fields"]:
            if isinstance(incoming, dict) and incoming.get("field") in current:
                current[incoming["field"]].update({k: v for k, v in incoming.items() if k in ("value", "evidence_quote", "confirmed", "confidence", "speaker")})
        row.methodology_fields = list(current.values())
    row.edited_at = datetime.utcnow()
    return row
