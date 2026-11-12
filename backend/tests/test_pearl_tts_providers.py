"""
Pearl TTS providers: ElevenLabs configuration, raw-PCM requests, provider selection,
mid-session failover, and that both Pearl audio pipelines receive 8 kHz PCM16 from
ElevenLabs. ElevenLabs is an in-process fake HTTP API (httpx.MockTransport); Sarvam is a
fake websocket. No network.
"""
import array
import asyncio
import base64
import io
import json
import math
import os
import pathlib
import struct
import sys
import tempfile
import types
import uuid
import wave

import anyio
import httpx
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
from models_pearl import PearlAgent, PearlCall, PearlTestSession  # noqa: E402
from routers import pearl  # noqa: E402
from routers.auth import create_access_token  # noqa: E402
from services.pearl.carrier_auth import carrier_token  # noqa: E402
from services.pearl.providers import elevenlabs_provider as el  # noqa: E402
from services.pearl.providers import tts as tts_module  # noqa: E402
from services.vad_engine import VADEvent  # noqa: E402

Base.metadata.create_all(bind=engine)

_TTS_ENV = ("ELEVENLABS_API_KEY", "ELEVEN_LABS_API_KEY", "ELEVENLABS_VOICE_ID", "ELEVEN_LABS_VOICE_ID",
            "ELEVENLABS_MODEL_ID", "ELEVEN_LABS_MODEL_ID", "SARVAM_API_KEY", "PEARL_TTS_PROVIDER",
            "GROQ_API_KEY", "GEMINI_API_KEY")


def pcm_tone(seconds=0.25, rate=8000, freq=440.0) -> bytes:
    """PCM16 LE mono sine."""
    n = int(seconds * rate)
    return b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * freq * i / rate))) for i in range(n))


PHRASE_PCM = pcm_tone()  # what the fake ElevenLabs returns per phrase: 0.25 s @ 8 kHz = 4000 bytes
SARVAM_CHUNK = b"\x10\x00" * 160


class FakeElevenLabs:
    """In-process ElevenLabs text-to-speech API, streaming its body in odd-sized chunks."""

    def __init__(self):
        self.requests = []
        self.content_type = "audio/pcm"
        self.body_for = lambda text, output_format: PHRASE_PCM

    def handler(self, request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        output_format = request.url.params.get("output_format")
        self.requests.append({
            "path": request.url.path, "output_format": output_format, "key": request.headers.get("xi-api-key"),
            "text": payload.get("text"), "model": payload.get("model_id"),
        })
        body = self.body_for(payload.get("text"), output_format)

        async def chunks():
            for i in range(0, len(body), 999):
                yield body[i:i + 999]

        return httpx.Response(200, headers={"content-type": self.content_type}, content=chunks())


@pytest.fixture
def clean_tts_env(monkeypatch):
    for key in _TTS_ENV:
        monkeypatch.delenv(key, raising=False)


@pytest.fixture
def fake_el(monkeypatch, clean_tts_env):
    server = FakeElevenLabs()
    monkeypatch.setenv("ELEVEN_LABS_API_KEY", "el-test-key")  # the older spelling web/.env uses
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "voice-test")
    monkeypatch.setattr(el, "_tts_client", httpx.AsyncClient(transport=httpx.MockTransport(server.handler)))
    return server


async def _drain_turn(stream_or_queue, timeout=3.0):
    """Collect chunks up to FLUSH_COMPLETE from an async iterator or an asyncio.Queue."""
    out = []
    while True:
        if isinstance(stream_or_queue, asyncio.Queue):
            chunk = await asyncio.wait_for(stream_or_queue.get(), timeout)
        else:
            chunk = await asyncio.wait_for(stream_or_queue.__anext__(), timeout)
        if chunk == tts_module.FLUSH_COMPLETE:
            return out
        out.append(chunk)


# ── configuration ─────────────────────────────────────────────────────────────

def test_one_env_helper_reads_both_key_spellings(monkeypatch, clean_tts_env):
    assert el.elevenlabs_api_key() is None and not el.elevenlabs_configured()
    monkeypatch.setenv("ELEVEN_LABS_API_KEY", "old-name")
    assert el.elevenlabs_api_key() == "old-name"
    monkeypatch.setenv("ELEVENLABS_API_KEY", "   ")  # blank (e.g. copied from .env.example) is ignored
    assert el.elevenlabs_api_key() == "old-name"
    monkeypatch.setenv("ELEVENLABS_API_KEY", "new-name")
    assert el.elevenlabs_api_key() == "new-name"

    assert el.elevenlabs_settings()["voice_id"] == el.DEFAULT_VOICE_ID
    assert el.elevenlabs_settings()["model_id"] == "eleven_turbo_v2"
    monkeypatch.setenv("ELEVEN_LABS_VOICE_ID", "voice-old")
    assert el.elevenlabs_settings()["voice_id"] == "voice-old"
    monkeypatch.setenv("ELEVENLABS_VOICE_ID", "voice-new")
    monkeypatch.setenv("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5")
    assert el.elevenlabs_settings() == {"api_key": "new-name", "voice_id": "voice-new", "model_id": "eleven_flash_v2_5"}
    assert el.ElevenLabsTTSProvider().api_key == "new-name"


def test_provider_selection_and_fallback_order(monkeypatch, clean_tts_env):
    assert isinstance(tts_module.get_tts_provider(), tts_module.ElevenLabsTTSProvider)  # nothing configured

    monkeypatch.setenv("ELEVEN_LABS_API_KEY", "el-key")
    assert isinstance(tts_module.get_tts_provider(), tts_module.ElevenLabsTTSProvider)

    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-key")
    both = tts_module.get_tts_provider()
    assert isinstance(both, tts_module.FailoverTTSProvider)
    assert both.provider_names == ["SarvamTTSProvider", "ElevenLabsTTSProvider"]

    monkeypatch.setenv("PEARL_TTS_PROVIDER", "elevenlabs")
    assert tts_module.get_tts_provider().provider_names == ["ElevenLabsTTSProvider", "SarvamTTSProvider"]

    monkeypatch.delenv("ELEVEN_LABS_API_KEY")  # preferred provider not configured -> the other one
    assert isinstance(tts_module.get_tts_provider(), tts_module.SarvamTTSProvider)


# ── ElevenLabs wrapper: raw PCM at the pipeline rate ──────────────────────────

def test_elevenlabs_requests_pcm_8000_and_yields_whole_samples(fake_el):
    async def scenario():
        tts = tts_module.ElevenLabsTTSProvider()
        stream = tts.receive_audio().__aiter__()
        await tts.send_text("Namaste ji")
        await tts.flush()
        chunks = await _drain_turn(stream)
        await tts.close()
        return chunks

    chunks = asyncio.run(scenario())
    assert chunks and all(len(c) % 2 == 0 for c in chunks)  # never splits a 16-bit sample
    assert b"".join(chunks) == PHRASE_PCM
    assert fake_el.requests == [{
        "path": "/v1/text-to-speech/voice-test/stream", "output_format": "pcm_8000",
        "key": "el-test-key", "text": "Namaste ji", "model": "eleven_turbo_v2",
    }]


def test_compressed_reply_is_decoded_to_mono_pcm16_at_8k(fake_el, monkeypatch):
    fake_el.content_type = "audio/mpeg"
    fake_el.body_for = lambda text, output_format: b"ID3" + b"\x00" * 2000  # an MP3 stream
    decoded = pcm_tone(0.1)
    calls = []

    def fake_decode(data, output_format, nchannels, sample_rate):
        calls.append((data[:3], len(data), output_format, nchannels, sample_rate))
        samples = array.array("h")
        samples.frombytes(decoded)
        return types.SimpleNamespace(samples=samples)

    monkeypatch.setitem(sys.modules, "miniaudio", types.SimpleNamespace(
        SampleFormat=types.SimpleNamespace(SIGNED16="SIGNED16"), decode=fake_decode))

    async def scenario():
        tts = tts_module.ElevenLabsTTSProvider()
        stream = tts.receive_audio().__aiter__()
        await tts.send_text("hello")
        await tts.flush()
        chunks = await _drain_turn(stream)
        await tts.close()
        return chunks

    assert b"".join(asyncio.run(scenario())) == decoded
    assert calls == [(b"ID3", 2003, "SIGNED16", 1, 8000)]  # whole reply, mono, 16-bit, 8 kHz


def test_real_miniaudio_decodes_and_resamples_when_installed():
    pytest.importorskip("miniaudio")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(pcm_tone(0.5, rate=16000))
    pcm = tts_module.decode_to_pcm16(buf.getvalue(), 8000)
    assert abs(len(pcm) - 8000) <= 64  # 0.5 s of 8 kHz PCM16 = 8000 bytes


# ── mid-session failover ──────────────────────────────────────────────────────

class FakeSarvamSocket:
    def __init__(self, reply_error=False):
        from websockets.protocol import State
        self.state = State.OPEN
        self.inbox = asyncio.Queue()
        self.reply_error = reply_error

    async def send(self, raw):
        msg = json.loads(raw)
        if msg["type"] == "text":
            if self.reply_error:
                await self.inbox.put(json.dumps({"type": "error", "data": {"message": "quota exceeded"}}))
            else:
                payload = base64.b64encode(SARVAM_CHUNK).decode()
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


async def _consume_into(tts, queue):
    async for chunk in tts.receive_audio():
        await queue.put(chunk)
    await queue.put("END")


def test_failover_to_elevenlabs_when_sarvam_cannot_reconnect(fake_el, monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-test")
    sockets = []

    async def fake_connect(url, additional_headers=None):
        if sockets:
            raise OSError("Sarvam unreachable")  # the first session works, every reconnect fails
        sockets.append(FakeSarvamSocket())
        return sockets[-1]

    monkeypatch.setattr(tts_module.websockets, "connect", fake_connect)

    async def scenario():
        tts = tts_module.get_tts_provider()
        assert isinstance(tts, tts_module.FailoverTTSProvider)
        await tts.connect()
        await tts.configure(language_code="hi-IN", speaker="shubh_enhi_ads", pace=1.0, temperature=0.6)
        got = asyncio.Queue()
        consumer = asyncio.create_task(_consume_into(tts, got))

        await tts.send_text("pehla turn")
        assert await asyncio.wait_for(got.get(), 2) == SARVAM_CHUNK   # Sarvam speaks turn 1
        await tts.cancel()                       # barge-in: Sarvam drops its socket, can't reconnect
        await tts.send_text("doosra turn")       # -> switches to ElevenLabs and re-sends the turn
        await tts.flush()
        turn2 = await _drain_turn(got)
        await tts.close()
        assert await asyncio.wait_for(got.get(), 2) == "END"
        await consumer
        return tts, turn2

    tts, turn2 = asyncio.run(scenario())
    assert b"".join(turn2) == PHRASE_PCM
    assert isinstance(tts.active, tts_module.ElevenLabsTTSProvider)
    assert [r["text"] for r in fake_el.requests] == ["doosra turn"]


def test_failover_when_sarvam_reports_an_error_mid_turn(fake_el, monkeypatch):
    monkeypatch.setenv("SARVAM_API_KEY", "sarvam-test")

    async def fake_connect(url, additional_headers=None):
        return FakeSarvamSocket(reply_error=True)

    monkeypatch.setattr(tts_module.websockets, "connect", fake_connect)

    async def scenario():
        tts = tts_module.get_tts_provider()
        await tts.connect()
        got = asyncio.Queue()
        consumer = asyncio.create_task(_consume_into(tts, got))
        await tts.send_text("hello there")
        await tts.flush()
        turn = await _drain_turn(got)
        await tts.close()
        await consumer
        return turn

    turn = asyncio.run(scenario())
    assert b"".join(turn) == PHRASE_PCM and tts_module.TTS_ERROR not in turn
    assert [r["text"] for r in fake_el.requests] == ["hello there"]


# ── both Pearl pipelines receive 8 kHz PCM16 from ElevenLabs ───────────────────

class FakeVAD:
    def __init__(self, *a, **kw):
        pass

    async def initialize(self):
        return True

    def set_agent_speaking(self, value):
        pass

    def process_chunk(self, pcm):
        return []

    @property
    def is_speaking(self):
        return False


class FakeSTT:
    def __init__(self, transcript_callback):
        self.cb = transcript_callback

    async def connect(self):
        return True

    async def send_audio(self, chunk):
        pass

    async def close(self):
        pass


class FakeEngine:
    def __init__(self, *a, **kw):
        pass

    def add_turn(self, speaker, text):
        pass

    def analyze_latest_turn(self, text):
        return {}

    async def generate_response_stream(self):
        for word in "Namaste this is Pearl calling".split():
            await asyncio.sleep(0.001)
            yield word + " "


def _recv(ws, timeout=5.0):
    async def _r():
        with anyio.fail_after(timeout):
            return await ws._send_rx.receive()

    message = ws.portal.call(_r)
    ws._raise_on_close(message)
    return json.loads(message["text"])


@pytest.fixture
def pipeline_client(fake_el, monkeypatch):
    monkeypatch.setattr(pearl, "SileroVADEngine", FakeVAD)
    monkeypatch.setattr(pearl, "GeminiStream", FakeSTT)
    monkeypatch.setattr(pearl, "ConversationEngine", FakeEngine)
    app = FastAPI()
    app.include_router(pearl.router)
    return TestClient(app)


def _make_user_and_agent(s):
    user = User(email=f"tts-{uuid.uuid4().hex[:10]}@example.test", password_hash="x", credit_balance=10.0)
    s.add(user)
    s.flush()
    agent = PearlAgent(user_id=user.id, name="Pearl", status="active")
    s.add(agent)
    s.flush()
    return user, agent


def test_browser_voice_test_gets_8k_pcm16_from_elevenlabs(pipeline_client, fake_el):
    with SessionLocal() as s:
        user, agent = _make_user_and_agent(s)
        sess = PearlTestSession(user_id=user.id, agent_id=agent.id, mode="voice", status="active",
                                agent_snapshot={"name": "Pearl", "voice_config": {"speaker": "shubh_enhi_ads"}})
        s.add(sess)
        s.commit()
        session_id, token = sess.id, create_access_token({"sub": str(user.id)})

    audio = []
    with pipeline_client.websocket_connect(f"/api/pearl/test-sessions/{session_id}/voice?token={token}") as ws:
        while True:
            msg = _recv(ws)
            if msg["type"] == "audio":
                audio.append(base64.b64decode(msg["data"]))
            elif msg["type"] == "tts_finished":
                break
        ws.send_text(json.dumps({"type": "stop"}))

    phrases = len(fake_el.requests)
    assert phrases >= 1 and all(r["output_format"] == "pcm_8000" for r in fake_el.requests)
    assert all(len(chunk) % 2 == 0 for chunk in audio)  # whole PCM16 samples for the browser's Int16Array
    assert b"".join(audio) == PHRASE_PCM * phrases       # exactly the 8 kHz PCM16 the API returned


def test_carrier_socket_sends_declared_l16_8k_frames_from_elevenlabs(pipeline_client, fake_el):
    with SessionLocal() as s:
        _, agent = _make_user_and_agent(s)
        call = PearlCall(agent_id=agent.id, provider="vobiz", status="initiating", provider_call_id="req-tts")
        s.add(call)
        s.commit()
        call_id = call.id

    frames = []
    with pipeline_client.websocket_connect(f"/api/pearl/calls/{call_id}/audio?token={carrier_token(call_id)}") as ws:
        ws.send_text(json.dumps({"event": "start", "start": {"streamId": "stream-1"}}))
        expected = None
        while True:
            msg = _recv(ws)
            if msg.get("event") != "playAudio":
                continue
            frames.append(msg)
            got = sum(len(base64.b64decode(f["media"]["payload"])) for f in frames)
            expected = len(PHRASE_PCM) * len(fake_el.requests)
            if fake_el.requests and got >= expected:
                break
        ws.send_text(json.dumps({"event": "stop"}))

    assert all(r["output_format"] == "pcm_8000" for r in fake_el.requests)
    for frame in frames:
        assert frame["media"]["contentType"] == "audio/x-l16" and frame["media"]["sampleRate"] == 8000
    payloads = [base64.b64decode(f["media"]["payload"]) for f in frames]
    assert all(len(p) >= 3200 and len(p) % 320 == 0 for p in payloads)  # 200 ms frames, 20 ms aligned
    joined = b"".join(payloads)
    assert joined[:expected] == PHRASE_PCM * len(fake_el.requests)       # the ElevenLabs PCM, unchanged
    assert set(joined[expected:]) <= {0}                                 # only end-of-turn padding after it
