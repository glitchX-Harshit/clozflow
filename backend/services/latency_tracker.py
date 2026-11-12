"""Per-track latency tracker for the live copilot (and the Pearl voice agent).

Stamps are monotonic seconds. ``finalize()`` returns the breakdown of the turn that just
completed and resets for the next one. The copilot path stamps: audio sent, transcript
received, VAD speech end (``on_speech_end_candidate``), turn flushed, generation started,
AI complete. The TTS stamps stay for Pearl. Keys that older clients know are kept
(``speech_end_to_local_turn_complete`` … ``total_response_latency``); they now carry real
values for the copilot instead of zeros. Nothing here logs transcript text.
"""

import time
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class _TurnTimestamps:
    """Raw monotonic timestamps for the current turn."""
    speech_start: float = 0.0
    speech_end_candidate: float = 0.0
    turn_complete_local: float = 0.0
    first_audio: float = 0.0
    last_audio: float = 0.0
    first_transcript: float = 0.0
    last_transcript: float = 0.0
    interim_transcript: float = 0.0
    final_transcript: float = 0.0
    final_wait_timeout: float = 0.0
    turn_flushed: float = 0.0
    generation_started: float = 0.0
    llm_first_token: float = 0.0
    first_sentence: float = 0.0
    sarvam_first_audio: float = 0.0
    exotel_first_audio: float = 0.0
    ai_complete: float = 0.0
    stt_samples: list = field(default_factory=list)


def _ms(later: float, earlier: float) -> int:
    if not later or not earlier:
        return 0
    return max(0, int(round((later - earlier) * 1000)))


class LatencyTracker:
    """Per-connection latency tracker with a per-session history of totals."""

    def __init__(self, verbose: bool = False):
        self._ts = _TurnTimestamps()
        self._turn_count = 0
        self.verbose = verbose
        self.totals: list[int] = []        # total_response_latency per turn (ms), for P50/P95 at session end

    def _log(self, line: str) -> None:
        if self.verbose:
            print(line)

    def on_speech_start(self):
        if self._ts.speech_start == 0.0:
            self._ts.speech_start = time.monotonic()
        self._log("[TURN] speech_start")

    def on_speech_end_candidate(self):
        self._ts.speech_end_candidate = time.monotonic()
        self._log("[TURN] speech_end_candidate")

    def on_turn_complete_local(self):
        self._ts.turn_complete_local = time.monotonic()
        self._log("[TURN] turn_complete_local")

    def on_interim_transcript(self):
        self._ts.interim_transcript = time.monotonic()

    def on_final_transcript(self):
        self._ts.final_transcript = time.monotonic()

    def on_final_wait_timeout(self):
        self._ts.final_wait_timeout = time.monotonic()

    def on_audio_sent(self):
        now = time.monotonic()
        if self._ts.first_audio == 0.0:
            self._ts.first_audio = now
        self._ts.last_audio = now

    def on_transcript_received(self):
        now = time.monotonic()
        if self._ts.first_transcript == 0.0:
            self._ts.first_transcript = now
        self._ts.last_transcript = now
        if self._ts.last_audio > 0.0:
            self._ts.stt_samples.append(now - self._ts.last_audio)

    def on_turn_flushed(self):
        self._ts.turn_flushed = time.monotonic()

    def on_generation_started(self):
        if self._ts.generation_started == 0.0:
            self._ts.generation_started = time.monotonic()
        self._log("[LLM] generation_started")

    def on_llm_first_token(self):
        if self._ts.llm_first_token == 0.0:
            self._ts.llm_first_token = time.monotonic()

    def on_first_sentence(self):
        if self._ts.first_sentence == 0.0:
            self._ts.first_sentence = time.monotonic()

    def on_tts_first_audio(self):
        if self._ts.sarvam_first_audio == 0.0:
            now = time.monotonic()
            self._ts.sarvam_first_audio = now
            self._ts.exotel_first_audio = now

    def on_ai_complete(self):
        self._ts.ai_complete = time.monotonic()

    @property
    def turn_start(self) -> Optional[float]:
        """When the current turn ended for latency purposes (VAD end, else flush), or None."""
        return self._ts.speech_end_candidate or self._ts.turn_flushed or None

    def finalize(self) -> dict:
        ts = self._ts
        self._turn_count += 1
        turn_end = ts.speech_end_candidate or ts.turn_flushed or ts.final_transcript
        result_at = ts.sarvam_first_audio or ts.ai_complete
        stt_ms = int(round(sorted(ts.stt_samples)[len(ts.stt_samples) // 2] * 1000)) if ts.stt_samples else 0
        res = {
            "speech_end_to_local_turn_complete": _ms(ts.turn_complete_local, ts.speech_end_candidate),
            "local_turn_complete_to_final_transcript": _ms(ts.final_transcript, ts.turn_complete_local),
            "final_transcript_to_llm": _ms(ts.generation_started, max(ts.final_transcript, ts.turn_flushed)),
            "llm_to_first_tts_audio": _ms(ts.sarvam_first_audio, ts.generation_started),
            "total_response_latency": _ms(result_at, turn_end),
            "stt_ms": stt_ms,
            "llm_ms": _ms(ts.ai_complete, ts.generation_started),
            "turn_to_result_ms": _ms(ts.ai_complete, ts.turn_flushed),
        }
        if res["total_response_latency"]:
            self.totals.append(res["total_response_latency"])
        self._log(f"[LATENCY] total={res['total_response_latency']}ms llm={res['llm_ms']}ms stt={stt_ms}ms")
        self._ts = _TurnTimestamps()
        return res

    def percentiles(self) -> dict:
        """P50/P95 of the per-turn totals (numbers only; safe to log)."""
        if not self.totals:
            return {"turns": 0, "p50_ms": None, "p95_ms": None}
        ordered = sorted(self.totals)

        def pct(p):
            return ordered[min(len(ordered) - 1, int(round(p / 100.0 * (len(ordered) - 1))))]
        return {"turns": len(ordered), "p50_ms": pct(50), "p95_ms": pct(95)}
