# ml/training/train_strategy_model.py
# ─── Strategy Model Training Pipeline ────────────────────────────────────────
# Trains an XGBoost classifier (with LogisticRegression fallback) on the
# strategy_training.jsonl dataset, then exports:
#   - models/strategy_model.pkl
#   - models/vectorizer.pkl
#
# Run: python -m ml.training.train_strategy_model
# Latency target: training offline (no latency constraint)

import os
import sys
import json

# Ensure project root is on path
_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import joblib
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import classification_report

from ml.config.labels import STRATEGY_LABELS, LABEL_TO_INDEX
from ml.vectorizers.vectorizer import fit_transform, save_vectorizer
from ml.utils.preprocess import batch_preprocess

# ─── Paths ────────────────────────────────────────────────────────────────────
DATASET_PATH  = os.path.join(_ROOT, "dataset", "strategy_training.jsonl")
MODEL_PATH    = os.path.join(_ROOT, "models", "strategy_model.pkl")
VECTORIZER_PATH = os.path.join(_ROOT, "models", "vectorizer.pkl")


def load_dataset(path: str) -> tuple[list[str], list[str]]:
    """Load JSONL dataset. Returns (messages, labels)."""
    messages, labels = [], []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            messages.append(obj["message"])
            labels.append(obj["strategy"])
    print(f"[TRAIN] Loaded {len(messages)} examples from {path}")
    return messages, labels


def train(use_xgboost: bool = True):
    """Full training pipeline."""
    os.makedirs(os.path.join(_ROOT, "models"), exist_ok=True)

    # ── 1. Load data ──────────────────────────────────────────────────────────
    messages, labels = load_dataset(DATASET_PATH)

    # Validate all labels are known
    unknown = set(labels) - set(STRATEGY_LABELS)
    if unknown:
        raise ValueError(f"[TRAIN] Unknown labels in dataset: {unknown}")

    # ── 2. Vectorize ──────────────────────────────────────────────────────────
    vec, X = fit_transform(messages)
    y = [LABEL_TO_INDEX[lbl] for lbl in labels]

    # ── 3. Train / test split ─────────────────────────────────────────────────
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # ── 4. Model selection ────────────────────────────────────────────────────
    if use_xgboost:
        try:
            from xgboost import XGBClassifier
            model = XGBClassifier(
                n_estimators=400,
                max_depth=6,
                learning_rate=0.05,
                subsample=0.8,
                colsample_bytree=0.8,
                min_child_weight=2,
                gamma=0.1,
                eval_metric="mlogloss",
                random_state=42,
                n_jobs=-1,
            )
            print("[TRAIN] Using primary model: XGBoost")
        except ImportError:
            print("[TRAIN] XGBoost not installed — falling back to LogisticRegression")
            use_xgboost = False

    if not use_xgboost:
        model = LogisticRegression(
            max_iter=1000,
            C=1.0,
            solver="lbfgs",
            multi_class="multinomial",
            random_state=42,
        )
        print("[TRAIN] Using fallback model: LogisticRegression")

    # ── 5. Cross-validation ───────────────────────────────────────────────────
    cv_scores = cross_val_score(model, X_train, y_train, cv=5, scoring="accuracy")
    print(f"[TRAIN] CV Accuracy: {cv_scores.mean():.3f} ± {cv_scores.std():.3f}")

    # ── 6. Fit on full training set ───────────────────────────────────────────
    model.fit(X_train, y_train)

    # ── 7. Evaluate on held-out test set ─────────────────────────────────────
    y_pred = model.predict(X_test)
    print("\n[TRAIN] Classification Report:")
    print(classification_report(
        y_test, y_pred,
        target_names=STRATEGY_LABELS,
        zero_division=0
    ))

    # -- 8. Export models ------------------------------------------------------
    joblib.dump(model, MODEL_PATH)
    print(f"[TRAIN] Model saved -> {MODEL_PATH}")

    save_vectorizer(vec, VECTORIZER_PATH)

    print("\n[TRAIN] Training complete. Models ready for inference.")
    return model, vec


if __name__ == "__main__":
    train(use_xgboost=True)
