"""Deepgram streaming STT for one channel: Flux (turn-based) first, nova-3 as fallback.

Flux (``wss://api.deepgram.com/v2/listen``) returns ``TurnInfo`` events (``Update``,
``StartOfTurn``, ``EagerEndOfTurn``, ``TurnResumed``, ``EndOfTurn``) with the turn's
transcript and audio-window times; the end-of-turn decision is the vendor's turn model,
so ``eot`` events are ``authoritative`` and the pipeline flushes at once. When Flux
can't be opened for the key (4xx on connect) the stream falls back to nova-3 on
``/v1/listen`` with interim results, endpointing and ``utterance_end_ms``.

Audio is raw PCM16LE 16 kHz. A ``KeepAlive`` text frame goes out every 5 s of silence
(Deepgram closes idle sockets after 10 s). Lost connections reconnect with backoff and
the same configuration; audio timestamps stay session-relative across reconnects.
The ``connector`` is injectable so tests use a fake socket; nothing here logs transcripts.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Awaitable, Callable, Optional
from urllib.parse import urlencode

from services.wizard import contracts as C

log = logging.getLogger("clozflow.stt")

FLUX_URL = "wss://api.deepgram.com/v2/listen"
NOVA_URL = "wss://api.deepgram.com/v1/listen"
DEFAULT_FLUX_EN = "flux-general-en"
DEFAULT_FLUX_MULTI = "flux-general-multi"
DEFAULT_FALLBACK = "nova-3"
BYTES_PER_SECOND = 32_000           # PCM16LE mono 16 kHz
KEEPALIVE_INTERVAL_S = 5.0
RECONNECT_DELAYS = (1.0, 2.0, 4.0, 8.0, 16.0)
MAX_KEYTERMS = 50
CLOSE_GRACE_S = 1.5

EventHandler = Callable[[C.SttEvent], Awaitable[None]]


def _env(name: str, default: str = "") -> str:
    return (os.getenv(name) or "").strip() or default


def _env_float(name: str, default: float) -> float:
    try:
        return float(_env(name) or default)
    except ValueError:
        return default


def model_for_channel(channel: int) -> str:
    if channel == C.CHANNEL_REP:
        return _env("CLOZFLOW_DEEPGRAM_MODEL_REP", DEFAULT_FLUX_EN)
    return _env("CLOZFLOW_DEEPGRAM_MODEL_PROSPECT", DEFAULT_FLUX_MULTI)


def fallback_model() -> str:
    return _env("CLOZFLOW_DEEPGRAM_FALLBACK_MODEL", DEFAULT_FALLBACK)


def eot_settings() -> dict:
    return {
        "eot_threshold": _env_float("CLOZFLOW_DEEPGRAM_EOT_THRESHOLD", 0.7),
        "eager_eot_threshold": _env_float("CLOZFLOW_DEEPGRAM_EAGER_EOT_THRESHOLD", 0.5),
        "eot_timeout_ms": int(_env_float("CLOZFLOW_DEEPGRAM_EOT_TIMEOUT_MS", 3000)),
    }


def clean_keyterms(keyterms) -> list[str]:
    out: list[str] = []
    for term in keyterms or ():
        text = " ".join(str(term).replace(",", " ").replace(";", " ").split())[:60]
        if text and text.lower() not in (t.lower() for t in out):
            out.append(text)
        if len(out) >= MAX_KEYTERMS:
            break
    return out


def build_url(model: str, *, flux: bool, keyterms=(), language_hints=(), eot_threshold: float = 0.7,
              eager_eot_threshold: Optional[float] = 0.5, eot_timeout_ms: int = 3000, language: Optional[str] = None) -> str:
    """The listen URL for one channel (pure; unit-tested)."""
    params: list[tuple[str, str]] = [("model", model), ("encoding", "linear16"), ("sample_rate", "16000")]
    if flux:
        eot = max(0.5, min(1.0, float(eot_threshold)))
        params.append(("eot_threshold", f"{eot:g}"))
        if eager_eot_threshold is not None:
            eager = max(0.3, min(0.9, min(float(eager_eot_threshold), eot)))
            params.append(("eager_eot_threshold", f"{eager:g}"))
        params.append(("eot_timeout_ms", str(max(500, min(60000, int(eot_timeout_ms))))))
        if model.endswith("multi"):
            params.extend(("language_hint", h) for h in language_hints or ())
    else:
        params.extend([("channels", "1"), ("interim_results", "true"), ("smart_format", "true"),
                       ("endpointing", "300"), ("utterance_end_ms", "1000"), ("vad_events", "true"),
                       ("language", language or ("multi" if model.endswith("3") else "en"))])
    params.extend(("keyterm", term) for term in clean_keyterms(keyterms))
    base = FLUX_URL if flux else NOVA_URL
    return f"{base}?{urlencode(params)}"


# ── message parsing (pure) ───────────────────────────────────────────────────

def _f(value) -> Optional[float]:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def parse_flux_message(data: dict, *, channel: int, offset_s: float = 0.0) -> list[C.SttEvent]:
    """Flux ``TurnInfo``/``Error`` → SttEvents (times shifted by ``offset_s`` for reconnects)."""
    kind = data.get("type")
    events: list[C.SttEvent] = []
    if kind == "TurnInfo":
        event = data.get("event")
        text = " ".join(str(data.get("transcript") or "").split())
        t_start = _f(data.get("audio_window_start"))
        t_end = _f(data.get("audio_window_end"))
        if t_start is not None:
            t_start = round(t_start + offset_s, 3)
        if t_end is not None:
            t_end = round(t_end + offset_s, 3)
        conf = _f(data.get("end_of_turn_confidence"))
        languages = data.get("languages") if isinstance(data.get("languages"), list) else None
        language = str(languages[0]) if languages else None
        base = {"channel": channel, "t_start": t_start, "t_end": t_end, "language": language, "eot_confidence": conf}
        if event in ("Update", "StartOfTurn"):
            if text:
                events.append(C.SttEvent(kind="partial", text=text, authoritative=False, **base))
        elif event == "EagerEndOfTurn":
            if text:
                events.append(C.SttEvent(kind="eager_eot", text=text, authoritative=False, **base))
        elif event == "TurnResumed":
            events.append(C.SttEvent(kind="resumed", text=text, authoritative=False, **base))
        elif event == "EndOfTurn":
            if text:
                events.append(C.SttEvent(kind="final", text=text, authoritative=True, **base))
            events.append(C.SttEvent(kind="eot", text=text, authoritative=True, **base))
    elif kind == "Error":
        events.append(C.SttEvent(kind="error", channel=channel, text="", authoritative=False,
                                 error=str(data.get("code") or data.get("description") or "deepgram_error")[:80]))
    return events


def parse_nova_message(data: dict, *, channel: int, offset_s: float = 0.0) -> list[C.SttEvent]:
    """nova-3 ``Results``/``UtteranceEnd``/``Error`` → SttEvents."""
    kind = data.get("type")
    events: list[C.SttEvent] = []
    if kind == "Results":
        alternatives = ((data.get("channel") or {}).get("alternatives") or [{}])
        text = " ".join(str(alternatives[0].get("transcript") or "").split())
        start = _f(data.get("start"))
        duration = _f(data.get("duration")) or 0.0
        t_start = round(start + offset_s, 3) if start is not None else None
        t_end = round(start + duration + offset_s, 3) if start is not None else None
        base = {"channel": channel, "t_start": t_start, "t_end": t_end, "confidence": _f(alternatives[0].get("confidence"))}
        if text and data.get("is_final"):
            events.append(C.SttEvent(kind="final", text=text, authoritative=False, **base))
        elif text:
            events.append(C.SttEvent(kind="partial", text=text, authoritative=False, **base))
        if data.get("speech_final"):
            events.append(C.SttEvent(kind="eot", text=text, authoritative=True, **base))
    elif kind == "UtteranceEnd":
        events.append(C.SttEvent(kind="eot", channel=channel, text="", authoritative=True,
                                 t_end=_f(data.get("last_word_end"))))
    elif kind == "Error":
        events.append(C.SttEvent(kind="error", channel=channel, text="", authoritative=False,
                                 error=str(data.get("code") or data.get("description") or "deepgram_error")[:80]))
    return events


# ── websocket connector ──────────────────────────────────────────────────────

async def default_connector(url: str, headers: dict):
    from websockets.asyncio.client import connect
    return await connect(url, additional_headers=headers, max_size=4 * 1024 * 1024, open_timeout=10, ping_interval=None)


def _status_code(exc: BaseException) -> Optional[int]:
    response = getattr(exc, "response", None)
    code = getattr(response, "status_code", None) or getattr(exc, "status_code", None)
    return int(code) if isinstance(code, int) else None


class DeepgramStream:
    """One channel. ``connect()`` → ``send_audio(pcm)`` … ``close()``; events via ``on_event`` and ``events()``."""
    vendor = "deepgram"

    def __init__(self, *, channel: int = C.CHANNEL_MIXED, api_key: Optional[str] = None, model: Optional[str] = None,
                 fallback: Optional[str] = None, keyterms=(), language_hints=("en", "hi"), on_event: Optional[EventHandler] = None,
                 connector: Optional[Callable[[str, dict], Awaitable[Any]]] = None, keepalive_interval: float = KEEPALIVE_INTERVAL_S,
                 reconnect_delays=RECONNECT_DELAYS, allow_fallback: bool = True, eot: Optional[dict] = None):
        self.channel = channel
        self.api_key = api_key if api_key is not None else _env("DEEPGRAM_API_KEY")
        self.model = model or model_for_channel(channel)
        self.fallback = (fallback if fallback is not None else fallback_model()) if allow_fallback else None
        self.keyterms = clean_keyterms(keyterms)
        self.language_hints = tuple(language_hints or ())
        self.on_event = on_event
        self.connector = connector or default_connector
        self.keepalive_interval = keepalive_interval
        self.reconnect_delays = tuple(reconnect_delays)
        self.eot = {**eot_settings(), **(eot or {})}
        self.flux = not self.model.startswith("nova")
        self.api_version = "v2" if self.flux else "v1"
        self.ws = None
        self.connected = False
        self.closed = False
        self.audio_seconds = 0.0             # audio sent over all connections
        self._connection_offset = 0.0        # audio seconds before the current connection
        self._events: asyncio.Queue = asyncio.Queue()
        self._receiver: Optional[asyncio.Task] = None
        self._keepalive: Optional[asyncio.Task] = None
        self._last_send = 0.0
        self.reconnects = 0

    # ── public ──

    def describe(self) -> dict:
        return {"vendor": self.vendor, "model": self.model, "api": self.api_version, "channel": self.channel}

    def url(self) -> str:
        return build_url(self.model, flux=self.flux, keyterms=self.keyterms, language_hints=self.language_hints,
                         eot_threshold=self.eot["eot_threshold"], eager_eot_threshold=self.eot.get("eager_eot_threshold"),
                         eot_timeout_ms=self.eot["eot_timeout_ms"],
                         language=None if self.channel != C.CHANNEL_REP else "en")

    async def connect(self) -> bool:
        if not self.api_key:
            return False
        if await self._open():
            return True
        if self.flux and self.fallback:
            log.info("deepgram flux unavailable for this key; falling back to %s", self.fallback)
            self.model, self.flux, self.api_version = self.fallback, False, "v1"
            return await self._open()
        return False

    async def _open(self) -> bool:
        headers = {"Authorization": f"Token {self.api_key}"}
        try:
            self.ws = await self.connector(self.url(), headers)
        except Exception as exc:  # noqa: BLE001
            code = _status_code(exc)
            log.info("deepgram connect failed (%s%s)", type(exc).__name__, f" {code}" if code else "")
            self.ws = None
            return False
        self.connected = True
        self._last_send = time.monotonic()
        self._receiver = asyncio.create_task(self._receive_loop(self.ws))
        if self.keepalive_interval and (self._keepalive is None or self._keepalive.done()):
            self._keepalive = asyncio.create_task(self._keepalive_loop())
        return True

    async def send_audio(self, chunk: bytes) -> None:
        if self.closed or not chunk:
            return
        self.audio_seconds += len(chunk) / BYTES_PER_SECOND
        ws = self.ws
        if ws is None or not self.connected:
            return                           # reconnecting: this audio is lost, as with every vendor
        try:
            await ws.send(chunk)
            self._last_send = time.monotonic()
        except Exception:  # noqa: BLE001 - the receive loop notices the dead socket
            pass

    async def close(self) -> None:
        self.closed = True
        if self._keepalive is not None:
            self._keepalive.cancel()
        ws, self.ws = self.ws, None
        if ws is not None:
            try:
                await ws.send(json.dumps({"type": "CloseStream"}))
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
        """``async for event in stream.events()`` until the stream closes."""
        while True:
            item = await self._events.get()
            if item is None:
                return
            yield item

    # ── internals ──

    async def _dispatch(self, event: C.SttEvent) -> None:
        self._events.put_nowait(event)
        if self.on_event is not None:
            try:
                await self.on_event(event)
            except Exception as exc:  # noqa: BLE001
                log.warning("stt event handler failed (%s)", type(exc).__name__)

    def _parse(self, raw) -> list[C.SttEvent]:
        if isinstance(raw, (bytes, bytearray)):
            return []
        try:
            data = json.loads(raw)
        except (TypeError, ValueError):
            return []
        if not isinstance(data, dict):
            return []
        parser = parse_flux_message if self.flux else parse_nova_message
        return parser(data, channel=self.channel, offset_s=self._connection_offset)

    async def _receive_loop(self, ws) -> None:
        fatal = False
        try:
            async for raw in ws:
                for event in self._parse(raw):
                    if event["kind"] == "error":
                        fatal = True
                    await self._dispatch(event)
        except asyncio.CancelledError:
            return
        except Exception as exc:  # noqa: BLE001 - connection dropped
            log.info("deepgram socket closed (%s)", type(exc).__name__)
        self.connected = False
        if self.closed:
            return
        if fatal and self.flux and self.fallback and self.reconnects == 0:
            self.model, self.flux, self.api_version = self.fallback, False, "v1"
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
                log.info("deepgram reconnected (attempt %s)", self.reconnects)
                return
        log.warning("deepgram reconnect gave up after %s attempts", len(self.reconnect_delays))
        await self._dispatch(C.SttEvent(kind="error", channel=self.channel, text="", authoritative=False, error="reconnect_failed"))

    async def _keepalive_loop(self) -> None:
        try:
            while not self.closed:
                await asyncio.sleep(self.keepalive_interval)
                ws = self.ws
                if ws is None or not self.connected:
                    continue
                if time.monotonic() - self._last_send >= self.keepalive_interval - 0.1:
                    try:
                        await ws.send(json.dumps({"type": "KeepAlive"}))
                        self._last_send = time.monotonic()
                    except Exception:  # noqa: BLE001
                        pass
        except asyncio.CancelledError:
            pass
