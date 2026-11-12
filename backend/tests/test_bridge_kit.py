"""Shared fixtures and fakes for the bridge-call and live-pipeline tests (no tests here).

Imported first by every ``test_bridge_*`` / ``test_live_*`` module: it configures a
throw-away SQLite database and a fake environment *before* the app is imported, and
never loads the real ``.env`` (no secrets, no network: Vobiz, STT and the AI engine
are all fakes).
"""
from __future__ import annotations

import base64
import json
import os
import sys
import tempfile
import threading
import time
import uuid
from datetime import timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

BACKEND_DIR = Path(__file__).resolve().parents[1]
WEB_DIR = BACKEND_DIR.parent

if "main" not in sys.modules:
    _db_url = os.environ.get("CLOZFLOW_TEST_DATABASE_URL") or \
        "sqlite:///" + str(Path(tempfile.gettempdir()) / "clozflow_bridge_tests.db").replace("\\", "/")
    if _db_url.startswith("sqlite:///"):
        _db_file = Path(_db_url[len("sqlite:///"):])
        _db_file.parent.mkdir(parents=True, exist_ok=True)
        for _suffix in ("", "-wal", "-shm"):
            try:
                Path(str(_db_file) + _suffix).unlink()
            except FileNotFoundError:
                pass
    os.environ["DATABASE_URL"] = _db_url
    _ENV = {
        "JWT_SECRET_KEY": "bridge-tests-secret",
        "VOBIZ_AUTH_ID": "MA_TEST", "VOBIZ_AUTH_SECRET": "test-secret", "VOBIZ_CALLER_ID": "+918000000001",
        "VOBIZ_BASE_URL": "https://api.vobiz.invalid", "PEARL_PUBLIC_URL": "https://copilot.example.test",
        "CLOZFLOW_COPILOT_ENGINE": "legacy", "COPILOT_BRIDGE_RATE_PER_MINUTE": "3.0",
        "COPILOT_BRIDGE_MAX_MINUTES": "60", "GEMINI_API_KEY": "", "GROQ_API_KEY": "",
        "SUPABASE_JWT_SECRET": "", "ALLOWED_ORIGINS": "",
        # Fast turn detection for scripted speech.
        "PEARL_SHORT_TURN_MS": "60", "PEARL_END_OF_TURN_MS": "100", "PEARL_LONG_TURN_MS": "150",
        "PEARL_STT_FINAL_WAIT_MS": "10",
    }
    os.environ.update(_ENV)
    import dotenv
    dotenv.load_dotenv = lambda *args, **kwargs: False   # never read web/.env in tests
    for _path in (str(BACKEND_DIR), str(WEB_DIR)):
        if _path not in sys.path:
            sys.path.insert(0, _path)
    os.chdir(BACKEND_DIR)

import numpy as np  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

import main  # noqa: E402
from admin.models import CreditTransaction  # noqa: E402
from database import SessionLocal  # noqa: E402
from models import CallLog, User  # noqa: E402
from models_bridge import CopilotBridgeCall  # noqa: E402
from routers.auth import create_access_token  # noqa: E402
from services import websocket_service  # noqa: E402
from services.bridge import service as bridge_module  # noqa: E402
from services.bridge.service import bridge_service  # noqa: E402
from services.bridge.vobiz import HangupResult, PlaceCallResult  # noqa: E402

FRAME_SAMPLES = 320   # 20 ms of L16/16 kHz = 640 bytes

# Scripted speech: every media frame of an utterance carries one constant sample
# value (its marker); ScriptedSTT turns marker-then-silence into that text.
SCRIPT = {
    1101: "Hi, this is Asha from ClozFlow. Do you have a minute?",
    1102: "It starts at one thousand rupees a month.",
    2101: "Sure. How much does it cost?",
    2102: "That sounds expensive for a small bakery.",
    2999: "RINGBACK MUST NEVER BE TRANSCRIBED",
    3101: "We need a clear plan for the rollout.",
}


class ScriptedSTT:
    """Fake streaming STT: emits ``SCRIPT[marker]`` when an utterance's audio ends."""
    instances: list = []

    def __init__(self, transcript_callback):
        self.callback = transcript_callback
        self.current = 0
        self.bytes_received = 0
        self.closed = False
        ScriptedSTT.instances.append(self)

    async def connect(self):
        return True

    async def send_audio(self, chunk):
        self.bytes_received += len(chunk)
        samples = np.frombuffer(chunk, dtype="<i2")
        marker = int(samples.max()) if samples.size else 0
        if marker:
            self.current = marker
        elif self.current:
            marker, self.current = self.current, 0
            text = SCRIPT.get(marker)
            if text:
                await self.callback("prospect", text, is_final=True, speech_final=True)

    async def close(self):
        self.closed = True


class FailingSTT(ScriptedSTT):
    async def connect(self):
        return False


class NullVAD:
    async def initialize(self):
        return True

    def process_chunk(self, chunk):
        return []


class FakeEngine:
    """Legacy-engine stand-in: records every turn; replies to prospect turns."""
    is_brain_client = False
    instances: list = []

    def __init__(self, call_context=None, user_instructions=None, learning_log=True):
        self.call_context = call_context
        self.user_instructions = user_instructions
        self.learning_log = learning_log
        self.turns = []
        self.closed = None
        FakeEngine.instances.append(self)

    async def analyze(self, speaker, text):
        self.turns.append((speaker, text))
        if speaker in ("rep", "salesperson"):
            return None
        return {"suggested_response": f"Reply to: {text}", "coaching_tip": "Anchor on value.",
                "confidence": 0.8, "strategy": "ANSWER_FIRST", "intent": "pricing"}

    async def close(self, *, finalize=True):
        self.closed = finalize


class FakeBrainEngine(FakeEngine):
    is_brain_client = True

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.session_id = "brain-session-1"

    async def analyze(self, speaker, text):
        self.turns.append((speaker, text))
        if speaker in ("rep", "salesperson"):
            return {"brain_status": "recorded", "brain_session_id": self.session_id, "suggested_response": "",
                    "coaching_tip": "Rep transcript recorded as context.", "confidence": 0.0}
        return {"brain_status": "complete", "brain_session_id": self.session_id,
                "suggested_response": f"Brain reply to: {text}", "coaching_tip": "Because.",
                "confidence": 0.9, "deal_signal": 64}


class FakeTelephony:
    def __init__(self):
        self.placed = []
        self.hangups = []
        self.place_ok = True
        self.hangup_ok = True

    async def place_call(self, **kwargs):
        self.placed.append(kwargs)
        if not self.place_ok:
            return PlaceCallResult(ok=False, status_code=500)
        return PlaceCallResult(ok=True, request_uuid=f"req-{len(self.placed)}", status_code=201)

    async def hangup(self, call_uuid):
        self.hangups.append(call_uuid)
        return HangupResult(ok=self.hangup_ok, status_code=204 if self.hangup_ok else 500)


class Kit:
    def __init__(self, client: TestClient, telephony: FakeTelephony):
        self.client = client
        self.telephony = telephony

    # ── accounts / briefs ──

    def user(self, credits: float = 100.0, superuser: bool = False):
        with SessionLocal() as db:
            user = User(email=f"rep-{uuid.uuid4().hex[:10]}@example.test", password_hash="x",
                        credit_balance=credits, is_admin=superuser)
            db.add(user)
            db.commit()
            db.refresh(user)
            user_id = user.id
        token = create_access_token({"sub": str(user_id)}, timedelta(hours=1))
        return user_id, token

    @staticmethod
    def auth(token):
        return {"Authorization": f"Bearer {token}"}

    def brief(self, token) -> str:
        response = self.client.post("/call/start", headers=self.auth(token), json={
            "client_name": "Ravi", "client_industry": "Bakery", "client_role": "Owner",
            "product_name": "ClozFlow", "product_price": "1000 INR per month", "call_goal": "Book a demo"})
        assert response.status_code == 200, response.text
        return response.json()["context_id"]

    def start_call(self, token, context_id, *, prospect="98765 43210", rep="+91 91234-12345", name="Acme Bakery"):
        return self.client.post("/api/copilot/bridge/calls", headers=self.auth(token), json={
            "context_id": context_id, "prospect_phone": prospect, "rep_phone": rep, "prospect_name": name})

    # ── carrier side ──

    def carrier(self, index: int = -1):
        """(path builder, token) for the call placed ``index``-th."""
        answer_url = self.telephony.placed[index]["answer_url"]
        query = parse_qs(urlsplit(answer_url).query)
        bid, token = query["bid"][0], query["t"][0]

        def path(name, *, t=token, b=bid):
            return f"/api/copilot/bridge/vobiz/{name}?bid={b}&t={t}"
        return path, token

    def answer(self, path, **params):
        response = self.client.post(path("answer"), data={"CallUUID": "a-leg-1", "CallStatus": "in-progress",
                                                          "Event": "StartApp", **params})
        assert response.status_code == 200, response.text
        return response.text

    def post(self, path, name, **params):
        response = self.client.post(path(name), data=params)
        assert response.status_code == 200, response.text
        return response

    @staticmethod
    def frame(track: str, value: int, seq: int) -> str:
        pcm = np.full(FRAME_SAMPLES, value, dtype="<i2").tobytes()
        return json.dumps({"sequenceNumber": seq, "streamId": "stream-1", "event": "media",
                           "media": {"track": track, "timestamp": str(seq * 20), "chunk": seq,
                                     "payload": base64.b64encode(pcm).decode()}})

    @staticmethod
    def start_event() -> str:
        return json.dumps({"sequenceNumber": 0, "event": "start", "start": {
            "callId": "a-leg-1", "streamId": "stream-1", "accountId": "1", "tracks": ["inbound", "outbound"],
            "mediaFormat": {"encoding": "audio/x-l16", "sampleRate": 16000}}, "extra_headers": "{}"})

    def send(self, media, frames):
        """Interleaved frames: ``frames`` is a list of (inbound_value, outbound_value)."""
        seq = getattr(media, "_seq", 0)
        for inbound, outbound in frames:
            seq += 1
            media.send_text(self.frame("inbound", inbound, seq))
            media.send_text(self.frame("outbound", outbound, seq))
        media._seq = seq

    def say(self, media, track: str, marker: int, frames: int = 10, silence: int = 14):
        speech = [(marker, 0) if track == "inbound" else (0, marker)] * frames
        self.send(media, speech + [(0, 0)] * silence)

    # ── db ──

    @staticmethod
    def row(call_id):
        with SessionLocal() as db:
            row = db.get(CopilotBridgeCall, call_id)
            return {c.name: getattr(row, c.name) for c in CopilotBridgeCall.__table__.columns} if row else None

    @staticmethod
    def balance(user_id):
        with SessionLocal() as db:
            return round(float(db.get(User, user_id).credit_balance or 0), 2)

    @staticmethod
    def consumption(user_id):
        with SessionLocal() as db:
            return [t.amount for t in db.query(CreditTransaction).filter(
                CreditTransaction.user_id == user_id, CreditTransaction.type == "consumption").all()]

    @staticmethod
    def call_log(call_log_id):
        with SessionLocal() as db:
            log = db.get(CallLog, call_log_id)
            return (json.loads(log.transcript), json.loads(log.ai_suggestions)) if log else None

    @staticmethod
    def call_logs(user_id):
        with SessionLocal() as db:
            return db.query(CallLog).filter(CallLog.user_id == user_id).count()

    def sweep(self, seconds_ahead: float):
        now = bridge_module.utcnow() + timedelta(seconds=seconds_ahead)
        self.client.portal.call(bridge_service.sweep, now)


# ── WebSocket helpers (TestClient sockets have no receive timeout) ──

def recv(ws, timeout: float = 8.0):
    """Next JSON message; raises WebSocketDisconnect when the server closed."""
    result = {}

    def run():
        try:
            result["message"] = ws.receive_json()
        except BaseException as exc:   # noqa: BLE001 - re-raised in the test thread
            result["error"] = exc

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    thread.join(timeout)
    if thread.is_alive():
        raise AssertionError("timed out waiting for a WebSocket message")
    if "error" in result:
        raise result["error"]
    return result["message"]


def recv_until(ws, predicate, timeout: float = 10.0):
    """Messages up to and including the first one matching ``predicate``."""
    deadline = time.monotonic() + timeout
    seen = []
    while True:
        message = recv(ws, max(0.1, deadline - time.monotonic()))
        seen.append(message)
        if predicate(message):
            return seen


def recv_until_closed(ws, timeout: float = 15.0):
    """All messages until the server closes; returns (messages, close code)."""
    deadline = time.monotonic() + timeout
    seen = []
    while True:
        try:
            seen.append(recv(ws, max(0.1, deadline - time.monotonic())))
        except WebSocketDisconnect as exc:
            return seen, exc.code


def wait_for(predicate, timeout: float = 8.0, interval: float = 0.02):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    raise AssertionError("condition not reached in time")


def status_of(message):
    return message.get("call", {}).get("status") if message.get("type") == "callStatus" else None


# ── fixtures ──

@pytest.fixture
def telephony():
    return FakeTelephony()


@pytest.fixture
def engine_cls():
    """The AI engine class used by sessions (tests may switch to FakeBrainEngine)."""
    return {"cls": FakeEngine}


@pytest.fixture
def stt_cls():
    return {"cls": ScriptedSTT}


@pytest.fixture
def kit(monkeypatch, telephony, engine_cls, stt_cls):
    FakeEngine.instances.clear()
    ScriptedSTT.instances.clear()
    # ``create_stt_stream(callback, **options)``: the fakes ignore the channel/keyterm options.
    monkeypatch.setattr(websocket_service, "create_stt_stream", lambda callback, **options: stt_cls["cls"](callback))
    monkeypatch.setattr(websocket_service, "create_vad", lambda: NullVAD())
    monkeypatch.setattr(websocket_service, "create_ai_engine",
                        lambda call_context, *, user_instructions=None, learning_log=True:
                        engine_cls["cls"](call_context, user_instructions, learning_log))
    bridge_service.calls.clear()
    bridge_service._user_locks.clear()
    bridge_service.telephony_factory = lambda: telephony
    bridge_service.watchdog_interval = 3600.0
    with TestClient(main.app) as client:
        yield Kit(client, telephony)
    bridge_service.calls.clear()
    bridge_service._user_locks.clear()
