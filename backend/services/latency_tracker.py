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

class LatencyTracker:
    """Per-connection latency tracker with running averages."""

    def __init__(self):
        self._ts = _TurnTimestamps()
        self._turn_count = 0
        self._stt_sample_count = 0

    def on_speech_start(self):
        self._ts.speech_start = time.monotonic()
        print(f"[TURN] speech_start")

    def on_speech_end_candidate(self):
        self._ts.speech_end_candidate = time.monotonic()
        print(f"[TURN] speech_end_candidate")

    def on_turn_complete_local(self):
        self._ts.turn_complete_local = time.monotonic()
        print(f"[TURN] turn_complete_local")

    def on_interim_transcript(self):
        self._ts.interim_transcript = time.monotonic()
        print(f"[STT] interim_transcript")

    def on_final_transcript(self):
        self._ts.final_transcript = time.monotonic()
        print(f"[STT] final_transcript")

    def on_final_wait_timeout(self):
        self._ts.final_wait_timeout = time.monotonic()
        print(f"[STT] final_wait_timeout")

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
        self._ts.generation_started = time.monotonic()
        print(f"[LLM] generation_started")

    def on_llm_first_token(self):
        if self._ts.llm_first_token == 0.0:
            self._ts.llm_first_token = time.monotonic()
            print(f"[LLM] first_token")

    def on_first_sentence(self):
        if self._ts.first_sentence == 0.0:
            self._ts.first_sentence = time.monotonic()
            
    def on_tts_first_audio(self):
        if self._ts.sarvam_first_audio == 0.0:
            now = time.monotonic()
            self._ts.sarvam_first_audio = now
            self._ts.exotel_first_audio = now
            print(f"[TTS] first_audio")

    def on_ai_complete(self):
        self._ts.ai_complete = time.monotonic()

    def finalize(self) -> dict:
        self._turn_count += 1
        
        turn_start = self._ts.turn_flushed or self._ts.first_audio

        speech_end_to_local_turn_complete = (self._ts.turn_complete_local - self._ts.speech_end_candidate) * 1000 if self._ts.turn_complete_local and self._ts.speech_end_candidate else 0
        local_turn_complete_to_final_transcript = (self._ts.final_transcript - self._ts.turn_complete_local) * 1000 if self._ts.final_transcript and self._ts.turn_complete_local else 0
        final_transcript_to_llm = (self._ts.generation_started - self._ts.final_transcript) * 1000 if self._ts.generation_started and self._ts.final_transcript else 0
        llm_to_first_tts_audio = (self._ts.sarvam_first_audio - self._ts.generation_started) * 1000 if self._ts.sarvam_first_audio and self._ts.generation_started else 0
        
        # total_response_latency can be from speech_end to first audio
        total_response_latency = (self._ts.sarvam_first_audio - self._ts.speech_end_candidate) * 1000 if self._ts.sarvam_first_audio and self._ts.speech_end_candidate else 0

        print("\n[PEARL LATENCY METRICS]")
        print(f"speech_end_to_local_turn_complete: {speech_end_to_local_turn_complete:.0f} ms")
        print(f"local_turn_complete_to_final_transcript: {local_turn_complete_to_final_transcript:.0f} ms")
        print(f"final_transcript_to_llm: {final_transcript_to_llm:.0f} ms")
        print(f"llm_to_first_tts_audio: {llm_to_first_tts_audio:.0f} ms")
        print(f"total_response_latency: {total_response_latency:.0f} ms\n")

        res = {
            "speech_end_to_local_turn_complete": round(speech_end_to_local_turn_complete),
            "local_turn_complete_to_final_transcript": round(local_turn_complete_to_final_transcript),
            "final_transcript_to_llm": round(final_transcript_to_llm),
            "llm_to_first_tts_audio": round(llm_to_first_tts_audio),
            "total_response_latency": round(total_response_latency)
        }
        self._ts = _TurnTimestamps()
        return res
