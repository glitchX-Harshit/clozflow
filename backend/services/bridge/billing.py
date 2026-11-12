"""Bridge-call charging on top of ``services/credit_service.py``.

``ceil(connected_seconds / 60) × rate``, charged once at hangup. Superusers
(unlimited accounts) are not charged. The per-call limit (Dial ``timeLimit``) is
derived from the wallet at call creation, so a charge normally fits; if the
balance was spent elsewhere meanwhile, whatever is left is charged instead of
failing (never negative, never twice: the caller claims ``billed_at`` first).
"""
from __future__ import annotations

import math

from sqlalchemy.orm import Session

from services import credit_service


def amount_for(seconds: int, rate_per_minute: float) -> float:
    if seconds <= 0 or rate_per_minute <= 0:
        return 0.0
    return round(math.ceil(seconds / 60.0) * rate_per_minute, 2)


def affordable_seconds(db: Session, user_id: int, rate_per_minute: float, cap_seconds: int) -> tuple[int, bool]:
    """(max connected seconds the wallet pays for, whether the wallet is the limit)."""
    if rate_per_minute <= 0 or credit_service.is_user_superuser(db, user_id):
        return cap_seconds, False
    minutes = int(math.floor(credit_service.get_balance(db, user_id) / rate_per_minute + 1e-9))
    seconds = minutes * 60
    if seconds >= cap_seconds:
        return cap_seconds, False
    return max(60, seconds), True


def charge_call(db: Session, *, user_id: int, seconds: int, rate_per_minute: float, call_ref: str) -> float:
    """Charges the call and returns the credits actually taken (0 for superusers).

    Uses the shared post-call path: one atomic ``min(balance, amount)`` charge
    that never raises for insufficient funds and records any shortfall on the
    transaction row (same behaviour as Pearl's post-call metering).
    """
    amount = amount_for(seconds, rate_per_minute)
    if amount <= 0 or credit_service.is_user_superuser(db, user_id):
        return 0.0
    minutes = math.ceil(seconds / 60.0)
    description = f"Copilot phone call, {minutes} min (ref {call_ref})"
    result = credit_service.charge_post_call(db, user_id, amount, description, category="consumption")
    return result["charged"]
