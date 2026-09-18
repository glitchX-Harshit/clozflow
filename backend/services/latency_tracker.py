"""
Pipeline Latency Tracker

Measures end-to-end latency through the audio → transcription → AI pipeline.

Tracks 4 segments per turn:
  ① STT Latency:       Last audio chunk sent → transcript received from Gemini
  ② Turn Detection:    Last transcript received → turn flushed (includes silence wait)
  ③ AI Processing:     Turn flushed → AI analysis complete
  ④ Total Pipeline:    First audio chunk of speech → result sent to frontend

Usage:
    tracker = LatencyTracker()
    tracker.on_audio_sent()             # audio chunk forwarded to Gemini
    tracker.on_transcript_received()    # Gemini returned a transcript
    tracker.on_turn_flushed()           # TurnDetector fired
    tracker.on_ai_complete()            # SalesAIEngine returned analysis
    breakdown = tracker.finalize()      # logs + returns breakdown dict

One tracker per WebSocket connection. Automatically resets after each turn.
"""

import time
from dataclasses import dataclass, field


@dataclass
class _TurnTimestamps:
    """Raw monotonic timestamps for the current turn."""
    first_audio: float = 0.0
    last_audio: float = 0.0
    first_transcript: float = 0.0
    last_transcript: float = 0.0
    turn_flushed: float = 0.0
    ai_complete: float = 0.0
    sent_to_frontend: float = 0.0
    stt_samples: list = field(default_factory=list)  # per-transcript STT deltas


class LatencyTracker:
    """Per-connection latency tracker with running averages."""

    def __init__(self):
        self._ts = _TurnTimestamps()
        self._turn_count = 0
        self._cumulative_total_ms = 0.0
        self._cumulative_stt_ms = 0.0
        self._cumulative_ai_ms = 0.0
        self._stt_sample_count = 0

    # ── Pipeline Event Hooks ─────────────────────────────────────────────────

    def on_audio_sent(self):
        """Called each time an audio chunk is forwarded to Gemini."""
        now = time.monotonic()
        if self._ts.first_audio == 0.0:
            self._ts.first_audio = now
        self._ts.last_audio = now

    def on_transcript_received(self):
        """Called when Gemini returns a finalized transcript segment."""
        now = time.monotonic()
        if self._ts.first_transcript == 0.0:
            self._ts.first_transcript = now
        self._ts.last_transcript = now

        # STT sample: delta from last audio chunk sent to this transcript
        if self._ts.last_audio > 0.0:
            self._ts.stt_samples.append(now - self._ts.last_audio)

    def on_turn_flushed(self):
        """Called when TurnDetector fires the turn-complete callback."""
        self._ts.turn_flushed = time.monotonic()

    def on_ai_complete(self):
        """Called when SalesAIEngine.analyze() returns."""
        self._ts.ai_complete = time.monotonic()

    # ── Finalize & Report ────────────────────────────────────────────────────

    def finalize(self) -> dict:
        """Log the latency breakdown and return it as a dict (ms values).

        Call this right before sending the result to the frontend.
        Returns a dict with keys: stt_ms, turn_detect_ms, ai_ms, total_ms,
        avg_total_ms, turn_number.
        """
        self._ts.sent_to_frontend = time.monotonic()
        self._turn_count += 1

        # ── Compute segment durations ──
        stt_avg_ms = 0.0
        if self._ts.stt_samples:
            stt_avg_ms = (sum(self._ts.stt_samples) / len(self._ts.stt_samples)) * 1000
            self._cumulative_stt_ms += stt_avg_ms
            self._stt_sample_count += 1

        turn_detect_ms = 0.0
        if self._ts.turn_flushed and self._ts.last_transcript:
            turn_detect_ms = (self._ts.turn_flushed - self._ts.last_transcript) * 1000

        ai_ms = 0.0
        if self._ts.ai_complete and self._ts.turn_flushed:
            ai_ms = (self._ts.ai_complete - self._ts.turn_flushed) * 1000
            self._cumulative_ai_ms += ai_ms

        total_ms = 0.0
        if self._ts.first_audio:
            total_ms = (self._ts.sent_to_frontend - self._ts.first_audio) * 1000
            self._cumulative_total_ms += total_ms

        avg_total_ms = self._cumulative_total_ms / self._turn_count if self._turn_count else 0
        avg_stt_ms = self._cumulative_stt_ms / self._stt_sample_count if self._stt_sample_count else 0
        avg_ai_ms = self._cumulative_ai_ms / self._turn_count if self._turn_count else 0

        # ── Print breakdown ──
        print(f"\n{'='*62}")
        print(f"  📊 LATENCY BREAKDOWN — Turn #{self._turn_count}")
        print(f"{'='*62}")
        print(f"  ① STT (Gemini):         {stt_avg_ms:>8.0f} ms   (avg: {avg_stt_ms:.0f} ms)")
        print(f"  ② Turn Detection:       {turn_detect_ms:>8.0f} ms   (silence wait)")
        print(f"  ③ AI Analysis (Groq):   {ai_ms:>8.0f} ms   (avg: {avg_ai_ms:.0f} ms)")
        print(f"  ──────────────────────────────────────────")
        print(f"  ④ Total Pipeline:       {total_ms:>8.0f} ms")
        print(f"  📈 Running Average:     {avg_total_ms:>8.0f} ms   ({self._turn_count} turns)")
        print(f"{'='*62}")
        print(f"  Note: +256ms frontend audio buffer not included above")
        print(f"{'='*62}\n")

        breakdown = {
            "stt_ms": round(stt_avg_ms),
            "turn_detect_ms": round(turn_detect_ms),
            "ai_ms": round(ai_ms),
            "total_ms": round(total_ms),
            "avg_total_ms": round(avg_total_ms),
            "turn_number": self._turn_count,
        }

        # Reset timestamps for the next turn
        self._ts = _TurnTimestamps()

        return breakdown
