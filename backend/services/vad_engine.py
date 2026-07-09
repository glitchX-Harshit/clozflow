"""
Silero VAD Engine — Real-time Voice Activity Detection

Uses Silero VAD v5 with ONNX Runtime for lightweight, fast inference (~0.5ms/frame).
Each instance maintains its own model state, safe for per-connection use.

Audio Flow:
  Raw PCM16 bytes → float32 normalization → 512-sample frames → ONNX inference → speech probability
  Speech probability → state machine → SPEECH_START / SPEECH_END events
"""

import asyncio
import time
import numpy as np
import torch
from enum import Enum
from typing import Optional

try:
    from silero_vad import load_silero_vad
    SILERO_AVAILABLE = True
except ImportError:
    SILERO_AVAILABLE = False
    print("⚠️  silero-vad not installed — VAD-based turn detection unavailable. "
          "Install with: pip install silero-vad onnxruntime")


class VADEvent(Enum):
    SPEECH_START = "speech_start"
    SPEECH_END = "speech_end"


class SileroVADEngine:
    """
    Wraps Silero VAD v5 (ONNX) for real-time voice activity detection.

    Processes raw PCM16 audio chunks and reports speech/silence transitions.
    Each instance has independent model state — one per WebSocket connection.

    Usage:
        vad = SileroVADEngine()
        await vad.initialize()
        events = vad.process_chunk(pcm16_bytes)  # → [VADEvent.SPEECH_START, ...]
    """

    FRAME_SIZE = 512  # 32ms at 16kHz — Silero's optimal window size

    def __init__(
        self,
        threshold: float = 0.5,
        sample_rate: int = 16000,
        min_speech_frames: int = 2,   # ~64ms of speech to trigger SPEECH_START
        min_silence_frames: int = 3,  # ~96ms of silence to trigger SPEECH_END
    ):
        self.threshold = threshold
        self.sample_rate = sample_rate
        self.min_speech_frames = min_speech_frames
        self.min_silence_frames = min_silence_frames

        self._model = None
        self._initialized = False

        # Internal state tracking
        self._is_speaking = False
        self._consecutive_speech = 0
        self._consecutive_silence = 0
        self._speech_start_time: Optional[float] = None

    @classmethod
    async def warmup(cls):
        """Pre-download and cache the Silero VAD model at server startup.
        Avoids a delay on the first WebSocket connection."""
        if not SILERO_AVAILABLE:
            print("⚠️  silero-vad not installed — skipping VAD warmup")
            return False
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None, lambda: load_silero_vad(onnx=True)
            )
            print("✅ Silero VAD model pre-loaded and cached")
            return True
        except Exception as e:
            print(f"❌ Failed to pre-load Silero VAD model: {e}")
            return False

    async def initialize(self) -> bool:
        """Load a fresh Silero VAD model instance. Must be called before process_chunk().
        Each connection needs its own instance because the model is stateful (LSTM)."""
        if not SILERO_AVAILABLE:
            return False

        try:
            loop = asyncio.get_event_loop()
            self._model = await loop.run_in_executor(
                None, lambda: load_silero_vad(onnx=True)
            )
            self._initialized = True
            print("✅ Silero VAD engine initialized (ONNX)")
            return True
        except Exception as e:
            print(f"❌ Silero VAD initialization failed: {e}")
            return False

    def process_chunk(self, pcm16_bytes: bytes) -> list[VADEvent]:
        """
        Process a raw PCM16 audio chunk (any size, typically 4096 samples / 8192 bytes).

        Returns a list of VADEvent transitions detected in this chunk.
        Typically returns 0–1 events per chunk.

        Args:
            pcm16_bytes: Raw 16-bit signed integer PCM audio bytes (little-endian)

        Returns:
            List of VADEvent enums (SPEECH_START or SPEECH_END)
        """
        if not self._initialized or not self._model:
            return []

        # Convert PCM16 bytes → float32 normalized to [-1, 1]
        audio = np.frombuffer(pcm16_bytes, dtype=np.int16).astype(np.float32) / 32768.0

        events = []

        # Process in FRAME_SIZE windows (512 samples = 32ms each)
        for i in range(0, len(audio), self.FRAME_SIZE):
            frame = audio[i : i + self.FRAME_SIZE]

            # Pad last frame if shorter than FRAME_SIZE
            if len(frame) < self.FRAME_SIZE:
                frame = np.pad(frame, (0, self.FRAME_SIZE - len(frame)))

            # Run Silero VAD inference (~0.5ms per frame on CPU)
            frame_tensor = torch.from_numpy(frame)
            speech_prob = float(self._model(frame_tensor, self.sample_rate))
            is_speech = speech_prob >= self.threshold

            event = self._update_state(is_speech)
            if event is not None:
                events.append(event)

        return events

    def _update_state(self, is_speech: bool) -> Optional[VADEvent]:
        """
        Update internal state machine and return a transition event if one occurred.

        Uses consecutive frame counting to filter micro-pauses:
        - SPEECH_START fires after min_speech_frames consecutive speech frames (~64ms)
        - SPEECH_END fires after min_silence_frames consecutive silence frames (~96ms)
        """
        if is_speech:
            self._consecutive_silence = 0
            self._consecutive_speech += 1

            if not self._is_speaking and self._consecutive_speech >= self.min_speech_frames:
                self._is_speaking = True
                self._speech_start_time = time.monotonic()
                return VADEvent.SPEECH_START
        else:
            self._consecutive_speech = 0
            self._consecutive_silence += 1

            if self._is_speaking and self._consecutive_silence >= self.min_silence_frames:
                self._is_speaking = False
                return VADEvent.SPEECH_END

        return None

    def reset(self):
        """Reset all state for a new session / reconnection."""
        self._is_speaking = False
        self._consecutive_speech = 0
        self._consecutive_silence = 0
        self._speech_start_time = None
        if self._model:
            self._model.reset_states()

    @property
    def is_speaking(self) -> bool:
        """Whether speech is currently detected."""
        return self._is_speaking

    @property
    def speech_duration_ms(self) -> float:
        """How long the current speech segment has lasted (0 if not speaking)."""
        if not self._is_speaking or self._speech_start_time is None:
            return 0.0
        return (time.monotonic() - self._speech_start_time) * 1000
