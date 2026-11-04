from __future__ import annotations

import sys
import unittest
from pathlib import Path
from uuid import uuid4

from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from clozflow_brain.contracts.events import CognitiveEvent, EventType
from clozflow_brain.contracts.world_model import (
    BeliefNode,
    WorldModelMutation,
    WorldModelMutationType,
)


class CognitiveEventContractTests(unittest.TestCase):
    def test_transcript_event_uses_registry_defaults(self) -> None:
        event = CognitiveEvent.create(
            event_type=EventType.TRANSCRIPT_SEGMENT,
            session_id=uuid4(),
            tenant_id=uuid4(),
            sequence_num=1,
            source="unit-test",
            confidence=0.99,
            payload={
                "text": "We need legal approval before moving forward.",
                "speaker_id": "SPEAKER_0",
                "speaker_role": "BUYER",
                "start_ms": 0,
                "end_ms": 1800,
                "is_final": True,
                "language": "en-US",
            },
        )

        self.assertEqual(event.priority, 1)
        self.assertEqual(event.ttl_ms, 200)

    def test_event_rejects_priority_above_registry_ceiling(self) -> None:
        with self.assertRaises(ValidationError):
            CognitiveEvent.create(
                event_type=EventType.TRANSCRIPT_SEGMENT,
                session_id=uuid4(),
                tenant_id=uuid4(),
                sequence_num=1,
                source="unit-test",
                priority=3,
                ttl_ms=200,
                confidence=1,
                payload={
                    "text": "hello",
                    "speaker_id": "SPEAKER_0",
                    "speaker_role": "BUYER",
                    "start_ms": 0,
                    "end_ms": 100,
                    "is_final": True,
                    "language": "en-US",
                },
            )


class WorldModelMutationContractTests(unittest.TestCase):
    def test_belief_mutation_payload_round_trips_as_json(self) -> None:
        session_id = uuid4()
        tenant_id = uuid4()
        belief = BeliefNode(
            belief_type="BUYER_INTENT",
            subject="buyer",
            value="needs legal approval",
            confidence=0.82,
            is_explicit=True,
        )
        mutation = WorldModelMutation(
            mutation_type=WorldModelMutationType.UPSERT_BELIEF,
            session_id=session_id,
            tenant_id=tenant_id,
            payload=belief.model_dump(mode="json"),
        )

        self.assertEqual(mutation.session_id, session_id)
        self.assertEqual(mutation.payload["belief_type"], "BUYER_INTENT")


if __name__ == "__main__":
    unittest.main()

