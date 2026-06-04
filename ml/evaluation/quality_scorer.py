# ml/evaluation/quality_scorer.py
# ─── V3 Quality Scorer ──────────────────────────────────────────────────────
# Evaluates responses using the V3 scoring model:
#   diagnosis (0.35), curiosity (0.25), human_sound (0.20),
#   persuasion (0.10), brevity (0.10)

# V3 Forbidden language — responses containing these are heavily penalized
_V3_FORBIDDEN = [
    "operationally", "implementation efficiency", "optimize workflow",
    "strategic alignment", "value proposition", "key metrics",
    "business optimization", "customer engagement",
    "usually when", "most teams", "most businesses",
    "the reality is", "in practice,",
]

# V3 Human phrases — responses containing these get bonuses
_V3_HUMAN_PHRASES = [
    "fair question", "that's interesting", "let me ask you something",
    "out of curiosity", "maybe i'm looking at this wrong",
    "help me understand",
]

# V3 Diagnostic indicators — responses that diagnose get bonuses
_V3_DIAGNOSTIC_MARKERS = [
    "?",  # questions are diagnostic
    "what are you measuring", "what would have to change",
    "what made you", "is there anything", "is the concern",
    "what's the one thing", "if you could change",
]


def score_quality(response: str, strategy: str, emotional_state: str) -> dict:
    """
    V3 Quality Scorer.
    Returns: {"score": float, "details": dict}
    Weights: diagnosis=0.35, curiosity=0.25, human_sound=0.20, persuasion=0.10, brevity=0.10
    """
    response_lower = response.lower()
    words = response.split()
    word_count = len(words)

    # ── Diagnosis Score (weight: 0.35) ────────────────────────────────────
    diagnosis = 0.5  # baseline
    diagnostic_hits = sum(1 for m in _V3_DIAGNOSTIC_MARKERS if m in response_lower)
    if diagnostic_hits > 0:
        diagnosis = min(1.0, 0.5 + diagnostic_hits * 0.15)
    # Penalize if response sounds like a sales pitch instead of diagnosis
    pitch_markers = ["our solution", "we offer", "we can help", "our platform", "our product"]
    if any(p in response_lower for p in pitch_markers):
        diagnosis = max(0.0, diagnosis - 0.3)

    # ── Curiosity Score (weight: 0.25) ────────────────────────────────────
    curiosity = 0.5
    # Questions create curiosity
    question_count = response.count("?")
    if question_count == 1:
        curiosity = 0.8
    elif question_count >= 2:
        curiosity = 0.7  # too many questions feels interrogative
    # Tension words boost curiosity
    tension_words = ["but", "however", "though", "interesting", "curious", "strange", "surprising"]
    tension_hits = sum(1 for t in tension_words if t in response_lower)
    curiosity = min(1.0, curiosity + tension_hits * 0.05)

    # ── Human Sound Score (weight: 0.20) ──────────────────────────────────
    human_sound = 0.7  # baseline
    # Bonus for human phrases
    human_hits = sum(1 for hp in _V3_HUMAN_PHRASES if hp in response_lower)
    if human_hits > 0:
        human_sound = min(1.0, 0.7 + human_hits * 0.15)
    # Penalty for forbidden language
    forbidden_hits = sum(1 for fl in _V3_FORBIDDEN if fl in response_lower)
    if forbidden_hits > 0:
        human_sound = max(0.0, human_sound - forbidden_hits * 0.2)
    # Penalty for robotic starts
    if response.startswith("I understand") or response.startswith("It sounds like") or response.startswith("Here is"):
        human_sound = max(0.0, human_sound - 0.25)
    # Penalty for philosophical abstractions
    abstract_words = ["journey", "synergy", "landscape", "paradigm", "realm", "empower", "unlock your potential"]
    if any(a in response_lower for a in abstract_words):
        human_sound = max(0.0, human_sound - 0.2)

    # ── Persuasion Score (weight: 0.10) ────────────────────────────────────
    persuasion = 0.6
    # Perspective-shifting language
    persuasion_markers = ["if", "would", "what if", "imagine", "consider"]
    p_hits = sum(1 for p in persuasion_markers if p in response_lower)
    persuasion = min(1.0, 0.5 + p_hits * 0.1)

    # ── Brevity Score (weight: 0.10) ──────────────────────────────────────
    if word_count <= 15:
        brevity = 1.0
    elif word_count <= 25:
        brevity = 0.85
    elif word_count <= 40:
        brevity = 0.6
    else:
        brevity = 0.3

    # ── Weighted Final Score ──────────────────────────────────────────────
    score = (
        diagnosis * 0.35 +
        curiosity * 0.25 +
        human_sound * 0.20 +
        persuasion * 0.10 +
        brevity * 0.10
    )

    # Clip to [0.0, 1.0]
    score = max(0.0, min(1.0, score))

    details = {
        "diagnosis": round(diagnosis, 3),
        "curiosity": round(curiosity, 3),
        "human_sound": round(human_sound, 3),
        "persuasion": round(persuasion, 3),
        "brevity": round(brevity, 3),
    }

    return {
        "score": round(score, 3),
        "details": details,
    }
