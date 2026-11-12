"""
Browser voice test (/api/pearl/test-sessions/{id}/voice): the agent must keep speaking on
every turn after a barge-in.

Root cause of the bug: the session iterated ``tts.receive_audio()`` exactly once, and the
TTS providers ended that stream on ``cancel()`` (Sarvam closes its socket on barge-in; the
ElevenLabs fallback also stopped after the first turn and stayed muted after a cancel), so
after the first interruption no agent audio reached the browser again.

Fakes only (STT, VAD, LLM, TTS sockets) - no network.
"""
import asyncio
import base64
import json
import os
import pathlib
import sys
import tempfile
import uuid

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

import models  # noqa: E402,F401
import models_pearl  # noqa: E402,F401
import admin.models  # noqa: E402,F401
from database import Base, engine, SessionLocal  # noqa: E402
from models import User  # noqa: E402
from models_pearl import PearlAgent, PearlTestSession, PearlTestMessage  # noqa: E402
from routers import pearl  # noqa: E402
from routers.auth import create_access_token  # noqa: E402
from services.vad_engine import VADEvent  # noqa: E402
from services.pearl.providers import tts as tts_module  # noqa: E402

Base.metadata.create_all(bind=engine)

AUDIO_CHUNK = b"\x10\x00" * 160


# ── fakes ─────────────────────────────────────────────────────────────────────

class FakeVAD:
    """Client frames starting with b"SPEECH" / b"SILENCE" drive speech start / end."""

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
        if pcm.startswith(b"SILENCE"):
            self._speaking = False
            return [VADEvent.SPEECH_END]
        return []

    @property
    def is_speaking(self):
        return self._speaking


class FakeSTT:
    """A client frame b"SAY:<text>" becomes a final transcript of <text>."""

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
    """Scripted LLM: a long opening (so the user can barge in), then short replies."""

    def __init__(self, *a, **kw):
        self.history = []
        self.turn = 0

    def add_turn(self, speaker, text):
        self.history.append((speaker, text))

    async def generate_response_stream(self):
        self.turn += 1
        text = ("Namaste this is Pearl calling about your growth plans for this quarter today"
                if self.turn == 1 else f"Reply number {self.turn} with pricing details")
        for word in text.split():
            await asyncio.sleep(0.002)
            yield word + " "


class DroppingTTS:
    """
    Behaves like the pre-fix Sarvam provider: cancel() (barge-in) ENDS the active
    receive_audio() stream. The session must re-attach to keep hearing later turns.
    """
    instances = []

    def __init__(self):
        self.queue = asyncio.Queue()
        self.generation = 0
        self.cancels = 0
        DroppingTTS.instances.append(self)

    async def connect(self):
        pass

    async def configure(self, **kw):
        pass

    def reset_buffer(self):
        pass

    async def send_text(self, text):
        await self.queue.put(("text", self.generation, text))

    async def flush(self):
        await self.queue.put(("flush", self.generation, None))

    async def cancel(self):
        self.cancels += 1
        self.generation += 1
        await self.queue.put(("end", None, None))

    async def close(self):
        await self.queue.put(("end", None, None))

    async def receive_audio(self):
        while True:
            kind, gen, _ = await self.queue.get()
            if kind == "end":
                return  # the stream is gone, exactly like a closed provider socket
            if gen != self.generation:
                continue
            if kind == "flush":
                yield tts_module.FLUSH_COMPLETE
                continue
            for _ in range(20):  # ~0.6s of "speech" per phrase
                await asyncio.sleep(0.03)
                yield AUDIO_CHUNK


# ── helpers ───────────────────────────────────────────────────────────────────

def make_session():
    with SessionLocal() as s:
        user = User(email=f"voice-{uuid.uuid4().hex[:10]}@example.test", password_hash="x", credit_balance=10.0)
        s.add(user)
        s.flush()
        agent = PearlAgent(user_id=user.id, name="Pearl", status="draft")
        s.add(agent)
        s.flush()
        sess = PearlTestSession(user_id=user.id, agent_id=agent.id, mode="voice", status="active",
                                agent_snapshot={"name": "Pearl", "mission": "Qualify", "greeting": None,
                                                "voice_config": {"speaker": "shubh_enhi_ads"},
                                                "test_variables": {"prospect_name": "Asha"}})
        s.add(sess)
        s.commit()
        return sess.id, create_access_token({"sub": str(user.id)})


def recv(ws, timeout=5.0):
    """receive_json with a deadline (a silent server must fail the test, not hang it)."""
    async def _recv():
        with anyio.fail_after(timeout):
            return await ws._send_rx.receive()

    message = ws.portal.call(_recv)
    ws._raise_on_close(message)
    return json.loads(message["text"])


def wait_for(ws, predicate, timeout=5.0):
    seen = []
    deadline = timeout
    while True:
        msg = recv(ws, timeout=deadline)
        seen.append(msg)
        if predicate(msg):
            return msg, seen


@pytest.fixture
def voice_app(monkeypatch):
    for key in ("GROQ_API_KEY", "SARVAM_API_KEY", "GEMINI_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("PEARL_SHORT_TURN_MS", "30")
    monkeypatch.setenv("PEARL_END_OF_TURN_MS", "40")
    monkeypatch.setenv("PEARL_LONG_TURN_MS", "60")
    monkeypatch.setenv("PEARL_STT_FINAL_WAIT_MS", "10")
    DroppingTTS.instances.clear()
    monkeypatch.setattr(pearl, "SileroVADEngine", FakeVAD)
    monkeypatch.setattr(pearl, "GeminiStream", FakeSTT)
    monkeypatch.setattr(pearl, "ConversationEngine", FakeEngine)
    monkeypatch.setattr(pearl, "get_tts_provider", DroppingTTS)
    app = FastAPI()
    app.include_router(pearl.router)
    return TestClient(app)


# ── the regression test ───────────────────────────────────────────────────────

def test_agent_keeps_speaking_after_barge_in(voice_app):
    session_id, token = make_session()
    with voice_app.websocket_connect(f"/api/pearl/test-sessions/{session_id}/voice?token={token}") as ws:
        assert recv(ws)["type"] == "ready"
        wait_for(ws, lambda m: m["type"] == "audio")          # turn 1 (opening) is being spoken

        import time
        time.sleep(0.3)                                       # > 200 ms of agent audio
        ws.send_bytes(b"SPEECH")                              # user talks over the agent
        wait_for(ws, lambda m: m["type"] == "interrupted")
        assert DroppingTTS.instances[0].cancels == 1

        ws.send_bytes(b"SAY:what is the price")               # user finishes their sentence
        ws.send_bytes(b"SILENCE")
        msg, _ = wait_for(ws, lambda m: m["type"] == "transcript" and m["speaker"] == "user")
        assert msg["text"] == "what is the price"

        # Turn 2: the agent's answer must be heard again (this is what used to go silent).
        _, seen = wait_for(ws, lambda m: m["type"] == "tts_finished")
        assert any(m["type"] == "audio" and base64.b64decode(m["data"]) == AUDIO_CHUNK for m in seen)
        assert any(m["type"] == "transcript" and m["speaker"] == "agent" and m["text"].startswith("Reply number 2") for m in seen)

        # ...and keeps working on the following turn too.
        ws.send_bytes(b"SAY:ok and the next step")
        _, seen = wait_for(ws, lambda m: m["type"] == "tts_finished")
        assert any(m["type"] == "audio" for m in seen)
        assert any(m["type"] == "transcript" and m["speaker"] == "agent" and m["text"].startswith("Reply number 3") for m in seen)

        ws.send_text(json.dumps({"type": "stop"}))

    with SessionLocal() as s:
        roles = [m.role for m in s.query(PearlTestMessage).filter_by(session_id=session_id).order_by(PearlTestMessage.timestamp)]
    assert roles.count("user") == 2 and roles.count("assistant") >= 2


def test_voice_socket_rejects_missing_or_foreign_token(voice_app):
    from starlette.websockets import WebSocketDisconnect
    session_id, _ = make_session()
    _, other_token = make_session()
    for query in ("", f"?token={other_token}"):
        with pytest.raises(WebSocketDisconnect) as exc:
            with voice_app.websocket_connect(f"/api/pearl/test-sessions/{session_id}/voice{query}") as ws:
                ws.receive_json()
        assert exc.value.code == 1008


# ── provider-level: one receive_audio() stream survives cancel / turns ─────────

class FakeSarvamSocket:
    def __init__(self):
        from websockets.protocol import State
        self.state = State.OPEN
        self.inbox = asyncio.Queue()
        self.sent = []

    async def send(self, raw):
        msg = json.loads(raw)
        self.sent.append(msg)
        if msg["type"] == "text":
            payload = base64.b64encode(AUDIO_CHUNK).decode()
            await self.inbox.put(json.dumps({"type": "audio", "data": {"audio": payload, "content_type": "audio/pcm"}}))
        elif msg["type"] == "flush":
            await self.inbox.put(json.dumps({"type": "event", "data": {"event_type": "final"}}))

    async def recv(self):
        item = await self.inbox.get()
        if item is None:
            import websockets
            raise websockets.exceptions.ConnectionClosedOK(None, None)
        return item

    async def close(self):
        from websockets.protocol import State
        self.state = State.CLOSED
        await self.inbox.put(None)


def test_sarvam_receive_stream_survives_barge_in(monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "test-key")
    sockets = []

    async def fake_connect(url, additional_headers=None):
        sock = FakeSarvamSocket()
        sockets.append(sock)
        return sock

    monkeypatch.setattr(tts_module.websockets, "connect", fake_connect)

    async def scenario():
        tts = tts_module.SarvamTTSProvider()
        await tts.connect()
        await tts.configure(language_code="hi-IN", speaker="shubh_enhi_ads", pace=1.0, temperature=0.6)
        got = asyncio.Queue()

        async def consume():  # ONE iteration of receive_audio() for the whole session
            async for chunk in tts.receive_audio():
                await got.put(chunk)
            await got.put("END")

        consumer = asyncio.create_task(consume())
        await tts.send_text("pehla turn")
        assert await asyncio.wait_for(got.get(), 2) == AUDIO_CHUNK
        await asyncio.sleep(0.05)                # consumer is now blocked in recv() on socket 1
        await tts.cancel()                       # barge-in: socket 1 closed, warm reconnect started
        await tts.send_text("doosra turn")       # next turn goes out on socket 2
        await tts.flush()
        assert await asyncio.wait_for(got.get(), 2) == AUDIO_CHUNK     # same stream, still alive
        assert await asyncio.wait_for(got.get(), 2) == tts_module.FLUSH_COMPLETE
        await tts.close()
        assert await asyncio.wait_for(got.get(), 2) == "END"           # only close() ends it
        await consumer
        return len(sockets)

    assert asyncio.run(scenario()) == 2


def test_elevenlabs_fallback_serves_every_turn(monkeypatch):
    async def fake_stream(self, text, options=None):
        yield f"pcm:{text}".encode()  # 7 bytes: one stray byte is held back until the next chunk
        yield b"!"

    monkeypatch.setattr(tts_module.OldElevenLabsProvider, "stream", fake_stream)

    async def scenario():
        tts = tts_module.ElevenLabsTTSProvider()
        stream = tts.receive_audio().__aiter__()
        out = []
        await tts.send_text("one")
        await tts.flush()
        out += [await asyncio.wait_for(stream.__anext__(), 1) for _ in range(3)]
        await tts.cancel()                      # barge-in must not mute the provider forever
        await tts.send_text("two")
        await tts.flush()
        out += [await asyncio.wait_for(stream.__anext__(), 1) for _ in range(3)]
        await tts.close()
        return out

    # PCM16 is delivered in whole samples (even-length chunks): "pcm:one" + "!" -> b"pcm:on", b"e!"
    assert asyncio.run(scenario()) == [
        b"pcm:on", b"e!", tts_module.FLUSH_COMPLETE, b"pcm:tw", b"o!", tts_module.FLUSH_COMPLETE,
    ]
