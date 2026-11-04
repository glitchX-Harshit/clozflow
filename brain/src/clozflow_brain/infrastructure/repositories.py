"""Repository interfaces and in-memory adapters."""

from __future__ import annotations

from threading import RLock
from typing import Protocol
from uuid import UUID

from clozflow_brain.contracts.sessions import BrainSession, SessionStatus
from clozflow_brain.contracts.world_model import (
    WorldModel,
    WorldModelMutation,
)
from clozflow_brain.infrastructure.world_model_mutations import apply_world_model_mutations


class SessionRepository(Protocol):
    def list_for_tenant(self, tenant_id: UUID) -> list[BrainSession]:
        ...
    def save(self, session: BrainSession) -> BrainSession:
        """Persist a Brain Session."""
        ...

    def get(self, session_id: UUID) -> BrainSession:
        """Return a Brain Session."""
        ...

    def list_active(self, tenant_id: UUID) -> list[BrainSession]:
        """Return active sessions for a tenant."""
        ...

    def list_all_active(self) -> list[BrainSession]:
        """Return all active sessions across all tenants."""
        ...


class WorldModelRepository(Protocol):
    def create(self, session: BrainSession) -> WorldModel:
        """Initialize a World Model for a Brain Session."""
        ...

    def get(self, session_id: UUID) -> WorldModel:
        """Return the latest World Model snapshot."""
        ...

    def apply_mutations(self, session_id: UUID, mutations: list[WorldModelMutation]) -> WorldModel:
        """Apply engine-returned mutations atomically."""
        ...


class InMemorySessionRepository:
    def __init__(self) -> None:
        self._sessions: dict[UUID, BrainSession] = {}
        self._lock = RLock()

    def save(self, session: BrainSession) -> BrainSession:
        with self._lock:
            self._sessions[session.session_id] = session
            return session

    def get(self, session_id: UUID) -> BrainSession:
        with self._lock:
            try:
                return self._sessions[session_id]
            except KeyError as exc:
                raise KeyError(f"session not found: {session_id}") from exc

    def list_active(self, tenant_id: UUID) -> list[BrainSession]:
        with self._lock:
            return [
                session
                for session in self._sessions.values()
                if session.tenant_id == tenant_id and session.status == SessionStatus.ACTIVE
            ]

    def list_all_active(self) -> list[BrainSession]:
        with self._lock:
            return [
                session
                for session in self._sessions.values()
                if session.status == SessionStatus.ACTIVE
            ]

    def list_for_tenant(self, tenant_id: UUID) -> list[BrainSession]:
        with self._lock:
            return [session for session in self._sessions.values() if session.tenant_id == tenant_id]


class InMemoryWorldModelRepository:
    def __init__(self) -> None:
        self._world_models: dict[UUID, WorldModel] = {}
        self._lock = RLock()

    def create(self, session: BrainSession) -> WorldModel:
        world_model = WorldModel(session_id=session.session_id, tenant_id=session.tenant_id)
        with self._lock:
            self._world_models[session.session_id] = world_model
        return world_model

    def get(self, session_id: UUID) -> WorldModel:
        with self._lock:
            try:
                return self._world_models[session_id].model_copy(deep=True)
            except KeyError as exc:
                raise KeyError(f"world model not found for session: {session_id}") from exc

    def apply_mutations(self, session_id: UUID, mutations: list[WorldModelMutation]) -> WorldModel:
        with self._lock:
            current = self.get(session_id)
            next_model = apply_world_model_mutations(current, mutations)
            self._world_models[session_id] = next_model
            # Publish update event
            try:
                from clozflow_brain.infrastructure.pubsub import get_in_memory_pubsub
                get_in_memory_pubsub().publish(f"clozflow:wm:updates:{session_id}", "updated")
            except Exception:
                pass
            return next_model.model_copy(deep=True)


class WorldModelCheckpointRepository(Protocol):
    def write_checkpoint(self, world_model: WorldModel) -> None:
        """Write a World Model snapshot to checkpoint storage."""
        ...

    def get_latest_checkpoint(self, session_id: UUID) -> WorldModel | None:
        """Get the latest checkpoint for a session."""
        ...


class InMemoryWorldModelCheckpointRepository:
    def __init__(self) -> None:
        self._checkpoints: dict[UUID, WorldModel] = {}
        self._lock = RLock()

    def write_checkpoint(self, world_model: WorldModel) -> None:
        with self._lock:
            self._checkpoints[world_model.session_id] = world_model.model_copy(deep=True)

    def get_latest_checkpoint(self, session_id: UUID) -> WorldModel | None:
        with self._lock:
            if session_id not in self._checkpoints:
                return None
            return self._checkpoints[session_id].model_copy(deep=True)
