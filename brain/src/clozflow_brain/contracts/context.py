"""Explicit cognitive context contracts."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from clozflow_brain.contracts.common import ensure_aware_utc, utc_now


class ContextLayer(StrEnum):
    ENTERPRISE_DATA = "ENTERPRISE_DATA"
    SEMANTIC_CONTEXT = "SEMANTIC_CONTEXT"
    BUSINESS_CONTEXT = "BUSINESS_CONTEXT"
    DECISION_CONTEXT = "DECISION_CONTEXT"
    COGNITIVE_CONTEXT = "COGNITIVE_CONTEXT"


class ContextSourceType(StrEnum):
    EVENT = "EVENT"
    WORLD_MODEL = "WORLD_MODEL"
    MEMORY = "MEMORY"
    KNOWLEDGE = "KNOWLEDGE"
    POLICY = "POLICY"
    BUSINESS_STATE = "BUSINESS_STATE"


class ContextFragment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fragment_id: UUID = Field(default_factory=uuid4)
    source_type: ContextSourceType
    source_id: str = Field(min_length=1)
    layer: ContextLayer
    content: dict[str, Any]
    relevance: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    provenance_event_ids: list[UUID] = Field(default_factory=list)
    created_at_utc: datetime = Field(default_factory=utc_now)

    @field_validator("created_at_utc")
    @classmethod
    def validate_created_at(cls, value: datetime) -> datetime:
        return ensure_aware_utc(value)


class ContextQuality(BaseModel):
    model_config = ConfigDict(extra="forbid")

    completeness: float = Field(ge=0.0, le=1.0)
    freshness: float = Field(ge=0.0, le=1.0)
    consistency: float = Field(ge=0.0, le=1.0)
    provenance: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    relevance: float = Field(ge=0.0, le=1.0)
    ready_for_reasoning: bool


class CognitiveContext(BaseModel):
    """Runtime context assembled before cognitive reasoning."""

    model_config = ConfigDict(extra="forbid")

    context_id: UUID = Field(default_factory=uuid4)
    tenant_id: UUID
    session_id: UUID
    version: int = Field(default=1, ge=1)
    fragments: list[ContextFragment] = Field(default_factory=list)
    active_memory_ids: list[UUID] = Field(default_factory=list)
    knowledge_ref_ids: list[UUID] = Field(default_factory=list)
    quality: ContextQuality
    created_at_utc: datetime = Field(default_factory=utc_now)
    updated_at_utc: datetime = Field(default_factory=utc_now)

    @field_validator("created_at_utc", "updated_at_utc")
    @classmethod
    def validate_timestamps(cls, value: datetime) -> datetime:
        return ensure_aware_utc(value)

