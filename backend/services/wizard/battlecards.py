"""Battlecard library: seeding, serialization, relevance scoring and trigger matching.

Cards follow Klue's Fact → Impact → Act shape (``fact``, ``impact``, ``act``), plus
``question_to_ask``, ``proof_point``, ``do_not`` (the trap) and ``psychology``. The
five legacy cards keep their ids (``pricing``, ``skepticism``, ``delay``, ``ego``,
``competitive``) so old clients still find them; ``reframe``/``trap`` are exposed
as aliases of ``act``/``do_not`` in ``serialize``.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from database import utc_isoformat
from models_wizard import WizardBattlecard, WizardMeeting

SEED_PATH = Path(__file__).with_name("battlecards_seed.json")

KINDS = ("objection", "competitive", "methodology", "india_context", "stage", "closing", "persona", "custom")
EDITABLE_FIELDS = ("kind", "category", "title", "tag", "accent", "trigger_keywords", "trigger_description", "fact",
                   "impact", "act", "act_hinglish", "question_to_ask", "proof_point", "do_not", "psychology",
                   "methodology_field", "tags", "is_active")

# Which coach "moment" a card kind / category maps to (for pre-rendered Tier 0 cards).
_CATEGORY_MOMENT = {
    "Cost & Budget": "pricing", "Competitor": "competitor", "Alternatives": "competitor", "Status quo": "objection",
    "Timing": "stall", "Pacing & Stall": "stall", "Brush-off": "stall", "Next step": "next_step_missing",
    "Close": "next_step_missing", "Rapport": "info",
}


def moment_for(card: WizardBattlecard) -> str:
    if card.kind in ("objection", "persona"):
        return _CATEGORY_MOMENT.get(card.category or "", "objection")
    if card.kind == "competitive":
        return "competitor"
    if card.kind in ("closing",):
        return "next_step_missing"
    if card.kind == "india_context":
        return _CATEGORY_MOMENT.get(card.category or "", "objection")
    return _CATEGORY_MOMENT.get(card.category or "", "info")

_INDUSTRY_HINTS = {
    "manufactur": ["working capital", "inventory", "tally", "erp", "promoter"],
    "retail": ["inventory", "upi", "festive", "diwali", "tally"],
    "saas": ["integration", "api", "security", "soc2", "trial"],
    "fintech": ["compliance", "security", "rbi", "kyc", "audit"],
    "bank": ["compliance", "security", "audit"],
    "health": ["compliance", "privacy", "dpdp"],
    "clinic": ["privacy", "whatsapp", "appointment"],
    "education": ["budget", "academic year", "fee"],
    "real estate": ["promoter", "cash", "negotiation"],
    "logistics": ["erp", "integration", "working capital"],
    "export": ["gst", "working capital", "payment terms"],
    "agency": ["retainer", "scope", "payment terms"],
}


# ── seed ─────────────────────────────────────────────────────────────────────

def load_seed() -> list[dict]:
    with SEED_PATH.open("r", encoding="utf-8") as handle:
        cards = json.load(handle)
    assert isinstance(cards, list)
    return cards


def seed_battlecards(db: Session, *, force: bool = False) -> int:
    """Insert seed cards that are missing (idempotent); ``force`` also refreshes existing seed rows.

    Returns the number of rows written.
    """
    existing = {row.id: row for row in db.query(WizardBattlecard).filter(WizardBattlecard.source == "seed").all()}
    written = 0
    for card in load_seed():
        row = existing.get(card["id"])
        if row is None:
            row = WizardBattlecard(id=card["id"], user_id=None, source="seed", is_active=True, usage_count=0)
            db.add(row)
        elif not force:
            continue
        for field in EDITABLE_FIELDS:
            if field == "is_active":
                continue
            setattr(row, field, card.get(field))
        row.kind = card.get("kind") or "objection"
        row.title = card.get("title") or card["id"]
        written += 1
    if written:
        db.commit()
    return written


def seed_if_empty(db: Session) -> int:
    """Startup hook: seed when no seed card exists yet, else add any new seed ids."""
    return seed_battlecards(db, force=False)


# ── serialization ────────────────────────────────────────────────────────────

def serialize(card: WizardBattlecard) -> dict:
    return {
        "id": card.id,
        "kind": card.kind,
        "category": card.category,
        "title": card.title,
        "tag": card.tag,
        "accent": card.accent,
        "trigger_keywords": list(card.trigger_keywords or []),
        "trigger_description": card.trigger_description,
        "fact": card.fact,
        "impact": card.impact,
        "act": card.act,
        "act_hinglish": card.act_hinglish,
        "question_to_ask": card.question_to_ask,
        "proof_point": card.proof_point,
        "do_not": card.do_not,
        "psychology": card.psychology,
        "methodology_field": card.methodology_field,
        "tags": list(card.tags or []),
        "is_active": bool(card.is_active),
        "usage_count": int(card.usage_count or 0),
        "source": card.source,
        "is_seed": card.user_id is None,
        "moment": moment_for(card),
        "created_at": utc_isoformat(card.created_at),
        "updated_at": utc_isoformat(card.updated_at),
        # legacy aliases for the five original cards' field names
        "reframe": card.act,
        "trap": card.do_not,
    }


def compact(card: WizardBattlecard) -> dict:
    """The copy stored in ``WizardContext.battlecards`` for the live coach."""
    return {"id": card.id, "title": card.title, "kind": card.kind, "moment": moment_for(card), "act": card.act,
            "act_hinglish": card.act_hinglish, "do_not": card.do_not, "question_to_ask": card.question_to_ask,
            "trigger_keywords": list(card.trigger_keywords or [])[:12]}


def headline_for(card: WizardBattlecard) -> str:
    """≤ 6-word label of the moment, derived from the title."""
    title = re.sub(r"[\"“”]", "", card.title or "").strip()
    title = re.sub(r"\s*\(.*?\)\s*", " ", title).strip()
    words = title.split()
    return " ".join(words[:6]) if words else (card.category or card.kind or "Clue")


def pre_rendered(card: WizardBattlecard, *, why: Optional[str] = None, say_lang: str = "en-IN",
                 say: Optional[str] = None, then_ask: Optional[str] = None, headline: Optional[str] = None) -> dict:
    """A Tier 0 card the clients can show instantly on a keyword match (brief ``pre_rendered_cards``).

    Deterministic fallback = the card's own ``act`` / ``act_hinglish`` text.
    """
    fallback = card.act_hinglish if (say_lang == "hinglish" and card.act_hinglish) else card.act
    text = (say or fallback or "").strip()
    return {
        "battlecard_id": card.id,
        "id": card.id,
        "headline": (headline or headline_for(card)).strip(),
        "say": text,
        "say_lang": say_lang if say_lang in ("en-IN", "hinglish", "hi-IN") else "en-IN",
        "say_words": len(text.split()),
        "then_ask": (then_ask or card.question_to_ask or None),
        "trigger_keywords": list(card.trigger_keywords or [])[:12],
        "moment": moment_for(card),
        "why": why,
        "do_not": card.do_not,
        "title": card.title,
        "kind": card.kind,
        "category": card.category,
    }


# ── queries ──────────────────────────────────────────────────────────────────

def visible_cards(db: Session, user_id: int, *, kind: Optional[str] = None, q: Optional[str] = None,
                  include_inactive: bool = False) -> list[WizardBattlecard]:
    query = db.query(WizardBattlecard).filter(or_(WizardBattlecard.user_id == user_id, WizardBattlecard.user_id.is_(None)))
    if not include_inactive:
        query = query.filter(WizardBattlecard.is_active.is_(True))
    if kind:
        query = query.filter(WizardBattlecard.kind == kind)
    cards = query.order_by(WizardBattlecard.kind, WizardBattlecard.category, WizardBattlecard.title).all()
    if q:
        needle = q.strip().lower()
        cards = [c for c in cards if needle in _haystack(c)]
    return cards


def _haystack(card: WizardBattlecard) -> str:
    parts = [card.title, card.category, card.kind, card.tag, card.trigger_description, card.fact, card.act, card.do_not,
             " ".join(card.trigger_keywords or []), " ".join(card.tags or [])]
    return " ".join(p for p in parts if p).lower()


def cards_by_ids(db: Session, user_id: int, ids: Iterable[str]) -> list[WizardBattlecard]:
    wanted = [i for i in dict.fromkeys(ids) if i]
    if not wanted:
        return []
    rows = db.query(WizardBattlecard).filter(
        WizardBattlecard.id.in_(wanted),
        or_(WizardBattlecard.user_id == user_id, WizardBattlecard.user_id.is_(None)),
    ).all()
    order = {i: n for n, i in enumerate(wanted)}
    return sorted(rows, key=lambda r: order.get(r.id, 999))


def copy_for_user(db: Session, card: WizardBattlecard, user_id: int, overrides: Optional[dict] = None) -> WizardBattlecard:
    clone = WizardBattlecard(id=str(uuid.uuid4()), user_id=user_id, source="user", is_active=True, usage_count=0)
    for field in EDITABLE_FIELDS:
        setattr(clone, field, getattr(card, field))
    clone.title = f"{card.title} (my copy)"
    for key, value in (overrides or {}).items():
        if key in EDITABLE_FIELDS and value is not None:
            setattr(clone, key, value)
    db.add(clone)
    db.commit()
    db.refresh(clone)
    return clone


# ── relevance scoring (spec §4 /battlecards/suggest) ─────────────────────────

_STOPWORDS = {
    "with", "what", "that", "this", "from", "have", "your", "will", "about", "their", "there", "they", "them", "than", "then",
    "when", "where", "which", "while", "would", "could", "should", "does", "into", "more", "most", "only", "over", "some",
    "such", "very", "just", "like", "also", "been", "being", "were", "much", "many", "need", "want", "make", "take",
    "call", "calls", "meeting", "discovery", "demo", "understand", "manager", "operations", "head", "team", "company", "business",
    "today", "right", "still", "every", "first", "last", "next", "time", "times", "hain", "nahi", "abhi", "kya", "hai", "karo",
    "karna", "baat", "yeh", "woh", "mein", "humein", "hum", "aap", "aapke", "toh", "bhi", "koi", "kuch", "sab", "se", "ke", "ka", "ki",
}


def _tokens(text: Optional[str]) -> set[str]:
    return {t for t in re.split(r"[^a-z0-9₹]+", (text or "").lower()) if len(t) >= 4 and t not in _STOPWORDS}


_FIRST_CALL_CORE = {"pricing", "obj-price-expensive", "obj-authority-boss", "obj-send-email", "delay", "obj-doing-fine",
                    "stage-next-step-dated", "close-dated-next-step", "in-promoter-signoff", "obj-excel-tally"}
_OWNER_ROLES = ("founder", "owner", "md", "ceo", "director", "proprietor", "partner", "promoter", "chairman")


def score_cards(cards: list[WizardBattlecard], meeting: WizardMeeting) -> list[tuple[WizardBattlecard, float, str]]:
    """Keyword + methodology + industry match. Returns (card, score, why) sorted by score desc."""
    selected = set(meeting.battlecard_ids or [])
    deal_text = " ".join(filter(None, [meeting.objective, meeting.industry, meeting.company, meeting.role,
                                       meeting.product_specification, meeting.title]))
    deal_tokens = _tokens(deal_text)
    industry = (meeting.industry or "").lower() + " " + (meeting.company or "").lower()
    hints: list[str] = []
    for key, words in _INDUSTRY_HINTS.items():
        if key in industry:
            hints.extend(words)
    value = meeting.deal_value_inr or 0.0
    role = (meeting.role or "").lower()
    non_owner = bool(role) and not any(r in role for r in _OWNER_ROLES)
    scored: list[tuple[WizardBattlecard, float, str]] = []
    for card in cards:
        if card.kind == "methodology" and card.methodology_field:
            if (meeting.methodology or "none") not in (card.tags or []):
                continue  # a card for another methodology
        score = 0.0
        why: list[str] = []
        if card.id in selected:
            score += 8.0   # an explicit pick always outranks heuristics
            why.append("picked for this meeting")
        base = {"objection": 1.5, "india_context": 1.0, "closing": 0.8, "stage": 0.6, "methodology": 1.2,
                "competitive": 0.8, "persona": 0.5, "custom": 0.6}.get(card.kind, 0.5)
        score += base
        if card.user_id is not None:
            score += 0.5
            why.append("your card")
        if card.id in _FIRST_CALL_CORE:
            score += 1.0
            why.append("comes up in most first calls")
        card_tokens = _tokens(" ".join(card.trigger_keywords or [])) | _tokens(" ".join(card.tags or [])) | _tokens(card.category)
        overlap = deal_tokens & card_tokens
        if overlap:
            score += min(3.0, 1.0 * len(overlap))
            why.append("matches " + ", ".join(sorted(overlap)[:3]))
        hint_hits = [h for h in hints if h in _haystack(card)]
        if hint_hits:
            score += min(2.0, 0.8 * len(hint_hits))
            why.append(f"common in {meeting.industry or 'this industry'}")
        if value >= 500_000 and card.id in ("in-promoter-signoff", "in-ca-finance-gate"):
            score += 1.0
            why.append("larger ticket: expect promoter and CA involvement")
        if non_owner and card.id in ("obj-authority-boss", "in-promoter-signoff", "meth-meddpicc-economic-buyer", "meth-bant-authority"):
            score += 1.0
            why.append(f"{meeting.role} is probably not the final approver")
        if meeting.channel == "phone_bridge" and card.id == "in-hinglish-mirroring":
            score += 0.6
        if meeting.methodology and card.kind == "methodology":
            why.append(f"{meeting.methodology.upper()} field")
        scored.append((card, round(score, 2), "; ".join(why) or "general"))
    scored.sort(key=lambda item: (-item[1], item[0].title))
    return scored


def suggest_for_meeting(db: Session, meeting: WizardMeeting, *, limit: int = 8) -> list[tuple[WizardBattlecard, float, str]]:
    cards = visible_cards(db, meeting.user_id)
    return score_cards(cards, meeting)[:limit]


# ── trigger matching (debrief objections, rehearsal hints) ───────────────────

def match_triggers(text: str, cards: Iterable[WizardBattlecard]) -> list[tuple[WizardBattlecard, str]]:
    """Cards whose trigger keywords appear in ``text`` (whole-word, case-insensitive), with the matched keyword."""
    lowered = f" {(text or '').lower()} "
    hits: list[tuple[WizardBattlecard, str]] = []
    for card in cards:
        for keyword in card.trigger_keywords or []:
            kw = (keyword or "").lower().strip()
            if not kw:
                continue
            pattern = r"(?<![a-z0-9])" + re.escape(kw) + r"(?![a-z0-9])"
            if re.search(pattern, lowered):
                hits.append((card, keyword))
                break
    return hits


def bump_usage(db: Session, ids: Iterable[str]) -> None:
    wanted = [i for i in set(ids) if i]
    if not wanted:
        return
    for row in db.query(WizardBattlecard).filter(WizardBattlecard.id.in_(wanted)).all():
        row.usage_count = (row.usage_count or 0) + 1
        row.updated_at = datetime.utcnow()
    db.commit()
