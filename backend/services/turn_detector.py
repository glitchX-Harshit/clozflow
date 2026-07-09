"""
Multi-Layer Turn Detection Engine

Combines three signals to detect when a speaker's turn is complete:
  Layer 1 — Silero VAD:       Detects voice → silence transitions (~96ms)
  Layer 2 — Deepgram is_final: Confirms utterance transcription is complete
  Layer 3 — Semantic endpoint: Checks for sentence-final punctuation (. ? !)

State Machine:
  IDLE ─── (VAD speech start) ──→ LISTENING
  LISTENING ─── (VAD speech end) ──→ SILENCE_DETECTED
  SILENCE_DETECTED ─── (speech resumes) ──→ LISTENING  (cancel timer)
  SILENCE_DETECTED ─── (conditions met) ──→ flush → IDLE

Flush Conditions (cascading thresholds):
  300ms silence + is_final + endpoint punctuation  → fast flush
  400ms silence + is_final                         → normal flush
  1500ms silence (no is_final)                     → safety net force flush
"""

import asyncio
import re
import time
from enum import Enum
from typing import Callable, Awaitable, Optional


class TurnState(Enum):
    IDLE = "idle"
    LISTENING = "listening"
    SILENCE_DETECTED = "silence_detected"


# ── Semantic Endpoint Detection Patterns ──────────────────────────────────────

# Strong sentence endings
_ENDPOINT_RE = re.compile(r'[.!?]\s*$')

# Question marks (can trigger faster flush)
_QUESTION_RE = re.compile(r'\?\s*$')


class TurnDetector:
    """
    Multi-signal turn detection state machine.

    Receives events from two sources:
      1. VAD engine  → on_speech_start(), on_speech_end()
      2. Deepgram    → on_transcript(text, is_final), on_speech_final()

    When the turn is determined complete, calls on_turn_complete(text) with
    the accumulated transcript buffer.

    Usage:
        detector = TurnDetector(on_turn_complete=my_callback)
        detector.on_speech_start()          # VAD detected voice
        detector.on_transcript("hello", True)  # Deepgram finalized text
        detector.on_speech_end()            # VAD detected silence
        # → after 300-400ms, my_callback("hello") is called
    """

    def __init__(
        self,
        on_turn_complete: Callable[[str], Awaitable[None]],
        fast_threshold_ms: int = 300,    # Silence needed with endpoint detected
        normal_threshold_ms: int = 400,  # Silence needed with is_final
        safety_threshold_ms: int = 1500, # Force flush regardless of signals
        check_interval_ms: int = 50,     # Polling interval for silence monitor
    ):
        self.on_turn_complete = on_turn_complete

        # ── Configurable thresholds ──
        self.fast_threshold_ms = fast_threshold_ms
        self.normal_threshold_ms = normal_threshold_ms
        self.safety_threshold_ms = safety_threshold_ms
        self.check_interval_ms = check_interval_ms

        # ── State ──
        self.state = TurnState.IDLE
        self.transcript_buffer: str = ""
        self.has_final: bool = False
        self.silence_start: Optional[float] = None
        self._monitor_task: Optional[asyncio.Task] = None

    # ──────────────────────────────────────────────────────────────────────────
    # Layer 1: VAD Signal Input
    # ──────────────────────────────────────────────────────────────────────────

    def on_speech_start(self):
        """Called when Silero VAD detects speech onset."""
        self.state = TurnState.LISTENING
        self.silence_start = None

        # Cancel any running silence monitor — speech resumed
        self._cancel_monitor()

    def on_speech_end(self):
        """Called when Silero VAD detects speech offset (after micro-pause filter)."""
        if self.state == TurnState.IDLE:
            return  # Ignore spurious silence events before any speech

        self.state = TurnState.SILENCE_DETECTED
        self.silence_start = time.monotonic()

        # Start the silence monitor task
        self._cancel_monitor()
        self._monitor_task = asyncio.create_task(self._silence_monitor())

    # ──────────────────────────────────────────────────────────────────────────
    # Layer 2: Deepgram Transcript Signal Input
    # ──────────────────────────────────────────────────────────────────────────

    def on_transcript(self, text: str, is_final: bool):
        """Called when Deepgram sends a finalized transcript segment."""
        if not text or not text.strip():
            return

        if is_final:
            self.transcript_buffer += " " + text.strip()
            self.has_final = True

            # If we somehow got a transcript while in IDLE (VAD missed speech start,
            # or VAD not available), transition to LISTENING so the system still works
            if self.state == TurnState.IDLE:
                self.state = TurnState.LISTENING

    def on_speech_final(self):
        """Called when Deepgram sends speech_final=True (its own endpoint detection).
        Acts as a redundant silence detector — if VAD missed the speech end, this catches it."""
        if self.state == TurnState.LISTENING:
            # Treat Deepgram's speech_final like a VAD speech end
            self.on_speech_end()

    # ──────────────────────────────────────────────────────────────────────────
    # Silence Monitor — Core Turn Detection Loop
    # ──────────────────────────────────────────────────────────────────────────

    async def _silence_monitor(self):
        """
        Polls every check_interval_ms while silence is active.
        Checks cascading conditions and flushes when a threshold is met.

        Conditions (checked in order):
          1. 300ms silence + is_final + endpoint punctuation  → fast flush
          2. 400ms silence + is_final                         → normal flush
          3. 1500ms silence                                   → safety net
        """
        try:
            while True:
                await asyncio.sleep(self.check_interval_ms / 1000.0)

                # Guard: silence_start is None if speech resumed (monitor should be cancelled)
                if self.silence_start is None:
                    return

                silence_ms = (time.monotonic() - self.silence_start) * 1000
                text = self.transcript_buffer.strip()

                # ── Safety net: force flush at 1500ms no matter what ──
                if silence_ms >= self.safety_threshold_ms:
                    if text:
                        await self._flush(text, reason="safety_net")
                    else:
                        self._reset_state()
                    return

                # ── Need a finalized transcript for intelligent flushing ──
                if not self.has_final or not text:
                    continue

                # ── Fast path: sentence-ending punctuation + 300ms silence ──
                if silence_ms >= self.fast_threshold_ms and self._has_endpoint(text):
                    await self._flush(text, reason="fast_endpoint")
                    return

                # ── Normal path: 400ms silence with finalized transcript ──
                if silence_ms >= self.normal_threshold_ms:
                    await self._flush(text, reason="normal")
                    return

        except asyncio.CancelledError:
            pass  # Speech resumed — monitor cancelled, this is expected

    # ──────────────────────────────────────────────────────────────────────────
    # Layer 3: Semantic Endpoint Detection
    # ──────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _has_endpoint(text: str) -> bool:
        """Check if text ends with sentence-final punctuation (. ! ?)."""
        return bool(_ENDPOINT_RE.search(text))

    @staticmethod
    def _is_question(text: str) -> bool:
        """Check if text ends with a question mark."""
        return bool(_QUESTION_RE.search(text))

    # ──────────────────────────────────────────────────────────────────────────
    # Flush & Reset
    # ──────────────────────────────────────────────────────────────────────────

    async def _flush(self, text: str, reason: str = "unknown"):
        """Flush the accumulated transcript and trigger the turn-complete callback."""
        silence_ms = 0
        if self.silence_start:
            silence_ms = (time.monotonic() - self.silence_start) * 1000

        word_count = len(text.split())
        print(f"⚡ Turn complete [{reason}] "
              f"(silence: {silence_ms:.0f}ms, {word_count} words): "
              f"{text[:100]}{'...' if len(text) > 100 else ''}")

        # Reset state FIRST to stop re-triggering on the same text,
        # but do NOT cancel the monitor — we are running inside it.
        self.state = TurnState.IDLE
        self.transcript_buffer = ""
        self.has_final = False
        self.silence_start = None

        try:
            await self.on_turn_complete(text)
        except Exception as e:
            print(f"❌ Turn complete callback error: {e}")

    def _reset_state(self):
        """Reset state for the next turn. Safe to call from within _silence_monitor."""
        self.state = TurnState.IDLE
        self.transcript_buffer = ""
        self.has_final = False
        self.silence_start = None
        # NOTE: Do NOT call _cancel_monitor() here. _reset_state is called from
        # inside the monitor task (via _flush). Cancelling it would kill the
        # on_turn_complete callback before it executes. External cancellation
        # (when speech resumes) goes through on_speech_start() → _cancel_monitor().

    def _cancel_monitor(self):
        """Cancel the running silence monitor task if any."""
        if self._monitor_task and not self._monitor_task.done():
            self._monitor_task.cancel()
        self._monitor_task = None

    def cleanup(self):
        """Cancel all running tasks. Call this on WebSocket disconnect."""
        self._cancel_monitor()
