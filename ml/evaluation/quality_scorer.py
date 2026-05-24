# ml/evaluation/quality_scorer.py
# ─── Quality Scorer ──────────────────────────────────────────────────────────
# Evaluates the "humanness", strategic precision, and emotional relevance
# of a response.

def score_quality(response: str, strategy: str, emotional_state: str) -> dict:
    """
    Assigns a quality score to a response.
    Returns: {"score": float, "details": dict}
    """
    # For a real implementation, this could use an LLM-as-a-judge or a trained reward model.
    # We will use heuristics here to approximate a score >= 0.85 for "good" responses.
    
    score = 1.0
    details = {
        "strategy_alignment": 1.0,
        "human_like_tone": 1.0,
        "response_specificity": 1.0,
        "conversational_flow": 1.0,
        "emotional_relevance": 1.0
    }
    
    # Heuristic 1: Overly long responses are usually less "conversational" and "human"
    words = response.split()
    if len(words) > 30:
        details["human_like_tone"] -= 0.15
        details["conversational_flow"] -= 0.1
        score -= 0.15
        
    # Heuristic 2: Lack of punctuation usually means bad flow or malformed
    if not any(c in ".!?" for c in response):
        details["conversational_flow"] -= 0.2
        score -= 0.1
        
    # Heuristic 3: Robotic transitions
    if response.startswith("Here is") or response.startswith("I understand") or response.startswith("It sounds like"):
        details["human_like_tone"] -= 0.2
        score -= 0.15

    # Heuristic 4: Reward operational specificity
    operational_keywords = ["staff", "approval", "friction", "rollout", "adoption", "customer flow", "resistance", "overhead", "bottleneck"]
    response_lower = response.lower()
    if any(k in response_lower for k in operational_keywords):
        details["response_specificity"] = min(1.0, details["response_specificity"] + 0.2)
        score = min(1.0, score + 0.1)

    # Heuristic 5: Penalize philosophical abstractions
    abstract_keywords = ["journey", "synergy", "landscape", "paradigm", "realm", "empower", "unlock your potential"]
    if any(k in response_lower for k in abstract_keywords):
        details["human_like_tone"] -= 0.2
        details["response_specificity"] -= 0.2
        score -= 0.15

    # Clip scores to [0.0, 1.0]
    score = max(0.0, min(1.0, score))
    for k in details:
        details[k] = max(0.0, min(1.0, details[k]))
        
    return {
        "score": score,
        "details": details
    }
