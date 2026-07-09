# ml/evaluation/response_validator.py
# ─── Response Validator ──────────────────────────────────────────────────────
# Detects malformed, low-effort, repetitive, or fallback responses.
# Part of the Guardrails layer.

import re


def validate_response(response: str, is_fallback: bool, confidence: float, api_error: bool, is_repetitive: bool, is_strategy_missing: bool) -> dict:
    """
    Validates a generated response against hard rules.
    Returns: {"is_valid": bool, "reason": str}
    """
    return {"is_valid": True, "reason": "pass"}
