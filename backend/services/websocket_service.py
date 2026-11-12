"""Live copilot pipeline: speech → turns → transcript + AI guidance.

Building blocks (the phone bridge in ``services/bridge/`` uses them too):

* ``LiveCopilotSession`` — one conversation: the engine (the Meeting Wizard ``coach``
  by default, or the legacy ``SalesAIEngine`` / local Brain; ``CLOZFLOW_COPILOT_ENGINE``),
  the transcript and insights, conversation metrics and the deal record, the ``CallLog``
  saved at the end, and an output *sink* (an async callable taking a JSON-able dict: a
  WebSocket, or the bridge's app-event hub).
* ``TrackPipeline`` — one audio channel of a session with a fixed speaker: PCM16LE/16 kHz
  in → STT (Deepgram Flux / Gemini / Sarvam via ``services.wizard.stt_router``) + Silero VAD
  + ``TurnDetector`` → completed turns, partials for instant cards, end-of-turn events.
* ``ConnectionManager`` — the ``/ws`` (text) and ``/ws/audio`` endpoints. ``/ws/audio``
  speaks protocol v1 (raw PCM frames, one prospect track, exactly today's messages) and
  protocol v2 (a ``hello`` first, channel-tagged frames, the coach messages; see
  ``docs/changes/wizard-live.md``).

Transcripts are personal data: they are stored and sent to their owner, never logged.
"""
import asyncio
import inspect
import json
import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Awaitable, Callable, Optional

from fastapi import WebSocket, WebSocketDisconnect

from database import SessionLocal
from models import CallLog, User
from services.brain_client import BrainClient
from services.latency_tracker import LatencyTracker
from services.turn_detector import TurnDetector
from services.vad_engine import SILERO_AVAILABLE, SileroVADEngine, VADEvent
from services.wizard import contracts as C
from services.wizard import hooks as wizard_hooks
from services.wizard import stt_router
from services.wizard.coach_engine import CoachSession
from services.wizard.deal_record import DealRecordTracker
from services.wizard.metrics import MetricsTracker

Sink = Callable[[dict], Awaitable[None]]

SALESPERSON_SPEAKERS = frozenset({"rep", "salesperson"})
LIVE_SPEAKERS = frozenset({"prospect", "buyer", "rep", "salesperson", "unknown"})
MAX_AUDIO_FRAME_BYTES = 64 * 1024        # clients send 2048-byte frames (2049 with the channel byte)
MAX_TEXT_MESSAGE_CHARS = 16000
AUDIO_QUEUE_MAX_CHUNKS = 64              # ≈4 s of 2048-byte chunks per track
STT_CONNECT_TIMEOUT_SECONDS = 15.0
STT_CLOSE_TIMEOUT_SECONDS = 10.0
TURN_DRAIN_SECONDS = 20.0                # the legacy engine's LLM timeout is 15 s
BRAIN_CLOSE_TIMEOUT_SECONDS = 120.0
LEGACY_TURN_SILENCE_SECONDS = 2.5
MAX_USER_INSTRUCTIONS_CHARS = 1500
HELLO_WAIT_SECONDS = 1.5                 # a v2 client sends hello at once; otherwise it's a v1 client
METRICS_INTERVAL_SECONDS = 10.0
V2_FEATURES = ["coach", "strip", "moment", "metrics", "deal_record", "deal_health", "ask", "what_to_say", "set_intensity",
               "snooze", "pin", "feedback", "consent", "marker", "notice", "ping"]
CHANNEL_NAMES = {"rep": C.CHANNEL_REP, "salesperson": C.CHANNEL_REP, "prospect": C.CHANNEL_PROSPECT,
                 "mixed": C.CHANNEL_MIXED, "mic": C.CHANNEL_MIXED}

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _utc_iso() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── Prompt override (Settings → Prompt Override, ``User.ai_override_prompt``) ──

def normalize_user_instructions(value) -> Optional[str]:
    """The user's extra copilot instructions, cleaned: no control characters, at
    most ``MAX_USER_INSTRUCTIONS_CHARS``. None when empty."""
    if not isinstance(value, str):
        return None
    text = _CONTROL_CHARS.sub("", value.replace("\r\n", "\n").replace("\r", "\n"))
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not text:
        return None
    return text[:MAX_USER_INSTRUCTIONS_CHARS].rstrip()


def load_user_instructions(user_id) -> Optional[str]:
    """Reads ``ai_override_prompt`` defensively (the column may not exist yet)."""
    if not user_id:
        return None
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        return normalize_user_instructions(getattr(user, "ai_override_prompt", None)) if user else None
    except Exception:
        return None
    finally:
        db.close()


# ── Factories (module level so tests and the bridge can swap them) ──

def copilot_engine_name() -> str:
    """``coach`` (default), ``legacy`` or ``brain``."""
    name = os.getenv("CLOZFLOW_COPILOT_ENGINE", "coach").strip().lower()
    return name if name in ("coach", "legacy", "brain") else "coach"


def _build_legacy_engine(call_context, user_instructions, learning_log):
    from services.sales_ai_engine import SalesAIEngine
    return SalesAIEngine(call_context=call_context, user_instructions=user_instructions, learning_log=learning_log)


def create_ai_engine(call_context, *, user_instructions=None, learning_log=True):
    """The legacy/Brain engine for one conversation. May return an awaitable: the legacy
    engine is built in a worker thread (its first construction loads the RAG model)."""
    if copilot_engine_name() == "brain":
        return BrainClient(call_context=call_context, user_instructions=user_instructions)
    return asyncio.to_thread(_build_legacy_engine, call_context, user_instructions, learning_log)


def create_coach_session(session, *, user_instructions=None) -> CoachSession:
    """The Meeting Wizard coach for one session (tests swap this for a fake LLM)."""
    return CoachSession(
        call_context=session.call_context, wizard=session.wizard, emit=session.emit, user_id=session.user_id,
        intensity=session.intensity, metrics=session.metrics, deal=session.deal, user_instructions=user_instructions,
        record_insight=session.insights.append, live_features=session.live_features)


def create_stt_stream(transcript_callback, **options):
    """Streaming STT for one track: ``connect()``, ``send_audio(pcm16le_16k)``, ``close()``;
    calls ``transcript_callback(speaker, text, is_final=..., speech_final=...)`` and, with
    ``on_event``, every ``contracts.SttEvent`` (partials, end of turn, eager end of turn, resumed).
    ``options``: ``channel``, ``keyterms``, ``language_hint``, ``on_event``."""
    return stt_router.create_stream_for_track(transcript_callback, **options)


def create_vad():
    return SileroVADEngine() if SILERO_AVAILABLE else None


async def close_brain(engine, *, finalize=True):
    try:
        await asyncio.wait_for(engine.close(finalize=finalize), timeout=BRAIN_CLOSE_TIMEOUT_SECONDS)
    except Exception:
        print("Brain session closure failed; check the local Brain service.")


_CALL_LOG_LOCK = threading.Lock()

# Columns the Meeting Wizard adds to call_logs (models_wizard.py, Backend A). Written only
# when the model has them, so the pipeline works before and after that migration.
WIZARD_CALL_LOG_COLUMNS = ("meeting_id", "title", "prospect_name", "platform", "channel", "engine", "duration_seconds",
                           "started_at", "ended_at", "metrics", "deal_record")


def _json_list(value) -> list:
    try:
        parsed = json.loads(value or "[]")
    except (TypeError, ValueError):
        return []
    return parsed if isinstance(parsed, list) else []


def _apply_call_log_extra(log, extra: Optional[dict], *, merging: bool) -> None:
    for column in WIZARD_CALL_LOG_COLUMNS:
        if not extra or column not in extra or not hasattr(CallLog, column):
            continue
        value = extra[column]
        if value is None:
            continue
        if merging and column == "duration_seconds":
            value = int(getattr(log, column, 0) or 0) + int(value)
        elif merging and column == "started_at" and getattr(log, column, None):
            continue
        setattr(log, column, value)


def save_call_log(user_id, transcripts, insights, *, context_id=None, extra: Optional[dict] = None) -> Optional[int]:
    """Persists a conversation so it shows in Session History; returns the CallLog id.

    With ``context_id`` (the call brief), every connection of that brief — Pause,
    resume, reconnect — appends to the same CallLog, so History shows one call.
    ``extra`` carries the Meeting Wizard columns (see ``WIZARD_CALL_LOG_COLUMNS``)."""
    if not user_id:
        return None
    from services.call_context_engine import call_context_engine
    with _CALL_LOG_LOCK:
        db = SessionLocal()
        try:
            existing = None
            log_id = call_context_engine.get_call_log_id(context_id) if context_id else None
            if log_id:
                existing = db.query(CallLog).filter(CallLog.id == log_id, CallLog.user_id == user_id).first()
            if existing is not None:
                if transcripts or insights:
                    old_transcript = _json_list(existing.transcript)
                    old_insights = _json_list(existing.ai_suggestions)
                    offset = len(old_transcript)
                    moved = [{**item, "turn_index": item["turn_index"] + offset}
                             if isinstance(item, dict) and isinstance(item.get("turn_index"), int) else item
                             for item in insights]
                    merged_transcript, merged_insights = old_transcript + list(transcripts), old_insights + moved
                    existing.transcript = json.dumps(merged_transcript, default=str)
                    existing.ai_suggestions = json.dumps(merged_insights, default=str)
                    existing.message_count = len(merged_transcript)
                    existing.insight_count = len(merged_insights)
                _apply_call_log_extra(existing, extra, merging=True)
                db.commit()
                print(f"💾 Call log updated for user {user_id}")
                return existing.id
            log = CallLog(
                user_id=user_id,
                transcript=json.dumps(transcripts, default=str),
                ai_suggestions=json.dumps(insights, default=str),
                message_count=len(transcripts),
                insight_count=len(insights),
                timestamp=_utcnow(),
            )
            _apply_call_log_extra(log, extra, merging=False)
            db.add(log)
            db.commit()
            if context_id:
                call_context_engine.set_call_log_id(context_id, log.id)
            print(f"💾 Call log saved for user {user_id}")
            return log.id
        except Exception as e:
            db.rollback()
            print(f"❌ Failed to save call log: {type(e).__name__}")
            return None
        finally:
            db.close()


def patch_context_wizard(context_id: Optional[str], patch: dict) -> bool:
    """Merges ``patch`` into ``payload["wizard"]`` of the call brief (e.g. the consent record)."""
    if not context_id or not isinstance(patch, dict):
        return False
    from services.call_context_engine import briefs, call_context_engine, engine as ctx_engine
    with call_context_engine._lock:
        context = call_context_engine.get_context(context_id)
        if not context:
            return False
        wizard = dict(context.get("wizard") or {})
        wizard.update(patch)
        context["wizard"] = wizard
        with ctx_engine.begin() as conn:
            conn.execute(briefs.update().where(briefs.c.context_id == context_id).values(payload=context))
        call_context_engine.sessions[context_id] = context
        return True


def _sanitize_analysis(analysis):
    """``deal_signal`` is only ever an integer 0–100 from a real engine estimate."""
    if not isinstance(analysis, dict):
        return None
    if "deal_signal" not in analysis:
        return analysis
    signal = analysis.get("deal_signal")
    if isinstance(signal, bool) or not isinstance(signal, (int, float)) or not 0 <= signal <= 100:
        return {key: value for key, value in analysis.items() if key != "deal_signal"}
    return {**analysis, "deal_signal": int(round(signal))}


def _speaker_channel(speaker: str) -> int:
    if speaker in SALESPERSON_SPEAKERS:
        return C.CHANNEL_REP
    if speaker in ("prospect", "buyer"):
        return C.CHANNEL_PROSPECT
    return C.CHANNEL_MIXED


class LiveCopilotSession:
    """One live conversation and where its events go."""

    def __init__(self, *, call_context: Optional[dict], sink: Sink, user_id=None, persist: bool = True,
                 learning_log: bool = True, label: str = "live", merge_key: Optional[str] = None,
                 announce_saved: bool = False, protocol: int = 1, live_features: bool = False,
                 channel_tagged: bool = False, channel_kind: Optional[str] = None):
        self.call_context = call_context
        self.user_id = user_id if user_id is not None else (call_context or {}).get("user_id")
        self.persist = bool(persist and self.user_id)
        self.learning_log = learning_log
        self.label = label
        self.merge_key = merge_key            # brief id: reconnects append to one CallLog
        self.announce_saved = announce_saved  # send {"type":"session_saved"} once stored
        self.engine = None
        self.engine_closed = False
        self.transcripts: list = []
        self.insights: list = []
        self.tracks: list = []
        self.closed = False
        self.call_log_id: Optional[int] = None
        self.brain_session_id: Optional[str] = None
        self._sink = sink
        self._sink_failed = False
        self._turn_tasks: set = set()
        self._closing: Optional[asyncio.Future] = None
        self._engine_ready = asyncio.Event()
        # ── Meeting Wizard state ──
        self.protocol = protocol
        self.live_features = live_features    # strip / moment / metrics / deal_* messages on the wire
        self.channel_kind = channel_kind      # tab_audio | mic | phone_bridge
        self.wizard: dict = dict((call_context or {}).get("wizard") or {}) if isinstance((call_context or {}).get("wizard"), dict) else {}
        self.meeting_id = self.wizard.get("meeting_id")
        self.intensity = str(self.wizard.get("intensity") or self.wizard.get("coaching_intensity") or "guided")
        self.metrics = MetricsTracker(channel_tagged=channel_tagged)
        self.deal = DealRecordTracker(self.wizard.get("methodology") or "meddpicc")
        self.coach: Optional[CoachSession] = None
        self.consent: Optional[dict] = self.wizard.get("consent") if isinstance(self.wizard.get("consent"), dict) else None
        self.markers: list = []
        self.client: Optional[str] = None
        self.hello_at: Optional[float] = None
        self.t0 = time.monotonic()
        self.started_at = _utcnow()
        self._metrics_task: Optional[asyncio.Task] = None
        self._last_metrics_at: Optional[float] = None

    @property
    def is_brain(self) -> bool:
        return bool(getattr(self.engine, "is_brain_client", False))

    @property
    def engine_name(self) -> str:
        if self.coach is not None:
            return "coach"
        if self.is_brain:
            return "brain"
        return "legacy" if self.engine is not None else copilot_engine_name()

    def now_s(self) -> float:
        return max(0.0, time.monotonic() - self.t0)

    def adopt_call_context(self, context: Optional[dict]) -> None:
        """A late-bound brief (the bridge loads it after the session exists): re-derives the Wizard state.
        Call before ``start()``."""
        self.call_context = context
        if self.user_id is None:
            self.user_id = (context or {}).get("user_id")
            self.persist = bool(self.persist and self.user_id)
        wizard = (context or {}).get("wizard")
        self.wizard = dict(wizard) if isinstance(wizard, dict) else {}
        self.meeting_id = self.meeting_id or self.wizard.get("meeting_id")
        self.intensity = str(self.wizard.get("intensity") or self.wizard.get("coaching_intensity") or self.intensity or "guided")
        methodology = self.wizard.get("methodology") or "meddpicc"
        if self.deal.record.get("methodology") != methodology and self.deal.version == 0:
            self.deal = DealRecordTracker(methodology)
        if self.consent is None and isinstance(self.wizard.get("consent"), dict):
            self.consent = self.wizard["consent"]

    def keyterms(self) -> list:
        """Names worth boosting in STT: the brief's list, else product/prospect/company/competitor names."""
        terms = [str(t) for t in (self.wizard.get("keyterms") or []) if str(t).strip()]
        if not terms:
            ctx = self.call_context or {}
            for key in ("product_name", "client_name"):
                if ctx.get(key):
                    terms.append(str(ctx[key]))
            for key in ("company", "prospect_name"):
                if self.wizard.get(key):
                    terms.append(str(self.wizard[key]))
            for card in self.wizard.get("battlecards") or []:
                if isinstance(card, dict) and card.get("kind") == "competitive" and card.get("title"):
                    terms.append(str(card["title"]))
        return list(dict.fromkeys(t.strip() for t in terms if t.strip()))[:50]

    # ── lifecycle ──

    async def start(self) -> None:
        try:
            instructions = await asyncio.to_thread(load_user_instructions, self.user_id) if self.user_id else None
            engine = None
            if copilot_engine_name() == "coach":
                try:
                    self.coach = create_coach_session(self, user_instructions=instructions)
                    await self.coach.start()
                except Exception as e:
                    print(f"❌ Coach unavailable: {type(e).__name__}")
                    self.coach = None
            else:
                try:
                    engine = create_ai_engine(self.call_context, user_instructions=instructions,
                                              learning_log=self.learning_log)
                    if inspect.isawaitable(engine):
                        engine = await engine
                except Exception as e:
                    # Transcripts still flow; there is just no guidance for this session.
                    print(f"❌ Copilot engine unavailable: {type(e).__name__}")
                    engine = None
            if engine is not None and self.closed:
                # The conversation ended while the engine was being built.
                if getattr(engine, "is_brain_client", False):
                    await close_brain(engine, finalize=False)
                engine = None
            self.engine = engine
        finally:
            self._engine_ready.set()

    def enable_v2(self, *, channels=None, intensity=None, client=None, meeting_id=None) -> dict:
        """Protocol v2 was negotiated: returns the ``ready`` message."""
        self.protocol = 2
        self.live_features = True
        self.client = str(client)[:32] if client else None
        channel_ids = sorted({CHANNEL_NAMES.get(str(name).lower(), C.CHANNEL_MIXED) for name in (channels or ["mixed"])})
        self.metrics.channel_tagged = C.CHANNEL_REP in channel_ids and C.CHANNEL_PROSPECT in channel_ids
        if self.channel_kind is None:
            self.channel_kind = "tab_audio" if self.metrics.channel_tagged else "mic"
        if meeting_id and not self.meeting_id:
            self.meeting_id = str(meeting_id)[:36]
        if intensity in C.INTENSITY_LADDER:
            self.intensity = intensity
        if self.coach is not None:
            self.coach.live_features = True
            if intensity in C.INTENSITY_LADDER:
                asyncio.ensure_future(self.coach.set_intensity(intensity))
        elif self._metrics_task is None:
            self._metrics_task = asyncio.create_task(self._metrics_loop())
        warmup_ms = int((time.monotonic() - self.hello_at) * 1000) if self.hello_at else None
        return {
            "type": "ready", "protocol": C.PROTOCOL_VERSION,
            "session_id": (self.call_context or {}).get("_context_id") or self.merge_key or uuid.uuid4().hex,
            "engine": self.engine_name, "stt": stt_router.describe(), "features": list(V2_FEATURES),
            "intensity": self.intensity, "meeting_id": self.meeting_id, "warmup_ms": warmup_ms,
            "slo": {"first_line_ms": C.SLO_FIRST_LINE_P50_MS, "first_line_p95_ms": C.SLO_FIRST_LINE_P95_MS},
        }

    async def _metrics_loop(self) -> None:
        """Metrics every 10 s for v2 sessions on the legacy/Brain engines (the coach has its own ticker)."""
        try:
            while not self.closed:
                await asyncio.sleep(METRICS_INTERVAL_SECONDS)
                if self.metrics.segments:
                    elapsed = self.now_s()
                    await self.emit({"type": "metrics", "metrics": self.metrics.snapshot(elapsed), "nudges": self.metrics.nudges(elapsed)})
        except asyncio.CancelledError:
            pass

    async def emit(self, message: dict) -> None:
        if self._sink_failed:
            return
        try:
            await self._sink(message)
        except Exception:
            self._sink_failed = True   # the client is gone; the transcript is still kept

    def track_task(self, task: asyncio.Task) -> None:
        self._turn_tasks.add(task)
        task.add_done_callback(self._turn_tasks.discard)

    # ── speech activity & partials (from the tracks) ──

    def on_speech(self, channel: int, speaking: bool) -> None:
        if self.coach is not None:
            self.coach.on_speech(channel, speaking, self.now_s())
        else:
            self.metrics.on_speech(channel, speaking, self.now_s())

    async def on_partial(self, channel: int, text: str) -> None:
        if self.coach is not None and self.live_features:
            await self.coach.on_partial(text, channel=channel, turn_index=len(self.transcripts))

    async def on_eager_eot(self, channel: int, text: str) -> None:
        if self.coach is not None:
            await self.coach.on_eager_eot(text, channel=channel, turn_index=len(self.transcripts))

    def on_turn_resumed(self, channel: int) -> None:
        if self.coach is not None:
            self.coach.on_turn_resumed(channel=channel)

    # ── turns ──

    async def process_turn(self, speaker: str, text: str, *, latency_tracker=None, speculative=None,
                           channel: Optional[int] = None, t_start: Optional[float] = None, t_end: Optional[float] = None,
                           eot_at: Optional[float] = None) -> None:
        """One completed turn: store it, send ``transcriptUpdate``, then coach (or, on the
        legacy/Brain engines, run the AI for anyone but the salesperson and send ``aiAnalysis``).
        (Turn tasks are tracked by their creators, so ``drain`` never waits on an endpoint's own task.)"""
        final_text = (text or "").strip()
        spec_task, spec_text = speculative or (None, "")
        if not final_text:
            if spec_task is not None and not spec_task.done():
                spec_task.cancel()
            return
        if latency_tracker is not None:
            latency_tracker.on_turn_flushed()
        speaker = (speaker or "prospect").lower()
        if channel is None:
            channel = _speaker_channel(speaker)
        if t_end is None:
            t_end = round(self.now_s(), 2)
        if t_start is None:
            t_start = round(max(0.0, t_end - max(0.4, C.word_count(final_text) / 2.5)), 2)
        entry = {"speaker": speaker, "text": final_text, "timestamp": _utc_iso(), "channel": channel,
                 "t_start": t_start, "t_end": t_end}
        self.transcripts.append(entry)
        turn_index = len(self.transcripts) - 1
        message = {"type": "transcriptUpdate", "speaker": speaker, "text": final_text}
        if self.protocol >= 2:
            message.update(channel=channel, t_start=t_start, t_end=t_end, is_final=True, turn_index=turn_index)
        await self.emit(message)

        if speaker == "system":
            # Markers and consent lines are kept in the transcript; they never reach an engine.
            if spec_task is not None and not spec_task.done():
                spec_task.cancel()
            return
        if not self._engine_ready.is_set():
            try:   # a pipeline may start the engine and STT concurrently
                await asyncio.wait_for(self._engine_ready.wait(), timeout=30.0)
            except asyncio.TimeoutError:
                pass
        if self.coach is not None:
            if spec_task is not None and not spec_task.done():
                spec_task.cancel()
            await self.coach.on_turn(speaker, final_text, channel=channel, turn_index=turn_index,
                                     eot_at=eot_at if eot_at is not None else time.monotonic(), t_start=t_start, t_end=t_end)
            if latency_tracker is not None:
                latency_tracker.on_ai_complete()
                latency_tracker.finalize()
            return
        self.metrics.on_turn(speaker, final_text, t_start, t_end, channel=channel)
        engine = self.engine
        if engine is None or self.engine_closed:
            if spec_task is not None and not spec_task.done():
                spec_task.cancel()
            return
        if speaker in SALESPERSON_SPEAKERS:
            # Context for the engine (Brain: a SALESPERSON turn); never guidance.
            try:
                await engine.analyze(speaker, final_text)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                print(f"❌ [Copilot] Salesperson turn not recorded by the engine: {type(e).__name__}")
            return
        try:
            if latency_tracker is not None:
                latency_tracker.on_generation_started()
            if spec_task is not None and spec_text == final_text:
                try:
                    analysis = await spec_task
                except asyncio.CancelledError:
                    this = asyncio.current_task()
                    if this is not None and getattr(this, "cancelling", lambda: 0)():
                        raise
                    analysis = await engine.analyze(speaker, final_text)
            else:
                if spec_task is not None and not spec_task.done():
                    spec_task.cancel()
                analysis = await engine.analyze(speaker, final_text)

            latency_breakdown = None
            if latency_tracker is not None:
                latency_tracker.on_ai_complete()
                latency_breakdown = latency_tracker.finalize()

            analysis = _sanitize_analysis(analysis)
            if analysis:
                self.insights.append({"payload": analysis, "timestamp": _utc_iso(), "turn_index": turn_index})
                message = {"type": "aiAnalysis", "payload": analysis}
                if latency_breakdown:
                    message["latency"] = latency_breakdown
                await self.emit(message)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            # Don't drop the conversation; log and keep listening.
            print(f"❌ [SalesAI] Unhandled pipeline error: {type(e).__name__}")

    # ── protocol v2 client messages ──

    async def handle_client_message(self, message: dict) -> bool:
        """``ask`` / ``what_to_say`` / ``set_intensity`` / ``snooze`` / ``pin`` / ``feedback`` /
        ``consent`` / ``marker`` / ``ping``. Returns True when the message was one of them."""
        if not isinstance(message, dict):
            return False
        kind = message.get("type")
        if kind == "ping":
            await self.emit({"type": "pong", "t": message.get("t"), "server_t": int(time.time() * 1000)})
            return True
        if kind == "what_to_say":
            if self.coach is not None:
                self.track_task(asyncio.create_task(self.coach.what_to_say(length=message.get("length"))))
            else:
                await self.emit({"type": "notice", "code": "coach_unavailable",
                                 "text": "On-demand coaching needs the coach engine (CLOZFLOW_COPILOT_ENGINE=coach)."})
            return True
        if kind == "ask":
            question = message.get("question")
            if isinstance(question, str) and question.strip():
                if self.coach is not None:
                    self.track_task(asyncio.create_task(self.coach.ask(question)))
                else:
                    await self.emit({"type": "notice", "code": "coach_unavailable",
                                     "text": "Ask needs the coach engine (CLOZFLOW_COPILOT_ENGINE=coach)."})
            return True
        if kind == "set_intensity":
            value = str(message.get("value") or "").lower()
            if value in C.INTENSITY_LADDER:
                self.intensity = value
                if self.coach is not None:
                    await self.coach.set_intensity(value)
                await self.emit({"type": "notice", "code": "intensity", "text": f"Coaching intensity: {value}.", "intensity": value})
            return True
        if kind == "snooze":
            if self.coach is not None:
                try:
                    ms = int(message.get("ms") or 300_000)
                except (TypeError, ValueError):
                    ms = 300_000
                self.coach.snooze(str(message.get("moment") or ""), ms)
            return True
        if kind == "pin":
            if self.coach is not None and isinstance(message.get("id"), str):
                self.coach.pin(message["id"])
            return True
        if kind == "feedback":
            if self.coach is not None and isinstance(message.get("id"), str):
                self.coach.feedback(message["id"], str(message.get("value") or ""))
            return True
        if kind == "consent":
            await self.record_consent(str(message.get("mode") or ""), script=message.get("script"))
            return True
        if kind == "marker":
            label = " ".join(str(message.get("label") or "Marker").split())[:120]
            self.markers.append({"label": label, "t": round(self.now_s(), 1), "turn_index": len(self.transcripts)})
            await self.process_turn("system", f"Marker: {label}", channel=C.CHANNEL_MIXED)
            return True
        return False

    async def record_consent(self, mode: str, *, script=None) -> None:
        mode = mode.strip().lower()
        if mode not in ("announced", "in_invite", "bridge_disclosure", "skipped"):
            return
        self.consent = {"mode": mode, "announced_at": C.utc_now_iso(), "script": str(script)[:600] if isinstance(script, str) else None,
                        "participants_notified": mode != "skipped"}
        self.wizard["consent"] = self.consent
        await self.process_turn("system", f"Consent: {mode}", channel=C.CHANNEL_MIXED)
        if self.merge_key:
            try:
                await asyncio.to_thread(patch_context_wizard, self.merge_key, {"consent": self.consent})
            except Exception as e:
                print(f"⚠️ consent not persisted to the brief: {type(e).__name__}")

    # ── draining and closing ──

    def _pending_turn_tasks(self) -> set:
        current = asyncio.current_task()
        pending = {task for task in self._turn_tasks if not task.done()}
        for track in self.tracks:
            pending.update(task for task in track.pending_tasks() if not task.done())
        pending.discard(current)
        return pending

    async def drain(self, timeout: float = TURN_DRAIN_SECONDS) -> None:
        """Waits for in-flight turns (their AI results belong in the CallLog)."""
        await asyncio.sleep(0)   # let just-dispatched turn tasks register
        deadline = time.monotonic() + timeout
        while True:
            pending = self._pending_turn_tasks()
            remaining = deadline - time.monotonic()
            if not pending:
                return
            if remaining <= 0:
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                return
            await asyncio.wait(pending, timeout=remaining)

    async def finalize_engine(self) -> Optional[str]:
        """Ends the Brain session now (``close_stream`` / ``end_session``)."""
        engine = self.engine
        if engine is None or not getattr(engine, "is_brain_client", False):
            return None
        if not self.engine_closed:
            self.engine_closed = True
            await close_brain(engine, finalize=True)
        return getattr(engine, "brain_session_id", None) or getattr(engine, "session_id", None)

    async def close(self, *, finalize_engine: bool, save: bool = True) -> Optional[int]:
        """Drains turns, saves the CallLog (returns its id), then closes the engine.
        Safe to call more than once; later calls wait for the first."""
        if self._closing is None:
            self._closing = asyncio.ensure_future(self._close(finalize_engine=finalize_engine, save=save))
        return await asyncio.shield(self._closing)

    def call_log_extra(self) -> dict:
        """The Meeting Wizard columns for this session's CallLog."""
        ctx = self.call_context or {}
        metrics = self.coach.saved_metrics() if self.coach is not None else dict(self.metrics.snapshot(self.now_s()))
        if self.markers:
            metrics["markers"] = list(self.markers)
        if self.consent:
            metrics["consent"] = dict(self.consent)
        latency = [t.latency.percentiles() for t in self.tracks if t.latency.totals]
        if latency:
            metrics.setdefault("latency", {})["legacy_turns"] = latency
        title = ctx.get("title") or self.wizard.get("title")
        if not title:
            name = ctx.get("client_name") or self.wizard.get("prospect_name")
            title = f"{name} · {ctx.get('call_goal')}" if name and ctx.get("call_goal") else (name or "Live call")
        return {
            "meeting_id": self.meeting_id, "title": str(title)[:200],
            "prospect_name": (ctx.get("client_name") or self.wizard.get("prospect_name") or None),
            "platform": self.wizard.get("platform"), "channel": self.wizard.get("channel") or self.channel_kind,
            "engine": self.engine_name, "duration_seconds": int(self.now_s()),
            "started_at": self.started_at, "ended_at": _utcnow(), "metrics": metrics, "deal_record": self.deal.snapshot(),
        }

    async def _close(self, *, finalize_engine: bool, save: bool) -> Optional[int]:
        await self.drain()
        self.closed = True
        if self._metrics_task is not None:
            self._metrics_task.cancel()
        if self.coach is not None:
            try:
                await self.coach.close()
            except Exception as e:
                print(f"⚠️ coach close failed: {type(e).__name__}")
        if save and self.persist:
            extra = self.call_log_extra()
            self.call_log_id = await asyncio.to_thread(
                save_call_log, self.user_id, list(self.transcripts), list(self.insights),
                context_id=self.merge_key, extra=extra)
            if self.call_log_id:
                if self.announce_saved:
                    await self.emit({"type": "session_saved", "call_id": self.call_log_id, "meeting_id": self.meeting_id,
                                     "debrief": "scheduled" if self.meeting_id else "none"})
                try:
                    await wizard_hooks.session_saved(self.meeting_id, self.call_log_id, self.user_id)
                except Exception as e:
                    print(f"⚠️ session_saved hook failed: {type(e).__name__}")
        engine, self.engine = self.engine, None
        if engine is not None and getattr(engine, "is_brain_client", False):
            self.brain_session_id = getattr(engine, "brain_session_id", None) or getattr(engine, "session_id", None)
            if not self.engine_closed:
                self.engine_closed = True
                await close_brain(engine, finalize=finalize_engine)
        self.engine_closed = True
        for track in self.tracks:
            stats = track.latency.percentiles()
            if stats["turns"]:
                print(f"[latency] {track.label}: turns={stats['turns']} p50={stats['p50_ms']}ms p95={stats['p95_ms']}ms")
        return self.call_log_id


class TrackPipeline:
    """One audio channel → turns for ``speaker``.

    ``push_audio`` is synchronous and never blocks the caller's receive loop: audio
    goes through a bounded queue (oldest dropped when STT can't keep up) to a worker
    that feeds STT and the VAD (VAD inference runs in a thread).
    """

    def __init__(self, session: LiveCopilotSession, *, speaker: str = "prospect", guidance: bool = True,
                 label: str = "audio", on_stt_failed: Optional[Callable[[], Awaitable[None]]] = None,
                 channel: int = C.CHANNEL_MIXED, keyterms=None, language_hint: Optional[str] = None):
        self.session = session
        self.speaker = speaker
        self.guidance = guidance
        self.label = label
        self.channel = channel
        self.on_stt_failed = on_stt_failed   # called once STT is given up on (after retries)
        self.stt = None
        self.vad = None
        self.td: Optional[TurnDetector] = None
        self.latency = LatencyTracker()
        self.dropped_chunks = 0
        self.audio_bytes = 0
        self.stt_options = {
            "channel": channel,
            "keyterms": list(keyterms) if keyterms is not None else session.keyterms(),
            "language_hint": language_hint or session.wizard.get("prospect_language_hint"),
            "on_event": self._on_stt_event,
        }
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=AUDIO_QUEUE_MAX_CHUNKS)
        self._worker: Optional[asyncio.Task] = None
        self._retry_task: Optional[asyncio.Task] = None
        self._debounce_task: Optional[asyncio.Task] = None
        self._legacy_buffer = ""
        self._speculative = (None, "")
        self._carry = b""
        self._closed = False
        self._accepting_transcripts = True
        self._last_audio = 0.0
        self._eot_at: Optional[float] = None
        self._seg_t0: Optional[float] = None    # STT audio-time of the current turn
        self._seg_t1: Optional[float] = None
        self._speech_t0: Optional[float] = None  # VAD session-time of the current turn
        self._speech_t1: Optional[float] = None
        session.tracks.append(self)

    # ── lifecycle ──

    async def start(self, *, stt_timeout: float = STT_CONNECT_TIMEOUT_SECONDS, retry_delays=()) -> bool:
        """Initializes VAD + turn detection and connects STT. With ``retry_delays``
        a failed STT connection is retried in the background."""
        await self._init_vad()
        connected = await self._connect_stt(stt_timeout)
        if not connected and not self._closed:
            if retry_delays:
                self._retry_task = asyncio.create_task(self._retry_stt(stt_timeout, tuple(retry_delays)))
            else:
                await self._report_stt_failure()
        self._worker = asyncio.create_task(self._run())
        return connected

    async def _report_stt_failure(self) -> None:
        if self.on_stt_failed is not None and not self._closed:
            try:
                await self.on_stt_failed()
            except Exception:
                pass

    async def _init_vad(self) -> None:
        try:
            vad = create_vad()
            ready = bool(vad) and await vad.initialize()
        except Exception:
            vad, ready = None, False
        if ready:
            self.vad = vad
            self.td = TurnDetector(on_turn_complete=self._on_turn_complete, tracker=self.latency)
        else:
            print("⚠️  VAD unavailable — using the legacy timer for turn detection")

    async def _connect_stt(self, timeout: float) -> bool:
        try:
            stt = create_stt_stream(self._on_transcript, **self.stt_options)
        except Exception as e:
            print(f"❌ STT unavailable: {type(e).__name__}")
            return False
        try:
            ok = bool(await asyncio.wait_for(stt.connect(), timeout))
        except Exception:
            ok = False
        if not ok or self._closed:
            try:
                await asyncio.wait_for(stt.close(), STT_CLOSE_TIMEOUT_SECONDS)
            except Exception:
                pass
            return False
        self.stt = stt
        return True

    async def _retry_stt(self, timeout: float, delays) -> None:
        for delay in delays:
            await asyncio.sleep(delay)
            if self._closed or self.stt is not None:
                return
            if await self._connect_stt(timeout):
                print(f"✅ STT connected after retry ({self.label})")
                return
        await self._report_stt_failure()

    def pending_tasks(self) -> set:
        tasks = set(self.td._turn_tasks) if self.td is not None else set()
        return tasks

    @property
    def stt_vendor(self) -> Optional[str]:
        return getattr(self.stt, "vendor", None) if self.stt is not None else None

    async def close(self, *, grace: float = 0.0) -> None:
        """Stops intake, lets STT deliver the last words, flushes the pending turn
        and closes STT. Call ``session.drain()``/``close()`` afterwards."""
        if self._closed:
            return
        self._closed = True
        if self._retry_task is not None:
            self._retry_task.cancel()
        self._put_nowait(None)
        if self._worker is not None:
            try:
                await asyncio.wait_for(asyncio.shield(self._worker), timeout=5.0)
            except Exception:
                self._worker.cancel()
        if grace > 0 and self.stt is not None and time.monotonic() - self._last_audio < 3.0:
            await asyncio.sleep(grace)
        self._accepting_transcripts = False   # nothing after the final flush
        if self.td is not None:
            await self.td._flush_turn_now()
            self.td.cleanup()
        if self._debounce_task is not None and not self._debounce_task.done():
            self._debounce_task.cancel()
        if self._legacy_buffer.strip():
            text, self._legacy_buffer = self._legacy_buffer.strip(), ""
            self._dispatch_turn(text)
        await asyncio.sleep(0)
        stt, self.stt = self.stt, None
        if stt is not None:
            vendor = getattr(stt, "vendor", None)
            if vendor and self.session.coach is not None:
                self.session.coach.cost.add_stt(vendor, self.audio_bytes / 32_000)
            try:
                await asyncio.wait_for(stt.close(), STT_CLOSE_TIMEOUT_SECONDS)
            except Exception as e:
                print(f"STT close error: {type(e).__name__}")

    def dispose(self) -> None:
        """Cancels leftovers (an unused speculative analysis) once the session drained."""
        task, _ = self._speculative
        self._speculative = (None, "")
        if task is not None and not task.done():
            task.cancel()

    # ── audio intake ──

    def push_audio(self, data: bytes) -> bool:
        """Queues PCM16LE/16 kHz audio. Odd byte counts are carried over (a torn
        sample would crash the VAD), oversized frames are dropped."""
        if self._closed or not data:
            return False
        if len(data) > MAX_AUDIO_FRAME_BYTES:
            self.dropped_chunks += 1
            return False
        if self._carry:
            data, self._carry = self._carry + data, b""
        if len(data) % 2:
            data, self._carry = data[:-1], data[-1:]
        if not data:
            return False
        if not self._put_nowait(data):
            self.dropped_chunks += 1
        return True

    def _put_nowait(self, item) -> bool:
        """Enqueues, dropping the oldest chunk when full (stay real-time)."""
        try:
            self._queue.put_nowait(item)
            return True
        except asyncio.QueueFull:
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            try:
                self._queue.put_nowait(item)
            except asyncio.QueueFull:
                return False
            return False

    async def _run(self) -> None:
        while True:
            chunk = await self._queue.get()
            if chunk is None:
                return
            stt = self.stt
            if stt is None:
                continue   # STT not connected (yet): nothing can be transcribed
            self._last_audio = time.monotonic()
            self.audio_bytes += len(chunk)
            try:
                await stt.send_audio(chunk)
            except Exception:
                pass
            self.latency.on_audio_sent()
            if self.vad is not None and self.td is not None:
                try:
                    events = await asyncio.to_thread(self.vad.process_chunk, chunk)
                except Exception:
                    events = []
                for event in events:
                    if event == VADEvent.SPEECH_START:
                        if self._speech_t0 is None:
                            self._speech_t0 = self.session.now_s()
                        self.td.on_speech_start()
                        self.session.on_speech(self.channel, True)
                    elif event == VADEvent.SPEECH_END:
                        self._speech_t1 = self.session.now_s()
                        self.td.on_speech_end()
                        self.session.on_speech(self.channel, False)

    # ── transcripts → turns ──

    async def _on_transcript(self, _speaker: str, text: str, is_final: bool = True, speech_final: bool = False,
                             t_start: Optional[float] = None, t_end: Optional[float] = None):
        """STT callback. The STT's own speaker label is ignored: the track decides."""
        if not self._accepting_transcripts:
            return
        text = text or ""
        if t_start is not None and (self._seg_t0 is None or t_start < self._seg_t0):
            self._seg_t0 = t_start
        if t_end is not None:
            self._seg_t1 = t_end
        if is_final and text.strip():
            self.latency.on_transcript_received()
        td = self.td
        if td is not None:
            if text.strip():
                td.on_transcript(text, is_final=is_final)
                if is_final and self.guidance:
                    self._maybe_speculate(td.transcript_buffer.strip())
                if self.guidance:
                    await self.session.on_partial(self.channel, td.transcript_buffer.strip() or text.strip())
            if speech_final:
                td.on_speech_final()
        elif is_final and text.strip():
            self._legacy_append(text)
            if self.guidance:
                await self.session.on_partial(self.channel, self._legacy_buffer.strip())
        elif text.strip() and self.guidance:
            await self.session.on_partial(self.channel, f"{self._legacy_buffer} {text}".strip())

    async def _on_stt_event(self, event: dict) -> None:
        """Vendor turn events: an authoritative end of turn flushes at once; eager end of
        turn starts speculative work; turn resumed cancels it."""
        if not self._accepting_transcripts:
            return
        kind = event.get("kind")
        if kind == "eot" and event.get("authoritative"):
            self._eot_at = time.monotonic()
            if self.td is not None:
                await self.td._flush_turn_now()
            elif self._legacy_buffer.strip():
                if self._debounce_task is not None and not self._debounce_task.done():
                    self._debounce_task.cancel()
                text, self._legacy_buffer = self._legacy_buffer.strip(), ""
                self._dispatch_turn(text)
        elif kind == "eager_eot" and self.guidance and event.get("text"):
            self._eot_at = time.monotonic()
            self._maybe_speculate(event["text"])
            await self.session.on_eager_eot(self.channel, event["text"])
        elif kind == "resumed" and self.guidance:
            self._eot_at = None
            task, _ = self._speculative
            self._speculative = (None, "")
            if task is not None and not task.done():
                task.cancel()
            self.session.on_turn_resumed(self.channel)

    def _maybe_speculate(self, current_text: str) -> None:
        """Starts the AI during the end-of-turn silence wait when the sentence looks
        complete (legacy engine only; the Brain serializes turns itself, the coach speculates itself)."""
        engine = self.session.engine
        if engine is None or self.session.engine_closed or getattr(engine, "is_brain_client", False):
            return
        if not (TurnDetector._has_endpoint(current_text) or TurnDetector._is_question(current_text)):
            return
        task, text = self._speculative
        if current_text == text:
            return
        if task is not None and not task.done():
            task.cancel()
        self._speculative = (asyncio.create_task(engine.analyze(self.speaker, current_text)), current_text)

    def _turn_times(self, text: str) -> tuple[float, float]:
        now = self.session.now_s()
        if self._seg_t0 is not None and self._seg_t1 is not None and self._seg_t1 >= self._seg_t0:
            t0, t1 = self._seg_t0, self._seg_t1
        elif self._speech_t0 is not None:
            t0, t1 = self._speech_t0, self._speech_t1 if self._speech_t1 is not None else now
        else:
            t1 = now
            t0 = max(0.0, t1 - max(0.4, C.word_count(text) / 2.5))
        self._seg_t0 = self._seg_t1 = None
        self._speech_t0 = self._speech_t1 = None
        return round(t0, 2), round(max(t0, t1), 2)

    async def _on_turn_complete(self, text: str) -> None:
        speculative, self._speculative = self._speculative, (None, "")
        eot_at, self._eot_at = (self._eot_at or time.monotonic()), None
        t_start, t_end = self._turn_times(text)
        await self.session.process_turn(
            self.speaker, text,
            latency_tracker=self.latency if self.guidance else None,
            speculative=speculative if self.guidance else None,
            channel=self.channel, t_start=t_start, t_end=t_end, eot_at=eot_at,
        )

    def _dispatch_turn(self, text: str) -> None:
        self.session.track_task(asyncio.create_task(self._on_turn_complete(text)))

    def _legacy_append(self, text: str) -> None:
        """Timer-based turn detection (no VAD): a turn ends after 2.5 s without
        new finalized text."""
        self._legacy_buffer = f"{self._legacy_buffer} {text}".strip()
        if self._debounce_task is not None and not self._debounce_task.done():
            self._debounce_task.cancel()
        self._debounce_task = asyncio.create_task(self._legacy_flush_after_delay())

    async def _legacy_flush_after_delay(self) -> None:
        try:
            await asyncio.sleep(LEGACY_TURN_SILENCE_SECONDS)
        except asyncio.CancelledError:
            return
        text, self._legacy_buffer = self._legacy_buffer.strip(), ""
        if text:
            # A separate task: new speech cancels this timer, never a running analysis.
            self._dispatch_turn(text)


class AudioEndpoint:
    """The tracks behind one ``/ws/audio`` socket (one for v1, one per channel for v2)."""

    def __init__(self, session: LiveCopilotSession):
        self.session = session
        self.tracks: dict = {}
        self.protocol = 1
        self.warmup: Optional[asyncio.Task] = None

    def route(self, channel: int):
        track = self.tracks.get(channel)
        if track is None and channel == C.CHANNEL_MIXED:
            track = self.tracks.get(C.CHANNEL_PROSPECT)
        return track

    async def close(self, *, grace: float = 0.0) -> None:
        if self.warmup is not None and not self.warmup.done():
            try:
                await asyncio.wait_for(asyncio.shield(self.warmup), 5.0)
            except Exception:
                self.warmup.cancel()
        await asyncio.gather(*(track.close(grace=grace) for track in self.tracks.values()), return_exceptions=True)

    def dispose(self) -> None:
        for track in self.tracks.values():
            track.dispose()


def _parse_hello(text: str) -> Optional[dict]:
    if not isinstance(text, str) or "hello" not in text or len(text) > 4000:
        return None
    try:
        data = json.loads(text)
    except ValueError:
        return None
    if not isinstance(data, dict) or data.get("type") != "hello":
        return None
    try:
        if int(data.get("protocol") or 1) < 2:
            return None
    except (TypeError, ValueError):
        return None
    return data


class ConnectionManager:
    """``/ws`` and ``/ws/audio``: one ``LiveCopilotSession`` per socket."""

    def __init__(self):
        self.active_connections: list = []
        from services.call_context_engine import call_context_engine
        self.call_context_engine = call_context_engine
        self.sessions: dict = {}
        self.tracks: dict = {}
        self._teardown_tasks: dict = {}
        self._background: set = set()

    async def connect(self, websocket: WebSocket, context_id: Optional[str] = None):
        protocols = getattr(websocket, 'headers', {}).get('sec-websocket-protocol', '').split(',')
        if 'clozflow' in [value.strip() for value in protocols]:
            await websocket.accept(subprotocol='clozflow')
        else:
            await websocket.accept()
        self.active_connections.append(websocket)

        call_context = None
        if context_id:
            call_context = await asyncio.to_thread(self.call_context_engine.get_context, context_id)
            if call_context:
                call_context = {**call_context, '_context_id': context_id}

        async def sink(message, ws=websocket):
            await ws.send_text(json.dumps(message, default=str))

        session = LiveCopilotSession(call_context=call_context, sink=sink, persist=bool(call_context), label="ws",
                                     merge_key=context_id if call_context else None, announce_saved=True)
        self.sessions[websocket] = session
        await session.start()
        print(f"🔌 Client connected. Active WebSockets: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        """Schedules teardown (kept synchronous for older callers)."""
        self._schedule_teardown(websocket, finalize_engine=False)

    async def disconnect_async(self, websocket: WebSocket, *, finalize_engine: bool = False):
        task = self._schedule_teardown(websocket, finalize_engine=finalize_engine)
        if task is not None:
            await asyncio.shield(task)

    def _schedule_teardown(self, websocket, *, finalize_engine: bool):
        existing = self._teardown_tasks.get(websocket)
        if existing is not None:
            return existing
        if websocket not in self.sessions and websocket not in self.active_connections:
            return None
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return None
        task = loop.create_task(self._teardown(websocket, finalize_engine=finalize_engine))
        self._teardown_tasks[websocket] = task
        self._background.add(task)
        task.add_done_callback(self._background.discard)
        return task

    async def _teardown(self, websocket, *, finalize_engine: bool):
        try:
            if websocket in self.active_connections:
                self.active_connections.remove(websocket)
            endpoint = self.tracks.pop(websocket, None)
            session = self.sessions.pop(websocket, None)
            if endpoint is not None:
                await endpoint.close(grace=0.8 if finalize_engine else 0.3)
            if session is not None:
                await session.close(finalize_engine=finalize_engine, save=True)
            if endpoint is not None:
                endpoint.dispose()
            print("❌ Client disconnected.")
        except Exception as e:
            print(f"❌ Copilot session teardown error: {type(e).__name__}")
        finally:
            self._teardown_tasks.pop(websocket, None)

    async def shutdown(self):
        for websocket in list(self.sessions) + list(self.active_connections):
            self._schedule_teardown(websocket, finalize_engine=False)
        if self._background:
            await asyncio.gather(*list(self._background), return_exceptions=True)

    async def handle_live_message(self, message: dict, websocket: WebSocket):
        """Receive completed transcripts (and protocol v2 control messages) from the main application (no audio)."""
        session = self.sessions.get(websocket)
        if session is None:
            return
        if isinstance(message, dict) and message.get('type') == 'end_session':
            if session.is_brain:
                brain_session_id = await session.finalize_engine()
                await session.emit({'type': 'session_ended', 'brain_session_id': brain_session_id})
            return
        if isinstance(message, dict) and message.get("type") == "hello":
            session.hello_at = time.monotonic()
            await session.emit(session.enable_v2(channels=message.get("channels"), intensity=message.get("intensity"),
                                                 client=message.get("client"), meeting_id=message.get("meeting_id")))
            return
        if isinstance(message, dict) and message.get("type") not in ("transcriptUpdate", None) \
                and await session.handle_client_message(message):
            return
        if not isinstance(message, dict) or message.get("type") != "transcriptUpdate" or not message.get("is_final", True):
            return
        text = message.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_MESSAGE_CHARS:
            return
        speaker = str(message.get("speaker", "prospect")).lower()
        if speaker not in LIVE_SPEAKERS:
            speaker = "unknown"
        channel = message.get("channel") if message.get("channel") in (0, 1, 2) else None
        await session.process_turn(speaker, text, channel=channel)

    # ==============================
    # AUDIO STREAM HANDLER (/ws/audio)
    # ==============================

    async def _start_v1(self, session: LiveCopilotSession, endpoint: AudioEndpoint, websocket: WebSocket) -> bool:
        session.channel_kind = session.channel_kind or session.wizard.get("channel") or "mic"
        track = TrackPipeline(session, speaker="prospect", guidance=True, label="mic", channel=C.CHANNEL_MIXED)
        endpoint.tracks[C.CHANNEL_MIXED] = track
        if not await track.start():
            print("❌ Failed to connect to the transcription service")
            session.persist = False   # nothing was said: no empty History entry
            await session.emit({"type": "error", "code": "stt_unavailable"})
            return False
        print("✅ Transcription stream connected")
        return True

    async def _start_v2(self, session: LiveCopilotSession, endpoint: AudioEndpoint, hello: dict, websocket: WebSocket) -> bool:
        """``ready`` goes out at once (clients fall back to v1 after 2.5 s); STT connects concurrently and
        reports ``notice{code:"warm", warmup_ms, channels}`` (or ``error stt_unavailable`` + close 1011)."""
        session.hello_at = time.monotonic()
        endpoint.protocol = 2
        channels = hello.get("channels") if isinstance(hello.get("channels"), list) else ["mixed"]
        ids = {CHANNEL_NAMES.get(str(name).lower(), C.CHANNEL_MIXED) for name in channels} or {C.CHANNEL_MIXED}
        if C.CHANNEL_MIXED in ids and len(ids) > 1:
            ids.discard(C.CHANNEL_MIXED)
        ready = session.enable_v2(channels=channels, intensity=hello.get("intensity"), client=hello.get("client"),
                                  meeting_id=hello.get("meeting_id"))
        for channel in sorted(ids):
            if channel == C.CHANNEL_REP:
                endpoint.tracks[channel] = TrackPipeline(session, speaker="salesperson", guidance=False, label="rep", channel=channel)
            else:
                endpoint.tracks[channel] = TrackPipeline(session, speaker="prospect", guidance=True,
                                                         label="prospect" if channel == C.CHANNEL_PROSPECT else "mixed", channel=channel)
        ready["warmup_ms"] = None
        ready["channels"] = {str(channel): "connecting" for channel in sorted(ids)}
        await session.emit(ready)
        endpoint.warmup = asyncio.create_task(self._warm_v2(session, endpoint, websocket, sorted(ids)))
        return True

    async def _warm_v2(self, session: LiveCopilotSession, endpoint: AudioEndpoint, websocket: WebSocket, ids: list) -> None:
        results = await asyncio.gather(*(endpoint.tracks[channel].start() for channel in ids), return_exceptions=True)
        status = {channel: (result is True) for channel, result in zip(ids, results)}
        guidance_ok = any(ok for channel, ok in status.items() if channel != C.CHANNEL_REP)
        if not guidance_ok:
            print("❌ Failed to connect to the transcription service")
            if not session.transcripts:
                session.persist = False
            await session.emit({"type": "error", "code": "stt_unavailable"})
            await self._close_1011(websocket)
            return
        warmup_ms = int((time.monotonic() - (session.hello_at or time.monotonic())) * 1000)
        await session.emit({"type": "notice", "code": "warm", "text": "Listening.", "warmup_ms": warmup_ms,
                            "channels": {str(channel): ("ready" if ok else "unavailable") for channel, ok in status.items()}})
        if C.CHANNEL_REP in status and not status[C.CHANNEL_REP]:
            await session.emit({"type": "notice", "code": "rep_stt_unavailable",
                                "text": "Your microphone channel couldn't be transcribed; coaching continues on the prospect's audio."})
        print("✅ Transcription streams connected (protocol 2)")

    async def handle_audio_stream(self, websocket: WebSocket):
        """Binary PCM16LE/16 kHz mono frames in; ``transcriptUpdate``/``aiAnalysis`` (v1) or the
        protocol v2 messages out. A text frame containing ``close_stream`` ends the session
        (Brain: finalized). A v2 client sends ``{"type":"hello","protocol":2,...}`` first and
        tags every frame with a channel byte."""
        session = self.sessions.get(websocket)
        if session is None:
            return
        finalize = False
        endpoint = AudioEndpoint(session)
        self.tracks[websocket] = endpoint
        started = False
        try:
            while True:
                if not started:
                    try:
                        message = await asyncio.wait_for(websocket.receive(), HELLO_WAIT_SECONDS)
                    except asyncio.TimeoutError:
                        message = None
                else:
                    message = await websocket.receive()
                if message is None:
                    # No hello within the grace period: a v1 client that hasn't spoken yet.
                    if not await self._start_v1(session, endpoint, websocket):
                        await self._close_1011(websocket)
                        return
                    started = True
                    continue
                if message.get("type") == "websocket.disconnect":
                    break
                data = message.get("bytes")
                text = message.get("text")
                if not started:
                    hello = _parse_hello(text) if text is not None else None
                    if hello is not None:
                        await self._start_v2(session, endpoint, hello, websocket)
                        started = True
                        continue
                    if not await self._start_v1(session, endpoint, websocket):
                        await self._close_1011(websocket)
                        return
                    started = True
                if data is not None:
                    if endpoint.protocol >= 2:
                        if len(data) < 2:
                            continue
                        track = endpoint.route(data[0])
                        if track is not None:
                            track.push_audio(data[1:])
                    else:
                        track = endpoint.route(C.CHANNEL_MIXED)
                        if track is not None:
                            track.push_audio(data)
                    continue
                if isinstance(text, str):
                    if endpoint.protocol >= 2:
                        try:
                            payload = json.loads(text) if len(text) <= MAX_TEXT_MESSAGE_CHARS else None
                        except ValueError:
                            payload = None
                        if isinstance(payload, dict) and payload.get("type") == "close_stream":
                            finalize = True
                            break
                        if isinstance(payload, dict):
                            await session.handle_client_message(payload)
                        elif "close_stream" in text:
                            finalize = True
                            break
                    elif "close_stream" in text:
                        finalize = True
                        break
        except WebSocketDisconnect:
            pass
        except RuntimeError:
            print("⚠️ WebSocket runtime error (likely disconnect)")
        finally:
            await self.disconnect_async(websocket, finalize_engine=finalize)
            try:   # a clean close (after close_stream the last results were sent first)
                await websocket.close(code=1000)
            except Exception:
                pass

    async def _close_1011(self, websocket: WebSocket) -> None:
        try:
            await websocket.close(code=1011)
        except Exception:
            pass


websocket_manager = ConnectionManager()
