"""World Model contracts and atomic mutation types."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from pydantic import ConfigDict, Field, field_validator

from clozflow_brain.contracts.common import ensure_aware_utc, utc_now
from clozflow_brain.contracts.ontology import (
    AttributePrimitive,
    EntityPrimitive,
    EventPrimitive,
    EvidencePrimitive,
    StatePrimitive,
)
from clozflow_brain.contracts.recommendations import Recommendation


class ConversationPhase(StrEnum):
    OPENING = "OPENING"
    DISCOVERY = "DISCOVERY"
    DEMO = "DEMO"
    OBJECTION = "OBJECTION"
    NEGOTIATION = "NEGOTIATION"
    CLOSING = "CLOSING"
    FOLLOW_UP = "FOLLOW_UP"


class Speaker(StrEnum):
    SALESPERSON = "SALESPERSON"
    BUYER = "BUYER"
    UNKNOWN = "UNKNOWN"


class BuyerProfile(EntityPrimitive):
    model_config = ConfigDict(extra="forbid")

    id: str | None = None
    name: str | None = None
    role: str | None = None
    company: str | None = None
    crm_record_id: str | None = None


class ConversationState(StatePrimitive):
    model_config = ConfigDict(extra="forbid")

    phase: ConversationPhase = ConversationPhase.OPENING
    turn_count: int = Field(default=0, ge=0)
    elapsed_ms: int = Field(default=0, ge=0)
    last_speaker: Speaker = Speaker.UNKNOWN


class CompetingHypothesis(AttributePrimitive):
    model_config = ConfigDict(extra="forbid")

    value: Any
    confidence: float = Field(ge=0.0, le=1.0)


class BeliefNode(StatePrimitive):
    model_config = ConfigDict(extra="forbid")

    belief_id: UUID = Field(default_factory=uuid4)
    belief_type: str = Field(min_length=1)
    subject: str = Field(min_length=1)
    value: Any
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_ids: list[UUID] = Field(default_factory=list)
    competing_hypotheses: list[CompetingHypothesis] = Field(default_factory=list)
    created_at_utc: datetime = Field(default_factory=utc_now)
    updated_at_utc: datetime = Field(default_factory=utc_now)
    decay_rate: float = Field(default=0.0, ge=0.0)
    is_explicit: bool = False
    retracted_at_utc: datetime | None = None

    @field_validator("created_at_utc", "updated_at_utc", "retracted_at_utc")
    @classmethod
    def validate_timestamps(cls, value: datetime | None) -> datetime | None:
        return ensure_aware_utc(value) if value is not None else None


class ObjectionStatus(StrEnum):
    ACTIVE = "ACTIVE"
    RESOLVED = "RESOLVED"
    RETRACTED = "RETRACTED"


class ObjectionNode(StatePrimitive):
    model_config = ConfigDict(extra="forbid")

    objection_id: UUID = Field(default_factory=uuid4)
    objection_type: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_ids: list[UUID] = Field(default_factory=list)
    status: ObjectionStatus = ObjectionStatus.ACTIVE
    created_at_utc: datetime = Field(default_factory=utc_now)
    updated_at_utc: datetime = Field(default_factory=utc_now)

    @field_validator("created_at_utc", "updated_at_utc")
    @classmethod
    def validate_timestamps(cls, value: datetime) -> datetime:
        return ensure_aware_utc(value)


class GoalNode(StatePrimitive):
    model_config = ConfigDict(extra="forbid")

    goal_id: UUID = Field(default_factory=uuid4)
    description: str = Field(min_length=1)
    priority: int = Field(ge=1, le=10)
    confidence: float = Field(ge=0.0, le=1.0)
    active: bool = True
    created_at_utc: datetime = Field(default_factory=utc_now)
    updated_at_utc: datetime = Field(default_factory=utc_now)

    @field_validator("created_at_utc", "updated_at_utc")
    @classmethod
    def validate_timestamps(cls, value: datetime) -> datetime:
        return ensure_aware_utc(value)


class KnowledgeRef(EvidencePrimitive):
    model_config = ConfigDict(extra="forbid")

    ref_id: UUID = Field(default_factory=uuid4)
    source: str = Field(min_length=1)
    title: str = Field(min_length=1)
    relevance: float = Field(ge=0.0, le=1.0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class MemoryRef(EvidencePrimitive):
    model_config = ConfigDict(extra="forbid")

    memory_id: UUID
    memory_type: str = Field(min_length=1)
    subject: str = Field(min_length=1)
    relevance: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorldModel(StatePrimitive):
    """Versioned in-session representation of current cognitive reality."""

    model_config = ConfigDict(extra="forbid")

    wm_id: UUID = Field(default_factory=uuid4)
    session_id: UUID
    tenant_id: UUID
    version: int = Field(default=1, ge=1)
    updated_at_utc: datetime = Field(default_factory=utc_now)
    buyer: BuyerProfile = Field(default_factory=BuyerProfile)
    conversation_state: ConversationState = Field(default_factory=ConversationState)
    crm_beliefs: list[BeliefNode] = Field(default_factory=list)
    active_objections: list[ObjectionNode] = Field(default_factory=list)
    active_goals: list[GoalNode] = Field(default_factory=list)
    context_window: list[str] = Field(default_factory=list)
    memory_refs: list[MemoryRef] = Field(default_factory=list)
    knowledge_refs: list[KnowledgeRef] = Field(default_factory=list)
    processed_event_ids: list[UUID] = Field(default_factory=list)
    pending_recommendations: list[Recommendation] = Field(default_factory=list)

    @field_validator("updated_at_utc")
    @classmethod
    def validate_updated_at(cls, value: datetime) -> datetime:
        return ensure_aware_utc(value)


class WorldModelMutationType(StrEnum):
    UPSERT_BELIEF = "UPSERT_BELIEF"
    RETRACT_BELIEF = "RETRACT_BELIEF"
    ADD_OBJECTION = "ADD_OBJECTION"
    RESOLVE_OBJECTION = "RESOLVE_OBJECTION"
    UPDATE_PHASE = "UPDATE_PHASE"
    PUSH_RECOMMENDATION = "PUSH_RECOMMENDATION"
    ADD_MEMORY_REF = "ADD_MEMORY_REF"
    ADD_KNOWLEDGE_REF = "ADD_KNOWLEDGE_REF"
    SET_GOAL = "SET_GOAL"
    APPEND_CONTEXT = "APPEND_CONTEXT"
    RECORD_EVENTS = "RECORD_EVENTS"


class WorldModelMutation(EventPrimitive):
    model_config = ConfigDict(extra="forbid", frozen=True)

    mutation_id: UUID = Field(default_factory=uuid4)
    mutation_type: WorldModelMutationType
    session_id: UUID
    tenant_id: UUID
    payload: dict[str, Any]
    caused_by_event_id: UUID | None = None
    created_at_utc: datetime = Field(default_factory=utc_now)

    @field_validator("created_at_utc")
    @classmethod
    def validate_created_at(cls, value: datetime) -> datetime:
        return ensure_aware_utc(value)
