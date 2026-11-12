"""Streaming-STT router: picks the vendor per environment and wraps every vendor in one interface.

``CLOZFLOW_STT=auto|deepgram|gemini|sarvam``. ``auto`` = deepgram if ``DEEPGRAM_API_KEY`` else
gemini if ``GEMINI_API_KEY`` else sarvam if ``SARVAM_API_KEY`` else nothing (the pipeline then
reports ``stt_unavailable`` as before). One stream per channel; every stream exposes
``connect() -> bool``, ``send_audio(pcm16le_16k)``, ``close()``, ``events()`` (async iterator of
``contracts.SttEvent``) and calls ``on_event`` for each event. ``describe()`` feeds
``GET /api/wizard/preflight``.

``create_stream_for_track`` adapts the events to the legacy ``TrackPipeline`` callback
``transcript_callback(speaker, text, is_final=..., speech_final=...)`` and still forwards every
event to ``on_event`` (end-of-turn, eager end-of-turn, turn resumed) so the pipeline can act on them.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Awaitable, Callable, Optional

from services.wizard import contracts as C
from services.wizard.stt_deepgram import DeepgramStream, model_for_channel
from services.wizard.stt_sarvam import SarvamStream, sarvam_model

log = logging.getLogger("clozflow.stt")

VENDORS = ("deepgram", "gemini", "sarvam")
GEMINI_MODEL = "gemini-3.5-transcribe-live"
EventHandler = Callable[[C.SttEvent], Awaitable[None]]


def _env(name: str) -> str:
    return (os.getenv(name) or "").strip()


def configured_vendor() -> str:
    value = _env("CLOZFLOW_STT").lower() or "auto"
    return value if value in VENDORS + ("auto",) else "auto"


def key_for(vendor: str) -> str:
    return {"deepgram": _env("DEEPGRAM_API_KEY"), "gemini": _env("GEMINI_API_KEY"), "sarvam": _env("SARVAM_API_KEY")}.get(vendor, "")


def select_vendor() -> Optional[str]:
    """The vendor to use now, or None when no usable key exists."""
    wanted = configured_vendor()
    if wanted != "auto":
        return wanted if key_for(wanted) else None
    for vendor in VENDORS:
        if key_for(vendor):
            return vendor
    return None


def describe() -> dict:
    """``{vendor, model, ready, reason?, configured}`` for the pre-flight check (no network)."""
    vendor = select_vendor()
    configured = configured_vendor()
    if vendor is None:
        if configured != "auto":
            reason = f"CLOZFLOW_STT={configured} but its API key is empty."
        else:
            reason = "No speech-to-text key configured (DEEPGRAM_API_KEY, GEMINI_API_KEY or SARVAM_API_KEY)."
        return {"vendor": None, "model": None, "ready": False, "reason": reason, "configured": configured}
    model = {"deepgram": f"{model_for_channel(C.CHANNEL_REP)} / {model_for_channel(C.CHANNEL_PROSPECT)}",
             "gemini": GEMINI_MODEL, "sarvam": sarvam_model()}[vendor]
    return {"vendor": vendor, "model": model, "ready": True, "configured": configured}


# ── Gemini adapter (today's GeminiStream, speaking SttEvent) ────────────────

class GeminiSttStream:
    vendor = "gemini"
    model = GEMINI_MODEL

    def __init__(self, *, channel: int = C.CHANNEL_MIXED, on_event: Optional[EventHandler] = None, inner=None):
        self.channel = channel
        self.on_event = on_event
        self._events: asyncio.Queue = asyncio.Queue()
        self.audio_seconds = 0.0
        self.closed = False
        if inner is None:
            from services.gemini_stream import GeminiStream
            inner = GeminiStream(transcript_callback=self._callback)
        self._inner = inner

    def describe(self) -> dict:
        return {"vendor": self.vendor, "model": self.model, "channel": self.channel}

    async def _callback(self, _speaker, text, is_final=True, speech_final=False):
        text = " ".join((text or "").split())
        t_end = round(self.audio_seconds, 3)
        if text and is_final:
            await self._dispatch(C.SttEvent(kind="final", channel=self.channel, text=text, authoritative=False, t_end=t_end))
        elif text:
            await self._dispatch(C.SttEvent(kind="partial", channel=self.channel, text=text, authoritative=False, t_end=t_end))
        if speech_final:
            # Gemini's turn_complete is the Live API's turn, not a semantic end-of-turn: the
            # TurnDetector's adaptive silence window still decides (authoritative=False).
            await self._dispatch(C.SttEvent(kind="eot", channel=self.channel, text="", authoritative=False, t_end=t_end))

    async def _dispatch(self, event: C.SttEvent) -> None:
        self._events.put_nowait(event)
        if self.on_event is not None:
            try:
                await self.on_event(event)
            except Exception as exc:  # noqa: BLE001
                log.warning("stt event handler failed (%s)", type(exc).__name__)

    async def connect(self) -> bool:
        return bool(await self._inner.connect())

    async def send_audio(self, chunk: bytes) -> None:
        self.audio_seconds += len(chunk) / 32_000
        await self._inner.send_audio(chunk)

    async def close(self) -> None:
        self.closed = True
        try:
            await self._inner.close()
        finally:
            await self._events.put(None)

    async def events(self):
        while True:
            item = await self._events.get()
            if item is None:
                return
            yield item


# ── factories ────────────────────────────────────────────────────────────────

def create_stream(channel: int, *, on_event: Optional[EventHandler] = None, keyterms=(), language_hint: Optional[str] = None,
                  vendor: Optional[str] = None):
    """A vendor stream for ``channel`` (raises ``RuntimeError('stt_unavailable')`` when nothing is configured)."""
    vendor = vendor or select_vendor()
    if vendor is None:
        raise RuntimeError("stt_unavailable")
    if vendor == "deepgram":
        hints = ("en",) if channel == C.CHANNEL_REP else _hints(language_hint)
        return DeepgramStream(channel=channel, keyterms=keyterms, language_hints=hints, on_event=on_event)
    if vendor == "sarvam":
        return SarvamStream(channel=channel, keyterms=keyterms, on_event=on_event,
                            language_code="en-IN" if channel == C.CHANNEL_REP else "auto")
    return GeminiSttStream(channel=channel, on_event=on_event)


def _hints(language_hint: Optional[str]) -> tuple[str, ...]:
    hint = (language_hint or "").lower()
    if hint.startswith("hi"):
        return ("hi", "en")
    if hint.startswith("en") and "hing" not in hint:
        return ("en", "hi")
    return ("en", "hi")


class _TrackAdapter:
    """Maps SttEvents to the legacy TrackPipeline callback and forwards every event."""

    def __init__(self, transcript_callback, on_event: Optional[EventHandler]):
        self.transcript_callback = transcript_callback
        self.on_event = on_event

    async def __call__(self, event: C.SttEvent) -> None:
        kind = event.get("kind")
        meta = {"t_start": event.get("t_start"), "t_end": event.get("t_end")}
        if kind == "eot" and self.on_event is not None:
            await self.on_event(event)          # the pipeline flushes first; speech_final below is then a no-op
        if kind == "partial" and event.get("text"):
            await self._legacy(event["text"], is_final=False, speech_final=False, **meta)
        elif kind == "final" and event.get("text"):
            await self._legacy(event["text"], is_final=True, speech_final=False, **meta)
        elif kind == "eot":
            await self._legacy("", is_final=False, speech_final=True, **meta)
        if kind != "eot" and self.on_event is not None:
            await self.on_event(event)

    async def _legacy(self, text: str, **kwargs) -> None:
        try:
            await self.transcript_callback("prospect", text, **kwargs)
        except TypeError:
            # An older callback without the timing keywords.
            await self.transcript_callback("prospect", text, is_final=kwargs.get("is_final", True),
                                           speech_final=kwargs.get("speech_final", False))


def create_stream_for_track(transcript_callback, *, channel: int = C.CHANNEL_MIXED, keyterms=(), language_hint: Optional[str] = None,
                            on_event: Optional[EventHandler] = None, vendor: Optional[str] = None):
    adapter = _TrackAdapter(transcript_callback, on_event)
    return create_stream(channel, on_event=adapter, keyterms=keyterms, language_hint=language_hint, vendor=vendor)
