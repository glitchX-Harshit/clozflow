# ml/inference/predict_strategy.py
# ─── Live Inference Engine ────────────────────────────────────────────────────
# Loads trained models from disk once (singleton pattern) and predicts
# conversational strategy from a prospect message.
#
# Runtime flow (as per ML_inteligence.yaml):
#   preprocess_message -> vectorize_message -> predict_strategy -> return_prediction
#
# Latency target: <50ms per call (TF-IDF + XGBoost = ~5-15ms typical)

import os
import sys
import time

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import joblib
import numpy as np

from ml.config.labels import INDEX_TO_LABEL, STRATEGY_LABELS
from ml.utils.preprocess import preprocess
from ml.vectorizers.vectorizer import VECTORIZER_PATH

# ─── Paths ────────────────────────────────────────────────────────────────────
MODEL_PATH = os.path.join(_ROOT, "models", "strategy_model.pkl")


# ─── Singleton loader ─────────────────────────────────────────────────────────
_model = None
_vectorizer = None


def _load_models():
    """Load model + vectorizer once, cache in module-level globals."""
    global _model, _vectorizer

    if _model is None:
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(
                f"[INFERENCE] Model not found at {MODEL_PATH}. "
                "Run: python -m ml.training.train_strategy_model"
            )
        _model = joblib.load(MODEL_PATH)
        print(f"[INFERENCE] Model loaded <- {MODEL_PATH}")

    if _vectorizer is None:
        if not os.path.exists(VECTORIZER_PATH):
            raise FileNotFoundError(
                f"[INFERENCE] Vectorizer not found at {VECTORIZER_PATH}. "
                "Run: python -m ml.training.train_strategy_model"
            )
        _vectorizer = joblib.load(VECTORIZER_PATH)
        print(f"[INFERENCE] Vectorizer loaded <- {VECTORIZER_PATH}")


def predict_strategy(message: str) -> dict:
    """
    Predict the sales strategy for a single prospect message.

    Returns:
        {
            "strategy":    str,   # e.g. "ROI_REFRAME"
            "confidence":  float, # 0.0 – 1.0
            "latency_ms":  float, # measured inference time
            "all_scores":  dict,  # {strategy: score, ...} for debugging
        }
    """
    t0 = time.perf_counter()

    # ── Step 1: Load models (cached after first call) ─────────────────────────
    _load_models()

    # ── Step 2: Preprocess ────────────────────────────────────────────────────
    clean = preprocess(message)
    if not clean:
        return _fallback_prediction("DIAGNOSTIC_QUESTION", "Empty message after preprocessing")

    # ── Step 3: Vectorize ─────────────────────────────────────────────────────
    X = _vectorizer.transform([clean])

    # ── Step 4: Predict ───────────────────────────────────────────────────────
    pred_idx = int(_model.predict(X)[0])
    strategy = INDEX_TO_LABEL.get(pred_idx, "DIAGNOSTIC_QUESTION")

    # Confidence from predict_proba (if supported)
    all_scores = {}
    confidence = 1.0
    if hasattr(_model, "predict_proba"):
        proba = _model.predict_proba(X)[0]
        confidence = float(np.max(proba))
        all_scores = {
            INDEX_TO_LABEL[i]: round(float(p), 4)
            for i, p in enumerate(proba)
        }

    latency_ms = (time.perf_counter() - t0) * 1000

    print(
        f"[INFERENCE] '{message[:60]}' -> {strategy} "
        f"({confidence:.2f}) | {latency_ms:.1f}ms"
    )

    return {
        "strategy":   strategy,
        "confidence": round(confidence, 4),
        "latency_ms": round(latency_ms, 2),
        "all_scores": all_scores,
    }


def predict_batch(messages: list[str]) -> list[dict]:
    """
    Batch predict for multiple messages. More efficient than individual calls.
    """
    _load_models()
    results = []
    for msg in messages:
        results.append(predict_strategy(msg))
    return results


def is_model_ready() -> bool:
    """
    Returns True if trained models exist on disk and can be loaded.
    Use this to gate ML routing in the backend.
    """
    return os.path.exists(MODEL_PATH) and os.path.exists(VECTORIZER_PATH)


def _fallback_prediction(strategy: str, reason: str) -> dict:
    return {
        "strategy":   strategy,
        "confidence": 0.5,
        "latency_ms": 0.0,
        "all_scores": {},
        "fallback_reason": reason,
    }


# ─── CLI quick test ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    test_messages = [
        "this feels expensive",
        "maybe revisit later",
        "we already have tools",
        "need partner approval",
        "sounds like AI hype",
    ]
    print("\n=== INFERENCE SMOKE TEST ===")
    for msg in test_messages:
        result = predict_strategy(msg)
        print(f"  [{result['strategy']:20s}] ({result['confidence']:.2f}) <- \"{msg}\"")
