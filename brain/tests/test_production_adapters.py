from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from clozflow_brain.contracts.events import CognitiveEvent, EventType
from clozflow_brain.contracts.persistence import ArtifactType, CognitiveArtifact
from clozflow_brain.contracts.sessions import BrainSession
from clozflow_brain.contracts.world_model import WorldModelMutation, WorldModelMutationType
from clozflow_brain.infrastructure.kafka_bus import KafkaEventBus
from clozflow_brain.infrastructure.redis_world_model import RedisWorldModelRepository
from clozflow_brain.infrastructure.sqlalchemy_repositories import (
    SQLAlchemyPersistenceRepository,
    SQLAlchemySessionRepository,
    create_repository_engine,
)


def make_event(session_id, tenant_id) -> CognitiveEvent:
    return CognitiveEvent.create(
        event_type=EventType.TRANSCRIPT_SEGMENT,
        session_id=session_id,
        tenant_id=tenant_id,
        sequence_num=1,
        source="adapter-test",
        confidence=0.99,
        payload={
            "text": "We need procurement approval.",
            "speaker_id": "SPEAKER_0",
            "speaker_role": "BUYER",
            "start_ms": 0,
            "end_ms": 1200,
            "is_final": True,
            "language": "en-US",
        },
    )


class SQLAlchemyAdapterTests(unittest.TestCase):
    def test_session_repository_persists_and_lists_active_sessions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "sessions.sqlite"
            engine = create_repository_engine(f"sqlite:///{db_path}")
            try:
                repository = SQLAlchemySessionRepository(engine)
                tenant_id = uuid4()
                session = BrainSession(tenant_id=tenant_id, salesperson_id="rep-1")

                repository.save(session)
                loaded = repository.get(session.session_id)
                active = repository.list_active(tenant_id)

                self.assertEqual(loaded.session_id, session.session_id)
                self.assertEqual([item.session_id for item in active], [session.session_id])
            finally:
                engine.dispose()

    def test_persistence_repository_versions_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "artifacts.sqlite"
            engine = create_repository_engine(f"sqlite:///{db_path}")
            try:
                repository = SQLAlchemyPersistenceRepository(engine)
                tenant_id = uuid4()
                artifact = CognitiveArtifact(
                    tenant_id=tenant_id,
                    artifact_type=ArtifactType.KNOWLEDGE,
                    owner="adapter-test",
                    namespace="tests/knowledge",
                    semantic_type="playbook",
                    payload={"title": "Procurement approval"},
                )

                first = repository.save_artifact(artifact)
                second = repository.save_artifact(first.model_copy(update={"payload": {"title": "Updated"}}))
                loaded = repository.get_artifact(tenant_id, artifact.artifact_id)

                self.assertEqual(first.version, 1)
                self.assertEqual(second.version, 2)
                self.assertEqual(loaded.payload["title"], "Updated")
            finally:
                engine.dispose()


class FakeRedisJson:
    def __init__(self) -> None:
        self.store = {}

    def set(self, key, path, value) -> None:
        self.store[key] = value

    def get(self, key):
        return self.store.get(key)


class FakeRedis:
    def __init__(self) -> None:
        self.json_api = FakeRedisJson()

    def json(self) -> FakeRedisJson:
        return self.json_api


class RedisWorldModelAdapterTests(unittest.TestCase):
    def test_redis_world_model_applies_shared_mutation_rules(self) -> None:
        redis = FakeRedis()
        repository = RedisWorldModelRepository(redis)
        tenant_id = uuid4()
        session = BrainSession(tenant_id=tenant_id, salesperson_id="rep-1")
        repository.create(session)

        updated = repository.apply_mutations(
            session.session_id,
            [
                WorldModelMutation(
                    mutation_type=WorldModelMutationType.APPEND_CONTEXT,
                    session_id=session.session_id,
                    tenant_id=tenant_id,
                    payload={"text": "Need procurement approval."},
                )
            ],
        )
        loaded = repository.get(session.session_id)

        self.assertEqual(updated.version, 2)
        self.assertEqual(loaded.context_window, ["Need procurement approval."])


class FakeProducer:
    def __init__(self, sink) -> None:
        self.sink = sink
        self.started = False
        self.stopped = False

    async def start(self) -> None:
        self.started = True

    async def send_and_wait(self, topic, value, key=None, headers=None) -> None:
        self.sink.append({"topic": topic, "value": value, "key": key, "headers": headers})

    async def stop(self) -> None:
        self.stopped = True


class KafkaEventBusAdapterTests(unittest.TestCase):
    def test_kafka_event_bus_serializes_cognitive_event(self) -> None:
        sent = []
        bus = KafkaEventBus(
            bootstrap_servers="localhost:9092",
            topic="cognitive.events",
            producer_factory=lambda: FakeProducer(sent),
        )
        tenant_id = uuid4()
        session_id = uuid4()
        event = make_event(session_id, tenant_id)

        try:
            bus.publish(event)
        finally:
            bus.close()

        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]["topic"], "cognitive.events")
        self.assertIn(str(event.event_id).encode("utf-8"), sent[0]["value"])
        self.assertEqual(bus.list_events(EventType.TRANSCRIPT_SEGMENT), [event])


if __name__ == "__main__":
    unittest.main()
