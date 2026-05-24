# ml/vectorizers/vectorizer.py
# ─── TF-IDF Vectorizer Wrapper ────────────────────────────────────────────────
# Converts prospect messages into lightweight numeric vectors.
# Uses scikit-learn TfidfVectorizer — no embeddings, no neural nets.
# Latency target: <10ms per message (well within 50ms budget).

import os
import joblib
from sklearn.feature_extraction.text import TfidfVectorizer

from ml.utils.preprocess import preprocess

# ─── Paths ───────────────────────────────────────────────────────────────────
_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
VECTORIZER_PATH = os.path.join(_ROOT, "models", "vectorizer.pkl")


def build_vectorizer() -> TfidfVectorizer:
    """
    Build a fresh TF-IDF vectorizer with tuned params for short sales messages.
    """
    return TfidfVectorizer(
        ngram_range=(1, 2),        # unigrams + bigrams capture "already have", "sounds like"
        max_features=3000,         # keeps the vector small and fast
        sublinear_tf=True,         # log-scale TF to reduce dominance of frequent terms
        min_df=1,                  # include rare but important terms
        analyzer="word",
        preprocessor=preprocess,   # integrated preprocessing
        strip_accents="unicode",
    )


def fit_vectorizer(texts: list[str]) -> TfidfVectorizer:
    """
    Fit and return a new vectorizer on training corpus.
    """
    vec = build_vectorizer()
    vec.fit(texts)
    return vec


def save_vectorizer(vec: TfidfVectorizer, path: str = VECTORIZER_PATH) -> None:
    """
    Persist fitted vectorizer to disk using joblib.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    joblib.dump(vec, path)
    print(f"[VECTORIZER] Saved -> {path}")


def load_vectorizer(path: str = VECTORIZER_PATH) -> TfidfVectorizer:
    """
    Load a pre-fitted vectorizer from disk.
    Raises FileNotFoundError if model not trained yet.
    """
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"[VECTORIZER] No model at {path}. Run train_strategy_model.py first."
        )
    vec = joblib.load(path)
    print(f"[VECTORIZER] Loaded <- {path}")
    return vec


def transform(vec: TfidfVectorizer, texts: list[str]):
    """
    Transform raw text(s) into TF-IDF sparse matrix.
    """
    return vec.transform(texts)


def fit_transform(texts: list[str]):
    """
    Fit + transform in one step. Returns (vectorizer, matrix).
    Used during training.
    """
    vec = build_vectorizer()
    X = vec.fit_transform(texts)
    return vec, X
