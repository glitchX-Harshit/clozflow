# ml/config/labels.py
# ─── Strategy Label Registry ─────────────────────────────────────────────────
# Single source of truth for all ML strategy class labels.
# Used by training, inference, and evaluation modules.

STRATEGY_LABELS = [
    "ROI_REFRAME",        # pricing / cost objections
    "RISK_REVERSAL",      # delay / postpone objections
    "STATUS_GAP",         # ego / "we already have tools" objections
    "DECISION_CONTROL",   # authority / "need approval" objections
    "DIAGNOSTIC_QUESTION" # skepticism / "sounds like hype" objections
]

# Map category -> canonical strategy (mirrors dataset_generation spec)
CATEGORY_TO_STRATEGY = {
    "pricing":    "ROI_REFRAME",
    "delay":      "RISK_REVERSAL",
    "ego":        "STATUS_GAP",
    "authority":  "DECISION_CONTROL",
    "skepticism": "DIAGNOSTIC_QUESTION",
}

# Reverse map for label decoding
STRATEGY_TO_CATEGORY = {v: k for k, v in CATEGORY_TO_STRATEGY.items()}

# Integer index ↔ label (used by scikit-learn pipelines)
LABEL_TO_INDEX = {label: idx for idx, label in enumerate(STRATEGY_LABELS)}
INDEX_TO_LABEL = {idx: label for label, idx in LABEL_TO_INDEX.items()}

NUM_CLASSES = len(STRATEGY_LABELS)
