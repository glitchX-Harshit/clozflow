import asyncio
import re
from typing import Callable, Optional
from backend.services.pearl.conversation_engine import ConversationEngine
from backend.services.pearl.providers.tts import get_tts_provider
from backend.services.pearl_v2.core.turn_manager import TurnManager
from backend.services.pearl_v2.core.events import TurnCompleteEvent, BargeInEvent

_SENTENCE_END_RE = re.compile(r'[.!?\u0964,—;]\s*$')

class PearlRealtimeRuntime:
    """
    V2 Architecture Orchestrator
    Separates concerns: State Machine -> Turn Manager -> LLM -> TTS -> Telephony
    """
    def __init__(self, call_id: str, lead_id: str, audio_out_callback: Callable):
        self.call_id = call_id
        self.audio_out_callback = audio_out_callback # async def (audio_bytes: bytes)
        
        self.turn_manager = TurnManager(dispatch_event=self.dispatch)
        self.conversation_engine = ConversationEngine(call_id=call_id, lead_id=lead_id)
        self.tts = get_tts_provider()
        
        self.state = "INITIALIZING"
        self._llm_task: Optional[asyncio.Task] = None
        self._tts_task: Optional[asyncio.Task] = None
        
        # We need an event loop for managing the tts audio pump
        self._tts_cancel = asyncio.Event()
        
    async def start(self):
        await self.turn_manager.connect_stt()
        await self.tts.connect()
        await self.tts.configure()
        
        self._tts_task = asyncio.create_task(self._tts_audio_pump())
        
        # Kickoff the conversation with an AI greeting
        self.dispatch(TurnCompleteEvent(text="", reason="start_call"))
        
    async def process_telephony_audio(self, audio_bytes: bytes):
        """Passes raw PCM to the TurnManager (which does VAD + STT)"""
        await self.turn_manager.process_audio(audio_bytes)
        
    def dispatch(self, event):
        """Event bus for the state machine."""
        if isinstance(event, BargeInEvent):
            self._on_barge_in()
        elif isinstance(event, TurnCompleteEvent):
            asyncio.create_task(self._on_turn_complete(event))
            
    def _on_barge_in(self):
        print("[STATE MACHINE] BargeIn detected. Cancelling TTS and LLM.")
        self.state = "LISTENING"
        self._tts_cancel.set()
        
    async def _on_turn_complete(self, event: TurnCompleteEvent):
        print(f"[STATE MACHINE] TurnComplete: '{event.text}'")
        self.state = "PROCESSING"
        self._tts_cancel.clear()
        
        if event.text.strip():
            self.conversation_engine.add_turn("prospect", event.text)
            
        # Spawn LLM -> TTS stream
        self._llm_task = asyncio.create_task(self._run_agent_response())
        
    async def _run_agent_response(self):
        sentence_buffer = ""
        full_response = ""
        
        try:
            async for token in self.conversation_engine.generate_response_stream():
                if self._tts_cancel.is_set():
                    await self.tts.cancel()
                    break
                    
                full_response += token
                sentence_buffer += token
                
                # Stream word-by-word for realtime TTS
                if sentence_buffer.endswith(" ") or _SENTENCE_END_RE.search(sentence_buffer):
                    await self.tts.send_text(sentence_buffer)
                    sentence_buffer = ""
                    
            if sentence_buffer.strip() and not self._tts_cancel.is_set():
                await self.tts.send_text(sentence_buffer.strip())
                
            if not self._tts_cancel.is_set():
                await self.tts.flush()
                
            self.conversation_engine.add_turn("agent", full_response)
            
        except Exception as e:
            print(f"[Pearl V2 LLM Error]: {e}")
            
    async def _tts_audio_pump(self):
        """Continuously pulls synthesized audio from TTS and sends to Telephony."""
        try:
            while True:
                audio_iter = self.tts.receive_audio().__aiter__()
                while True:
                    try:
                        audio_chunk = await audio_iter.__anext__()
                    except StopAsyncIteration:
                        await asyncio.sleep(0.5)
                        break
                        
                    if self._tts_cancel.is_set():
                        continue
                        
                    if audio_chunk == b"__FLUSH_COMPLETE__":
                        self.state = "LISTENING"
                        self.turn_manager.start_listening()
                        continue
                        
                    # Play the audio back to Exotel
                    await self.audio_out_callback(audio_chunk)
                    
        except asyncio.CancelledError:
            pass
