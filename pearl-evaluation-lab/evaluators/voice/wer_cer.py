"""
Word Error Rate (WER) and Character Error Rate (CER) Metrics.
Computes speech recognition accuracy using Levenshtein distance with Hinglish text normalization.
"""
import re
from typing import Dict, Any


def normalize_speech_text(text: str) -> str:
    """Normalizes transcribed text for fair acoustic comparison."""
    text = text.lower()
    text = re.sub(r"[^\w\s]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def compute_levenshtein(seq1: list, seq2: list) -> int:
    """Computes minimum edit distance between two sequences."""
    d = [[0] * (len(seq2) + 1) for _ in range(len(seq1) + 1)]
    for i in range(len(seq1) + 1):
        d[i][0] = i
    for j in range(len(seq2) + 1):
        d[0][j] = j

    for i in range(1, len(seq1) + 1):
        for j in range(1, len(seq2) + 1):
            if seq1[i - 1] == seq2[j - 1]:
                cost = 0
            else:
                cost = 1
            d[i][j] = min(
                d[i - 1][j] + 1,       # deletion
                d[i][j - 1] + 1,       # insertion
                d[i - 1][j - 1] + cost  # substitution
            )
    return d[len(seq1)][len(seq2)]


def compute_wer(reference: str, hypothesis: str) -> float:
    """Computes Word Error Rate (WER)."""
    ref_words = normalize_speech_text(reference).split()
    hyp_words = normalize_speech_text(hypothesis).split()
    if not ref_words:
        return 0.0 if not hyp_words else 1.0
    dist = compute_levenshtein(ref_words, hyp_words)
    return min(1.0, dist / len(ref_words))


def compute_cer(reference: str, hypothesis: str) -> float:
    """Computes Character Error Rate (CER)."""
    ref_chars = list(normalize_speech_text(reference))
    hyp_chars = list(normalize_speech_text(hypothesis))
    if not ref_chars:
        return 0.0 if not hyp_chars else 1.0
    dist = compute_levenshtein(ref_chars, hyp_chars)
    return min(1.0, dist / len(ref_chars))


def evaluate_transcription(reference: str, hypothesis: str) -> Dict[str, Any]:
    """Generates detailed transcription accuracy metrics."""
    wer = compute_wer(reference, hypothesis)
    cer = compute_cer(reference, hypothesis)
    return {
        "wer": round(wer, 4),
        "cer": round(cer, 4),
        "accuracy_pct": round(max(0.0, (1.0 - wer) * 100.0), 2),
        "ref_length_words": len(reference.split()),
        "hyp_length_words": len(hypothesis.split())
    }
