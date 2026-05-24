# ml/evaluation/learning_filter.py
# ─── Learning Filter ─────────────────────────────────────────────────────────
# Pipeline that runs responses through the validator and quality scorer.
# Routes approved data to high_quality_learning.jsonl and rejected to rejected_learning.jsonl.

import os
import json
import time

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

APPROVED_LOG = os.path.join(_ROOT, "logs", "high_quality_learning.jsonl")
REJECTED_LOG = os.path.join(_ROOT, "logs", "rejected_learning.jsonl")

from ml.evaluation.response_validator import validate_response
from ml.evaluation.quality_scorer import score_quality

def filter_and_log_interaction(
    message: str,
    response: str,
    strategy: str,
    confidence: float,
    emotional_state: str,
    is_fallback: bool,
    api_error: bool,
    is_repetitive: bool
) -> bool:
    """
    Evaluates an interaction and logs it appropriately.
    Returns True if approved, False if rejected.
    """
    
    # 1. Hard Validation
    val_result = validate_response(
        response=response,
        is_fallback=is_fallback,
        confidence=confidence,
        api_error=api_error,
        is_repetitive=is_repetitive,
        is_strategy_missing=(not strategy)
    )
    
    # 2. Quality Scoring
    quality_result = score_quality(response, strategy, emotional_state)
    
    is_approved = False
    reject_reason = val_result["reason"]
    
    if val_result["is_valid"]:
        if quality_result["score"] >= 0.85:
            is_approved = True
        else:
            reject_reason = f"low_quality_score ({quality_result['score']:.2f})"
            
    # 3. Log to appropriate file
    log_entry = {
        "timestamp": time.time(),
        "message": message,
        "response": response,
        "strategy": strategy,
        "confidence": confidence,
        "emotional_state": emotional_state,
        "is_fallback": is_fallback,
        "quality_score": quality_result["score"],
        "quality_details": quality_result["details"],
        "validation_reason": val_result["reason"]
    }
    
    target_log = APPROVED_LOG if is_approved else REJECTED_LOG
    
    os.makedirs(os.path.dirname(target_log), exist_ok=True)
    with open(target_log, "a", encoding="utf-8") as f:
        f.write(json.dumps(log_entry) + "\n")
        
    return is_approved
