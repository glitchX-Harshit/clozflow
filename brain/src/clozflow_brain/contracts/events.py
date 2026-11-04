"""Cognitive Event contracts from CCBS Volume X."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from clozflow_brain.contracts.common import ensure_aware_utc, utc_now


class EventType(StrEnum):
    TRANSCRIPT_SEGMENT = "TRANSCRIPT_SEGMENT"
    SILENCE_DETECTED = "SILENCE_DETECTED"
    SPEAKER_CHANGE = "SPEAKER_CHANGE"
    CRM_FIELD_UPDATED = "CRM_FIELD_UPDATED"
    CALENDAR_EVENT = "CALENDAR_EVENT"
    PRODUCT_UPDATED = "PRODUCT_UPDATED"
    CONFIDENCE_THRESHOLD = "CONFIDENCE_THRESHOLD"
    SESSION_START = "SESSION_START"
    SESSION_END = "SESSION_END"
    MODULE_FAILURE = "MODULE_FAILURE"
    EXTERNAL_KNOWLEDGE = "EXTERNAL_KNOWLEDGE"
    RECOMMENDATION_ACK = "RECOMMENDATION_ACK"
    LEARNING_SIGNAL = "LEARNING_SIGNAL"
    ENGINE_TELEMETRY = "ENGINE_TELEMETRY"

class SpeakerRole(StrEnum):
    SALESPERSON = "SALESPERSON"
    BUYER = "BUYER"
    UNKNOWN = "UNKNOWN"


class ThresholdDirection(StrEnum):
    FALLING = "FALLING"
    RISING = "RISING"


@dataclass(frozen=True)
class EventTypeSpec:
    priority_ceiling: int
    ttl_ms: int


EVENT_TYPE_REGISTRY: dict[EventType, EventTypeSpec] = {
    EventType.TRANSCRIPT_SEGMENT: EventTypeSpec(priority_ceiling=1, ttl_ms=200),
    EventType.SILENCE_DETECTED: EventTypeSpec(priority_ceiling=2, ttl_ms=500),
    EventType.SPEAKER_CHANGE: EventTypeSpec(priority_ceiling=1, ttl_ms=200),
    EventType.CRM_FIELD_UPDATED: EventTypeSpec(priority_ceiling=3, ttl_ms=2000),
    EventType.CALENDAR_EVENT: EventTypeSpec(priority_ceiling=3, ttl_ms=5000),
    EventType.PRODUCT_UPDATED: EventTypeSpec(priority_ceiling=4, ttl_ms=30000),
    EventType.CONFIDENCE_THRESHOLD: EventTypeSpec(priority_ceiling=2, ttl_ms=1000),
    EventType.SESSION_START: EventTypeSpec(priority_ceiling=1, ttl_ms=500),
    EventType.SESSION_END: EventTypeSpec(priority_ceiling=1, ttl_ms=500),
    EventType.MODULE_FAILURE: EventTypeSpec(priority_ceiling=1, ttl_ms=300),
    EventType.EXTERNAL_KNOWLEDGE: EventTypeSpec(priority_ceiling=3, ttl_ms=1500),
    EventType.RECOMMENDATION_ACK: EventTypeSpec(priority_ceiling=2, ttl_ms=1000),
    EventType.LEARNING_SIGNAL: EventTypeSpec(priority_ceiling=5, ttl_ms=60000),
    EventType.ENGINE_TELEMETRY: EventTypeSpec(priority_ceiling=1, ttl_ms=1000),
}


class AudioFeatures(BaseModel):
    model_config = ConfigDict(extra="forbid")

    energy_db: float | None = None
    pitch_hz: float | None = None
    speech_rate_wpm: int | None = Field(default=None, ge=0)
    pause_before_ms: int | None = Field(default=None, ge=0)


class TranscriptPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1)
    speaker_id: str = Field(min_length=1)
    speaker_role: SpeakerRole = SpeakerRole.UNKNOWN
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    is_final: bool
    language: str = Field(default="en-US", min_length=2)
    audio_features: AudioFeatures | None = None

    @model_validator(mode="after")
    def validate_offsets(self) -> TranscriptPayload:
        if self.end_ms < self.start_ms:
            raise ValueError("end_ms must be greater than or equal to start_ms")
        return self


class ThresholdPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    belief_id: str = Field(min_length=1)
    belief_type: str = Field(min_length=1)
    current_value: float = Field(ge=0.0, le=1.0)
    threshold: float = Field(ge=0.0, le=1.0)
    direction: ThresholdDirection
    previous_value: float = Field(ge=0.0, le=1.0)


class SessionPayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    salesperson_id: str | None = None
    crm_opportunity_id: str | None = None
    status: str | None = None


class FailurePayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    module_id: str = Field(min_length=1)
    error_type: str = Field(min_length=1)
    message: str = Field(min_length=1)
    recoverable: bool = True


class AckPayload(BaseModel):
    model_config = ConfigDict(extra="allow")

    rec_id: str = Field(min_length=1)
    action: str = Field(min_length=1)


PAYLOAD_MODELS: dict[EventType, type[BaseModel]] = {
    EventType.TRANSCRIPT_SEGMENT: TranscriptPayload,
    EventType.CONFIDENCE_THRESHOLD: ThresholdPayload,
    EventType.SESSION_START: SessionPayload,
    EventType.SESSION_END: SessionPayload,
    EventType.MODULE_FAILURE: FailurePayload,
    EventType.RECOMMENDATION_ACK: AckPayload,
}


class CognitiveEvent(BaseModel):
    """Canonical event envelope accepted by the Cognitive Kernel."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    event_id: UUID = Field(default_factory=uuid4)
    event_type: EventType
    session_id: UUID
    tenant_id: UUID
    timestamp_utc: datetime = Field(default_factory=utc_now)
    sequence_num: int = Field(ge=0)
    source: str = Field(min_length=1)
    priority: int = Field(ge=1, le=5)
    ttl_ms: int = Field(gt=0)
    payload: dict[str, Any]
    confidence: float = Field(ge=0.0, le=1.0)
    causation_id: UUID | None = None
    correlation_id: UUID | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("timestamp_utc")
    @classmethod
    def validate_timestamp(cls, value: datetime) -> datetime:
        return ensure_aware_utc(value)

    @model_validator(mode="after")
    def validate_against_registry(self) -> CognitiveEvent:
        spec = EVENT_TYPE_REGISTRY[self.event_type]
        if self.priority > spec.priority_ceiling:
            raise ValueError(
                f"{self.event_type} priority {self.priority} exceeds ceiling {spec.priority_ceiling}"
            )
        if self.ttl_ms > spec.ttl_ms:
            raise ValueError(f"{self.event_type} ttl_ms {self.ttl_ms} exceeds {spec.ttl_ms}")
        payload_model = PAYLOAD_MODELS.get(self.event_type)
        if payload_model is not None:
            payload_model.model_validate(self.payload)
        return self

    @classmethod
    def create(
        cls,
        *,
        event_type: EventType,
        session_id: UUID,
        tenant_id: UUID,
        sequence_num: int,
        source: str,
        payload: dict[str, Any],
        confidence: float,
        priority: int | None = None,
        ttl_ms: int | None = None,
        **kwargs: Any,
    ) -> CognitiveEvent:
        spec = EVENT_TYPE_REGISTRY[event_type]
        return cls(
            event_type=event_type,
            session_id=session_id,
            tenant_id=tenant_id,
            sequence_num=sequence_num,
            source=source,
            priority=priority or spec.priority_ceiling,
            ttl_ms=ttl_ms or spec.ttl_ms,
            payload=payload,
            confidence=confidence,
            **kwargs,
        )

