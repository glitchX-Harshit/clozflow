import json
import logging
from typing import Dict, Any, Tuple

# Layer 1: Surface Intent
SURFACE_INTENTS = [
    "pricing", "trust", "roi", "delay", "authority", 
    "status_quo", "risk", "curiosity", "rejection", "direct_question"
]

# Layer 2: Hidden Concern
HIDDEN_CONCERN_MAP = {
    "pricing": ["affordability", "value_uncertainty", "cash_flow_pressure"],
    "trust": ["credibility_doubt", "vendor_fatigue", "fear_of_being_sold", "authenticity_test"],
    "roi": ["revenue_uncertainty", "proof_needed", "outcome_uncertainty"],
    "delay": ["low_priority", "avoidance", "lack_of_urgency"],
    "authority": ["needs_approval", "decision_not_owned"],
    "status_quo": ["comfort_with_current_system", "switching_cost_fear", "status_quo_evaluation"],
    "risk": ["fear_of_failure", "blame_avoidance", "career_risk", "status_quo_evaluation"],
    "curiosity": ["information_seeking", "exploration"],
    "rejection": ["hard_no", "soft_no"],
    "direct_question": ["missing_information"]
}

# Keywords for fallback routing (if no LLM router)
KEYWORDS = {
    "pricing": ["price", "expensive", "cost", "afford", "budget", "money"],
    "trust": ["trust", "prove", "why should", "scam", "different", "yourself"],
    "roi": ["return", "roi", "pay off", "revenue", "results"],
    "delay": ["later", "think about", "not right now", "time"],
    "authority": ["boss", "manager", "approve", "discuss with"],
    "status_quo": ["doing fine", "already have", "current", "happy with"],
    "risk": ["what happens", "fail", "worry", "risk", "if it doesn't"],
    "curiosity": ["how does", "what is", "tell me more"],
    "rejection": ["not interested", "no thanks", "stop", "pass"],
    "direct_question": ["how much", "how many", "what exactly"]
}

# Layer 3: Conversation Goal
GOALS = [
    "trust_building", "proof_delivery", "value_clarification", 
    "risk_reduction", "priority_creation", "curiosity_expansion", 
    "commitment_testing", "direct_answer", "objection_handling", "conversation_exit",
    "diagnose"
]

# Layer 4: Response Strategy Mapping
STRATEGY_MAPPING = {
    "trust_building": ["evidence", "transparency", "founder_perspective"],
    "proof_delivery": ["case_study", "example", "comparison"],
    "value_clarification": ["roi_breakdown", "outcome_explanation"],
    "risk_reduction": ["risk_reversal", "small_next_step"],
    "priority_creation": ["opportunity_cost", "consequence_exploration"],
    "direct_answer": ["answer_first"],
    "objection_handling": ["acknowledge", "answer", "advance"],
    "diagnose": ["diagnostic_question", "clarifying_question"]
}

class ReasoningRouter:
    def __init__(self):
        pass

    def route(self, text: str) -> Dict[str, Any]:
        text_lower = text.lower()
        
        # 1. Routing Priority: First: Detect Direct Question
        if any(kw in text_lower for kw in KEYWORDS["direct_question"]) or "?" in text:
            surface_intent = "direct_question"
            hidden_concern = "missing_information"
            goal = "direct_answer"
            strategy = "answer_first"
            confidence = 0.85
        else:
            # Simple keyword matching for fallback scoring
            best_intent = "unknown"
            best_score = 0
            
            for intent, kws in KEYWORDS.items():
                score = sum(1 for kw in kws if kw in text_lower)
                if score > best_score:
                    best_score = score
                    best_intent = intent
            
            surface_intent = best_intent
            confidence = min(1.0, best_score * 0.35)

            if surface_intent == "unknown":
                if confidence > 0.6:
                    surface_intent = "curiosity" # best match fallback
                    hidden_concern = "exploration"
                    goal = "curiosity_expansion"
                    strategy = "diagnostic_question"
                else:
                    surface_intent = "unknown"
                    hidden_concern = "unidentified_resistance"
                    goal = "diagnose"
                    strategy = "clarifying_question"
            else:
                # Pick the first hidden concern as default for the intent
                hidden_concern = HIDDEN_CONCERN_MAP.get(surface_intent, ["unidentified_resistance"])[0]
                
                # Goal mapping
                if surface_intent == "pricing": goal = "value_clarification"
                elif surface_intent == "trust": goal = "trust_building"
                elif surface_intent == "risk": goal = "risk_reduction"
                elif surface_intent == "status_quo": goal = "priority_creation"
                elif surface_intent == "delay": goal = "priority_creation"
                else: goal = "diagnose"
                
                # Strategy mapping
                strategy = STRATEGY_MAPPING.get(goal, ["diagnostic_question"])[0]

        return {
            "surface_intent": surface_intent,
            "hidden_concern": hidden_concern,
            "conversation_goal": goal,
            "response_strategy": strategy,
            "confidence": confidence
        }

reasoning_router = ReasoningRouter()
