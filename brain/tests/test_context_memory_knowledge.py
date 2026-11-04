from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from time import perf_counter
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from clozflow_brain.application.context_service import ContextService
from clozflow_brain.application.event_ingestion import EventIngestionService
from clozflow_brain.application.knowledge_service import KnowledgeService
from clozflow_brain.application.memory_service import MemoryService
from clozflow_brain.application.persistence_service import PersistenceService
from clozflow_brain.application.session_service import SessionService
from clozflow_brain.contracts.engines import (
    EngineExecutionInput,
    EngineExecutionOutput,
    EngineRegistration,
    EngineStatus,
    EngineType,
)
from clozflow_brain.contracts.events import CognitiveEvent, EventType
from clozflow_brain.contracts.knowledge import DiscoveryIntent, KnowledgeArtifact, KnowledgeKind
from clozflow_brain.contracts.memory import MemoryRecord, MemoryScope, MemoryType
from clozflow_brain.contracts.persistence import ArtifactType, CognitiveArtifact
from clozflow_brain.contracts.sessions import BrainSession
from clozflow_brain.contracts.world_model import WorldModelMutationType
from clozflow_brain.infrastructure.cognitive_repositories import (
    InMemoryContextRepository,
    InMemoryKnowledgeRepository,
    InMemoryMemoryRepository,
    InMemoryPersistenceRepository,
)
from clozflow_brain.infrastructure.repositories import (
    InMemorySessionRepository,
    InMemoryWorldModelRepository,
)
from clozflow_brain.infrastructure.sqlite_persistence import SQLitePersistenceRepository
from clozflow_brain.infrastructure.sqlalchemy_repositories import (
    SQLAlchemyContextRepository,
    SQLAlchemyKnowledgeRepository,
    SQLAlchemyMemoryRepository,
    create_repository_engine,
)
from clozflow_brain.kernel.buses import InMemoryEventBus
from clozflow_brain.kernel.kernel import CognitiveKernel
from clozflow_brain.kernel.observability import InMemoryTelemetry
from clozflow_brain.kernel.registry import EngineRegistry


class ContextAwareTestEngine:
    def __init__(self) -> None:
        self._registration = EngineRegistration(
            engine_id="context.assertion",
            engine_type=EngineType.UNDERSTANDING,
            version="0.1.0",
            input_types=[EventType.TRANSCRIPT_SEGMENT],
            output_types=[],
            latency_budget_ms=50,
            priority=1,
        )

    @property
    def registration(self) -> EngineRegistration:
        return self._registration

    def execute(self, request: EngineExecutionInput) -> EngineExecutionOutput:
        started = perf_counter()
        assert request.cognitive_context is not None
        assert request.cognitive_context.quality.ready_for_reasoning
        return EngineExecutionOutput(
            engine_id=self.registration.engine_id,
            cycle_id=request.cycle_id,
            confidence=1.0,
            duration_ms=int((perf_counter() - started) * 1000),
            status=EngineStatus.SUCCESS,
            reasoning_trace="context was constructed before engine execution",
        )


def transcript_event(session_id, tenant_id) -> CognitiveEvent:
    return CognitiveEvent.create(
        event_type=EventType.TRANSCRIPT_SEGMENT,
        session_id=session_id,
        tenant_id=tenant_id,
        sequence_num=1,
        source="unit-test",
        confidence=0.95,
        payload={
            "text": "Legal approval is needed before procurement can sign.",
            "speaker_id": "SPEAKER_0",
            "speaker_role": "BUYER",
            "start_ms": 0,
            "end_ms": 1800,
            "is_final": True,
            "language": "en-US",
        },
    )


class PersistenceTests(unittest.TestCase):
    def test_sqlite_artifact_survives_repository_restart(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "brain.sqlite"
            tenant_id = uuid4()
            artifact = CognitiveArtifact(
                tenant_id=tenant_id,
                artifact_type=ArtifactType.MEMORY,
                owner="unit-test",
                namespace="tests/memory",
                semantic_type="episodic_memory",
                payload={"summary": "buyer required legal approval"},
                confidence=0.9,
            )
            first_repo = SQLitePersistenceRepository(db_path)
            saved = first_repo.save_artifact(artifact)

            second_repo = SQLitePersistenceRepository(db_path)
            loaded = second_repo.get_artifact(tenant_id, saved.artifact_id)

            self.assertEqual(loaded.artifact_id, saved.artifact_id)
            self.assertEqual(loaded.payload["summary"], "buyer required legal approval")


class ContextKernelTests(unittest.TestCase):
    def test_kernel_constructs_context_before_engine_execution(self) -> None:
        sessions = InMemorySessionRepository()
        world_models = InMemoryWorldModelRepository()
        telemetry = InMemoryTelemetry()
        registry = EngineRegistry()
        registry.register(ContextAwareTestEngine())
        context_service = ContextService(
            repository=InMemoryContextRepository(),
            persistence=PersistenceService(InMemoryPersistenceRepository()),
        )
        kernel = CognitiveKernel(
            event_bus=InMemoryEventBus(),
            engine_registry=registry,
            session_repository=sessions,
            world_model_repository=world_models,
            context_service=context_service,
            telemetry=telemetry,
        )
        session_service = SessionService(
            sessions=sessions,
            world_models=world_models,
            telemetry=telemetry,
            kernel=kernel,
        )
        tenant_id = uuid4()
        session = session_service.create_session(tenant_id=tenant_id, salesperson_id="rep-1")

        result = EventIngestionService(kernel).ingest(transcript_event(session.session_id, tenant_id))

        assert result.cognitive_context is not None
        self.assertEqual(result.trace.engine_ids, ["context.assertion"])
        self.assertTrue(result.cognitive_context.quality.ready_for_reasoning)

    def test_kernel_activates_memory_discovers_knowledge_and_attaches_refs(self) -> None:
        sessions = InMemorySessionRepository()
        world_models = InMemoryWorldModelRepository()
        telemetry = InMemoryTelemetry()
        context_service = ContextService(repository=InMemoryContextRepository())
        memory_service = MemoryService(InMemoryMemoryRepository())
        knowledge_service = KnowledgeService(InMemoryKnowledgeRepository())
        kernel = CognitiveKernel(
            event_bus=InMemoryEventBus(),
            engine_registry=EngineRegistry(),
            session_repository=sessions,
            world_model_repository=world_models,
            context_service=context_service,
            memory_service=memory_service,
            knowledge_service=knowledge_service,
            telemetry=telemetry,
        )
        session_service = SessionService(
            sessions=sessions,
            world_models=world_models,
            telemetry=telemetry,
            kernel=kernel,
        )
        tenant_id = uuid4()
        session = session_service.create_session(tenant_id=tenant_id, salesperson_id="rep-1")
        memory_service.store(
            MemoryRecord(
                tenant_id=tenant_id,
                memory_type=MemoryType.EPISODIC,
                scope=MemoryScope.TENANT,
                subject="procurement approval",
                content={"summary": "Procurement approval blocked the last legal review."},
                concepts=["procurement", "approval", "legal"],
                confidence=0.93,
            )
        )
        knowledge_service.store(
            KnowledgeArtifact(
                tenant_id=tenant_id,
                kind=KnowledgeKind.PLAYBOOK,
                title="Procurement approval playbook",
                body="Confirm owner, approval criteria, and review date.",
                concepts=["procurement", "approval", "legal"],
                provenance="playbooks/procurement-approval.md",
                confidence=0.96,
            )
        )

        result = EventIngestionService(kernel).ingest(transcript_event(session.session_id, tenant_id))
        latest_context = context_service.latest_for_session(session.session_id)
        world_model = world_models.get(session.session_id)

        assert latest_context is not None
        self.assertEqual(len(latest_context.active_memory_ids), 1)
        self.assertEqual(len(latest_context.knowledge_ref_ids), 1)
        self.assertEqual(len(world_model.memory_refs), 1)
        self.assertEqual(len(world_model.knowledge_refs), 1)
        self.assertEqual(result.applied_mutations[0].mutation_type, WorldModelMutationType.ADD_MEMORY_REF)
        self.assertEqual(result.applied_mutations[1].mutation_type, WorldModelMutationType.ADD_KNOWLEDGE_REF)

    def test_session_start_runs_memory_injection_cycle(self) -> None:
        sessions = InMemorySessionRepository()
        world_models = InMemoryWorldModelRepository()
        telemetry = InMemoryTelemetry()
        context_service = ContextService(repository=InMemoryContextRepository())
        memory_service = MemoryService(InMemoryMemoryRepository())
        kernel = CognitiveKernel(
            event_bus=InMemoryEventBus(),
            engine_registry=EngineRegistry(),
            session_repository=sessions,
            world_model_repository=world_models,
            context_service=context_service,
            memory_service=memory_service,
            telemetry=telemetry,
        )
        session_service = SessionService(
            sessions=sessions,
            world_models=world_models,
            telemetry=telemetry,
            kernel=kernel,
        )
        tenant_id = uuid4()
        memory_service.store(
            MemoryRecord(
                tenant_id=tenant_id,
                memory_type=MemoryType.ORGANIZATIONAL,
                scope=MemoryScope.TENANT,
                subject="acme procurement history",
                content={"summary": "Acme requires legal approval for procurement."},
                concepts=["acme", "procurement", "legal"],
                confidence=0.94,
            )
        )

        session = session_service.create_session(
            tenant_id=tenant_id,
            salesperson_id="rep-1",
            metadata={"account": "Acme", "topic": "procurement legal review"},
        )
        world_model = world_models.get(session.session_id)
        latest_context = context_service.latest_for_session(session.session_id)

        self.assertEqual(len(world_model.memory_refs), 1)
        self.assertEqual(world_model.memory_refs[0].subject, "acme procurement history")
        assert latest_context is not None
        self.assertEqual(len(latest_context.active_memory_ids), 1)


class MemoryAndKnowledgeTests(unittest.TestCase):
    def test_memory_activation_uses_contextual_relevance(self) -> None:
        tenant_id = uuid4()
        session_id = uuid4()
        event = transcript_event(session_id, tenant_id)
        world_model = InMemoryWorldModelRepository()
        session_repo = InMemorySessionRepository()
        session = SessionService(
            sessions=session_repo,
            world_models=world_model,
            telemetry=InMemoryTelemetry(),
        ).create_session(tenant_id=tenant_id, salesperson_id="rep-1")
        event = transcript_event(session.session_id, tenant_id)
        context = ContextService(repository=InMemoryContextRepository()).construct(
            events=[event],
            world_model=world_model.get(session.session_id),
        )
        memory_repo = InMemoryMemoryRepository()
        service = MemoryService(memory_repo)
        service.store(
            MemoryRecord(
                tenant_id=tenant_id,
                memory_type=MemoryType.EPISODIC,
                scope=MemoryScope.TENANT,
                subject="legal procurement approval",
                content={"summary": "Past deal stalled until legal approved procurement terms."},
                concepts=["legal", "approval", "procurement"],
                confidence=0.92,
            )
        )
        service.store(
            MemoryRecord(
                tenant_id=tenant_id,
                memory_type=MemoryType.SEMANTIC,
                scope=MemoryScope.TENANT,
                subject="pricing discount",
                content={"summary": "Discount threshold policy."},
                concepts=["discount", "pricing"],
                confidence=0.9,
            )
        )

        working_memory = service.activate_for_context(context, limit=3)

        self.assertEqual(len(working_memory.active_memory_ids), 1)

    def test_knowledge_discovery_preserves_provenance(self) -> None:
        tenant_id = uuid4()
        session_id = uuid4()
        service = KnowledgeService(InMemoryKnowledgeRepository())
        service.store(
            KnowledgeArtifact(
                tenant_id=tenant_id,
                kind=KnowledgeKind.PLAYBOOK,
                title="Legal approval playbook",
                body="Ask who owns legal approval and confirm the review date.",
                concepts=["legal", "approval", "procurement"],
                provenance="playbooks/legal-approval.md",
                confidence=0.95,
            )
        )

        package = service.discover(
            DiscoveryIntent(
                tenant_id=tenant_id,
                session_id=session_id,
                objective="handle legal approval risk",
                concepts=["legal", "approval"],
            )
        )

        self.assertEqual(len(package.candidates), 1)
        self.assertEqual(package.provenance_refs, ["playbooks/legal-approval.md"])
        self.assertGreater(package.confidence, 0.0)

    def test_sqlalchemy_context_memory_and_knowledge_repositories_are_durable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            db_path = Path(tmp_dir) / "phase2.sqlite"
            engine = create_repository_engine(f"sqlite:///{db_path}")
            try:
                tenant_id = uuid4()
                session_id = uuid4()
                event = transcript_event(session_id, tenant_id)
                session = BrainSession(tenant_id=tenant_id, salesperson_id="rep-1")
                session = session.model_copy(update={"session_id": session_id})
                world_model_repo = InMemoryWorldModelRepository()
                world_model_repo.create(session)
                context = ContextService(repository=SQLAlchemyContextRepository(engine)).construct(
                    events=[event],
                    world_model=world_model_repo.get(session_id),
                )
                memory_repo = SQLAlchemyMemoryRepository(engine)
                knowledge_repo = SQLAlchemyKnowledgeRepository(engine)
                memory = memory_repo.save_memory(
                    MemoryRecord(
                        tenant_id=tenant_id,
                        memory_type=MemoryType.SEMANTIC,
                        scope=MemoryScope.TENANT,
                        subject="legal approval",
                        content={"summary": "Legal approval is required for procurement."},
                        concepts=["legal", "approval"],
                        confidence=0.9,
                    )
                )
                knowledge = knowledge_repo.save_knowledge(
                    KnowledgeArtifact(
                        tenant_id=tenant_id,
                        kind=KnowledgeKind.POLICY,
                        title="Legal approval policy",
                        body="Legal must approve procurement language.",
                        concepts=["legal", "approval"],
                        provenance="policies/legal.md",
                        confidence=0.91,
                    )
                )

                reloaded_context_repo = SQLAlchemyContextRepository(engine)
                reloaded_memory_repo = SQLAlchemyMemoryRepository(engine)
                reloaded_knowledge_repo = SQLAlchemyKnowledgeRepository(engine)

                latest_ctx = reloaded_context_repo.latest_for_session(session_id)
                assert latest_ctx is not None
                self.assertEqual(
                    latest_ctx.context_id,
                    context.context_id,
                )
                self.assertEqual(
                    reloaded_memory_repo.get_memory(tenant_id, memory.memory_id).subject,
                    "legal approval",
                )
                self.assertEqual(
                    reloaded_knowledge_repo.get_knowledge(tenant_id, knowledge.knowledge_id).title,
                    "Legal approval policy",
                )
            finally:
                engine.dispose()


if __name__ == "__main__":
    unittest.main()
