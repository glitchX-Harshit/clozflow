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

# ─── STEP 3: Response Energy Pool ─────────────────────────────────────────────
RESPONSE_ENERGIES = [
    "calm_authority",
    "controlled_challenge",
    "perspective_shift",
    "sharp_minimal",
    "status_pressure",
]

ENERGY_DEFINITIONS = {
    "calm_authority":      "grounded, experienced, confident without forcing",
    "controlled_challenge":"gently challenge assumptions, expose weak logic calmly",
    "perspective_shift":   "reframe the situation, redirect thinking",
    "sharp_minimal":       "fewer words, high conviction, direct impact",
    "status_pressure":     "imply positioning/status/perception importance, subtly elevate standards",
}

# ─── STEP 6: Banned questioning patterns ──────────────────────────────────────
BANNED_PATTERNS = [
    "what specific",
    "what are your",
    "can you elaborate",
    "help me understand",
]


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
    # STEP 5 — Upgraded smart_fallback
    # ──────────────────────────────────────────────────────────────────────────

    def smart_fallback(self, text: str = "") -> dict:
        text = text.lower()

        pricing = [
            "If the price feels high, the value usually isn't fully clear yet.",
            "Most pricing hesitation comes from uncertainty around outcomes.",
            "The bigger cost is usually staying with what isn't fully working.",
        ]
        authority = [
            "When decisions slow down, there's usually one unresolved concern underneath.",
            "Sounds like alignment matters here more than timing.",
            "Most delayed decisions come down to confidence, not process.",
        ]
        hesitation = [
            "Usually there's one real hesitation underneath everything else.",
            "Being unsure is normal when the outcome still feels uncertain.",
            "Sounds like something still isn't fully clicking yet.",
        ]
        dismissive = [
            "If the current setup was fully solving the problem, this probably wouldn't be a conversation.",
            "Most teams don't look for change unless something underneath isn't scaling properly.",
            "Doing things internally works — until growth exposes the gaps.",
        ]
        generic = [
            "Feels like there's one important thing not fully aligned yet.",
            "Something underneath this still seems unresolved.",
            "Usually hesitation points to one core concern.",
        ]

        if any(w in text for w in ["price", "expensive", "budget", "cost"]):
            msg = random.choice(pricing)
        elif any(w in text for w in ["partner", "team", "decision"]):
            msg = random.choice(authority)
        elif any(w in text for w in ["already", "internally", "doing fine"]):
            msg = random.choice(dismissive)
        elif any(w in text for w in ["not sure", "maybe", "later", "hesitate"]):
            msg = random.choice(hesitation)
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

        # ── STEP 3: Pick response energy before the LLM call ──────────────────
        response_energy = random.choice(RESPONSE_ENERGIES)
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

        # ── STEP 2 + STEP 4: New core system prompt ───────────────────────────
        system_content = f"""You are "Hexagon CloserBrain" — a high-level B2B sales intelligence engine.

Your role is not to simply answer objections.
Your role is to guide conversations toward clarity, confidence, and decisions.

RESPONSE STYLE:
- calm authority
- confident
- conversational
- slightly sharp
- never needy
- never overly polite

GOOD RESPONSES:
- shift perspective
- create clarity
- expose weak assumptions
- subtly create tension when needed
- sound socially intelligent

BAD RESPONSES:
- over-explaining
- feature dumping
- sounding desperate
- generic sales phrasing
- repetitive questioning

RESPONSE STRUCTURE:
- Start with an insight, observation, reframe, assumption, or challenge.
- Then optionally ask ONE focused question.

CONVERSATION RULES:
- guide instead of react
- avoid interview-mode behavior
- avoid asking broad discovery questions repeatedly
- move the conversation forward naturally
- build on previous context

AVOID PHRASES:
- "What specific..."
- "I understand your concern"
- "Let's explore"
- "Our solution helps"
- "This can improve"

RESPONSE ENERGY: {response_energy}
({energy_description})

RESPONSE LENGTH:
- 1–2 sentences
- high signal only
- compressed persuasion preferred

INTENT BEHAVIOR:
{intent_behavior}

RAG INSIGHTS (HINTS ONLY):
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

        prompt = f"""
Conversation Buffer:
{json.dumps(prev_context)}

LATEST PROSPECT MESSAGE:
"{text}"

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

                # ── STEP 6: Post-processing — ban generic questioning ──────────
                response_lower = suggested_resp.lower()
                if any(p in response_lower for p in BANNED_PATTERNS):
                    print("[REWRITE_TRIGGER] Generic questioning detected")
                    return self.smart_fallback(text)

                self.push_response_history(suggested_resp, data.get("strategy"))

                if self.deal_state["stage"] == "closing":
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
