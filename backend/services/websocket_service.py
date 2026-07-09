import json
import asyncio
from typing import Any, Optional
from fastapi import WebSocket, WebSocketDisconnect
from services.transcript_manager import TranscriptManager
from services.sales_ai_engine import SalesAIEngine
from services.deepgram_stream import DeepgramStream
from services.vad_engine import SileroVADEngine, VADEvent, SILERO_AVAILABLE
from services.turn_detector import TurnDetector
from database import SessionLocal
from models import CallLog


class ConnectionManager:

    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.transcript_manager = TranscriptManager()
        self.deepgram_sessions: dict[WebSocket, Any] = {}
        self.ai_engines: dict[WebSocket, SalesAIEngine] = {}
        from services.call_context_engine import call_context_engine
        self.call_context_engine = call_context_engine
        self.session_data: dict[WebSocket, dict] = {} # context_id -> {transcripts, insights, user_id}

        # ── VAD-based turn detection (new) ──
        self.vad_engines: dict[WebSocket, SileroVADEngine] = {}
        self.turn_detectors: dict[WebSocket, TurnDetector] = {}

        # ── Legacy timer-based fallback ──
        self.final_buffers: dict[WebSocket, str] = {}
        self.debounce_tasks: dict[WebSocket, asyncio.Task] = {}

    async def connect(self, websocket: WebSocket, context_id: str | None = None):
        await websocket.accept()
        self.active_connections.append(websocket)
        
        call_context = None
        if context_id:
            call_context = self.call_context_engine.get_context(context_id)
            
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

        if websocket in self.ai_engines:
            del self.ai_engines[websocket]

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

        # Note: Deepgram session is closed in handle_audio_stream's finally block (async)
        self.deepgram_sessions.pop(websocket, None)

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
        # ── PROSPECT-ONLY MODE: ignore any speaker label from Deepgram ──
        speaker = "prospect"

        td = self.turn_detectors.get(websocket)

        if td:
            # ── VAD-based path: feed signals to TurnDetector ──
            if is_final and text.strip():
                td.on_transcript(text, is_final=True)
            if speech_final:
                td.on_speech_final()
        else:
            # ── Legacy path: timer-based debounce (fallback) ──
            await self._legacy_handle_transcript(speaker, text, websocket)

    async def _process_completed_turn(self, text: str, websocket: WebSocket):
        """
        Called by TurnDetector when a turn is complete.
        This replaces the old flush_after_delay() — no more asyncio.sleep(2.5)!
        """
        if not text or not text.strip():
            return

        final_text = text.strip()

        print(f"📝 Transcript [prospect]: {final_text}")

        # Store transcript in session
        if websocket in self.session_data:
            self.session_data[websocket]["transcripts"].append({
                "speaker": "prospect",
                "text": final_text,
                "timestamp": datetime.utcnow().isoformat()
            })

        # Send clean transcript to frontend
        await self.send_personal_message(json.dumps({
            "type": "transcriptUpdate",
            "speaker": "prospect",
            "text": final_text
        }), websocket)

        # Trigger AI analysis
        ai_engine = self.ai_engines.get(websocket)
        if ai_engine:
            try:
                analysis = await ai_engine.analyze("prospect", final_text)
                if analysis:
                    if websocket in self.session_data:
                        self.session_data[websocket]["insights"].append({
                            "payload": analysis,
                            "timestamp": datetime.utcnow().isoformat()
                        })
                    await self.send_personal_message(json.dumps({
                        "type": "aiAnalysis",
                        "payload": analysis
                    }), websocket)
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

        print("🎧 Initializing audio stream (Deepgram + VAD)...")

        async def on_transcript(speaker: str, text: str, is_final: bool = True, speech_final: bool = False):
            await self.handle_new_transcript(speaker, text, websocket,
                                              is_final=is_final, speech_final=speech_final)

        dg_stream = DeepgramStream(transcript_callback=on_transcript)

        connected = await dg_stream.connect()

        if not connected:
            print("❌ Failed to connect to Deepgram")
            return

        print("✅ Deepgram stream connected")

        self.deepgram_sessions[websocket] = dg_stream

        # Get VAD + TurnDetector for this connection (may be None if unavailable)
        vad = self.vad_engines.get(websocket)
        td = self.turn_detectors.get(websocket)

        if vad and td:
            print("🧠 Multi-layer turn detection active (Silero VAD + Deepgram + Semantic)")
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

                    # ── Send to Deepgram for transcription (unchanged) ──
                    await dg_stream.send_audio(data)

                    # ── Feed to Silero VAD for voice activity detection (NEW) ──
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
                        break  # Stop loop cleanly

        except WebSocketDisconnect:
            print("❌ WebSocket disconnected")
        except RuntimeError as e:
            print(f"⚠️ WebSocket runtime error (likely disconnect): {e}")

        finally:
            # Close Deepgram session properly (async) before disconnecting
            dg = self.deepgram_sessions.get(websocket)
            if dg:
                try:
                    await dg.close()
                except Exception as e:
                    print(f"Deepgram close error: {e}")
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