"""SQLAlchemy adapters for PostgreSQL-compatible persistence."""

from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy import update, Column, Integer, MetaData, String, Table, create_engine, select
from sqlalchemy.engine import Engine
from clozflow_brain.infrastructure.data_codec import SecureText

from clozflow_brain.contracts.persistence import (
    ArtifactLifecycleState,
    ArtifactRelationship,
    CognitiveArtifact,
)
from clozflow_brain.contracts.context import CognitiveContext
from clozflow_brain.contracts.knowledge import KnowledgeArtifact
from clozflow_brain.contracts.memory import ActivatedMemory, MemoryRecord
from clozflow_brain.contracts.sessions import BrainSession, SessionStatus
from clozflow_brain.contracts.world_model import WorldModel, WorldModelMutation
from clozflow_brain.infrastructure.world_model_mutations import apply_world_model_mutations


metadata = MetaData()

brain_sessions = Table(
    "brain_sessions",
    metadata,
    Column("session_id", String(36), primary_key=True),
    Column("tenant_id", String(36), nullable=False, index=True),
    Column("status", String(32), nullable=False, index=True),
    Column("session_json", SecureText, nullable=False),
    Column("updated_at_utc", String(64), nullable=False),
)

cognitive_artifacts = Table(
    "cognitive_artifacts",
    metadata,
    Column("tenant_id", String(36), primary_key=True),
    Column("artifact_id", String(36), primary_key=True),
    Column("artifact_type", String(64), nullable=False, index=True),
    Column("semantic_type", String(128), nullable=False, index=True),
    Column("lifecycle_state", String(32), nullable=False, index=True),
    Column("version", Integer, nullable=False),
    Column("artifact_json", SecureText, nullable=False),
    Column("updated_at_utc", String(64), nullable=False),
)

artifact_versions = Table(
    "artifact_versions",
    metadata,
    Column("tenant_id", String(36), primary_key=True),
    Column("artifact_id", String(36), primary_key=True),
    Column("version", Integer, primary_key=True),
    Column("artifact_json", SecureText, nullable=False),
    Column("created_at_utc", String(64), nullable=False),
)

artifact_relationships = Table(
    "artifact_relationships",
    metadata,
    Column("tenant_id", String(36), nullable=False, index=True),
    Column("relationship_id", String(36), primary_key=True),
    Column("source_artifact_id", String(36), nullable=False, index=True),
    Column("target_artifact_id", String(36), nullable=False, index=True),
    Column("relationship_type", String(64), nullable=False, index=True),
    Column("relationship_json", SecureText, nullable=False),
    Column("created_at_utc", String(64), nullable=False),
)

cognitive_contexts = Table(
    "cognitive_contexts",
    metadata,
    Column("session_id", String(36), primary_key=True),
    Column("context_id", String(36), primary_key=True),
    Column("version", Integer, primary_key=True),
    Column("tenant_id", String(36), nullable=False, index=True),
    Column("context_json", SecureText, nullable=False),
    Column("updated_at_utc", String(64), nullable=False),
)

cognitive_memories = Table(
    "cognitive_memories",
    metadata,
    Column("tenant_id", String(36), primary_key=True),
    Column("memory_id", String(36), primary_key=True),
    Column("memory_type", String(64), nullable=False, index=True),
    Column("scope", String(64), nullable=False, index=True),
    Column("subject", String(256), nullable=False, index=True),
    Column("memory_json", SecureText, nullable=False),
    Column("updated_at_utc", String(64), nullable=False),
)

memory_activations = Table(
    "memory_activations",
    metadata,
    Column("activation_id", String(36), primary_key=True),
    Column("tenant_id", String(36), nullable=False, index=True),
    Column("session_id", String(36), nullable=False, index=True),
    Column("memory_id", String(36), nullable=False, index=True),
    Column("activation_json", SecureText, nullable=False),
    Column("activated_at_utc", String(64), nullable=False),
)

semantic_knowledge = Table(
    "semantic_knowledge",
    metadata,
    Column("tenant_id", String(36), primary_key=True),
    Column("knowledge_id", String(36), primary_key=True),
    Column("kind", String(64), nullable=False, index=True),
    Column("title", String(256), nullable=False, index=True),
    Column("knowledge_json", SecureText, nullable=False),
    Column("updated_at_utc", String(64), nullable=False),
)

world_model_checkpoints = Table(
    "world_model_checkpoints",
    metadata,
    Column("session_id", String(36), primary_key=True),
    Column("tenant_id", String(36), nullable=False, index=True),
    Column("version", Integer, nullable=False),
    Column("world_model_json", SecureText, nullable=False),
    Column("updated_at_utc", String(64), nullable=False),
)


def create_repository_engine(url: str) -> Engine:
    if url in {"sqlite://", "sqlite:///:memory:"}:
        from sqlalchemy.pool import StaticPool
        return create_engine(url, future=True, connect_args={"check_same_thread": False}, poolclass=StaticPool)
    return create_engine(url, future=True, connect_args={"timeout": 30} if url.startswith("sqlite") else {})


class SQLAlchemySessionRepository:
    """PostgreSQL-compatible Brain Session repository.

    Tests use SQLite through the same SQLAlchemy Core contract.
    """

    def __init__(self, engine: Engine) -> None:
        self._engine = engine
        metadata.create_all(self._engine)

    def save(self, session: BrainSession) -> BrainSession:
        data = session.model_dump_json()
        with self._engine.begin() as conn:
            conn.execute(
                brain_sessions.delete().where(brain_sessions.c.session_id == str(session.session_id))
            )
            conn.execute(
                brain_sessions.insert().values(
                    session_id=str(session.session_id),
                    tenant_id=str(session.tenant_id),
                    status=session.status.value,
                    session_json=data,
                    updated_at_utc=session.updated_at_utc.isoformat(),
                )
            )
        return session

    def list_for_tenant(self, tenant_id: UUID) -> list[BrainSession]:
        with self._engine.connect() as conn:
            rows = conn.execute(select(brain_sessions.c.session_json).where(brain_sessions.c.tenant_id == str(tenant_id))).scalars().all()
        return [BrainSession.model_validate_json(row) for row in rows]

    def get(self, session_id: UUID) -> BrainSession:
        with self._engine.begin() as conn:
            row = conn.execute(
                select(brain_sessions.c.session_json).where(
                    brain_sessions.c.session_id == str(session_id)
                )
            ).fetchone()
        if row is None:
            raise KeyError(f"session not found: {session_id}")
        return BrainSession.model_validate(json.loads(row.session_json))

    def list_active(self, tenant_id: UUID) -> list[BrainSession]:
        with self._engine.begin() as conn:
            rows = conn.execute(
                select(brain_sessions.c.session_json).where(
                    brain_sessions.c.tenant_id == str(tenant_id),
                    brain_sessions.c.status == SessionStatus.ACTIVE.value,
                )
            ).fetchall()
        return [BrainSession.model_validate(json.loads(row.session_json)) for row in rows]

    def list_all_active(self) -> list[BrainSession]:
        with self._engine.begin() as conn:
            rows = conn.execute(
                select(brain_sessions.c.session_json).where(
                    brain_sessions.c.status == SessionStatus.ACTIVE.value,
                )
            ).fetchall()
        return [BrainSession.model_validate(json.loads(row.session_json)) for row in rows]


class SQLAlchemyPersistenceRepository:
    """CCPA repository implemented with SQLAlchemy Core."""

    def __init__(self, engine: Engine) -> None:
        self._engine = engine
        metadata.create_all(self._engine)

    def save_artifact(self, artifact: CognitiveArtifact) -> CognitiveArtifact:
        with self._engine.begin() as conn:
            row = conn.execute(
                select(cognitive_artifacts.c.version).where(
                    cognitive_artifacts.c.tenant_id == str(artifact.tenant_id),
                    cognitive_artifacts.c.artifact_id == str(artifact.artifact_id),
                )
            ).fetchone()
            if row is not None:
                artifact = artifact.model_copy(update={"version": int(row.version) + 1})
            conn.execute(
                cognitive_artifacts.delete().where(
                    cognitive_artifacts.c.tenant_id == str(artifact.tenant_id),
                    cognitive_artifacts.c.artifact_id == str(artifact.artifact_id),
                )
            )
            conn.execute(
                cognitive_artifacts.insert().values(
                    tenant_id=str(artifact.tenant_id),
                    artifact_id=str(artifact.artifact_id),
                    artifact_type=artifact.artifact_type.value,
                    semantic_type=artifact.semantic_type,
                    lifecycle_state=artifact.lifecycle_state.value,
                    version=artifact.version,
                    artifact_json=artifact.model_dump_json(),
                    updated_at_utc=artifact.updated_at_utc.isoformat(),
                )
            )
            conn.execute(
                artifact_versions.delete().where(
                    artifact_versions.c.tenant_id == str(artifact.tenant_id),
                    artifact_versions.c.artifact_id == str(artifact.artifact_id),
                    artifact_versions.c.version == artifact.version,
                )
            )
            conn.execute(
                artifact_versions.insert().values(
                    tenant_id=str(artifact.tenant_id),
                    artifact_id=str(artifact.artifact_id),
                    version=artifact.version,
                    artifact_json=artifact.model_dump_json(),
                    created_at_utc=artifact.updated_at_utc.isoformat(),
                )
            )
        return artifact

    def get_artifact(self, tenant_id: UUID, artifact_id: UUID) -> CognitiveArtifact:
        with self._engine.begin() as conn:
            row = conn.execute(
                select(cognitive_artifacts.c.artifact_json).where(
                    cognitive_artifacts.c.tenant_id == str(tenant_id),
                    cognitive_artifacts.c.artifact_id == str(artifact_id),
                )
            ).fetchone()
        if row is None:
            raise KeyError(f"artifact not found: {artifact_id}")
        return CognitiveArtifact.model_validate(json.loads(row.artifact_json))

    def list_artifacts(
        self,
        tenant_id: UUID,
        lifecycle_state: ArtifactLifecycleState | None = None,
    ) -> list[CognitiveArtifact]:
        statement = select(cognitive_artifacts.c.artifact_json).where(
            cognitive_artifacts.c.tenant_id == str(tenant_id)
        )
        if lifecycle_state is not None:
            statement = statement.where(
                cognitive_artifacts.c.lifecycle_state == lifecycle_state.value
            )
        with self._engine.begin() as conn:
            rows = conn.execute(statement).fetchall()
        return [CognitiveArtifact.model_validate(json.loads(row.artifact_json)) for row in rows]

    def save_relationship(self, relationship: ArtifactRelationship) -> ArtifactRelationship:
        with self._engine.begin() as conn:
            conn.execute(
                artifact_relationships.delete().where(
                    artifact_relationships.c.relationship_id == str(relationship.relationship_id)
                )
            )
            conn.execute(
                artifact_relationships.insert().values(
                    tenant_id=str(relationship.tenant_id),
                    relationship_id=str(relationship.relationship_id),
                    source_artifact_id=str(relationship.source_artifact_id),
                    target_artifact_id=str(relationship.target_artifact_id),
                    relationship_type=relationship.relationship_type.value,
                    relationship_json=relationship.model_dump_json(),
                    created_at_utc=relationship.created_at_utc.isoformat(),
                )
            )
        return relationship


class SQLAlchemyContextRepository:
    """Durable runtime context repository."""

    def __init__(self, engine: Engine) -> None:
        self._engine = engine
        metadata.create_all(self._engine)

    def save(self, context: CognitiveContext) -> CognitiveContext:
        with self._engine.begin() as conn:
            conn.execute(
                cognitive_contexts.insert().values(
                    session_id=str(context.session_id),
                    context_id=str(context.context_id),
                    tenant_id=str(context.tenant_id),
                    version=context.version,
                    context_json=context.model_dump_json(),
                    updated_at_utc=context.updated_at_utc.isoformat(),
                )
            )
        return context

    def latest_for_session(self, session_id: UUID) -> CognitiveContext | None:
        with self._engine.begin() as conn:
            row = conn.execute(
                select(cognitive_contexts.c.context_json)
                .where(cognitive_contexts.c.session_id == str(session_id))
                .order_by(cognitive_contexts.c.updated_at_utc.desc(), cognitive_contexts.c.version.desc())
                .limit(1)
            ).fetchone()
        if row is None:
            return None
        return CognitiveContext.model_validate(json.loads(row.context_json))


class SQLAlchemyMemoryRepository:
    """Durable repository for cognitive memory and activation history."""

    def __init__(self, engine: Engine) -> None:
        self._engine = engine
        metadata.create_all(self._engine)

    def save_memory(self, memory: MemoryRecord) -> MemoryRecord:
        with self._engine.begin() as conn:
            conn.execute(
                cognitive_memories.delete().where(
                    cognitive_memories.c.tenant_id == str(memory.tenant_id),
                    cognitive_memories.c.memory_id == str(memory.memory_id),
                )
            )
            conn.execute(
                cognitive_memories.insert().values(
                    tenant_id=str(memory.tenant_id),
                    memory_id=str(memory.memory_id),
                    memory_type=memory.memory_type.value,
                    scope=memory.scope.value,
                    subject=memory.subject,
                    memory_json=memory.model_dump_json(),
                    updated_at_utc=memory.updated_at_utc.isoformat(),
                )
            )
        return memory

    def list_memories(self, tenant_id: UUID) -> list[MemoryRecord]:
        with self._engine.begin() as conn:
            rows = conn.execute(
                select(cognitive_memories.c.memory_json).where(
                    cognitive_memories.c.tenant_id == str(tenant_id)
                )
            ).fetchall()
        return [MemoryRecord.model_validate(json.loads(row.memory_json)) for row in rows]

    def record_activation(self, activation: ActivatedMemory) -> ActivatedMemory:
        memory = self.get_memory(activation.tenant_id, activation.memory_id)
        updated_memory = memory.model_copy(
            update={
                "activation_count": memory.activation_count + 1,
                "last_activated_at_utc": activation.activated_at_utc,
            }
        )
        with self._engine.begin() as conn:
            conn.execute(
                memory_activations.insert().values(
                    activation_id=str(activation.activation_id),
                    tenant_id=str(activation.tenant_id),
                    session_id=str(activation.session_id),
                    memory_id=str(activation.memory_id),
                    activation_json=activation.model_dump_json(),
                    activated_at_utc=activation.activated_at_utc.isoformat(),
                )
            )
        self.save_memory(updated_memory)
        return activation

    def get_memory(self, tenant_id: UUID, memory_id: UUID) -> MemoryRecord:
        with self._engine.begin() as conn:
            row = conn.execute(
                select(cognitive_memories.c.memory_json).where(
                    cognitive_memories.c.tenant_id == str(tenant_id),
                    cognitive_memories.c.memory_id == str(memory_id),
                )
            ).fetchone()
        if row is None:
            raise KeyError(f"memory not found: {memory_id}")
        return MemoryRecord.model_validate(json.loads(row.memory_json))


class SQLAlchemyKnowledgeRepository:
    """Durable semantic knowledge repository."""

    def __init__(self, engine: Engine) -> None:
        self._engine = engine
        metadata.create_all(self._engine)

    def save_knowledge(self, artifact: KnowledgeArtifact) -> KnowledgeArtifact:
        with self._engine.begin() as conn:
            conn.execute(
                semantic_knowledge.delete().where(
                    semantic_knowledge.c.tenant_id == str(artifact.tenant_id),
                    semantic_knowledge.c.knowledge_id == str(artifact.knowledge_id),
                )
            )
            conn.execute(
                semantic_knowledge.insert().values(
                    tenant_id=str(artifact.tenant_id),
                    knowledge_id=str(artifact.knowledge_id),
                    kind=artifact.kind.value,
                    title=artifact.title,
                    knowledge_json=artifact.model_dump_json(),
                    updated_at_utc=artifact.updated_at_utc.isoformat(),
                )
            )
        return artifact

    def list_knowledge(self, tenant_id: UUID) -> list[KnowledgeArtifact]:
        with self._engine.begin() as conn:
            rows = conn.execute(
                select(semantic_knowledge.c.knowledge_json).where(
                    semantic_knowledge.c.tenant_id == str(tenant_id)
                )
            ).fetchall()
        return [KnowledgeArtifact.model_validate(json.loads(row.knowledge_json)) for row in rows]

    def get_knowledge(self, tenant_id: UUID, knowledge_id: UUID) -> KnowledgeArtifact:
        with self._engine.begin() as conn:
            row = conn.execute(
                select(semantic_knowledge.c.knowledge_json).where(
                    semantic_knowledge.c.tenant_id == str(tenant_id),
                    semantic_knowledge.c.knowledge_id == str(knowledge_id),
                )
            ).fetchone()
        if row is None:
            raise KeyError(f"knowledge not found: {knowledge_id}")
        return KnowledgeArtifact.model_validate(json.loads(row.knowledge_json))


class SQLAlchemyWorldModelCheckpointRepository:
    """PostgreSQL-compatible World Model checkpoint repository."""

    def __init__(self, engine: Engine) -> None:
        self._engine = engine
        metadata.create_all(self._engine)

    def write_checkpoint(self, world_model: WorldModel) -> None:
        data = world_model.model_dump_json()
        with self._engine.begin() as conn:
            conn.execute(
                world_model_checkpoints.delete().where(
                    world_model_checkpoints.c.session_id == str(world_model.session_id)
                )
            )
            conn.execute(
                world_model_checkpoints.insert().values(
                    session_id=str(world_model.session_id),
                    tenant_id=str(world_model.tenant_id),
                    version=world_model.version,
                    world_model_json=data,
                    updated_at_utc=world_model.updated_at_utc.isoformat(),
                )
            )

    def get_latest_checkpoint(self, session_id: UUID) -> WorldModel | None:
        with self._engine.begin() as conn:
            row = conn.execute(
                select(world_model_checkpoints.c.world_model_json).where(
                    world_model_checkpoints.c.session_id == str(session_id)
                )
            ).fetchone()
        if row is None:
            return None
        return WorldModel.model_validate(json.loads(row.world_model_json))


runtime_world_models = Table(
    "runtime_world_models", metadata,
    Column("session_id", String(36), primary_key=True),
    Column("tenant_id", String(36), nullable=False, index=True),
    Column("version", Integer, nullable=False),
    Column("world_model_json", SecureText, nullable=False),
)


class SQLAlchemyWorldModelRepository:
    """Durable World Model with optimistic concurrency checking."""
    def __init__(self, engine: Engine) -> None:
        self._engine = engine
        metadata.create_all(engine)

    def create(self, session: BrainSession) -> WorldModel:
        world = WorldModel(session_id=session.session_id, tenant_id=session.tenant_id)
        with self._engine.begin() as conn:
            conn.execute(runtime_world_models.insert().values(
                session_id=str(session.session_id), tenant_id=str(session.tenant_id),
                version=world.version, world_model_json=world.model_dump_json()))
        return world

    def get(self, session_id: UUID) -> WorldModel:
        with self._engine.connect() as conn:
            raw = conn.execute(select(runtime_world_models.c.world_model_json).where(
                runtime_world_models.c.session_id == str(session_id))).scalar_one_or_none()
        if raw is None:
            raise KeyError("World Model not found")
        return WorldModel.model_validate_json(raw)

    def apply_mutations(self, session_id: UUID, mutations: list[WorldModelMutation]) -> WorldModel:
        for _ in range(8):
            current = self.get(session_id)
            next_model = apply_world_model_mutations(current, mutations)
            if not mutations:
                return next_model
            with self._engine.begin() as conn:
                result = conn.execute(update(runtime_world_models).where(
                    runtime_world_models.c.session_id == str(session_id),
                    runtime_world_models.c.version == current.version,
                ).values(version=next_model.version, world_model_json=next_model.model_dump_json()))
                saved = result.rowcount == 1
            if saved:
                from clozflow_brain.infrastructure.pubsub import get_in_memory_pubsub
                get_in_memory_pubsub().publish(f"clozflow:wm:updates:{session_id}", "updated")
                return next_model
        raise RuntimeError("Concurrent World Model updates exceeded retry limit")
