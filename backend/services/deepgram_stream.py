"""Deepgram streaming STT (compatibility shim).

The real implementation lives in ``services.wizard.stt_deepgram`` (Flux turn-based
models with a nova-3 fallback, keyterms, KeepAlive, reconnects) and is selected by
``services.wizard.stt_router``. ``DeepgramStream`` here keeps the historical
``DeepgramStream(transcript_callback)`` constructor for older imports: it is the
channel-0 router stream adapted to the legacy callback.
"""
from __future__ import annotations

from services.wizard.stt_deepgram import DeepgramStream as _DeepgramStream, build_url, parse_flux_message, parse_nova_message
from services.wizard.stt_router import _TrackAdapter

__all__ = ["DeepgramStream", "build_url", "parse_flux_message", "parse_nova_message"]


class DeepgramStream(_DeepgramStream):
    """``DeepgramStream(transcript_callback)`` as the old module offered, on top of the new stream."""

    def __init__(self, transcript_callback=None, **kwargs):
        on_event = kwargs.pop("on_event", None)
        if transcript_callback is not None:
            on_event = _TrackAdapter(transcript_callback, on_event)
        super().__init__(on_event=on_event, **kwargs)
