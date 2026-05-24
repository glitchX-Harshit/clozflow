# ml/evaluation/response_validator.py
# ─── Response Validator ──────────────────────────────────────────────────────
# Detects malformed, low-effort, repetitive, or fallback responses.
# Part of the Guardrails layer.

import re

BANNED_PHRASES = [
    "Most of the time",
    "Something underneath",
    "Fallback recovery",
    "As an AI",
    "I'm an AI",
    "I am an AI",
    "Can I help you with anything else",
    "How can I assist you today",
    "Usually",
    "Often",
    "Most teams",
    "The real issue",
    "The real question"
]

def validate_response(response: str, is_fallback: bool, confidence: float, api_error: bool, is_repetitive: bool, is_strategy_missing: bool) -> dict:
    """
    Validates a generated response against hard rules.
    Returns: {"is_valid": bool, "reason": str}
    """
    if api_error:
        return {"is_valid": False, "reason": "api_error_detected"}
        
    if is_fallback:
        return {"is_valid": False, "reason": "fallback_response"}
        
    if confidence < 0.82:
        return {"is_valid": False, "reason": f"low_confidence_score ({confidence})"}
        
    if is_strategy_missing:
        return {"is_valid": False, "reason": "strategy_prediction_missing"}
        
    if is_repetitive:
        return {"is_valid": False, "reason": "repetitive_pattern_detected"}
        
    if not response or not isinstance(response, str):
        return {"is_valid": False, "reason": "malformed_response (empty or invalid type)"}
        
    # Check word count (minimum 6 words)
    words = response.split()
    if len(words) < 6:
        return {"is_valid": False, "reason": f"response_length_too_short ({len(words)} words)"}
        
    # Check banned phrases
    response_lower = response.lower()
    for phrase in BANNED_PHRASES:
        if phrase.lower() in response_lower:
            return {"is_valid": False, "reason": f"contains_banned_phrase ('{phrase}')"}

    # Basic malformed check (e.g. repeated punctuation or weird tokens)
    if re.search(r"([!?.]){4,}", response):
        return {"is_valid": False, "reason": "malformed_response (excessive punctuation)"}
        
    return {"is_valid": True, "reason": "pass"}
