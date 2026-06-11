import os
import json
import yaml
import time
import random
import asyncio
from typing import Any
from openai import AsyncOpenAI
from difflib import SequenceMatcher
from rag.rag_engine import RAGEngine
from ml.evaluation.learning_filter import filter_and_log_interaction
from backend.services.reasoning_router import reasoning_router

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ═══════════════════════════════════════════════════════════════════════════════
# HEXAGON CONVERSATION ENGINE V4.2 — Psychological Sharpness + Compact Prompts
# ═══════════════════════════════════════════════════════════════════════════════
#
# V4.2 Flow (reasoning in Python, generation in LLM):
#   prospect_message
#   → identify_hidden_concern  (reasoning_router)
#   → choose_conversation_goal (Python)
#   → choose_response_type     (Python)
#   → select_response_energy   (intent-driven map)
#   → generate_response        (LLM — compact prompt, generation-only)
#
# V4.2 upgrades over V3:
#   - ~70% smaller system prompt (removed duplicated reasoning)
#   - Intent-driven response energy (not random)
#   - Psychologically sharper fallback responses
#   - "Experienced operator" tone (not alpha/guru)
#   - Compressed persuasion bias
#   - All stability systems preserved
# ═══════════════════════════════════════════════════════════════════════════════


# ─── V3: Hidden Concern Mapping ───────────────────────────────────────────────
# Maps surface-level objection patterns to the REAL underlying concern
HIDDEN_CONCERN_MAP = {
    "budget": {
        "hidden_concern": "uncertain_roi",
        "default_goal": "diagnose",
        "keywords": ["price", "expensive", "budget", "cost", "afford", "money", "investment"],
    },
    "doing_fine": {
        "hidden_concern": "status_quo_protection",
        "default_goal": "define_success",
        "keywords": ["doing fine", "already", "internally", "we already", "don't need", "no need", "happy with"],
    },
    "not_interested": {
        "hidden_concern": "low_priority",
        "default_goal": "uncover_priority",
        "keywords": ["not interested", "pass", "no thanks", "not for us", "not right now", "maybe later"],
    },
    "need_to_think": {
        "hidden_concern": "unresolved_risk",
        "default_goal": "isolate_concern",
        "keywords": ["think about", "not sure", "maybe", "hesitate", "later", "need time", "get back to you"],
    },
    "already_have_vendor": {
        "hidden_concern": "switching_risk",
        "default_goal": "understand_gap",
        "keywords": ["already have", "current vendor", "using another", "partner", "competitor", "agency"],
    },
    "trust_issue": {
        "hidden_concern": "fear_of_making_bad_decision",
        "default_goal": "identify_trust_gap",
        "keywords": ["hype", "prove", "why should", "different", "scam", "heard that before", "what makes you"],
    },
    "direct_question": {
        "hidden_concern": "missing_information",
        "default_goal": "answer",
        "keywords": ["how much", "what does it cost", "why should i", "what changes", "how many", "what is different", "how does this help"],
    },
}

# ─── V3: Conversation Goals ──────────────────────────────────────────────────
CONVERSATION_GOALS = {
    "answer":                "Answer the direct question first",
    "diagnose":              "Understand root cause before prescribing anything",
    "clarify":               "Get prospect to articulate the real issue themselves",
    "isolate_concern":       "Narrow down the ONE thing blocking progress",
    "challenge_assumption":  "Gently expose a belief that's limiting their thinking",
    "define_success":        "Make them articulate what 'good' actually looks like",
    "uncover_priority":      "Find out what they actually care about right now",
    "quantify_problem":      "Attach a number or cost to the status quo",
    "future_pace":           "Help them visualize a better outcome without pitching",
    "understand_gap":        "Find out what's missing from their current setup",
    "identify_trust_gap":    "Discover where credibility broke down before",
}

# ─── V3: Response Types ──────────────────────────────────────────────────────
RESPONSE_TYPES = {
    "direct_answer":            "Answer a question directly without avoiding it",
    "objection_response":       "Directly address a stated concern or objection",
    "diagnostic_question":      "Ask a question that reveals the real issue",
    "perspective_shift":        "Reframe how they see the situation",
    "assumption_challenge":     "Challenge a belief they hold without being confrontational",
    "consequence_exploration":  "Help them see the cost of doing nothing",
    "future_projection":        "Paint a picture of what changes if they act",
    "risk_reversal":            "Remove the perceived risk of taking action",
}

# ─── V3: Mandatory Question Types ────────────────────────────────────────────
QUESTION_TYPES = [
    "diagnostic_question",
    "reflection_question",
    "clarification_question",
    "consequence_question",
]

# ─── V3: Forbidden Language (from YAML) ──────────────────────────────────────
FORBIDDEN_LANGUAGE = [
    "operationally",
    "implementation efficiency",
    "optimize workflow",
    "strategic alignment",
    "value proposition",
    "key metrics",
    "business optimization",
    "customer engagement",
    "online presence",
    "digital transformation",
    "maximize growth",
    "strategic opportunity",
    "unlock growth",
    "enhance visibility",
    "significant potential",
    "comprehensive information",
    "tailored solution",
    "drive more sales",
    "growth opportunity",
    "maximize conversions",
    "enhance brand presence",
    "improve customer acquisition",
    "strategic transformation",
]

# ─── V3: Banned Patterns (GPT Detox + consultant/therapist patterns) ─────────
BANNED_PATTERNS = [
    "what specific",
    "what are your",
    "can you elaborate",
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
    "what are your top priorities",
    "what outcomes would",
    "what's holding you back",
    "what would convince you",
    "what's your current",
    # V3 additions — consultant/therapist patterns
    "usually when",
    "most teams",
    "most businesses",
    "the reality is",
    "in practice,",
    "fair question",
    "out of curiosity",
    "help me understand",
    "let me ask you something",
]

# ─── V3: Quality Scoring Weights (from YAML) ─────────────────────────────────
V3_SCORING_WEIGHTS = {
    "diagnosis":    0.35,
    "curiosity":    0.25,
    "human_sound":  0.20,
    "persuasion":   0.10,
    "brevity":      0.10,
}

# ─── V4.2: Intent-Driven Response Energy Map ─────────────────────────────────
ENERGY_MAP = {
    "trust_issue":          "calm_authority",
    "budget":               "perspective_shift",
    "pricing":              "perspective_shift",
    "need_to_think":        "controlled_challenge",
    "delay":                "controlled_challenge",
    "not_interested":       "sharp_minimal",
    "rejection":            "sharp_minimal",
    "already_have_vendor":  "perspective_shift",
    "status_quo":           "perspective_shift",
    "direct_question":      "calm_authority",
    "curiosity":            "calm_authority",
    "risk":                 "calm_authority",
    "roi":                  "perspective_shift",
    "authority":            "controlled_challenge",
    "doing_fine":           "perspective_shift",
    "unknown":              "sharp_minimal",
}

ENERGY_DEFINITIONS = {
    "calm_authority": "grounded, experienced, confident without forcing",
    "controlled_challenge": "gently challenge assumptions, expose weak logic calmly",
    "perspective_shift": "reframe the situation, redirect thinking",
    "sharp_minimal": "fewer words, high conviction, direct impact",
}


def _detect_hidden_concern(text: str) -> dict:
    """V3 Reasoning Step 1: Identify what the prospect is really protecting."""
    route_data = reasoning_router.route(text)
    return {
        "type": route_data["surface_intent"],
        "hidden_concern": route_data["hidden_concern"],
        "default_goal": route_data["conversation_goal"],
        "strategy": route_data["response_strategy"],
        "confidence": route_data["confidence"],
    }

def _select_conversation_goal(hidden_concern: dict, deal_stage: str) -> str:
    """V3 Reasoning Step 3: Choose what we're trying to achieve with this response."""
    if deal_stage == "closing":
        return "future_pace"
    return hidden_concern.get("default_goal", "diagnose")

def _select_response_type(conversation_goal: str, concern_type: str, hidden_concern: dict = None) -> str:
    """V3 Reasoning Step 4: Choose the right response type for the goal."""
    if hidden_concern and "strategy" in hidden_concern:
        return hidden_concern["strategy"]
    return "diagnostic_question"


class SalesAIEngine:
    def __init__(self, call_context: dict[str, Any] | None = None, mode: str = "live"):
        self.call_context = call_context or {}
        self.mode = mode
        self.sim_config = None
        self.banned_sim_phrases = []
        if self.mode == "simulation":
            try:
                sim_yaml_path = os.path.join(os.path.dirname(__file__), "..", "..", "yaml_folder", "HEXAGON_SIMULATION_CONTEXT_ISOLATION_V1.yaml")
                with open(sim_yaml_path, "r", encoding="utf-8") as f:
                    self.sim_config = yaml.safe_load(f)
            except Exception as e:
                print(f"[WARNING] Could not load simulation config: {e}")
                
            if self.sim_config:
                sim_prof = self.sim_config.get("simulation_profile", {})
                self.call_context["product_name"] = sim_prof.get("product", "oat_milk")
                self.call_context["customer_type"] = sim_prof.get("customer", "local_cafe_owner")
                self.call_context["industry"] = sim_prof.get("industry", "cafe")
                self.call_context["prospect_type"] = sim_prof.get("prospect_type", "cafe_owner")
                
                interview_cleanup = self.sim_config.get("interview_mode_cleanup", {})
                self.banned_sim_phrases = [p.replace("_", " ") for p in interview_cleanup.get("ban_phrases", [])]
                
                reject = self.sim_config.get("response_validation", {}).get("before_returning_response", {}).get("reject_if_contains", [])
                self.banned_sim_phrases.extend([p.replace("_", " ").lower() for p in reject])

        self.message_buffer: list[dict[str, Any]] = []
        self.response_history: list[str] = []
        self.last_goals: list[str] = []

        self.deal_state = {
            "stage": "discovery",
            "last_intent": None,
            "objections_handled": [],
            "pressure_level": 1,
            "hidden_concerns_identified": [],
        }

        self.max_messages = 8
        self.max_latency = 15.0
        self._last_call_time: float = 0.0
        self._cooldown_secs: float = 2.0

        # Initialize AI client (using Groq)
        groq_key = os.getenv("GROQ_API_KEY")

        if groq_key:
            self.client = AsyncOpenAI(
                api_key=groq_key,
                base_url="https://api.groq.com/openai/v1"
            )
            self.model = "llama-3.3-70b-versatile"
            print(f"[AI_CLIENT] Groq client initialized for {self.mode} mode using llama-3.3-70b-versatile.")
        else:
            self.client = None
            self.model = None
            print(f"[AI_CLIENT] WARNING: No Groq API key found for {self.mode} mode — LLM calls will use fallback.")

        self.rag = RAGEngine()
        self.rag.load_index()

    # ──────────────────────────────────────────────────────────────────────────
    # Stability systems
    # ──────────────────────────────────────────────────────────────────────────

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
        for past in self.response_history:
            if SequenceMatcher(None, text_lower, past.lower()).ratio() > 0.70:
                return True
        return False

    def push_response_history(self, response: str, goal: str):
        self.response_history.append(response)
        if len(self.response_history) > 3:
            self.response_history.pop(0)
        if goal:
            self.last_goals.append(goal)
            if len(self.last_goals) > 2:
                self.last_goals.pop(0)

    # ──────────────────────────────────────────────────────────────────────────
    # V3: Smart Fallback — reasoning-first fallback responses
    # ──────────────────────────────────────────────────────────────────────────

    def smart_fallback(self, text: str = "") -> dict:
        text_lower = text.lower()
        hidden = _detect_hidden_concern(text)
        goal = _select_conversation_goal(hidden, self.deal_state["stage"])
        response_type = _select_response_type(goal, hidden["type"], hidden)

        # V4.2 fallback responses — psychologically sharp, reasoning-aware
        fallback_responses = {
            "pricing": [
                "If the price feels high, the value usually isn't fully clear yet.",
                "Most pricing hesitation comes from uncertainty around outcomes.",
                "The bigger cost is usually staying with what isn't fully working.",
            ],
            "budget": [
                "If the price feels high, the value usually isn't fully clear yet.",
                "Most pricing hesitation comes from uncertainty around outcomes.",
                "The bigger cost is usually staying with what isn't fully working.",
            ],
            "authority": [
                "When decisions slow down, there's usually one unresolved concern underneath.",
                "Sounds like alignment matters here more than timing.",
            ],
            "delay": [
                "Usually there's one real hesitation underneath everything else.",
                "Being unsure is normal when the outcome still feels uncertain.",
                "Sounds like something still isn't fully clicking yet.",
            ],
            "need_to_think": [
                "Usually there's one real hesitation underneath everything else.",
                "Being unsure is normal when the outcome still feels uncertain.",
                "Sounds like something still isn't fully clicking yet.",
            ],
            "status_quo": [
                "If the current setup was fully solving the problem, this probably wouldn't be a conversation.",
                "Doing things internally works — until growth exposes the gaps.",
            ],
            "doing_fine": [
                "If the current setup was fully solving the problem, this probably wouldn't be a conversation.",
                "Doing things internally works — until growth exposes the gaps.",
            ],
            "already_have_vendor": [
                "If the current setup was fully solving the problem, this probably wouldn't be a conversation.",
                "Doing things internally works — until growth exposes the gaps.",
            ],
            "not_interested": [
                "Feels like there's one important thing not fully aligned yet.",
                "Something underneath this still seems unresolved.",
            ],
            "rejection": [
                "Feels like there's one important thing not fully aligned yet.",
                "Something underneath this still seems unresolved.",
            ],
            "trust_issue": [
                "Trust usually breaks down when previous experiences didn't deliver.",
                "Skepticism makes sense — the real question is what proof would matter to you.",
            ],
            "trust": [
                "Trust usually breaks down when previous experiences didn't deliver.",
                "Skepticism makes sense — the real question is what proof would matter to you.",
            ],
            "risk": [
                "Usually there's one real hesitation underneath everything else.",
                "Sounds like something still isn't fully clicking yet.",
            ],
            "roi": [
                "If the price feels high, the value usually isn't fully clear yet.",
                "The bigger cost is usually staying with what isn't fully working.",
            ],
            "direct_question": [
                "To give you an honest answer, I'd need a bit more context on your current setup.",
                "That depends on where things stand right now. How are you currently handling this?",
            ],
            "curiosity": [
                "Good question. Let me give you the short version.",
                "That's worth unpacking — here's what actually matters.",
            ],
            "unknown": [
                "Feels like there's one important thing not fully aligned yet.",
                "Something underneath this still seems unresolved.",
                "Usually hesitation points to one core concern.",
            ],
        }

        concern_type = hidden["type"]
        responses = fallback_responses.get(concern_type, fallback_responses["unknown"])
        msg = random.choice(responses)

        # ML Adaptive Learning Layer
        filter_and_log_interaction(
            message=text,
            response=msg,
            strategy=response_type.upper(),
            confidence=0.7,
            emotional_state="neutral",
            is_fallback=True,
            api_error=False,
            is_repetitive=False,
        )

        return {
            "intent": concern_type,
            "stage": self.deal_state["stage"],
            "strategy": response_type.upper(),
            "confidence": 0.7,
            "response": msg,
            "next_question": "",
            "coaching_tip": f"Diagnosed hidden concern: {hidden['hidden_concern']}. Goal: {goal}.",
            # V3 reasoning fields
            "hidden_concern": hidden["hidden_concern"],
            "conversation_goal": goal,
            "response_type": response_type,
            "reasoning_chain": {
                "what_are_they_protecting": hidden["hidden_concern"],
                "what_are_they_worried_about": hidden["type"],
                "what_information_am_i_missing": "Insufficient data — used fallback reasoning",
                "should_i_diagnose_first": True,
            },
            "quality_scores": {
                "diagnosis": 0.6,
                "curiosity": 0.7,
                "human_sound": 0.8,
                "persuasion": 0.3,
                "brevity": 0.8,
            },
            # Backward-compat fields
            "suggested_response": msg,
            "next_best_question": "",
            "persuasion_pattern": response_type.upper(),
            "type": concern_type,
            "deal_stage": self.deal_state["stage"],
        }

    # ──────────────────────────────────────────────────────────────────────────
    # V3: Core Reasoning Loop
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

        print("[AI_TRIGGERED] V3 ReasoningBrain analyzing...")

        if not self.client:
            print("[AI_INFO] No LLM client configured — using fallback.")
            return self.smart_fallback(text)

        # ── V3 REASONING PIPELINE ────────────────────────────────────────────

        # Step 1: Identify hidden concern
        hidden = _detect_hidden_concern(text)
        print(f"[V3_REASONING] Hidden concern: {hidden['type']} -> {hidden['hidden_concern']}")

        # Step 2: Track concerns
        if hidden["type"] != "unknown":
            if hidden["type"] not in self.deal_state["hidden_concerns_identified"]:
                self.deal_state["hidden_concerns_identified"].append(hidden["type"])

        # Step 3: Choose conversation goal
        goal = _select_conversation_goal(hidden, self.deal_state["stage"])

        # Avoid repeating the same goal
        if self.last_goals and goal == self.last_goals[-1] and goal != "diagnose":
            alt_goals = [g for g in CONVERSATION_GOALS if g != goal and g != self.last_goals[-1] if g != "future_pace"]
            goal = random.choice(alt_goals) if alt_goals else goal

        # Step 4: Choose response type
        response_type = _select_response_type(goal, hidden["type"], hidden)
        print(f"[V3_REASONING] Goal: {goal} -> Response type: {response_type}")

        # Step 5: Determine if we should ask a question
        should_include_question = goal in ["diagnose", "clarify", "uncover_priority", "understand_gap"] or hidden["type"] == "unknown"

        # V4.2: Intent-driven response energy (not random)
        response_energy = ENERGY_MAP.get(hidden["type"], "sharp_minimal")
        energy_description = ENERGY_DEFINITIONS.get(response_energy, "")
        print(f"[V4.2_ENERGY] {hidden['type']} -> {response_energy}")

        # ── Build RAG context ────────────────────────────────────────────────
        rag_results = self.rag.retrieve(text)
        rag_context = "\n".join([
            f"- Insight: {r.get('insight', '')} | Avoid: {r.get('avoid', '')}"
            for r in rag_results
        ])

        context_str = ""
        if self.call_context:
            context_str = "\\nCALL CONTEXT:\\n" + json.dumps(self.call_context)

        sim_guardrails = ""
        if self.mode == "simulation" and self.sim_config:
            guard = self.sim_config.get("context_guardrail", {})
            allowed = ", ".join(guard.get("allowed_topics", []))
            forbidden = ", ".join(guard.get("forbidden_topics", []))
            
            sim_guardrails += f"\\nSIMULATION MODE ACTIVE (STRICT ISOLATION)\\n"
            sim_guardrails += f"Product: {self.call_context.get('product_name')}\\n"
            sim_guardrails += f"Industry: {self.call_context.get('industry')}\\n"
            sim_guardrails += f"Prospect: {self.call_context.get('prospect_type')}\\n"
            sim_guardrails += f"Allowed Topics: {allowed}\\n"
            sim_guardrails += f"Forbidden Topics: {forbidden}\\n"
            sim_guardrails += "NEVER mention Hexagon_AI, Acme_Corp, machine_learning, AI_assistant, SaaS, software_platform, dashboard, or analytics.\\n"
            sim_guardrails += "Every response MUST sound like a cafe_salesperson, NEVER like a SaaS_demo or AI_assistant.\\n"
            sim_guardrails += "Preferred patterns: observation, perspective_shift, answer_first, concise_reframe, one_targeted_question.\\n"

        avoid_goals = ", ".join(self.last_goals) if self.last_goals else "None"

        # ── Build conversation history ───────────────────────────────────────
        prev_context = list(self.message_buffer[:-1])

        print("\n=== V4.2 DEBUG INFO ===")
        print("Transcript       :", text)
        print("Hidden Concern   :", hidden)
        print("Conversation Goal:", goal)
        print("Response Type    :", response_type)
        print("Response Energy  :", response_energy)
        print("Deal State       :", self.deal_state)
        print("Question Required:", should_include_question)
        print("========================\n")

        # ── V4.2 System Prompt — Compact, generation-focused ──────────────────
        system_content = f"""You are "Hexagon CloserBrain" — a B2B sales intelligence engine.

IDENTITY:
You sound like an experienced operator — confident, direct, conversational.
Not a consultant, therapist, or motivational speaker.

TONE:
- calm authority
- conversational
- slightly sharp
- never needy or overly polite

RESPONSE ENERGY: {response_energy}
({energy_description})

RESPONSE STRUCTURE:
Start with an insight, observation, reframe, or challenge.
Then optionally ask ONE focused question.
Guide the conversation — do not react or interview.

RESPONSE RULES:
- 1–2 sentences ideal. 3 max.
- Compressed persuasion > long explanation.
- Perspective shifts > feature explanations.
- Strong responses use 8–20 impactful words.
- Answer direct questions FIRST, then follow up.
- {"A question is recommended here to gain clarity." if should_include_question else "Questions are optional — don't force one."}

AVOID:
"What specific...", "I understand your concern", "Let's explore",
"Our solution helps", "This can improve", "Fair question",
"Help me understand", "Out of curiosity"

{f'RAG HINTS: {rag_context}' if rag_context.strip() else ''}
{sim_guardrails}

DEAL STATE: {self.deal_state['stage']} | Pressure: {self.deal_state['pressure_level']} | Avoid goals: [{avoid_goals}]
{context_str}

OUTPUT JSON:
{{
  "intent": "surface intent",
  "stage": "deal stage",
  "strategy": "response type used",
  "confidence": 0.0,
  "response": "1-3 sentences max",
  "next_question": "optional follow-up question",
  "coaching_tip": "brief rep advice",
  "hidden_concern": "underlying concern",
  "conversation_goal": "goal pursued",
  "response_type": "type used",
  "reasoning_chain": {{
    "what_are_they_protecting": "...",
    "what_are_they_worried_about": "...",
    "what_information_am_i_missing": "...",
    "should_i_diagnose_first": true
  }},
  "quality_scores": {{
    "diagnosis": 0.0,
    "curiosity": 0.0,
    "human_sound": 0.0,
    "persuasion": 0.0,
    "brevity": 0.0
  }}
}}"""

        prompt = f"""
Conversation: {json.dumps(prev_context)}

PROSPECT: "{text}"

REASONING (pre-computed):
- Hidden concern: {hidden['hidden_concern']}
- Surface intent: {hidden['type']}
- Goal: {goal} — {CONVERSATION_GOALS.get(goal, '')}
- Response type: {response_type} — {RESPONSE_TYPES.get(response_type, '')}
- Energy: {response_energy}

Generate response. Answer direct questions first. Output strict JSON.
"""

        for attempt in range(2):
            try:
                llm_response = await asyncio.wait_for(
                    self.client.chat.completions.create(
                        model=self.model,
                        messages=[
                            {"role": "system", "content": system_content},
                            {"role": "user", "content": prompt},
                        ],
                        response_format={"type": "json_object"},
                        temperature=0.4 + (attempt * 0.3),
                    ),
                    timeout=self.max_latency,
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

                # V3 GPT Detox — ban consultant/therapist/corporate patterns
                response_lower = suggested_resp.lower()
                banned_total = BANNED_PATTERNS + (self.banned_sim_phrases if self.mode == "simulation" else [])
                if any(p in response_lower for p in banned_total):
                    print("[REWRITE_TRIGGER] V3 GPT-detox: banned pattern detected, using fallback")
                    return self.smart_fallback(text)

                # V3 Forbidden language check
                if any(phrase in response_lower for phrase in FORBIDDEN_LANGUAGE):
                    print("[REWRITE_TRIGGER] V3 Forbidden language detected, using fallback")
                    return self.smart_fallback(text)

                self.push_response_history(suggested_resp, data.get("conversation_goal", goal))

                # Ensure V3 reasoning fields are populated
                if "hidden_concern" not in data:
                    data["hidden_concern"] = hidden["hidden_concern"]
                if "conversation_goal" not in data:
                    data["conversation_goal"] = goal
                if "response_type" not in data:
                    data["response_type"] = response_type
                if "reasoning_chain" not in data:
                    data["reasoning_chain"] = {
                        "what_are_they_protecting": hidden["hidden_concern"],
                        "what_are_they_worried_about": hidden["type"],
                        "what_information_am_i_missing": "Inferred from conversation",
                        "should_i_diagnose_first": True,
                    }
                if "quality_scores" not in data:
                    data["quality_scores"] = {
                        "diagnosis": 0.8,
                        "curiosity": 0.7,
                        "human_sound": 0.8,
                        "persuasion": 0.5,
                        "brevity": 0.8,
                    }

                # Backward-compat output normalization
                data["suggested_response"] = suggested_resp
                data["next_best_question"] = data.get("next_question", "")
                data["persuasion_pattern"] = data.get("strategy", "")
                data["type"] = data.get("intent", "")
                data["deal_stage"] = data.get("stage", "")

                print(f"[AI_RESPONSE] V3 OK | Goal: {data.get('conversation_goal')} | Type: {data.get('response_type')} | {suggested_resp[:60]}...")

                # ML Adaptive Learning Layer
                filter_and_log_interaction(
                    message=text,
                    response=suggested_resp,
                    strategy=data.get("strategy", "NONE"),
                    confidence=data.get("confidence", 0.9),
                    emotional_state=hidden["type"],
                    is_fallback=False,
                    api_error=False,
                    is_repetitive=False,
                )

                return data

            except asyncio.TimeoutError:
                print(f"[AI_TIMEOUT] Exceeded {self.max_latency}s SLA limit. Forcing fallback.")
                return self.smart_fallback(text)
            except (json.JSONDecodeError, Exception) as e:
                print(f"[AI_ERROR] V3 Engine Error: {e}")
                return self.smart_fallback(text)

        return self.smart_fallback(text)
