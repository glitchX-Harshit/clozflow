import os
import json
import time
import random
import asyncio
from typing import Any
from openai import AsyncOpenAI
from difflib import SequenceMatcher
from rag.rag_engine import RAGEngine

# Client is initialized per-instance inside __init__ so env vars are loaded first

# ─── psychofancy_v2: Response Energy Definitions (refined) ───────────────────
# (No random selection — energy is keyword-routed, no extra calls)
ENERGY_DEFINITIONS = {
    "calm_authority":    "grounded, socially intelligent, outcome-focused, never emotional",
    "soft_challenge":    "calm pressure, subtle perspective shifts, expose weak assumptions gently",
    "emotional_clarity": "clarify uncertainty, avoid emotional narration, reduce confusion without sounding therapeutic",
    "relaxed_guidance":  "conversational, socially smooth, naturally intelligent",
    "composed_confidence": "calm, high-status, unfazed by ego energy",
}

# ─── followbackQuestion §3/§5: GPT Detox + interview-mode + question-addiction removal ─
BANNED_PATTERNS = [
    "what specific",
    "what are your",
    "can you elaborate",
    "help me understand",
    "key performance indicators",
    "implementation efficiency",
    "optimize your workflow",
    "our solution helps",
    "value proposition",
    "what metrics",
    "what pain points",
    "i understand your concern",
    "you seem to feel",
    "i hear hesitation",
    "it sounds like you're",
    "feels like you're",
    "there's a gap",
    # followbackQuestion §5 — GPT interview starters
    "what are your top priorities",
    "what outcomes would",
    "what's holding you back",
    "what would convince you",
    "what's your current",
]

# ─── followbackQuestion §3: Question-suppression keywords ────────────────────
# When these appear in prospect text, next_question is suppressed
_SUPPRESS_QUESTION_KEYWORDS = [
    "later",
    "expensive",
    "hype",
    "already have",
    "not convinced",
    "don't need",
    "doing fine",
    "we already",
    "prove",
]

# Energies that should default to no follow-up question
_NO_QUESTION_ENERGIES = {"calm_authority", "soft_challenge"}

# ─── psychofancy_v2 §7: Humanization phrases — split by injection weight ──────
# Primary softeners: ~15% frequency (conversational direction)
HUMANIZATION_PHRASES = [
    "Honestly,",
    "Usually,",
    "Most teams",
    "A lot of the time,",
    "That's normally where",
]
# Passive softeners: demoted to ≤5% — kept separate to enforce rate cap
_PASSIVE_SOFTENERS = [
    "Feels like",
    "It sounds like",
]


def _detect_response_energy(text: str) -> str:
    """psychofancy_v1 §4 — Lightweight keyword emotional router.
    No NLP, no embeddings, no extra API calls. Pure keyword matching."""
    text_lower = text.lower()

    if any(w in text_lower for w in ["not sure", "maybe", "hesitate", "later"]):
        return "emotional_clarity"

    if any(w in text_lower for w in ["already", "we already", "don't need", "doing fine"]):
        return "soft_challenge"

    if any(w in text_lower for w in ["hype", "why should", "prove", "different"]):
        return "calm_authority"

    if any(w in text_lower for w in ["we're the best", "top company", "industry leader", "biggest"]):
        return "composed_confidence"

    return "relaxed_guidance"


class SalesAIEngine:
    def __init__(self, call_context: dict[str, Any] | None = None):
        self.call_context = call_context
        self.message_buffer: list[dict[str, Any]] = []
        self.response_history: list[str] = []
        self.last_strategies: list[str] = []

        self.deal_state = {
            "stage": "discovery",
            "last_intent": None,
            "objections_handled": [],
            "pressure_level": 1
        }

        self.max_messages = 8
        self.max_latency = 2.0          # V2 2-sec strict limit
        self._last_call_time: float = 0.0
        self._cooldown_secs: float = 2.0  # Min 2 secs between calls

        # Initialize Groq client — env is guaranteed loaded by this point
        api_key = os.getenv("OPENAI_API_KEY")
        if api_key:
            self.client = AsyncOpenAI(
                api_key=api_key,
                base_url="https://api.groq.com/openai/v1"
            )
            print(f"[AI_CLIENT] Groq client initialized with key: {api_key[:8]}...")
        else:
            self.client = None
            print("[AI_CLIENT] WARNING: OPENAI_API_KEY not found — LLM calls will use fallback.")

        self.rag = RAGEngine()
        self.rag.load_index()

    # ──────────────────────────────────────────────────────────────────────────
    # Stability systems (DO_NOT_CHANGE)
    # ──────────────────────────────────────────────────────────────────────────

    def get_pressure_instruction(self):
        level = self.deal_state["pressure_level"]
        if level == 1:
            return "Keep it consultative and exploratory."
        elif level == 2:
            return "Guide the prospect toward a decision subtly."
        else:
            return "Apply firm pressure and move toward commitment."

    def update_stage(self, intent: str):
        if intent in ["pricing", "hesitation", "trust"]:
            self.deal_state["stage"] = "objection"
        elif intent in ["interest"]:
            self.deal_state["stage"] = "closing"
        elif intent in ["confusion"]:
            self.deal_state["stage"] = "discovery"

    def add_message(self, speaker: str, text: str):
        self.message_buffer.append({"speaker": speaker, "text": text, "timestamp": time.time()})
        if len(self.message_buffer) > self.max_messages:
            self.message_buffer.pop(0)

    def is_duplicate(self, text: str) -> bool:
        if not text:
            return False
        text_lower = text.lower()
        for past_sugg in self.response_history:
            if SequenceMatcher(None, text_lower, past_sugg.lower()).ratio() > 0.70:
                return True
        return False

    def push_response_history(self, response: str, strategy: str):
        self.response_history.append(response)
        if len(self.response_history) > 3:
            self.response_history.pop(0)

        if strategy:
            self.last_strategies.append(strategy)
            if len(self.last_strategies) > 2:
                self.last_strategies.pop(0)

    # ──────────────────────────────────────────────────────────────────────────
    # psychofancy_v2: smart_fallback — v2 directional examples
    # ──────────────────────────────────────────────────────────────────────────

    def smart_fallback(self, text: str = "") -> dict:
        text = text.lower()

        pricing = [
            "Price usually feels heavy when the outcome still feels uncertain.",
            "Most pricing hesitation comes from uncertainty around outcomes, not the number itself.",
            "The bigger cost is usually staying with what isn't fully working.",
        ]
        authority = [
            "When decisions slow down, there's usually one unresolved concern underneath.",
            "Most delayed decisions come down to confidence, not process.",
            "Alignment usually matters more than timing here.",
        ]
        hesitation = [
            "Usually when something gets pushed to later, there's still one concern that hasn't settled yet.",
            "Usually when someone sees value but still hesitates, the real issue is risk, not interest.",
            "When something keeps getting delayed, it's rarely about time.",
        ]
        dismissive = [
            "Most teams already have tools. Few feel fully confident in them.",
            "Most teams don't look for change unless something underneath isn't scaling properly.",
            "If the current setup was solving everything perfectly, this conversation probably wouldn't exist.",
        ]
        skepticism = [
            "Honestly, skepticism usually comes after hearing too many promises that changed nothing.",
            "Skepticism makes sense when outcomes have felt uncertain before.",
        ]
        generic = [
            "Usually hesitation points to one core concern that hasn't fully been resolved.",
            "Something underneath this still seems unresolved.",
            "Most of the time, the real hesitation is one thing — not several.",
        ]

        if any(w in text for w in ["price", "expensive", "budget", "cost"]):
            msg = random.choice(pricing)
        elif any(w in text for w in ["partner", "team", "decision"]):
            msg = random.choice(authority)
        elif any(w in text for w in ["already", "internally", "doing fine"]):
            msg = random.choice(dismissive)
        elif any(w in text for w in ["not sure", "maybe", "later", "hesitate"]):
            msg = random.choice(hesitation)
        elif any(w in text for w in ["hype", "prove", "why should", "different"]):
            msg = random.choice(skepticism)
        else:
            msg = random.choice(generic)

        return {
            "intent": "fallback_guidance",
            "stage": self.deal_state["stage"],
            "strategy": "PERSPECTIVE_SHIFT",
            "confidence": 0.7,
            "response": msg,
            "next_question": "",
            "coaching_tip": "Fallback recovery response triggered.",
        }

    # ──────────────────────────────────────────────────────────────────────────
    # Core analyze loop
    # ──────────────────────────────────────────────────────────────────────────

    async def analyze(self, speaker: str, text: str) -> dict | None:
        print(f"[TRANSCRIPT] {speaker}: {text}")

        if speaker != "prospect":
            return None

        if self.deal_state["stage"] == "objection":
            self.deal_state["pressure_level"] = min(self.deal_state["pressure_level"] + 1, 3)

        if len(text.strip().split()) < 3 and len(text.strip()) < 15:
            print("[AI_SKIPPED] Transcript too short.")
            self.add_message(speaker, text)
            return None

        now = time.time()
        if now - self._last_call_time < self._cooldown_secs:
            print("[AI_SKIPPED] Cooldown active.")
            return None

        self._last_call_time = now
        self.add_message(speaker, text)

        print("[AI_TRIGGERED] V4.2 CloserBrain analyzing...")

        if not self.client:
            print("[AI_INFO] No LLM client configured — using fallback.")
            return self.smart_fallback(text)

        # ── psychofancy_v1 §4: Keyword-routed emotional energy (no random, no extra calls) ─
        response_energy = _detect_response_energy(text)
        energy_description = ENERGY_DEFINITIONS[response_energy]
        print(f"[ENERGY] {response_energy} — {energy_description}")

        # ── Build supporting context ──────────────────────────────────────────
        context_str = ""
        if self.call_context:
            context_str = "\nCALL CONTEXT:\n" + json.dumps(self.call_context)

        avoid_strategies = ", ".join(self.last_strategies) if self.last_strategies else "None"
        intent = self.deal_state["last_intent"]

        rag_results = self.rag.retrieve(text)
        rag_context = "\n".join([
            f"- Insight: {r.get('insight', '')} | Avoid: {r.get('avoid', '')}"
            for r in rag_results
        ])

        available_strategies = [
            "ROI_REFRAME",
            "COST_OF_INACTION",
            "SOCIAL_PROOF",
            "DIAGNOSTIC_QUESTION",
            "FUTURE_PACING",
            "DECISION_CONTROL",
        ]

        rag_strategy = rag_results[0].get("strategy") if rag_results else None
        if intent == "pricing":
            final_strategy = "ROI_REFRAME"
        elif intent == "authority":
            final_strategy = "DECISION_CONTROL"
        elif intent == "trust":
            final_strategy = "SOCIAL_PROOF"
        else:
            final_strategy = rag_strategy or "DIAGNOSTIC_QUESTION"

        if self.last_strategies and final_strategy == self.last_strategies[-1]:
            final_strategy = "DIAGNOSTIC_QUESTION"

        print("\n=== DEBUG INFO ===")
        print("Transcript      :", text)
        print("RAG Results     :", rag_results)
        print("Chosen Strategy :", final_strategy)
        print("Response Energy :", response_energy)
        print("Deal State      :", self.deal_state)
        print("==================\n")

        intent_behavior = {
            "pricing":    "Reframe value. Challenge their price perception directly.",
            "trust":      "Reduce uncertainty. Isolate the exact doubt. Do not list features.",
            "authority":  "Regain control. Clarify who makes the decision and when.",
            "hesitation": "Diagnose root cause first, then guide toward next step.",
        }.get(intent or "", "Lead the conversation forward with insight or reframe.")

        # ── followbackQuestion §3: Question-suppression filter (no extra calls) ─
        text_lower = text.lower()
        avoid_question = (
            response_energy in _NO_QUESTION_ENERGIES
            or any(w in text_lower for w in _SUPPRESS_QUESTION_KEYWORDS)
        )
        print(f"[QUESTION_FILTER] avoid_question={avoid_question} (energy={response_energy})")

        # ── psychofancy_v2 + followbackQuestion §1/§2/§7/§9: Full system prompt ─
        system_content = f"""You are Hexagon — a socially intelligent conversational sales AI.

You are socially aware, NOT emotionally therapeutic.
You do NOT sound like a therapist, motivational guru, chatbot, consultant, or scripted salesperson.

You sound like:
- a socially sharp closer
- psychologically aware without trying too hard
- conversationally smooth
- naturally persuasive
- calm and human

RESPONSE STYLE:
Your responses should:
- redirect perspective
- subtly expose hidden hesitation
- create conversational movement
- sound calm and human

Avoid:
- emotional narration
- over-validating feelings
- sounding like a therapist
- passive observations
- sounding overly complete or polished

Prefer:
- social observations
- conversational insight
- compressed psychology
- subtle tension
- directional phrasing

IDEAL RESPONSE FORMULA:
  observation + psychological insight + subtle directional tension

NOT:
  emotion reflection + interview question

GOOD RESPONSES (directional, not reflective):
  hesitation:    "Usually when something gets pushed to later, there's still one concern that hasn't settled yet."
  pricing:       "Price usually feels heavy when the outcome still feels uncertain."
  skepticism:    "Honestly, skepticism usually comes after hearing too many promises that changed nothing."
  mixed interest:"Usually when someone sees value but still hesitates, the real issue is risk, not interest."
  dismissive:    "Most teams already have tools. Few feel fully confident in them."
  pricing good:  "Usually the real question is whether the outcome feels predictable enough yet."
  hesitation good:"Most hesitation shows up when certainty still feels incomplete."
  skepticism good:"People usually stop calling it hype once something starts changing operationally."
  ego good:      "Most teams already have tools. Few feel fully confident in what those tools are actually producing."

BAD RESPONSES (never sound like this):
  "Feels like you're not sure about this."
  "It sounds like you're hesitant."
  "I hear hesitation in what you're saying."
  "What specific metrics are you optimizing?"
  "Can you elaborate further?"
  "What are your top priorities?"
  "What's holding you back?"
  "What would convince you?"
  "Our implementation process improves efficiency."

— CRITICAL CONVERSATION RULE (followbackQuestion §1) —
Do NOT end every response with a question.
Socially intelligent people:
  - sometimes make an observation and stop
  - sometimes let tension sit
  - sometimes redirect perspective without asking anything
  - sometimes stop after one strong insight
Avoid constant conversational probing.

CONVERSATIONAL PACING RULES (followbackQuestion §7):
- Avoid sounding too eager.
- Do not try to push every conversation aggressively.
- Let strong observations breathe.
- Calm confidence is stronger than constant questioning.
- Stopping after one sharp insight often creates more impact.

RESPONSE COMPRESSION RULES:
- Strong responses often sound observational, not informational.
- Avoid explaining too much. Avoid sounding overly complete.
- 1 strong sentence is often enough.
- One sharp insight is stronger than long logic.
- Compressed insight feels more human.

CURRENT RESPONSE ENERGY: {response_energy}
{energy_description}

INTENT BEHAVIOR:
{intent_behavior}

RAG INSIGHTS (HINTS ONLY — do not repeat verbatim):
{rag_context}

CURRENT DEAL STATE:
- Stage: {self.deal_state["stage"]}
- Pressure Level: {self.deal_state["pressure_level"]}
- System Strategy: {final_strategy}
- Avoid recently used strategies: [{avoid_strategies}]

{context_str}

OUTPUT JSON:
{{
  "intent": "...",
  "stage": "...",
  "strategy": "...",
  "confidence": 0.0,
  "response": "...",
  "next_question": "...",
  "coaching_tip": "..."
}}
"""

        prev_context = list(self.message_buffer[:-1])

        # followbackQuestion §2/§9: Rhythm distribution + length rules injected per-call
        question_instruction = (
            'Set "next_question" to "" (empty string). Do NOT include a question in the response field.'
            if avoid_question else
            'A question is allowed ONLY if prospect shows genuine curiosity, confusion, or buying intent.'
        )

        prompt = f"""
Conversation Buffer:
{json.dumps(prev_context)}

LATEST PROSPECT MESSAGE:
"{text}"

RESPONSE RHYTHM RULE (followbackQuestion §2):
Choose ONE of these ending styles naturally — do NOT always ask a question:
  - observation only          → 35% of responses
  - observation + tension     → 30% of responses
  - observation + soft question → 25% of responses
  - direct challenge          → 10% of responses

FOR THIS RESPONSE:
{question_instruction}

RESPONSE LENGTH RULE (followbackQuestion §9):
- 1 strong sentence is often enough.
- Avoid overexplaining or stacking logic.
- Compressed insight feels more human than complete answers.

Output strictly conforming JSON.
"""

        for attempt in range(2):
            try:
                llm_response = await asyncio.wait_for(
                    self.client.chat.completions.create(
                        model="llama-3.3-70b-versatile",
                        messages=[
                            {"role": "system", "content": system_content},
                            {"role": "user", "content": prompt}
                        ],
                        response_format={"type": "json_object"},
                        temperature=0.3 + (attempt * 0.4),
                    ),
                    timeout=self.max_latency
                )

                content = llm_response.choices[0].message.content
                data = json.loads(content)

                intent = data.get("intent", "neutral")
                self.deal_state["last_intent"] = intent
                self.update_stage(intent)

                if intent in ["pricing", "trust", "hesitation"]:
                    self.deal_state["objections_handled"].append(intent)

                suggested_resp = data.get("response", "").strip()
                if not suggested_resp:
                    return self.smart_fallback(text)

                # Anti-Repetition
                if self.is_duplicate(suggested_resp):
                    print("[BLOCKED] Duplicate response prevented")
                    return self.smart_fallback(text)

                # ── psychofancy_v1 §6: GPT Detox — ban corporate/generic patterns ─
                response_lower = suggested_resp.lower()
                if any(p in response_lower for p in BANNED_PATTERNS):
                    print("[REWRITE_TRIGGER] GPT-detox: banned pattern detected, using fallback")
                    return self.smart_fallback(text)

                # ── psychofancy_v2 §7: Humanization layer — split rates ───────
                # Primary softeners: ~15% rate (directional, conversational)
                # Passive softeners ("Feels like", "It sounds like"): ≤5% rate
                all_phrases = list(HUMANIZATION_PHRASES)
                if random.random() < 0.05:          # 5% — passive softeners allowed
                    all_phrases.extend(_PASSIVE_SOFTENERS)

                if random.random() < 0.15:
                    softener = random.choice(all_phrases)
                    first_word = suggested_resp.split()[0].lower().rstrip(",") if suggested_resp else ""
                    blocked = [p.lower().rstrip(",") for p in HUMANIZATION_PHRASES + _PASSIVE_SOFTENERS]
                    if first_word not in blocked:
                        suggested_resp = f"{softener} {suggested_resp[0].lower()}{suggested_resp[1:]}"
                        data["response"] = suggested_resp
                        print(f"[HUMANIZE] Softener injected: '{softener}'") 

                self.push_response_history(suggested_resp, data.get("strategy"))

                # followbackQuestion §3: Enforce question suppression in output
                if avoid_question:
                    data["next_question"] = ""
                    print("[QUESTION_FILTER] next_question suppressed")
                elif self.deal_state["stage"] == "closing":
                    data["next_question"] = "If this solves your problem, is there anything stopping you from moving forward today?"

                # Output Normalization for existing frontend fields
                data["suggested_response"] = suggested_resp
                data["next_best_question"] = data.get("next_question", "")
                data["persuasion_pattern"] = data.get("strategy", "")
                data["type"] = data.get("intent", "")
                data["deal_stage"] = data.get("stage", "")

                print(f"[AI_RESPONSE] OK | {data.get('strategy', 'NONE')} | {suggested_resp[:60]}...")
                return data

            except asyncio.TimeoutError:
                print(f"[AI_TIMEOUT] Exceeded {self.max_latency}s SLA limit. Forcing fallback.")
                return self.smart_fallback(text)
            except (json.JSONDecodeError, Exception) as e:
                print(f"[AI_ERROR] Engine Error: {e}")
                return self.smart_fallback(text)

        return self.smart_fallback(text)
