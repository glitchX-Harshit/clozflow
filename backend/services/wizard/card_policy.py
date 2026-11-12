"""Card policy: decides whether a coach card is shown now, queued, or dropped.

Pure functions over plain data (no clocks, no I/O), so the rules in
``scratchpad/wizard/LIVE_LATENCY_PLAN.md`` §2 are unit-testable:

* proactive cards only for ``PROACTIVE_MOMENTS[intensity]``; ``on_demand``/``off`` never show auto cards;
* anti-flicker: a visible card is replaced no sooner than ``MIN_CARD_GAP_S[intensity]`` after it was shown,
  unless the new card has a higher priority (then it replaces immediately);
* dedupe the same ``(moment, battlecard_id)`` within ``DEDUPE_WINDOW_S[intensity]``;
* snoozed moments are suppressed;
* confidence below ``CARD_MIN_CONFIDENCE`` is dropped unless ``priority == "high"`` (Tier 0 matches are exempt);
* while the rep speaks, cards are queued and swapped in at the next micro-pause; ``high`` may interrupt;
* a revision of the card that is already visible always goes through (clients update in place);
* on-demand cards (``what_to_say`` / ``ask``) bypass every gate;
* price/feature claims are allowed only when a capsule fact backs them (verbatim number match); otherwise
  the sentence is removed and the confidence lowered.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from services.wizard import contracts as C

PRIORITY_RANK = {"low": 0, "normal": 1, "high": 2}
STRIP_CONFIDENCE_PENALTY = 0.15


@dataclass
class ShownCard:
    id: str
    moment: str
    battlecard_id: Optional[str]
    priority: str
    shown_at: float
    ttl_ms: int
    trigger: str = "auto"


@dataclass
class PolicyState:
    intensity: str = "guided"
    rep_speaking: bool = False
    visible: Optional[ShownCard] = None
    recent: list = field(default_factory=list)        # [(moment, battlecard_id, shown_at)]
    snoozed: dict = field(default_factory=dict)       # moment -> until (seconds, same clock as ``now``)
    sent_times: list = field(default_factory=list)    # shown_at of every card, for the per-minute cap
    max_cards_per_min: int = 4


@dataclass
class Decision:
    action: str          # "show" | "queue" | "drop"
    reason: str
    card: dict


def rank(priority: Optional[str]) -> int:
    return PRIORITY_RANK.get(str(priority or "normal"), 1)


def ttl_for(priority: Optional[str]) -> int:
    return C.CARD_TTL_HIGH_MS if priority == "high" else C.CARD_TTL_MS


def is_visible(state: PolicyState, now: float) -> bool:
    shown = state.visible
    return shown is not None and now < shown.shown_at + shown.ttl_ms / 1000.0


def expire(state: PolicyState, now: float) -> None:
    """Forget what no longer matters (old dedupe entries, old rate-cap stamps, elapsed snoozes)."""
    window = max(C.DEDUPE_WINDOW_S.values())
    state.recent = [entry for entry in state.recent if now - entry[2] <= window]
    state.sent_times = [t for t in state.sent_times if now - t <= 60.0]
    state.snoozed = {moment: until for moment, until in state.snoozed.items() if until > now}


def mark_shown(state: PolicyState, card: dict, now: float) -> None:
    """Record that ``card`` is on screen now."""
    revision = int(card.get("revision") or 1)
    if state.visible is not None and state.visible.id == card.get("id") and revision > 1:
        # In-place refinement: keep the original shown_at so the anti-flicker gap is unchanged.
        state.visible.priority = card.get("priority") or state.visible.priority
        state.visible.moment = card.get("moment") or state.visible.moment
        state.visible.battlecard_id = card.get("battlecard_id")
        state.visible.ttl_ms = int(card.get("ttl_ms") or state.visible.ttl_ms)
        return
    state.visible = ShownCard(
        id=str(card.get("id")), moment=str(card.get("moment") or "info"), battlecard_id=card.get("battlecard_id"),
        priority=str(card.get("priority") or "normal"), shown_at=now, ttl_ms=int(card.get("ttl_ms") or C.CARD_TTL_MS),
        trigger=str(card.get("trigger") or "auto"))
    state.recent.append((state.visible.moment, state.visible.battlecard_id, now))
    state.sent_times.append(now)


def evaluate(card: dict, state: PolicyState, *, now: float, capsule_facts=()) -> Decision:
    """Decide for one card. ``card`` is a ``contracts.CoachCard``-shaped dict."""
    card = dict(card)
    card, stripped = strip_unverified_claims(card, capsule_facts)
    if stripped:
        card["stripped_claims"] = stripped
    if not (card.get("say") or card.get("headline")):
        return Decision("drop", "empty", card)
    on_demand = card.get("trigger") in ("on_demand", "ask")
    revision = int(card.get("revision") or 1)
    priority = str(card.get("priority") or "normal")
    card.setdefault("ttl_ms", ttl_for(priority))
    if on_demand:
        return Decision("show", "on_demand", card)
    if state.visible is not None and state.visible.id == card.get("id") and revision > 1 and is_visible(state, now):
        return Decision("show", "revision", card)
    intensity = state.intensity if state.intensity in C.PROACTIVE_MOMENTS else "guided"
    allowed = C.PROACTIVE_MOMENTS.get(intensity, ())
    if not allowed:
        return Decision("drop", "intensity", card)
    moment = str(card.get("moment") or "info")
    if moment not in allowed:
        return Decision("drop", "moment_not_proactive", card)
    until = state.snoozed.get(moment)
    if until is not None and until > now:
        return Decision("drop", "snoozed", card)
    window = C.DEDUPE_WINDOW_S.get(intensity, 60.0)
    battlecard_id = card.get("battlecard_id")
    for recent_moment, recent_bc, shown_at in state.recent:
        if recent_moment == moment and recent_bc == battlecard_id and now - shown_at < window:
            if state.visible is not None and state.visible.id == card.get("id"):
                continue
            return Decision("drop", "duplicate", card)
    confidence = float(card.get("confidence") or 0.0)
    tier = card.get("tier")
    tier = 2 if tier is None else int(tier)
    if tier != 0 and confidence < C.CARD_MIN_CONFIDENCE and priority != "high":
        return Decision("drop", "low_confidence", card)
    if len([t for t in state.sent_times if now - t < 60.0]) >= max(1, int(state.max_cards_per_min)):
        return Decision("drop", "rate_cap", card)
    if state.rep_speaking and priority != "high":
        return Decision("queue", "rep_speaking", card)
    if is_visible(state, now):
        shown = state.visible
        gap = C.MIN_CARD_GAP_S.get(intensity) or 0.0
        if shown.id != card.get("id") and now - shown.shown_at < gap and rank(priority) <= rank(shown.priority):
            return Decision("queue", "min_gap", card)
    return Decision("show", "ok", card)


def wait_for_gap(state: PolicyState, now: float) -> float:
    """Seconds until the anti-flicker gap of the visible card has passed (0 when nothing is visible)."""
    if not is_visible(state, now) or state.visible is None:
        return 0.0
    gap = C.MIN_CARD_GAP_S.get(state.intensity) or 0.0
    return max(0.0, state.visible.shown_at + gap - now)


# ── grounding: numbers and absolute claims only from capsule facts ────────────

_CURRENCY = r"(?:₹|rs\.?|inr|\$|usd|€|£)"
_UNIT = r"(?:k|l|lakh|lakhs|lac|cr|crore|crores|%|percent|rupees|per\s+(?:month|user|seat|year|annum|mo)|/\s?(?:mo|month|user|yr|year|seat))"
PRICE_RE = re.compile(
    rf"{_CURRENCY}\s?\d[\d,]*(?:\.\d+)?\s?{_UNIT}?|\b\d[\d,]*(?:\.\d+)?\s?{_UNIT}",
    re.IGNORECASE,
)
FEATURE_CLAIM_RE = re.compile(
    r"\b(?:unlimited|24/7|24x7|guaranteed?|free forever|no limit|lifetime|iso\s?\d+|soc\s?2|gdpr|hipaa|99\.\d+\s?%)\b",
    re.IGNORECASE,
)
_NUMBER_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?।])\s+")


def _fact_index(capsule_facts) -> tuple[str, set]:
    """(lower-cased fact text, the set of numbers it contains with commas removed)."""
    parts = []
    for fact in capsule_facts or ():
        if isinstance(fact, dict):
            parts.append(str(fact.get("label") or ""))
            parts.append(str(fact.get("value") or ""))
        else:
            parts.append(str(fact))
    text = " ".join(parts).lower()
    numbers = {n.replace(",", "") for n in _NUMBER_RE.findall(text)}
    return text, numbers


def _claim_backed(claim: str, index: tuple[str, set]) -> bool:
    """A numeric claim is backed when every number in it is a number of a fact row (whole numbers,
    so 40 does not hide inside 2400); a wordy claim ("unlimited") when the facts say it."""
    text, numbers = index
    found = [n.replace(",", "") for n in _NUMBER_RE.findall(claim)]
    if found:
        return all(n in numbers for n in found)
    return bool(text) and claim.lower().strip() in text


def _scrub(text: Optional[str], index: tuple[str, set]) -> tuple[Optional[str], int]:
    if not text:
        return text, 0
    removed = 0
    kept = []
    for sentence in _SENTENCE_SPLIT.split(text.strip()):
        if not sentence:
            continue
        claims = [m.group(0) for m in PRICE_RE.finditer(sentence)] + [m.group(0) for m in FEATURE_CLAIM_RE.finditer(sentence)]
        if claims and not all(_claim_backed(c, index) for c in claims):
            removed += 1
            continue
        kept.append(sentence)
    return (" ".join(kept).strip() or None), removed


def strip_unverified_claims(card: dict, capsule_facts=()) -> tuple[dict, int]:
    """Remove sentences with prices/absolute feature claims that no capsule fact row backs.

    The headline keeps its words minus the unverified number; ``say``/``detail``/``then_ask`` lose the
    whole sentence. Returns the cleaned card and the number of removed claims; confidence drops by
    ``STRIP_CONFIDENCE_PENALTY`` per removal.
    """
    card = dict(card)
    index = _fact_index(capsule_facts)
    removed = 0
    for key in ("say", "detail", "then_ask"):
        cleaned, n = _scrub(card.get(key), index)
        if n:
            card[key] = cleaned
            removed += n
    headline = card.get("headline") or ""
    if headline:
        def _drop_unbacked(match):
            nonlocal removed
            if _claim_backed(match.group(0), index):
                return match.group(0)
            removed += 1
            return ""
        new_headline = PRICE_RE.sub(_drop_unbacked, headline)
        new_headline = FEATURE_CLAIM_RE.sub(_drop_unbacked, new_headline)
        card["headline"] = re.sub(r"\s{2,}", " ", new_headline).strip(" ,:-") or headline
    if removed:
        card["confidence"] = max(0.0, round(float(card.get("confidence") or 0.0) - STRIP_CONFIDENCE_PENALTY * removed, 3))
        if card.get("say"):
            card["say_words"] = C.word_count(card["say"])
    return card, removed
