"""
Outbound campaign dialing policy: carrier, calling window + time zone, retries and pacing.

Pure functions over a campaign's stored ``call_settings`` - no DB access and no clock of their
own (callers pass ``now``, a naive UTC datetime like everything else in the database). Shared by
the dispatch worker, the carrier-event handler and the campaign API so they all agree.

``call_settings`` keys (clients write different spellings; all are accepted):

* ``call_provider``: ``vobiz`` (default) | ``exotel``.
* calling window: ``window_start`` / ``window_end`` (``"HH:MM"``, local time of ``timezone``) or the
  legacy ``calling_hours: "09:00 - 18:00"``. A window may cross midnight (``22:00``-``06:00``);
  equal start and end means "no restriction"; no window keys at all = no restriction.
* ``timezone``: IANA name, default ``Asia/Kolkata``. Labels such as ``"Asia/Kolkata (IST)"``
  (the backend's own default) and ``IST`` are understood.
* attempts per recipient (first call included): ``max_retries`` (app spelling - its picker
  offers "1 Attempt (No retries)" / "2 Attempts" / "3 Attempts") or ``max_attempts`` (backend
  default). Default 1 = no retries.
* minutes between two attempts: ``retry_interval_minutes`` (app) or ``retry_interval``.
* ``pacing_seconds``: pause between two dispatches, 0-5 s, default 2.
* ``concurrency_limit``: parallel calls for the campaign (the server cap is applied by the worker).

When the app's and the generic spelling are both present the app's wins: the app keeps every
key it doesn't know when it saves, so a stale ``max_attempts`` / ``retry_interval`` from the
backend default would otherwise override what the user just picked. The web UI drops both
retry spellings when it saves (it offers no retries), so its campaigns dial each recipient once.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, time as dtime, timedelta, timezone as dt_timezone, tzinfo
from typing import Any, Mapping, Optional, Sequence, Tuple

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:  # pragma: no cover - Python < 3.9
    ZoneInfo = None  # type: ignore[assignment]
    ZoneInfoNotFoundError = Exception  # type: ignore[assignment,misc]

SUPPORTED_CALL_PROVIDERS = ("vobiz", "exotel")
DEFAULT_CALL_PROVIDER = "vobiz"
DEFAULT_TIMEZONE = "Asia/Kolkata"

DEFAULT_MAX_ATTEMPTS = 1
MAX_ATTEMPTS_LIMIT = 10
DEFAULT_RETRY_INTERVAL_MINUTES = 30.0
MAX_RETRY_INTERVAL_MINUTES = 24 * 60.0
DEFAULT_PACING_SECONDS = 2.0
MAX_PACING_SECONDS = 5.0

# Final call outcomes after which a recipient may be dialled again. A user-cancelled call is
# never retried and a completed one never needs to be.
RETRYABLE_OUTCOMES = frozenset({"failed", "busy", "no_answer"})

# First present key wins (see the module docstring for why the app spelling comes first).
MAX_ATTEMPTS_KEYS = ("max_retries", "max_attempts")
RETRY_INTERVAL_KEYS = ("retry_interval_minutes", "retry_interval")
PACING_KEYS = ("pacing_seconds",)

# What a campaign created without call_settings stores (and what the API shows for an empty one).
DEFAULT_CALL_SETTINGS = {
    "calling_hours": "09:00 - 18:00",
    "timezone": "Asia/Kolkata (IST)",
    "max_attempts": 2,
    "retry_interval": 30,
    "concurrency_limit": 1,
}

_ZONE_ALIASES = {"IST": DEFAULT_TIMEZONE}
# Used only when the interpreter has no time zone database (no system zoneinfo, no tzdata
# package): zones without daylight saving time can still be served exactly.
_FIXED_OFFSET_MINUTES = {"Asia/Kolkata": 330, "Asia/Calcutta": 330, "Asia/Dubai": 240, "UTC": 0, "Etc/UTC": 0}

_TIME_RE = re.compile(r"^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$")
_HOURS_RE = re.compile(r"^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:-|–|—|to)\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*$", re.I)


class CallSettingsError(ValueError):
    """A campaign's call_settings can't be dialled as stored (message is user-facing)."""


def as_utc(now: datetime) -> datetime:
    """Aware UTC datetime for a naive-UTC or aware input."""
    if now.tzinfo is None:
        return now.replace(tzinfo=dt_timezone.utc)
    return now.astimezone(dt_timezone.utc)


def naive_utc(value: datetime) -> datetime:
    return as_utc(value).replace(tzinfo=None)


def utc_iso(value: Optional[datetime]) -> Optional[str]:
    """ISO-8601 UTC with a ``Z`` suffix (clients read bare ISO strings as local time)."""
    if value is None:
        return None
    return naive_utc(value).isoformat() + "Z"


# ── parsing helpers ───────────────────────────────────────────────────────────

def _parse_time(raw: Any) -> Optional[dtime]:
    if raw is None or isinstance(raw, bool):
        return None
    m = _TIME_RE.match(str(raw))
    if not m:
        return None
    hour, minute, second = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    if hour == 24 and minute == 0 and second == 0:
        return dtime(0, 0)  # "24:00" = end of the day
    if hour > 23 or minute > 59 or second > 59:
        return None
    return dtime(hour, minute, second)


def _fmt_time(t: dtime) -> str:
    return f"{t.hour:02d}:{t.minute:02d}" + (f":{t.second:02d}" if t.second else "")


def resolve_timezone(raw: Any, *, strict: bool = False) -> Tuple[str, tzinfo]:
    """``(name, tzinfo)`` for a stored timezone value; unknown names -> Asia/Kolkata unless strict."""
    text = str(raw).strip() if raw not in (None, "") and not isinstance(raw, bool) else ""
    # "Asia/Kolkata (IST)" -> "Asia/Kolkata"
    name = re.split(r"\s*\(", text, maxsplit=1)[0].strip() if text else ""
    name = _ZONE_ALIASES.get(name.upper(), name) if name else DEFAULT_TIMEZONE
    tz = _load_zone(name)
    if tz is None:
        if strict:
            raise CallSettingsError(f"Unknown timezone '{text}'. Use an IANA time zone such as 'Asia/Kolkata'.")
        name, tz = DEFAULT_TIMEZONE, _load_zone(DEFAULT_TIMEZONE)
    return name, tz


def _load_zone(name: str) -> Optional[tzinfo]:
    if ZoneInfo is not None:
        try:
            return ZoneInfo(name)
        except (ZoneInfoNotFoundError, ValueError, OSError):
            pass
    minutes = _FIXED_OFFSET_MINUTES.get(name)
    if minutes is not None:
        return dt_timezone(timedelta(minutes=minutes), name)
    return None


def _number(settings: Mapping[str, Any], keys: Sequence[str], strict: bool, message: str) -> Tuple[Optional[float], Optional[str]]:
    """First present (non-empty) key's numeric value, or (None, None)."""
    for key in keys:
        if key not in settings:
            continue
        raw = settings.get(key)
        if raw is None or (isinstance(raw, str) and not raw.strip()):
            continue
        if isinstance(raw, bool):
            value = None
        else:
            try:
                value = float(raw)
            except (TypeError, ValueError):
                value = None
        if value is None or value != value or value in (float("inf"), float("-inf")):
            if strict:
                raise CallSettingsError(message.format(key=key))
            return None, key
        return value, key
    return None, None


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


# ── calling window ────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class CallingWindow:
    """Local-time calling window in ``timezone``; ``start == end`` means always open."""
    start: dtime
    end: dtime
    timezone: str
    tz: tzinfo

    @property
    def always_open(self) -> bool:
        return self.start == self.end

    def _local(self, now: datetime) -> datetime:
        return as_utc(now).astimezone(self.tz)

    def is_open(self, now: datetime) -> bool:
        if self.always_open:
            return True
        t = self._local(now).time()
        if self.start < self.end:
            return self.start <= t < self.end
        return t >= self.start or t < self.end  # crosses midnight

    def next_open(self, now: datetime) -> datetime:
        """Naive UTC instant from which calls are allowed again (``now`` while the window is open)."""
        if self.is_open(now):
            return naive_utc(now)
        local_now = self._local(now)
        for days in range(0, 3):
            day = (local_now + timedelta(days=days)).date()
            opening = datetime.combine(day, self.start, tzinfo=self.tz)
            if opening > local_now:
                return naive_utc(opening)
        return naive_utc(now) + timedelta(days=1)  # pragma: no cover - unreachable

    def label(self) -> str:
        return f"{_fmt_time(self.start)}–{_fmt_time(self.end)} {self.timezone}"

    def to_dict(self, now: Optional[datetime] = None) -> dict:
        out = {"start": _fmt_time(self.start), "end": _fmt_time(self.end), "timezone": self.timezone}
        if now is not None:
            open_now = self.is_open(now)
            out["open"] = open_now
            out["next_open_at"] = None if open_now else utc_iso(self.next_open(now))
        return out


def parse_calling_window(settings: Mapping[str, Any], tz_name: str, tz: tzinfo, *, strict: bool = False) -> Optional[CallingWindow]:
    """The campaign's window, or None for "no restriction" (also for unusable values unless strict)."""
    start_raw, end_raw = settings.get("window_start"), settings.get("window_end")
    start_raw = None if start_raw in (None, "") else start_raw
    end_raw = None if end_raw in (None, "") else end_raw
    hours = settings.get("calling_hours")
    if (start_raw is None or end_raw is None) and hours not in (None, ""):
        m = _HOURS_RE.match(str(hours))
        if m:
            start_raw = start_raw if start_raw is not None else m.group(1)
            end_raw = end_raw if end_raw is not None else m.group(2)
        elif strict and start_raw is None and end_raw is None:
            raise CallSettingsError(f"Invalid calling_hours '{hours}'. Use 'HH:MM - HH:MM', e.g. '09:00 - 18:00'.")
    if start_raw is None and end_raw is None:
        return None
    if start_raw is None or end_raw is None:
        if strict:
            raise CallSettingsError("Invalid calling window: set both window_start and window_end (HH:MM).")
        return None
    start, end = _parse_time(start_raw), _parse_time(end_raw)
    for key, raw, parsed in (("window_start", start_raw, start), ("window_end", end_raw, end)):
        if parsed is None:
            if strict:
                raise CallSettingsError(f"Invalid calling window: {key} '{raw}' is not a HH:MM time.")
            return None
    return CallingWindow(start=start, end=end, timezone=tz_name, tz=tz)


# ── the policy ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class CampaignPolicy:
    call_provider: str
    timezone: str
    window: Optional[CallingWindow]
    max_attempts: int
    retry_interval_minutes: float
    pacing_seconds: float
    concurrency_limit: int

    @property
    def retries_enabled(self) -> bool:
        return self.max_attempts > 1

    def window_open(self, now: datetime) -> bool:
        return self.window is None or self.window.is_open(now)

    def next_window_open(self, now: datetime) -> datetime:
        return naive_utc(now) if self.window is None else self.window.next_open(now)

    def retry_due_at(self, attempts: int, outcome: Optional[str], now: datetime) -> Optional[datetime]:
        """When a recipient whose ``attempts``-th call ended with ``outcome`` should be dialled
        again (naive UTC), or None if it must not be retried."""
        if (outcome or "") not in RETRYABLE_OUTCOMES:
            return None
        if int(attempts or 0) >= self.max_attempts:
            return None
        return naive_utc(now) + timedelta(minutes=self.retry_interval_minutes)

    def to_dict(self, now: Optional[datetime] = None) -> dict:
        """What the dialer will actually do with these settings (for API responses)."""
        out = {
            "call_provider": self.call_provider,
            "timezone": self.timezone,
            "calling_window": self.window.to_dict(now) if self.window is not None else None,
            "max_attempts": self.max_attempts,
            "retry_interval_minutes": self.retry_interval_minutes,
            "pacing_seconds": self.pacing_seconds,
            "concurrency_limit": self.concurrency_limit,
        }
        return out


def campaign_policy(settings: Optional[Mapping[str, Any]], *, strict: bool = False) -> CampaignPolicy:
    """
    Parse a campaign's ``call_settings``. ``strict=True`` (launch / resume) raises
    :class:`CallSettingsError` for values that can't be dialled; otherwise (the running worker)
    unusable values fall back to the defaults: Vobiz, Asia/Kolkata, no window, one attempt.
    Empty / missing settings mean :data:`DEFAULT_CALL_SETTINGS` (what the API shows for them).
    """
    s: Mapping[str, Any] = settings if isinstance(settings, Mapping) and settings else DEFAULT_CALL_SETTINGS

    raw_provider = s.get("call_provider")
    provider = str(raw_provider).strip().lower() if raw_provider not in (None, "") and not isinstance(raw_provider, bool) else ""
    provider = provider or DEFAULT_CALL_PROVIDER
    if provider not in SUPPORTED_CALL_PROVIDERS:
        if strict:
            raise CallSettingsError(
                f"Unsupported call_provider '{raw_provider}' in call_settings. "
                f"Use one of: {', '.join(SUPPORTED_CALL_PROVIDERS)}."
            )
        provider = DEFAULT_CALL_PROVIDER

    tz_name, tz = resolve_timezone(s.get("timezone"), strict=strict)
    window = parse_calling_window(s, tz_name, tz, strict=strict)

    attempts, _ = _number(s, MAX_ATTEMPTS_KEYS, strict, "{key} must be a whole number of attempts (1-10).")
    max_attempts = DEFAULT_MAX_ATTEMPTS if attempts is None else int(_clamp(round(attempts), 1, MAX_ATTEMPTS_LIMIT))

    interval, _ = _number(s, RETRY_INTERVAL_KEYS, strict, "{key} must be a number of minutes (0-1440).")
    retry_interval = DEFAULT_RETRY_INTERVAL_MINUTES if interval is None else _clamp(interval, 0.0, MAX_RETRY_INTERVAL_MINUTES)

    pacing, _ = _number(s, PACING_KEYS, strict, "{key} must be a number of seconds (0-5).")
    pacing_seconds = DEFAULT_PACING_SECONDS if pacing is None else _clamp(pacing, 0.0, MAX_PACING_SECONDS)

    concurrency, _ = _number(s, ("concurrency_limit",), strict, "{key} must be a whole number of parallel calls.")
    concurrency_limit = 1 if concurrency is None else max(1, int(concurrency))

    return CampaignPolicy(
        call_provider=provider,
        timezone=tz_name,
        window=window,
        max_attempts=max_attempts,
        retry_interval_minutes=float(retry_interval),
        pacing_seconds=float(pacing_seconds),
        concurrency_limit=concurrency_limit,
    )
