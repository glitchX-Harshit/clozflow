"""Stub implementations for the ten CCBS cognitive engines."""

from __future__ import annotations

from time import perf_counter
from clozflow_brain.contracts.engines import (
    EngineRegistration,
    EngineExecutionInput,
    EngineExecutionOutput,
    EngineType,
    EngineStatus,
)
from clozflow_brain.contracts.events import EventType


class BaseStubEngine:
    """Base class for stub engines providing registration and execution wrapper."""

    def __init__(self, engine_id: str, engine_type: EngineType, input_types: list[EventType], latency_budget_ms: int, priority: int) -> None:
        self._registration = EngineRegistration(
            engine_id=engine_id,
            engine_type=engine_type,
            version="0.1.0",
            input_types=input_types,
            output_types=[],
            latency_budget_ms=latency_budget_ms,
            priority=priority,
            capabilities=[engine_type.value.lower()],
        )

    @property
    def registration(self) -> EngineRegistration:
        return self._registration

    def execute(self, request: EngineExecutionInput) -> EngineExecutionOutput:
        started = perf_counter()
        return EngineExecutionOutput(
            engine_id=self.registration.engine_id,
            cycle_id=request.cycle_id,
            output_events=[],
            wm_mutations=[],
            confidence=1.0,
            reasoning_trace=f"Stub execution for {self.registration.engine_id}",
            duration_ms=int((perf_counter() - started) * 1000),
            status=EngineStatus.SUCCESS,
        )


class PerceptionEngineStub(BaseStubEngine):
    def __init__(self) -> None:
        super().__init__(
            engine_id="perception.stub",
            engine_type=EngineType.PERCEPTION,
            input_types=[EventType.TRANSCRIPT_SEGMENT, EventType.SPEAKER_CHANGE, EventType.SILENCE_DETECTED],
            latency_budget_ms=100,
            priority=1,
        )


class UnderstandingEngineStub(BaseStubEngine):
    def __init__(self) -> None:
        super().__init__(
            engine_id="understanding.stub",
            engine_type=EngineType.UNDERSTANDING,
            input_types=[EventType.TRANSCRIPT_SEGMENT],
            latency_budget_ms=120,
            priority=1,
        )


class InterpretationEngineStub(BaseStubEngine):
    def __init__(self) -> None:
        super().__init__(
            engine_id="interpretation.stub",
            engine_type=EngineType.INTERPRETATION,
            input_types=[EventType.TRANSCRIPT_SEGMENT],
            latency_budget_ms=300,
            priority=2,
        )


class PredictionEngineStub(BaseStubEngine):
    def __init__(self) -> None:
        super().__init__(
            engine_id="prediction.stub",
            engine_type=EngineType.PREDICTION,
            input_types=[EventType.TRANSCRIPT_SEGMENT],
            latency_budget_ms=500,
            priority=3,
        )


class EvaluationEngineStub(BaseStubEngine):
    def __init__(self) -> None:
        super().__init__(
            engine_id="evaluation.stub",
            engine_type=EngineType.EVALUATION,
            input_types=[EventType.TRANSCRIPT_SEGMENT],
            latency_budget_ms=400,
            priority=3,
        )


class PlanningEngineStub(BaseStubEngine):
    def __init__(self) -> None:
        super().__init__(
            engine_id="planning.stub",
            engine_type=EngineType.PLANNING,
            input_types=[EventType.TRANSCRIPT_SEGMENT],
            latency_budget_ms=300,
            priority=3,
        )


class DecisionEngineStub(BaseStubEngine):
    def __init__(self) -> None:
        super().__init__(
            engine_id="decision.stub",
            engine_type=EngineType.DECISION,
            input_types=[EventType.TRANSCRIPT_SEGMENT],
            latency_budget_ms=150,
            priority=3,
        )


class VerificationEngineStub(BaseStubEngine):
    def __init__(self) -> None:
        super().__init__(
            engine_id="verification.stub",
            engine_type=EngineType.VERIFICATION,
            input_types=[EventType.TRANSCRIPT_SEGMENT],
            latency_budget_ms=100,
            priority=2,
        )


class RecommendationEngineStub(BaseStubEngine):
    def __init__(self) -> None:
        super().__init__(
            engine_id="recommendation.stub",
            engine_type=EngineType.RECOMMENDATION,
            input_types=[EventType.TRANSCRIPT_SEGMENT],
            latency_budget_ms=750,
            priority=2,
        )


class ReflectionEngineStub(BaseStubEngine):
    def __init__(self) -> None:
        super().__init__(
            engine_id="reflection.stub",
            engine_type=EngineType.REFLECTION,
            input_types=[EventType.SESSION_END],
            latency_budget_ms=30000,
            priority=5,
        )
