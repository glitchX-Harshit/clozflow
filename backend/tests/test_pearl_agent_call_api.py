"""
Pearl agent / call API additions: agent ``role`` on update, the per-user calls list, the
cold-call ``simulated`` flag, the seeded opening of voice test sessions, and the agent's
max call length on the carrier audio socket.

Throwaway SQLite DB, no network: STT / VAD / LLM / TTS / carrier are in-process fakes.
"""
import asyncio
import base64
import json
import os
import pathlib
import sys
import tempfile
import uuid
from datetime import datetime, timedelta

import anyio
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
from database import Base, engine, SessionLocal  # noqa: E402
from models import User, Lead  # noqa: E402
from models_pearl import (  # noqa: E402
    PearlAgent, PearlCall, PearlConversation, PearlEvent, PearlMessage, PearlTestMessage,
)
from routers import pearl  # noqa: E402
from routers.auth import create_access_token  # noqa: E402
from services.pearl.carrier_auth import carrier_token  # noqa: E402
from services.pearl.providers import vobiz_provider  # noqa: E402
from services.pearl.providers.tts import FLUSH_COMPLETE  # noqa: E402
from services.vad_engine import VADEvent  # noqa: E402

Base.metadata.create_all(bind=engine)

app = FastAPI()
app.include_router(pearl.router)
client = TestClient(app)

_PROVIDER_ENV = ("VOBIZ_AUTH_ID", "VOBIZ_AUTH_SECRET", "EXOTEL_ACCOUNT_SID", "EXOTEL_API_KEY", "EXOTEL_API_TOKEN",
                 "GROQ_API_KEY", "SARVAM_API_KEY", "GEMINI_API_KEY", "PEARL_PUBLIC_URL")


@pytest.fixture(autouse=True)
def _offline_env(monkeypatch):
    for key in _PROVIDER_ENV:
        monkeypatch.delenv(key, raising=False)


@pytest.fixture(autouse=True)
def _no_calls_left_in_flight():
    """The test DB is shared by every module and the campaign dialer's server-wide cap counts all
    in-flight calls: settle the ones a test leaves behind (cold calls, carrier sockets)."""
    started = datetime.utcnow() - timedelta(seconds=1)
    yield
    with SessionLocal() as s:
        s.query(PearlCall).filter(
            PearlCall.status.in_(pearl.IN_FLIGHT_CALL_STATUSES), PearlCall.created_at >= started,
        ).update({PearlCall.status: "completed", PearlCall.ended_at: datetime.utcnow()}, synchronize_session=False)
        s.commit()


def make_user(balance=100.0):
    with SessionLocal() as s:
        user = User(email=f"agentapi-{uuid.uuid4().hex[:10]}@example.test", password_hash="x", credit_balance=balance)
        s.add(user)
        s.commit()
        token = create_access_token({"sub": str(user.id)})
        return user.id, {"Authorization": f"Bearer {token}"}, token


def make_agent(user_id, **fields):
    with SessionLocal() as s:
        agent = PearlAgent(user_id=user_id, name=fields.pop("name", "Agent"), status=fields.pop("status", "draft"), **fields)
        s.add(agent)
        s.commit()
        return agent.id


# ── agent role ────────────────────────────────────────────────────────────────

def test_agent_role_is_saved_on_update_and_validated_like_create():
    uid, hdr, _ = make_user()
    created = client.post("/api/pearl/agents", headers=hdr, json={"name": "Support", "role": "inbound_support"})
    assert created.status_code == 200 and created.json()["role"] == "inbound_support"
    agent_id = created.json()["id"]

    res = client.patch(f"/api/pearl/agents/{agent_id}", headers=hdr, json={"role": " outbound_qualification "})
    assert res.status_code == 200 and res.json()["role"] == "outbound_qualification"
    assert client.get(f"/api/pearl/agents/{agent_id}", headers=hdr).json()["role"] == "outbound_qualification"

    for bad in ("", "   ", "x" * 65, 42):
        res = client.patch(f"/api/pearl/agents/{agent_id}", headers=hdr, json={"role": bad})
        assert res.status_code == 422, (bad, res.text)
    # null = unchanged (also for name, which used to fail with a 500)
    res = client.patch(f"/api/pearl/agents/{agent_id}", headers=hdr, json={"role": None, "name": None, "mission": "Help"})
    assert res.status_code == 200, res.text
    assert (res.json()["role"], res.json()["name"], res.json()["mission"]) == ("outbound_qualification", "Support", "Help")

    assert client.post("/api/pearl/agents", headers=hdr, json={"name": "Long", "role": "x" * 65}).status_code == 422
    blank = client.post("/api/pearl/agents", headers=hdr, json={"name": "Blank", "role": "  "})
    assert blank.status_code == 200 and blank.json()["role"] == "outbound_qualification"


# ── per-user calls list ───────────────────────────────────────────────────────

def test_calls_list_is_paginated_newest_first_and_only_the_callers():
    uid, hdr, _ = make_user()
    other_uid, other_hdr, _ = make_user()
    a1, a2 = make_agent(uid, name="First"), make_agent(uid, name="Second")
    foreign_agent = make_agent(other_uid, name="Theirs")
    base = datetime.utcnow() - timedelta(hours=1)
    with SessionLocal() as s:
        lead = Lead(user_id=uid, business_name="Asha Traders", phone_number="+919876500001")
        s.add(lead)
        s.flush()
        rows = [
            PearlCall(agent_id=a1, provider="vobiz", status="completed", created_at=base, lead_id=lead.id),
            PearlCall(agent_id=a2, provider="vobiz", status="failed", error_code="vobiz: USER_BUSY",
                      created_at=base + timedelta(minutes=1)),
            PearlCall(agent_id=a1, provider="exotel", status="no_answer", created_at=base + timedelta(minutes=2)),
            PearlCall(agent_id=foreign_agent, provider="vobiz", status="completed", created_at=base + timedelta(minutes=3)),
        ]
        s.add_all(rows)
        s.commit()
        mine = [rows[2].id, rows[1].id, rows[0].id]  # newest first
        foreign = rows[3].id

    assert client.get("/api/pearl/calls").status_code == 401

    page1 = client.get("/api/pearl/calls?limit=2", headers=hdr).json()
    assert [c["id"] for c in page1["calls"]] == mine[:2]
    assert (page1["total"], page1["limit"], page1["offset"], page1["has_more"]) == (3, 2, 0, True)
    page2 = client.get("/api/pearl/calls?limit=2&offset=2", headers=hdr).json()
    assert [c["id"] for c in page2["calls"]] == mine[2:] and page2["has_more"] is False

    first = page2["calls"][0]
    assert first["agent_name"] == "First" and first["lead_name"] == "Asha Traders" and first["status"] == "completed"
    assert page1["calls"][1]["error_code"] == "vobiz: USER_BUSY"

    by_agent = client.get(f"/api/pearl/calls?agent_id={a1}", headers=hdr).json()
    assert [c["id"] for c in by_agent["calls"]] == [mine[0], mine[2]]
    by_status = client.get("/api/pearl/calls?status=failed,no_answer", headers=hdr).json()
    assert [c["id"] for c in by_status["calls"]] == mine[:2]
    assert client.get(f"/api/pearl/calls?agent_id={foreign_agent}", headers=hdr).status_code == 404

    theirs = client.get("/api/pearl/calls", headers=other_hdr).json()
    assert [c["id"] for c in theirs["calls"]] == [foreign] and foreign not in [c["id"] for c in page1["calls"]]
    assert client.get("/api/pearl/calls?limit=0", headers=hdr).json()["limit"] == 20   # 0 = default (as /events)
    assert client.get("/api/pearl/calls?limit=-5", headers=hdr).json()["limit"] == 1
    assert client.get("/api/pearl/calls?limit=5000", headers=hdr).json()["limit"] == 100


# ── cold call: simulated flag ─────────────────────────────────────────────────

def test_cold_call_says_when_it_was_simulated(monkeypatch):
    uid, hdr, _ = make_user()
    agent_id = make_agent(uid)
    res = client.post(f"/api/pearl/agents/{agent_id}/calls", headers=hdr, json={"phone_number": "9876543210"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["simulated"] is True and body["provider_call_id"].startswith("sim-")
    assert "no real call was placed" in body["message"]

    monkeypatch.setenv("VOBIZ_AUTH_ID", "test-auth-id")
    monkeypatch.setenv("VOBIZ_AUTH_SECRET", "test-auth-secret")
    monkeypatch.setenv("PEARL_PUBLIC_URL", "https://pearl.example.test")

    async def fake_create(self, to_number, from_number=None, custom_field=""):
        return {"success": True, "provider_call_id": f"req-{custom_field[:6]}"}

    monkeypatch.setattr(vobiz_provider.VobizTelephonyProvider, "create_outbound_call", fake_create)
    res = client.post(f"/api/pearl/agents/{agent_id}/calls", headers=hdr, json={"phone_number": "9876543210"})
    assert res.status_code == 200 and res.json()["simulated"] is False
    assert res.json()["message"].startswith("Cold call initiated")


# ── fakes for the voice pipelines ─────────────────────────────────────────────

FRAME = b"\x10\x00" * 1600  # 3200 bytes: one 200 ms carrier frame / a chunk of browser audio


class FakeVAD:
    def __init__(self, *a, **kw):
        self._speaking = False

    async def initialize(self):
        return True

    def set_agent_speaking(self, value):
        pass

    def process_chunk(self, pcm):
        if pcm.startswith(b"SPEECH"):
            self._speaking = True
            return [VADEvent.SPEECH_START]
        return []

    @property
    def is_speaking(self):
        return self._speaking


class FakeSTT:
    def __init__(self, transcript_callback):
        self.cb = transcript_callback

    async def connect(self):
        return True

    async def send_audio(self, chunk):
        if chunk.startswith(b"SAY:"):
            await self.cb("prospect", chunk[4:].decode(), is_final=True, speech_final=True)

    async def close(self):
        pass


class FakeEngine:
    instances = []
    OPENING = "Namaste this is Pearl calling about your growth plans"

    def __init__(self, *a, **kw):
        self.history = []
        self.generated = 0
        FakeEngine.instances.append(self)

    def add_turn(self, speaker, text):
        self.history.append((speaker, text))

    def analyze_latest_turn(self, text):
        return {"signals": [], "objections": []}

    async def generate_response_stream(self):
        self.generated += 1
        text = self.OPENING if not self.history else f"Reply {self.generated}"
        for word in text.split():
            await asyncio.sleep(0.001)
            yield word + " "


class FakeTTS:
    instances = []

    def __init__(self):
        self.queue = asyncio.Queue()
        self.sent = []
        self.cancels = 0
        self._llm_finished = False
        FakeTTS.instances.append(self)

    async def connect(self):
        pass

    async def configure(self, **kw):
        pass

    def reset_buffer(self):
        pass

    async def send_text(self, text):
        self.sent.append(text)
        await self.queue.put(("text", text))

    async def flush(self):
        await self.queue.put(("flush", None))

    async def cancel(self):
        self.cancels += 1

    async def close(self):
        await self.queue.put(("end", None))

    async def receive_audio(self):
        while True:
            kind, _ = await self.queue.get()
            if kind == "end":
                return
            if kind == "flush":
                yield FLUSH_COMPLETE
                continue
            yield FRAME


@pytest.fixture
def fakes(monkeypatch):
    FakeEngine.instances.clear()
    FakeTTS.instances.clear()
    monkeypatch.setenv("PEARL_SHORT_TURN_MS", "30")
    monkeypatch.setenv("PEARL_END_OF_TURN_MS", "40")
    monkeypatch.setenv("PEARL_LONG_TURN_MS", "60")
    monkeypatch.setenv("PEARL_STT_FINAL_WAIT_MS", "10")
    monkeypatch.setattr(pearl, "SileroVADEngine", FakeVAD)
    monkeypatch.setattr(pearl, "GeminiStream", FakeSTT)
    monkeypatch.setattr(pearl, "ConversationEngine", FakeEngine)
    monkeypatch.setattr(pearl, "get_tts_provider", FakeTTS)


def recv(ws, timeout=6.0):
    async def _recv():
        with anyio.fail_after(timeout):
            return await ws._send_rx.receive()

    message = ws.portal.call(_recv)
    ws._raise_on_close(message)
    return json.loads(message["text"])


# ── voice test sessions: seeded opening ───────────────────────────────────────

def _messages(session_id):
    with SessionLocal() as s:
        return s.query(PearlTestMessage).filter_by(session_id=session_id).order_by(PearlTestMessage.timestamp).all()


def test_voice_session_is_seeded_with_the_opening_the_socket_speaks(fakes):
    uid, hdr, token = make_user(balance=10.0)
    agent_id = make_agent(uid, name="Pearl")
    res = client.post("/api/pearl/test-sessions", headers=hdr, json={"agent_id": agent_id, "mode": "voice"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert [(m["role"], m["text"], m["meta"]) for m in body["messages"]] == [
        ("assistant", FakeEngine.OPENING, {"is_opening": True})]

    with client.websocket_connect(f"/api/pearl/test-sessions/{body['id']}/voice?token={token}") as ws:
        assert recv(ws)["type"] == "ready"
        msg = recv(ws)
        while msg["type"] != "transcript":
            msg = recv(ws)
        assert (msg["speaker"], msg["text"]) == ("agent", FakeEngine.OPENING)   # the seeded line, verbatim
        while recv(ws)["type"] != "tts_finished":
            pass
        ws.send_text(json.dumps({"type": "stop"}))

    socket_engine = FakeEngine.instances[-1]
    assert socket_engine.generated == 0                              # nothing regenerated on connect
    assert FakeTTS.instances[-1].sent == [FakeEngine.OPENING]       # ...and it is what was spoken
    assert [m.text for m in _messages(body["id"])] == [FakeEngine.OPENING]  # stored once


def test_voice_session_seeds_a_fixed_greeting_and_clear_reseeds(fakes):
    uid, hdr, token = make_user(balance=10.0)
    agent_id = make_agent(uid, greeting="Hi {{prospect_name}}, Pearl here.", test_variables={"prospect_name": "Asha"})
    session = client.post("/api/pearl/test-sessions", headers=hdr, json={"agent_id": agent_id, "mode": "voice"}).json()
    assert [m["text"] for m in session["messages"]] == ["Hi Asha, Pearl here."]

    with SessionLocal() as s:  # a turn happened...
        s.add(PearlTestMessage(session_id=session["id"], role="user", text="hello"))
        s.commit()
    cleared = client.post(f"/api/pearl/test-sessions/{session['id']}/clear", headers=hdr).json()
    assert [(m["role"], m["text"]) for m in cleared["messages"]] == [("assistant", "Hi Asha, Pearl here.")]

    legacy = make_agent(uid, greeting="Hi, I'm Pearl calling from Clozflow. How are you doing today?")
    seeded = client.post("/api/pearl/test-sessions", headers=hdr, json={"agent_id": legacy, "mode": "voice"}).json()
    assert [m["text"] for m in seeded["messages"]] == [FakeEngine.OPENING]  # old built-in greeting is ignored

    chat = client.post("/api/pearl/test-sessions", headers=hdr, json={"agent_id": agent_id, "mode": "chat"}).json()
    assert [m["text"] for m in chat["messages"]] == ["Hi Asha, Pearl here."]  # chat unchanged


# ── max call length ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("settings,seconds", [
    ({"maxCallLength": 15}, 900.0), ({"maxCallLength": "10"}, 600.0), ({"maxCallLength": 0.5}, 60.0),
    ({"maxCallLength": 1000}, 240 * 60.0), ({"maxCallLength": 0}, None), ({"maxCallLength": -3}, None),
    ({"maxCallLength": None}, None), ({"maxCallLength": "abc"}, None), ({"maxCallLength": True}, None),
    ({"maxCallLength": float("nan")}, None), ({}, None),
])
def test_max_call_seconds(settings, seconds):
    assert pearl._max_call_seconds({"settings": settings}) == seconds
    assert pearl._max_call_seconds({}) is None and pearl._max_call_seconds(None) is None
    assert pearl._max_call_seconds({"settings": "15"}) is None


def test_time_limit_goodbye():
    assert pearl._time_limit_goodbye({"settings": {"disconnectPhrase": " Thanks, bye! "}}) == "Thanks, bye!"
    assert pearl._time_limit_goodbye({"settings": {"disconnectPhrase": "  "}}) == pearl.DEFAULT_TIME_LIMIT_GOODBYE


def _carrier_call(voice_config):
    uid, _, _ = make_user()
    with SessionLocal() as s:
        agent = PearlAgent(user_id=uid, name="Pearl", status="active", greeting="Namaste, Pearl here.",
                           voice_config=voice_config)
        s.add(agent)
        s.flush()
        call = PearlCall(agent_id=agent.id, provider="vobiz", status="initiating", provider_call_id="req-limit")
        s.add(call)
        s.flush()
        s.add(PearlConversation(call_id=call.id, objective="Qualify", status="active"))
        s.commit()
        return call.id


@pytest.fixture
def vobiz_hangups(monkeypatch):
    monkeypatch.setenv("VOBIZ_AUTH_ID", "test-auth-id")
    monkeypatch.setenv("VOBIZ_AUTH_SECRET", "test-auth-secret")
    monkeypatch.setenv("PEARL_PUBLIC_URL", "https://pearl.example.test")
    hung = []

    async def fake_hangup(self, provider_call_id):
        hung.append(provider_call_id)
        return {"success": True}

    monkeypatch.setattr(vobiz_provider.VobizTelephonyProvider, "hangup_call", fake_hangup)
    return hung


def test_call_is_ended_cleanly_at_the_max_call_length(fakes, vobiz_hangups, monkeypatch):
    goodbye = "Time is up, thank you so much!"
    call_id = _carrier_call({"speaker": "shubh_enhi_ads", "settings": {"maxCallLength": 5, "disconnectPhrase": goodbye}})
    limits = []
    real_max_call_seconds = pearl._max_call_seconds

    def short_limit(voice_cfg):
        limits.append(real_max_call_seconds(voice_cfg))
        return 0.5  # the 5-minute limit, compressed for the test

    monkeypatch.setattr(pearl, "_max_call_seconds", short_limit)

    events = []
    with pytest.raises(WebSocketDisconnect) as closed:
        with client.websocket_connect(f"/api/pearl/calls/{call_id}/audio?token={carrier_token(call_id)}") as ws:
            ws.send_text(json.dumps({"event": "start", "start": {"streamId": "stream-1"}}))
            while True:
                events.append(recv(ws))
    assert closed.value.code == 1000                                   # the server hung up

    assert limits == [300.0]
    tts = FakeTTS.instances[-1]
    assert tts.sent[0] == "Namaste, Pearl here." and tts.sent[-1] == goodbye
    kinds = [e["event"] for e in events]
    assert "clearAudio" in kinds and kinds[-1] == "playAudio"           # goodbye audio after the clear
    assert kinds.index("clearAudio") < len(kinds) - 1
    assert vobiz_hangups == ["req-limit"]                              # carrier asked to hang up
    with SessionLocal() as s:
        assert s.query(PearlEvent).filter_by(call_id=call_id, event_type="call_max_length_reached").count() == 1
        conv = s.query(PearlConversation).filter_by(call_id=call_id).one()
        assert goodbye in [m.text for m in s.query(PearlMessage).filter_by(conversation_id=conv.id)]
        assert s.get(PearlCall, call_id).status == "active"  # the carrier's hangup event finalises it


def test_no_limit_configured_means_no_hangup(fakes, vobiz_hangups):
    call_id = _carrier_call({"speaker": "shubh_enhi_ads", "settings": {"bargeIn": True}})
    with client.websocket_connect(f"/api/pearl/calls/{call_id}/audio?token={carrier_token(call_id)}") as ws:
        ws.send_text(json.dumps({"event": "start", "start": {"streamId": "stream-2"}}))
        assert recv(ws)["event"] == "playAudio"
        ws.send_text(json.dumps({"event": "stop"}))
    assert vobiz_hangups == []
    with SessionLocal() as s:
        assert s.query(PearlEvent).filter_by(call_id=call_id, event_type="call_max_length_reached").count() == 0


# ── Vobiz wire format (https://www.vobiz.ai/docs/xml/stream/stream-events) ────

def test_vobiz_playaudio_names_the_stream_and_inbound_follows_media_format(fakes, vobiz_hangups, monkeypatch):
    """Every playAudio carries the streamId from ``start`` (the greeting is held until
    it arrives), and inbound audio is decoded per ``start.mediaFormat`` (μ-law here)."""
    received = []

    class RecordingSTT(FakeSTT):
        async def send_audio(self, chunk):
            received.append(chunk)
            await super().send_audio(chunk)

    monkeypatch.setattr(pearl, "GeminiStream", RecordingSTT)
    call_id = _carrier_call({"speaker": "shubh_enhi_ads"})
    with client.websocket_connect(f"/api/pearl/calls/{call_id}/audio?token={carrier_token(call_id)}") as ws:
        ws.send_text(json.dumps({"sequenceNumber": 0, "event": "start", "start": {
            "callId": "call-uuid", "streamId": "stream-3", "accountId": "1", "tracks": ["inbound"],
            "mediaFormat": {"encoding": "audio/x-mulaw", "sampleRate": 8000}}, "extra_headers": "{}"}))
        first = recv(ws)
        assert first["event"] == "playAudio" and first["streamId"] == "stream-3"
        assert first["media"]["contentType"] == "audio/x-l16" and first["media"]["sampleRate"] == 8000
        ulaw_silence = base64.b64encode(b"\xff" * 160).decode()        # 20 ms of μ-law/8k
        ws.send_text(json.dumps({"sequenceNumber": 1, "streamId": "stream-3", "event": "media", "media": {
            "track": "inbound", "timestamp": "1", "chunk": 1, "payload": ulaw_silence}}))
        ws.send_text(json.dumps({"event": "stop"}))
    assert received, "inbound media reached STT"
    # 160 μ-law samples → 160 PCM16 samples at 8 kHz → ~320 at 16 kHz (≈640 bytes).
    # Read as L16 the same frame would be only 80 samples (≈320 bytes).
    assert 600 <= len(received[0]) <= 680 and set(received[0]) <= {0}


def test_vobiz_greeting_is_not_held_forever_without_a_start_frame(fakes, vobiz_hangups, monkeypatch):
    monkeypatch.setattr(pearl, "VOBIZ_START_TIMEOUT_SECONDS", 0.2)
    call_id = _carrier_call({"speaker": "shubh_enhi_ads"})
    with client.websocket_connect(f"/api/pearl/calls/{call_id}/audio?token={carrier_token(call_id)}") as ws:
        assert recv(ws)["event"] == "playAudio"
        ws.send_text(json.dumps({"event": "stop"}))


def test_vobiz_answer_xml_requests_l16_8k_bidirectional_stream():
    from services.pearl.carrier_auth import carrier_token as token_for
    call_id = _carrier_call({"speaker": "shubh_enhi_ads"})
    res = client.post(f"/api/pearl/vobiz/answer?call_id={call_id}&token={token_for(call_id)}")
    assert res.status_code == 200
    import xml.etree.ElementTree as ET
    stream = ET.fromstring(res.text.split("?>", 1)[1]).find("Stream")
    assert stream.get("bidirectional") == "true" and stream.get("audioTrack") == "inbound"
    assert stream.get("keepCallAlive") == "true" and stream.get("contentType") == "audio/x-l16;rate=8000"
