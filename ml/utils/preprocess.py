# ml/utils/preprocess.py
# ─── Text Preprocessing Utilities ────────────────────────────────────────────
# Lightweight, dependency-free text normalization.
# Runs at <5ms per message — fits inside the 50ms latency budget.

import re
import string


# ─── Stop-word set (minimal — preserves sales-critical terms) ─────────────────
_STOP_WORDS = {
    "i", "me", "my", "we", "our", "you", "your", "it", "its",
    "is", "am", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did",
    "a", "an", "the", "and", "but", "or", "so",
    "in", "on", "at", "to", "for", "of", "with", "by", "from",
    "that", "this", "these", "those", "there", "here",
    "not", "no", "nor", "just", "about",
}

# Sales-domain preservations — never strip these
_PRESERVE_TERMS = {
    "expensive", "cost", "budget", "price", "later", "wait",
    "already", "better", "best", "approve", "approval", "partner",
    "hype", "prove", "trust", "risk", "roi", "value", "maybe",
    "hesitate", "convinced", "skeptic", "tools", "solution",
}


def normalize(text: str) -> str:
    """
    Lowercase, strip punctuation, collapse whitespace.
    Preserves sales-critical vocabulary.
    Returns clean string ready for TF-IDF vectorization.
    """
    if not text or not isinstance(text, str):
        return ""

    text = text.lower().strip()
    # Remove special chars except spaces
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    # Collapse multiple spaces
    text = re.sub(r"\s+", " ", text).strip()
    return text


def remove_stopwords(text: str) -> str:
    """
    Remove common stop words while preserving sales-domain terms.
    """
    tokens = text.split()
    filtered = [
        t for t in tokens
        if t not in _STOP_WORDS or t in _PRESERVE_TERMS
    ]
    return " ".join(filtered)


def preprocess(text: str) -> str:
    """
    Full pipeline: normalize -> remove stop words.
    Entry point used by vectorizer and inference.
    """
    return remove_stopwords(normalize(text))


def batch_preprocess(texts: list[str]) -> list[str]:
    """
    Process a list of messages. Used during training.
    """
    return [preprocess(t) for t in texts]
