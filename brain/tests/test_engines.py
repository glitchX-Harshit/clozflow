from __future__ import annotations

import sys
import unittest
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from clozflow_brain.contracts.engines import EngineExecutionInput, EngineStatus
from clozflow_brain.contracts.events import CognitiveEvent, EventType
from clozflow_brain.contracts.world_model import WorldModel, WorldModelMutationType

# Concrete engines
from clozflow_brain.engines.perception import PerceptionEngine
from clozflow_brain.engines.understanding import UnderstandingEngine
from clozflow_brain.engines.interpretation import InterpretationEngine
from clozflow_brain.engines.prediction import PredictionEngine
from clozflow_brain.engines.evaluation import EvaluationEngine
from clozflow_brain.engines.planning import PlanningEngine
from clozflow_brain.engines.decision import DecisionEngine
from clozflow_brain.engines.verification import VerificationEngine
from clozflow_brain.engines.recommendation import RecommendationEngine
from clozflow_brain.engines.reflection import ReflectionEngine


class TestCognitiveEngines(unittest.TestCase):
    def setUp(self) -> None:
        self.session_id = uuid4()
        self.tenant_id = uuid4()
        self.cycle_id = uuid4()
        self.world_model = WorldModel(
            session_id=self.session_id,
            tenant_id=self.tenant_id,
            version=1,
            context_window=["SALESPERSON: Hello, how is your budget looking?", "BUYER: We have a constraint."],
            pending_recommendations=[],
        )

        self.transcript_event = CognitiveEvent.create(
            event_type=EventType.TRANSCRIPT_SEGMENT,
            session_id=self.session_id,
            tenant_id=self.tenant_id,
            sequence_num=1,
            source="test",
            confidence=1.0,
            payload={
                "text": "Actually, pricing is a bit high for us.",
                "speaker_id": "BUYER_1",
                "speaker_role": "BUYER",
                "start_ms": 0,
                "end_ms": 1000,
                "is_final": True,
                "audio_features": {
                    "speech_rate_wpm": 190,
                    "pitch_hz": 150.0,
                    "energy_db": -20.0,
                }
            },
        )

        self.session_end_event = CognitiveEvent.create(
            event_type=EventType.SESSION_END,
            session_id=self.session_id,
            tenant_id=self.tenant_id,
            sequence_num=2,
            source="test",
            confidence=1.0,
            payload={},
        )

    def test_perception_engine(self) -> None:
        engine = PerceptionEngine()
        self.assertEqual(engine.registration.engine_id, "perception.concrete")

        request = EngineExecutionInput(
            cycle_id=self.cycle_id,
            events=[self.transcript_event],
            world_model=self.world_model,
            timeout_ms=1000,
        )

        output = engine.execute(request)
        self.assertEqual(output.status, EngineStatus.SUCCESS)
        self.assertTrue(any(m.mutation_type == WorldModelMutationType.APPEND_CONTEXT for m in output.wm_mutations))
        self.assertTrue(any(m.mutation_type == WorldModelMutationType.UPSERT_BELIEF for m in output.wm_mutations))

    def test_understanding_engine(self) -> None:
        engine = UnderstandingEngine()
        self.assertEqual(engine.registration.engine_id, "understanding.concrete")

        request = EngineExecutionInput(
            cycle_id=self.cycle_id,
            events=[self.transcript_event],
            world_model=self.world_model,
            timeout_ms=1000,
        )

        output = engine.execute(request)
        self.assertEqual(output.status, EngineStatus.SUCCESS)

        # Verify it created buyer intent and sentiment beliefs
        belief_types = [m.payload["belief_type"] for m in output.wm_mutations if m.mutation_type == WorldModelMutationType.UPSERT_BELIEF]
        self.assertIn("BUYER_INTENT", belief_types)
        self.assertIn("BUYER_SENTIMENT", belief_types)

    def test_interpretation_engine(self) -> None:
        engine = InterpretationEngine()
        self.assertEqual(engine.registration.engine_id, "interpretation.concrete")

        request = EngineExecutionInput(
            cycle_id=self.cycle_id,
            events=[self.transcript_event],
            world_model=self.world_model,
            timeout_ms=1000,
        )

        output = engine.execute(request)
        self.assertEqual(output.status, EngineStatus.SUCCESS)
        self.assertTrue(any(m.mutation_type == WorldModelMutationType.ADD_OBJECTION for m in output.wm_mutations))

    def test_prediction_engine(self) -> None:
        engine = PredictionEngine()
        self.assertEqual(engine.registration.engine_id, "prediction.concrete")

        request = EngineExecutionInput(
            cycle_id=self.cycle_id,
            events=[self.transcript_event],
            world_model=self.world_model,
            timeout_ms=1000,
        )

        output = engine.execute(request)
        self.assertEqual(output.status, EngineStatus.SUCCESS)
        self.assertTrue(any(m.mutation_type == WorldModelMutationType.UPSERT_BELIEF for m in output.wm_mutations))

    def test_evaluation_engine(self) -> None:
        engine = EvaluationEngine()
        self.assertEqual(engine.registration.engine_id, "evaluation.concrete")

        request = EngineExecutionInput(
            cycle_id=self.cycle_id,
            events=[self.transcript_event],
            world_model=self.world_model,
            timeout_ms=1000,
        )

        output = engine.execute(request)
        self.assertEqual(output.status, EngineStatus.SUCCESS)
        self.assertTrue(any(m.mutation_type == WorldModelMutationType.UPSERT_BELIEF for m in output.wm_mutations))

    def test_planning_engine(self) -> None:
        from clozflow_brain.contracts.world_model import BeliefNode
        self.world_model.crm_beliefs.append(BeliefNode(belief_type="EVALUATED_STRATEGY", subject="session", value={"rank": 1, "description": "Clarify needs", "strategy_id": "needs"}, confidence=.9, evidence_ids=[self.transcript_event.event_id]))
        engine = PlanningEngine()
        self.assertEqual(engine.registration.engine_id, "planning.concrete")

        request = EngineExecutionInput(
            cycle_id=self.cycle_id,
            events=[self.transcript_event],
            world_model=self.world_model,
            timeout_ms=1000,
        )

        output = engine.execute(request)
        self.assertEqual(output.status, EngineStatus.SUCCESS)
        self.assertTrue(any(m.mutation_type == WorldModelMutationType.UPSERT_BELIEF for m in output.wm_mutations))

    def test_decision_engine(self) -> None:
        from clozflow_brain.contracts.world_model import BeliefNode
        self.world_model.crm_beliefs.append(BeliefNode(belief_type="EXECUTABLE_PLAN", subject="session", value={"playbook_name": "Clarify needs", "confidence": .9, "steps": []}, confidence=.9, evidence_ids=[self.transcript_event.event_id]))
        engine = DecisionEngine()
        self.assertEqual(engine.registration.engine_id, "decision.concrete")

        request = EngineExecutionInput(
            cycle_id=self.cycle_id,
            events=[self.transcript_event],
            world_model=self.world_model,
            timeout_ms=1000,
        )

        output = engine.execute(request)
        self.assertEqual(output.status, EngineStatus.SUCCESS)
        self.assertTrue(any(m.mutation_type == WorldModelMutationType.SET_GOAL for m in output.wm_mutations))

    def test_verification_engine(self) -> None:
        engine = VerificationEngine()
        self.assertEqual(engine.registration.engine_id, "verification.concrete")

        request = EngineExecutionInput(
            cycle_id=self.cycle_id,
            events=[self.transcript_event],
            world_model=self.world_model,
            timeout_ms=1000,
        )

        output = engine.execute(request)
        self.assertEqual(output.status, EngineStatus.SUCCESS)
        self.assertTrue(any(m.mutation_type == WorldModelMutationType.UPSERT_BELIEF for m in output.wm_mutations))

    def test_recommendation_engine(self) -> None:
        from clozflow_brain.contracts.world_model import BeliefNode
        self.world_model.crm_beliefs.append(BeliefNode(
            belief_type="VERIFICATION_STATUS", subject="session",
            value={"is_verified": True}, confidence=0.9,
        ))
        engine = RecommendationEngine()
        self.assertEqual(engine.registration.engine_id, "recommendation.concrete")

        request = EngineExecutionInput(
            cycle_id=self.cycle_id,
            events=[self.transcript_event],
            world_model=self.world_model,
            timeout_ms=1000,
        )

        output = engine.execute(request)
        self.assertEqual(output.status, EngineStatus.SUCCESS)
        self.assertTrue(any(m.mutation_type == WorldModelMutationType.PUSH_RECOMMENDATION for m in output.wm_mutations))

    def test_reflection_engine(self) -> None:
        engine = ReflectionEngine()
        self.assertEqual(engine.registration.engine_id, "reflection.concrete")

        request = EngineExecutionInput(
            cycle_id=self.cycle_id,
            events=[self.session_end_event],
            world_model=self.world_model,
            timeout_ms=1000,
        )

        output = engine.execute(request)
        self.assertEqual(output.status, EngineStatus.SUCCESS)
        self.assertTrue(any(m.mutation_type == WorldModelMutationType.UPSERT_BELIEF for m in output.wm_mutations))


if __name__ == "__main__":
    unittest.main()
