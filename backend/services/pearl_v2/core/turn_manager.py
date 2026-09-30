import asyncio
import time
import os
from typing import Callable, Optional
from backend.services.vad_engine import SileroVADEngine, VADEvent
from backend.services.gemini_stream import GeminiStream
from backend.services.pearl_v2.core.events import TurnCompleteEvent, BargeInEvent

class TurnManager:
    """
    Responsibilities:
    - Ingest audio and route to VAD and STT.
    - Evaluate whether the prospect has finished speaking based on adaptive silence.
    - Emit BargeIn when prospect starts speaking.
    - Emit TurnComplete when prospect finishes speaking.
    """
    def __init__(self, dispatch_event: Callable):
        self.dispatch = dispatch_event
        self.vad = SileroVADEngine()
        self.stt = GeminiStream(transcript_callback=self._on_stt_transcript)
        
        self.short_turn_ms = int(os.getenv("PEARL_SHORT_TURN_MS", "600"))
        self.end_of_turn_ms = int(os.getenv("PEARL_END_OF_TURN_MS", "1200"))
        self.long_turn_ms = int(os.getenv("PEARL_LONG_TURN_MS", "2500"))
        self.max_utterance_ms = int(os.getenv("PEARL_MAX_UTTERANCE_MS", "15000"))
        
        self.is_listening = False
        self.speech_start_time: Optional[float] = None
        self.silence_start_time: Optional[float] = None
        
        self.transcript_buffer = ""
        self.interim_buffer = ""
        self.has_final = False
        
        self._monitor_task: Optional[asyncio.Task] = None
        
    async def connect_stt(self):
        await self.stt.connect()
        
    async def process_audio(self, audio_bytes: bytes):
        """Called for every incoming audio chunk from the telephony adapter."""
        if not self.is_listening:
            return
            
        # Send to STT
        await self.stt.send_audio(audio_bytes)
        
        # Process VAD
        vad_events = self.vad.process_chunk(audio_bytes)
        if VADEvent.SPEECH_START in vad_events:
            self._on_speech_start()
        if VADEvent.SPEECH_END in vad_events:
            self._on_speech_end()
            
    def start_listening(self):
        self.is_listening = True
        self.transcript_buffer = ""
        self.interim_buffer = ""
        self.has_final = False
        self.speech_start_time = None
        self.silence_start_time = None
        self._cancel_monitor()
        
    def stop_listening(self):
        self.is_listening = False
        self._cancel_monitor()
        
    def _on_speech_start(self):
        self.speech_start_time = time.monotonic()
        self.silence_start_time = None
        self._cancel_monitor()
        self.dispatch(BargeInEvent())
        
    def _on_speech_end(self):
        self.silence_start_time = time.monotonic()
        self._start_monitor()
        
    async def _on_stt_transcript(self, speaker: str, text: str, is_final: bool, speech_final: bool):
        if not self.is_listening:
            return
            
        if is_final:
            self.transcript_buffer += " " + text.strip()
            self.interim_buffer = ""
            self.has_final = True
            
            # Restart silence monitor on every final transcript if silence already started
            if self.silence_start_time is not None:
                self.silence_start_time = time.monotonic()
                self._start_monitor()
        else:
            self.interim_buffer = text.strip()
            
    def _start_monitor(self):
        self._cancel_monitor()
        self._monitor_task = asyncio.create_task(self._silence_monitor())
        
    def _cancel_monitor(self):
        if self._monitor_task and not self._monitor_task.done():
            self._monitor_task.cancel()
            
    async def _silence_monitor(self):
        try:
            while True:
                await asyncio.sleep(0.05)
                if not self.silence_start_time:
                    return
                    
                silence_ms = (time.monotonic() - self.silence_start_time) * 1000
                text = self.transcript_buffer.strip() or self.interim_buffer.strip()
                
                threshold = self._get_dynamic_threshold(text)
                
                if silence_ms >= threshold:
                    # Give STT a tiny window to finalize if needed
                    await asyncio.sleep(0.2)
                    best_text = self.transcript_buffer.strip() or self.interim_buffer.strip()
                    
                    self.stop_listening()
                    self.dispatch(TurnCompleteEvent(text=best_text, reason="adaptive_silence"))
                    return
        except asyncio.CancelledError:
            pass
            
    def _get_dynamic_threshold(self, text: str) -> int:
        words = len(text.strip().split())
        if words <= 4:
            return self.short_turn_ms
        return self.end_of_turn_ms
