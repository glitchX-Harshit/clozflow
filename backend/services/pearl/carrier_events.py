"""
Normalization of carrier (Vobiz / Exotel) call events into Pearl's call status vocabulary.

Call statuses (API contract, unchanged):
    queued, initiating, ringing, active, completed, failed, busy, no_answer, cancelled

Only *final* carrier events (hangup / terminal status) may move a call - and its campaign
recipient - into a terminal state. Progress events (initiated, ringing, answered) only
move a call forward through queued -> initiating -> ringing -> active.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Optional, Tuple

CALL_STATUSES = (
    "queued", "initiating", "ringing", "active",
    "completed", "failed", "busy", "no_answer", "cancelled",
)
TERMINAL_CALL_STATUSES = frozenset({"completed", "failed", "busy", "no_answer", "cancelled"})
# Statuses that still occupy a line. Includes legacy values written by older builds.
IN_FLIGHT_CALL_STATUSES = ("queued", "initiating", "ringing", "active", "dialing", "in-progress")
# Statuses that have not reached the carrier's "answered" stage yet.
PRE_ANSWER_CALL_STATUSES = ("queued", "initiating", "dialing")

_PROGRESS_ORDER = {"queued": 0, "dialing": 1, "initiating": 1, "ringing": 2, "in-progress": 3, "active": 3}


@dataclass
class CarrierEvent:
    final: bool
    status: Optional[str]              # vocabulary status (terminal if final, progress otherwise, None = ignore)
    duration_seconds: Optional[int] = None
    answered: bool = False
    detail: str = ""                   # raw carrier status / hangup cause, for error_code/error_reason
    provider_ids: Tuple[str, ...] = field(default_factory=tuple)


def _norm_keys(params: Mapping[str, Any]) -> dict:
    out = {}
    for k, v in (params or {}).items():
        if v is None:
            continue
        key = str(k).strip().lower().replace("_", "").replace("-", "")
        out.setdefault(key, str(v).strip())
    return out


def _first_int(p: dict, *keys: str) -> Optional[int]:
    for k in keys:
        raw = p.get(k)
        if raw in (None, ""):
            continue
        try:
            return max(0, int(float(raw)))
        except (TypeError, ValueError):
            continue
    return None


def advances(current: Optional[str], new: str) -> bool:
    """True if a progress status ``new`` moves ``current`` forward (never backwards, never out of terminal)."""
    cur = (current or "queued").lower()
    if cur in TERMINAL_CALL_STATUSES:
        return False
    return _PROGRESS_ORDER.get(new, -1) > _PROGRESS_ORDER.get(cur, -1)


# ── Vobiz ─────────────────────────────────────────────────────────────────────
# Vobiz callbacks are Plivo-style form posts: Event (Hangup / Ring / StartApp ...),
# CallStatus (often "completed" on every hangup), HangupCause, Duration / BillDuration,
# AnswerTime, CallUUID, RequestUUID.

_VOBIZ_FINAL_STATUSES = {
    "completed", "busy", "failed", "timeout", "noanswer", "cancel", "canceled",
    "cancelled", "rejected", "hangup", "ended",
}
_BUSY_CAUSES = {"USER_BUSY", "BUSY", "CALL_REJECTED_BUSY"}
_NO_ANSWER_CAUSES = {
    "NO_ANSWER", "NO_USER_RESPONSE", "ALLOTTED_TIMEOUT", "RECOVERY_ON_TIMER_EXPIRE",
    "PROGRESS_TIMEOUT", "RING_TIMEOUT", "SUBSCRIBER_ABSENT", "TIMEOUT",
}
_CANCEL_CAUSES = {"ORIGINATOR_CANCEL", "CANCEL", "CANCELED", "CANCELLED"}
_NORMAL_CAUSES = {"NORMAL_CLEARING", "END_OF_XML_INSTRUCTIONS", "NORMAL_UNSPECIFIED", "HANGUP", "NORMAL_HANGUP"}
# Vobiz also sends a human HangupCauseName ("Busy Line", "Ring Timeout Reached") and a
# numeric HangupCauseCode (https://www.vobiz.ai/docs/concepts/hangup-causes).
_BUSY_CAUSES |= {"BUSY_LINE", "BUSY_EVERYWHERE", "USER_BUSY"}
_NO_ANSWER_CAUSES |= {"RING_TIMEOUT_REACHED"}
_BUSY_CODES = {3010, 3100}
_NO_ANSWER_CODES = {3000, 6010}
_CANCEL_CODES = {1000}
_NORMAL_CODES = {4000, 4010, 4020, 4030, 6000}


def _cause_token(value: str) -> str:
    """"Ring Timeout Reached" / "ring-timeout" → "RING_TIMEOUT_REACHED" / "RING_TIMEOUT"."""
    return "_".join(str(value or "").replace("-", " ").replace("_", " ").upper().split())


def _code_to_cause(code: Optional[int]) -> str:
    if code in _BUSY_CODES:
        return "USER_BUSY"
    if code in _NO_ANSWER_CODES:
        return "NO_ANSWER"
    if code in _CANCEL_CODES:
        return "ORIGINATOR_CANCEL"
    if code in _NORMAL_CODES:
        return "NORMAL_CLEARING"
    return f"CODE_{code}" if code else ""


def parse_vobiz_event(params: Mapping[str, Any]) -> CarrierEvent:
    p = _norm_keys(params)
    event = p.get("event", "").lower()
    raw_status = (p.get("callstatus") or p.get("status") or "").lower().replace("_", "").replace("-", "")
    code_raw = p.get("hangupcausecode", "")
    code = int(code_raw) if code_raw.isdigit() and int(code_raw) > 0 else None
    cause = _cause_token(p.get("hangupcause") or p.get("hangupcausename") or "")
    if code is not None and cause not in (_BUSY_CAUSES | _NO_ANSWER_CAUSES | _CANCEL_CAUSES | _NORMAL_CAUSES):
        # The numeric code is the documented, unambiguous field; prefer it over a
        # cause text we don't recognise.
        cause = _code_to_cause(code) or cause
    duration = _first_int(p, "duration", "billduration", "callduration")
    answered = bool(p.get("answertime")) or (duration or 0) > 0 or raw_status in ("inprogress", "answered")
    ids = tuple(v for v in (p.get("calluuid"), p.get("requestuuid"), p.get("aleguuid")) if v)
    detail = cause or raw_status or event

    final = event in ("hangup", "callhangup") or raw_status in _VOBIZ_FINAL_STATUSES or bool(cause)
    if not final:
        if event in ("startapp", "answer", "answered") or raw_status in ("inprogress", "answered"):
            status = "active"
        elif event in ("ring", "ringing") or raw_status == "ringing":
            status = "ringing"
        elif event in ("callinitiated", "initiated", "queued") or raw_status in ("initiated", "queued"):
            status = "initiating"
        else:
            status = None
        return CarrierEvent(False, status, duration, answered, detail, ids)

    if raw_status == "busy" or cause in _BUSY_CAUSES:
        status = "busy"
    elif raw_status in ("noanswer", "timeout") or cause in _NO_ANSWER_CAUSES:
        status = "no_answer"
    elif raw_status in ("cancel", "canceled", "cancelled") or cause in _CANCEL_CAUSES:
        status = "completed" if answered else "cancelled"
    elif raw_status in ("failed", "rejected"):
        status = "completed" if answered else "failed"
    elif answered or cause in _NORMAL_CAUSES:
        status = "completed"
    elif cause:
        status = "failed"
    elif "answertime" in p:  # carrier says explicitly it was never answered
        status = "no_answer"
    else:
        status = "completed"
    return CarrierEvent(True, status, duration, answered or status == "completed", detail, ids)


# ── Exotel ────────────────────────────────────────────────────────────────────
# Exotel status callbacks: Status (queued, ringing, in-progress, completed, failed,
# busy, no-answer, canceled), CallSid, Duration / ConversationDuration, CustomField.

_EXOTEL_FINAL = {
    "completed": "completed",
    "failed": "failed",
    "busy": "busy",
    "noanswer": "no_answer",
    "canceled": "cancelled",
    "cancelled": "cancelled",
}


def parse_exotel_event(params: Mapping[str, Any]) -> CarrierEvent:
    p = _norm_keys(params)
    raw_status = (p.get("status") or p.get("callstatus") or "").lower().replace("_", "").replace("-", "")
    duration = _first_int(p, "conversationduration", "duration", "dialcallduration")
    ids = tuple(v for v in (p.get("callsid"), p.get("sid")) if v)
    if raw_status in _EXOTEL_FINAL:
        status = _EXOTEL_FINAL[raw_status]
        return CarrierEvent(True, status, duration, status == "completed", raw_status, ids)
    if raw_status == "inprogress":
        return CarrierEvent(False, "active", duration, True, raw_status, ids)
    if raw_status == "ringing":
        return CarrierEvent(False, "ringing", duration, False, raw_status, ids)
    if raw_status == "queued":
        return CarrierEvent(False, "initiating", duration, False, raw_status, ids)
    return CarrierEvent(False, None, duration, False, raw_status, ids)
