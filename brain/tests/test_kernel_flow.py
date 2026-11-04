from __future__ import annotations

import sys
import unittest
from pathlib import Path
from time import perf_counter
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from clozflow_brain.application.event_ingestion import EventIngestionService
from clozflow_brain.application.session_service import SessionService
from clozflow_brain.contracts.engines import (
    EngineExecutionInput,
    EngineExecutionOutput,
    EngineRegistration,
    EngineStatus,
    EngineType,
)
from clozflow_brain.contracts.events import CognitiveEvent, EventType
from clozflow_brain.contracts.recommendations import (
    Recommendation,
    RecommendationContent,
    RecommendationType,
    RecommendationUrgency,
)
from clozflow_brain.contracts.world_model import WorldModelMutation, WorldModelMutationType
from clozflow_brain.infrastructure.repositories import (
    InMemorySessionRepository,
    InMemoryWorldModelRepository,
)
from clozflow_brain.kernel.buses import InMemoryEventBus
from clozflow_brain.kernel.kernel import CognitiveKernel
from clozflow_brain.kernel.observability import InMemoryTelemetry, TelemetrySignal
from clozflow_brain.kernel.registry import EngineRegistry


class RecommendationTestEngine:
    def __init__(self) -> None:
        self._registration = EngineRegistration(
            engine_id="recommendation.test",
            engine_type=EngineType.RECOMMENDATION,
            version="0.1.0",
            input_types=[EventType.TRANSCRIPT_SEGMENT],
            output_types=[],
            latency_budget_ms=50,
            priority=5,
            capabilities=["contract-test"],
        )

    @property
    def registration(self) -> EngineRegistration:
        return self._registration

    def execute(self, request: EngineExecutionInput) -> EngineExecutionOutput:
        started = perf_counter()
        event = request.events[0]
        rec = Recommendation(
            session_id=event.session_id,
            cycle_id=request.cycle_id,
            rec_type=RecommendationType.RESPONSE_SUGGESTION,
            urgency=RecommendationUrgency.SOON,
            content=RecommendationContent(
                headline="Clarify legal path",
                body="Ask what legal needs to approve and when they can review it.",
                rationale="The buyer introduced an approval constraint.",
                alternatives=[],
            ),
            confidence=0.77,
            display_ttl_ms=15000,
            triggered_by=[event.event_id],
        )
        return EngineExecutionOutput(
            engine_id=self.registration.engine_id,
            cycle_id=request.cycle_id,
            output_events=[],
            wm_mutations=[
                WorldModelMutation(
                    mutation_type=WorldModelMutationType.APPEND_CONTEXT,
                    session_id=event.session_id,
                    tenant_id=event.tenant_id,
                    payload={"text": event.payload["text"]},
                    caused_by_event_id=event.event_id,
                ),
                WorldModelMutation(
                    mutation_type=WorldModelMutationType.PUSH_RECOMMENDATION,
                    session_id=event.session_id,
                    tenant_id=event.tenant_id,
                    payload=rec.model_dump(mode="json"),
                    caused_by_event_id=event.event_id,
                ),
            ],
            confidence=0.77,
            reasoning_trace="contract test engine emitted a recommendation mutation",
            duration_ms=int((perf_counter() - started) * 1000),
            status=EngineStatus.SUCCESS,
        )


class KernelFlowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.sessions = InMemorySessionRepository()
        self.world_models = InMemoryWorldModelRepository()
        self.telemetry = InMemoryTelemetry()
        self.registry = EngineRegistry()
        self.registry.register(RecommendationTestEngine())
        self.event_bus = InMemoryEventBus()
        self.kernel = CognitiveKernel(
            event_bus=self.event_bus,
            engine_registry=self.registry,
            session_repository=self.sessions,
            world_model_repository=self.world_models,
            telemetry=self.telemetry,
        )
        self.session_service = SessionService(
            sessions=self.sessions,
            world_models=self.world_models,
            telemetry=self.telemetry,
            kernel=self.kernel,
        )
        self.ingestion = EventIngestionService(self.kernel)

    def test_session_creation_initializes_world_model_and_start_event(self) -> None:
        tenant_id = uuid4()
        session = self.session_service.create_session(
            tenant_id=tenant_id,
            salesperson_id="rep-1",
            crm_opportunity_id="opp-1",
        )

        world_model = self.world_models.get(session.session_id)
        start_events = self.event_bus.list_events(EventType.SESSION_START)

        self.assertEqual(world_model.session_id, session.session_id)
        self.assertEqual(world_model.tenant_id, tenant_id)
        self.assertEqual(len(start_events), 1)
        self.assertEqual(self.telemetry.counter_value(TelemetrySignal.BRAIN_EVENTS_TOTAL), 1)

    def test_kernel_executes_engine_and_applies_world_model_mutations(self) -> None:
        tenant_id = uuid4()
        session = self.session_service.create_session(
            tenant_id=tenant_id,
            salesperson_id="rep-1",
        )
        event = CognitiveEvent.create(
            event_type=EventType.TRANSCRIPT_SEGMENT,
            session_id=session.session_id,
            tenant_id=tenant_id,
            sequence_num=1,
            source="unit-test",
            confidence=0.98,
            payload={
                "text": "We need legal approval before signing.",
                "speaker_id": "SPEAKER_0",
                "speaker_role": "BUYER",
                "start_ms": 0,
                "end_ms": 1500,
                "is_final": True,
                "language": "en-US",
            },
        )

        result = self.ingestion.ingest(event)
        world_model = self.world_models.get(session.session_id)

        self.assertEqual(result.trace.engine_ids, ["recommendation.test"])
        self.assertEqual(world_model.version, 3)  # SESSION_START is also recorded for replay protection
        self.assertEqual(world_model.context_window, ["We need legal approval before signing."])
        self.assertEqual(len(world_model.pending_recommendations), 1)
        self.assertEqual(world_model.pending_recommendations[0].content.headline, "Clarify legal path")


if __name__ == "__main__":
    unittest.main()

