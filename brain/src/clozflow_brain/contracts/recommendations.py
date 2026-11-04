"""Recommendation contracts consumed by detachable UI clients."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from clozflow_brain.contracts.common import ensure_aware_utc, utc_now


class RecommendationType(StrEnum):
    RESPONSE_SUGGESTION = "RESPONSE_SUGGESTION"
    OBJECTION_HANDLE = "OBJECTION_HANDLE"
    QUESTION = "QUESTION"
    ALERT = "ALERT"
    STRATEGY_SHIFT = "STRATEGY_SHIFT"
    SILENCE = "SILENCE"


class RecommendationUrgency(StrEnum):
    IMMEDIATE = "IMMEDIATE"
    SOON = "SOON"
    BACKGROUND = "BACKGROUND"


class RecommendationContent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    headline: str = Field(min_length=1, max_length=96)
    body: str = Field(min_length=1)
    rationale: str = Field(min_length=1)
    alternatives: list[str] = Field(default_factory=list, max_length=2)


class Recommendation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rec_id: UUID = Field(default_factory=uuid4)
    session_id: UUID
    cycle_id: UUID
    rec_type: RecommendationType
    urgency: RecommendationUrgency
    content: RecommendationContent
    confidence: float = Field(ge=0.0, le=1.0)
    display_ttl_ms: int = Field(gt=0)
    triggered_by: list[UUID]
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at_utc: datetime = Field(default_factory=utc_now)

    @field_validator("created_at_utc")
    @classmethod
    def validate_created_at(cls, value: datetime) -> datetime:
        return ensure_aware_utc(value)

