"""Sarvam realtime STT (``saaras:v3-realtime``) for one channel, codemix output.

Protocol (docs.sarvam.ai, realtime WS reference): ``wss://api.sarvam.ai/speech-to-text-realtime/ws``
with query parameters (``language_code``, ``model``, ``mode``, ``stream_type``, ``encoding``,
``sample_rate``, ``endpointing``, ``return_timestamps``, ``keyterms``) and the header
``API-SUBSCRIPTION-KEY``. The client sends ``{"event":"audio_input","audio":"<base64>"}`` and
``{"event":"ping"}``; the server sends ``transcript.partial`` / ``transcript.final`` (``text``,
``language``, ``start_s``/``end_s``), ``vad.speech_start`` / ``vad.speech_end`` and ``error``
(``is_fatal``). Close codes 1003/4000 (quota, key, bad config) are not retried; 1001/1006/1011
reconnect with backoff. Partials drive the UI; ``transcript.final`` is a final + an
authoritative ``eot``. The ``connector`` is injectable for tests; transcripts are never logged.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import time
from typing import Any, Awaitable, Callable, Optional
from urllib.parse import urlencode

from services.wizard import contracts as C

log = logging.getLogger("clozflow.stt")

SARVAM_URL = "wss://api.sarvam.ai/speech-to-text-realtime/ws"
DEFAULT_MODEL = "saaras:v3-realtime"
DEFAULT_MODE = "codemix"
BYTES_PER_SECOND = 32_000
PING_INTERVAL_S = 10.0
RECONNECT_DELAYS = (1.0, 2.0, 4.0, 8.0)
NO_RETRY_CODES = {1003, 4000}
MAX_KEYTERMS = 50
CLOSE_GRACE_S = 1.5

EventHandler = Callable[[C.SttEvent], Awaitable[None]]


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or "").strip() or default


def sarvam_model() -> str:
    return _env("CLOZFLOW_SARVAM_MODEL", DEFAULT_MODEL)


def sarvam_mode() -> str:
    return _env("CLOZFLOW_SARVAM_MODE", DEFAULT_MODE)


def build_url(model: str, *, mode: str = DEFAULT_MODE, language_code: str = "auto", keyterms=(),
              stream_type: str = "fast", return_timestamps: bool = True) -> str:
    params: list[tuple[str, str]] = [
        ("language_code", language_code), ("model", model), ("mode", mode), ("stream_type", stream_type),
        ("encoding", "linear16"), ("sample_rate", "16000"), ("endpointing", "vad"),
        ("return_timestamps", "true" if return_timestamps else "false"),
    ]
    terms = []
    for term in keyterms or ():
        text = " ".join(str(term).replace(",", " ").split())[:64]
        if text and text not in terms:
            terms.append(text)
        if len(terms) >= MAX_KEYTERMS:
            break
    if terms:
        params.append(("keyterms", ",".join(terms)))
    return f"{SARVAM_URL}?{urlencode(params)}"


def _f(value) -> Optional[float]:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def parse_message(data: dict, *, channel: int, offset_s: float = 0.0, fallback_t: Optional[float] = None) -> list[C.SttEvent]:
    """Sarvam server event → SttEvents (pure)."""
    event = data.get("event")
    events: list[C.SttEvent] = []
    text = " ".join(str(data.get("text") or "").split())
    language = data.get("language")
    if event == "transcript.partial":
        if text:
            events.append(C.SttEvent(kind="partial", channel=channel, text=text, language=language, authoritative=False,
                                     t_start=None, t_end=fallback_t))
    elif event == "transcript.final":
        t_start = _f(data.get("start_s"))
        t_end = _f(data.get("end_s"))
        t_start = round(t_start + offset_s, 3) if t_start is not None else None
        t_end = round(t_end + offset_s, 3) if t_end is not None else fallback_t
        if text:
            events.append(C.SttEvent(kind="final", channel=channel, text=text, language=language, authoritative=True,
                                     t_start=t_start, t_end=t_end, confidence=_f(data.get("language_confidence"))))
        events.append(C.SttEvent(kind="eot", channel=channel, text=text, language=language, authoritative=True,
                                 t_start=t_start, t_end=t_end))
    elif event == "error":
        events.append(C.SttEvent(kind="error", channel=channel, text="", authoritative=False,
                                 error=str(data.get("code") or data.get("message") or "sarvam_error")[:80]))
    return events


async def default_connector(url: str, headers: dict):
    from websockets.asyncio.client import connect
    return await connect(url, additional_headers=headers, max_size=4 * 1024 * 1024, open_timeout=10, ping_interval=None)


def _close_code(exc: BaseException) -> Optional[int]:
    for attr in ("code",):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value
    rcvd = getattr(exc, "rcvd", None)
    code = getattr(rcvd, "code", None)
    return int(code) if isinstance(code, int) else None


class SarvamStream:
    vendor = "sarvam"

    def __init__(self, *, channel: int = C.CHANNEL_MIXED, api_key: Optional[str] = None, model: Optional[str] = None,
                 mode: Optional[str] = None, keyterms=(), language_code: str = "auto", on_event: Optional[EventHandler] = None,
                 connector: Optional[Callable[[str, dict], Awaitable[Any]]] = None, ping_interval: float = PING_INTERVAL_S,
                 reconnect_delays=RECONNECT_DELAYS):
        self.channel = channel
        self.api_key = api_key if api_key is not None else _env("SARVAM_API_KEY")
        self.model = model or sarvam_model()
        self.mode = mode or sarvam_mode()
        self.language_code = language_code
        self.keyterms = list(keyterms or ())
        self.on_event = on_event
        self.connector = connector or default_connector
        self.ping_interval = ping_interval
        self.reconnect_delays = tuple(reconnect_delays)
        self.ws = None
        self.connected = False
        self.closed = False
        self.audio_seconds = 0.0
        self._connection_offset = 0.0
        self._events: asyncio.Queue = asyncio.Queue()
        self._receiver: Optional[asyncio.Task] = None
        self._pinger: Optional[asyncio.Task] = None
        self._last_send = 0.0
        self.reconnects = 0

    def describe(self) -> dict:
        return {"vendor": self.vendor, "model": self.model, "mode": self.mode, "channel": self.channel}

    def url(self) -> str:
        return build_url(self.model, mode=self.mode, language_code=self.language_code, keyterms=self.keyterms)

    async def connect(self) -> bool:
        if not self.api_key:
            return False
        return await self._open()

    async def _open(self) -> bool:
        try:
            self.ws = await self.connector(self.url(), {"API-SUBSCRIPTION-KEY": self.api_key})
        except Exception as exc:  # noqa: BLE001
            log.info("sarvam connect failed (%s)", type(exc).__name__)
            self.ws = None
            return False
        self.connected = True
        self._last_send = time.monotonic()
        self._receiver = asyncio.create_task(self._receive_loop(self.ws))
        if self.ping_interval and (self._pinger is None or self._pinger.done()):
            self._pinger = asyncio.create_task(self._ping_loop())
        return True

    async def send_audio(self, chunk: bytes) -> None:
        if self.closed or not chunk:
            return
        self.audio_seconds += len(chunk) / BYTES_PER_SECOND
        ws = self.ws
        if ws is None or not self.connected:
            return
        try:
            await ws.send(json.dumps({"event": "audio_input", "audio": base64.b64encode(chunk).decode("ascii")}))
            self._last_send = time.monotonic()
        except Exception:  # noqa: BLE001
            pass

    async def close(self) -> None:
        self.closed = True
        if self._pinger is not None:
            self._pinger.cancel()
        ws, self.ws = self.ws, None
        if ws is not None:
            try:
                await ws.send(json.dumps({"event": "end"}))
            except Exception:  # noqa: BLE001
                pass
            if self._receiver is not None:
                try:
                    await asyncio.wait_for(asyncio.shield(self._receiver), CLOSE_GRACE_S)
                except Exception:  # noqa: BLE001
                    self._receiver.cancel()
            try:
                await ws.close()
            except Exception:  # noqa: BLE001
                pass
        elif self._receiver is not None:
            self._receiver.cancel()
        self.connected = False
        await self._events.put(None)

    async def events(self):
        while True:
            item = await self._events.get()
            if item is None:
                return
            yield item

    async def _dispatch(self, event: C.SttEvent) -> None:
        self._events.put_nowait(event)
        if self.on_event is not None:
            try:
                await self.on_event(event)
            except Exception as exc:  # noqa: BLE001
                log.warning("stt event handler failed (%s)", type(exc).__name__)

    async def _receive_loop(self, ws) -> None:
        fatal = False
        close_code: Optional[int] = None
        try:
            async for raw in ws:
                if isinstance(raw, (bytes, bytearray)):
                    continue
                try:
                    data = json.loads(raw)
                except ValueError:
                    continue
                if not isinstance(data, dict):
                    continue
                for event in parse_message(data, channel=self.channel, offset_s=self._connection_offset,
                                           fallback_t=round(self.audio_seconds, 3)):
                    if event["kind"] == "error" and data.get("is_fatal"):
                        fatal = True
                        close_code = data.get("status_code") if isinstance(data.get("status_code"), int) else None
                    await self._dispatch(event)
        except asyncio.CancelledError:
            return
        except Exception as exc:  # noqa: BLE001
            close_code = _close_code(exc)
            log.info("sarvam socket closed (%s%s)", type(exc).__name__, f" {close_code}" if close_code else "")
        self.connected = False
        if self.closed:
            return
        if close_code in NO_RETRY_CODES or (fatal and close_code in (401, 402, 403)):
            await self._dispatch(C.SttEvent(kind="error", channel=self.channel, text="", authoritative=False, error="not_retryable"))
            return
        await self._reconnect()

    async def _reconnect(self) -> None:
        for delay in self.reconnect_delays:
            if self.closed:
                return
            await asyncio.sleep(delay)
            if self.closed:
                return
            self.reconnects += 1
            self._connection_offset = self.audio_seconds
            if await self._open():
                log.info("sarvam reconnected (attempt %s)", self.reconnects)
                return
        await self._dispatch(C.SttEvent(kind="error", channel=self.channel, text="", authoritative=False, error="reconnect_failed"))

    async def _ping_loop(self) -> None:
        try:
            while not self.closed:
                await asyncio.sleep(self.ping_interval)
                ws = self.ws
                if ws is None or not self.connected:
                    continue
                if time.monotonic() - self._last_send >= self.ping_interval - 0.1:
                    try:
                        await ws.send(json.dumps({"event": "ping"}))
                        self._last_send = time.monotonic()
                    except Exception:  # noqa: BLE001
                        pass
        except asyncio.CancelledError:
            pass
