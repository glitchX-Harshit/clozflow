"""
Campaign dialer: calling window enforcement (incl. the window closing while the concurrency
governor waits), retries per the stored interval / max attempts, campaign counters (stale-call
healer, dispatch failures, late carrier events), and the campaign API: /launch + /resume
validation, /status and /recipients additions.

Throwaway SQLite DB, no network: dispatch is an in-process fake, sleeps are shortened, and the
"clock" is moved by editing settings / due times (or a small offset on the router's utcnow).
"""
import asyncio
import os
import pathlib
import sys
import tempfile
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
if not os.environ.get("DATABASE_URL"):
    os.environ["DATABASE_URL"] = "sqlite:///" + (pathlib.Path(tempfile.mkdtemp()) / "pearl_tests.db").as_posix()

import database  # noqa: E402

if database.SQLALCHEMY_DATABASE_URL.replace("\\", "/").endswith("/hexagon.db"):
    raise RuntimeError("Refusing to run Pearl tests against the real hexagon.db; set DATABASE_URL to a temp file")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import models  # noqa: E402,F401
import models_pearl  # noqa: E402,F401
import admin.models  # noqa: E402,F401
from database import Base, engine, SessionLocal  # noqa: E402
from models import User  # noqa: E402
from models_pearl import PearlAgent, PearlCall, PearlCampaign, PearlCampaignRecipient  # noqa: E402
from routers import pearl  # noqa: E402
from routers.auth import create_access_token  # noqa: E402
from services.pearl.carrier_events import CarrierEvent  # noqa: E402

Base.metadata.create_all(bind=engine)

app = FastAPI()
app.include_router(pearl.router)
client = TestClient(app)

try:
    from zoneinfo import ZoneInfo
    IST = ZoneInfo("Asia/Kolkata")
except Exception:  # pragma: no cover - no tz database: India has no DST
    IST = timezone(timedelta(hours=5, minutes=30))


@pytest.fixture(autouse=True)
def _offline_env(monkeypatch):
    for key in ("VOBIZ_AUTH_ID", "VOBIZ_AUTH_SECRET", "EXOTEL_ACCOUNT_SID", "EXOTEL_API_KEY",
                "EXOTEL_API_TOKEN", "GROQ_API_KEY", "SARVAM_API_KEY", "GEMINI_API_KEY"):
        monkeypatch.delenv(key, raising=False)


@pytest.fixture(autouse=True)
def _no_calls_left_in_flight():
    """The test DB is shared by every module and the dialer's server-wide cap counts all
    in-flight calls: settle the ones a test leaves behind so later dialer tests aren't throttled."""
    started = datetime.utcnow() - timedelta(seconds=1)
    yield
    with SessionLocal() as s:
        s.query(PearlCall).filter(
            PearlCall.status.in_(pearl.IN_FLIGHT_CALL_STATUSES), PearlCall.created_at >= started,
        ).update({PearlCall.status: "completed", PearlCall.ended_at: datetime.utcnow()}, synchronize_session=False)
        s.commit()


@pytest.fixture
def fast_worker(monkeypatch):
    """Short waits + a fake carrier that records every dial. The server-wide cap is lifted so
    calls other test modules left in the shared DB can't throttle these workers."""
    monkeypatch.setenv("MAX_SERVER_CONCURRENCY", "1000")
    monkeypatch.setattr(pearl, "CAMPAIGN_WINDOW_POLL_SECONDS", 0.05)
    monkeypatch.setattr(pearl, "CAMPAIGN_IDLE_POLL_SECONDS", 0.05)
    monkeypatch.setattr(pearl, "CAMPAIGN_STATUS_POLL_SECONDS", 0.05)
    dialed = []
    plan = {"fail": set()}  # dial numbers (1-based) that the carrier refuses

    async def fake_dispatch(provider, to_number, call_id):
        dialed.append((to_number, call_id))
        await asyncio.sleep(0.005)
        if len(dialed) in plan["fail"]:
            return {"success": False, "error": "Vobiz HTTP 503: carrier busy"}
        return {"success": True, "provider_call_id": f"req-{call_id[:6]}"}

    monkeypatch.setattr(pearl, "_dispatch_outbound_call", fake_dispatch)
    return {"dialed": dialed, "plan": plan}


class _Clock:
    offset = timedelta(0)


class ShiftedDatetime(datetime):
    """The router's ``datetime`` with an adjustable offset on utcnow()."""

    @classmethod
    def utcnow(cls):
        return datetime.utcnow() + _Clock.offset


@pytest.fixture
def shifted_clock(monkeypatch):
    _Clock.offset = timedelta(0)
    monkeypatch.setattr(pearl, "datetime", ShiftedDatetime)
    yield _Clock
    _Clock.offset = timedelta(0)


def ist_window(start_min, end_min):
    """call_settings window relative to the real current IST time (minutes, may be fractional)."""
    now = datetime.now(timezone.utc).astimezone(IST)
    fmt = "%H:%M:%S"
    return {"window_start": (now + timedelta(minutes=start_min)).strftime(fmt),
            "window_end": (now + timedelta(minutes=end_min)).strftime(fmt), "timezone": "Asia/Kolkata"}


CLOSED = (120, 180)   # opens in 2 h
OPEN = (-60, 120)


def make_user(balance=100.0):
    with SessionLocal() as s:
        user = User(email=f"dialer-{uuid.uuid4().hex[:10]}@example.test", password_hash="x", credit_balance=balance)
        s.add(user)
        s.commit()
        return user.id, {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


def make_campaign(user_id, settings, recipients=2, status="running", with_agent=True):
    with SessionLocal() as s:
        agent_id = None
        if with_agent:
            agent = PearlAgent(user_id=user_id, name="Dialer agent", status="active")
            s.add(agent)
            s.flush()
            agent_id = agent.id
        camp = PearlCampaign(user_id=user_id, agent_id=agent_id, name="camp", status=status, call_settings=settings)
        s.add(camp)
        s.flush()
        for i in range(recipients):
            s.add(PearlCampaignRecipient(campaign_id=camp.id, phone_number=f"98765111{i}0",
                                         normalized_phone=f"+9198765111{i}0", status="valid"))
        s.commit()
        return camp.id


def campaign(camp_id):
    with SessionLocal() as s:
        return s.get(PearlCampaign, camp_id)


def recipients(camp_id):
    with SessionLocal() as s:
        return s.query(PearlCampaignRecipient).filter_by(campaign_id=camp_id).order_by(PearlCampaignRecipient.created_at).all()


def set_settings(camp_id, settings):
    with SessionLocal() as s:
        s.get(PearlCampaign, camp_id).call_settings = settings
        s.commit()


def finish_call(call_id, status, detail=""):
    """The carrier's final hangup event for a call."""
    with SessionLocal() as s:
        call = s.get(PearlCall, call_id)
        return pearl._apply_carrier_event(s, call, CarrierEvent(True, status, 0, status == "completed", detail), "vobiz")


async def until(predicate, timeout=6.0, what="condition"):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.02)
    raise AssertionError(f"timed out waiting for {what}")


def status_of(camp_id, user_id):
    with SessionLocal() as s:
        return pearl.get_campaign_status(camp_id, db=s, user=s.get(User, user_id))


# ── calling window ────────────────────────────────────────────────────────────

def test_no_calls_outside_the_window_and_dialling_resumes_when_it_opens(fast_worker):
    uid, _ = make_user()
    camp_id = make_campaign(uid, {**ist_window(*CLOSED), "concurrency_limit": 5, "pacing_seconds": 0})

    async def scenario():
        worker = asyncio.create_task(pearl._dispatch_campaign_worker(camp_id))
        await asyncio.sleep(0.4)
        assert fast_worker["dialed"] == []                      # window closed: nobody is called
        assert campaign(camp_id).status == "running"            # ...but the campaign keeps running
        st = status_of(camp_id, uid)
        assert st["dialing_state"] == "waiting_for_window" and st["dialer_active"] is True
        assert st["calling_window"]["open"] is False and st["calling_window"]["next_open_at"].endswith("Z")

        set_settings(camp_id, {**ist_window(*OPEN), "concurrency_limit": 5, "pacing_seconds": 0})  # window opens
        await asyncio.wait_for(worker, timeout=6)

    asyncio.run(scenario())
    assert len(fast_worker["dialed"]) == 2
    assert campaign(camp_id).status == "completed"  # one attempt each (no retry keys)


def test_window_closing_while_waiting_for_a_free_line_blocks_the_next_call(fast_worker, shifted_clock):
    uid, _ = make_user()
    # Open now, closes in one minute (real clock); one line, so recipient 2 waits for recipient 1.
    camp_id = make_campaign(uid, {**ist_window(-60, 1), "concurrency_limit": 1, "pacing_seconds": 0})

    async def scenario():
        worker = asyncio.create_task(pearl._dispatch_campaign_worker(camp_id))
        await until(lambda: len(fast_worker["dialed"]) == 1, what="first dial")
        first_call = fast_worker["dialed"][0][1]

        shifted_clock.offset = timedelta(seconds=90)  # the window end passes while the line is busy
        finish_call(first_call, "completed")           # ...and the line frees up
        await asyncio.sleep(1.6)                       # > one governor poll
        assert len(fast_worker["dialed"]) == 1         # no call after the window closed
        assert campaign(camp_id).status == "running"

        shifted_clock.offset = timedelta(0)            # back inside the window
        await asyncio.wait_for(worker, timeout=6)

    asyncio.run(scenario())
    assert len(fast_worker["dialed"]) == 2
    camp = campaign(camp_id)
    assert camp.status == "completed" and camp.completed_calls == 1


def test_pause_while_waiting_for_the_window_stops_the_worker(fast_worker):
    uid, _ = make_user()
    camp_id = make_campaign(uid, {**ist_window(*CLOSED), "pacing_seconds": 0})

    async def scenario():
        worker = asyncio.create_task(pearl._dispatch_campaign_worker(camp_id))
        await asyncio.sleep(0.2)
        with SessionLocal() as s:
            s.get(PearlCampaign, camp_id).status = "paused"
            s.commit()
        await asyncio.wait_for(worker, timeout=2)

    asyncio.run(scenario())
    assert fast_worker["dialed"] == [] and campaign(camp_id).status == "paused"
    assert camp_id not in pearl._running_campaign_workers


# ── retries ───────────────────────────────────────────────────────────────────

def test_unanswered_recipient_is_retried_after_the_interval_up_to_max_attempts(fast_worker):
    uid, _ = make_user()
    # App spelling: max_retries = attempts per lead ("2 Attempts"), retry_interval_minutes.
    camp_id = make_campaign(uid, {"max_retries": 2, "retry_interval_minutes": 30, "pacing_seconds": 0}, recipients=1)

    async def scenario():
        worker = asyncio.create_task(pearl._dispatch_campaign_worker(camp_id))
        await until(lambda: len(fast_worker["dialed"]) == 1, what="first attempt")
        await asyncio.sleep(0.2)
        assert campaign(camp_id).status == "running"   # waits for the in-flight call's outcome

        before = datetime.utcnow()
        assert finish_call(fast_worker["dialed"][0][1], "no_answer", "NO_ANSWER") == "final"
        (rec,) = recipients(camp_id)
        assert rec.status == "failed" and rec.outcome == "no_answer" and rec.attempts == 1
        assert timedelta(minutes=29) < rec.next_attempt_at - before < timedelta(minutes=31)

        await asyncio.sleep(0.3)
        assert len(fast_worker["dialed"]) == 1          # not before the interval has passed
        st = status_of(camp_id, uid)
        assert st["dialing_state"] == "waiting_for_retry" and st["retry_scheduled"] == 1 and st["failed"] == 1
        assert st["next_retry_at"].endswith("Z")

        with SessionLocal() as s:                       # 30 minutes later...
            r = s.get(PearlCampaignRecipient, rec.id)
            r.next_attempt_at = datetime.utcnow() - timedelta(seconds=1)
            s.commit()
        await until(lambda: len(fast_worker["dialed"]) == 2, what="second attempt")
        (rec,) = recipients(camp_id)
        assert rec.status == "calling" and rec.attempts == 2 and rec.next_attempt_at is None
        assert rec.outcome is None

        finish_call(fast_worker["dialed"][1][1], "busy", "USER_BUSY")   # attempts used up
        await asyncio.wait_for(worker, timeout=6)

    asyncio.run(scenario())
    (rec,) = recipients(camp_id)
    assert [n for n, _ in fast_worker["dialed"]] == ["+919876511100"] * 2
    assert fast_worker["dialed"][0][1] != fast_worker["dialed"][1][1]  # a new call per attempt
    assert (rec.status, rec.outcome, rec.attempts, rec.next_attempt_at) == ("failed", "busy", 2, None)
    camp = campaign(camp_id)
    assert camp.status == "completed" and camp.failed_calls == 2 and camp.completed_calls == 0


def test_dispatch_failure_is_retried_and_counted_once(fast_worker):
    uid, _ = make_user()
    # Generic spelling, zero interval: the retry is due right away.
    camp_id = make_campaign(uid, {"max_attempts": 2, "retry_interval": 0, "pacing_seconds": 0}, recipients=1)
    fast_worker["plan"]["fail"] = {1}

    async def scenario():
        worker = asyncio.create_task(pearl._dispatch_campaign_worker(camp_id))
        await until(lambda: len(fast_worker["dialed"]) == 2, what="retry after the refused dial")
        finish_call(fast_worker["dialed"][1][1], "completed")
        await asyncio.wait_for(worker, timeout=6)

    asyncio.run(scenario())
    (rec,) = recipients(camp_id)
    assert (rec.status, rec.attempts, rec.next_attempt_at) == ("completed", 2, None)
    camp = campaign(camp_id)
    assert (camp.status, camp.failed_calls, camp.completed_calls) == ("completed", 1, 1)


def test_no_retry_without_retry_settings(fast_worker):
    uid, _ = make_user()
    camp_id = make_campaign(uid, {"concurrency_limit": 3, "pacing_seconds": 0}, recipients=1)
    fast_worker["plan"]["fail"] = {1}
    asyncio.run(asyncio.wait_for(pearl._dispatch_campaign_worker(camp_id), timeout=6))
    (rec,) = recipients(camp_id)
    assert len(fast_worker["dialed"]) == 1 and rec.status == "failed" and rec.next_attempt_at is None
    assert campaign(camp_id).status == "completed" and campaign(camp_id).failed_calls == 1


def test_cancelled_call_is_never_retried():
    uid, hdr = make_user()
    camp_id = make_campaign(uid, {"max_attempts": 3, "retry_interval": 0}, recipients=1)
    with SessionLocal() as s:
        rec = s.query(PearlCampaignRecipient).filter_by(campaign_id=camp_id).one()
        call = PearlCall(agent_id=s.get(PearlCampaign, camp_id).agent_id, provider="vobiz", status="ringing")
        s.add(call)
        s.flush()
        rec.call_id, rec.status, rec.attempts = call.id, "calling", 1
        s.commit()
        call_id = call.id
    assert client.post(f"/api/pearl/calls/{call_id}/cancel", headers=hdr).status_code == 200
    finish_call(call_id, "cancelled", "ORIGINATOR_CANCEL")
    (rec,) = recipients(camp_id)
    assert (rec.status, rec.outcome, rec.next_attempt_at) == ("failed", "cancelled", None)


# ── counters: stale-call healer and late carrier events ──────────────────────

def _stale_call(retry_settings):
    uid, _ = make_user()
    camp_id = make_campaign(uid, retry_settings, recipients=1)
    with SessionLocal() as s:
        rec = s.query(PearlCampaignRecipient).filter_by(campaign_id=camp_id).one()
        call = PearlCall(agent_id=s.get(PearlCampaign, camp_id).agent_id, provider="vobiz", status="initiating",
                         created_at=datetime.utcnow() - timedelta(minutes=10))
        s.add(call)
        s.flush()
        rec.call_id, rec.status, rec.attempts = call.id, "calling", 1
        s.commit()
        return camp_id, call.id


def test_healer_counts_a_stuck_call_once_and_schedules_its_retry():
    camp_id, call_id = _stale_call({"max_attempts": 2, "retry_interval": 15})
    for _ in range(2):  # healing twice must not count twice
        with SessionLocal() as s:
            pearl._heal_stale_calls(s)
    with SessionLocal() as s:
        call = s.get(PearlCall, call_id)
        assert call.status == "failed" and call.error_code == "Dialing timeout / Stale" and call.ended_at is None
    (rec,) = recipients(camp_id)
    assert (rec.status, rec.error_reason) == ("failed", "No carrier response") and rec.next_attempt_at is not None
    assert campaign(camp_id).failed_calls == 1


def test_late_completed_event_after_a_heal_moves_the_count_to_completed():
    camp_id, call_id = _stale_call({"max_attempts": 2, "retry_interval": 15})
    with SessionLocal() as s:
        pearl._heal_stale_calls(s)
    assert finish_call(call_id, "completed") == "final"
    (rec,) = recipients(camp_id)
    camp = campaign(camp_id)
    assert (camp.completed_calls, camp.failed_calls) == (1, 0)
    assert rec.status == "completed" and rec.next_attempt_at is None


def test_late_unanswered_event_after_a_heal_is_not_counted_again():
    camp_id, call_id = _stale_call({"max_attempts": 2, "retry_interval": 15})
    with SessionLocal() as s:
        pearl._heal_stale_calls(s)
    scheduled = recipients(camp_id)[0].next_attempt_at
    finish_call(call_id, "no_answer", "NO_ANSWER")
    (rec,) = recipients(camp_id)
    assert campaign(camp_id).failed_calls == 1 and rec.outcome == "no_answer"
    assert rec.next_attempt_at == scheduled  # the retry the healer scheduled is kept


def test_healer_ignores_calls_a_final_event_already_settled():
    camp_id, call_id = _stale_call({"concurrency_limit": 1})
    finish_call(call_id, "busy", "USER_BUSY")
    with SessionLocal() as s:
        pearl._heal_stale_calls(s)
        assert s.get(PearlCall, call_id).status == "busy"
    assert campaign(camp_id).failed_calls == 1


# ── API: launch / resume validation ──────────────────────────────────────────

@pytest.fixture
def stub_worker(monkeypatch):
    started = []

    async def fake_worker(campaign_id):
        started.append(campaign_id)

    monkeypatch.setattr(pearl, "_dispatch_campaign_worker", fake_worker)
    monkeypatch.setenv("VOBIZ_AUTH_ID", "test-auth-id")
    monkeypatch.setenv("VOBIZ_AUTH_SECRET", "test-auth-secret")
    return started


@pytest.mark.parametrize("settings,needle", [
    ({"call_provider": "twilio"}, "Unsupported call_provider 'twilio' in call_settings. Use one of: vobiz, exotel."),
    ({"call_provider": "smartflo", "concurrency_limit": 1}, "Unsupported call_provider 'smartflo'"),
    ({"timezone": "Mars/Olympus", "window_start": "09:00", "window_end": "18:00"}, "Unknown timezone"),
    ({"window_start": "9am", "window_end": "18:00"}, "window_start '9am'"),
    ({"max_retries": "three"}, "max_retries must be a whole number"),
])
def test_launch_rejects_settings_the_dialer_cannot_use(stub_worker, settings, needle):
    uid, hdr = make_user()
    camp_id = make_campaign(uid, settings, status="draft")
    res = client.post(f"/api/pearl/campaigns/{camp_id}/launch", headers=hdr)
    assert res.status_code == 400 and needle in res.json()["detail"], res.text
    assert campaign(camp_id).status == "draft" and stub_worker == []


def test_launch_accepts_supported_carriers_and_reports_the_window(stub_worker, monkeypatch):
    uid, hdr = make_user()
    camp_id = make_campaign(uid, {"call_provider": "Vobiz", **ist_window(*CLOSED)}, status="draft")
    res = client.post(f"/api/pearl/campaigns/{camp_id}/launch", headers=hdr)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["calling_window"]["open"] is False and "Calls start when the calling window opens" in body["message"]
    assert body["campaign"]["effective_call_settings"]["call_provider"] == "vobiz"
    assert body["campaign"]["metrics"]["qualified_calls"] is None
    assert stub_worker == [camp_id]

    # Exotel needs its own credentials (unchanged message).
    exo = make_campaign(uid, {"call_provider": "exotel"}, status="draft")
    res = client.post(f"/api/pearl/campaigns/{exo}/launch", headers=hdr)
    assert res.status_code == 400 and "Exotel API credentials" in res.json()["detail"]


def test_resume_validates_settings_and_reattaches_an_orphaned_dialer(stub_worker):
    uid, hdr = make_user()
    paused = make_campaign(uid, {"call_provider": "twilio"}, status="paused")
    res = client.post(f"/api/pearl/campaigns/{paused}/resume", headers=hdr)
    assert res.status_code == 400 and "Unsupported call_provider" in res.json()["detail"]
    assert campaign(paused).status == "paused"

    orphan = make_campaign(uid, {"concurrency_limit": 1}, status="running")  # e.g. after a restart
    res = client.post(f"/api/pearl/campaigns/{orphan}/resume", headers=hdr)
    assert res.status_code == 200 and res.json() == {"ok": True, "status": "running", "reattached": True}
    assert stub_worker == [orphan]

    pearl._running_campaign_workers.add(orphan)  # a live dialer: nothing to resume
    try:
        res = client.post(f"/api/pearl/campaigns/{orphan}/resume", headers=hdr)
        assert res.status_code == 400 and "Only paused campaigns" in res.json()["detail"]
    finally:
        pearl._running_campaign_workers.discard(orphan)

    _, other_hdr = make_user()
    assert client.post(f"/api/pearl/campaigns/{orphan}/resume", headers=other_hdr).status_code == 404


# ── API: recipients counts, campaign payload ─────────────────────────────────

def test_recipients_return_per_status_counts():
    uid, hdr = make_user()
    camp_id = make_campaign(uid, {"max_attempts": 2}, recipients=0, status="draft")
    with SessionLocal() as s:
        for i, (st, retry) in enumerate([("valid", False), ("valid", False), ("invalid", False), ("excluded", False),
                                         ("completed", False), ("failed", True), ("failed", False), ("calling", False)]):
            s.add(PearlCampaignRecipient(
                campaign_id=camp_id, phone_number=f"9000000{i:03d}", normalized_phone=f"+919000000{i:03d}", status=st,
                next_attempt_at=datetime.utcnow() + timedelta(minutes=5) if retry else None,
            ))
        s.commit()

    body = client.get(f"/api/pearl/campaigns/{camp_id}/recipients", headers=hdr).json()
    assert body["counts"] == {"valid": 2, "invalid": 1, "excluded": 1, "queued": 0, "calling": 1,
                              "completed": 1, "failed": 2}
    assert body["retry_scheduled"] == 1 and body["total"] == 8 and len(body["recipients"]) == 8
    failed = [r for r in body["recipients"] if r["status"] == "failed"]
    assert sorted(r["retry_scheduled"] for r in failed) == [False, True]
    assert all((r["next_attempt_at"] is None) != r["retry_scheduled"] for r in failed)

    page = client.get(f"/api/pearl/campaigns/{camp_id}/recipients?status=failed,calling&limit=2", headers=hdr).json()
    assert page["total"] == 3 and len(page["recipients"]) == 2 and page["counts"]["valid"] == 2
    assert {r["status"] for r in page["recipients"]} <= {"failed", "calling"}

    _, other_hdr = make_user()
    assert client.get(f"/api/pearl/campaigns/{camp_id}/recipients", headers=other_hdr).status_code == 404


def test_completing_a_campaign_drops_scheduled_retries():
    uid, hdr = make_user()
    camp_id = make_campaign(uid, {"max_attempts": 2}, recipients=1, status="paused")
    with SessionLocal() as s:
        rec = s.query(PearlCampaignRecipient).filter_by(campaign_id=camp_id).one()
        rec.status, rec.attempts, rec.next_attempt_at = "failed", 1, datetime.utcnow() + timedelta(minutes=10)
        s.commit()
    assert client.get(f"/api/pearl/campaigns/{camp_id}/recipients", headers=hdr).json()["retry_scheduled"] == 1
    res = client.patch(f"/api/pearl/campaigns/{camp_id}", headers=hdr, json={"status": "completed"})
    assert res.status_code == 200, res.text
    (rec,) = recipients(camp_id)
    assert rec.next_attempt_at is None and rec.status == "failed"


def test_existing_recipients_table_gets_next_attempt_at(tmp_path):
    from sqlalchemy import create_engine, inspect, text
    from database import add_missing_columns

    old = create_engine(f"sqlite:///{(tmp_path / 'old.db').as_posix()}")
    Base.metadata.create_all(bind=old, tables=[PearlCampaignRecipient.__table__])
    with old.begin() as conn:  # a database from before the column existed
        conn.execute(text("DROP INDEX ix_pearl_campaign_recipients_next_attempt_at"))
        conn.execute(text("ALTER TABLE pearl_campaign_recipients DROP COLUMN next_attempt_at"))
    assert "pearl_campaign_recipients.next_attempt_at" in add_missing_columns(old)
    inspector = inspect(old)
    assert "next_attempt_at" in {c["name"] for c in inspector.get_columns("pearl_campaign_recipients")}
    assert "ix_pearl_campaign_recipients_next_attempt_at" in {
        ix["name"] for ix in inspector.get_indexes("pearl_campaign_recipients")}
    old.dispose()


def test_campaign_payload_shows_effective_settings():
    uid, hdr = make_user()
    created = client.post("/api/pearl/campaigns", headers=hdr, json={"name": "defaults"}).json()
    eff = created["effective_call_settings"]
    assert created["call_settings"]["retry_interval"] == 30  # stored default unchanged
    assert (eff["max_attempts"], eff["retry_interval_minutes"], eff["timezone"]) == (2, 30.0, "Asia/Kolkata")
    assert eff["calling_window"]["start"] == "09:00" and eff["calling_window"]["end"] == "18:00"
    assert created["metrics"]["qualified_calls"] is None
