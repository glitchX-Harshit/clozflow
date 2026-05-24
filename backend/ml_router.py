# backend/ml_router.py
# ─── ML Orchestration Router ──────────────────────────────────────────────────
# Central orchestration layer between the LLM pipeline and the ML engine.
#
# Responsibilities (from ML_inteligence.yaml):
#   1. receive_message        — accept prospect transcript
#   2. call_ml_prediction     — get strategy from ML (XGBoost, <50ms)
#   3. call_rag               — retrieve top-2 relevant insights
#   4. build_compressed_prompt — build 700-1200 token prompt
#   5. send_to_llm            — delegate ONLY response generation to LLM
#
# IMPORTANT RULES:
#   - ML handles: strategy, emotional state, hesitation pattern
#   - LLM handles: natural language response ONLY
#   - Keep ML fully isolated from RAG storage and frontend

import os
import sys
import json
import time

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from ml.inference.predict_strategy import predict_strategy, is_model_ready
from rag.rag_engine import RAGEngine

# ─── RAG singleton ────────────────────────────────────────────────────────────
_rag: RAGEngine | None = None


def _get_rag() -> RAGEngine:
    global _rag
    if _rag is None:
        _rag = RAGEngine()
        _rag.load_index()
    return _rag


# ─── Emotional state classifier (rule-based, zero latency) ───────────────────
def _classify_emotional_state(message: str) -> str:
    """
    Lightweight rule-based emotional state detection.
    ML handles strategy; this handles emotional tone.
    No API calls — pure keyword routing.
    """
    text = message.lower()
    if any(w in text for w in ["not sure", "maybe", "hesitate", "uncertain", "worried"]):
        return "uncertain"
    if any(w in text for w in ["already", "don't need", "doing fine", "we're fine"]):
        return "dismissive"
    if any(w in text for w in ["hype", "prove", "skeptic", "believe", "trust"]):
        return "skeptical"
    if any(w in text for w in ["expensive", "cost", "budget", "price"]):
        return "cost_anxious"
    if any(w in text for w in ["partner", "boss", "approval", "board", "cfo"]):
        return "authority_blocked"
    if any(w in text for w in ["later", "revisit", "next quarter", "wait"]):
        return "delaying"
    return "neutral"


# ─── Hesitation pattern detector ─────────────────────────────────────────────
def _detect_hesitation(message: str, strategy: str) -> bool:
    """
    Returns True if prospect shows hesitation pattern.
    Informed by ML strategy prediction.
    """
    hesitation_strategies = {"RISK_REVERSAL", "ROI_REFRAME"}
    hesitation_keywords = ["not sure", "maybe", "later", "wait", "hesitate", "still thinking"]
    text = message.lower()
    return (
        strategy in hesitation_strategies
        or any(w in text for w in hesitation_keywords)
    )


# ─── Short memory builder ─────────────────────────────────────────────────────
def _build_short_memory(message_buffer: list[dict], max_turns: int = 3) -> str:
    """
    Build a compressed memory string from recent buffer.
    Target: minimal tokens, max context.
    """
    recent = message_buffer[-max_turns:] if len(message_buffer) > max_turns else message_buffer
    return " | ".join(
        f"{m.get('speaker', '?')}: {m.get('text', '')[:60]}"
        for m in recent
    )


# ─── Compressed prompt builder ────────────────────────────────────────────────
def build_compressed_prompt(
    message: str,
    ml_result: dict,
    rag_context: str,
    short_memory: str,
    deal_state: dict,
    energy: str,
    energy_def: str,
    intent_behavior: str,
    avoid_strategies: str,
    avoid_question: bool,
    call_context: dict | None = None,
) -> tuple[str, str]:
    """
    Build system + user prompts compressed to 700-1200 tokens.

    ML pre-computes strategy, emotional state, hesitation — LLM only writes.
    """
    strategy    = ml_result.get("strategy", "DIAGNOSTIC_QUESTION")
    confidence  = ml_result.get("confidence", 0.5)
    emotional   = ml_result.get("emotional_state", "neutral")
    hesitation  = ml_result.get("hesitation", False)
    context_str = f"\nCALL CONTEXT:\n{json.dumps(call_context)}" if call_context else ""

    question_rule = (
        'Set "next_question" to "" (empty). Do NOT include a question.'
        if avoid_question else
        'Question ONLY if prospect shows genuine curiosity or buying intent.'
    )

    system_prompt = f"""You are Hexagon — a socially intelligent sales AI.
Sound like: an experienced consultant | practical operator | calm founder | socially aware closer.
NOT like: therapist | motivational coach | philosophical chatbot | generic sales trainer.

RESPONSE FORMULA: practical observation + operational insight + subtle directional tension
NEVER: emotion reflection + interview question + philosophical framing

STYLE: Vary sentence rhythm. Mix short and medium responses.
Focus on operational specificity (staff resistance, customer flow, internal approval pressure).
Avoid abstractions. Keep it grounded and commercially sharp.

CURRENT ENERGY: {energy} — {energy_def}
INTENT BEHAVIOR: {intent_behavior}

ML DECISIONS (handled — do NOT re-classify):
- Strategy    : {strategy} (confidence: {confidence:.2f})
- Emotion     : {emotional}
- Hesitation  : {hesitation}

RAG HINTS (use as inspiration, not verbatim):
{rag_context}

DEAL STATE:
- Stage    : {deal_state.get('stage', 'discovery')}
- Pressure : {deal_state.get('pressure_level', 1)}
- Avoid    : [{avoid_strategies}]
{context_str}

OUTPUT JSON:
{{"intent":"...","stage":"...","strategy":"...","confidence":0.0,"response":"...","next_question":"...","coaching_tip":"..."}}"""

    user_prompt = f"""Recent context: {short_memory}

LATEST PROSPECT MESSAGE: "{message}"

RHYTHM (choose one naturally):
- observation only          → 35%
- observation + tension     → 30%
- observation + soft question → 25%
- direct challenge          → 10%

FOR THIS RESPONSE: {question_rule}

LENGTH: 1-2 sentences max. Output strictly conforming JSON."""

    return system_prompt, user_prompt


# ─── Main orchestration entry point ──────────────────────────────────────────
async def orchestrate(
    message: str,
    message_buffer: list[dict],
    deal_state: dict,
    call_context: dict | None = None,
    energy: str = "relaxed_guidance",
    energy_def: str = "conversational, socially smooth, naturally intelligent",
    intent_behavior: str = "Lead the conversation forward with insight or reframe.",
    avoid_strategies: str = "",
    avoid_question: bool = False,
) -> dict:
    """
    Full ML orchestration pipeline.

    Returns a dict with keys compatible with the existing SalesAIEngine output schema:
      strategy, emotional_state, hesitation, rag_context,
      system_prompt, user_prompt, ml_latency_ms
    """
    t0 = time.perf_counter()

    # ── Step 1: ML Prediction (strategy + emotional + hesitation) ────────────
    if is_model_ready():
        ml_result = predict_strategy(message)
    else:
        print("[ML_ROUTER] Models not trained yet — using keyword fallback")
        ml_result = {
            "strategy": "DIAGNOSTIC_QUESTION",
            "confidence": 0.5,
            "latency_ms": 0.0,
        }

    ml_result["emotional_state"] = _classify_emotional_state(message)
    ml_result["hesitation"] = _detect_hesitation(message, ml_result["strategy"])

    # ── Step 2: RAG Retrieval (max 2 chunks) ─────────────────────────────────
    rag = _get_rag()
    rag_results = rag.retrieve(message)[:2]          # enforce max_chunks: 2
    rag_context = "\n".join([
        f"- Insight: {r.get('insight', '')} | Avoid: {r.get('avoid', '')}"
        for r in rag_results
    ]) or "No RAG context available."

    # ── Step 3: Short memory ─────────────────────────────────────────────────
    short_memory = _build_short_memory(message_buffer)

    # ── Step 4: Build compressed prompt ──────────────────────────────────────
    system_prompt, user_prompt = build_compressed_prompt(
        message=message,
        ml_result=ml_result,
        rag_context=rag_context,
        short_memory=short_memory,
        deal_state=deal_state,
        energy=energy,
        energy_def=energy_def,
        intent_behavior=intent_behavior,
        avoid_strategies=avoid_strategies,
        avoid_question=avoid_question,
        call_context=call_context,
    )

    total_ms = (time.perf_counter() - t0) * 1000
    print(
        f"[ML_ROUTER] strategy={ml_result['strategy']} | "
        f"emotion={ml_result['emotional_state']} | "
        f"hesitation={ml_result['hesitation']} | "
        f"router_latency={total_ms:.1f}ms"
    )

    return {
        "strategy":       ml_result["strategy"],
        "confidence":     ml_result["confidence"],
        "emotional_state": ml_result["emotional_state"],
        "hesitation":     ml_result["hesitation"],
        "rag_context":    rag_context,
        "system_prompt":  system_prompt,
        "user_prompt":    user_prompt,
        "ml_latency_ms":  ml_result.get("latency_ms", 0.0),
        "router_latency_ms": round(total_ms, 2),
    }
