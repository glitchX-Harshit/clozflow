"""
Pearl State Machine
Deterministic agent state transitions with validation.
The agent progresses through states based on conditions — not LLM decisions.
"""
from typing import Optional


# ── Valid States ─────────────────────────────────────────────────────────────
STATES = {
    "idle", "discovering", "researching", "preparing", "contacting",
    "conversation", "qualifying", "booking", "relaying",
    "completed", "failed", "paused"
}

# ── Terminal States (no outgoing transitions) ────────────────────────────────
TERMINAL_STATES = {"completed", "failed"}

# ── Valid Transitions ────────────────────────────────────────────────────────
TRANSITIONS = {
    "idle":          {"discovering", "paused"},
    "discovering":   {"researching", "paused", "failed"},
    "researching":   {"preparing", "paused", "failed"},
    "preparing":     {"contacting", "paused", "failed"},
    "contacting":    {"conversation", "failed", "paused"},
    "conversation":  {"qualifying", "relaying", "paused", "failed"},
    "qualifying":    {"booking", "conversation", "relaying", "completed", "paused", "failed"},
    "booking":       {"completed", "relaying", "paused", "failed"},
    "relaying":      {"completed", "paused", "failed"},
    "paused":        {"idle", "discovering", "researching", "preparing", "contacting",
                      "conversation", "qualifying", "booking", "relaying"},
    # Terminal states have no outgoing transitions
    "completed":     set(),
    "failed":        set(),
}


class InvalidTransition(Exception):
    """Raised when an invalid state transition is attempted."""
    def __init__(self, from_state: str, to_state: str, reason: str = ""):
        self.from_state = from_state
        self.to_state = to_state
        msg = f"Invalid transition: {from_state} → {to_state}"
        if reason:
            msg += f" ({reason})"
        super().__init__(msg)


class AgentStateMachine:
    """
    Manages state transitions for a Pearl agent.
    Deterministic — the orchestrator decides WHEN to transition,
    this class enforces WHAT transitions are legal.
    """

    def __init__(self, current_state: str = "idle"):
        if current_state not in STATES:
            raise ValueError(f"Unknown state: {current_state}")
        self._state = current_state
        self._previous_state: Optional[str] = None

    @property
    def state(self) -> str:
        return self._state

    @property
    def previous_state(self) -> Optional[str]:
        return self._previous_state

    @property
    def is_terminal(self) -> bool:
        return self._state in TERMINAL_STATES

    @property
    def is_paused(self) -> bool:
        return self._state == "paused"

    @property
    def is_active(self) -> bool:
        return self._state not in TERMINAL_STATES and self._state != "paused" and self._state != "draft"

    def can_transition(self, to_state: str) -> bool:
        """Check if a transition is valid without performing it."""
        if to_state not in STATES:
            return False
        return to_state in TRANSITIONS.get(self._state, set())

    def transition(self, to_state: str, reason: str = "") -> str:
        """
        Perform a state transition. Returns the new state.
        Raises InvalidTransition if the transition is not allowed.
        """
        if to_state not in STATES:
            raise InvalidTransition(self._state, to_state, "Unknown target state")

        if self.is_terminal:
            raise InvalidTransition(self._state, to_state, "Agent is in terminal state")

        allowed = TRANSITIONS.get(self._state, set())
        if to_state not in allowed:
            raise InvalidTransition(self._state, to_state,
                f"Allowed from {self._state}: {sorted(allowed)}")

        self._previous_state = self._state
        self._state = to_state
        return self._state

    def pause(self) -> str:
        """Pause the agent from any non-terminal state."""
        if self.is_terminal:
            raise InvalidTransition(self._state, "paused", "Cannot pause terminal agent")
        if self.is_paused:
            return self._state  # Already paused, no-op
        return self.transition("paused")

    def resume(self, resume_to: Optional[str] = None) -> str:
        """
        Resume a paused agent. Resumes to previous state or specified state.
        """
        if not self.is_paused:
            raise InvalidTransition(self._state, resume_to or "unknown", "Agent is not paused")

        target = resume_to or self._previous_state or "idle"
        return self.transition(target)

    def fail(self, reason: str = "") -> str:
        """Move agent to failed state from any non-terminal state."""
        if self.is_terminal:
            return self._state
        return self.transition("failed", reason)

    def complete(self) -> str:
        """Move agent to completed state."""
        return self.transition("completed")

    def get_available_transitions(self) -> list:
        """Return list of valid next states."""
        return sorted(TRANSITIONS.get(self._state, set()))
