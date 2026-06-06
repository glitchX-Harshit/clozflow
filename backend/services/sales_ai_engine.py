import os
import json
import time
import random
import asyncio
from typing import Any
from openai import AsyncOpenAI
from difflib import SequenceMatcher
from rag.rag_engine import RAGEngine
from ml.evaluation.learning_filter import filter_and_log_interaction
from backend.services.reasoning_router import reasoning_router

# ═══════════════════════════════════════════════════════════════════════════════
# HEXAGON CONVERSATION ENGINE V3 — Reasoning-First Architecture
# ═══════════════════════════════════════════════════════════════════════════════
#
# V3 Flow:
#   prospect_message
#   → identify_hidden_concern
#   → identify_missing_information
#   → choose_conversation_goal
#   → choose_response_type
#   → generate_response
#
# This replaces the V2 strategy-first flow (prospect → strategy → response)
# which produced generic reframes, consultant language, and conversation stalls.
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
        self.call_context = call_context
        self.mode = mode
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
        self.max_latency = 8.0
        self._last_call_time: float = 0.0
        self._cooldown_secs: float = 2.0

        # Initialize Gemini client
        api_key = os.getenv("GEMINI_API_KEY")

        if api_key:
            self.client = AsyncOpenAI(
                api_key=api_key,
                base_url="https://generativelanguage.googleapis.com/v1beta/openai/"
            )
            print(f"[AI_CLIENT] Gemini client initialized for {self.mode} mode with key: {api_key[:8]}...")
        else:
            self.client = None
            print(f"[AI_CLIENT] WARNING: Gemini API key not found for {self.mode} mode — LLM calls will use fallback.")

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

        # V3 fallback responses — diagnostic, not persuasive
        fallback_responses = {
            "budget": [
                "If we could prove the ROI made sense, would budget still be the main hurdle?",
                "Is the concern the actual cost, or just making sure it pays off?",
            ],
            "doing_fine": [
                "Glad to hear things are stable. Is there any specific area you're still trying to optimize?",
                "That's great. What's the main metric you're using to measure that success?",
            ],
            "not_interested": [
                "No problem at all. Just curious, what would have to change for this to be relevant?",
                "Got it. Is it just bad timing, or does this just not fit your current strategy?",
            ],
            "need_to_think": [
                "Makes total sense. What's the main thing you want to mull over?",
                "Absolutely. Is there a specific part of this that isn't sitting right yet?",
            ],
            "already_have_vendor": [
                "Makes sense to stick with who you know. Are they handling everything you need right now?",
                "Understood. Is there anything you wish your current setup did slightly better?",
            ],
            "trust_issue": [
                "I get the skepticism. What kind of proof would actually make you feel comfortable?",
                "Totally fair. What's the biggest risk you see in moving forward with something like this?",
            ],
            "direct_question": [
                "To give you the most accurate answer, could you share a bit more context on your current setup?",
                "That depends on your specific use case. How are you currently handling this?",
            ],
            "unknown": [
                "Could you elaborate a bit more on that?",
                "I want to make sure I fully understand. Can you walk me through what you mean?",
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

        # ── Build RAG context ────────────────────────────────────────────────
        rag_results = self.rag.retrieve(text)
        rag_context = "\n".join([
            f"- Insight: {r.get('insight', '')} | Avoid: {r.get('avoid', '')}"
            for r in rag_results
        ])

        context_str = ""
        if self.call_context:
            context_str = "\nCALL CONTEXT:\n" + json.dumps(self.call_context)

        avoid_goals = ", ".join(self.last_goals) if self.last_goals else "None"

        # ── Build conversation history ───────────────────────────────────────
        prev_context = list(self.message_buffer[:-1])

        print("\n=== V3 DEBUG INFO ===")
        print("Transcript       :", text)
        print("Hidden Concern   :", hidden)
        print("Conversation Goal:", goal)
        print("Response Type    :", response_type)
        print("Deal State       :", self.deal_state)
        print("Question Required:", should_include_question)
        print("=====================\n")

        # ── V3 System Prompt ─────────────────────────────────────────────────
        system_content = f"""You are Hexagon — a reasoning-first conversational sales AI.

═══ CORE PHILOSOPHY ═══
You do NOT pick a strategy and generate a response.
You THINK first, then respond.
Understand before persuading.
Answer before diagnosing.
Clarify only when needed.
Questions are tools, not requirements.

Success is NOT: prospect objects → AI reframes.
Success IS: prospect objects → AI understands → AI diagnoses → AI guides.

═══ YOUR IDENTITY ═══
You sound like: a founder, an operator, an experienced closer.
You do NOT sound like: a consultant, a therapist, a LinkedIn creator, a motivational speaker.
Reading level: SIMPLE. Tone: CONVERSATIONAL. Sound HUMAN natively (no injected filler phrases).

═══ REASONING ENGINE (you must do this before responding) ═══
Before generating any response, answer these 4 questions internally:

1. What is the prospect protecting?
   → Answer: {hidden['hidden_concern']}

2. What are they worried about?
   → Their surface objection maps to: {hidden['type']}

3. What information am I missing?
   → Think: what don't I know yet that would change my approach?

4. Should I clarify or answer first?
   → Default rule: IF they ask a direct question → ANSWER IT. IF information is missing → ask a diagnostic question.

═══ RESPONSE PRIORITY ═══
1. answer_direct_questions_first
2. address_objections_second
3. diagnose_third
4. create_curiosity_fourth
5. advance_conversation_fifth

═══ CONVERSATION GOAL FOR THIS RESPONSE ═══
Goal: {goal} — {CONVERSATION_GOALS.get(goal, '')}
Response Type: {response_type} — {RESPONSE_TYPES.get(response_type, '')}

═══ AVAILABLE RESPONSE TYPES ═══
- direct_answer: Answer a question directly without avoiding it
- objection_response: Directly address a stated concern or objection
- diagnostic_question: Ask a question that reveals the real issue
- perspective_shift: Reframe how they see the situation
- assumption_challenge: Challenge a belief without being confrontational
- consequence_exploration: Help them see the cost of doing nothing
- future_projection: Paint a picture of what changes if they act
- risk_reversal: Remove the perceived risk of taking action

═══ MANDATORY QUESTION ENGINE ═══
{"A question is recommended here to gain clarity." if should_include_question else "Questions are OPTIONAL. Do not force a question if the natural conversation progresses without one."}

═══ HIDDEN CONCERN MAPPING ═══
- budget → hidden concern: uncertain ROI → goal: diagnose
- doing_fine → hidden concern: status quo protection → goal: define success
- not_interested → hidden concern: low priority → goal: uncover priority
- need_to_think → hidden concern: unresolved risk → goal: isolate concern
- already_have_vendor → hidden concern: switching risk → goal: understand gap
- trust_issue → hidden concern: fear of bad decision → goal: identify trust gap
- direct_question → hidden concern: missing information → goal: answer

═══ LANGUAGE RULES ═══
FORBIDDEN PHRASES (NEVER use):
- operationally, implementation efficiency, optimize workflow
- strategic alignment, value proposition, key metrics
- business optimization, customer engagement
- "usually when", "most teams", "most businesses"
- "the reality is", "in practice,"
- "I understand your concern", "I hear hesitation"
- "It sounds like you're", "Feels like you're"
- "Fair question", "Out of curiosity", "Help me understand", "Let me ask you something"

═══ EXAMPLE TRANSFORMATIONS ═══
BAD: "Budgets are usually tight when ROI is unclear."
GOOD: "If this somehow paid for itself in three months, would budget still be the issue — or is the real concern whether it works?"

BAD (Direct Question):
prospect: "How many customers will I get?"
ai: "If you could change one thing about your business..."
GOOD (Direct Question):
prospect: "How many customers will I get?"
ai: "I can't honestly promise a specific number. What I can do is help estimate the opportunity based on your current customer flow. How many new customers do you typically get each month?"

═══ RESPONSE RULES ═══
- 1-2 sentences is ideal. 3 sentences max.
- Compressed insight > long explanation.
- Sound like a real person having a real conversation.
- Never start with "I understand" or "It sounds like."
- If answering a direct question, give the direct answer FIRST, then optionally ask a follow-up.

═══ QUALITY SCORING (optimize for this) ═══
- Diagnosis weight: 0.35 — Does the response actually understand the real issue?
- Curiosity weight: 0.25 — Does the response create genuine curiosity?
- Human sound weight: 0.20 — Does it sound like a real person?
- Persuasion weight: 0.10 — Does it move the conversation forward?
- Brevity weight: 0.10 — Is it compressed and punchy?

RAG INSIGHTS (use as hints, never repeat verbatim):
{rag_context}

CURRENT DEAL STATE:
- Stage: {self.deal_state["stage"]}
- Pressure Level: {self.deal_state["pressure_level"]}
- Hidden Concerns Found: {', '.join(self.deal_state['hidden_concerns_identified']) or 'None yet'}
- Avoid recently used goals: [{avoid_goals}]

{context_str}

OUTPUT JSON (strict format):
{{
  "intent": "the prospect's surface intent (e.g., pricing, trust, hesitation, interest, confusion, neutral)",
  "stage": "current deal stage (discovery, objection, closing)",
  "strategy": "response type used (e.g., DIAGNOSTIC_QUESTION, PERSPECTIVE_SHIFT, etc.)",
  "confidence": 0.0,
  "response": "your actual response text — 1-3 sentences max",
  "next_question": "the diagnostic/reflection/clarification/consequence question (if applicable)",
  "coaching_tip": "brief tactical advice for the sales rep",
  "hidden_concern": "the real underlying concern you identified",
  "conversation_goal": "the goal you pursued with this response",
  "response_type": "which response type you used",
  "reasoning_chain": {{
    "what_are_they_protecting": "...",
    "what_are_they_worried_about": "...",
    "what_information_am_i_missing": "...",
    "should_i_diagnose_first": true/false
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
Conversation Buffer:
{json.dumps(prev_context)}

LATEST PROSPECT MESSAGE:
"{text}"

IDENTIFIED HIDDEN CONCERN: {hidden['hidden_concern']}
CONVERSATION GOAL: {goal}
RESPONSE TYPE TO USE: {response_type}

CRITICAL RULE: Think before you respond. Answer before you diagnose.
If they asked a direct question, answer it directly. If information is missing, ask a diagnostic question.

Output strictly conforming JSON.
"""

        for attempt in range(2):
            try:
                llm_response = await asyncio.wait_for(
                    self.client.chat.completions.create(
                        model="gemini-3.5-flash",
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
                if any(p in response_lower for p in BANNED_PATTERNS):
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
