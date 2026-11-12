"""Hook registry between the live pipeline and the REST/debrief side.

The live pipeline (``websocket_service`` / bridge) calls ``session_saved``
once a CallLog is written. The debrief generator registers itself with
``register_session_saved`` when the wizard router is imported, so neither
module imports the other.
"""
from __future__ import annotations

import logging
from typing import Awaitable, Callable, Optional, Union

logger = logging.getLogger(__name__)

SessionSavedHook = Callable[[Optional[str], int, int], Union[None, Awaitable[None]]]

_session_saved_hooks: list[SessionSavedHook] = []


def register_session_saved(fn: SessionSavedHook) -> None:
    """Register ``fn(meeting_id, call_log_id, user_id)``; async or sync."""
    if fn not in _session_saved_hooks:
        _session_saved_hooks.append(fn)


def clear_hooks() -> None:
    """For tests."""
    _session_saved_hooks.clear()


async def session_saved(meeting_id: Optional[str], call_log_id: int, user_id: int) -> None:
    """Notify every hook; a failing hook never breaks the caller."""
    for fn in list(_session_saved_hooks):
        try:
            result = fn(meeting_id, call_log_id, user_id)
            if result is not None and hasattr(result, "__await__"):
                await result
        except Exception:  # noqa: BLE001 - hooks are best effort
            logger.exception("wizard session_saved hook failed")
