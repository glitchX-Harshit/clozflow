"""
Carrier-facing Pearl endpoints: Vobiz answer/events and Exotel webhooks (per-call token or
stored carrier call id), final-vs-progress event handling, idempotent billing and campaign
counters, the carrier audio socket's token check, and the campaign dispatch worker.

Throwaway SQLite DB, no network.
"""
import asyncio
import os
import pathlib
import sys
import tempfile
import uuid

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
from starlette.websockets import WebSocketDisconnect  # noqa: E402

import models  # noqa: E402,F401
import models_pearl  # noqa: E402,F401
import admin.models  # noqa: E402,F401
from admin.models import CreditTransaction  # noqa: E402
from database import Base, engine, SessionLocal  # noqa: E402
from models import User  # noqa: E402
from models_pearl import PearlAgent, PearlCall, PearlCampaign, PearlCampaignRecipient  # noqa: E402
from routers import pearl  # noqa: E402
from services.pearl.carrier_auth import carrier_token  # noqa: E402
from services.pearl.carrier_events import parse_vobiz_event, parse_exotel_event  # noqa: E402

Base.metadata.create_all(bind=engine)

app = FastAPI()
app.include_router(pearl.router)
client = TestClient(app)


@pytest.fixture(autouse=True)
def _offline_env(monkeypatch):
    for key in ("VOBIZ_AUTH_ID", "VOBIZ_AUTH_SECRET", "EXOTEL_ACCOUNT_SID", "EXOTEL_API_KEY",
                "EXOTEL_API_TOKEN", "GROQ_API_KEY", "SARVAM_API_KEY", "GEMINI_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("PEARL_PUBLIC_URL", "https://pearl.example.test")


def setup_call(status="initiating", provider="vobiz", provider_call_id="req-abc", balance=50.0, with_recipient=True):
    with SessionLocal() as s:
        user = User(email=f"carrier-{uuid.uuid4().hex[:10]}@example.test", password_hash="x", credit_balance=balance)
        s.add(user)
        s.flush()
        agent = PearlAgent(user_id=user.id, name="Dialer", status="active")
        s.add(agent)
        s.flush()
        call = PearlCall(agent_id=agent.id, provider=provider, status=status, provider_call_id=provider_call_id)
        s.add(call)
        s.flush()
        camp_id = rec_id = None
        if with_recipient:
            camp = PearlCampaign(user_id=user.id, agent_id=agent.id, name="camp", status="running")
            s.add(camp)
            s.flush()
            rec = PearlCampaignRecipient(campaign_id=camp.id, phone_number="9876543210",
                                         normalized_phone="+919876543210", status="calling", call_id=call.id)
            s.add(rec)
            s.flush()
            camp_id, rec_id = camp.id, rec.id
        s.commit()
        return {"user": user.id, "agent": agent.id, "call": call.id, "campaign": camp_id, "recipient": rec_id}


def state(ids):
    with SessionLocal() as s:
        call = s.get(PearlCall, ids["call"])
        rec = s.get(PearlCampaignRecipient, ids["recipient"]) if ids["recipient"] else None
        camp = s.get(PearlCampaign, ids["campaign"]) if ids["campaign"] else None
        user = s.get(User, ids["user"])
        txns = s.query(CreditTransaction).filter(CreditTransaction.user_id == ids["user"]).count()
        return call, rec, camp, round(float(user.credit_balance), 2), txns


def vobiz_event(ids, form, token=True):
    q = f"call_id={ids['call']}" + (f"&token={carrier_token(ids['call'])}" if token else "")
    return client.post(f"/api/pearl/vobiz/events?{q}", data=form)


# ── status mapping (pure) ─────────────────────────────────────────────────────

@pytest.mark.parametrize("payload,final,status", [
    ({"Event": "Ring", "CallStatus": "ringing"}, False, "ringing"),
    ({"Event": "StartApp", "CallStatus": "in-progress"}, False, "active"),
    ({"Event": "CallInitiated"}, False, "initiating"),
    ({"Event": "StreamStart"}, False, None),
    ({"Event": "Hangup", "CallStatus": "completed", "HangupCause": "NORMAL_CLEARING", "Duration": "42"}, True, "completed"),
    ({"Event": "Hangup", "CallStatus": "completed", "HangupCause": "USER_BUSY", "Duration": "0"}, True, "busy"),
    ({"Event": "Hangup", "CallStatus": "completed", "HangupCause": "NO_ANSWER"}, True, "no_answer"),
    ({"Event": "Hangup", "CallStatus": "no-answer"}, True, "no_answer"),
    ({"Event": "Hangup", "CallStatus": "timeout"}, True, "no_answer"),
    ({"Event": "Hangup", "CallStatus": "cancel", "HangupCause": "ORIGINATOR_CANCEL"}, True, "cancelled"),
    ({"Event": "Hangup", "CallStatus": "failed", "HangupCause": "UNALLOCATED_NUMBER"}, True, "failed"),
    ({"Event": "Hangup", "CallStatus": "completed", "HangupCause": "CALL_REJECTED", "AnswerTime": ""}, True, "failed"),
    ({"Event": "Hangup", "CallStatus": "completed", "HangupCause": "End Of XML Instructions", "Duration": "75"}, True, "completed"),
    ({"Event": "Hangup", "CallStatus": "completed", "AnswerTime": "", "Duration": "0"}, True, "no_answer"),
    ({"call_status": "busy"}, True, "busy"),
    # Vobiz hangup_url payloads: HangupCause token + HangupCauseCode + human HangupCauseName
    # (https://www.vobiz.ai/docs/concepts/hangup-causes)
    ({"Event": "Hangup", "CallStatus": "completed", "HangupCauseName": "Busy Line", "HangupCauseCode": "3010",
      "AnswerTime": "", "Duration": "0"}, True, "busy"),
    ({"Event": "Hangup", "CallStatus": "completed", "HangupCauseName": "Ring Timeout Reached",
      "HangupCauseCode": "6010", "AnswerTime": ""}, True, "no_answer"),
    ({"Event": "Hangup", "CallStatus": "completed", "HangupCauseCode": "3000", "AnswerTime": ""}, True, "no_answer"),
    ({"Event": "Hangup", "CallStatus": "completed", "HangupCauseCode": "1000", "AnswerTime": ""}, True, "cancelled"),
    ({"Event": "Hangup", "CallStatus": "completed", "HangupCauseName": "Normal Hangup", "HangupCauseCode": "4000",
      "Duration": "30"}, True, "completed"),
    ({"Event": "Hangup", "CallStatus": "completed", "HangupCauseCode": "4010", "HangupSource": "Vobiz",
      "Duration": "12"}, True, "completed"),
    ({"Event": "Hangup", "CallStatus": "completed", "HangupCauseName": "Invalid Destination Address",
      "HangupCauseCode": "2000", "AnswerTime": ""}, True, "failed"),
])
def test_vobiz_status_mapping(payload, final, status):
    ev = parse_vobiz_event(payload)
    assert (ev.final, ev.status) == (final, status)


@pytest.mark.parametrize("raw,final,status", [
    ("queued", False, "initiating"), ("ringing", False, "ringing"), ("in-progress", False, "active"),
    ("completed", True, "completed"), ("busy", True, "busy"), ("no-answer", True, "no_answer"),
    ("failed", True, "failed"), ("canceled", True, "cancelled"),
])
def test_exotel_status_mapping(raw, final, status):
    ev = parse_exotel_event({"Status": raw, "CallSid": "sid"})
    assert (ev.final, ev.status) == (final, status)


# ── Vobiz events webhook ──────────────────────────────────────────────────────

def test_vobiz_progress_events_never_fail_recipients():
    ids = setup_call()
    for form in ({"Event": "Ring", "CallStatus": "ringing"}, {"Event": "StreamStart"}, {"event": "ringing"}):
        res = vobiz_event(ids, form)
        assert res.status_code == 200, res.text
    call, rec, camp, _, _ = state(ids)
    assert call.status == "ringing" and rec.status == "calling" and camp.failed_calls == 0

    assert vobiz_event(ids, {"Event": "StartApp", "CallStatus": "in-progress"}).status_code == 200
    call, rec, _, _, _ = state(ids)
    assert call.status == "active" and call.answered_at is not None and rec.status == "calling"


def test_vobiz_final_event_bills_once_and_is_idempotent():
    ids = setup_call(status="active")
    hangup = {"Event": "Hangup", "CallStatus": "completed", "HangupCause": "NORMAL_CLEARING",
              "Duration": "65", "CallUUID": "uuid-1", "RequestUUID": "req-abc"}
    res = vobiz_event(ids, hangup)
    assert res.status_code == 200 and res.json()["result"] == "final"
    call, rec, camp, balance, txns = state(ids)
    assert (call.status, call.duration_seconds, call.ended_at is not None) == ("completed", 65, True)
    assert (rec.status, rec.duration_seconds, camp.completed_calls) == ("completed", 65, 1)
    assert call.revenue_billed == 3.25 and balance == 46.75 and txns == 1  # 65s at 3.00/min

    # Carrier retries / duplicate hangups change nothing and never bill twice.
    for _ in range(2):
        res = vobiz_event(ids, hangup)
        assert res.status_code == 200 and res.json()["result"] == "duplicate"
    # A late progress event can't resurrect the call.
    vobiz_event(ids, {"Event": "StartApp", "CallStatus": "in-progress"})
    call, rec, camp, balance, txns = state(ids)
    assert call.status == "completed" and camp.completed_calls == 1 and balance == 46.75 and txns == 1


def test_vobiz_unanswered_outcomes_fail_recipient_without_billing():
    for cause, expected in (("USER_BUSY", "busy"), ("NO_ANSWER", "no_answer"), ("CALL_REJECTED", "failed")):
        ids = setup_call()
        res = vobiz_event(ids, {"Event": "Hangup", "CallStatus": "completed", "HangupCause": cause, "Duration": "0"})
        assert res.status_code == 200
        call, rec, camp, balance, txns = state(ids)
        assert call.status == expected and rec.status == "failed" and rec.outcome == expected
        assert cause in rec.error_reason and camp.failed_calls == 1
        assert balance == 50.0 and txns == 0


def test_vobiz_events_require_call_token_or_carrier_id():
    ids = setup_call()
    final = {"Event": "Hangup", "HangupCause": "NORMAL_CLEARING", "Duration": "30"}
    assert client.post(f"/api/pearl/vobiz/events?call_id={ids['call']}", data=final).status_code == 403
    assert client.post(f"/api/pearl/vobiz/events?call_id={ids['call']}&token=forged", data=final).status_code == 403
    assert client.post("/api/pearl/vobiz/events?call_id=nope&token=x", data=final).status_code == 404
    call, rec, _, balance, _ = state(ids)
    assert call.status == "initiating" and rec.status == "calling" and balance == 50.0

    # The carrier's own call id (stored at dispatch) also authenticates the callback.
    res = client.post(f"/api/pearl/vobiz/events?call_id={ids['call']}", data={**final, "RequestUUID": "req-abc"})
    assert res.status_code == 200 and state(ids)[0].status == "completed"


def test_vobiz_answer_webhook_returns_tokenized_stream():
    ids = setup_call(with_recipient=False)
    bad = client.post(f"/api/pearl/vobiz/answer?call_id={ids['call']}&token=forged")
    assert bad.status_code == 403 and "<Hangup/>" in bad.text

    ok = client.post(f"/api/pearl/vobiz/answer?call_id={ids['call']}&token={carrier_token(ids['call'])}")
    assert ok.status_code == 200
    assert f"wss://pearl.example.test/api/pearl/calls/{ids['call']}/audio?token={carrier_token(ids['call'])}" in ok.text
    assert state(ids)[0].status == "active"

    done = setup_call(status="cancelled", with_recipient=False)
    res = client.post(f"/api/pearl/vobiz/answer?call_id={done['call']}&token={carrier_token(done['call'])}")
    assert res.status_code == 200 and "<Hangup/>" in res.text


# ── Exotel webhook ────────────────────────────────────────────────────────────

def test_exotel_webhook_auth_and_single_billing():
    ids = setup_call(provider="exotel", provider_call_id="exo-sid-1")
    form = {"CustomField": ids["call"], "Status": "completed", "Duration": "30", "CallSid": "exo-sid-1"}
    assert client.post("/api/pearl/webhooks/exotel", data={**form, "CallSid": "guessed"}).status_code == 403
    assert client.post("/api/pearl/webhooks/exotel", data={"Status": "completed"}).status_code == 400

    assert client.post("/api/pearl/webhooks/exotel", data={**form, "Status": "in-progress"}).status_code == 200
    call, rec, _, _, _ = state(ids)
    assert call.status == "active" and rec.status == "calling"

    for _ in range(3):
        assert client.post("/api/pearl/webhooks/exotel", data=form).status_code == 200
    call, rec, camp, balance, txns = state(ids)
    assert call.status == "completed" and rec.status == "completed" and camp.completed_calls == 1
    assert balance == 48.5 and txns == 1  # 30s => 1.50 credits, charged exactly once

    tokened = setup_call(provider="exotel", provider_call_id=None, with_recipient=False)
    res = client.post(f"/api/pearl/webhooks/exotel?call_id={tokened['call']}&token={carrier_token(tokened['call'])}",
                      data={"Status": "no-answer", "CallSid": "exo-new"})
    assert res.status_code == 200
    call = state(tokened)[0]
    assert call.status == "no_answer" and call.provider_call_id == "exo-new"


# ── Carrier audio socket ──────────────────────────────────────────────────────

def test_carrier_audio_socket_requires_call_token():
    ids = setup_call(with_recipient=False)
    for query in ("", "?token=forged"):
        with pytest.raises(WebSocketDisconnect) as exc:
            with client.websocket_connect(f"/api/pearl/calls/{ids['call']}/audio{query}") as ws:
                ws.receive_text()
        assert exc.value.code == 1008
    finished = setup_call(status="completed", with_recipient=False)
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/api/pearl/calls/{finished['call']}/audio?token={carrier_token(finished['call'])}") as ws:
            ws.receive_text()
    assert exc.value.code == 1008


# ── Campaign dispatch worker ──────────────────────────────────────────────────

def test_campaign_workers_never_dial_a_recipient_twice(monkeypatch):
    with SessionLocal() as s:
        user = User(email=f"camp-{uuid.uuid4().hex[:10]}@example.test", password_hash="x", credit_balance=100.0)
        s.add(user)
        s.flush()
        agent = PearlAgent(user_id=user.id, name="Camp agent", status="active")
        s.add(agent)
        s.flush()
        # pacing_seconds (was the misused retry_interval key) = no pause between dispatches;
        # no retry keys = one attempt per recipient.
        camp = PearlCampaign(user_id=user.id, agent_id=agent.id, name="dedupe", status="running",
                             call_settings={"concurrency_limit": 10, "pacing_seconds": 0})
        s.add(camp)
        s.flush()
        for i in range(4):
            s.add(PearlCampaignRecipient(campaign_id=camp.id, phone_number=f"98765000{i}0",
                                         normalized_phone=f"+9198765000{i}0", status="valid"))
        s.commit()
        camp_id = camp.id

    dialed = []

    async def fake_dispatch(provider, to_number, call_id):
        dialed.append(to_number)
        await asyncio.sleep(0.01)
        if to_number.endswith("30"):
            return {"success": False, "error": "Vobiz HTTP 400: invalid destination"}
        return {"success": True, "provider_call_id": f"req-{call_id[:6]}"}

    monkeypatch.setattr(pearl, "_dispatch_outbound_call", fake_dispatch)

    class _NoRegistry(set):
        """Disable the per-process guard so two workers really race (as two server processes would)."""
        def __contains__(self, item):
            return False

    monkeypatch.setattr(pearl, "_running_campaign_workers", _NoRegistry())

    async def run_two_workers():
        # Two workers racing on the same campaign: only the atomic per-recipient claim protects us.
        await asyncio.gather(pearl._dispatch_campaign_worker(camp_id), pearl._dispatch_campaign_worker(camp_id))

    asyncio.run(run_two_workers())
    assert sorted(dialed) == sorted(f"+9198765000{i}0" for i in range(4))  # each recipient exactly once

    with SessionLocal() as s:
        camp = s.get(PearlCampaign, camp_id)
        recs = s.query(PearlCampaignRecipient).filter_by(campaign_id=camp_id).all()
        statuses = sorted(r.status for r in recs)
        calls = [s.get(PearlCall, r.call_id) for r in recs]
        assert statuses == ["calling", "calling", "calling", "failed"]
        assert sorted(c.status for c in calls) == ["failed", "initiating", "initiating", "initiating"]
        assert camp.failed_calls == 1 and camp.completed_calls == 0  # completed is counted by the hangup event
        assert camp.status == "completed" and all(r.attempts == 1 for r in recs)
