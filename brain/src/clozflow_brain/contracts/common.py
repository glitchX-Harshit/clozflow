"""Shared contract primitives."""

from __future__ import annotations

from datetime import datetime, timezone


def utc_now() -> datetime:
    """Return a timezone-aware UTC timestamp."""

    return datetime.now(timezone.utc)


def ensure_aware_utc(value: datetime) -> datetime:
    """Normalize a datetime to aware UTC for CCBS timestamp fields."""

    if value.tzinfo is None:
        raise ValueError("timestamp must be timezone-aware")
    return value.astimezone(timezone.utc)

