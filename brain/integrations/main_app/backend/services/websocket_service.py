import json
import asyncio
from typing import Any, Optional
from fastapi import WebSocket, WebSocketDisconnect
from services.transcript_manager import TranscriptManager
import os
from services.brain_client import BrainClient
from services.gemini_stream import GeminiStream
from services.vad_engine import SileroVADEngine, VADEvent, SILERO_AVAILABLE
from services.turn_detector import TurnDetector
from services.latency_tracker import LatencyTracker
from database import SessionLocal
from models import CallLog


class ConnectionManager:

    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.transcript_manager = TranscriptManager()
        self.gemini_sessions: dict[WebSocket, Any] = {}
        self.ai_engines: dict[WebSocket, Any] = {}
        self._brain_close_tasks: set[asyncio.Task] = set()
        from services.call_context_engine import call_context_engine
        self.call_context_engine = call_context_engine
        self.session_data: dict[WebSocket, dict] = {} # context_id -> {transcripts, insights, user_id}

        # ── VAD-based turn detection (new) ──
        self.vad_engines: dict[WebSocket, SileroVADEngine] = {}
        self.turn_detectors: dict[WebSocket, TurnDetector] = {}

        # ── Legacy timer-based fallback ──
        self.final_buffers: dict[WebSocket, str] = {}
        self.debounce_tasks: dict[WebSocket, asyncio.Task] = {}

        # ── Latency measurement ──
        self.latency_trackers: dict[WebSocket, LatencyTracker] = {}

        # ── Speculative AI execution (runs AI during silence wait) ──
        self._speculative_ai: dict[WebSocket, tuple[asyncio.Task, str]] = {}

    async def connect(self, websocket: WebSocket, context_id: str | None = None):
        protocols = getattr(websocket, 'headers', {}).get('sec-websocket-protocol', '').split(',')
        if 'clozflow' in [value.strip() for value in protocols]:
            await websocket.accept(subprotocol='clozflow')
        else:
            await websocket.accept()
        self.active_connections.append(websocket)
        
        call_context = None
        if context_id:
            call_context = self.call_context_engine.get_context(context_id)
            if call_context:
                call_context = {**call_context, '_context_id': context_id}
            
        if os.getenv("CLOZFLOW_COPILOT_ENGINE", "legacy").lower() == "brain":
            self.ai_engines[websocket] = BrainClient(call_context=call_context)
        else:
            from services.sales_ai_engine import SalesAIEngine
            self.ai_engines[websocket] = SalesAIEngine(call_context=call_context)
        
        if context_id and call_context:
            self.session_data[websocket] = {
                "context_id": context_id,
                "user_id": call_context.get("user_id"),
                "transcripts": [],
                "insights": []
            }

        # ── Initialize VAD + TurnDetector for this connection ──
        if SILERO_AVAILABLE:
            vad = SileroVADEngine()
            if await vad.initialize():
                self.vad_engines[websocket] = vad

                # Create turn detector with callback bound to this websocket
                async def on_turn_complete(text, ws=websocket):
                    await self._process_completed_turn(text, ws)

                td = TurnDetector(on_turn_complete=on_turn_complete)
                self.turn_detectors[websocket] = td
                print(f"✅ VAD + TurnDetector initialized for connection")
            else:
                print(f"⚠️  VAD init failed — falling back to legacy timer")
                self._init_legacy_buffers(websocket)
        else:
            print(f"⚠️  silero-vad not installed — using legacy timer")
            self._init_legacy_buffers(websocket)
            
        print(f"🔌 Client connected. Active WebSockets: {len(self.active_connections)}")

    def _init_legacy_buffers(self, websocket: WebSocket):
        """Initialize legacy timer-based buffers for connections without VAD."""
        self.final_buffers[websocket] = ""
        self.debounce_tasks[websocket] = None

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

        ai_engine = self.ai_engines.pop(websocket, None)
        if ai_engine and getattr(ai_engine, "is_brain_client", False):
            task = asyncio.create_task(self._close_brain(ai_engine, finalize=False))
            self._brain_close_tasks.add(task)
            task.add_done_callback(self._brain_close_tasks.discard)

        print("❌ Client disconnected.")

        # Save session data to DB before cleanup if context exists
        if websocket in self.session_data:
            self.save_session_to_db(websocket)
            del self.session_data[websocket]

        # ── Cleanup VAD + TurnDetector ──
        if websocket in self.turn_detectors:
            self.turn_detectors[websocket].cleanup()
            del self.turn_detectors[websocket]
        if websocket in self.vad_engines:
            del self.vad_engines[websocket]

        # ── Cleanup legacy timer buffers ──
        self.final_buffers.pop(websocket, None)
        if websocket in self.debounce_tasks and self.debounce_tasks[websocket]:
            self.debounce_tasks[websocket].cancel()
        self.debounce_tasks.pop(websocket, None)

        # ── Cleanup latency tracker & speculative AI ──
        self.latency_trackers.pop(websocket, None)
        spec_task, _ = self._speculative_ai.pop(websocket, (None, ""))
        if spec_task and not spec_task.done():
            spec_task.cancel()

        # Note: Gemini session is closed in handle_audio_stream's finally block (async)
        self.gemini_sessions.pop(websocket, None)

    async def _close_brain(self, engine, *, finalize=True):
        try:
            await engine.close(finalize=finalize)
        except Exception:
            print("Brain session closure failed; check the local Brain service.")

    async def shutdown(self):
        for websocket in list(self.active_connections):
            self.disconnect(websocket)
        if self._brain_close_tasks:
            await asyncio.gather(*list(self._brain_close_tasks), return_exceptions=True)

    async def handle_live_message(self, message: dict, websocket: WebSocket):
        """Receive completed transcripts from the main application (no audio)."""
        if isinstance(message, dict) and message.get('type') == 'end_session':
            engine = self.ai_engines.get(websocket)
            if engine and getattr(engine, 'is_brain_client', False):
                await self._close_brain(engine)
                await websocket.send_text(json.dumps({'type': 'session_ended', 'brain_session_id': engine.session_id}))
            return
        if not isinstance(message, dict) or message.get("type") != "transcriptUpdate" or not message.get("is_final", True):
            return
        text = message.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > 16000:
            return
        speaker = str(message.get("speaker", "prospect")).lower()
        if speaker not in {"prospect", "buyer", "rep", "salesperson", "unknown"}:
            speaker = "unknown"
        await self._process_completed_turn(text, websocket, speaker=speaker)

    async def send_personal_message(self, message: str, websocket: WebSocket):
        try:
            await websocket.send_text(message)
        except Exception:
            self.disconnect(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                self.disconnect(connection)

    # ==============================
    # AI PIPELINE — VAD-Based Turn Detection
    # ==============================

    async def handle_new_transcript(self, speaker: str, text: str, websocket: WebSocket,
                                     is_final: bool = True, speech_final: bool = False):
        """Route transcript events to TurnDetector or legacy timer."""
        # ── PROSPECT-ONLY MODE: ignore any speaker label from Gemini ──
        speaker = "prospect"

        td = self.turn_detectors.get(websocket)

        # ── Latency tracking: mark transcript arrival ──
        lt = self.latency_trackers.get(websocket)
        if lt and is_final and text.strip():
            lt.on_transcript_received()

        if td:
            # ── VAD-based path: feed signals to TurnDetector ──
            if is_final and text.strip():
                td.on_transcript(text, is_final=True)
                
                # ── Speculative AI Execution ──
                # Start AI analysis early during silence wait if sentence looks complete
                current_text = td.transcript_buffer.strip()
                if TurnDetector._has_endpoint(current_text) or TurnDetector._is_question(current_text):
                    existing_task, existing_text = self._speculative_ai.get(websocket, (None, ""))
                    # Only kick off a new task if the text changed
                    if current_text != existing_text and not getattr(self.ai_engines.get(websocket), "is_brain_client", False):
                        if existing_task and not existing_task.done():
                            existing_task.cancel()
                        
                        ai_engine = self.ai_engines.get(websocket)
                        if ai_engine:
                            print(f"🔮 Speculative AI started: {current_text[:50]}...")
                            task = asyncio.create_task(ai_engine.analyze("prospect", current_text))
                            self._speculative_ai[websocket] = (task, current_text)

            if speech_final:
                td.on_speech_final()
        elif is_final and text.strip():
            # Only finalized STT text enters the turn buffer.
            await self._legacy_handle_transcript(speaker, text, websocket)

    async def _process_completed_turn(self, text: str, websocket: WebSocket, speaker: str = "prospect"):
        """
        Called by TurnDetector when a turn is complete.
        This replaces the old flush_after_delay() — no more asyncio.sleep(2.5)!
        """
        if not text or not text.strip():
            return

        final_text = text.strip()

        # ── Latency: mark turn flushed ──
        lt = self.latency_trackers.get(websocket)
        if lt:
            lt.on_turn_flushed()

        print(f"📝 Transcript [prospect]: {final_text}")

        # Store transcript in session
        if websocket in self.session_data:
            self.session_data[websocket]["transcripts"].append({
                "speaker": speaker,
                "text": final_text,
                "timestamp": datetime.utcnow().isoformat()
            })

        # Send clean transcript to frontend
        await self.send_personal_message(json.dumps({
            "type": "transcriptUpdate",
            "speaker": speaker,
            "text": final_text
        }), websocket)

        # Trigger AI analysis
        ai_engine = self.ai_engines.get(websocket)
        if ai_engine:
            try:
                analysis = None
                # Check for speculative execution match
                spec_task, spec_text = self._speculative_ai.pop(websocket, (None, ""))
                
                if spec_task and spec_text == final_text:
                    print(f"✨ Using speculative AI result (overlaps silence wait)")
                    try:
                        analysis = await spec_task
                    except asyncio.CancelledError:
                        analysis = await ai_engine.analyze(speaker, final_text)
                else:
                    if spec_task and not spec_task.done():
                        spec_task.cancel()
                    analysis = await ai_engine.analyze(speaker, final_text)

                # ── Latency: mark AI complete and log breakdown ──
                latency_breakdown = None
                if lt:
                    lt.on_ai_complete()
                    latency_breakdown = lt.finalize()

                if analysis:
                    if websocket in self.session_data:
                        self.session_data[websocket]["insights"].append({
                            "payload": analysis,
                            "timestamp": datetime.utcnow().isoformat()
                        })
                    msg = {
                        "type": "aiAnalysis",
                        "payload": analysis,
                    }
                    if latency_breakdown:
                        msg["latency"] = latency_breakdown
                    await self.send_personal_message(json.dumps(msg), websocket)
            except Exception as e:
                print(f"❌ [SalesAI] Unhandled pipeline error: {e}")
                # Don't drop websocket, just log and continue listening

    # ==============================
    # LEGACY TIMER-BASED FALLBACK
    # ==============================

    async def _legacy_handle_transcript(self, speaker: str, text: str, websocket: WebSocket):
        """Original debounce-based turn detection. Used when VAD is unavailable."""
        if websocket not in self.final_buffers:
            self.final_buffers[websocket] = ""

        self.final_buffers[websocket] += " " + text

        # cancel previous debounce
        if websocket in self.debounce_tasks and self.debounce_tasks[websocket]:
            self.debounce_tasks[websocket].cancel()

        # start new debounce timer
        self.debounce_tasks[websocket] = asyncio.create_task(
            self._legacy_flush_after_delay(websocket)
        )

    async def _legacy_flush_after_delay(self, websocket: WebSocket):
        """Legacy: wait 2.5s of silence before flushing (old behavior)."""
        try:
            await asyncio.sleep(2.5)  # ← This is the latency bottleneck VAD eliminates

            final_text = self.final_buffers.get(websocket, "").strip()
            if websocket in self.final_buffers:
                self.final_buffers[websocket] = ""

            if not final_text:
                return

            # Reuse the shared turn processing pipeline
            await self._process_completed_turn(final_text, websocket)

        except asyncio.CancelledError:
            pass

    # ==============================
    # AUDIO STREAM HANDLER
    # ==============================

    async def handle_audio_stream(self, websocket: WebSocket):

        print("🎧 Initializing audio stream (Gemini + VAD)...")

        async def on_transcript(speaker: str, text: str, is_final: bool = True, speech_final: bool = False):
            await self.handle_new_transcript(speaker, text, websocket,
                                              is_final=is_final, speech_final=speech_final)

        gemini_stream = GeminiStream(transcript_callback=on_transcript)

        connected = await gemini_stream.connect()

        if not connected:
            print("❌ Failed to connect to Gemini")
            return

        print("✅ Gemini transcription stream connected")

        self.gemini_sessions[websocket] = gemini_stream

        # ── Initialize latency tracker for this connection ──
        lt = LatencyTracker()
        self.latency_trackers[websocket] = lt

        # Get VAD + TurnDetector for this connection (may be None if unavailable)
        vad = self.vad_engines.get(websocket)
        td = self.turn_detectors.get(websocket)

        if vad and td:
            print("🧠 Multi-layer turn detection active (Silero VAD + Gemini + Semantic)")
        else:
            print("⏱️  Legacy timer-based turn detection active (2.5s debounce)")

        try:

            while True:
                # RECEIVE BINARY AUDIO OR TEXT COMMANDS
                message = await websocket.receive()

                # Starlette sends a disconnect message — exit cleanly
                if message.get("type") == "websocket.disconnect":
                    print("🔌 WebSocket disconnect message received")
                    break

                if "bytes" in message:
                    data = message["bytes"]
                    print(f"📥 received audio chunk: {len(data)} bytes")

                    # ── Send to Gemini for transcription ──
                    await gemini_stream.send_audio(data)

                    # ── Latency: mark audio sent to STT ──
                    lt.on_audio_sent()

                    # ── Feed to Silero VAD for voice activity detection ──
                    if vad and td:
                        vad_events = vad.process_chunk(data)
                        for event in vad_events:
                            if event == VADEvent.SPEECH_START:
                                td.on_speech_start()
                            elif event == VADEvent.SPEECH_END:
                                td.on_speech_end()

                elif "text" in message:
                    text_data = message["text"]
                    print(f"📥 received text command: {text_data}")
                    if "close_stream" in text_data:
                        engine = self.ai_engines.get(websocket)
                        if engine and getattr(engine, 'is_brain_client', False):
                            await self._close_brain(engine)
                        break  # Stop loop cleanly

        except WebSocketDisconnect:
            print("❌ WebSocket disconnected")
        except RuntimeError as e:
            print(f"⚠️ WebSocket runtime error (likely disconnect): {e}")

        finally:
            # Close Gemini session properly (async) before disconnecting
            gm = self.gemini_sessions.get(websocket)
            if gm:
                try:
                    await gm.close()
                except Exception as e:
                    print(f"Gemini close error: {e}")
            self.disconnect(websocket)


    def save_session_to_db(self, websocket: WebSocket):
        data = self.session_data.get(websocket)
        if not data or not data.get("user_id"):
            return

        db = SessionLocal()
        try:
            new_log = CallLog(
                user_id=data["user_id"],
                transcript=json.dumps(data["transcripts"]),
                ai_suggestions=json.dumps(data["insights"]),
                timestamp=datetime.utcnow()
            )
            db.add(new_log)
            db.commit()
            print(f"💾 Call log saved to DB for user {data['user_id']}")
        except Exception as e:
            print(f"❌ Failed to save call log: {e}")
        finally:
            db.close()

from datetime import datetime
websocket_manager = ConnectionManager()
