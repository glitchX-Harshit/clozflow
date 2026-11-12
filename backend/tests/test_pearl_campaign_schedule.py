"""
Campaign dialing policy (services/pearl/campaign_schedule.py): calling window + time zone,
retry settings under both client spellings, pacing, carrier validation. Pure functions, fixed
clocks (naive UTC, like the database), no DB and no network.
"""
import pathlib
import sys
from datetime import datetime, timedelta

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from services.pearl import campaign_schedule as cs  # noqa: E402
from services.pearl.campaign_schedule import CallSettingsError, campaign_policy  # noqa: E402


def utc(*args):
    return datetime(*args)


IST_9_TO_6 = {"window_start": "09:00", "window_end": "18:00", "timezone": "Asia/Kolkata"}


# ── calling window ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("now,open_", [
    (utc(2026, 11, 12, 3, 29), False),   # 08:59 IST
    (utc(2026, 11, 12, 3, 30), True),    # 09:00 IST (start is inclusive)
    (utc(2026, 11, 12, 12, 29), True),   # 17:59 IST
    (utc(2026, 11, 12, 12, 30), False),  # 18:00 IST (end is exclusive)
    (utc(2026, 11, 12, 20, 0), False),   # 01:30 IST next day
])
def test_window_is_evaluated_in_the_campaign_time_zone(now, open_):
    assert campaign_policy(IST_9_TO_6).window_open(now) is open_


def test_window_follows_daylight_saving_time():
    policy = campaign_policy({"window_start": "09:00", "window_end": "17:00", "timezone": "America/New_York"})
    # July: EDT (UTC-4) -> 09:00 local is 13:00 UTC
    assert not policy.window_open(utc(2026, 7, 15, 12, 59))
    assert policy.window_open(utc(2026, 7, 15, 13, 0))
    # January: EST (UTC-5) -> 09:00 local is 14:00 UTC
    assert not policy.window_open(utc(2026, 1, 15, 13, 30))
    assert policy.window_open(utc(2026, 1, 15, 14, 0))


def test_window_crossing_midnight_and_always_open():
    night = campaign_policy({"window_start": "22:00", "window_end": "06:00", "timezone": "Asia/Kolkata"})
    assert night.window_open(utc(2026, 11, 12, 17, 30))      # 23:00 IST
    assert night.window_open(utc(2026, 11, 12, 23, 0))       # 04:30 IST
    assert not night.window_open(utc(2026, 11, 12, 6, 30))   # 12:00 IST
    same = campaign_policy({"window_start": "10:00", "window_end": "10:00"})
    assert same.window.always_open and same.window_open(utc(2026, 11, 12, 0, 0))
    assert campaign_policy({"concurrency_limit": 2}).window is None  # no window keys = no restriction


def test_next_open_is_the_next_local_start():
    policy = campaign_policy(IST_9_TO_6)
    # 20:00 IST -> tomorrow 09:00 IST (03:30 UTC)
    assert policy.next_window_open(utc(2026, 11, 12, 14, 30)) == utc(2026, 11, 13, 3, 30)
    # 07:00 IST -> today 09:00 IST
    assert policy.next_window_open(utc(2026, 11, 12, 1, 30)) == utc(2026, 11, 12, 3, 30)
    # open -> now
    assert policy.next_window_open(utc(2026, 11, 12, 5, 0)) == utc(2026, 11, 12, 5, 0)
    # overnight window closed at noon -> 22:00 the same day
    night = campaign_policy({"window_start": "22:00", "window_end": "06:00", "timezone": "Asia/Kolkata"})
    assert night.next_window_open(utc(2026, 11, 12, 6, 30)) == utc(2026, 11, 12, 16, 30)


def test_next_open_across_the_dst_change():
    # US DST ends on Sunday 2026-11-01. Saturday 22:00 EDT -> Sunday 09:00 EST = 14:00 UTC.
    policy = campaign_policy({"window_start": "09:00", "window_end": "17:00", "timezone": "America/New_York"})
    assert policy.next_window_open(utc(2026, 11, 1, 2, 0)) == utc(2026, 11, 1, 14, 0)


@pytest.mark.parametrize("settings,start,end", [
    ({"calling_hours": "09:00 - 18:00"}, "09:00", "18:00"),             # backend default spelling
    ({"calling_hours": "9:30–17:45"}, "09:30", "17:45"),            # en dash, 1-digit hour
    ({"calling_hours": "10:00 to 16:00"}, "10:00", "16:00"),
    ({"window_start": "08:00", "window_end": "24:00"}, "08:00", "00:00"),  # 24:00 = end of day
    ({"window_start": "11:00", "calling_hours": "09:00 - 18:00"}, "11:00", "18:00"),  # web fallback rule
])
def test_window_spellings(settings, start, end):
    window = campaign_policy(settings).window
    assert (window.to_dict()["start"], window.to_dict()["end"]) == (start, end)


def test_window_dict_reports_open_state():
    d = campaign_policy(IST_9_TO_6).window.to_dict(utc(2026, 11, 12, 14, 30))
    assert d == {"start": "09:00", "end": "18:00", "timezone": "Asia/Kolkata", "open": False,
                 "next_open_at": "2026-11-13T03:30:00Z"}


@pytest.mark.parametrize("settings,needle", [
    ({"window_start": "25:00", "window_end": "18:00"}, "window_start '25:00'"),
    ({"window_start": "09:00", "window_end": "6pm"}, "window_end '6pm'"),
    ({"window_start": "09:00"}, "set both window_start and window_end"),
    ({"calling_hours": "all day"}, "Invalid calling_hours"),
])
def test_malformed_windows_are_rejected_when_strict_and_ignored_otherwise(settings, needle):
    with pytest.raises(CallSettingsError) as exc:
        campaign_policy(settings, strict=True)
    assert needle in str(exc.value)
    assert campaign_policy(settings).window is None  # the running worker keeps dialling as before


# ── time zone ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,name", [
    (None, "Asia/Kolkata"), ("", "Asia/Kolkata"), ("Asia/Kolkata (IST)", "Asia/Kolkata"),
    ("IST", "Asia/Kolkata"), ("Asia/Dubai", "Asia/Dubai"), ("Europe/London (UK time)", "Europe/London"),
])
def test_timezone_labels(raw, name):
    assert campaign_policy({"timezone": raw, "window_start": "09:00", "window_end": "18:00"}).timezone == name


def test_unknown_timezone():
    settings = {"timezone": "Mars/Olympus", "window_start": "09:00", "window_end": "18:00"}
    with pytest.raises(CallSettingsError, match="Unknown timezone 'Mars/Olympus'"):
        campaign_policy(settings, strict=True)
    assert campaign_policy(settings).timezone == "Asia/Kolkata"


def test_fixed_offset_fallback_without_a_tz_database(monkeypatch):
    def no_db(name):
        raise cs.ZoneInfoNotFoundError(name)

    monkeypatch.setattr(cs, "ZoneInfo", no_db)
    policy = campaign_policy(IST_9_TO_6, strict=True)  # India has no DST: served exactly
    assert policy.window_open(utc(2026, 11, 12, 3, 30)) and not policy.window_open(utc(2026, 11, 12, 3, 29))
    with pytest.raises(CallSettingsError):
        campaign_policy({**IST_9_TO_6, "timezone": "America/New_York"}, strict=True)


# ── retries ───────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("settings,attempts,interval", [
    ({"concurrency_limit": 1}, 1, 30.0),                                   # web: no retry keys
    ({"max_attempts": 3, "retry_interval": 45}, 3, 45.0),                  # generic spelling
    ({"max_retries": 2, "retry_interval_minutes": 15}, 2, 15.0),           # app spelling
    # The app keeps unknown keys: its own (fresh) values beat a stale backend default.
    ({"max_attempts": 2, "retry_interval": 30, "max_retries": 3, "retry_interval_minutes": 60}, 3, 60.0),
    ({"max_retries": "2", "retry_interval": "20"}, 2, 20.0),               # numeric strings
    ({"max_attempts": 0}, 1, 30.0), ({"max_attempts": 99}, 10, 30.0),     # clamped
    ({"max_attempts": 2, "retry_interval": -5}, 2, 0.0),
    ({"max_attempts": 2, "retry_interval": 10**6}, 2, 1440.0),
    ({"max_attempts": None, "retry_interval": ""}, 1, 30.0),
])
def test_retry_settings_accept_both_spellings(settings, attempts, interval):
    policy = campaign_policy(settings)
    assert (policy.max_attempts, policy.retry_interval_minutes) == (attempts, interval)


@pytest.mark.parametrize("settings,key", [
    ({"max_attempts": "lots"}, "max_attempts"),
    ({"max_retries": True}, "max_retries"),
    ({"max_attempts": 2, "retry_interval_minutes": "soon"}, "retry_interval_minutes"),
    ({"pacing_seconds": "fast"}, "pacing_seconds"),
    ({"concurrency_limit": "many"}, "concurrency_limit"),
])
def test_non_numeric_values_are_rejected_when_strict(settings, key):
    with pytest.raises(CallSettingsError, match=key):
        campaign_policy(settings, strict=True)
    campaign_policy(settings)  # the worker falls back to the defaults instead


def test_retry_due_at():
    policy = campaign_policy({"max_retries": 3, "retry_interval_minutes": 30})
    now = utc(2026, 11, 12, 5, 0)
    for outcome in ("failed", "busy", "no_answer"):
        assert policy.retry_due_at(1, outcome, now) == now + timedelta(minutes=30)
    assert policy.retry_due_at(2, "busy", now) == now + timedelta(minutes=30)
    assert policy.retry_due_at(3, "busy", now) is None          # attempts used up
    assert policy.retry_due_at(1, "completed", now) is None
    assert policy.retry_due_at(1, "cancelled", now) is None     # the user stopped it
    assert campaign_policy({}).retry_due_at(1, "busy", now) is not None  # defaults: 2 attempts
    assert campaign_policy({"concurrency_limit": 1}).retry_due_at(1, "busy", now) is None


# ── pacing, provider, defaults ────────────────────────────────────────────────

def test_pacing_has_its_own_key():
    assert campaign_policy({"retry_interval": 30}).pacing_seconds == 2.0   # no longer read as pacing
    assert campaign_policy({"pacing_seconds": 0}).pacing_seconds == 0.0
    assert campaign_policy({"pacing_seconds": 9}).pacing_seconds == 5.0


@pytest.mark.parametrize("raw,provider", [(None, "vobiz"), ("", "vobiz"), ("Vobiz", "vobiz"), (" EXOTEL ", "exotel")])
def test_supported_providers(raw, provider):
    assert campaign_policy({"call_provider": raw}, strict=True).call_provider == provider


def test_unsupported_provider():
    with pytest.raises(CallSettingsError) as exc:
        campaign_policy({"call_provider": "twilio"}, strict=True)
    assert str(exc.value) == "Unsupported call_provider 'twilio' in call_settings. Use one of: vobiz, exotel."
    assert campaign_policy({"call_provider": "twilio"}).call_provider == "vobiz"  # legacy worker fallback


def test_empty_settings_mean_the_backend_default():
    for empty in (None, {}):
        policy = campaign_policy(empty, strict=True)
        assert policy.window.to_dict() == {"start": "09:00", "end": "18:00", "timezone": "Asia/Kolkata"}
        assert (policy.max_attempts, policy.retry_interval_minutes, policy.concurrency_limit) == (2, 30.0, 1)


def test_policy_dict():
    assert campaign_policy({"call_provider": "exotel", "max_retries": 2, "concurrency_limit": 3}).to_dict() == {
        "call_provider": "exotel", "timezone": "Asia/Kolkata", "calling_window": None, "max_attempts": 2,
        "retry_interval_minutes": 30.0, "pacing_seconds": 2.0, "concurrency_limit": 3,
    }
