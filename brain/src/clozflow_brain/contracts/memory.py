"""Cognitive memory contracts."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from clozflow_brain.contracts.common import ensure_aware_utc, utc_now
from clozflow_brain.contracts.persistence import ArtifactLifecycleState


class MemoryType(StrEnum):
    WORKING = "WORKING"
    EPISODIC = "EPISODIC"
    SEMANTIC = "SEMANTIC"
    PROCEDURAL = "PROCEDURAL"
    STRATEGIC = "STRATEGIC"
    ORGANIZATIONAL = "ORGANIZATIONAL"
    REFLECTIVE = "REFLECTIVE"
    GOVERNANCE = "GOVERNANCE"


class MemoryScope(StrEnum):
    SESSION = "SESSION"
    OPPORTUNITY = "OPPORTUNITY"
    TENANT = "TENANT"
    GLOBAL = "GLOBAL"


class MemoryRecord(BaseModel):
    """A durable memory candidate, distinct from active working memory."""

    model_config = ConfigDict(extra="forbid")

    memory_id: UUID = Field(default_factory=uuid4)
    tenant_id: UUID
    memory_type: MemoryType
    scope: MemoryScope
    subject: str = Field(min_length=1)
    content: dict[str, Any]
    concepts: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    source_artifact_id: UUID | None = None
    provenance_event_ids: list[UUID] = Field(default_factory=list)
    lifecycle_state: ArtifactLifecycleState = ArtifactLifecycleState.PERSISTED
    activation_count: int = Field(default=0, ge=0)
    created_at_utc: datetime = Field(default_factory=utc_now)
    updated_at_utc: datetime = Field(default_factory=utc_now)
    last_activated_at_utc: datetime | None = None

    @field_validator("created_at_utc", "updated_at_utc", "last_activated_at_utc")
    @classmethod
    def validate_timestamps(cls, value: datetime | None) -> datetime | None:
        return ensure_aware_utc(value) if value is not None else None


class ActivatedMemory(BaseModel):
    model_config = ConfigDict(extra="forbid")

    activation_id: UUID = Field(default_factory=uuid4)
    tenant_id: UUID
    session_id: UUID
    context_id: UUID
    memory_id: UUID
    relevance: float = Field(ge=0.0, le=1.0)
    activation_reason: str = Field(min_length=1)
    activated_at_utc: datetime = Field(default_factory=utc_now)

    @field_validator("activated_at_utc")
    @classmethod
    def validate_activated_at(cls, value: datetime) -> datetime:
        return ensure_aware_utc(value)


class WorkingMemory(BaseModel):
    model_config = ConfigDict(extra="forbid")

    working_memory_id: UUID = Field(default_factory=uuid4)
    tenant_id: UUID
    session_id: UUID
    context_id: UUID
    active_memory_ids: list[UUID] = Field(default_factory=list)
    temporary_state: dict[str, Any] = Field(default_factory=dict)
    created_at_utc: datetime = Field(default_factory=utc_now)

    @field_validator("created_at_utc")
    @classmethod
    def validate_created_at(cls, value: datetime) -> datetime:
        return ensure_aware_utc(value)

