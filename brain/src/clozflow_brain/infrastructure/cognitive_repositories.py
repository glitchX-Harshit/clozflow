"""Repositories for context, memory, knowledge, and canonical artifacts."""

from __future__ import annotations

from collections import defaultdict
from threading import RLock
from typing import Protocol
from uuid import UUID

from clozflow_brain.contracts.common import utc_now
from clozflow_brain.contracts.context import CognitiveContext
from clozflow_brain.contracts.knowledge import KnowledgeArtifact
from clozflow_brain.contracts.memory import ActivatedMemory, MemoryRecord
from clozflow_brain.contracts.persistence import (
    ArtifactLifecycleState,
    ArtifactRelationship,
    CognitiveArtifact,
)


class PersistenceRepository(Protocol):
    def save_artifact(self, artifact: CognitiveArtifact) -> CognitiveArtifact:
        """Persist or version a canonical cognitive artifact."""
        ...

    def get_artifact(self, tenant_id: UUID, artifact_id: UUID) -> CognitiveArtifact:
        """Return the current artifact version."""
        ...

    def list_artifacts(
        self,
        tenant_id: UUID,
        lifecycle_state: ArtifactLifecycleState | None = None,
    ) -> list[CognitiveArtifact]:
        """List artifacts for a tenant."""
        ...

    def save_relationship(self, relationship: ArtifactRelationship) -> ArtifactRelationship:
        """Persist an explicit artifact relationship."""
        ...


class ContextRepository(Protocol):
    def save(self, context: CognitiveContext) -> CognitiveContext:
        """Persist the current runtime context."""
        ...

    def latest_for_session(self, session_id: UUID) -> CognitiveContext | None:
        """Return latest context for a session."""
        ...


class MemoryRepository(Protocol):
    def save_memory(self, memory: MemoryRecord) -> MemoryRecord:
        """Persist a memory record."""
        ...

    def list_memories(self, tenant_id: UUID) -> list[MemoryRecord]:
        """List memories visible to a tenant."""
        ...

    def record_activation(self, activation: ActivatedMemory) -> ActivatedMemory:
        """Record a memory activation."""
        ...

    def get_memory(self, tenant_id: UUID, memory_id: UUID) -> MemoryRecord:
        """Return a memory record."""
        ...


class KnowledgeRepository(Protocol):
    def save_knowledge(self, artifact: KnowledgeArtifact) -> KnowledgeArtifact:
        """Persist a knowledge artifact."""
        ...

    def list_knowledge(self, tenant_id: UUID) -> list[KnowledgeArtifact]:
        """List knowledge artifacts visible to a tenant."""
        ...

    def get_knowledge(self, tenant_id: UUID, knowledge_id: UUID) -> KnowledgeArtifact:
        """Return a knowledge artifact."""
        ...


class InMemoryPersistenceRepository:
    def __init__(self) -> None:
        self._artifacts: dict[tuple[UUID, UUID], CognitiveArtifact] = {}
        self._relationships: list[ArtifactRelationship] = []
        self._lock = RLock()

    def save_artifact(self, artifact: CognitiveArtifact) -> CognitiveArtifact:
        with self._lock:
            existing = self._artifacts.get((artifact.tenant_id, artifact.artifact_id))
            if existing is not None:
                artifact = artifact.model_copy(
                    update={"version": existing.version + 1, "updated_at_utc": utc_now()}
                )
            self._artifacts[(artifact.tenant_id, artifact.artifact_id)] = artifact
            return artifact

    def get_artifact(self, tenant_id: UUID, artifact_id: UUID) -> CognitiveArtifact:
        with self._lock:
            try:
                return self._artifacts[(tenant_id, artifact_id)]
            except KeyError as exc:
                raise KeyError(f"artifact not found: {artifact_id}") from exc

    def list_artifacts(
        self,
        tenant_id: UUID,
        lifecycle_state: ArtifactLifecycleState | None = None,
    ) -> list[CognitiveArtifact]:
        with self._lock:
            artifacts = [
                artifact for (artifact_tenant, _), artifact in self._artifacts.items()
                if artifact_tenant == tenant_id
            ]
            if lifecycle_state is not None:
                artifacts = [a for a in artifacts if a.lifecycle_state == lifecycle_state]
            return list(artifacts)

    def save_relationship(self, relationship: ArtifactRelationship) -> ArtifactRelationship:
        with self._lock:
            self._relationships.append(relationship)
            return relationship


class InMemoryContextRepository:
    def __init__(self) -> None:
        self._contexts_by_session: dict[UUID, list[CognitiveContext]] = defaultdict(list)
        self._lock = RLock()

    def save(self, context: CognitiveContext) -> CognitiveContext:
        with self._lock:
            latest = self.latest_for_session(context.session_id)
            if latest is not None and latest.context_id != context.context_id:
                context = context.model_copy(update={"version": latest.version + 1})
            self._contexts_by_session[context.session_id].append(context)
            self._contexts_by_session[context.session_id] = self._contexts_by_session[context.session_id][-100:]
            return context

    def latest_for_session(self, session_id: UUID) -> CognitiveContext | None:
        with self._lock:
            contexts = self._contexts_by_session.get(session_id, [])
            return contexts[-1] if contexts else None


class InMemoryMemoryRepository:
    def __init__(self) -> None:
        self._memories: dict[tuple[UUID, UUID], MemoryRecord] = {}
        self._activations: list[ActivatedMemory] = []
        self._lock = RLock()

    def save_memory(self, memory: MemoryRecord) -> MemoryRecord:
        with self._lock:
            self._memories[(memory.tenant_id, memory.memory_id)] = memory
            return memory

    def list_memories(self, tenant_id: UUID) -> list[MemoryRecord]:
        with self._lock:
            return [
                memory for (memory_tenant, _), memory in self._memories.items()
                if memory_tenant == tenant_id
            ]

    def list_memories_for_session(self, tenant_id: UUID, session_id: UUID) -> list[MemoryRecord]:
        """Return memories whose content includes the given session_id."""
        with self._lock:
            return [
                memory for (memory_tenant, _), memory in self._memories.items()
                if memory_tenant == tenant_id
                and str(session_id) in str(memory.content)
            ]

    def record_activation(self, activation: ActivatedMemory) -> ActivatedMemory:
        with self._lock:
            self._activations.append(activation)
            self._activations = self._activations[-10000:]
            memory = self.get_memory(activation.tenant_id, activation.memory_id)
            self._memories[(memory.tenant_id, memory.memory_id)] = memory.model_copy(
                update={
                    "activation_count": memory.activation_count + 1,
                    "last_activated_at_utc": activation.activated_at_utc,
                    "updated_at_utc": utc_now(),
                }
            )
            return activation

    def get_memory(self, tenant_id: UUID, memory_id: UUID) -> MemoryRecord:
        with self._lock:
            try:
                return self._memories[(tenant_id, memory_id)]
            except KeyError as exc:
                raise KeyError(f"memory not found: {memory_id}") from exc


class InMemoryKnowledgeRepository:
    def __init__(self) -> None:
        self._knowledge: dict[tuple[UUID, UUID], KnowledgeArtifact] = {}
        self._lock = RLock()

    def save_knowledge(self, artifact: KnowledgeArtifact) -> KnowledgeArtifact:
        with self._lock:
            self._knowledge[(artifact.tenant_id, artifact.knowledge_id)] = artifact
            return artifact

    def list_knowledge(self, tenant_id: UUID) -> list[KnowledgeArtifact]:
        with self._lock:
            return [
                artifact for (artifact_tenant, _), artifact in self._knowledge.items()
                if artifact_tenant == tenant_id
            ]

    def get_knowledge(self, tenant_id: UUID, knowledge_id: UUID) -> KnowledgeArtifact:
        with self._lock:
            try:
                return self._knowledge[(tenant_id, knowledge_id)]
            except KeyError as exc:
                raise KeyError(f"knowledge not found: {knowledge_id}") from exc

