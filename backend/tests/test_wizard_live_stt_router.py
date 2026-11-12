"""STT router: vendor selection by environment, Flux/nova/Sarvam message parsing with fake
sockets (no network), fallback from Flux to nova-3, keep-alive, and the Gemini adapter."""
import asyncio
import json

import pytest

import test_bridge_kit  # noqa: F401  (test environment first: no .env, fake keys)
from services.wizard import contracts as C
from services.wizard import stt_router
from services.wizard.stt_deepgram import DeepgramStream, build_url, parse_flux_message
from services.wizard.stt_sarvam import SarvamStream, build_url as sarvam_url, parse_message as parse_sarvam


@pytest.fixture
def env(monkeypatch):
    for name in ("CLOZFLOW_STT", "DEEPGRAM_API_KEY", "GEMINI_API_KEY", "SARVAM_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


def test_vendor_selection_by_env(env):
    assert stt_router.select_vendor() is None
    assert stt_router.describe()["ready"] is False and "DEEPGRAM_API_KEY" in stt_router.describe()["reason"]
    env.setenv("SARVAM_API_KEY", "s")
    assert stt_router.select_vendor() == "sarvam"
    env.setenv("GEMINI_API_KEY", "g")
    assert stt_router.select_vendor() == "gemini"
    env.setenv("DEEPGRAM_API_KEY", "d")
    assert stt_router.select_vendor() == "deepgram"
    assert stt_router.describe() == {"vendor": "deepgram", "model": "flux-general-en / flux-general-multi", "ready": True, "configured": "auto"}
    env.setenv("CLOZFLOW_STT", "sarvam")
    assert stt_router.select_vendor() == "sarvam" and stt_router.describe()["model"] == "saaras:v3-realtime"
    env.setenv("CLOZFLOW_STT", "gemini")
    env.delenv("GEMINI_API_KEY")
    assert stt_router.select_vendor() is None and "CLOZFLOW_STT=gemini" in stt_router.describe()["reason"]
    with pytest.raises(RuntimeError, match="stt_unavailable"):
        stt_router.create_stream(C.CHANNEL_PROSPECT)


def test_deepgram_urls_per_channel():
    rep = build_url("flux-general-en", flux=True, keyterms=["ClozFlow", "Acme Bakery", "ClozFlow", "a,b"],
                    eot_threshold=0.7, eager_eot_threshold=0.5, eot_timeout_ms=3000)
    assert rep.startswith("wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000")
    assert "eot_threshold=0.7" in rep and "eager_eot_threshold=0.5" in rep and "eot_timeout_ms=3000" in rep
    assert rep.count("keyterm=") == 3 and "language_hint" not in rep and "keyterm=a+b" in rep
    multi = build_url("flux-general-multi", flux=True, language_hints=("en", "hi"), eager_eot_threshold=0.9, eot_threshold=0.6)
    assert "language_hint=en&language_hint=hi" in multi and "eager_eot_threshold=0.6" in multi   # eager ≤ eot
    nova = build_url("nova-3", flux=False, keyterms=["ClozFlow"])
    assert nova.startswith("wss://api.deepgram.com/v1/listen?model=nova-3")
    assert "interim_results=true" in nova and "endpointing=300" in nova and "utterance_end_ms=1000" in nova and "language=multi" in nova


def test_parse_flux_events_including_turn_resumed():
    update = {"type": "TurnInfo", "event": "Update", "turn_index": 1, "audio_window_start": "1.2", "audio_window_end": 2.8,
              "transcript": "That sounds", "end_of_turn_confidence": 0.1, "languages": ["en"]}
    assert parse_flux_message(update, channel=2) == [
        {"kind": "partial", "text": "That sounds", "channel": 2, "t_start": 1.2, "t_end": 2.8, "language": "en",
         "eot_confidence": 0.1, "authoritative": False}]
    eager = parse_flux_message({**update, "event": "EagerEndOfTurn", "transcript": "That sounds expensive"}, channel=2)
    assert eager[0]["kind"] == "eager_eot" and eager[0]["text"] == "That sounds expensive"
    resumed = parse_flux_message({**update, "event": "TurnResumed", "transcript": "That sounds expensive but"}, channel=2)
    assert resumed[0]["kind"] == "resumed"
    end = parse_flux_message({**update, "event": "EndOfTurn", "transcript": "That sounds expensive but okay.",
                              "end_of_turn_confidence": 0.93, "trigger": "model"}, channel=2, offset_s=100.0)
    assert [e["kind"] for e in end] == ["final", "eot"] and all(e["authoritative"] for e in end)
    assert end[0]["t_start"] == 101.2 and end[0]["t_end"] == 102.8 and end[1]["eot_confidence"] == 0.93
    assert parse_flux_message({"type": "Connected", "request_id": "r"}, channel=2) == []
    assert parse_flux_message({"type": "Error", "code": "BAD", "description": "x"}, channel=2)[0]["error"] == "BAD"


class FakeSocket:
    """A websocket that replays scripted server messages after the first audio frame."""

    def __init__(self, script, *, fail_connect=None):
        self.script = list(script)
        self.sent = []
        self.closed = False
        self._queue = asyncio.Queue()
        self._started = False
        self.fail_connect = fail_connect

    async def send(self, data):
        self.sent.append(data)
        is_audio = isinstance(data, (bytes, bytearray)) or (isinstance(data, str) and "audio_input" in data)
        if is_audio and not self._started:
            self._started = True
            for item in self.script:
                await self._queue.put(item)

    async def close(self):
        self.closed = True
        await self._queue.put(None)

    def __aiter__(self):
        return self

    async def __anext__(self):
        item = await self._queue.get()
        if item is None:
            raise StopAsyncIteration
        return item


class FluxNotEnabled(Exception):
    def __init__(self):
        super().__init__("HTTP 400")
        self.status_code = 400


def _run(coro):
    return asyncio.run(coro)


def test_fake_deepgram_flux_stream_events_and_keepalive():
    script = [json.dumps({"type": "Connected", "request_id": "r1", "sequence_id": 0}),
              json.dumps({"type": "TurnInfo", "event": "Update", "transcript": "kitna", "audio_window_start": 0.0, "audio_window_end": 0.5}),
              json.dumps({"type": "TurnInfo", "event": "EagerEndOfTurn", "transcript": "kitna padega", "audio_window_start": 0.0, "audio_window_end": 1.0}),
              json.dumps({"type": "TurnInfo", "event": "TurnResumed", "transcript": "kitna padega", "audio_window_start": 0.0, "audio_window_end": 1.2}),
              json.dumps({"type": "TurnInfo", "event": "EndOfTurn", "transcript": "kitna padega yeh?", "audio_window_start": 0.0,
                          "audio_window_end": 1.9, "end_of_turn_confidence": 0.9})]
    sockets = []

    async def connector(url, headers):
        assert headers == {"Authorization": "Token dg-key"} and url.startswith("wss://api.deepgram.com/v2/listen?model=flux-general-multi")
        socket = FakeSocket(script)
        sockets.append(socket)
        return socket

    async def run():
        seen = []

        async def on_event(event):
            seen.append(event)
        stream = DeepgramStream(channel=C.CHANNEL_PROSPECT, api_key="dg-key", on_event=on_event, connector=connector,
                                keepalive_interval=0.05, keyterms=["ClozFlow"])
        assert await stream.connect() is True and stream.flux is True
        await stream.send_audio(b"\x00" * 3200)
        await asyncio.sleep(0.2)
        collected = []
        async def drain():
            async for event in stream.events():
                collected.append(event)
        drain_task = asyncio.create_task(drain())
        await stream.close()
        await asyncio.wait_for(drain_task, 2)
        return stream, seen, collected

    stream, seen, collected = _run(run())
    assert [e["kind"] for e in seen] == ["partial", "eager_eot", "resumed", "final", "eot"]
    assert seen[3]["text"] == "kitna padega yeh?" and seen[3]["t_end"] == 1.9 and seen[4]["authoritative"] is True
    assert [e["kind"] for e in collected] == [e["kind"] for e in seen]
    socket = sockets[0]
    assert any(isinstance(m, str) and json.loads(m) == {"type": "KeepAlive"} for m in socket.sent)
    assert json.loads(socket.sent[-1]) == {"type": "CloseStream"} and socket.closed
    assert stream.audio_seconds == pytest.approx(0.1)


def test_flux_falls_back_to_nova_when_not_enabled():
    urls = []
    nova_script = [json.dumps({"type": "Results", "is_final": False, "speech_final": False, "start": 0.0, "duration": 0.4,
                               "channel": {"alternatives": [{"transcript": "hello", "confidence": 0.5}]}}),
                   json.dumps({"type": "Results", "is_final": True, "speech_final": True, "start": 0.0, "duration": 1.1,
                               "channel": {"alternatives": [{"transcript": "hello there", "confidence": 0.9}]}}),
                   json.dumps({"type": "UtteranceEnd", "last_word_end": 1.1})]

    async def connector(url, headers):
        urls.append(url)
        if "/v2/listen" in url:
            raise FluxNotEnabled()
        return FakeSocket(nova_script)

    async def run():
        seen = []

        async def on_event(event):
            seen.append(event)
        stream = DeepgramStream(channel=C.CHANNEL_REP, api_key="k", on_event=on_event, connector=connector, keepalive_interval=0)
        assert await stream.connect() is True
        await stream.send_audio(b"\x00" * 640)
        await asyncio.sleep(0.1)
        await stream.close()
        return stream, seen

    stream, seen = _run(run())
    assert stream.model == "nova-3" and stream.api_version == "v1" and not stream.flux
    assert urls[0].startswith("wss://api.deepgram.com/v2/listen?model=flux-general-en")
    assert urls[1].startswith("wss://api.deepgram.com/v1/listen?model=nova-3") and "language=en" in urls[1]
    assert [e["kind"] for e in seen] == ["partial", "final", "eot", "eot"]
    assert seen[1]["text"] == "hello there" and seen[1]["t_end"] == 1.1 and seen[2]["authoritative"] is True


def test_deepgram_without_key_does_not_connect():
    async def run():
        stream = DeepgramStream(channel=0, api_key="", connector=lambda url, headers: (_ for _ in ()).throw(AssertionError("no")))
        return await stream.connect()
    assert _run(run()) is False


def test_sarvam_url_parse_and_fake_stream():
    url = sarvam_url("saaras:v3-realtime", mode="codemix", keyterms=["ClozFlow", "Tally"])
    assert url.startswith("wss://api.sarvam.ai/speech-to-text-realtime/ws?language_code=auto&model=saaras%3Av3-realtime&mode=codemix")
    assert "encoding=linear16" in url and "sample_rate=16000" in url and "keyterms=ClozFlow%2CTally" in url
    final = parse_sarvam({"event": "transcript.final", "text": "haan theek hai", "language": "hi-IN", "start_s": "0.5", "end_s": "2.1"},
                         channel=2, offset_s=10.0)
    assert [e["kind"] for e in final] == ["final", "eot"] and final[0]["t_start"] == 10.5 and final[0]["t_end"] == 12.1
    assert final[0]["authoritative"] is True and final[0]["language"] == "hi-IN"
    assert parse_sarvam({"event": "transcript.partial", "text": "haan"}, channel=2, fallback_t=3.0)[0] == {
        "kind": "partial", "channel": 2, "text": "haan", "language": None, "authoritative": False, "t_start": None, "t_end": 3.0}
    assert parse_sarvam({"event": "vad.speech_start"}, channel=2) == []
    script = [json.dumps({"event": "session.begin", "request_id": "x"}),
              json.dumps({"event": "transcript.partial", "text": "yeh bahut"}),
              json.dumps({"event": "transcript.final", "text": "yeh bahut mehenga hai", "start_s": "0.1", "end_s": "1.4"})]
    sockets = []

    async def connector(url, headers):
        assert headers == {"API-SUBSCRIPTION-KEY": "sv-key"}
        socket = FakeSocket(script)
        sockets.append(socket)
        return socket

    async def run():
        seen = []

        async def on_event(event):
            seen.append(event)
        stream = SarvamStream(channel=C.CHANNEL_PROSPECT, api_key="sv-key", on_event=on_event, connector=connector, ping_interval=0)
        assert await stream.connect()
        await stream.send_audio(b"\x01\x00" * 160)
        await asyncio.sleep(0.1)
        await stream.close()
        return seen

    seen = _run(run())
    assert [e["kind"] for e in seen] == ["partial", "final", "eot"] and seen[1]["text"] == "yeh bahut mehenga hai"
    first = json.loads(sockets[0].sent[0])
    assert first["event"] == "audio_input" and first["audio"]
    assert json.loads(sockets[0].sent[-1]) == {"event": "end"}


def test_gemini_adapter_and_track_adapter_mapping():
    class InnerGemini:
        def __init__(self):
            self.callback = None
            self.chunks = []

        async def connect(self):
            return True

        async def send_audio(self, chunk):
            self.chunks.append(chunk)

        async def close(self):
            pass

    async def run():
        legacy_calls = []
        events = []

        async def legacy(speaker, text, is_final=True, speech_final=False, **meta):
            legacy_calls.append((speaker, text, is_final, speech_final, meta.get("t_end")))

        async def on_event(event):
            events.append(event["kind"])
        inner = InnerGemini()
        adapter = stt_router._TrackAdapter(legacy, on_event)
        stream = stt_router.GeminiSttStream(channel=0, on_event=adapter, inner=inner)
        inner.callback = stream._callback
        assert await stream.connect()
        await stream.send_audio(b"\x00" * 32000)
        await inner.callback("prospect", "Hello there", is_final=True, speech_final=True)
        await inner.callback("prospect", "", is_final=False, speech_final=True)
        await stream.close()
        return legacy_calls, events, stream.describe()

    legacy_calls, events, described = _run(run())
    assert legacy_calls == [("prospect", "Hello there", True, False, 1.0), ("prospect", "", False, True, 1.0), ("prospect", "", False, True, 1.0)]
    assert events == ["final", "eot", "eot"]
    assert described == {"vendor": "gemini", "model": "gemini-3.5-transcribe-live", "channel": 0}
