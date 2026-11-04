"""Canonical cognitive persistence contracts from CCBS CCPA/CILF."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from clozflow_brain.contracts.common import ensure_aware_utc, utc_now


class ArtifactType(StrEnum):
    COGNITIVE_EVENT = "COGNITIVE_EVENT"
    WORLD_MODEL = "WORLD_MODEL"
    CONTEXT = "CONTEXT"
    MEMORY = "MEMORY"
    KNOWLEDGE = "KNOWLEDGE"
    RECOMMENDATION = "RECOMMENDATION"
    DECISION = "DECISION"
    REFLECTION = "REFLECTION"
    GOVERNANCE_RECORD = "GOVERNANCE_RECORD"


class ArtifactLifecycleState(StrEnum):
    ACQUIRED = "ACQUIRED"
    VALIDATED = "VALIDATED"
    PERSISTED = "PERSISTED"
    ACTIVE = "ACTIVE"
    DISCOVERED = "DISCOVERED"
    REASONED = "REASONED"
    LEARNED = "LEARNED"
    GOVERNED = "GOVERNED"
    ARCHIVED = "ARCHIVED"
    RETAINED = "RETAINED"
    RETIRED = "RETIRED"


class ArtifactRelationshipType(StrEnum):
    SUPPORTS = "SUPPORTS"
    CONTRADICTS = "CONTRADICTS"
    DERIVES_FROM = "DERIVES_FROM"
    FORECASTS = "FORECASTS"
    SUPERSEDES = "SUPERSEDES"
    REFERENCES = "REFERENCES"
    GOVERNS = "GOVERNS"
    BELONGS_TO = "BELONGS_TO"


class CognitiveArtifact(BaseModel):
    """Technology-independent persistent cognitive artifact."""

    model_config = ConfigDict(extra="forbid")

    artifact_id: UUID = Field(default_factory=uuid4)
    tenant_id: UUID
    artifact_type: ArtifactType
    owner: str = Field(min_length=1)
    namespace: str = Field(min_length=1)
    semantic_type: str = Field(min_length=1)
    version: int = Field(default=1, ge=1)
    lifecycle_state: ArtifactLifecycleState = ArtifactLifecycleState.ACQUIRED
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    payload: dict[str, Any] = Field(default_factory=dict)
    provenance_event_ids: list[UUID] = Field(default_factory=list)
    governance_metadata: dict[str, Any] = Field(default_factory=dict)
    created_at_utc: datetime = Field(default_factory=utc_now)
    updated_at_utc: datetime = Field(default_factory=utc_now)

    @field_validator("created_at_utc", "updated_at_utc")
    @classmethod
    def validate_timestamps(cls, value: datetime) -> datetime:
        return ensure_aware_utc(value)


class ArtifactRelationship(BaseModel):
    model_config = ConfigDict(extra="forbid")

    relationship_id: UUID = Field(default_factory=uuid4)
    tenant_id: UUID
    source_artifact_id: UUID
    target_artifact_id: UUID
    relationship_type: ArtifactRelationshipType
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at_utc: datetime = Field(default_factory=utc_now)

    @field_validator("created_at_utc")
    @classmethod
    def validate_created_at(cls, value: datetime) -> datetime:
        return ensure_aware_utc(value)


class ArtifactVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    artifact_id: UUID
    tenant_id: UUID
    version: int = Field(ge=1)
    payload: dict[str, Any]
    lifecycle_state: ArtifactLifecycleState
    created_at_utc: datetime = Field(default_factory=utc_now)

    @field_validator("created_at_utc")
    @classmethod
    def validate_created_at(cls, value: datetime) -> datetime:
        return ensure_aware_utc(value)

