from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from clozflow_brain.contracts.engines import (
    EngineExecutionInput,
    EngineExecutionOutput,
    EngineRegistration,
    EngineStatus,
    EngineType,
)
from clozflow_brain.contracts.events import CognitiveEvent, EventType
from clozflow_brain.contracts.world_model import WorldModel
from clozflow_brain.kernel.celery_app import celery_app
from clozflow_brain.kernel.observability import InMemoryTelemetry
from clozflow_brain.kernel.registry import EngineRegistry
from clozflow_brain.kernel.scheduler import CognitiveScheduler


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
        return EngineExecutionOutput(
            engine_id=self.registration.engine_id,
            cycle_id=request.cycle_id,
            output_events=[],
            wm_mutations=[],
            confidence=0.8,
            reasoning_trace="Test direct execution engine",
            duration_ms=5,
            status=EngineStatus.SUCCESS,
        )


class TestScheduler(unittest.TestCase):
    def setUp(self) -> None:
        env_patch = patch.dict(os.environ, {"CEB_SCHEDULER_MODE": "celery"})
        env_patch.start()
        self.addCleanup(env_patch.stop)
        # Force Celery to execute tasks synchronously for test purposes
        celery_app.conf.update(task_always_eager=True)
        self.telemetry = InMemoryTelemetry()
        self.registry = EngineRegistry()
        self.scheduler = CognitiveScheduler(self.registry, self.telemetry)
        self.addCleanup(self.scheduler.close)

        self.session_id = uuid4()
        self.tenant_id = uuid4()
        self.cycle_id = uuid4()
        self.world_model = WorldModel(
            session_id=self.session_id,
            tenant_id=self.tenant_id,
            version=1,
            context_window=[],
            pending_recommendations=[],
        )
        self.event = CognitiveEvent.create(
            event_type=EventType.TRANSCRIPT_SEGMENT,
            session_id=self.session_id,
            tenant_id=self.tenant_id,
            sequence_num=1,
            source="unit-test",
            confidence=1.0,
            payload={
                "text": "Hello world",
                "speaker_id": "SPEAKER_0",
                "speaker_role": "BUYER",
                "start_ms": 0,
                "end_ms": 1000,
                "is_final": True,
            },
        )

    def test_registry_loading_from_yaml(self) -> None:
        # Load the actual configs/engines.yaml from workspace
        self.registry.load_from_yaml("configs/engines.yaml")

        # Verify engines were instantiated and matched correctly
        engines = self.registry.match_event_types({EventType.TRANSCRIPT_SEGMENT})
        engine_ids = [e.registration.engine_id for e in engines]

        # Ensure that perception, understanding, recommendation, etc. are loaded
        self.assertIn("perception.concrete", engine_ids)
        self.assertIn("understanding.concrete", engine_ids)
        self.assertIn("recommendation.concrete", engine_ids)

        # Ensure sorted by priority
        priorities = [e.registration.priority for e in engines]
        self.assertEqual(priorities, sorted(priorities))

    def test_scheduler_execution_with_celery(self) -> None:
        # Load registry
        self.registry.load_from_yaml("configs/engines.yaml")

        # We only want to match one engine to make verification clean
        # Let's filter input events to match SPEAKER_CHANGE (only perception matches)
        speaker_event = CognitiveEvent.create(
            event_type=EventType.SPEAKER_CHANGE,
            session_id=self.session_id,
            tenant_id=self.tenant_id,
            sequence_num=1,
            source="unit-test",
            confidence=1.0,
            payload={},
        )

        outputs = self.scheduler.execute(
            cycle_id=self.cycle_id,
            events=[speaker_event],
            world_model=self.world_model,
        )

        self.assertEqual(len(outputs), 1)
        self.assertEqual(outputs[0].engine_id, "perception.concrete")
        self.assertEqual(outputs[0].status, EngineStatus.SUCCESS)
        self.assertEqual(outputs[0].cycle_id, self.cycle_id)

    def test_scheduler_fallback_direct_execution(self) -> None:
        # Register RecommendationTestEngine without class_path
        self.registry.register(RecommendationTestEngine())

        outputs = self.scheduler.execute(
            cycle_id=self.cycle_id,
            events=[self.event],
            world_model=self.world_model,
        )

        self.assertEqual(len(outputs), 1)
        self.assertEqual(outputs[0].engine_id, "recommendation.test")
        self.assertEqual(outputs[0].status, EngineStatus.SUCCESS)

    def test_scheduler_timeout_handling(self) -> None:
        self.registry.load_from_yaml("configs/engines.yaml")

        # Mock execute_engine_task.apply_async to return a mock result whose get raises TimeoutError
        mock_result = MagicMock()
        mock_result.get.side_effect = TimeoutError("Task timed out")

        with patch("clozflow_brain.kernel.celery_app.execute_engine_task.apply_async", return_value=mock_result):
            outputs = self.scheduler.execute(
                cycle_id=self.cycle_id,
                events=[self.event],
                world_model=self.world_model,
            )

            # Since multiple engines match TRANSCRIPT_SEGMENT, all should hit the timeout mock
            self.assertTrue(len(outputs) > 0)
            for out in outputs:
                self.assertEqual(out.status, EngineStatus.TIMEOUT)
                assert out.reasoning_trace is not None
                self.assertIn("TimeoutError", out.reasoning_trace)

    def test_scheduler_task_failure_handling(self) -> None:
        self.registry.load_from_yaml("configs/engines.yaml")

        mock_result = MagicMock()
        mock_result.get.side_effect = ValueError("Fatal execution error")

        with patch("clozflow_brain.kernel.celery_app.execute_engine_task.apply_async", return_value=mock_result):
            outputs = self.scheduler.execute(
                cycle_id=self.cycle_id,
                events=[self.event],
                world_model=self.world_model,
            )

            self.assertTrue(len(outputs) > 0)
            for out in outputs:
                self.assertEqual(out.status, EngineStatus.ERROR)
                assert out.reasoning_trace is not None
                self.assertIn("ValueError", out.reasoning_trace)

    def test_scheduler_graceful_degradation_on_dispatch_failure(self) -> None:
        self.registry.load_from_yaml("configs/engines.yaml")

        # Mock apply_async to raise standard connection issue
        with patch("clozflow_brain.kernel.celery_app.execute_engine_task.apply_async", side_effect=RuntimeError("Cannot connect to broker")):
            outputs = self.scheduler.execute(
                cycle_id=self.cycle_id,
                events=[self.event],
                world_model=self.world_model,
            )

            # Should fall back to in-process sync execution (which succeeding because we have stubs)
            self.assertTrue(len(outputs) > 0)
            for out in outputs:
                self.assertEqual(out.status, EngineStatus.ERROR)
                self.assertEqual(out.wm_mutations, [])


if __name__ == "__main__":
    unittest.main()
