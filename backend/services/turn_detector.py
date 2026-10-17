import os
import asyncio
import re
import time
from enum import Enum
from typing import Callable, Awaitable, Optional

class TurnState(Enum):
    IDLE = "idle"
    LISTENING = "listening"
    SILENCE_DETECTED = "silence_detected"

# Strong sentence endings
_ENDPOINT_RE = re.compile(r'[.!?\u0964]\s*$')
_QUESTION_RE = re.compile(r'\?\s*$')

class TurnDetector:
    """
    Multi-signal turn detection state machine.

    Receives events from two sources:
      1. VAD engine  -> on_speech_start(), on_speech_end()
      2. Gemini     -> on_transcript(text, is_final), on_speech_final()
    """

    def __init__(
        self,
        on_turn_complete: Callable[[str], Awaitable[None]],
        check_interval_ms: int = 25,
        tracker = None,
    ):
        self.on_turn_complete = on_turn_complete
        self.tracker = tracker
        
        # Ultra-low latency conversational timing constants (optimized for sub-700ms real calls)
        self.short_turn_ms = int(os.getenv("PEARL_SHORT_TURN_MS", "280"))
        self.end_of_turn_ms = int(os.getenv("PEARL_END_OF_TURN_MS", "480"))
        self.long_turn_ms = int(os.getenv("PEARL_LONG_TURN_MS", "900"))
        self.max_utterance_ms = int(os.getenv("PEARL_MAX_UTTERANCE_MS", "15000"))
        self.stt_final_wait_ms = int(os.getenv("PEARL_STT_FINAL_WAIT_MS", "80"))
        
        self.check_interval_ms = check_interval_ms

        self.state = TurnState.IDLE
        self.transcript_buffer: str = ""
        self.interim_buffer: str = ""
        self.has_final: bool = False
        self.silence_start: Optional[float] = None
        self.speech_start: Optional[float] = None
        self._monitor_task: Optional[asyncio.Task] = None

    def on_speech_start(self):
        if self.tracker:
            self.tracker.on_speech_start()
        self.state = TurnState.LISTENING
        self.silence_start = None
        if self.speech_start is None:
            self.speech_start = time.monotonic()
        self._cancel_monitor()

    def on_speech_end(self):
        if self.state == TurnState.IDLE:
            return
            
        if self.tracker:
            self.tracker.on_speech_end_candidate()

        self.state = TurnState.SILENCE_DETECTED
        self.silence_start = time.monotonic()
        self._cancel_monitor()
        try:
            loop = asyncio.get_running_loop()
            self._monitor_task = loop.create_task(self._silence_monitor())
        except RuntimeError:
            pass

    def on_transcript(self, text: str, is_final: bool):
        if not text or not text.strip():
            return

        if is_final:
            if self.tracker:
                self.tracker.on_final_transcript()
                
            self.transcript_buffer += " " + text.strip()
            self.interim_buffer = ""
            self.has_final = True

            if self.state == TurnState.IDLE:
                self.state = TurnState.LISTENING

            if self.state == TurnState.LISTENING:
                self._cancel_monitor()
                self.silence_start = time.monotonic()
                try:
                    loop = asyncio.get_running_loop()
                    self._monitor_task = loop.create_task(self._silence_monitor())
                except RuntimeError:
                    pass
        else:
            if self.tracker:
                self.tracker.on_interim_transcript()
                
            self.interim_buffer = text.strip()
            if self.state == TurnState.IDLE:
                self.state = TurnState.LISTENING

    def on_speech_final(self):
        if self.state == TurnState.LISTENING or self.state == TurnState.IDLE:
            self.on_speech_end()

    async def _wait_for_stt_final(self, current_text: str) -> str:
        """Fast non-blocking check for pending final transcripts."""
        # If we already have a final transcript, zero delay
        if self.has_final and self.transcript_buffer.strip():
            return self.transcript_buffer.strip()

        start_wait = time.monotonic()
        initial_buffer = self.transcript_buffer
        
        # Wait at most stt_final_wait_ms (default 80ms)
        while (time.monotonic() - start_wait) * 1000 < self.stt_final_wait_ms:
            if self.transcript_buffer != initial_buffer and self.has_final:
                return self.transcript_buffer.strip()
            await asyncio.sleep(0.015)
            
        if self.tracker:
            self.tracker.on_final_wait_timeout()
            
        best_text = self.transcript_buffer.strip()
        if not best_text and self.interim_buffer:
            best_text = self.interim_buffer
            
        return best_text

    def _get_dynamic_threshold(self, text: str) -> int:
        words = text.strip().split()
        word_count = len(words)
        text_lower = text.lower()
        
        # Fast conversational acknowledgements & greetings (Indian English & Hinglish common turns)
        fast_phrases = [
            "hello", "hi", "hey", "yes", "no", "okay", "yeah", "yep", "sure", 
            "who is this", "who's this", "ha", "haan", "theek", "theek hai", 
            "boliye", "batao", "sahi", "achha", "suno", "kaun"
        ]
        is_fast = (word_count <= 4 and any(p in text_lower for p in fast_phrases)) or word_count <= 2
        
        # Continuing words indicating prospect is still thinking
        continuing_words = [
            "actually", "and", "but", "so", "because", "hmm", "uh", "um", "like", "wait", 
            "aur", "kyunki", "lekin", "ki", "toh", "to", "ya", "par", "matlab", "if", "that"
        ]
        clean_end = re.sub(r'[.\s]+$', '', text_lower)
        is_continuing = any(clean_end.endswith(w) for w in continuing_words)
                        
        if is_continuing:
            return self.long_turn_ms
        if is_fast or (self._has_endpoint(text) and word_count <= 4):
            return self.short_turn_ms
        if self._has_endpoint(text) or self._is_question(text):
            return int(self.end_of_turn_ms * 0.8) # ~380ms on clear punctuation boundary
            
        return self.end_of_turn_ms

    def is_fast_acknowledgement(self, text: str) -> bool:
        words = text.strip().split()
        word_count = len(words)
        text_lower = text.lower()
        fast_phrases = [
            "hello", "hi", "hey", "yes", "no", "okay", "yeah", "yep", "sure", 
            "who is this", "who's this", "ha", "haan", "theek", "theek hai", 
            "boliye", "batao", "sahi", "achha", "suno", "kaun"
        ]
        return (word_count <= 4 and any(p in text_lower for p in fast_phrases)) or word_count <= 2

    def get_dynamic_threshold(self, text: str) -> int:
        return self._get_dynamic_threshold(text)

    def get_adaptive_silence_threshold(self, text: str) -> float:
        """Returns adaptive threshold in seconds (e.g. 0.28, 0.38, 0.48, 0.90)."""
        return self._get_dynamic_threshold(text) / 1000.0

    async def _flush_turn_now(self):
        """Immediately flush current buffered transcript to on_turn_complete."""
        text = self.transcript_buffer.strip() or self.interim_buffer.strip()
        if text:
            await self._flush(text, reason="manual_flush")

    async def _silence_monitor(self):
        try:
            while True:
                await asyncio.sleep(self.check_interval_ms / 1000.0)

                if self.silence_start is None:
                    return

                silence_ms = (time.monotonic() - self.silence_start) * 1000
                
                # Combine buffer and interim for text analysis
                text = self.transcript_buffer.strip()
                if not text:
                    text = self.interim_buffer.strip()
                
                # Check absolute utterance timeout
                if self.speech_start is not None:
                    utterance_ms = (time.monotonic() - self.speech_start) * 1000
                    if utterance_ms >= self.max_utterance_ms:
                        final_text = await self._wait_for_stt_final(text)
                        if final_text:
                            await self._flush(final_text, reason="max_utterance")
                        else:
                            self._reset_state()
                        return

                threshold = self._get_dynamic_threshold(text)
                
                if silence_ms >= threshold:
                    # Silence exceeded threshold. Wait a bit for STT to finalize
                    # if it hasn't already.
                    final_text = await self._wait_for_stt_final(text)
                    if final_text:
                        await self._flush(final_text, reason="adaptive_silence")
                    else:
                        # Flush anyway if it's been silence but STT hasn't sent transcript
                        if text:
                            await self._flush(text, reason="adaptive_silence_no_final")
                        else:
                            self._reset_state()
                    return

        except asyncio.CancelledError:
            pass

    @staticmethod
    def _has_endpoint(text: str) -> bool:
        return bool(_ENDPOINT_RE.search(text))

    @staticmethod
    def _is_question(text: str) -> bool:
        return bool(_QUESTION_RE.search(text))

    async def _flush(self, text: str, reason: str = "unknown"):
        if self.tracker:
            self.tracker.on_turn_complete_local()
            
        silence_ms = 0
        if self.silence_start:
            silence_ms = (time.monotonic() - self.silence_start) * 1000

        word_count = len(text.split())
        print(f"[TURN COMPLETE] [{reason}] "
              f"(silence: {silence_ms:.0f}ms, {word_count} words): "
              f"{text[:100]}{'...' if len(text) > 100 else ''}")

        self.state = TurnState.IDLE
        self.transcript_buffer = ""
        self.interim_buffer = ""
        self.has_final = False
        self.silence_start = None
        self.speech_start = None

        try:
            # Decouple: Dispatch to orchestrator without blocking/binding the silence monitor
            asyncio.create_task(self.on_turn_complete(text))
        except Exception as e:
            print(f"[TURN ERROR] Turn complete callback error: {e}")

    def _reset_state(self):
        self.state = TurnState.IDLE
        self.transcript_buffer = ""
        self.interim_buffer = ""
        self.has_final = False
        self.silence_start = None
        self.speech_start = None

    def _cancel_monitor(self):
        if self._monitor_task and not self._monitor_task.done():
            self._monitor_task.cancel()
        self._monitor_task = None

    def cleanup(self):
        self._cancel_monitor()
