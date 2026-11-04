"""Cognitive engine registration and execution contracts."""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from clozflow_brain.contracts.context import CognitiveContext
from clozflow_brain.contracts.events import CognitiveEvent, EventType
from clozflow_brain.contracts.world_model import WorldModel, WorldModelMutation


class EngineType(StrEnum):
    PERCEPTION = "PERCEPTION"
    UNDERSTANDING = "UNDERSTANDING"
    INTERPRETATION = "INTERPRETATION"
    PREDICTION = "PREDICTION"
    EVALUATION = "EVALUATION"
    PLANNING = "PLANNING"
    DECISION = "DECISION"
    VERIFICATION = "VERIFICATION"
    RECOMMENDATION = "RECOMMENDATION"
    REFLECTION = "REFLECTION"


class EngineStatus(StrEnum):
    SUCCESS = "SUCCESS"
    PARTIAL = "PARTIAL"
    TIMEOUT = "TIMEOUT"
    ERROR = "ERROR"


class EngineRegistration(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    engine_id: str = Field(min_length=1)
    engine_type: EngineType
    version: str = Field(min_length=1)
    input_types: list[EventType]
    output_types: list[EventType] = Field(default_factory=list)
    latency_budget_ms: int = Field(gt=0)
    priority: int = Field(ge=1, le=10)
    capabilities: list[str] = Field(default_factory=list)
    health_endpoint: str | None = None
    config_schema: dict[str, Any] = Field(default_factory=dict)


class EngineExecutionInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    cycle_id: UUID
    events: list[CognitiveEvent]
    world_model: WorldModel
    cognitive_context: CognitiveContext | None = None
    engine_config: dict[str, Any] = Field(default_factory=dict)
    timeout_ms: int = Field(gt=0)


class EngineExecutionOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    engine_id: str
    cycle_id: UUID
    output_events: list[CognitiveEvent] = Field(default_factory=list)
    wm_mutations: list[WorldModelMutation] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning_trace: str | None = None
    duration_ms: int = Field(ge=0)
    status: EngineStatus


class CognitiveEngine(Protocol):
    @property
    def registration(self) -> EngineRegistration:
        """Return this engine's scheduler-visible registration."""
        ...

    def execute(self, request: EngineExecutionInput) -> EngineExecutionOutput:
        """Execute one stateless engine call."""
        ...
