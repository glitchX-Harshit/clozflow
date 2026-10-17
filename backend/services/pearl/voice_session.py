"""
Pearl Realtime Voice Session State Machine & Controller
Formal per-session orchestration layer ensuring:
1. Strict session lifecycle: LISTENING -> USER_TURN_PENDING -> THINKING -> SPEAKING -> LISTENING
2. Monotonically increasing generation_id rejecting stale chunks after barge-in.
3. Bounded queues (maxsize=50) preventing memory leaks and buffer bloat.
4. Structured async task ownership and cancellation.
5. Deterministic isolation between sessions.
"""
import asyncio
import time
from enum import Enum
from typing import Optional, Callable, Awaitable, Dict, Any, List
from .phrase_chunker import PhraseChunker

class SessionState(str, Enum):
    IDLE = "IDLE"
    LISTENING = "LISTENING"
    USER_TURN_PENDING = "USER_TURN_PENDING"
    THINKING = "THINKING"
    SPEAKING = "SPEAKING"
    INTERRUPTED = "INTERRUPTED"
    CLOSED = "CLOSED"

class AudioPacket:
    """Bounded, tagged audio packet carrying generation metadata."""
    __slots__ = ("generation_id", "data", "timestamp")
    def __init__(self, generation_id: int, data: bytes):
        self.generation_id = generation_id
        self.data = data
        self.timestamp = time.monotonic()

class PearlVoiceSession:
    """
    Session Controller managing conversation turn lifecycle, generation invariants,
    audio queues, and cancellation tokens.
    """
    def __init__(
        self,
        session_id: str,
        engine=None,
        tts_provider=None,
        on_audio_out: Optional[Callable[[bytes], Awaitable[None]]] = None,
        on_state_change: Optional[Callable[[SessionState], Awaitable[None]]] = None,
        max_audio_queue: int = 50
    ):
        self.session_id = session_id
        self.engine = engine
        self.tts = tts_provider
        self.on_audio_out = on_audio_out
        self.on_state_change = on_state_change
        
        # State & Generation Invariants
        self.state = SessionState.IDLE
        self.generation_id: int = 0
        self.is_speaking: bool = False
        self.turn_completed_at: float = 0.0
        self.first_audio_sent_at: float = 0.0
        
        # Bounded Queues
        self.audio_queue: asyncio.Queue[Optional[AudioPacket]] = asyncio.Queue(maxsize=max_audio_queue)
        self.chunker = PhraseChunker()
        
        # Task Management
        self._active_llm_task: Optional[asyncio.Task] = None
        self._tts_consumer_task: Optional[asyncio.Task] = None
        self._audio_dispatcher_task: Optional[asyncio.Task] = None
        self._cancellation_event = asyncio.Event()
        self._closed = False

    def transition_to(self, new_state: SessionState):
        """Synchronously transition state (for test/benchmark control)."""
        self.state = new_state

    def start_ai_turn(self) -> int:
        """Advance generation_id and transition to SPEAKING."""
        self.generation_id += 1
        self.state = SessionState.SPEAKING
        self.is_speaking = True
        self._cancellation_event.clear()
        return self.generation_id

    def commit_user_turn(self, user_transcript: str):
        """Commit user turn transcript and transition to THINKING."""
        self.state = SessionState.THINKING

    def end_ai_turn(self, gen_id: int):
        """Mark end of AI turn and transition back to LISTENING."""
        if gen_id == self.generation_id:
            self.is_speaking = False
            self.state = SessionState.LISTENING

    def enqueue_audio_chunk(self, data: bytes, generation_id: int) -> bool:
        """
        Enqueue an audio chunk tagged with generation_id.
        Rejects obsolete chunks from previous generations or when cancelled.
        """
        if generation_id != self.generation_id or self._cancellation_event.is_set():
            return False
        packet = AudioPacket(generation_id=generation_id, data=data)
        try:
            self.audio_queue.put_nowait(packet)
            return True
        except asyncio.QueueFull:
            return False

    def trigger_barge_in(self) -> int:
        """Trigger barge-in, cancel generation, flush audio queue, transition to INTERRUPTED."""
        cancelled_gen = self.generation_id
        self.generation_id += 1
        self._cancellation_event.set()
        self.is_speaking = False
        self.state = SessionState.INTERRUPTED
        while not self.audio_queue.empty():
            try:
                self.audio_queue.get_nowait()
            except (asyncio.QueueEmpty, ValueError):
                break
        return cancelled_gen

    async def start(self):
        """Start background consumer and dispatcher loops."""
        self.state = SessionState.LISTENING
        self._cancellation_event.clear()
        self._tts_consumer_task = asyncio.create_task(self._tts_consumer_loop())
        self._audio_dispatcher_task = asyncio.create_task(self._audio_dispatcher_loop())

    async def _transition(self, new_state: SessionState):
        self.state = new_state
        if self.on_state_change:
            try:
                await self.on_state_change(new_state)
            except Exception:
                pass

    def cancel_current_generation(self, reason: str = "barge_in") -> int:
        """
        Immediately cancel the current response generation.
        Increments generation_id so any late in-flight tokens or audio chunks
        from remote LLM/TTS are immediately discarded.
        """
        self.generation_id += 1
        new_gen = self.generation_id
        self._cancellation_event.set()
        
        self.is_speaking = False
        self.first_audio_sent_at = 0.0
        self.chunker.reset()

        # Cancel active LLM task
        if self._active_llm_task and not self._active_llm_task.done():
            self._active_llm_task.cancel()
            self._active_llm_task = None

        # Reset TTS stateful buffers
        if hasattr(self.tts, 'cancel'):
            asyncio.create_task(self.tts.cancel())

        # Drain the bounded audio queue of obsolete packets
        while not self.audio_queue.empty():
            try:
                self.audio_queue.get_nowait()
            except (asyncio.QueueEmpty, ValueError):
                break

        print(f"[VOICE SESSION {self.session_id}] Generation cancelled ({reason}) -> Advanced to Gen {new_gen}")
        return new_gen

    async def on_user_speech_start(self):
        """Triggered on VAD speech onset."""
        if self.state == SessionState.SPEAKING and self.is_speaking:
            # Candidate barge-in: cancel active response
            self.cancel_current_generation(reason="barge_in_onset")
            await self._transition(SessionState.INTERRUPTED)
            await self._transition(SessionState.LISTENING)
        elif self.state == SessionState.IDLE:
            await self._transition(SessionState.LISTENING)

    async def on_turn_complete(self, user_transcript: str) -> Optional[int]:
        """
        Commits user turn and launches LLM -> Chunker -> TTS generation pipeline.
        Returns the assigned generation_id.
        """
        if self._closed or not user_transcript.strip():
            return None

        # Advance generation ID
        self.generation_id += 1
        current_gen = self.generation_id
        self._cancellation_event.clear()
        
        self.turn_completed_at = time.monotonic()
        await self._transition(SessionState.THINKING)
        
        # Reset phrase chunker
        self.chunker.reset()
        if hasattr(self.tts, 'reset_buffer'):
            self.tts.reset_buffer()

        # Launch LLM generation task
        self._active_llm_task = asyncio.create_task(
            self._execute_generation_turn(user_transcript, current_gen)
        )
        return current_gen

    async def _execute_generation_turn(self, user_transcript: str, gen_id: int):
        """Stream response from LLM, chunk phrases adaptively, and feed TTS."""
        try:
            self.engine.add_turn("prospect", user_transcript)
            full_response = ""

            async for token in self.engine.generate_response_stream():
                # Invariant: Discard if generation was cancelled or advanced
                if gen_id != self.generation_id or self._cancellation_event.is_set():
                    return

                full_response += token
                phrases = self.chunker.feed_token(token)
                
                for phrase in phrases:
                    if gen_id != self.generation_id or self._cancellation_event.is_set():
                        return
                    await self.tts.send_text(phrase)

            # Flush trailing buffer text
            final_phrase = self.chunker.flush()
            if final_phrase and gen_id == self.generation_id and not self._cancellation_event.is_set():
                await self.tts.send_text(final_phrase)

            # Flush TTS
            if gen_id == self.generation_id and not self._cancellation_event.is_set():
                await self.tts.flush()
                self.engine.add_turn("agent", full_response.strip())

        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[VOICE SESSION {self.session_id}] Generation error: {e}")

    async def _tts_consumer_loop(self):
        """Consume audio chunks from TTS provider and enqueue them."""
        while not self._closed:
            try:
                async for chunk in self.tts.receive_audio():
                    if self._closed:
                        break

                    # Check cancellation
                    if self._cancellation_event.is_set():
                        continue

                    if chunk == b"__FLUSH_COMPLETE__":
                        self.is_speaking = False
                        await self._transition(SessionState.LISTENING)
                        continue

                    if chunk and len(chunk) > 0:
                        # Wrap in AudioPacket tagged with current generation ID
                        pkt = AudioPacket(self.generation_id, chunk)
                        try:
                            # Non-blocking put into bounded queue; drop oldest if full
                            if self.audio_queue.full():
                                try:
                                    self.audio_queue.get_nowait()
                                except asyncio.QueueEmpty:
                                    pass
                            self.audio_queue.put_nowait(pkt)
                        except Exception:
                            pass

            except asyncio.CancelledError:
                break
            except Exception as e:
                if not self._closed:
                    print(f"[VOICE SESSION {self.session_id}] TTS consumer loop error: {e}")
                    await asyncio.sleep(0.2)

    async def _audio_dispatcher_loop(self):
        """Dispatch queued audio packets to transport callback."""
        while not self._closed:
            try:
                pkt = await self.audio_queue.get()
                if self._closed:
                    break

                if pkt is None:
                    continue

                # Invariant: Strict Generation Check
                # Drop packet immediately if it belongs to an older/superseded generation
                if pkt.generation_id != self.generation_id or self._cancellation_event.is_set():
                    continue

                if not self.is_speaking:
                    self.is_speaking = True
                    self.first_audio_sent_at = time.monotonic()
                    await self._transition(SessionState.SPEAKING)

                # Send audio to client transport
                await self.on_audio_out(pkt.data)

            except asyncio.CancelledError:
                break
            except Exception as e:
                if not self._closed:
                    print(f"[VOICE SESSION {self.session_id}] Audio dispatcher error: {e}")

    async def close(self):
        """Clean up all tasks and release resources."""
        self._closed = True
        self.state = SessionState.CLOSED
        self._cancellation_event.set()

        for task in (self._active_llm_task, self._tts_consumer_task, self._audio_dispatcher_task):
            if task and not task.done():
                task.cancel()

        if hasattr(self.tts, 'close'):
            try:
                await self.tts.close()
            except Exception:
                pass
