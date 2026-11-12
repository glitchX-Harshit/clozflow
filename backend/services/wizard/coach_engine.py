"""The live coach: three tiers of clues, one visible card, event-driven cadence.

Per ``scratchpad/wizard/LIVE_LATENCY_PLAN.md``:

* **Tier 0** (``Tier0Matcher``): on every prospect partial, a keyword/phrase match against the
  deal's pre-rendered cards and battlecards shows a ``provisional`` card at once (no LLM).
* **Tier 1** (``classify_segment``): on every prospect final segment, a deterministic classifier
  emits the ``strip`` (intent, label, complete follow-up question, stage) and ``moment`` chips,
  and updates the deal record with objections / buying signals.
* **Tier 2** (``CoachSession._run_tier2``): one structured, streamed LLM call per prospect turn
  (started at ``EagerEndOfTurn``, cancelled on ``TurnResumed``, newest trigger wins). The card is
  emitted as soon as the first sentence of ``say`` is parsed (``revision: 1``) and completed in
  place (``revision: 2``). On-demand (``what_to_say`` / ``ask``) uses the same path and bypasses
  every gate. On any failure nothing is emitted (never a fallback card).

``card_policy`` decides show / queue / drop; ``MetricsTracker`` and ``DealRecordTracker`` are
updated here and emitted as ``metrics`` (every 10 s), ``deal_record`` and ``deal_health`` (on
change). A ``CostMeter`` counts STT seconds and LLM tokens; the degrade ladder (headline-only →
Tier 0/1 only; cards/min and session caps → lower intensity) is announced with
``notice{code: "slow" | "degraded"}``. Transcript text is never logged.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import statistics
import time
import uuid
from typing import Any, AsyncIterator, Awaitable, Callable, Optional

from services.wizard import card_policy, contracts as C, prompts
from services.wizard.deal_record import DealRecordTracker
from services.wizard.metrics import MetricsTracker

log = logging.getLogger("clozflow.coach")

Emit = Callable[[dict], Awaitable[None]]

LLM_TIMEOUT_S = 6.0
RETRIEVAL_BUDGET_S = 0.3
MAX_TOKENS = 350
MAX_TOKENS_HEADLINE_ONLY = 120
METRICS_INTERVAL_S = 10.0
TICK_INTERVAL_S = 0.25
NEXT_STEP_CHIP_AFTER_S = 25 * 60
NEXT_STEP_CHIP_EVERY_S = 10 * 60
CHIP_DEDUPE_S = 20.0
ESCALATION_WINDOW_S = 120.0
LATE_STREAK_HEADLINE_ONLY = 3
LATE_STREAK_TIER2_OFF = 6
RATE_CAP_HITS_TO_DEGRADE = 2
DEFAULT_MAX_CARDS_PER_MIN = 4
DEFAULT_SESSION_MAX_MINUTES = 120
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite"
DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"
GROQ_BASE_URL = "https://api.groq.com/openai/v1"
ASK_MAX_CHARS = 500


# ── configuration ────────────────────────────────────────────────────────────

def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or "").strip() or default


def _env_int(name: str, default: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(_env(name) or default)))
    except ValueError:
        return default


def max_cards_per_min() -> int:
    return _env_int("CLOZFLOW_COACH_MAX_CARDS_PER_MIN", DEFAULT_MAX_CARDS_PER_MIN, 1, 60)


def session_max_minutes() -> int:
    return _env_int("CLOZFLOW_SESSION_MAX_MINUTES", DEFAULT_SESSION_MAX_MINUTES, 1, 24 * 60)


def coach_model() -> str:
    return _env("CLOZFLOW_COACH_MODEL", DEFAULT_GEMINI_MODEL)


def coach_groq_model() -> str:
    return _env("CLOZFLOW_COACH_GROQ_MODEL", DEFAULT_GROQ_MODEL)


# ── LLM adapters (streamed text deltas of one JSON object) ───────────────────

class GeminiCoachLLM:
    name = "gemini"

    def __init__(self, api_key: str, model: Optional[str] = None):
        self._api_key = api_key
        self.model = model or coach_model()
        self._client = None

    def _client_or_create(self):
        if self._client is None:
            from google import genai
            self._client = genai.Client(api_key=self._api_key)
        return self._client

    def _config(self, system: str, schema: dict, max_tokens: int, *, thinking: bool):
        from google.genai import types
        kwargs: dict[str, Any] = dict(
            system_instruction=system, response_mime_type="application/json", response_schema=schema,
            max_output_tokens=max_tokens, temperature=0.4)
        if thinking:
            kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
        return types.GenerateContentConfig(**kwargs)

    async def warmup(self) -> None:
        try:
            client = self._client_or_create()
            from google.genai import types
            await client.aio.models.generate_content(
                model=self.model, contents="ok",
                config=types.GenerateContentConfig(max_output_tokens=4, temperature=0.0))
        except Exception as exc:   # noqa: BLE001 - warm-up is best effort
            log.info("coach warm-up skipped (%s)", type(exc).__name__)

    async def stream(self, system: str, user: str, schema: dict, *, max_tokens: int = MAX_TOKENS) -> AsyncIterator[str]:
        client = self._client_or_create()
        try:
            response = await client.aio.models.generate_content_stream(
                model=self.model, contents=user, config=self._config(system, schema, max_tokens, thinking=True))
        except Exception as exc:  # noqa: BLE001
            if "thinking" not in str(exc).lower() and "budget" not in str(exc).lower():
                raise
            response = await client.aio.models.generate_content_stream(
                model=self.model, contents=user, config=self._config(system, schema, max_tokens, thinking=False))
        async for chunk in response:
            text = getattr(chunk, "text", None)
            if text:
                yield text


class GroqCoachLLM:
    """Groq's OpenAI-compatible JSON mode (no streaming in JSON mode: one delta)."""
    name = "groq"

    def __init__(self, api_key: str, model: Optional[str] = None):
        from openai import AsyncOpenAI
        self.model = model or coach_groq_model()
        self._client = AsyncOpenAI(api_key=api_key, base_url=GROQ_BASE_URL)

    async def warmup(self) -> None:
        return None

    async def stream(self, system: str, user: str, schema: dict, *, max_tokens: int = MAX_TOKENS) -> AsyncIterator[str]:
        response = await self._client.chat.completions.create(
            model=self.model, temperature=0.4, max_tokens=max_tokens, response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system + "\n\nJSON SCHEMA:\n" + prompts.schema_as_text(schema)},
                      {"role": "user", "content": user}])
        content = response.choices[0].message.content if response.choices else ""
        if content:
            yield content


def select_llm():
    """Gemini (flash-lite class) when ``GEMINI_API_KEY`` is set, else Groq like the legacy engine, else None."""
    if _env("GEMINI_API_KEY"):
        return GeminiCoachLLM(_env("GEMINI_API_KEY"))
    if _env("GROQ_API_KEY"):
        return GroqCoachLLM(_env("GROQ_API_KEY"))
    return None


def describe_llm() -> dict:
    if _env("GEMINI_API_KEY"):
        return {"vendor": "gemini", "model": coach_model(), "ready": True}
    if _env("GROQ_API_KEY"):
        return {"vendor": "groq", "model": coach_groq_model(), "ready": True}
    return {"vendor": None, "model": None, "ready": False,
            "reason": "No LLM key configured (GEMINI_API_KEY or GROQ_API_KEY): transcript, strip and instant cards only."}


# ── knowledge retrieval (300 ms budget, skipped on timeout) ──────────────────

async def default_retriever(query: str) -> list[dict]:
    """Top-3 chunks from the repo's FAISS corpus within ``RETRIEVAL_BUDGET_S`` (the first call usually
    times out while the model loads in its thread; later calls hit). Never blocks the event loop."""
    def run():
        from rag.rag_engine import RAGEngine   # heavy import (faiss, sentence-transformers): in the thread
        results = RAGEngine.get_instance().retrieve(query, k=3)
        return [r if isinstance(r, dict) else {"text": str(r)} for r in results]

    try:
        return await asyncio.wait_for(asyncio.to_thread(run), RETRIEVAL_BUDGET_S)
    except Exception:  # noqa: BLE001 - timeout, missing package or index: grounding comes from the facts alone
        return []


# ── cost meter ───────────────────────────────────────────────────────────────

class CostMeter:
    def __init__(self):
        self.stt_seconds: dict[str, float] = {}
        self.llm_calls = 0
        self.llm_input_chars = 0
        self.llm_output_chars = 0
        self.cards_sent = 0
        self.strips = 0
        self.rate_cap_hits = 0

    def add_stt(self, vendor: str, seconds: float) -> None:
        self.stt_seconds[vendor] = round(self.stt_seconds.get(vendor, 0.0) + max(0.0, seconds), 1)

    def add_llm(self, prompt_chars: int, output_chars: int) -> None:
        self.llm_calls += 1
        self.llm_input_chars += max(0, prompt_chars)
        self.llm_output_chars += max(0, output_chars)

    def summary(self) -> dict:
        return {"stt_seconds": dict(self.stt_seconds), "llm_calls": self.llm_calls,
                "llm_tokens_in_est": self.llm_input_chars // 4, "llm_tokens_out_est": self.llm_output_chars // 4,
                "cards_sent": self.cards_sent, "strips": self.strips}


# ── Tier 0: instant keyword match → pre-rendered card ───────────────────────

_KIND_MOMENT = {"objection": "objection", "competitive": "competitor", "india_context": "objection",
                "closing": "next_step_missing", "persona": "info", "custom": "info", "stage": "info", "methodology": "info"}
_PRICING_HINT = re.compile(r"price|pricing|cost|budget|expensive|mehenga|discount|₹|rupee", re.I)


def _keyword_regex(keywords) -> Optional[re.Pattern]:
    terms = sorted({str(k).strip().lower() for k in keywords or () if str(k).strip() and len(str(k).strip()) >= 3}, key=len, reverse=True)
    if not terms:
        return None
    return re.compile(r"(?<![a-z0-9])(?:" + "|".join(re.escape(t) for t in terms) + r")(?![a-z0-9])")


class Tier0Matcher:
    def __init__(self, wizard: Optional[dict]):
        wizard = wizard or {}
        self.entries: list[tuple[re.Pattern, dict]] = []
        seen: set[str] = set()
        brief = wizard.get("brief") if isinstance(wizard.get("brief"), dict) else {}
        for pre in list(wizard.get("pre_rendered_cards") or []) + list(brief.get("pre_rendered_cards") or []):
            if not isinstance(pre, dict) or not (pre.get("say") or pre.get("act")):
                continue
            bc_id = pre.get("battlecard_id")
            if bc_id in seen:
                continue
            pattern = _keyword_regex(pre.get("trigger_keywords"))
            if pattern is None:
                continue
            seen.add(bc_id)
            moment = pre.get("moment") or ("pricing" if _PRICING_HINT.search(str(pre.get("headline") or pre.get("title") or "")) else "objection")
            self.entries.append((pattern, {
                "moment": moment, "priority": "normal",
                "headline": C.clamp_words(str(pre.get("headline") or pre.get("title") or ""), C.HEADLINE_MAX_WORDS),
                "say": str(pre.get("say") or pre.get("act")), "say_lang": pre.get("say_lang") or prompts.detect_say_lang(str(pre.get("say") or "")),
                "then_ask": pre.get("then_ask") or pre.get("question_to_ask"), "detail": None,
                "battlecard_id": bc_id, "sources": [{"kind": "battlecard", "label": str(pre.get("headline") or pre.get("title") or "Battlecard")[:60], "ref": bc_id}],
                "confidence": 0.6,
            }))
        for card in wizard.get("battlecards") or []:
            if not isinstance(card, dict) or not card.get("id") or card["id"] in seen or not card.get("act"):
                continue
            pattern = _keyword_regex(card.get("trigger_keywords"))
            if pattern is None:
                continue
            kind = str(card.get("kind") or "custom")
            moment = _KIND_MOMENT.get(kind, "info")
            if _PRICING_HINT.search(str(card.get("title") or "")) and kind in ("objection", "india_context"):
                moment = "pricing"
            seen.add(card["id"])
            self.entries.append((pattern, {
                "moment": moment, "priority": "normal",
                "headline": C.clamp_words(str(card.get("title") or ""), C.HEADLINE_MAX_WORDS),
                "say": str(card.get("act")), "say_lang": prompts.detect_say_lang(str(card.get("act"))),
                "then_ask": card.get("question_to_ask"), "detail": None, "battlecard_id": card["id"],
                "sources": [{"kind": "battlecard", "label": str(card.get("title") or "Battlecard")[:60], "ref": card["id"]}],
                "confidence": 0.6,
            }))

    def match(self, text: str) -> Optional[dict]:
        hay = (text or "").lower()
        if len(hay) < 3:
            return None
        for pattern, template in self.entries:
            found = pattern.search(hay)
            if found:
                card = dict(template)
                card["sources"] = [dict(s) for s in template["sources"]]
                card["matched"] = found.group(0)
                if card["moment"] == "objection":
                    card["cue"] = "pause"
                return card
        return None


# ── Tier 1: deterministic segment classifier → strip + chips ────────────────

_INTENT_RULES: list[tuple[str, re.Pattern]] = [
    ("brush_off", re.compile(r"send (?:me|us) (?:an? )?(?:email|mail|details|deck|proposal)|whatsapp (?:kar|pe|par) ?(?:do|bhej)?|"
                              r"call (?:me )?(?:back )?(?:later|next)|not interested|think about it|get back to you|"
                              r"discuss internally|dekhte hain|sochte hain|baad mein (?:baat|dekh)|too busy|"
                              r"bhej do|share (?:the )?details", re.I)),
    ("objection_price", re.compile(r"too (?:expensive|costly|much|high)|expensive|costly|mehe?nga|bahut zyada|"
                                   r"can'?t afford|out of (?:our )?budget|budget nahi|no budget|over budget|"
                                   r"cheaper|kam karo|discount (?:chahiye|do|milega)", re.I)),
    ("objection_timing", re.compile(r"next (?:quarter|month|year|financial year|fy)|after (?:diwali|march|the )|not (?:right )?now|"
                                    r"abhi nahi|baad mein|later this year|not the right time|q[1-4] next|few months", re.I)),
    ("objection_authority", re.compile(r"(?:my|our) (?:boss|manager|md|ceo|cfo|director|partner|promoter|team|committee|board)|"
                                       r"check with|ask (?:my|the) |decision ?maker|sir se (?:baat|pooch)|"
                                       r"not my (?:call|decision)|discuss with (?:my|the) team|upar se", re.I)),
    ("objection_need", re.compile(r"don'?t (?:really )?need|no need|not (?:a )?priority|we manage (?:fine|with)|"
                                  r"(?:excel|tally|spreadsheet|whatsapp group) (?:works|is fine|se ho jata)|zaroorat nahi|"
                                  r"why (?:would|do) we need|doing fine|kaam chal", re.I)),
    ("objection_trust", re.compile(r"tried (?:this|something|a tool|one) before|didn'?t work|failed (?:last|before)|"
                                   r"not sure (?:it|this) (?:works|will)|how do (?:i|we) know|proof|references?|"
                                   r"case stud(?:y|ies)|guarantee|bharosa|trust", re.I)),
    ("objection_status_quo", re.compile(r"happy with (?:our|the) current|works for us|current (?:system|vendor|setup) is fine|"
                                        r"no reason to (?:change|switch)|why change|abhi theek chal", re.I)),
    ("objection_integration", re.compile(r"integrat(?:e|ion)|works? with (?:our|tally|zoho|sap|erp|crm)|api|sync with|"
                                         r"tally (?:ke saath|se)|existing (?:system|software)", re.I)),
    ("objection_security", re.compile(r"security|secure|compliance|complian|data (?:privacy|protection|residency)|"
                                      r"dpdp|gdpr|soc ?2|iso ?27001|where is (?:the )?data|encryption", re.I)),
    ("competitor_mention", re.compile(r"(?:already|currently) (?:using|use|have|with)|other (?:vendor|tool|option|provider)|"
                                      r"another (?:tool|vendor|company)|compared? (?:to|with)|competitor|"
                                      r"(?:zoho|freshworks|salesforce|hubspot|leadsquared|tally|busy|marg|vyapar|khatabook|gong|fireflies)", re.I)),
    ("buying_signal", re.compile(r"implement|rollout|roll out|onboard|go live|how (?:soon|fast|long) (?:can|to|does|would|will)|"
                                 r"when can we start|start kar|kab se|trial|pilot|poc|contract|agreement|sla|"
                                 r"how many (?:users|licen)|our team (?:would|will|can) use|if we (?:go ahead|sign)", re.I)),
    ("next_step", re.compile(r"next step|follow[- ]?up|schedule|calendar|set up (?:a )?(?:call|meeting|demo)|"
                             r"kab milte|proposal|send (?:the|a) (?:quote|quotation)|let'?s meet", re.I)),
    ("pricing_question", re.compile(r"price|pricing|cost|charges?|fees?|rate|kitna (?:padega|lagega|hoga|hai)|kitne ka|"
                                    r"per (?:month|user|seat|year|annum)|annual|subscription|gst|how much", re.I)),
]
_COMPETITOR_BRANDS = re.compile(r"\b(?:zoho|freshworks|salesforce|hubspot|leadsquared|tally|busy|marg|vyapar|khatabook|gong|fireflies)\b", re.I)
_SMALL_TALK_WORDS = frozenset((
    "hi", "hello", "hey", "good", "morning", "afternoon", "evening", "namaste", "namaskar", "haan", "ha", "yes", "yeah",
    "ok", "okay", "theek", "hai", "sure", "right", "hmm", "hmmm", "achha", "accha", "thanks", "thank", "you", "great",
    "fine", "how", "are", "doing", "nice", "to", "meet", "please", "go", "ahead", "bolo", "boliye", "ji", "sir", "madam",
))
_SMALL_TALK_LEAD = re.compile(r"^(?:how are you|nice to meet you|good (?:morning|afternoon|evening))\b", re.I)


def _is_small_talk(text: str) -> bool:
    words = re.findall(r"[a-z]+", text.lower())
    if not words or len(words) > 6:
        return False
    return _SMALL_TALK_LEAD.match(text) is not None or all(w in _SMALL_TALK_WORDS for w in words)
_ESCALATION = re.compile(r"discount|% ?off|percent off|lower (?:the )?price|reduce (?:the )?price|special (?:price|offer|rate)|"
                         r"best price|kam kar (?:denge|sakte|deta)|sasta kar|free (?:month|year)|waive|"
                         r"last chance|offer ends|only (?:today|this week)|limited (?:time|period)|miss out|"
                         r"you'?ll lose|competitors? (?:are )?already|everyone (?:is|else) (?:using|moving)|"
                         r"jaldi (?:karo|karna|decide)|abhi nahi to(?:h)?|price (?:will )?(?:go|goes) up", re.I)

INTENT_LABELS = {
    "pricing_question": "Pricing question", "objection_price": "Price pushback", "objection_timing": "Timing objection",
    "objection_authority": "Authority objection", "objection_need": "Need objection", "objection_trust": "Trust objection",
    "objection_competitor": "Competitor objection", "objection_status_quo": "Status quo", "objection_integration": "Integration question",
    "objection_security": "Security question", "brush_off": "Brush-off", "competitor_mention": "Competitor mentioned",
    "buying_signal": "Buying signal", "direct_question": "Direct question", "next_step": "Next step", "small_talk": "Small talk",
    "statement": "Listening",
}
INTENT_MOMENT = {
    "pricing_question": "pricing", "objection_price": "objection", "objection_timing": "objection", "objection_authority": "objection",
    "objection_need": "objection", "objection_trust": "objection", "objection_competitor": "objection", "objection_status_quo": "objection",
    "objection_integration": "objection", "objection_security": "objection", "brush_off": "stall", "competitor_mention": "competitor",
    "buying_signal": "buying_signal", "direct_question": "question", "next_step": None, "small_talk": None, "statement": None,
}
INTENT_OBJECTION_TYPE = {
    "objection_price": "price", "objection_timing": "timing", "objection_authority": "authority", "objection_need": "need",
    "objection_trust": "trust", "objection_competitor": "competitor", "objection_status_quo": "status_quo",
    "objection_integration": "integration", "objection_security": "security_compliance", "brush_off": "brush_off",
}
INTENT_STAGE = {
    "pricing_question": "pricing", "objection_price": "objection", "objection_timing": "objection", "objection_authority": "objection",
    "objection_need": "objection", "objection_trust": "objection", "objection_competitor": "objection", "objection_status_quo": "objection",
    "objection_integration": "objection", "objection_security": "objection", "brush_off": "objection", "competitor_mention": "discovery",
    "buying_signal": "next_steps", "next_step": "next_steps", "small_talk": "rapport",
}
_ASK_NEXT = {
    "pricing_question": ("Before I share numbers, how many people would use this day to day?",
                         "Number batane se pehle, roz kitne log isse use karenge?"),
    "objection_price": ("Expensive compared to what you had budgeted, or compared to another option?",
                        "Mehenga kis hisaab se, aapke budget se ya kisi aur option se?"),
    "objection_timing": ("If timing weren't an issue, would this be the right fit for you?",
                         "Agar timing ka issue na ho, toh kya yeh aapke liye sahi fit hai?"),
    "objection_authority": ("Who else would need to be comfortable with this before you decide?",
                            "Decide karne se pehle aur kaun involved hoga?"),
    "objection_need": ("What does the current process cost you in time each week?",
                       "Abhi ka process har hafte kitna time leta hai?"),
    "objection_trust": ("What specifically disappointed you last time, so we avoid repeating it?",
                        "Pichli baar exactly kya problem aayi thi, taaki hum woh repeat na karein?"),
    "objection_competitor": ("What works well with them today, and what doesn't?",
                             "Unke saath abhi kya accha chal raha hai, aur kya nahi?"),
    "objection_status_quo": ("What would have to change for this to become a priority?",
                             "Kya badalna chahiye taaki yeh priority ban jaaye?"),
    "objection_integration": ("Which systems would this need to talk to on day one?",
                              "Pehle din se kaun se systems ke saath connect hona chahiye?"),
    "objection_security": ("Which compliance requirements does your team need us to meet?",
                           "Aapki team ko kaun se compliance requirements chahiye?"),
    "brush_off": ("Happy to send that. What should it answer so it's worth your time?",
                  "Zaroor bhej deta hoon. Usme kya hona chahiye jo aapke kaam aaye?"),
    "competitor_mention": ("What made you shortlist them, and what's missing?",
                           "Unhe shortlist karne ki wajah kya thi, aur kya kami lagti hai?"),
    "buying_signal": ("Shall we pencil in a start date and work backwards from it?",
                      "Kya hum ek start date fix karke peeche se plan karein?"),
    "direct_question": ("Can I ask what's behind that question for you?",
                        "Yeh sawaal aapke liye kyun important hai, bata sakte hain?"),
    "next_step": ("Which date works for the next step, and who should join?",
                  "Agle step ke liye kaun si date theek hai, aur kaun join karega?"),
    "small_talk": ("Shall I start with what you'd like out of today?",
                   "Aaj aap is call se kya chahte hain, usse shuru karein?"),
    "statement": ("Can you tell me more about how that affects your team?",
                  "Iska aapki team par kya asar hota hai, thoda aur batayenge?"),
}


def detect_escalation(text: str) -> Optional[str]:
    """Discount escalation or fear/FOMO pressure in a rep turn (JOLT: raises loss odds)."""
    return "escalation" if text and _ESCALATION.search(text) else None


def classify_segment(text: str, *, battlecards: Optional[list] = None, deal: Optional[DealRecordTracker] = None,
                     say_lang: Optional[str] = None) -> dict:
    """Heuristic Tier 1: ``{intent, label, ask_next, stage, moment, objection_type, entity}`` for one prospect segment."""
    clean = " ".join((text or "").split())
    intent = "statement"
    entity = None
    if clean and _is_small_talk(clean):
        intent = "small_talk"
    else:
        for name, pattern in _INTENT_RULES:
            found = pattern.search(clean)
            if found:
                intent = name
                if name == "competitor_mention":
                    brand = _COMPETITOR_BRANDS.search(clean)
                    entity = brand.group(0).title() if brand else None
                break
        if intent in ("statement", "pricing_question") and C.is_question(clean) and intent == "statement":
            intent = "direct_question"
    lang = say_lang or prompts.detect_say_lang(clean)
    ask_next = None
    battlecard_id = None
    for card in battlecards or []:
        if not isinstance(card, dict):
            continue
        pattern = _keyword_regex(card.get("trigger_keywords"))
        if pattern is not None and pattern.search(clean.lower()):
            battlecard_id = card.get("id")
            if card.get("question_to_ask"):
                ask_next = str(card["question_to_ask"])
            if card.get("kind") == "competitive":
                entity = card.get("title") or entity
                if intent in ("statement", "direct_question"):
                    intent = "competitor_mention"
            break
    if ask_next is None:
        en, hinglish = _ASK_NEXT.get(intent, _ASK_NEXT["statement"])
        ask_next = hinglish if lang == "hinglish" else en
    ask_next = C.clamp_words(ask_next, C.ASK_NEXT_MAX_WORDS)
    if not ask_next.endswith("?"):
        ask_next = ask_next.rstrip(".!") + "?"
    stage = INTENT_STAGE.get(intent) or (deal.record.get("stage") if deal is not None else None) or "discovery"
    return {"intent": intent, "label": INTENT_LABELS.get(intent, "Listening"), "ask_next": ask_next, "stage": stage,
            "moment": INTENT_MOMENT.get(intent), "objection_type": INTENT_OBJECTION_TYPE.get(intent), "entity": entity,
            "battlecard_id": battlecard_id, "say_lang": lang}


# ── the session ──────────────────────────────────────────────────────────────

class CoachSession:
    def __init__(self, *, call_context: Optional[dict], wizard: Optional[dict], emit: Emit, user_id=None,
                 intensity: Optional[str] = None, metrics: Optional[MetricsTracker] = None,
                 deal: Optional[DealRecordTracker] = None, llm=None, retriever=None, clock: Callable[[], float] = time.monotonic,
                 user_instructions: Optional[str] = None, record_insight: Optional[Callable[[dict], None]] = None,
                 live_features: bool = True, legacy_analysis: bool = True):
        self.call_context = call_context or {}
        self.wizard = wizard or {}
        self.emit = emit
        self.user_id = user_id
        self.clock = clock
        self.t0 = clock()
        self.live_features = live_features
        self.legacy_analysis = legacy_analysis
        self.methodology = str(self.wizard.get("methodology") or "meddpicc")
        self.intensity = self._valid_intensity(intensity or self.wizard.get("intensity") or self.wizard.get("coaching_intensity") or "guided")
        self.metrics = metrics or MetricsTracker(channel_tagged=False)
        self.deal = deal or DealRecordTracker(self.methodology)
        self.llm = llm if llm is not None else select_llm()
        self.retriever = retriever if retriever is not None else default_retriever
        self.cost = CostMeter()
        self.policy = card_policy.PolicyState(intensity=self.intensity, max_cards_per_min=max_cards_per_min())
        self.tier0 = Tier0Matcher(self.wizard)
        self.capsule_facts = list(self.wizard.get("capsule_facts") or [])
        self.battlecards = [c for c in (self.wizard.get("battlecards") or []) if isinstance(c, dict)]
        self.battlecard_ids = {c.get("id") for c in self.battlecards if c.get("id")}
        self.system_prompt = prompts.build_system_prompt(self.call_context, self.wizard, user_instructions=user_instructions)
        self.schema = prompts.build_schema(self.methodology)
        self._record_insight = record_insight or (lambda entry: None)
        self.history: list[dict] = []
        self.cards: dict[str, dict] = {}
        self.insights: dict[str, dict] = {}
        self.feedback_by_card: dict[str, str] = {}
        self.pinned: set[str] = set()
        self.moments: list[dict] = []
        self.card_latencies: list[int] = []
        self.strip_latencies: list[int] = []
        self.tier2_enabled = self.llm is not None
        self.headline_only = False
        self._late_streak = 0
        self._degraded_notices: set[str] = set()
        self._inflight: Optional[asyncio.Task] = None
        self._inflight_text: str = ""
        self._inflight_card_id: Optional[str] = None
        self._queued: Optional[tuple[dict, float]] = None
        self._tier0_last: Optional[dict] = None          # {"id", "at", "moment", "battlecard_id"}
        self._chips: dict[tuple, float] = {}
        self._rep_speaking = False
        self._rep_pause_at: Optional[float] = None
        self._last_metrics_at: Optional[float] = None
        self._next_step_chip_at: Optional[float] = None
        self._prefetch: tuple[str, Optional[asyncio.Task]] = ("", None)
        self._ticker: Optional[asyncio.Task] = None
        self.warmup_ms: Optional[int] = None
        self.closed = False
        self.session_max_minutes = session_max_minutes()

    # ── helpers ──

    @staticmethod
    def _valid_intensity(value) -> str:
        value = str(value or "guided").strip().lower()
        return value if value in C.INTENSITY_LADDER else "guided"

    def now(self) -> float:
        return self.clock()

    def elapsed_s(self) -> float:
        return max(0.0, self.clock() - self.t0)

    def rep_speaking(self, now: Optional[float] = None) -> bool:
        now = self.now() if now is None else now
        if not self._rep_speaking:
            return False
        if self._rep_pause_at is None:
            return True
        return now - self._rep_pause_at < C.REP_MICRO_PAUSE_S

    async def _send(self, message: dict) -> None:
        try:
            await self.emit(message)
        except Exception:  # noqa: BLE001 - the sink reports its own failure
            pass

    # ── lifecycle ──

    async def start(self) -> None:
        if self.llm is not None:
            started = self.now()

            async def warm():
                try:
                    await asyncio.wait_for(self.llm.warmup(), 4.0)
                except Exception:  # noqa: BLE001
                    pass
                self.warmup_ms = int((self.now() - started) * 1000)
            asyncio.create_task(warm())
        if self._ticker is None:
            self._ticker = asyncio.create_task(self._tick_loop())

    async def _tick_loop(self) -> None:
        try:
            while not self.closed:
                await asyncio.sleep(TICK_INTERVAL_S)
                try:
                    await self.tick()
                except Exception as exc:  # noqa: BLE001
                    log.warning("coach tick failed (%s)", type(exc).__name__)
        except asyncio.CancelledError:
            pass

    async def close(self) -> None:
        """Stop the ticker and in-flight work; log the latency distribution (numbers only)."""
        self.closed = True
        for task in (self._ticker, self._inflight, self._prefetch[1]):
            if task is not None and not task.done():
                task.cancel()
        self._ticker = None
        if self.live_features and self.metrics.segments:
            await self._emit_metrics(final=True)
        self.log_latency()

    def latency_summary(self) -> dict:
        def pct(values, p):
            if not values:
                return None
            ordered = sorted(values)
            index = min(len(ordered) - 1, int(round((p / 100.0) * (len(ordered) - 1))))
            return ordered[index]
        return {"cards": len(self.card_latencies), "card_p50_ms": pct(self.card_latencies, 50), "card_p95_ms": pct(self.card_latencies, 95),
                "strips": len(self.strip_latencies), "strip_p50_ms": pct(self.strip_latencies, 50), "strip_p95_ms": pct(self.strip_latencies, 95)}

    def log_latency(self) -> None:
        summary = self.latency_summary()
        log.info("coach session latency: cards=%s card_p50_ms=%s card_p95_ms=%s strips=%s strip_p50_ms=%s strip_p95_ms=%s llm_calls=%s",
                 summary["cards"], summary["card_p50_ms"], summary["card_p95_ms"], summary["strips"], summary["strip_p50_ms"],
                 summary["strip_p95_ms"], self.cost.llm_calls)

    # ── speech activity ──

    def on_speech(self, channel: int, speaking: bool, t: Optional[float] = None) -> None:
        now = self.now()
        self.metrics.on_speech(channel, speaking, t if t is not None else now - self.t0)
        if channel == C.CHANNEL_REP:
            if speaking:
                self._rep_speaking, self._rep_pause_at = True, None
            else:
                self._rep_pause_at = now
        elif channel == C.CHANNEL_PROSPECT and speaking:
            self._rep_speaking, self._rep_pause_at = False, None

    # ── Tier 0: partials ──

    async def on_partial(self, text: str, *, channel: int, turn_index: int) -> None:
        if channel == C.CHANNEL_REP or self.intensity in ("on_demand", "off") or not text:
            return
        template = self.tier0.match(text)
        if template is None:
            return
        last = self._tier0_last
        if last and last["battlecard_id"] == template["battlecard_id"] and self.now() - last["at"] < C.DEDUPE_WINDOW_S.get(self.intensity, 60.0):
            return
        card = self._new_card(template, trigger="auto", tier=0, turn_index=turn_index)
        card["provisional"] = True
        card["entity"] = self._entity_for(card)
        card.pop("matched", None)
        self._tier0_last = {"id": card["id"], "at": self.now(), "moment": card["moment"], "battlecard_id": card.get("battlecard_id")}
        await self._present(card, trigger_at=self.now())

    # ── Tier 2 speculation on eager end of turn ──

    async def on_eager_eot(self, text: str, *, channel: int, turn_index: int) -> None:
        if channel == C.CHANNEL_REP or not text or not self._auto_tier2_allowed():
            return
        self._start_prefetch(text)
        if self._inflight is not None and not self._inflight.done():
            if self._inflight_text and text.startswith(self._inflight_text):
                return
            self._inflight.cancel()
        self._inflight_text = text
        self._inflight = asyncio.create_task(self._run_tier2(
            text=text, speaker="prospect", turn_index=turn_index, trigger="auto", mode="auto",
            trigger_at=self.now(), speculative=True))

    def on_turn_resumed(self, *, channel: int) -> None:
        if channel == C.CHANNEL_REP:
            return
        if self._inflight is not None and not self._inflight.done():
            self._inflight.cancel()
        self._inflight = None
        self._inflight_text = ""

    def _start_prefetch(self, text: str) -> None:
        key, task = self._prefetch
        if task is not None and not task.done() and text.startswith(key):
            return
        if task is not None and not task.done():
            task.cancel()
        self._prefetch = (text, asyncio.create_task(self._retrieve(text)))

    async def _retrieve(self, text: str) -> list[dict]:
        try:
            result = await asyncio.wait_for(self.retriever(text), RETRIEVAL_BUDGET_S + 0.05)
            return list(result or [])[:3]
        except Exception:  # noqa: BLE001 - grounding falls back to the fact table
            return []

    async def _retrieved_for(self, text: str) -> list[dict]:
        key, task = self._prefetch
        if task is not None and key and text.startswith(key):
            try:
                return await asyncio.wait_for(asyncio.shield(task), RETRIEVAL_BUDGET_S)
            except Exception:  # noqa: BLE001
                return []
        return await self._retrieve(text)

    # ── turns ──

    def _auto_tier2_allowed(self) -> bool:
        return self.tier2_enabled and self.llm is not None and self.intensity not in ("on_demand", "off")

    async def on_turn(self, speaker: str, text: str, *, channel: int, turn_index: int, eot_at: Optional[float] = None,
                      t_start: Optional[float] = None, t_end: Optional[float] = None) -> None:
        """A completed turn. Prospect turns drive Tier 1 and Tier 2; rep turns are context (and escalation checks)."""
        text = " ".join((text or "").split())
        if not text:
            return
        speaker = {"rep": "salesperson", "buyer": "prospect"}.get(speaker, speaker)
        trigger_at = eot_at if eot_at is not None else self.now()
        self.history.append({"speaker": speaker, "text": text, "turn_index": turn_index})
        if len(self.history) > 40:
            del self.history[:-40]
        self.metrics.on_turn(speaker, text, t_start, t_end, channel=channel)
        if speaker == "salesperson":
            await self._rep_turn(text, turn_index)
            return
        if speaker != "prospect":
            return
        classified = classify_segment(text, battlecards=self.battlecards, deal=self.deal)
        await self._tier1(text, classified, turn_index=turn_index, trigger_at=trigger_at)
        if self.intensity == "off":
            return
        if not self._auto_tier2_allowed():
            await self._flush_deal_updates()
            return
        inflight = self._inflight
        if inflight is not None and not inflight.done() and self._inflight_text and (
                text == self._inflight_text or text.startswith(self._inflight_text) and len(self._inflight_text) >= 0.9 * len(text)):
            await self._await_inflight(inflight)       # the speculative run covers this turn
            return
        if inflight is not None and not inflight.done():
            inflight.cancel()
        self._inflight_text = text
        self._inflight = asyncio.create_task(self._run_tier2(
            text=text, speaker="prospect", turn_index=turn_index, trigger="auto", mode="auto",
            trigger_at=trigger_at, signals=classified))
        await self._await_inflight(self._inflight)

    async def _await_inflight(self, task: asyncio.Task) -> None:
        try:
            await task
        except asyncio.CancelledError:
            current = asyncio.current_task()
            if current is not None and getattr(current, "cancelling", lambda: 0)():
                raise
        except Exception as exc:  # noqa: BLE001
            log.warning("coach generation failed (%s)", type(exc).__name__)

    async def _rep_turn(self, text: str, turn_index: int) -> None:
        kind = detect_escalation(text)
        if kind:
            recent_objection = any(
                not o.get("handled") and turn_index - o["turn_index"] <= 8 for o in self.deal.record["objections"])
            if recent_objection or (self.history and any(
                    h["speaker"] == "prospect" and classify_segment(h["text"]).get("objection_type") for h in self.history[-4:-1])):
                await self._emit_moment("stall", kind, turn_index)
        if self.live_features:
            await self._flush_deal_updates()

    async def _tier1(self, text: str, classified: dict, *, turn_index: int, trigger_at: float) -> None:
        changed = False
        otype = classified.get("objection_type")
        if otype:
            changed |= self.deal.add_objection({"type": otype, "quote": text[:240]}, turn_index=turn_index,
                                               battlecard_id=classified.get("battlecard_id"))
        if classified.get("intent") == "buying_signal":
            changed |= self.deal.add_buying_signal({"quote": text[:240], "why": classified["label"]}, turn_index=turn_index)
        stage = classified.get("stage")
        if stage and self.deal.record.get("stage") != stage and (
                classified["intent"] not in ("statement", "small_talk") or self.deal.record.get("stage") is None):
            self.deal.record["stage"] = stage
        if self.live_features and self.intensity != "off":
            latency_ms = int(max(0.0, self.now() - trigger_at) * 1000)
            self.strip_latencies.append(latency_ms)
            self.cost.strips += 1
            await self._send({"type": "strip", "intent": classified["intent"], "label": classified["label"],
                              "ask_next": classified["ask_next"], "stage": classified["stage"], "turn_index": turn_index,
                              "latency_ms": latency_ms})
            moment = classified.get("moment")
            if moment:
                await self._emit_moment(moment, classified.get("entity") or otype, turn_index)
        if changed and self.live_features:
            await self._flush_deal_updates()

    # ── Tier 2 ──

    def _signals(self, classified: Optional[dict]) -> dict:
        moments = []
        if classified and classified.get("moment"):
            moments.append((classified["moment"], classified.get("entity") or classified.get("objection_type")))
        return {"moments": moments, "no_next_step": not (self.deal.record.get("next_step") or {}).get("date"),
                "stage": self.deal.record.get("stage"), "say_lang": (classified or {}).get("say_lang")}

    async def _run_tier2(self, *, text: str, speaker: str, turn_index: int, trigger: str, mode: str, trigger_at: float,
                         question: Optional[str] = None, speculative: bool = False, signals: Optional[dict] = None,
                         long: bool = False) -> None:
        if self.llm is None:
            return
        history = [h for h in self.history if not (h["turn_index"] == turn_index and h["speaker"] == speaker)]
        retrieved = await self._retrieved_for(text) if text else []
        user = prompts.build_user_prompt(
            history=history, turn_text=text, speaker=speaker, mode=mode, question=question,
            signals=self._signals(signals), retrieved=retrieved, open_objections=self.deal.open_objections(),
            elapsed_s=self.elapsed_s(), headline_only=self.headline_only and mode == "auto", long=long)
        max_tokens = MAX_TOKENS_HEADLINE_ONLY if (self.headline_only and mode == "auto") else MAX_TOKENS
        card_id = self._reuse_card_id(turn_index)
        buffer = ""
        emitted_first = False
        try:
            async with asyncio.timeout(LLM_TIMEOUT_S):
                async for delta in self.llm.stream(self.system_prompt, user, self.schema, max_tokens=max_tokens):
                    buffer += delta
                    if emitted_first:
                        continue
                    partial = prompts.parse_partial(buffer)
                    if partial.get("moment") in (None, "", "none") or not partial.get("say") or not partial.get("headline"):
                        continue
                    if partial.get("say_complete") and prompts.loads_lenient(buffer) is not None:
                        continue                    # the whole card arrived at once: one revision is enough
                    first = self._card_from_partial(partial, card_id=card_id, trigger=trigger, turn_index=turn_index, mode=mode)
                    if first is None:
                        continue
                    emitted_first = await self._present(first, trigger_at=trigger_at) == "show"
        except (asyncio.TimeoutError, TimeoutError):
            log.info("coach generation timed out")
            self.cost.add_llm(len(self.system_prompt) + len(user), len(buffer))
            self._note_latency(int((self.now() - trigger_at) * 1000), shown=False)
            return
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - never a fallback card
            log.warning("coach generation error (%s)", type(exc).__name__)
            return
        self.cost.add_llm(len(self.system_prompt) + len(user), len(buffer))
        raw = prompts.loads_lenient(buffer)
        validated = prompts.validate_card_output(raw, methodology=self.methodology, battlecard_ids=self.battlecard_ids, mode=mode, long=long)
        if validated is None:
            if mode != "auto":
                await self._send({"type": "notice", "code": "coach_unavailable", "text": "The coach couldn't answer that just now."})
            return
        await self._apply_structured(validated, turn_index=turn_index, quote=text if speaker == "prospect" else None)
        if validated["moment"] == "none":
            if mode != "auto":
                await self._send({"type": "notice", "code": "coach_unavailable", "text": "The coach had nothing to add right now."})
            return
        card = self._new_card(validated, trigger=trigger, tier=2, turn_index=turn_index, card_id=card_id)
        card["revision"] = self._next_revision(card_id)
        card["provisional"] = False
        card["sources"] = self._sources(validated, retrieved)
        objection = validated.get("objection")
        if objection:
            card["objection"] = {"type": str(objection.get("type") or "other"), "quote": str(objection.get("quote") or "")[:240]}
        card["entity"] = self._entity_for(card) or (signals or {}).get("entity") or (
            card["objection"]["type"] if card.get("objection") else None)
        await self._present(card, trigger_at=trigger_at)

    def _reuse_card_id(self, turn_index: int) -> str:
        last = self._tier0_last
        if last and self.policy.visible is not None and self.policy.visible.id == last["id"] \
                and card_policy.is_visible(self.policy, self.now()):
            return last["id"]
        return uuid.uuid4().hex[:12]

    def _card_from_partial(self, partial: dict, *, card_id: str, trigger: str, turn_index: int, mode: str) -> Optional[dict]:
        moment = str(partial.get("moment") or "info").lower()
        if moment not in prompts.CARD_MOMENTS or moment == "none":
            return None
        say = str(partial.get("say") or "").strip()
        if C.word_count(say) < 4:
            return None
        priority = str(partial.get("priority") or "normal").lower()
        template = {
            "moment": moment, "priority": priority if priority in ("low", "normal", "high") else "normal",
            "headline": C.clamp_words(str(partial.get("headline") or prompts.MOMENT_LABELS.get(moment, "Note")), C.HEADLINE_MAX_WORDS),
            "say": say, "say_lang": prompts.detect_say_lang(say), "then_ask": None, "detail": None, "battlecard_id": None,
            "sources": [], "confidence": 0.6 if priority != "high" else 0.7,
        }
        if moment == "objection":
            template["cue"] = "pause"
        card = self._new_card(template, trigger=trigger, tier=2, turn_index=turn_index, card_id=card_id)
        card["provisional"] = True
        card["revision"] = self._next_revision(card_id)
        return card

    def _next_revision(self, card_id: str) -> int:
        """Revisions continue from the card already on screen with this id (a Tier 0 match or a streamed first sentence)."""
        prior = self.cards.get(card_id)
        return int(prior.get("revision") or 1) + 1 if prior else 1

    def _sources(self, validated: dict, retrieved: list[dict]) -> list[dict]:
        sources: list[dict] = []
        fact_labels = {str(f.get("label") or "").lower(): f for f in self.capsule_facts if isinstance(f, dict)}
        for ref in validated.get("sources") or []:
            key = str(ref).strip()
            match = re.fullmatch(r"k([1-3])", key.lower())
            if match and len(retrieved) >= int(match.group(1)):
                chunk = retrieved[int(match.group(1)) - 1]
                sources.append({"kind": "knowledge", "label": str(chunk.get("title") or chunk.get("source") or "Knowledge base")[:60],
                                "ref": str(chunk.get("id") or key)})
            elif key.lower() in fact_labels:
                sources.append({"kind": "capsule", "label": str(fact_labels[key.lower()].get("label"))[:60], "ref": None})
            elif key.lower() == "brief":
                sources.append({"kind": "brief", "label": "Call brief", "ref": None})
        if validated.get("battlecard_id"):
            title = next((c.get("title") for c in self.battlecards if c.get("id") == validated["battlecard_id"]), None)
            sources.append({"kind": "battlecard", "label": str(title or "Battlecard")[:60], "ref": validated["battlecard_id"]})
        deduped: list[dict] = []
        for src in sources:
            if src not in deduped:
                deduped.append(src)
        return deduped[:4]

    async def _apply_structured(self, validated: dict, *, turn_index: int, quote: Optional[str]) -> None:
        self.deal.apply_delta(validated.get("deal_record_delta"), turn_index=turn_index, speaker="prospect", quote=quote)
        objection = validated.get("objection")
        if objection:
            self.deal.add_objection(objection, turn_index=turn_index, battlecard_id=validated.get("battlecard_id"))
            if objection.get("handled") is True:
                self.deal.resolve_open_objections(turn_index, how=objection.get("how"))
        if validated.get("buying_signal"):
            self.deal.add_buying_signal(validated["buying_signal"], turn_index=turn_index)
        if self.live_features:
            await self._flush_deal_updates()

    # ── on demand ──

    async def what_to_say(self, length: Optional[str] = None) -> None:
        """``length="long"`` allows up to ``SAY_MAX_WORDS_LONG`` words; the default is a normal card."""
        await self._on_demand(mode="what_to_say", trigger="on_demand", long=(str(length or "").lower() == "long"))

    async def ask(self, question: str) -> None:
        question = " ".join(str(question or "").split())[:ASK_MAX_CHARS]
        if not question:
            return
        await self._on_demand(mode="ask", trigger="ask", question=question, long=True)

    async def _on_demand(self, *, mode: str, trigger: str, question: Optional[str] = None, long: bool = False) -> None:
        if self.llm is None:
            await self._send({"type": "notice", "code": "coach_unavailable",
                              "text": "No coaching model is configured on this server (GEMINI_API_KEY or GROQ_API_KEY)."})
            return
        if self._inflight is not None and not self._inflight.done():
            self._inflight.cancel()
        last_prospect = next((h for h in reversed(self.history) if h["speaker"] == "prospect"), None)
        text = last_prospect["text"] if last_prospect else ""
        turn_index = last_prospect["turn_index"] if last_prospect else max(0, len(self.history) - 1)
        self._inflight_text = ""
        self._inflight = asyncio.create_task(self._run_tier2(
            text=text, speaker="prospect", turn_index=turn_index, trigger=trigger, mode=mode,
            trigger_at=self.now(), question=question, long=long))
        await self._await_inflight(self._inflight)

    # ── client controls ──

    async def set_intensity(self, value: str, *, announce: bool = False) -> None:
        self.intensity = self._valid_intensity(value)
        self.policy.intensity = self.intensity
        if self.intensity in ("on_demand", "off"):
            self._queued = None
        if announce:
            await self._send({"type": "notice", "code": "intensity", "text": f"Coaching intensity: {self.intensity}.", "intensity": self.intensity})

    def snooze(self, moment: str, ms: int) -> None:
        moment = str(moment or "").strip().lower()
        if moment in prompts.CARD_MOMENTS and moment != "none":
            seconds = max(1.0, min(float(ms or 0) / 1000.0, 3600.0))
            self.policy.snoozed[moment] = self.now() + seconds
            if self._queued is not None and self._queued[0].get("moment") == moment:
                self._queued = None

    def pin(self, card_id: str) -> None:
        if card_id in self.cards:
            self.pinned.add(card_id)
            entry = self.insights.get(card_id)
            if entry is not None:
                entry["pinned"] = True

    def feedback(self, card_id: str, value: str) -> bool:
        value = str(value or "").strip().lower()
        if value not in ("up", "down", "used") or card_id not in self.cards:
            return False
        self.feedback_by_card[card_id] = value
        entry = self.insights.get(card_id)
        if entry is not None:
            entry["feedback"] = value
        if value == "used" and self.cards[card_id].get("moment") == "objection":
            self.deal.resolve_open_objections(self.cards[card_id].get("turn_index", 0), how="Rep used the suggested response")
        return True

    # ── presenting cards ──

    def _new_card(self, template: dict, *, trigger: str, tier: int, turn_index: int, card_id: Optional[str] = None) -> dict:
        say = str(template.get("say") or "")
        card = {
            "id": card_id or uuid.uuid4().hex[:12], "moment": template.get("moment") or "info",
            "priority": template.get("priority") or "normal", "headline": template.get("headline") or "",
            "say": say, "then_ask": template.get("then_ask"), "detail": template.get("detail"),
            "say_lang": template.get("say_lang") or prompts.detect_say_lang(say), "say_words": C.word_count(say),
            "battlecard_id": template.get("battlecard_id"), "sources": list(template.get("sources") or []),
            "confidence": float(template.get("confidence") or 0.0), "ttl_ms": card_policy.ttl_for(template.get("priority")),
            "turn_index": turn_index, "trigger": trigger, "latency_ms": None, "created_at": C.utc_now_iso(),
            "tier": tier, "provisional": False, "revision": 1, "late": False, "cue": template.get("cue"),
            "entity": None, "objection": None,
        }
        if card["moment"] == "objection":
            card["cue"] = "pause"
        return card

    async def _present(self, card: dict, *, trigger_at: float) -> str:
        """Run the policy and show / queue / drop. Returns the action taken."""
        now = self.now()
        card["latency_ms"] = int(max(0.0, now - trigger_at) * 1000)
        card["late"] = card["latency_ms"] > C.CARD_LATE_MS
        card_policy.expire(self.policy, now)
        self.policy.rep_speaking = self.rep_speaking(now)
        decision = card_policy.evaluate(card, self.policy, now=now, capsule_facts=self.capsule_facts)
        if decision.action == "show":
            await self._show(decision.card, now)
            return "show"
        if decision.action == "queue":
            queued = self._queued
            if queued is None or card_policy.rank(decision.card.get("priority")) >= card_policy.rank(queued[0].get("priority")):
                if queued is not None and queued[0].get("id") != decision.card.get("id") and queued[0].get("moment") not in (None, "none", "info"):
                    await self._emit_moment(queued[0]["moment"], self._entity_for(queued[0]), queued[0].get("turn_index", 0))
                self._queued = (decision.card, trigger_at)
            return "queue"
        if decision.reason == "rate_cap":
            self.cost.rate_cap_hits += 1
            await self._maybe_degrade_for_rate_cap()
        if decision.reason in ("moment_not_proactive", "intensity", "snoozed", "low_confidence", "rate_cap") \
                and decision.card.get("moment") not in (None, "none", "info"):
            await self._emit_moment(decision.card["moment"], self._entity_for(decision.card), decision.card.get("turn_index", 0))
        return "drop"

    def _entity_for(self, card: dict) -> Optional[str]:
        battlecard_id = card.get("battlecard_id")
        if battlecard_id:
            title = next((c.get("title") for c in self.battlecards if c.get("id") == battlecard_id), None)
            if title:
                return str(title)
        return None

    async def _show(self, card: dict, now: float) -> None:
        first_time = card["id"] not in self.cards
        card_policy.mark_shown(self.policy, card, now)
        self.cards[card["id"]] = card
        if first_time:
            self.card_latencies.append(int(card.get("latency_ms") or 0))
            self.cost.cards_sent += 1
            self._note_latency(int(card.get("latency_ms") or 0), shown=True)
        await self._send({"type": "coach", "card": card})
        if not card.get("provisional") and self.legacy_analysis:
            health = self.deal.health(self.metrics.snapshot(self.elapsed_s())) if self.live_features else None
            open_objections = self.deal.open_objections()
            payload = C.legacy_analysis_from_card(card, health, objection_type=open_objections[-1]["type"] if open_objections else None,
                                                  stage=self.deal.record.get("stage"))
            entry = self.insights.get(card["id"])
            if entry is None:
                entry = {"payload": payload, "card": card, "feedback": self.feedback_by_card.get(card["id"]),
                         "timestamp": C.utc_now_iso(), "turn_index": card.get("turn_index", 0)}
                self.insights[card["id"]] = entry
                self._record_insight(entry)
            else:
                entry["payload"], entry["card"] = payload, card
            await self._send({"type": "aiAnalysis", "payload": payload, "latency": {"card_ms": card.get("latency_ms"), "tier": card.get("tier")}})

    async def _emit_moment(self, moment: str, entity: Optional[str], turn_index: int) -> None:
        if not self.live_features:
            return
        key = (moment, str(entity or ""))
        now = self.now()
        last = self._chips.get(key)
        if last is not None and now - last < CHIP_DEDUPE_S:
            return
        self._chips[key] = now
        record = {"moment": moment, "entity": entity, "turn_index": turn_index, "t": round(self.elapsed_s(), 1)}
        self.moments.append(record)
        await self._send({"type": "moment", "moment": moment, "entity": entity, "turn_index": turn_index})

    async def _flush_deal_updates(self) -> None:
        if not self.live_features:
            return
        version = self.deal.version
        if getattr(self, "_sent_deal_version", -1) != version:
            self._sent_deal_version = version
            await self._send({"type": "deal_record", "record": self.deal.snapshot()})
        health = self.deal.health_if_changed(self.metrics.snapshot(self.elapsed_s()))
        if health is not None:
            await self._send({"type": "deal_health", **health})

    # ── periodic work ──

    async def tick(self) -> None:
        now = self.now()
        card_policy.expire(self.policy, now)
        self.policy.rep_speaking = self.rep_speaking(now)
        if self._queued is not None:
            card, trigger_at = self._queued
            if now - trigger_at > C.CARD_STALE_AFTER_S:
                self._queued = None
                if card.get("moment") not in (None, "none", "info"):
                    await self._emit_moment(card["moment"], self._entity_for(card), card.get("turn_index", 0))
            else:
                decision = card_policy.evaluate(card, self.policy, now=now, capsule_facts=self.capsule_facts)
                if decision.action == "show":
                    self._queued = None
                    decision.card["latency_ms"] = int(max(0.0, now - trigger_at) * 1000)
                    decision.card["late"] = decision.card["latency_ms"] > C.CARD_LATE_MS
                    await self._show(decision.card, now)
                elif decision.action == "drop":
                    self._queued = None
        if self.live_features:
            if self._last_metrics_at is None or now - self._last_metrics_at >= METRICS_INTERVAL_S:
                if self.metrics.segments or self._last_metrics_at is not None:
                    await self._emit_metrics()
                self._last_metrics_at = now
            elapsed = self.elapsed_s()
            if self.intensity not in ("on_demand", "off") and elapsed >= NEXT_STEP_CHIP_AFTER_S \
                    and not (self.deal.record.get("next_step") or {}).get("date") \
                    and (self._next_step_chip_at is None or elapsed - self._next_step_chip_at >= NEXT_STEP_CHIP_EVERY_S):
                self._next_step_chip_at = elapsed
                await self._emit_moment("next_step_missing", None, max(0, len(self.history) - 1))
        if self.elapsed_s() > self.session_max_minutes * 60 and "session_cap" not in self._degraded_notices:
            self._degraded_notices.add("session_cap")
            await self.set_intensity("on_demand")
            await self._send({"type": "notice", "code": "degraded", "intensity": self.intensity,
                              "text": f"This session passed {self.session_max_minutes} minutes: proactive coaching is paused. "
                                      "Use 'What should I say?' any time."})

    async def _emit_metrics(self, *, final: bool = False) -> None:
        elapsed = self.elapsed_s()
        metrics = self.metrics.snapshot(elapsed)
        nudges = self.metrics.nudges(elapsed) if (self.intensity != "off" and not final) else []
        message = {"type": "metrics", "metrics": metrics, "nudges": nudges}
        if final:
            message["final"] = True
        await self._send(message)
        health = self.deal.health_if_changed(metrics)
        if health is not None:
            await self._send({"type": "deal_health", **health})

    # ── degrade ladder ──

    def _note_latency(self, latency_ms: int, *, shown: bool) -> None:
        if latency_ms > C.SLO_FIRST_LINE_P95_MS:
            self._late_streak += 1
        elif shown:
            self._late_streak = 0
        if self._late_streak >= LATE_STREAK_TIER2_OFF and self.tier2_enabled:
            self.tier2_enabled = False
            asyncio.create_task(self._notice_once("degraded", "The coaching model is too slow right now: showing instant battlecard matches and the strip only."))
        elif self._late_streak >= LATE_STREAK_HEADLINE_ONLY and not self.headline_only:
            self.headline_only = True
            asyncio.create_task(self._notice_once("slow", "The coaching model is slow: cards are shortened to one sentence."))

    async def _maybe_degrade_for_rate_cap(self) -> None:
        if self.cost.rate_cap_hits < RATE_CAP_HITS_TO_DEGRADE:
            return
        self.cost.rate_cap_hits = 0
        ladder = C.INTENSITY_LADDER
        index = ladder.index(self.intensity) if self.intensity in ladder else 1
        if index < ladder.index("on_demand"):
            await self.set_intensity(ladder[index + 1])
            await self._send({"type": "notice", "code": "degraded", "intensity": self.intensity,
                              "text": f"More than {self.policy.max_cards_per_min} cards a minute: coaching intensity lowered to {self.intensity}."})

    async def _notice_once(self, code: str, text: str) -> None:
        if code in self._degraded_notices:
            return
        self._degraded_notices.add(code)
        await self._send({"type": "notice", "code": code, "text": text, "intensity": self.intensity})

    # ── persistence helpers ──

    def saved_metrics(self) -> dict:
        metrics = dict(self.metrics.snapshot(self.elapsed_s()))
        metrics["cost"] = self.cost.summary()
        metrics["latency"] = self.latency_summary()
        metrics["moments"] = list(self.moments[-200:])
        metrics["nudges"] = list(self.metrics.nudge_history[-50:])
        return metrics
