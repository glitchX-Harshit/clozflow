"""Semantic knowledge discovery contracts."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from clozflow_brain.contracts.common import ensure_aware_utc, utc_now
from clozflow_brain.contracts.persistence import ArtifactLifecycleState


class KnowledgeKind(StrEnum):
    PRODUCT = "PRODUCT"
    PLAYBOOK = "PLAYBOOK"
    OBJECTION_LIBRARY = "OBJECTION_LIBRARY"
    POLICY = "POLICY"
    CASE_STUDY = "CASE_STUDY"
    DOMAIN_CONCEPT = "DOMAIN_CONCEPT"
    PROCEDURE = "PROCEDURE"


class KnowledgeArtifact(BaseModel):
    model_config = ConfigDict(extra="forbid")

    knowledge_id: UUID = Field(default_factory=uuid4)
    tenant_id: UUID
    kind: KnowledgeKind
    title: str = Field(min_length=1)
    body: str = Field(min_length=1)
    concepts: list[str] = Field(default_factory=list)
    relationships: dict[str, list[UUID]] = Field(default_factory=dict)
    provenance: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    lifecycle_state: ArtifactLifecycleState = ArtifactLifecycleState.PERSISTED
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at_utc: datetime = Field(default_factory=utc_now)
    updated_at_utc: datetime = Field(default_factory=utc_now)

    @field_validator("created_at_utc", "updated_at_utc")
    @classmethod
    def validate_timestamps(cls, value: datetime) -> datetime:
        return ensure_aware_utc(value)


class DiscoveryIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tenant_id: UUID
    session_id: UUID
    objective: str = Field(min_length=1)
    concepts: list[str] = Field(default_factory=list)
    top_k: int = Field(default=5, ge=1, le=20)


class KnowledgeCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    knowledge: KnowledgeArtifact
    relevance: float = Field(ge=0.0, le=1.0)
    rationale: str = Field(min_length=1)


class KnowledgePackage(BaseModel):
    """Reasoning-ready package produced by semantic knowledge discovery."""

    model_config = ConfigDict(extra="forbid")

    package_id: UUID = Field(default_factory=uuid4)
    tenant_id: UUID
    session_id: UUID
    intent: DiscoveryIntent
    candidates: list[KnowledgeCandidate] = Field(default_factory=list)
    concepts: list[str] = Field(default_factory=list)
    provenance_refs: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    created_at_utc: datetime = Field(default_factory=utc_now)

    @field_validator("created_at_utc")
    @classmethod
    def validate_created_at(cls, value: datetime) -> datetime:
        return ensure_aware_utc(value)

