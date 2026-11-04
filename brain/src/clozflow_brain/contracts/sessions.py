"""Brain Session contracts."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from clozflow_brain.contracts.common import ensure_aware_utc, utc_now


class SessionStatus(StrEnum):
    INITIALIZING = "INITIALIZING"
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    RECOVERING = "RECOVERING"
    SHUTTING_DOWN = "SHUTTING_DOWN"
    TERMINATED = "TERMINATED"


class BrainSession(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: UUID = Field(default_factory=uuid4)
    tenant_id: UUID
    salesperson_id: str = Field(min_length=1)
    crm_opportunity_id: str | None = None
    status: SessionStatus = SessionStatus.ACTIVE
    created_at_utc: datetime = Field(default_factory=utc_now)
    updated_at_utc: datetime = Field(default_factory=utc_now)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("created_at_utc", "updated_at_utc")
    @classmethod
    def validate_timestamps(cls, value: datetime) -> datetime:
        return ensure_aware_utc(value)

