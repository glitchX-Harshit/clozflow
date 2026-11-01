"""
Prospect Persona Engine.
Maintains stateful persona dynamics, buying intent evolution, patience depletion,
and termination triggers during live or simulated customer conversations.
"""
from typing import Dict, Any, Optional, Tuple
from pydantic import BaseModel, Field


class PersonaState(BaseModel):
    name: str
    role: str
    buying_intent: float = Field(0.5, ge=0.0, le=1.0)
    price_sensitivity: float = Field(0.5, ge=0.0, le=1.0)
    patience: float = Field(0.5, ge=0.0, le=1.0)
    preferred_language: str = "Hinglish"
    turns_completed: int = 0
    objections_raised: list[str] = Field(default_factory=list)
    satisfaction_score: float = Field(0.5, ge=0.0, le=1.0)
    meeting_agreed: bool = False
    hung_up: bool = False
    termination_reason: Optional[str] = None


class PersonaEngine:
    """
    Manages and mutates persona psychology dynamically based on Pearl's responses.
    """

    def __init__(self, persona_dict: Dict[str, Any]):
        self.state = PersonaState(
            name=persona_dict.get("name", "Prospect"),
            role=persona_dict.get("role", "Customer"),
            buying_intent=float(persona_dict.get("buying_intent", 0.5)),
            price_sensitivity=float(persona_dict.get("price_sensitivity", 0.5)),
            patience=float(persona_dict.get("patience", 0.5)),
            preferred_language=persona_dict.get("preferred_language", "Hinglish")
        )
        self.target_objection = persona_dict.get("target_objection")

    def update_state(self, pearl_reply: str) -> None:
        """
        Dynamically adjusts intent and patience based on signals in Pearl's speech.
        """
        self.state.turns_completed += 1
        lower = pearl_reply.lower()

        # Positive triggers: Clear value, empathy, natural phrasing, question
        positive_signals = ["samajh", "bilkul", "help", "demo", "flexible", "roi", "save", "minute", "schedule"]
        pos_count = sum(1 for s in positive_signals if s in lower)

        # Negative triggers: robotic repetition, defensiveness, aggressive pitch
        negative_signals = ["buy now", "must pay", "cannot explain", "as an ai", "error", "repeat"]
        neg_count = sum(1 for s in negative_signals if s in lower)

        # Update buying intent
        delta_intent = (pos_count * 0.08) - (neg_count * 0.15)
        self.state.buying_intent = max(0.0, min(1.0, self.state.buying_intent + delta_intent))

        # Patience depletion per turn (natural conversation wear)
        patience_drop = 0.08 if pos_count > 0 else 0.16
        if neg_count > 0:
            patience_drop += 0.20
        self.state.patience = max(0.0, min(1.0, self.state.patience - patience_drop))

        # Check if meeting was offered and agreed
        if any(w in lower for w in ["demo", "schedule", "kal", "tomorrow", "slot", "meeting"]) and self.state.buying_intent >= 0.65:
            self.state.meeting_agreed = True

        # Check if hangup condition reached
        if self.state.patience <= 0.05 and not self.state.meeting_agreed:
            self.state.hung_up = True
            self.state.termination_reason = "patience_exhausted"
        elif self.state.meeting_agreed:
            self.state.termination_reason = "meeting_scheduled"

    def should_terminate(self, max_turns: int = 6) -> Tuple[bool, str]:
        """Checks whether the conversation has reached a natural endpoint."""
        if self.state.hung_up:
            return True, "Prospect lost patience and hung up"
        if self.state.meeting_agreed:
            return True, "Prospect agreed to next steps and meeting"
        if self.state.turns_completed >= max_turns:
            return True, f"Max turns ({max_turns}) reached"
        return False, "in_progress"
