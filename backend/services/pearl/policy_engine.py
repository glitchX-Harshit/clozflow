"""
Pearl Policy Engine
Enforces autonomy controls configured by the user.
Prevents the agent from performing actions beyond its allowed scope.
"""
from typing import Optional


# ── Default Autonomy Policy ──────────────────────────────────────────────────
DEFAULT_AUTONOMY = {
    "research":         True,
    "initiate_outreach": True,
    "initiate_calls":   True,
    "handle_objections": True,
    "qualify":          True,
    "book_meeting":     True,
    "update_crm":       True,
    "relay_to_human":   True,
    "closing":          False,  # Off by default — humans close
}

# ── Default Qualification Rules ──────────────────────────────────────────────
DEFAULT_QUALIFICATION = {
    "decision_maker_confirmed": True,
    "problem_confirmed":        True,
    "product_fit_confirmed":    True,
    "buying_intent":            True,
    "timeline":                 False,
    "budget":                   False,
    "meeting_booked":           True,
}

# ── Actions That Require Policy Check ────────────────────────────────────────
POLICY_ACTIONS = {
    "research_prospect",
    "initiate_outreach",
    "initiate_call",
    "handle_objection",
    "qualify_prospect",
    "book_meeting",
    "update_crm",
    "relay_to_human",
    "attempt_close",
    "send_message",
    "end_call",
}

# ── Action → Policy Key Mapping ─────────────────────────────────────────────
ACTION_TO_POLICY = {
    "research_prospect":  "research",
    "initiate_outreach":  "initiate_outreach",
    "initiate_call":      "initiate_calls",
    "handle_objection":   "handle_objections",
    "qualify_prospect":   "qualify",
    "book_meeting":       "book_meeting",
    "update_crm":         "update_crm",
    "relay_to_human":     "relay_to_human",
    "attempt_close":      "closing",
    "send_message":       "initiate_outreach",
    "end_call":           "initiate_calls",
}


class PolicyViolation(Exception):
    """Raised when an agent attempts an action not allowed by its policy."""
    def __init__(self, action: str, reason: str = ""):
        self.action = action
        msg = f"Policy violation: action '{action}' is not permitted"
        if reason:
            msg += f" — {reason}"
        super().__init__(msg)


class PolicyEngine:
    """
    Enforces the autonomy policy configured on a PearlAgent.
    The orchestrator calls check_action() before every tool execution.
    """

    def __init__(self, autonomy_policy: Optional[dict] = None,
                 qualification_rules: Optional[dict] = None):
        self._policy = {**DEFAULT_AUTONOMY, **(autonomy_policy or {})}
        self._qualification = {**DEFAULT_QUALIFICATION, **(qualification_rules or {})}

    @property
    def policy(self) -> dict:
        return dict(self._policy)

    @property
    def qualification_rules(self) -> dict:
        return dict(self._qualification)

    def is_action_allowed(self, action: str) -> bool:
        """Check if an action is allowed by the current policy."""
        policy_key = ACTION_TO_POLICY.get(action)
        if policy_key is None:
            # Actions not in the mapping are allowed by default
            return True
        return self._policy.get(policy_key, False)

    def check_action(self, action: str) -> None:
        """
        Enforce policy. Raises PolicyViolation if action is not allowed.
        Call this BEFORE executing any tool.
        """
        if not self.is_action_allowed(action):
            policy_key = ACTION_TO_POLICY.get(action, action)
            raise PolicyViolation(action, f"Policy '{policy_key}' is disabled")

    def get_allowed_actions(self) -> list:
        """Return list of currently allowed actions."""
        return sorted([
            action for action in ACTION_TO_POLICY
            if self.is_action_allowed(action)
        ])

    def get_blocked_actions(self) -> list:
        """Return list of currently blocked actions."""
        return sorted([
            action for action in ACTION_TO_POLICY
            if not self.is_action_allowed(action)
        ])

    def should_escalate(self, signals: dict) -> bool:
        """
        Determine if the current conversation signals require escalation to a human.
        Returns True if the agent should trigger a Relay handoff.
        """
        # Escalate if prospect explicitly requests human
        if signals.get("human_requested"):
            return True

        # Escalate if closing is attempted but policy forbids it
        if signals.get("high_intent") and not self._policy.get("closing"):
            return True

        # Escalate if agent encounters unsupported request
        if signals.get("unsupported_request"):
            return True

        # Escalate if agent cannot safely continue
        if signals.get("safety_concern"):
            return True

        return False

    def check_qualification(self, evidence: dict) -> dict:
        """
        Evaluate qualification evidence against configured rules.
        Returns { criteria: { required, met, value }, overall_score, qualified }
        """
        results = {}
        met_count = 0
        required_count = 0

        for criteria, required in self._qualification.items():
            value = evidence.get(criteria)
            met = bool(value)
            results[criteria] = {
                "required": required,
                "met": met,
                "value": value,
            }
            if required:
                required_count += 1
                if met:
                    met_count += 1

        score = (met_count / required_count * 100) if required_count > 0 else 0

        return {
            "criteria": results,
            "overall_score": round(score),
            "qualified": met_count == required_count,
            "met": met_count,
            "required": required_count,
        }
