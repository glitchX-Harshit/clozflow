"""
Failure Injection Manager for Pearl Evaluation Harness.
Rotates the 7 failure injection modes deterministically across calls.
"""
from typing import Dict, Any, Optional, List

FAILURE_TYPES: List[str] = [
    "TOOL_TIMEOUT",
    "TOOL_ERROR",
    "SLOT_TAKEN",
    "BOT_INQUIRY",
    "OPT_OUT",
    "VOICEMAIL",
    "WRONG_EMAIL",
]

class FailureInjector:
    def __init__(self, failure_type: Optional[str] = None):
        self.failure_type = failure_type

    @classmethod
    def get_injection_for_call(cls, call_index: int) -> str:
        """Deterministically rotate failure injection based on call index (0..59)."""
        return FAILURE_TYPES[call_index % len(FAILURE_TYPES)]

    def is_tool_timeout(self) -> bool:
        return self.failure_type == "TOOL_TIMEOUT"

    def is_tool_error(self) -> bool:
        return self.failure_type == "TOOL_ERROR"

    def is_slot_taken(self) -> bool:
        return self.failure_type == "SLOT_TAKEN"

    def is_bot_inquiry(self) -> bool:
        return self.failure_type == "BOT_INQUIRY"

    def is_opt_out(self) -> bool:
        return self.failure_type == "OPT_OUT"

    def is_voicemail(self) -> bool:
        return self.failure_type == "VOICEMAIL"

    def is_wrong_email(self) -> bool:
        return self.failure_type == "WRONG_EMAIL"
