"""Copilot bridge call: state machine, carrier events, billing and the live pipeline.

Status: created → ringing_rep → rep_answered → ringing_prospect → connected → ended
(any state → ended). The DB row is the source of truth; every transition is a
conditional UPDATE, and per-call work is serialized with an in-process lock, so
duplicated or reordered carrier callbacks are harmless. In-memory state (event hub,
audio pipeline, media socket) lives in ``LiveBridgeCall`` and assumes one backend
process, as deployed (``uvicorn --workers 1``).

Never log phone numbers, transcripts or tokens: log lines carry an 8-char call ref.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import math
import re
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from sqlalchemy import update

from database import SessionLocal, engine as db_engine
from models_bridge import CopilotBridgeCall
from services import credit_service
from services import websocket_service as live_pipeline
from services.bridge import billing, vobiz
from services.bridge.audio import FrameDecoder, PcmChunker, Preroll, parse_media_format
from services.bridge.config import load_config
from services.bridge.hub import EventHub
from services.bridge.phones import mask_phone, normalize_phone
from services.bridge.xml_builder import answer_xml, confirm_xml, hangup_xml
from services.wizard import contracts as wizard_contracts

log = logging.getLogger("clozflow.bridge")

CREATED = "created"
RINGING_REP = "ringing_rep"
REP_ANSWERED = "rep_answered"
RINGING_PROSPECT = "ringing_prospect"
CONNECTED = "connected"
ENDED = "ended"
RINGING_STATES = frozenset({CREATED, RINGING_REP, REP_ANSWERED, RINGING_PROSPECT})
ACTIVE_STATES = RINGING_STATES | {CONNECTED}

REASONS = frozenset({
    "completed", "rep_no_answer", "rep_busy", "rep_failed", "prospect_no_answer", "prospect_busy",
    "prospect_failed", "cancelled", "insufficient_credits", "telephony_error", "timeout", "server_restart",
})

DETAIL_NOT_SET_UP = "Calling isn't set up on this server yet."
DETAIL_BAD_PROSPECT = "Enter a valid phone number for the prospect."
DETAIL_BAD_REP = "Enter a valid phone number for your phone."
DETAIL_SAME_NUMBER = "Your number and the prospect's number must be different."
DETAIL_NO_BRIEF = "Call brief not found or expired. Start the briefing again."
DETAIL_IN_PROGRESS = "You already have a call in progress."
DETAIL_PROVIDER = "The phone provider couldn't place the call. Try again in a moment."

STATUS_DETAILS = {
    CREATED: "Starting the call…",
    RINGING_REP: "Calling your phone…",
    REP_ANSWERED: "You answered. Connecting…",
    CONNECTED: "Live",
}
END_DETAILS = {
    "completed": "Call ended.",
    "rep_no_answer": "You didn't answer the call to your phone.",
    "rep_busy": "Your phone was busy or declined the call.",
    "rep_failed": "We couldn't reach your phone.",
    "prospect_no_answer": "The prospect didn't answer.",
    "prospect_busy": "The prospect's line was busy or they declined.",
    "prospect_failed": "We couldn't reach the prospect's number.",
    "cancelled": "Call cancelled.",
    "insufficient_credits": "Call ended: your wallet balance ran out.",
    "telephony_error": "The phone provider couldn't place the call.",
    "timeout": "The phone provider stopped responding, so the call was ended.",
    "server_restart": "The call was interrupted by a server restart.",
}

RING_TIMEOUT_SECONDS = 90          # contract: no carrier callback within 90 s of a ringing state
REP_RING_SECONDS = 45              # how long the rep's phone rings
DIAL_TIMEOUT_SECONDS = 40          # how long the prospect's phone rings
A_LEG_EXTRA_SECONDS = 300          # rep-leg time_limit = bridge limit + ringing/prompt time
AFTER_BRIDGE_END_GRACE = 60        # prospect leg gone but no final callback yet
CONNECTED_OVERRUN_GRACE = 60       # past timeLimit: hang up ourselves
STALE_AFTER = timedelta(minutes=10)
LIVE_RETENTION_SECONDS = 300       # keep the replay for late app reconnects
PIPELINE_START_WAIT = 20.0
STT_RETRY_DELAYS = (2.0, 5.0, 10.0)

# media.track → (speaker, gets guidance). inbound = audio from the rep (A-leg),
# outbound = audio sent to the rep = the prospect once bridged.
TRACKS = {"inbound": ("salesperson", False), "outbound": ("prospect", True)}
# Meeting Wizard channel ids per track (protocol v2: 1 = rep, 2 = prospect).
TRACK_CHANNELS = {"inbound": wizard_contracts.CHANNEL_REP, "outbound": wizard_contracts.CHANNEL_PROSPECT}
DISCLOSURE_OPEN_AUDIO_GRACE = 6.0   # seconds after DialAnswer before audio flows when a disclosure plays
CONFIRM_TIMEOUT_SECONDS = 8

_UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_DUMMY_HASH = hashlib.sha256(b"clozflow-bridge-no-such-call").hexdigest()


class BridgeError(Exception):
    def __init__(self, status_code: int, detail: str, **extra):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.extra = extra


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _iso(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value.replace(microsecond=0).isoformat() + "Z"


def _ref(call_id: str) -> str:
    return (call_id or "")[:8]


def hash_token(token: str) -> str:
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()


def _money(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f"{value:.2f}"


# ── DB helpers (sync; always called through asyncio.to_thread) ────────────────

_COLUMNS = [column.name for column in CopilotBridgeCall.__table__.columns]


def _as_dict(row) -> Optional[dict]:
    return None if row is None else {name: getattr(row, name) for name in _COLUMNS}


def _db_ensure_table() -> None:
    CopilotBridgeCall.__table__.create(bind=db_engine, checkfirst=True)


def _db_get(call_id: str) -> Optional[dict]:
    with SessionLocal() as db:
        return _as_dict(db.get(CopilotBridgeCall, call_id))


def _db_insert(values: dict) -> None:
    with SessionLocal() as db:
        db.add(CopilotBridgeCall(**values))
        db.commit()


def _db_update(call_id: str, values: dict, allowed_from=None) -> Optional[dict]:
    """Conditional UPDATE; returns the updated row, or None when it didn't apply."""
    with SessionLocal() as db:
        statement = update(CopilotBridgeCall).where(CopilotBridgeCall.id == call_id)
        if allowed_from is not None:
            statement = statement.where(CopilotBridgeCall.status.in_(list(allowed_from)))
        result = db.execute(statement.values(**values).execution_options(synchronize_session=False))
        db.commit()
        if result.rowcount != 1:
            return None
        return _as_dict(db.get(CopilotBridgeCall, call_id))


def _db_active_for_user(user_id: int) -> Optional[dict]:
    with SessionLocal() as db:
        row = (db.query(CopilotBridgeCall)
               .filter(CopilotBridgeCall.user_id == user_id, CopilotBridgeCall.status != ENDED)
               .order_by(CopilotBridgeCall.created_at.desc()).first())
        return _as_dict(row)


def _db_non_ended() -> list:
    with SessionLocal() as db:
        return [_as_dict(row) for row in db.query(CopilotBridgeCall).filter(CopilotBridgeCall.status != ENDED).all()]


def _db_wallet_check(user_id: int, rate: float, cap_seconds: int):
    """(may call, max connected seconds, limited by the wallet)."""
    with SessionLocal() as db:
        if rate > 0 and not credit_service.has_sufficient_balance(db, user_id, rate):
            return False, 0, False
        seconds, capped = billing.affordable_seconds(db, user_id, rate, cap_seconds)
        return True, seconds, capped


def _db_bill(call_id: str) -> Optional[float]:
    """Charges an ended call exactly once (claims ``billed_at`` first)."""
    with SessionLocal() as db:
        claimed = db.execute(
            update(CopilotBridgeCall)
            .where(CopilotBridgeCall.id == call_id, CopilotBridgeCall.billed_at.is_(None),
                   CopilotBridgeCall.status == ENDED)
            .values(billed_at=utcnow()).execution_options(synchronize_session=False))
        db.commit()
        if claimed.rowcount != 1:
            return None
        row = db.get(CopilotBridgeCall, call_id)
        user_id, seconds, rate = row.user_id, int(row.duration_seconds or 0), float(row.rate_per_minute or 0)
        charged = billing.charge_call(db, user_id=user_id, seconds=seconds, rate_per_minute=rate,
                                      call_ref=_ref(call_id))
        db.execute(update(CopilotBridgeCall).where(CopilotBridgeCall.id == call_id)
                   .values(charged_credits=charged).execution_options(synchronize_session=False))
        db.commit()
        return charged


def _db_mark_stale(cutoff: datetime) -> list:
    """Startup: non-ended rows older than ``cutoff`` → ended/server_restart."""
    now = utcnow()
    with SessionLocal() as db:
        rows = (db.query(CopilotBridgeCall)
                .filter(CopilotBridgeCall.status != ENDED, CopilotBridgeCall.created_at < cutoff).all())
        stale = [_as_dict(row) for row in rows]
        for row in rows:
            row.status = ENDED
            row.reason = "server_restart"
            row.ended_at = now
            row.status_changed_at = now
        db.commit()
        return stale


# ── Serialization ─────────────────────────────────────────────────────────────

def detail_for(row: dict) -> str:
    status = row["status"]
    if status == ENDED:
        return END_DETAILS.get(row.get("reason") or "", "Call ended.")
    if status == RINGING_PROSPECT:
        name = row.get("prospect_name")
        return f"Calling {name}…" if name else "Calling the prospect…"
    if status == CONNECTED and row.get("balance_capped"):
        minutes = max(1, int(row.get("max_seconds") or 0) // 60)
        return f"Live · ends after {minutes} min (wallet balance)"
    return STATUS_DETAILS.get(status, "")


def serialize(row: dict, now: Optional[datetime] = None) -> dict:
    duration = int(row.get("duration_seconds") or 0)
    if row["status"] == CONNECTED and row.get("connected_at"):
        duration = min(int(row.get("max_seconds") or 0),
                       max(0, int(((now or utcnow()) - row["connected_at"]).total_seconds())))
    return {
        "call_id": row["id"],
        "context_id": row["context_id"],
        "status": row["status"],
        "reason": row.get("reason") if row["status"] == ENDED else None,
        "detail": detail_for(row),
        "prospect_name": row.get("prospect_name"),
        "prospect_phone_masked": mask_phone(row.get("prospect_phone_e164")),
        "rep_phone_masked": mask_phone(row.get("rep_phone_e164")),
        "created_at": _iso(row.get("created_at")),
        "connected_at": _iso(row.get("connected_at")),
        "ended_at": _iso(row.get("ended_at")),
        "duration_seconds": duration,
        "charged_credits": round(float(row.get("charged_credits") or 0.0), 2),
        "call_log_id": row.get("call_log_id"),
    }


def status_message(row: dict) -> dict:
    return {"type": "callStatus", "call": serialize(row)}


# ── Hang-up reason classification (defensive: Vobiz documents few values) ────

def _norm(value) -> str:
    return re.sub(r"[\s\-]+", "_", str(value or "").strip()).upper()


# Vobiz numeric HangupCauseCode values (https://www.vobiz.ai/docs/concepts/hangup-causes):
# 3010 Busy Line, 3020 Rejected, 3100 Busy everywhere, 3110 Declined.
_BUSY_CODES = {3010, 3020, 3100, 3110}
# 3000 No Answer, 6010 Ring Timeout Reached.
_NO_ANSWER_CODES = {3000, 6010}
# Destination (2000–2070), caller ID / forbidden / unallocated (3030–3050), carrier
# (3070–3090, 3120–3140), system (5000–5030), URL/XML (7xxx/8xxx) errors, out of credits.
_FAILED_CODE_RANGES = ((1010, 1020), (2000, 2070), (3030, 3050), (3070, 3090), (3120, 3140),
                       (5000, 5030), (7000, 8999))


def hangup_cause_code(params: dict) -> Optional[int]:
    raw = str(params.get("HangupCauseCode") or "").strip()
    return int(raw) if raw.isdigit() else None


def rep_reason(params: dict) -> str:
    """Why the rep's leg ended before it was answered."""
    call_status = _norm(params.get("CallStatus") or params.get("Status"))
    cause = " ".join(_norm(params.get(key)) for key in ("HangupCause", "HangupCauseName", "HangupCauseCode"))
    code = hangup_cause_code(params)
    if code in _BUSY_CODES:
        return "rep_busy"
    if code in _NO_ANSWER_CODES:
        return "rep_no_answer"
    if code is not None and any(low <= code <= high for low, high in _FAILED_CODE_RANGES):
        return "rep_failed"
    if call_status == "BUSY" or any(word in cause for word in ("BUSY", "REJECT", "DECLINE")):
        return "rep_busy"
    if call_status in {"NO_ANSWER", "NOANSWER", "TIMEOUT", "CANCEL", "CANCELED", "CANCELLED"} or any(
            word in cause for word in ("NO_ANSWER", "NO_USER_RESPONSE", "TIMEOUT", "TIMER_EXPIRE",
                                       "ORIGINATOR_CANCEL")):
        return "rep_no_answer"
    if call_status == "FAILED" or any(word in cause for word in (
            "UNALLOCATED", "INVALID", "NO_ROUTE", "OUT_OF_ORDER", "OUT_OF_SERVICE", "UNAVAILABLE",
            "TEMPORARY_FAILURE", "FAILURE", "ABSENT", "BARRED", "UNREACHABLE", "FORBIDDEN", "SPAM",
            "NOT_REGISTERED", "ERROR")):
        return "rep_failed"
    return "rep_no_answer"


def dial_reason(dial_status: Optional[str]) -> Optional[str]:
    """Final reason from the prospect leg's DialStatus."""
    status = _norm(dial_status)
    if not status:
        return None
    if status == "COMPLETED":
        return "completed"
    if status in {"BUSY", "REJECTED"}:
        return "prospect_busy"
    if status in {"NO_ANSWER", "NOANSWER", "TIMEOUT"}:
        return "prospect_no_answer"
    if status in {"CANCEL", "CANCELED", "CANCELLED"}:
        return "cancelled"
    return "prospect_failed"


def dial_status_from_cause(params: dict) -> Optional[str]:
    """Provisional DialStatus from a DialHangup event of an unanswered prospect leg."""
    cause = " ".join(_norm(params.get(key)) for key in (
        "DialBLegHangupCause", "DialBLegHangupCauseName", "DialBLegStatus"))
    if not cause.strip():
        return None
    if any(word in cause for word in ("BUSY", "REJECT", "DECLINE")):
        return "busy"
    if any(word in cause for word in ("NO_ANSWER", "NO_USER_RESPONSE", "TIMEOUT", "TIMER_EXPIRE")):
        return "no-answer"
    if "CANCEL" in cause:
        return "cancel"
    return "failed"


# ── In-memory part of a call ──────────────────────────────────────────────────

class LiveBridgeCall:
    def __init__(self, service: "BridgeService", call_id: str, user_id: int):
        self.service = service
        self.call_id = call_id
        self.user_id = user_id
        self.hub = EventHub()
        self.lock = asyncio.Lock()
        self.media_socket = None
        self.audio_open = False            # the bridge is up: audio goes to the pipeline
        self.ended = False
        self.finalize_task: Optional[asyncio.Task] = None
        self.finalized_at: Optional[float] = None
        self.session: Optional[live_pipeline.LiveCopilotSession] = None
        self.tracks: Dict[str, live_pipeline.TrackPipeline] = {}
        self.decoders = {name: FrameDecoder() for name in TRACKS}
        self.chunkers = {name: PcmChunker() for name in TRACKS}
        self.preroll = {name: Preroll(seconds=1.0) for name in TRACKS}
        self.bad_frames = 0
        self._pipeline_task: Optional[asyncio.Task] = None
        self._open_audio_task: Optional[asyncio.Task] = None
        self.disclosure_played = False

    # ── pipeline ──

    def ensure_pipeline(self) -> None:
        if self.session is not None or self.ended:
            return

        async def sink(message: dict) -> None:
            self.hub.publish(message)

        self.session = live_pipeline.LiveCopilotSession(
            call_context=None, sink=sink, user_id=self.user_id, persist=True, learning_log=False, label="bridge",
            live_features=True, channel_tagged=True, channel_kind="phone_bridge")
        for name, (speaker, guidance) in TRACKS.items():
            async def stt_gave_up(speaker=speaker):
                # After all retries: this side of the call has no live transcript.
                self.hub.publish({"type": "error", "code": "stt_unavailable", "speaker": speaker})
            self.tracks[name] = live_pipeline.TrackPipeline(
                self.session, speaker=speaker, guidance=guidance, label=f"bridge-{name}",
                on_stt_failed=stt_gave_up, channel=TRACK_CHANNELS[name], keyterms=[])
        self._pipeline_task = self.service.spawn(self._start_pipeline())

    async def _start_pipeline(self) -> None:
        row = await asyncio.to_thread(_db_get, self.call_id)
        context = None
        if row:
            from services.call_context_engine import call_context_engine
            context = await asyncio.to_thread(call_context_engine.get_context, row["context_id"])
        context = dict(context or {})
        context["user_id"] = self.user_id
        # A Brain session of its own per bridge call (resumable if the pipeline restarts).
        context["_context_id"] = f"bridge-{self.call_id}"
        self.session.adopt_call_context(context)
        keyterms = self.session.keyterms()
        for track in self.tracks.values():
            track.stt_options["keyterms"] = keyterms
            track.stt_options["language_hint"] = self.session.wizard.get("prospect_language_hint")
        results = await asyncio.gather(
            self.session.start(),
            *(track.start(retry_delays=STT_RETRY_DELAYS) for track in self.tracks.values()),
            return_exceptions=True)
        if any(result is False or isinstance(result, BaseException) for result in results[1:]):
            log.warning("bridge %s: live transcription unavailable on a track (retrying)", _ref(self.call_id))
        if self.disclosure_played and self.session is not None and not self.ended:
            # The carrier played our spoken disclosure to the prospect: that is the consent record.
            await self.session.record_consent("bridge_disclosure", script=load_config().disclosure_text)

    def schedule_open_audio(self, delay: float) -> None:
        """Open the audio after ``delay`` seconds (the disclosure is playing) unless DialConnected arrives first."""
        if self.audio_open or self.ended or (self._open_audio_task is not None and not self._open_audio_task.done()):
            return

        async def later():
            try:
                await asyncio.sleep(delay)
            except asyncio.CancelledError:
                return
            self.open_audio()
        self._open_audio_task = self.service.spawn(later())

    def on_stream_start(self, start: dict) -> None:
        # start.mediaFormat is authoritative (the XML contentType is only a request).
        encoding, rate = parse_media_format(start.get("mediaFormat"))
        if encoding or rate:
            for decoder in self.decoders.values():
                decoder.configure(encoding, rate)
        self.ensure_pipeline()

    def on_media(self, media: dict) -> None:
        track = media.get("track")
        if track not in TRACKS:
            self.bad_frames += 1
            return
        pcm = self.decoders[track].decode(media.get("payload"))
        if pcm is None:
            self.bad_frames += 1
            return
        self.ensure_pipeline()
        if not self.audio_open or track not in self.tracks:
            self.preroll[track].add(pcm)   # ringback/silence until the prospect answers
            return
        for chunk in self.chunkers[track].push(pcm):
            self.tracks[track].push_audio(chunk)

    def open_audio(self) -> None:
        """The prospect answered: audio flows to the pipeline from now on (plus the
        last second before, so a quick "Hello?" isn't lost)."""
        if self.audio_open or self.ended:
            return
        if self._open_audio_task is not None and not self._open_audio_task.done():
            self._open_audio_task.cancel()
        self.audio_open = True
        for name, track in self.tracks.items():
            for pcm in self.preroll[name].drain():
                for chunk in self.chunkers[name].push(pcm):
                    track.push_audio(chunk)

    async def close_media(self) -> None:
        socket, self.media_socket = self.media_socket, None
        if socket is not None:
            try:
                await socket.close(code=1000)
            except Exception:
                pass

    async def shutdown_pipeline(self, *, save: bool, finalize_engine: bool = True) -> Optional[int]:
        """Flushes both tracks, waits for the last AI results, saves the CallLog."""
        if self.session is None:
            return None
        if self._pipeline_task is not None and not self._pipeline_task.done():
            try:
                await asyncio.wait_for(asyncio.shield(self._pipeline_task), PIPELINE_START_WAIT)
            except Exception:
                pass
        for name, track in self.tracks.items():
            rest = self.chunkers[name].flush()
            if rest and self.audio_open:
                track.push_audio(rest)
        await asyncio.gather(*(track.close(grace=0.8) for track in self.tracks.values()),
                             return_exceptions=True)
        call_log_id = await self.session.close(finalize_engine=finalize_engine, save=save)
        for track in self.tracks.values():
            track.dispose()
        if finalize_engine and self.session.brain_session_id:
            self.hub.publish({"type": "session_ended", "brain_session_id": self.session.brain_session_id})
        return call_log_id

    @property
    def has_transcript(self) -> bool:
        return bool(self.session and self.session.transcripts)


# ── Service ───────────────────────────────────────────────────────────────────

class BridgeService:
    def __init__(self):
        self.calls: Dict[str, LiveBridgeCall] = {}
        self.telephony_factory = vobiz.default_client
        self.watchdog_interval = 5.0
        self._user_locks: Dict[int, asyncio.Lock] = {}
        self._background: set = set()
        self._watchdog: Optional[asyncio.Task] = None

    # ── plumbing ──

    def spawn(self, coro) -> asyncio.Task:
        task = asyncio.get_running_loop().create_task(coro)
        self._background.add(task)
        task.add_done_callback(self._background.discard)
        return task

    def telephony(self):
        return self.telephony_factory()

    def live(self, call_id: str, user_id: int) -> LiveBridgeCall:
        call = self.calls.get(call_id)
        if call is None:
            call = self.calls[call_id] = LiveBridgeCall(self, call_id, user_id)
        return call

    def _user_lock(self, user_id: int) -> asyncio.Lock:
        lock = self._user_locks.get(user_id)
        if lock is None:
            lock = self._user_locks[user_id] = asyncio.Lock()
        return lock

    def publish_status(self, row: Optional[dict]) -> None:
        if row is None:
            return
        call = self.calls.get(row["id"])
        if call is not None:
            call.hub.publish(status_message(row))

    async def get_row(self, call_id: str) -> Optional[dict]:
        if not isinstance(call_id, str) or not _UUID_RE.fullmatch(call_id):
            return None
        return await asyncio.to_thread(_db_get, call_id)

    @staticmethod
    def carrier_urls(config, call_id: str, token: str) -> dict:
        query = f"bid={call_id}&t={token}"
        base = f"{config.public_url}/api/copilot/bridge/vobiz"
        return {
            "answer": f"{base}/answer?{query}",
            "hangup": f"{base}/hangup?{query}",
            "dial_events": f"{base}/dial-events?{query}",
            "dial_result": f"{base}/dial-result?{query}",
            "stream_status": f"{base}/stream-status?{query}",
            "confirm": f"{base}/confirm?{query}",
            "media": f"{config.ws_base}/api/copilot/bridge/vobiz/media?{query}",
        }

    @staticmethod
    def _disclosure_wanted(config, context: Optional[dict]) -> bool:
        """Server policy (``COPILOT_BRIDGE_DISCLOSURE``) and the meeting's own flag (``wizard.bridge_disclosure``)."""
        if not config.disclosure_enabled:
            return False
        wizard = (context or {}).get("wizard") if isinstance(context, dict) else None
        if isinstance(wizard, dict) and wizard.get("bridge_disclosure") is False:
            return False
        return True

    # ── app API ──

    async def create_call(self, user, *, context_id, prospect_phone, rep_phone, prospect_name) -> dict:
        config = load_config()
        if not config.enabled:
            raise BridgeError(503, DETAIL_NOT_SET_UP)
        prospect = normalize_phone(prospect_phone)
        if prospect is None:
            raise BridgeError(400, DETAIL_BAD_PROSPECT)
        rep = normalize_phone(rep_phone)
        if rep is None:
            raise BridgeError(400, DETAIL_BAD_REP)
        if prospect == rep:
            raise BridgeError(400, DETAIL_SAME_NUMBER)
        context = None
        if isinstance(context_id, str) and 0 < len(context_id.strip()) <= 64:
            from services.call_context_engine import call_context_engine
            context = await asyncio.to_thread(call_context_engine.get_context, context_id.strip())
        if not context or context.get("user_id") != user.id:
            raise BridgeError(404, DETAIL_NO_BRIEF)
        name = None
        if isinstance(prospect_name, str):
            name = " ".join(prospect_name.split())[:120] or None

        async with self._user_lock(user.id):
            active = await asyncio.to_thread(_db_active_for_user, user.id)
            if active is not None:
                raise BridgeError(409, DETAIL_IN_PROGRESS, call_id=active["id"])
            may_call, max_seconds, capped = await asyncio.to_thread(
                _db_wallet_check, user.id, config.rate_per_minute, config.max_minutes * 60)
            if not may_call:
                raise BridgeError(402, "Not enough wallet credits to place a call. "
                                       f"You need at least ₹{_money(config.min_balance)}.")
            call_id = str(uuid.uuid4())
            token = secrets.token_urlsafe(32)
            now = utcnow()
            await asyncio.to_thread(_db_insert, {
                "id": call_id, "user_id": user.id, "context_id": context_id.strip(), "status": CREATED,
                "prospect_name": name, "prospect_phone_e164": prospect, "rep_phone_e164": rep,
                "token_hash": hash_token(token), "rate_per_minute": config.rate_per_minute,
                "max_seconds": max_seconds, "balance_capped": capped, "created_at": now,
                "status_changed_at": now, "duration_seconds": 0, "charged_credits": 0.0,
                "cancel_requested": False,
            })
        self.live(call_id, user.id)
        log.info("bridge %s created (limit %ss)", _ref(call_id), max_seconds)

        urls = self.carrier_urls(config, call_id, token)
        result = await self.telephony().place_call(
            to=rep, caller_id=config.caller_id, answer_url=urls["answer"], hangup_url=urls["hangup"],
            ring_timeout=REP_RING_SECONDS, time_limit=max_seconds + A_LEG_EXTRA_SECONDS)
        if not result.ok:
            async with self.live(call_id, user.id).lock:
                await self._end(call_id, "telephony_error")
            raise BridgeError(502, DETAIL_PROVIDER)
        if result.request_uuid:
            await asyncio.to_thread(_db_update, call_id, {"vobiz_request_uuid": result.request_uuid[:64]})
        async with self.live(call_id, user.id).lock:
            row = await asyncio.to_thread(_db_update, call_id, {"status": RINGING_REP, "status_changed_at": utcnow()},
                                          {CREATED})
            if row is not None:
                self.publish_status(row)
                log.info("bridge %s: ringing the rep", _ref(call_id))
            else:   # a carrier callback got here first
                row = await asyncio.to_thread(_db_get, call_id)
        return serialize(row)

    async def get_call(self, user, call_id: str) -> dict:
        row = await self.get_row(call_id)
        if row is None or row["user_id"] != user.id:
            raise BridgeError(404, "Call not found.")
        return serialize(row)

    async def request_hangup(self, user, call_id: str) -> dict:
        row = await self.get_row(call_id)
        if row is None or row["user_id"] != user.id:
            raise BridgeError(404, "Call not found.")
        if row["status"] == ENDED:
            return serialize(row)
        call = self.live(call_id, row["user_id"])
        async with call.lock:
            row = await asyncio.to_thread(_db_get, call_id)
            if row["status"] == ENDED:
                return serialize(row)
            if row["status"] != CONNECTED and not row["cancel_requested"]:
                row = await asyncio.to_thread(_db_update, call_id, {"cancel_requested": True}) or row
            target = row.get("vobiz_a_leg_uuid") or row.get("vobiz_request_uuid")
            if not target:
                if row["status"] == CREATED:
                    # The provider hasn't confirmed the call yet: when it does, the
                    # answer URL gets <Hangup/> (cancel_requested).
                    ended = await self._end(call_id, "cancelled")
                    return serialize(ended or await asyncio.to_thread(_db_get, call_id))
                return serialize(row)
        result = await self.telephony().hangup(target)
        async with call.lock:
            row = await asyncio.to_thread(_db_get, call_id)
            if result.ok and row["status"] != ENDED:
                row = await self._end(call_id, "completed" if row["status"] == CONNECTED else "cancelled") or \
                    await asyncio.to_thread(_db_get, call_id)
            elif not result.ok:
                log.warning("bridge %s: hang-up request failed; the call is still up", _ref(call_id))
        return serialize(row)

    async def subscribe(self, websocket, user, call_id: str):
        """Registers an accepted app socket (owner checked by the caller)."""
        row = await self.get_row(call_id)
        call = self.live(call_id, row["user_id"])
        subscriber = call.hub.subscribe(websocket, status_message(row))
        if row["status"] == ENDED and (call.finalize_task is None or call.finalize_task.done()):
            subscriber.request_close(1000)
        return subscriber

    # ── state changes (callers hold the call's lock) ──

    async def _end(self, call_id: str, reason: str, *, at: Optional[datetime] = None,
                   extra: Optional[dict] = None) -> Optional[dict]:
        ended_at = at or utcnow()
        row = await asyncio.to_thread(_db_get, call_id)
        if row is None or row["status"] == ENDED:
            return None
        duration = self._billable_seconds(row, ended_at)
        if reason == "completed" and row.get("balance_capped") and duration >= int(row["max_seconds"]) - 2:
            reason = "insufficient_credits"
        values = {"status": ENDED, "reason": reason, "ended_at": ended_at, "status_changed_at": ended_at,
                  "duration_seconds": duration, **(extra or {})}
        ended = await asyncio.to_thread(_db_update, call_id, values, ACTIVE_STATES)
        if ended is None:
            return None
        call = self.live(call_id, ended["user_id"])
        call.ended = True
        self.publish_status(ended)
        log.info("bridge %s ended: %s (%ss connected)", _ref(call_id), reason, duration)
        call.finalize_task = self.spawn(self._finalize(call_id, ended))
        return ended

    @staticmethod
    def _billable_seconds(row: dict, ended_at: datetime) -> int:
        start = row.get("connected_at")
        if start is None:
            return 0
        end = min(value for value in (row.get("bridge_ended_at"), ended_at) if value is not None)
        # Whole seconds, rounded up: any connected time is at least one billed minute.
        seconds = max(0, math.ceil((end - start).total_seconds()))
        return min(seconds, int(row.get("max_seconds") or seconds))

    async def _finalize(self, call_id: str, row: dict) -> None:
        call = self.calls.get(call_id)
        try:
            if row.get("reason") != "server_restart":
                charged = await asyncio.to_thread(_db_bill, call_id)
                if charged:
                    self.publish_status(await asyncio.to_thread(_db_get, call_id))
            if call is not None:
                await call.close_media()
                save = bool(row.get("connected_at")) or call.has_transcript
                call_log_id = await call.shutdown_pipeline(save=save)
                if call_log_id is None and call.session is None and row.get("connected_at"):
                    # Connected, but the carrier never streamed audio: still list the call.
                    call_log_id = await asyncio.to_thread(live_pipeline.save_call_log, row["user_id"], [], [])
                if call_log_id:
                    self.publish_status(await asyncio.to_thread(_db_update, call_id, {"call_log_id": call_log_id}))
        except Exception as exc:
            log.error("bridge %s: finalize failed (%s)", _ref(call_id), type(exc).__name__)
        finally:
            if call is not None:
                call.hub.close_all(1000)
                call.finalized_at = time.monotonic()

    # ── carrier callbacks ──

    async def authorize_carrier(self, bid, token) -> Optional[dict]:
        """The call row when ``t`` matches its secret, else None (constant time)."""
        token = token if isinstance(token, str) and 0 < len(token) <= 128 else ""
        row = await self.get_row(bid) if token else None
        expected = row["token_hash"] if row else _DUMMY_HASH
        valid = hmac.compare_digest(expected, hash_token(token))
        return row if (row is not None and valid) else None

    async def _touch(self, call_id: str, values: Optional[dict] = None) -> Optional[dict]:
        return await asyncio.to_thread(_db_update, call_id, {"last_carrier_event_at": utcnow(), **(values or {})})

    async def on_answer(self, row: dict, token: str, params: dict) -> str:
        call = self.live(row["id"], row["user_id"])
        async with call.lock:
            row = await asyncio.to_thread(_db_get, row["id"])
            config = load_config()
            if row["status"] == ENDED or row["cancel_requested"] or not config.enabled:
                if row["status"] != ENDED:
                    await self._end(row["id"], "cancelled" if row["cancel_requested"] else "telephony_error")
                return hangup_xml()
            now = utcnow()
            values = {"last_carrier_event_at": now, "rep_answered_at": row["rep_answered_at"] or now}
            a_leg = str(params.get("CallUUID") or params.get("ALegUUID") or "").strip()
            if a_leg:
                values["vobiz_a_leg_uuid"] = a_leg[:64]
            if row["status"] in (CREATED, RINGING_REP):
                answered = await asyncio.to_thread(
                    _db_update, row["id"], {**values, "status": REP_ANSWERED, "status_changed_at": now},
                    {CREATED, RINGING_REP})
                self.publish_status(answered)
                ringing = await asyncio.to_thread(
                    _db_update, row["id"], {"status": RINGING_PROSPECT, "status_changed_at": utcnow()},
                    {REP_ANSWERED})
                self.publish_status(ringing)
                log.info("bridge %s: rep answered, dialing the prospect", _ref(row["id"]))
            else:   # the carrier re-fetched the answer URL
                await asyncio.to_thread(_db_update, row["id"], values)
            urls = self.carrier_urls(config, row["id"], token)
            confirm_url = None
            confirm_key = None
            if config.disclosure_enabled:
                from services.call_context_engine import call_context_engine
                context = await asyncio.to_thread(call_context_engine.get_context, row["context_id"])
                if self._disclosure_wanted(config, context):
                    confirm_url = urls["confirm"]
                    confirm_key = "1" if config.disclosure == "gate" else None
                    call.disclosure_played = True
            return answer_xml(
                stream_url=urls["media"], stream_status_url=urls["stream_status"], caller_id=config.caller_id,
                prospect_e164=row["prospect_phone_e164"], max_seconds=int(row["max_seconds"]),
                dial_events_url=urls["dial_events"], dial_result_url=urls["dial_result"],
                dial_timeout=DIAL_TIMEOUT_SECONDS, confirm_url=confirm_url, confirm_key=confirm_key,
                confirm_timeout=CONFIRM_TIMEOUT_SECONDS)

    async def on_confirm(self, row: dict) -> str:
        """``confirmSound``: the spoken disclosure Vobiz plays to the prospect after they answer."""
        await self._touch(row["id"])
        return confirm_xml(load_config().disclosure_text)

    async def on_dial_event(self, row: dict, params: dict) -> None:
        raw_event = _norm(params.get("Event") or params.get("DialAction"))
        event = raw_event[4:] if raw_event.startswith("DIAL") else raw_event   # DialAnswer → ANSWER
        call = self.live(row["id"], row["user_id"])
        async with call.lock:
            row = await asyncio.to_thread(_db_get, row["id"])
            now = utcnow()
            values = {"last_carrier_event_at": now}
            b_leg = str(params.get("DialBLegUUID") or "").strip()
            if b_leg:
                values["vobiz_b_leg_uuid"] = b_leg[:64]
            if row["status"] == ENDED:
                await asyncio.to_thread(_db_update, row["id"], values)
                return
            if event in ("ANSWER", "CONNECTED"):
                if row["status"] != CONNECTED:
                    values.update(status=CONNECTED, status_changed_at=now, connected_at=row["connected_at"] or now,
                                  rep_answered_at=row["rep_answered_at"] or now)
                    connected = await asyncio.to_thread(_db_update, row["id"], values, RINGING_STATES)
                    if connected is not None:
                        self.publish_status(connected)
                        if event == "ANSWER" and call.disclosure_played:
                            # Our disclosure is playing to the prospect: don't transcribe it as their words.
                            call.schedule_open_audio(DISCLOSURE_OPEN_AUDIO_GRACE)
                        else:
                            call.open_audio()
                        log.info("bridge %s: connected", _ref(row["id"]))
                    return
                call.open_audio()
            elif event == "HANGUP":
                if row["status"] == CONNECTED:
                    values["bridge_ended_at"] = row["bridge_ended_at"] or now
                elif not row["dial_status"]:
                    provisional = dial_status_from_cause(params)
                    if provisional:
                        values["dial_status"] = provisional
            await asyncio.to_thread(_db_update, row["id"], values)

    async def on_dial_result(self, row: dict, params: dict) -> None:
        dial_status = str(params.get("DialStatus") or "").strip().lower()[:24]
        call = self.live(row["id"], row["user_id"])
        async with call.lock:
            row = await asyncio.to_thread(_db_get, row["id"])
            now = utcnow()
            values = {"last_carrier_event_at": now}
            if dial_status:
                values["dial_status"] = dial_status
            b_leg = str(params.get("DialBLegUUID") or "").strip()
            if b_leg:
                values["vobiz_b_leg_uuid"] = b_leg[:64]
            if row["status"] == CONNECTED:
                values["bridge_ended_at"] = row["bridge_ended_at"] or now
            row = await asyncio.to_thread(_db_update, row["id"], values) or row
            if row["status"] == ENDED:
                return
            # The bridge is over and <Hangup/> follows: end now so the app updates at once.
            if row["status"] == CONNECTED:
                reason = "completed"
            elif row["cancel_requested"]:
                reason = "cancelled"
            else:
                # "completed" here means answered although no DialAnswer arrived: 0 s billed.
                reason = dial_reason(row.get("dial_status")) or "prospect_failed"
            await self._end(row["id"], reason, at=now)

    async def on_hangup(self, row: dict, params: dict) -> None:
        call = self.live(row["id"], row["user_id"])
        async with call.lock:
            row = await asyncio.to_thread(_db_get, row["id"])
            now = utcnow()
            values = {"last_carrier_event_at": now}
            a_leg = str(params.get("CallUUID") or "").strip()
            if a_leg and not row.get("vobiz_a_leg_uuid"):
                values["vobiz_a_leg_uuid"] = a_leg[:64]
            if row["status"] == ENDED:
                await asyncio.to_thread(_db_update, row["id"], values)
                if row.get("reason") == "server_restart" and row.get("connected_at") and not row.get("billed_at"):
                    # The call outlived a restart: bill its connected time now (once).
                    await asyncio.to_thread(_db_update, row["id"],
                                            {"duration_seconds": self._billable_seconds(row, now)})
                    await asyncio.to_thread(_db_bill, row["id"])
                return
            if row["status"] == CONNECTED:
                reason = "completed"
            elif row["cancel_requested"]:
                reason = "cancelled"
            elif row["status"] in (REP_ANSWERED, RINGING_PROSPECT):
                # The rep's leg ended while the prospect rang: the prospect's outcome,
                # or the rep gave up waiting.
                reason = dial_reason(row.get("dial_status")) or "cancelled"
            else:
                reason = rep_reason(params)
            await self._end(row["id"], reason, at=now, extra=values)

    async def on_stream_status(self, row: dict, params: dict) -> None:
        event = str(params.get("Event") or "").strip()[:32]
        if event in ("DroppedStream", "DegradedStream"):
            log.warning("bridge %s: media stream %s", _ref(row["id"]), event)
        await self._touch(row["id"])

    async def run_media(self, row: dict, websocket) -> None:
        """Carrier media socket: ``start`` + ``media`` events (one 20 ms frame per
        track). Malformed frames are counted and ignored; the socket closing is the
        end of the stream (Vobiz sends no ``stop``)."""
        call = self.live(row["id"], row["user_id"])
        if row["status"] == CONNECTED:
            call.open_audio()
        await self._touch(row["id"])
        try:
            while not call.ended:
                message = await websocket.receive()
                if message.get("type") == "websocket.disconnect":
                    break
                text = message.get("text")
                if not isinstance(text, str) or len(text) > 256_000:
                    call.bad_frames += 1
                    continue
                try:
                    data = json.loads(text)
                except ValueError:
                    call.bad_frames += 1
                    continue
                if not isinstance(data, dict):
                    call.bad_frames += 1
                    continue
                event = data.get("event")
                if event == "media" and isinstance(data.get("media"), dict):
                    call.on_media(data["media"])
                elif event == "start" and isinstance(data.get("start"), dict):
                    call.on_stream_start(data["start"])
        except Exception as exc:   # the carrier dropped the socket
            if type(exc).__name__ not in ("WebSocketDisconnect", "ClientDisconnected"):
                log.warning("bridge %s: media socket error (%s)", _ref(row["id"]), type(exc).__name__)
        finally:
            if call.media_socket is websocket:
                call.media_socket = None
            if call.bad_frames:
                log.info("bridge %s: %s malformed media frames ignored", _ref(row["id"]), call.bad_frames)

    def attach_media(self, row: dict, websocket) -> bool:
        """One media socket per call, only while the call isn't over."""
        call = self.live(row["id"], row["user_id"])
        if row["status"] == ENDED or call.ended or call.media_socket is not None:
            return False
        call.media_socket = websocket
        return True

    # ── timers ──

    async def sweep(self, now: Optional[datetime] = None) -> None:
        """Ringing too long without carrier callbacks → timeout; connected past its
        limit → hang up; drops finished calls' replay state after a while."""
        now = now or utcnow()
        for row in await asyncio.to_thread(_db_non_ended):
            try:
                if row["status"] in RINGING_STATES:
                    last = max(value for value in (row.get("created_at"), row.get("status_changed_at"),
                                                   row.get("last_carrier_event_at")) if value is not None)
                    if (now - last).total_seconds() > RING_TIMEOUT_SECONDS:
                        await self._expire(row, "timeout", now)
                elif row["status"] == CONNECTED:
                    bridge_end = row.get("bridge_ended_at")
                    if bridge_end and (now - bridge_end).total_seconds() > AFTER_BRIDGE_END_GRACE:
                        await self._expire(row, "completed", bridge_end, hangup=False)
                    elif row.get("connected_at") and (now - row["connected_at"]).total_seconds() > \
                            int(row["max_seconds"]) + CONNECTED_OVERRUN_GRACE:
                        await self._expire(row, "completed", now)
            except Exception as exc:
                log.error("bridge %s: sweep failed (%s)", _ref(row.get("id")), type(exc).__name__)
        cutoff = time.monotonic() - LIVE_RETENTION_SECONDS
        for call_id, call in list(self.calls.items()):
            if call.finalized_at is not None and call.finalized_at < cutoff and call.hub.subscriber_count == 0:
                self.calls.pop(call_id, None)

    async def _expire(self, row: dict, reason: str, at: datetime, *, hangup: bool = True) -> None:
        target = row.get("vobiz_a_leg_uuid") or row.get("vobiz_request_uuid")
        if hangup and target:
            result = await self.telephony().hangup(target)
            if not result.ok and row["status"] == CONNECTED:
                return   # still up on the carrier side: retry on the next sweep
        call = self.live(row["id"], row["user_id"])
        async with call.lock:
            await self._end(row["id"], reason, at=at)

    async def _watchdog_loop(self) -> None:
        while True:
            await asyncio.sleep(self.watchdog_interval)
            try:
                await self.sweep()
            except Exception as exc:
                log.error("bridge sweep failed (%s)", type(exc).__name__)

    # ── lifecycle ──

    async def startup(self) -> None:
        await asyncio.to_thread(_db_ensure_table)
        stale = await asyncio.to_thread(_db_mark_stale, utcnow() - STALE_AFTER)
        for row in stale:
            log.info("bridge %s ended: server_restart", _ref(row["id"]))
            target = row.get("vobiz_a_leg_uuid") or row.get("vobiz_request_uuid")
            if target and row["status"] != CONNECTED:
                self.spawn(self._best_effort_hangup(target))
        if self._watchdog is None or self._watchdog.done():
            self._watchdog = asyncio.get_running_loop().create_task(self._watchdog_loop())

    async def _best_effort_hangup(self, target: str) -> None:
        try:
            await self.telephony().hangup(target)
        except Exception:
            pass

    async def shutdown(self) -> None:
        if self._watchdog is not None:
            self._watchdog.cancel()
            try:
                await self._watchdog
            except (asyncio.CancelledError, Exception):
                pass
            self._watchdog = None
        # Keep what was said on calls that are still up (the carrier may keep the
        # bridge running; after a restart the transcript restarts from there).
        for call_id, call in list(self.calls.items()):
            if call.session is not None and not call.ended and call.has_transcript:
                try:
                    call_log_id = await asyncio.wait_for(
                        call.shutdown_pipeline(save=True, finalize_engine=False), timeout=15)
                    if call_log_id:
                        await asyncio.to_thread(_db_update, call_id, {"call_log_id": call_log_id})
                except Exception:
                    pass
        pending = [task for task in self._background if not task.done()]
        if pending:
            await asyncio.wait(pending, timeout=20)


bridge_service = BridgeService()
