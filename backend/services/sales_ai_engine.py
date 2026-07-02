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
# HEXAGON CONVERSATION ENGINE V5.0 — Response Quality Refactor
# ═══════════════════════════════════════════════════════════════════════════════
#
# V5.0 Flow (reasoning in Python, generation-only LLM):
#   prospect_message
#   → identify_hidden_concern  (reasoning_router — unchanged)
#   → choose_conversation_goal (Python — unchanged)
#   → choose_response_type     (Python — unchanged)
#   → select_response_energy   (intent-driven map — unchanged)
#   → inject_few_shot_examples (NEW — concern-specific BAD/GOOD pairs)
#   → generate_response        (LLM — 3-field output only)
#   → populate_metadata        (Python — fills intent/stage/strategy/etc.)
#
# V5.0 upgrades over V4.2:
#   - LLM generates only {response, next_question, coaching_tip}
#   - Python populates all metadata fields post-generation
#   - Few-shot examples per concern type (BAD → GOOD)
#   - Natural sales voice (not consultant/engine)
#   - Clean transcript format (PROSPECT:/REP: not JSON)
#   - Conversational fallback library
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


# ─── V5.0: Few-Shot Example Library (BAD → GOOD per concern) ─────────────────
# These examples are injected into the user prompt to teach the LLM tone by
# demonstration. Each concern type gets 1-2 example pairs.
_FEW_SHOT_BY_CONCERN = {
    "pricing": """EXAMPLES (study the tone, don't copy):
PROSPECT: "It's too expensive."
BAD: "I understand your concern about pricing. Let me explain the value proposition and ROI you'll see."
GOOD: {"response": "Price only stings when the payoff isn't clear yet. What outcome would make this a no-brainer?", "next_question": "", "coaching_tip": "Don't defend price — redirect to value gap."}
""",
    "budget": """EXAMPLES (study the tone, don't copy):
PROSPECT: "We don't have the budget for this right now."
BAD: "I understand budget constraints can be challenging. Let's explore how we can work within your budget."
GOOD: {"response": "Heard. What if we started smaller and let the results justify scaling up?", "next_question": "", "coaching_tip": "Offer a smaller entry point, don't argue the budget."}
""",
    "need_to_think": """EXAMPLES (study the tone, don't copy):
PROSPECT: "I need to think about it."
BAD: "Of course, take your time. What specific aspects would you like to consider further?"
GOOD: {"response": "For sure. What's the one thing that would tip it from 'maybe' to 'let's do it'?", "next_question": "", "coaching_tip": "Isolate the real blocker — 'think about it' is never the actual issue."}
""",
    "delay": """EXAMPLES (study the tone, don't copy):
PROSPECT: "Can we revisit this next quarter?"
BAD: "Absolutely, I understand timing is important. When would be a good time to reconnect?"
GOOD: {"response": "Sure. What changes between now and then?", "next_question": "", "coaching_tip": "Make them confront that nothing changes by waiting."}
""",
    "trust_issue": """EXAMPLES (study the tone, don't copy):
PROSPECT: "I've heard this kind of pitch before."
BAD: "I completely understand your skepticism. Let me share some case studies that demonstrate our track record."
GOOD: {"response": "Yeah, most of it's noise. What went wrong last time?", "next_question": "", "coaching_tip": "Validate the skepticism, then dig into their bad experience."}
""",
    "trust": """EXAMPLES (study the tone, don't copy):
PROSPECT: "How do I know this actually works?"
BAD: "Great question! We have numerous success stories and testimonials from satisfied clients."
GOOD: {"response": "Fair. What kind of proof would actually move the needle for you — numbers, a reference call, a pilot?", "next_question": "", "coaching_tip": "Let them define what 'proof' means to them."}
""",
    "status_quo": """EXAMPLES (study the tone, don't copy):
PROSPECT: "We're doing fine with our current process."
BAD: "That's great to hear. However, there might be opportunities to optimize your workflow further."
GOOD: {"response": "Solid. Where's it costing you the most time right now?", "next_question": "", "coaching_tip": "Don't argue 'fine' — probe for the hidden friction."}
""",
    "doing_fine": """EXAMPLES (study the tone, don't copy):
PROSPECT: "We're handling everything internally."
BAD: "I understand you have internal resources. Let me show you how we can complement your existing efforts."
GOOD: {"response": "Nice. What's the one thing your team wishes they didn't have to do?", "next_question": "", "coaching_tip": "Find the task they'd love to offload."}
""",
    "already_have_vendor": """EXAMPLES (study the tone, don't copy):
PROSPECT: "We already work with someone for this."
BAD: "I understand you have an existing partner. What specific areas do you feel could be improved?"
GOOD: {"response": "Got it. How's that going — anything you wish worked differently?", "next_question": "", "coaching_tip": "Open the door to dissatisfaction without attacking the vendor."}
""",
    "not_interested": """EXAMPLES (study the tone, don't copy):
PROSPECT: "Not interested."
BAD: "I understand. Can I ask what specific aspects didn't resonate with you?"
GOOD: {"response": "Respect that. Mind if I ask what's behind it?", "next_question": "", "coaching_tip": "Short and direct — don't chase, just get the real reason."}
""",
    "rejection": """EXAMPLES (study the tone, don't copy):
PROSPECT: "We're going to pass."
BAD: "I'm sorry to hear that. Is there anything we could have done differently?"
GOOD: {"response": "Fair enough. What didn't land?", "next_question": "", "coaching_tip": "Get intel for next time. Don't grovel."}
""",
    "direct_question": """EXAMPLES (study the tone, don't copy):
PROSPECT: "How much does this cost?"
BAD: "That's a great question. The pricing depends on several factors and I'd love to walk you through our options."
GOOD: {"response": "Depends on the setup, but most teams land between X and Y. Where are you at scale-wise?", "next_question": "", "coaching_tip": "Give a range immediately, then qualify."}
""",
    "curiosity": """EXAMPLES (study the tone, don't copy):
PROSPECT: "How does this actually work?"
BAD: "Excellent question! Let me walk you through our comprehensive process and methodology."
GOOD: {"response": "Short version — we plug in, handle X, and you see Y within Z weeks. Want the longer breakdown?", "next_question": "", "coaching_tip": "Give the elevator pitch, then offer depth."}
""",
    "risk": """EXAMPLES (study the tone, don't copy):
PROSPECT: "What if it doesn't work?"
BAD: "I understand your concern about risk. We offer comprehensive support and a proven methodology."
GOOD: {"response": "What's the worst case you're picturing? Usually it's smaller than people think.", "next_question": "", "coaching_tip": "Name the fear to shrink it."}
""",
    "roi": """EXAMPLES (study the tone, don't copy):
PROSPECT: "I'm not sure we'd see the return."
BAD: "Let me share our ROI calculator and demonstrate the potential returns you could expect."
GOOD: {"response": "What does a win look like in numbers for you? Let's work backward from that.", "next_question": "", "coaching_tip": "Make them define success — then show how you deliver it."}
""",
    "authority": """EXAMPLES (study the tone, don't copy):
PROSPECT: "I need to run this by my team."
BAD: "Of course, team alignment is crucial. Would it be helpful if I prepared a presentation for your stakeholders?"
GOOD: {"response": "Totally. Who else needs to weigh in, and what would they want to see?", "next_question": "", "coaching_tip": "Map the buying committee. Don't just wait."}
""",
    "unknown": """EXAMPLES (study the tone, don't copy):
PROSPECT: "Hmm, interesting."
BAD: "I'm glad you find it interesting. Would you like me to elaborate on any specific aspect?"
GOOD: {"response": "What caught your attention?", "next_question": "", "coaching_tip": "Short prompt to get them talking. Don't fill silence with features."}
""",
}


def _get_few_shot_examples(concern_type: str) -> str:
    """V5.0: Return few-shot examples for the detected concern type."""
    return _FEW_SHOT_BY_CONCERN.get(concern_type, _FEW_SHOT_BY_CONCERN["unknown"])


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

        # V5.0 fallback responses — highly tactical closer language
        fallback_responses = {
            "pricing": [
                "Price is only an issue in the absence of value. What outcome makes this a no-brainer for you?",
                "Totally get it. What's the actual cost of keeping your current broken setup running for another year?",
                "Fair point. Let's flip it—what number makes sense for the ROI you're expecting?",
            ],
            "budget": [
                "Understood. What if we scaled it back initially and let the immediate ROI fund the rest?",
                "Makes sense. Usually when budget is tight, there's a massive leak somewhere else. Open to finding it?",
            ],
            "authority": [
                "Got it. Whose desk does this ultimately need to cross for a green light?",
                "Who else on your team feels the pain of this bottleneck every day?",
            ],
            "delay": [
                "No rush. But what exactly changes between now and next quarter?",
                "Fair enough. Usually delaying just compounds the friction. What's the biggest risk if you wait?",
            ],
            "need_to_think": [
                "Take all the time you need. But just to cut to the chase—what's the main hesitation you're weighing?",
                "For sure. Just so I have context, what would a 'yes' actually need to look like for your team?",
            ],
            "status_quo": [
                "If it's not broke, don't fix it. But where is the current setup secretly bottlenecking your team?",
                "Glad to hear it. Out of curiosity, what would literally have to break before you'd consider an upgrade?",
            ],
            "doing_fine": [
                "Love to hear that. Just curious, where do you see the biggest operational ceiling right now?",
                "That's solid. If you had a magic wand, what's the one piece of friction you'd delete today?",
            ],
            "already_have_vendor": [
                "How's that going? What's the one thing you wish they did better?",
                "Makes sense. Usually when teams have someone, there's still a 10% gap. Where's theirs?",
            ],
            "not_interested": [
                "Appreciate the transparency. Just so I know for my own data, what missed the mark?",
                "Respect that. Usually that means the timing is off or the pain isn't sharp enough. Which one is it?",
            ],
            "rejection": [
                "Fair enough. What exactly didn't land for you?",
            ],
            "trust_issue": [
                "Skepticism is completely warranted. What specific proof would actually move the needle for you?",
                "I get it—you've likely been burned before. What went wrong last time?",
            ],
            "trust": [
                "That's fair. What exactly would you need to see on a quick screen-share to believe it?",
            ],
            "risk": [
                "What's the absolute worst-case scenario you're picturing in your head right now?",
                "What exact metric would you need to see to feel like this is a completely safe bet?",
            ],
            "roi": [
                "What does a home run look like in pure revenue for you?",
                "Let's talk numbers. Where are you bleeding the most margin right now?",
            ],
            "direct_question": [
                "Direct answer: it completely depends on your current infrastructure. How are you guys set up right now?",
                "Let me give you a straight answer. But first, what exactly is breaking in your current process?",
            ],
            "curiosity": [
                "I can definitely walk you through that. What specific part of your workflow are you trying to patch?",
                "Yeah, I can break that down. But just to tailor it—what's the main bottleneck you're facing?",
            ],
            "unknown": [
                "Interesting pivot. Just to make sure we're aligned, what's the absolute biggest bottleneck in your operations today?",
                "Got it. Let me ask you this directly—what specific friction point are you actively trying to eliminate?",
                "Understood. Before we go deeper, how are you currently handling overflow and lost leads?",
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

        # ── Build conversation history (V5.0: clean transcript format) ────────
        prev_context = list(self.message_buffer[:-1])
        transcript_lines = []
        for msg in prev_context:
            label = "PROSPECT" if msg.get("speaker") == "prospect" else "REP"
            transcript_lines.append(f"{label}: {msg.get('text', '')}")
        formatted_history = "\n".join(transcript_lines) if transcript_lines else "(start of conversation)"

        print("\n=== V5.0 DEBUG INFO ===")
        print("Transcript       :", text)
        print("Hidden Concern   :", hidden)
        print("Conversation Goal:", goal)
        print("Response Type    :", response_type)
        print("Response Energy  :", response_energy)
        print("Deal State       :", self.deal_state)
        print("Question Required:", should_include_question)
        print("========================\n")

        # ── V5.0: Few-shot example injection ──────────────────────────────────
        few_shot_examples = _get_few_shot_examples(hidden["type"])

        # ── V5.0 System Prompt — Natural sales voice, generation-only ─────────
        system_content = f"""You are an elite, 11-year veteran sales strategist on a live chat. You've closed hundreds of deals. You're sharp, highly tactical, and you talk like a real human — not a chatbot, not a generic marketer.

Your ultimate goal is NEVER to just answer questions aimlessly. Every single response you generate MUST extract intelligence and strategically move the conversation forward toward QUALIFICATION and booking a Zoom meeting.

CRITICAL IDENTITY RULE: You are representing {self.call_context.get('your_company', 'a B2B software firm')} as a {self.call_context.get('your_role', 'strategist')}. NEVER pretend to be a customer, patient, or someone trying to buy their services. You are here to sell to them.

ENERGY: {response_energy} — {energy_description}

RULES:
- 1–2 sentences. 3 max. Shorter is almost always better.
- Acknowledge what they said organically, then immediately use a psychological PATTERN INTERRUPT to reframe the conversation.
- You do NOT always need to ask a question. Sometimes, the most powerful move is to just provide a sharp, insightful reply that organically moves the conversation forward.
- If they ask a direct question, give them a straight, conversational answer. You can occasionally append a soft qualification question, but DO NOT interrogate them on every single message.
- Sound like a highly experienced, friendly peer having a casual chat, NOT a desperate seller pitching a product.
- Never start with "I understand," "Great question," or "That's a fair point."

NEVER SAY:
"What specific...", "I understand your concern", "Let's explore",
"Our solution helps", "This can improve", "Fair question",
"Help me understand", "Out of curiosity", "Most businesses",
"The reality is", "In practice,", "Usually when", "I was trying to", "I noticed"

{f'CONTEXT HINTS (use as inspiration, never quote): {rag_context}' if rag_context.strip() else ''}
{sim_guardrails}

DEAL: {self.deal_state['stage']} stage | Pressure: {self.deal_state['pressure_level']} | Already tried: [{avoid_goals}]
{context_str}

OUTPUT (strict JSON, nothing else):
{{
  "response": "your tactical reply to the prospect",
  "next_question": "the tactical qualification question you appended to move the deal forward (or empty if included in response)",
  "coaching_tip": "one-line strategic advice for why you chose this angle"
}}"""

        prompt = f"""
{few_shot_examples}
---
Conversation so far:
{formatted_history}

PROSPECT: "{text}"

Context (already analyzed — just generate the response):
- They're concerned about: {hidden['hidden_concern']}
- Surface intent: {hidden['type']}
- Your goal: {goal} — {CONVERSATION_GOALS.get(goal, '')}
- Approach: {response_type} — {RESPONSE_TYPES.get(response_type, '')}
- Energy: {response_energy}

Respond as the rep. Answer direct questions first. Output strict JSON only.
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

                # V5.0: LLM only returns {response, next_question, coaching_tip}
                # Python populates all metadata fields
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

                self.push_response_history(suggested_resp, goal)

                # V5.0: Populate all metadata from Python (not LLM)
                intent = hidden["type"]
                self.deal_state["last_intent"] = intent
                self.update_stage(intent)

                if intent in ["pricing", "trust", "hesitation"]:
                    self.deal_state["objections_handled"].append(intent)

                data["intent"] = intent
                data["stage"] = self.deal_state["stage"]
                data["strategy"] = response_type.upper()
                data["confidence"] = hidden["confidence"]
                data["hidden_concern"] = hidden["hidden_concern"]
                data["conversation_goal"] = goal
                data["response_type"] = response_type
                data["reasoning_chain"] = {
                    "what_are_they_protecting": hidden["hidden_concern"],
                    "what_are_they_worried_about": hidden["type"],
                    "what_information_am_i_missing": "Inferred from conversation",
                    "should_i_diagnose_first": goal in ["diagnose", "clarify"],
                }
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

                print(f"[AI_RESPONSE] V5 OK | Goal: {data.get('conversation_goal')} | Type: {data.get('response_type')} | {suggested_resp[:60]}...")

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
