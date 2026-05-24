# ml/evaluation/evaluate_model.py
# ─── Model Evaluation Suite ───────────────────────────────────────────────────
# Evaluates the trained strategy classifier against the full dataset
# and generates a detailed performance report.
#
# Run: python -m ml.evaluation.evaluate_model

import os
import sys
import json

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import joblib
import numpy as np
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    accuracy_score,
    f1_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score

from ml.config.labels import STRATEGY_LABELS, LABEL_TO_INDEX, INDEX_TO_LABEL
from ml.vectorizers.vectorizer import VECTORIZER_PATH
from ml.utils.preprocess import batch_preprocess

# ─── Paths ────────────────────────────────────────────────────────────────────
MODEL_PATH    = os.path.join(_ROOT, "models", "strategy_model.pkl")
DATASET_PATH  = os.path.join(_ROOT, "dataset", "strategy_training.jsonl")


def load_dataset():
    messages, labels = [], []
    with open(DATASET_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            messages.append(obj["message"])
            labels.append(obj["strategy"])
    return messages, labels


def evaluate():
    """Run full evaluation: accuracy, F1, confusion matrix, per-class report."""
    print("=" * 60)
    print("  HEXAGON ML — STRATEGY MODEL EVALUATION")
    print("=" * 60)

    # ── Load models ───────────────────────────────────────────────────────────
    if not os.path.exists(MODEL_PATH):
        print(f"[EVAL] ERROR: No model at {MODEL_PATH}. Train first.")
        return
    if not os.path.exists(VECTORIZER_PATH):
        print(f"[EVAL] ERROR: No vectorizer at {VECTORIZER_PATH}. Train first.")
        return

    model = joblib.load(MODEL_PATH)
    vectorizer = joblib.load(VECTORIZER_PATH)

    # ── Load data ─────────────────────────────────────────────────────────────
    messages, labels = load_dataset()
    print(f"\n[EVAL] Dataset: {len(messages)} examples")

    X = vectorizer.transform(messages)
    y = [LABEL_TO_INDEX[lbl] for lbl in labels]
    y_pred = model.predict(X)

    # ── Overall accuracy ──────────────────────────────────────────────────────
    acc = accuracy_score(y, y_pred)
    f1_macro = f1_score(y, y_pred, average="macro", zero_division=0)
    f1_weighted = f1_score(y, y_pred, average="weighted", zero_division=0)

    print(f"\n[EVAL] Overall Accuracy  : {acc:.4f} ({acc*100:.1f}%)")
    print(f"[EVAL] F1 Macro          : {f1_macro:.4f}")
    print(f"[EVAL] F1 Weighted       : {f1_weighted:.4f}")

    # ── Per-class report ──────────────────────────────────────────────────────
    print("\n[EVAL] Per-Class Classification Report:")
    print(classification_report(
        y, y_pred,
        target_names=STRATEGY_LABELS,
        zero_division=0,
        digits=3
    ))

    # ── Confusion matrix ──────────────────────────────────────────────────────
    cm = confusion_matrix(y, y_pred)
    print("[EVAL] Confusion Matrix (rows=actual, cols=predicted):")
    header = "         " + "  ".join(f"{s[:8]:>8}" for s in STRATEGY_LABELS)
    print(header)
    for i, row in enumerate(cm):
        row_str = f"{STRATEGY_LABELS[i][:8]:>8} " + "  ".join(f"{v:>8}" for v in row)
        print(row_str)

    # ── Cross-validation (5-fold) ─────────────────────────────────────────────
    print("\n[EVAL] 5-Fold Cross Validation:")
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_scores = cross_val_score(model, X, y, cv=skf, scoring="accuracy")
    print(f"  Fold scores : {[round(s, 3) for s in cv_scores]}")
    print(f"  Mean        : {cv_scores.mean():.4f}")
    print(f"  Std         : {cv_scores.std():.4f}")

    # ── Latency benchmark ─────────────────────────────────────────────────────
    import time
    sample = vectorizer.transform([messages[0]])
    times = []
    for _ in range(100):
        t0 = time.perf_counter()
        model.predict(sample)
        times.append((time.perf_counter() - t0) * 1000)
    print(f"\n[EVAL] Inference Latency (100 runs):")
    print(f"  Mean : {np.mean(times):.2f}ms")
    print(f"  P99  : {np.percentile(times, 99):.2f}ms")
    print(f"  Max  : {np.max(times):.2f}ms")
    print(f"\n  [PASS] Latency target (<50ms) : {'PASS' if np.percentile(times, 99) < 50 else 'FAIL'}")

    print("\n" + "=" * 60)
    print("  EVALUATION COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    evaluate()
