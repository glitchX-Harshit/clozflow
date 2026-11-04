"""Text-only integration boundary for the main ClozFlow application."""
from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import HTTPException
from pydantic import Field, field_validator

from clozflow_brain.contracts.common import utc_now
from clozflow_brain.contracts.events import CognitiveEvent, EventType, TranscriptPayload
from clozflow_brain.contracts.sessions import SessionStatus


class TranscriptRequest(TranscriptPayload):
    text: str = Field(min_length=1, max_length=16000)
    speaker_id: str = "prospect"
    start_ms: int = Field(default=0, ge=0)
    end_ms: int = Field(default=0, ge=0)
    is_final: bool = True
    event_id: UUID = Field(default_factory=uuid4)
    sequence_num: int = Field(ge=1)
    confidence: float = Field(default=1.0, ge=0, le=1)

    @field_validator("text")
    @classmethod
    def meaningful_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Transcript cannot be blank")
        return value.strip()


def install_transcript_routes(app, kernel, ingestion_service) -> None:
    @app.post("/v1/sessions/{session_id}/transcripts")
    def ingest_transcript(session_id: UUID, request: TranscriptRequest) -> dict:
        session = kernel.session_repository.get(session_id)
        if session.status != SessionStatus.ACTIVE:
            raise HTTPException(409, "Session is not active")
        if not request.is_final:
            return {"status": "awaiting_final", "event_id": str(request.event_id),
                    "recommendations": [], "engines": []}
        payload = request.model_dump(mode="json", exclude={"event_id", "sequence_num", "confidence"})
        event = CognitiveEvent.create(
            event_type=EventType.TRANSCRIPT_SEGMENT, session_id=session_id,
            tenant_id=session.tenant_id, sequence_num=request.sequence_num,
            event_id=request.event_id, source="clozflow-main-transcripts",
            payload=payload, confidence=request.confidence,
        )
        result = ingestion_service.ingest(event)
        now = utc_now()
        # A replay or a failed new turn must never surface a prior suggestion.
        recommendations = [rec.model_dump(mode="json") for rec in result.world_model.pending_recommendations
                           if rec.cycle_id == result.cycle_id and request.event_id in rec.triggered_by
                           and (now - rec.created_at_utc).total_seconds() * 1000 < rec.display_ttl_ms]
        if not result.accepted_events:
            status = "duplicate"
        elif any(output.status.value in {"ERROR", "TIMEOUT"} for output in result.engine_outputs):
            status = "degraded"
        elif recommendations:
            status = "complete"
        elif request.speaker_role.value == "SALESPERSON":
            status = "recorded"
        else:
            status = "withheld"
        return {
            "status": status, "session_id": str(session_id), "event_id": str(request.event_id),
            "cycle_id": str(result.cycle_id), "recommendations": recommendations,
            "engines": [{"engine_id": output.engine_id, "status": output.status.value,
                         "duration_ms": output.duration_ms} for output in result.engine_outputs],
            "state": {
                "phase": result.world_model.conversation_state.phase.value,
                "turn_count": result.world_model.conversation_state.turn_count,
                "objections": [item.model_dump(mode="json") for item in result.world_model.active_objections],
            },
        }
