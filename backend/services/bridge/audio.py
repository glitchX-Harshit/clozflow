"""Carrier audio → the format the live pipeline expects.

Vobiz sends one base64 frame of raw mono audio per track every 20 ms
(``audio/x-l16;rate=16000`` = 640 bytes). The pipeline (same as ``/ws/audio``)
wants signed 16-bit little-endian PCM at 16 kHz in 2048-byte chunks (1024 samples,
a multiple of the Silero VAD window). μ-law/8 kHz and L16/8 kHz are converted too,
in case the carrier ignores the requested ``contentType``.
"""
from __future__ import annotations

import base64
import binascii
import os
from collections import deque
from typing import Deque, List, Optional

import numpy as np

PIPELINE_CHUNK_BYTES = 2048
MAX_FRAME_PAYLOAD_BYTES = 32_000   # 1 s of L16/16k; a real frame is 640 bytes


def _mulaw_table() -> np.ndarray:
    """ITU-T G.711 μ-law byte → int16 sample."""
    values = np.arange(256, dtype=np.int32)
    inverted = ~values & 0xFF
    sign = inverted & 0x80
    exponent = (inverted >> 4) & 0x07
    mantissa = inverted & 0x0F
    magnitude = ((mantissa << 3) + 0x84) << exponent
    sample = np.where(sign != 0, 0x84 - magnitude, magnitude - 0x84)
    return sample.astype(np.int16)


_MULAW = _mulaw_table()


def default_byte_order() -> str:
    """L16 byte order of the carrier stream: ``little``, ``big`` or ``auto`` (default).

    Vobiz's docs disagree with themselves here: RFC 2586/3551 L16 is network byte
    order, yet Vobiz's own Pipecat guide says "some Vobiz accounts transport L16 as
    little-endian" and the real frame captured in its Bun example is little-endian.
    ``auto`` starts little-endian and switches to big-endian only when the first
    frames are clearly byte-swapped (see ``ByteOrderDetector``). Set
    ``COPILOT_BRIDGE_L16_BYTE_ORDER`` to ``little``/``big`` to pin it (it applies to
    every Vobiz stream: the copilot bridge and Pearl's agent calls)."""
    value = (os.getenv("COPILOT_BRIDGE_L16_BYTE_ORDER") or "auto")
    value = value.strip().lower()
    return value if value in ("little", "big") else "auto"


def parse_media_format(media_format) -> tuple:
    """``start.mediaFormat`` (or a ``contentType`` string) → (encoding, sample_rate).

    Vobiz reports the inbound format it actually uses in ``start.mediaFormat``
    (``{"encoding": "audio/x-l16", "sampleRate": 16000}``); the docs call it
    authoritative over the ``<Stream contentType>`` that was requested. Returns
    (None, None) for the parts that are missing or unreadable."""
    encoding, rate = None, None
    if isinstance(media_format, dict):
        encoding = media_format.get("encoding") or media_format.get("contentType")
        rate = media_format.get("sampleRate", media_format.get("sample_rate", media_format.get("rate")))
    elif isinstance(media_format, str):
        encoding = media_format
    if isinstance(encoding, str) and "rate=" in encoding.lower() and rate is None:
        try:
            rate = int(encoding.lower().split("rate=", 1)[1].split(";", 1)[0].strip())
        except ValueError:
            rate = None
    enc = None
    if isinstance(encoding, str) and encoding.strip():
        low = encoding.strip().lower()
        enc = "audio/x-mulaw" if ("mulaw" in low or "pcmu" in low or "ulaw" in low) else "audio/x-l16"
    try:
        rate = int(rate) if rate is not None else None
    except (TypeError, ValueError):
        rate = None
    return enc, rate


class ByteOrderDetector:
    """Decides L16 byte order from the audio itself.

    Telephony audio is band-limited, so sample-to-sample steps are small when the
    bytes are read in the right order; read swapped, the low byte lands in the high
    byte and the signal turns into near-white, near-full-scale noise. Evidence is
    summed over frames that carry any signal and the order flips to big-endian only
    when it is clearly smoother (``RATIO``×); otherwise it stays little-endian.
    """

    RATIO = 4.0
    MIN_FRAMES = 10        # 200 ms of 20 ms frames with signal
    MAX_FRAMES = 100       # give up after 2 s of ambiguous audio: stay little-endian

    def __init__(self):
        self.order: Optional[str] = None     # None = undecided (decode as little)
        self._little = 0.0
        self._big = 0.0
        self._frames = 0

    def observe(self, raw: bytes) -> None:
        if self.order is not None or len(raw) < 8:
            return
        le = np.frombuffer(raw, dtype="<i2").astype(np.int32)
        be = np.frombuffer(raw, dtype=">i2").astype(np.int32)
        d_le = float(np.abs(np.diff(le)).mean())
        d_be = float(np.abs(np.diff(be)).mean())
        if max(d_le, d_be) <= 0.0:
            return                            # digital silence says nothing
        self._little += d_le
        self._big += d_be
        self._frames += 1
        if self._frames < self.MIN_FRAMES:
            return
        if self._big * self.RATIO < self._little:
            self.order = "big"
        elif self._little * self.RATIO < self._big or self._frames >= self.MAX_FRAMES:
            self.order = "little"


def l16_to_samples(raw: bytes, byte_order: str) -> np.ndarray:
    return np.frombuffer(raw, dtype=">i2" if byte_order == "big" else "<i2").astype(np.int16)


class FrameDecoder:
    """Decodes one track's ``media.payload`` values into PCM16LE at 16 kHz."""

    def __init__(self, encoding: str = "audio/x-l16", sample_rate: int = 16000,
                 byte_order: Optional[str] = None):
        requested = (byte_order or default_byte_order()).strip().lower()
        self._detector = ByteOrderDetector() if requested not in ("little", "big") else None
        self._fixed_order = requested if requested in ("little", "big") else None
        self.encoding = "audio/x-l16"
        self.sample_rate = 16000
        self._last_sample = 0.0
        self.configure(encoding, sample_rate)

    @property
    def byte_order(self) -> str:
        if self._fixed_order:
            return self._fixed_order
        return self._detector.order or "little"

    def configure(self, encoding: Optional[str], sample_rate) -> None:
        enc, rate = parse_media_format({"encoding": encoding, "sampleRate": sample_rate})
        self.encoding = enc or "audio/x-l16"
        rate = rate or self.sample_rate     # a missing rate keeps the current one
        if self.encoding == "audio/x-mulaw":
            rate = 8000
        self.sample_rate = 8000 if rate == 8000 else 16000

    def _raw(self, payload) -> Optional[bytes]:
        if not isinstance(payload, str) or not payload:
            return None
        if len(payload) > MAX_FRAME_PAYLOAD_BYTES * 4 // 3 + 4:
            return None
        try:
            raw = base64.b64decode(payload, validate=True)
        except (binascii.Error, ValueError):
            return None
        return raw or None

    def decode_samples(self, payload) -> Optional[np.ndarray]:
        """int16 samples at the stream's own rate (``self.sample_rate``), or None."""
        raw = self._raw(payload)
        if raw is None:
            return None
        if self.encoding == "audio/x-mulaw":
            return _MULAW[np.frombuffer(raw, dtype=np.uint8)]
        if len(raw) % 2:
            raw = raw[:-1]
        if not raw:
            return None
        if self._detector is not None:
            self._detector.observe(raw)
        return l16_to_samples(raw, self.byte_order)

    def decode_native(self, payload) -> Optional[bytes]:
        """PCM16LE at the stream's own rate (no resampling), or None."""
        samples = self.decode_samples(payload)
        return None if samples is None else samples.astype("<i2").tobytes()

    def decode(self, payload) -> Optional[bytes]:
        """PCM16LE/16 kHz bytes, or None for an empty or malformed payload."""
        samples = self.decode_samples(payload)
        if samples is None:
            return None
        if self.sample_rate == 8000:
            samples = self._upsample(samples)
        return samples.astype("<i2").tobytes()

    def _upsample(self, samples: np.ndarray) -> np.ndarray:
        """8 kHz → 16 kHz by linear interpolation, continuous across frames."""
        x = samples.astype(np.float32)
        previous = np.concatenate(([self._last_sample], x[:-1]))
        self._last_sample = float(x[-1])
        out = np.empty(x.size * 2, dtype=np.float32)
        out[0::2] = (previous + x) / 2.0
        out[1::2] = x
        return np.clip(np.round(out), -32768, 32767).astype(np.int16)


class PcmChunker:
    """Re-chunks PCM into fixed-size chunks (sample aligned)."""

    def __init__(self, chunk_bytes: int = PIPELINE_CHUNK_BYTES):
        self.chunk_bytes = chunk_bytes
        self._buffer = bytearray()

    def push(self, pcm: bytes) -> List[bytes]:
        self._buffer.extend(pcm)
        chunks = []
        while len(self._buffer) >= self.chunk_bytes:
            chunks.append(bytes(self._buffer[:self.chunk_bytes]))
            del self._buffer[:self.chunk_bytes]
        return chunks

    def flush(self) -> Optional[bytes]:
        if not self._buffer:
            return None
        data = bytes(self._buffer)
        self._buffer.clear()
        if len(data) % 2:
            data = data[:-1]
        return data + b"\x00" * (self.chunk_bytes - len(data)) if data else None


class Preroll:
    """The last ``seconds`` of decoded audio of a track while the call isn't
    bridged yet, so the prospect's first "Hello?" isn't lost while the
    DialAnswer webhook is in flight. Older audio (ringback) is discarded."""

    def __init__(self, seconds: float = 1.0, frame_ms: int = 20):
        self._frames: Deque[bytes] = deque(maxlen=max(1, int(seconds * 1000 / frame_ms)))

    def add(self, pcm: bytes) -> None:
        self._frames.append(pcm)

    def drain(self) -> List[bytes]:
        frames = list(self._frames)
        self._frames.clear()
        return frames
