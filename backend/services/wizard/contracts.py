"""Shared shapes for the Meeting Wizard (REST side and live side).

Everything here is plain data (TypedDicts, constants, pure helpers) so it can
be imported by routers, services and tests without side effects. Extend it
additively; both halves of the Wizard depend on it.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal, Optional, TypedDict

# ── enumerations ─────────────────────────────────────────────────────────────

MeetingStatus = Literal["planned", "ready", "live", "ended", "debriefed", "cancelled", "no_show"]
Methodology = Literal["meddpicc", "bant", "spin", "challenger", "sandler", "gap", "none"]
Platform = Literal["meet", "zoom", "teams", "phone", "in_person", "whatsapp", "other"]
Channel = Literal["tab_audio", "phone_bridge", "mic", "bot"]
ConsentMode = Literal["announced", "in_invite", "bridge_disclosure", "skipped"]
Speaker = Literal["salesperson", "prospect", "unknown", "system"]
Moment = Literal[
    "objection", "pricing", "competitor", "buying_signal", "next_step_missing",
    "stall", "question", "silence", "info",
]
Priority = Literal["low", "normal", "high"]
Trigger = Literal["auto", "on_demand", "ask"]

METHODOLOGIES: dict[str, list[tuple[str, str]]] = {
    # field id, label
    "meddpicc": [
        ("metrics", "Metrics"), ("economic_buyer", "Economic buyer"), ("decision_criteria", "Decision criteria"),
        ("decision_process", "Decision process"), ("paper_process", "Paper process"),
        ("identify_pain", "Identified pain"), ("champion", "Champion"), ("competition", "Competition"),
    ],
    "bant": [("budget", "Budget"), ("authority", "Authority"), ("need", "Need"), ("timeline", "Timeline")],
    "spin": [("situation", "Situation"), ("problem", "Problem"), ("implication", "Implication"), ("need_payoff", "Need-payoff")],
    "challenger": [("teach", "Teaching insight"), ("tailor", "Tailored to stakeholder"), ("take_control", "Took control of next step")],
    "sandler": [("pain", "Pain"), ("budget", "Budget"), ("decision", "Decision"), ("upfront_contract", "Up-front contract")],
    "gap": [("current_state", "Current state"), ("future_state", "Future state"), ("gap", "Gap / cost of inaction"), ("root_cause", "Root cause")],
    "none": [("pain", "Pain"), ("decision_maker", "Decision maker"), ("next_step", "Next step")],
}

# Common fields every DealRecord carries regardless of methodology.
UNIVERSAL_FIELDS: list[tuple[str, str]] = [
    ("quantified_pain", "Quantified pain / outcome"),
    ("people_map", "People map (buyer, champion, influencers)"),
    ("decision_and_paper", "Decision + paper process"),
    ("competition", "Competition incl. status quo"),
    ("dated_next_step", "Dated next step"),
]

# Channel byte prefix for /ws/audio protocol v2 binary frames.
CHANNEL_MIXED = 0
CHANNEL_REP = 1
CHANNEL_PROSPECT = 2
CHANNEL_SPEAKER: dict[int, str] = {CHANNEL_MIXED: "unknown", CHANNEL_REP: "salesperson", CHANNEL_PROSPECT: "prospect"}

PROTOCOL_VERSION = 2

# Card policy (see scratchpad LIVE_LATENCY_PLAN.md): event-driven cadence with a short
# anti-flicker gap between card *replacements*, never a timer wall. None = no proactive cards.
Intensity = Literal["full", "guided", "light", "on_demand", "off"]
MIN_CARD_GAP_S: dict[str, Optional[float]] = {"full": 5.0, "guided": 5.0, "light": 15.0, "on_demand": None, "off": None}
PROACTIVE_MOMENTS: dict[str, tuple[str, ...]] = {
    "full": ("objection", "pricing", "competitor", "next_step_missing", "buying_signal", "question", "stall", "silence", "info"),
    "guided": ("objection", "pricing", "competitor", "next_step_missing", "buying_signal", "question", "stall"),
    "light": ("objection", "pricing", "competitor", "next_step_missing"),
    "on_demand": (),
    "off": (),
}
DEDUPE_WINDOW_S: dict[str, float] = {"full": 60.0, "guided": 60.0, "light": 120.0, "on_demand": 0.0, "off": 0.0}
REP_MICRO_PAUSE_S = 0.6          # swap a queued card at the rep's next pause of this length
CARD_TTL_MS = 12_000
CARD_TTL_HIGH_MS = 15_000
CARD_MIN_CONFIDENCE = 0.55
CARD_LATE_MS = 5_000             # delivered later than this after its trigger → passive note
# Card content: `say` is the primary content, a complete spoken-ready response the rep reads aloud.
HEADLINE_MAX_WORDS = 6
SAY_MIN_WORDS = 15
SAY_MAX_WORDS = 60            # default cards
SAY_MAX_WORDS_LONG = 120      # on-demand / "longer"
DETAIL_MAX_WORDS = 15         # optional small "why this works"
THEN_ASK_MAX_WORDS = 20
ASK_NEXT_MAX_WORDS = 16       # the strip's complete follow-up question
# Latency SLOs (trigger → first line visible), milliseconds.
SLO_TIER0_MS = 150
SLO_TIER1_MS = 400
SLO_FIRST_LINE_P50_MS = 1_200
SLO_FIRST_LINE_P95_MS = 2_500
# Backwards-compatible alias for early code paths.
PROACTIVE_INTERVAL_S = MIN_CARD_GAP_S
# Added by the live pipeline (Backend B), additively:
# Objection cards carry ``cue: "pause"`` (top reps pause ~5x longer) and explore-first phrasing.
CARD_STALE_AFTER_S = 8.0          # a queued card older than this is dropped: the moment has passed
INTENSITY_LADDER: tuple[str, ...] = ("full", "guided", "light", "on_demand", "off")   # degrade = move right
STRIP_INTENTS: tuple[str, ...] = (
    "pricing_question", "objection_price", "objection_timing", "objection_authority", "objection_need",
    "objection_trust", "objection_competitor", "objection_status_quo", "objection_integration",
    "objection_security", "brush_off", "competitor_mention", "buying_signal", "direct_question",
    "next_step", "small_talk", "statement",
)


# ── shapes ───────────────────────────────────────────────────────────────────

class WizardContext(TypedDict, total=False):
    """Stored under ``payload["wizard"]`` of a call context (local_call_contexts).

    Backend A writes it in ``POST /api/wizard/meetings/{id}/start`` (and from
    the extended ``CallStartRequest``); Backend B reads it to configure the
    coach for the session.
    """
    meeting_id: Optional[str]
    platform: Optional[str]
    channel: Optional[str]
    deal_value: Optional[str]
    deal_value_inr: Optional[float]
    methodology: str
    coaching_intensity: str
    battlecard_ids: list[str]
    battlecards: list[dict]          # compact copies: id, title, act, do_not, trigger_keywords, kind
    capsule_id: Optional[int]
    capsule_facts: list[dict]        # [{"label": "Price", "value": "₹2,400 / mo"}] verbatim rows the coach may quote
    brief: Optional[dict]            # the generated brief (see spec §5.2) or None
    consent: Optional[dict]          # {"mode": ConsentMode, "announced_at": iso, "script": str}
    keyterms: list[str]              # names for STT keyterm boosting (≤ 50)
    prospect_language_hint: Optional[str]   # "en-IN" | "hi-IN" | "hinglish"
    # Added by Backend A (additive): the bridge pre-roll reads these.
    bridge_disclosure: bool          # play the recording disclosure on bridged calls (integrations row, default True)
    notetaker_name: Optional[str]    # e.g. "ClozFlow Notetaker"
    prospect_name: Optional[str]
    company: Optional[str]
    intensity: str                   # same value as coaching_intensity (Intensity; default "guided")
    pre_rendered_cards: list[PreRenderedCard]   # Tier 0 cards: full spoken `say` text, instant on a keyword match


class PreRenderedCard(TypedDict, total=False):
    """A deal-tailored battlecard rendered at brief time (brief ``pre_rendered_cards``)."""
    battlecard_id: str
    headline: str                    # ≤ 6 words
    say: str                         # complete spoken text, SAY_MIN_WORDS–SAY_MAX_WORDS words
    say_lang: str                    # "en-IN" | "hinglish"
    then_ask: Optional[str]          # one complete question sentence
    trigger_keywords: list[str]      # English + Hinglish phrases, ≤ 12
    moment: str                      # Moment
    why: Optional[str]               # why this card is likely for this deal
    do_not: Optional[str]


class SourceRef(TypedDict, total=False):
    kind: Literal["capsule", "knowledge", "brief", "battlecard", "history", "lead", "manual"]
    label: str
    ref: Optional[str]


class CoachCard(TypedDict, total=False):
    id: str
    moment: str                      # Moment
    priority: str                    # Priority
    headline: str                    # ≤ 6-word label of the moment ("Price pushback")
    say: str                         # PRIMARY: complete spoken-ready text to read aloud, 1–3 sentences (25–60 words;
                                     # ≤ 120 on demand), in the prospect's language/register; streamed by sentence
    then_ask: Optional[str]          # one complete follow-up question to ask next, or None
    detail: Optional[str]            # ≤ 15 words "why this works", shown small; never required reading
    say_lang: Optional[str]          # "en-IN" | "hinglish" | "hi-IN"
    say_words: Optional[int]
    battlecard_id: Optional[str]
    sources: list[SourceRef]
    confidence: float                # 0–1
    ttl_ms: int
    turn_index: int
    trigger: str                     # Trigger
    latency_ms: Optional[int]        # trigger → card sent
    created_at: str                  # ISO-8601 UTC
    tier: int                        # 0 instant match, 1 classifier, 2 LLM coaching
    provisional: bool                # True for a Tier 0 card that Tier 2 may refine in place
    revision: int                    # same id, increasing; clients update in place
    late: bool                       # delivered > CARD_LATE_MS after its trigger → passive note
    cue: Optional[str]               # e.g. "pause" on objection cards
    stripped_claims: Optional[int]   # price/feature claims removed because no capsule fact backed them (Backend B)


class StripUpdate(TypedDict, total=False):
    """The continuous low-salience line under the card: where we are and what to ask next."""
    intent: str                      # e.g. pricing_question, objection_price, buying_signal, small_talk
    label: str                       # human label ≤ 3 words
    ask_next: Optional[str]          # ≤ ASK_NEXT_MAX_WORDS words, prospect's language
    stage: Optional[str]
    turn_index: int
    latency_ms: Optional[int]


class SttEvent(TypedDict, total=False):
    kind: Literal["partial", "final", "eot", "eager_eot", "resumed", "error"]
    channel: int
    text: str
    t_start: Optional[float]         # seconds since session start
    t_end: Optional[float]
    confidence: Optional[float]
    language: Optional[str]
    error: Optional[str]
    authoritative: bool              # eot decided by the vendor's turn model (flush at once)
    eot_confidence: Optional[float]


class TranscriptSegment(TypedDict, total=False):
    speaker: str                     # Speaker
    channel: int
    text: str
    t_start: Optional[float]
    t_end: Optional[float]
    timestamp: str                   # ISO-8601 (kept for legacy readers)
    is_final: bool


class Metrics(TypedDict, total=False):
    elapsed_s: float
    rep_talk_s: float
    prospect_talk_s: float
    talk_ratio_rep: Optional[float]      # 0–1, None until both have spoken
    longest_monologue_rep_s: float
    longest_monologue_prospect_s: float
    questions_rep: int
    questions_prospect: int
    interruptions_rep: int
    interruptions_prospect: int
    avg_rep_response_latency_s: Optional[float]
    silence_gaps_over_10s: int
    since_last_prospect_turn_s: float
    estimated: bool                      # True when speakers were inferred, not channel-tagged


class Nudge(TypedDict):
    kind: Literal["monologue", "talk_ratio", "no_questions", "silence"]
    text: str


class DealField(TypedDict, total=False):
    field: str
    label: str
    value: Optional[str]
    evidence_quote: Optional[str]
    speaker: Optional[str]
    confidence: float
    confirmed: Optional[bool]


class DealRecord(TypedDict, total=False):
    methodology: str
    fields: list[DealField]
    objections: list[dict]          # {type, quote, handled, how, battlecard_id, turn_index}
    buying_signals: list[dict]      # {quote, why, turn_index}
    risks: list[dict]               # {text, severity}
    next_step: Optional[dict]       # {text, date}
    stage: Optional[str]            # rapport|discovery|demo|pricing|objection|next_steps|close


class DealHealth(TypedDict):
    score: Optional[int]            # 0–100 or None before enough signal
    rationale: list[str]
    coverage: dict[str, bool]


# ── pure helpers ─────────────────────────────────────────────────────────────

_QUESTION_WORDS = (
    "what", "why", "how", "when", "where", "who", "which", "can", "could", "would", "should", "do", "does",
    "did", "is", "are", "will", "kya", "kaise", "kab", "kyun", "kyu", "kitna", "kitne", "kaun", "kahan",
)


def is_question(text: str) -> bool:
    """Cheap question detector for English and Hinglish turns."""
    t = (text or "").strip().lower()
    if not t:
        return False
    if t.endswith("?"):
        return True
    first = re.split(r"[\s,]+", t, maxsplit=1)[0]
    return first in _QUESTION_WORDS and len(t.split()) >= 3


def word_count(text: str) -> int:
    return len([w for w in re.split(r"\s+", (text or "").strip()) if w])


def clamp_words(text: str, max_words: int) -> str:
    words = [w for w in re.split(r"\s+", (text or "").strip()) if w]
    return " ".join(words[:max_words]) if len(words) > max_words else " ".join(words)


_LAKH = 100_000.0
_CRORE = 10_000_000.0


def parse_inr(text: Optional[str]) -> Optional[float]:
    """Parse deal values like "₹4.5L", "4,50,000", "12 lakh", "1.2 cr", "$2,400/mo" (→ None for non-INR)."""
    if not text:
        return None
    t = text.strip().lower().replace(",", "")
    if "$" in t or "usd" in t or "€" in t or "£" in t:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)\s*(cr|crore|crores|l|lac|lakh|lakhs|k)?", t)
    if not m:
        return None
    value = float(m.group(1))
    unit = m.group(2) or ""
    if unit in ("cr", "crore", "crores"):
        value *= _CRORE
    elif unit in ("l", "lac", "lakh", "lakhs"):
        value *= _LAKH
    elif unit == "k":
        value *= 1_000
    return value


def compute_metrics_from_transcript(segments: list[dict], elapsed_s: Optional[float] = None) -> Metrics:
    """Deterministic conversation metrics from speaker-labelled segments.

    Uses ``t_start``/``t_end`` when present; otherwise estimates speech time
    from word counts (≈ 2.5 words/s) and marks the result ``estimated``.
    """
    estimated = False
    rep_s = pros_s = 0.0
    longest = {"salesperson": 0.0, "prospect": 0.0}
    questions = {"salesperson": 0, "prospect": 0}
    interruptions = {"salesperson": 0, "prospect": 0}
    latencies: list[float] = []
    silence_gaps = 0
    run_speaker: Optional[str] = None
    run_len = 0.0
    prev_end: Optional[float] = None
    prev_speaker: Optional[str] = None
    last_prospect_end: Optional[float] = None
    for seg in segments:
        spk = seg.get("speaker") or "unknown"
        if spk in ("rep", "buyer"):
            spk = {"rep": "salesperson", "buyer": "prospect"}[spk]
        if spk not in ("salesperson", "prospect"):
            continue
        t0, t1 = seg.get("t_start"), seg.get("t_end")
        if t0 is None or t1 is None:
            estimated = True
            dur = max(0.4, word_count(seg.get("text", "")) / 2.5)
            t0 = prev_end if prev_end is not None else 0.0
            t1 = t0 + dur
        dur = max(0.0, float(t1) - float(t0))
        if spk == "salesperson":
            rep_s += dur
        else:
            pros_s += dur
        if is_question(seg.get("text", "")):
            questions[spk] += 1
        if spk == run_speaker:
            run_len += dur
        else:
            run_speaker, run_len = spk, dur
        longest[spk] = max(longest[spk], run_len)
        if prev_end is not None and prev_speaker and prev_speaker != spk:
            if float(t0) < prev_end - 0.3:
                interruptions[spk] += 1
            elif spk == "salesperson" and last_prospect_end is not None:
                latencies.append(max(0.0, float(t0) - last_prospect_end))
        if prev_end is not None and float(t0) - prev_end > 10.0:
            silence_gaps += 1
        if spk == "prospect":
            last_prospect_end = float(t1)
        prev_end = max(prev_end or 0.0, float(t1))
        prev_speaker = spk
    total = rep_s + pros_s
    elapsed = float(elapsed_s) if elapsed_s is not None else (prev_end or 0.0)
    return Metrics(
        elapsed_s=round(elapsed, 1),
        rep_talk_s=round(rep_s, 1),
        prospect_talk_s=round(pros_s, 1),
        talk_ratio_rep=(round(rep_s / total, 3) if total > 0 and rep_s > 0 and pros_s > 0 else None),
        longest_monologue_rep_s=round(longest["salesperson"], 1),
        longest_monologue_prospect_s=round(longest["prospect"], 1),
        questions_rep=questions["salesperson"],
        questions_prospect=questions["prospect"],
        interruptions_rep=interruptions["salesperson"],
        interruptions_prospect=interruptions["prospect"],
        avg_rep_response_latency_s=(round(sum(latencies) / len(latencies), 2) if latencies else None),
        silence_gaps_over_10s=silence_gaps,
        since_last_prospect_turn_s=round(max(0.0, elapsed - last_prospect_end), 1) if last_prospect_end is not None else 0.0,
        estimated=estimated,
    )


def empty_deal_record(methodology: str) -> DealRecord:
    fields = METHODOLOGIES.get(methodology or "none", METHODOLOGIES["none"])
    return DealRecord(
        methodology=methodology or "none",
        fields=[DealField(field=f, label=label, value=None, evidence_quote=None, speaker=None, confidence=0.0, confirmed=None)
                for f, label in fields],
        objections=[], buying_signals=[], risks=[], next_step=None, stage=None,
    )


def compute_deal_health(record: DealRecord, metrics: Optional[Metrics] = None) -> DealHealth:
    """Explainable deal health: field coverage 60 %, dated next step 20 %, risk and momentum 20 %."""
    fields = record.get("fields") or []
    known = [f for f in fields if f.get("value") and (f.get("confidence") or 0) >= 0.5]
    coverage = {f["field"]: bool(f.get("value")) for f in fields}
    if not fields and not record.get("next_step") and not record.get("objections"):
        return DealHealth(score=None, rationale=["Not enough of the conversation yet."], coverage=coverage)
    rationale: list[str] = []
    cov = (len(known) / len(fields)) if fields else 0.0
    score = 60.0 * cov
    rationale.append(f"{len(known)} of {len(fields)} {record.get('methodology', 'deal').upper()} fields covered.")
    ns = record.get("next_step") or {}
    if ns.get("date"):
        score += 20
        rationale.append("A dated next step is agreed.")
    elif ns.get("text"):
        score += 8
        rationale.append("Next step mentioned but not dated.")
    else:
        rationale.append("No next step yet.")
    unresolved = [o for o in (record.get("objections") or []) if not o.get("handled")]
    high_risks = [r for r in (record.get("risks") or []) if r.get("severity") == "high"]
    penalty = min(20.0, 6.0 * len(unresolved) + 5.0 * len(high_risks))
    if unresolved:
        rationale.append(f"{len(unresolved)} objection(s) still open.")
    if high_risks:
        rationale.append(f"{len(high_risks)} high risk(s) flagged.")
    momentum = 20.0 - penalty
    if record.get("buying_signals"):
        momentum = min(20.0, momentum + 4.0 * len(record["buying_signals"]))
        rationale.append(f"{len(record['buying_signals'])} buying signal(s) heard.")
    if metrics and metrics.get("talk_ratio_rep") is not None and metrics["talk_ratio_rep"] > 0.72:
        momentum -= 4
        rationale.append("Rep is talking more than 70 % of the time.")
    score += max(0.0, momentum)
    return DealHealth(score=int(round(max(0.0, min(100.0, score)))), rationale=rationale, coverage=coverage)


def utc_now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def legacy_analysis_from_card(card: CoachCard, deal_health: Optional[DealHealth] = None,
                              objection_type: Optional[str] = None, stage: Optional[str] = None) -> dict[str, Any]:
    """The old ``aiAnalysis.payload`` shape derived from a coach card, so existing UIs keep working."""
    say = card.get("say") or ""
    tip = card.get("detail") or card.get("then_ask") or ""
    payload: dict[str, Any] = {
        "response": say, "suggested_response": say,
        "coaching_tip": tip, "next_question": "", "next_best_question": "",
        "strategy": (card.get("headline") or "").upper(), "strategy_used": card.get("headline") or "",
        "persuasion_pattern": card.get("moment") or "info",
        "intent": card.get("moment") or "info", "type": card.get("moment") or "info",
        "stage": stage or "discovery", "deal_stage": stage or "discovery",
        "confidence": float(card.get("confidence") or 0.0),
        "objection_type": objection_type or "none",
        "engine": "coach", "card_id": card.get("id"),
    }
    if deal_health and deal_health.get("score") is not None:
        payload["deal_signal"] = deal_health["score"]
    return payload
