"""Brain Session use cases."""

from __future__ import annotations

from typing import Any
from functools import wraps
from threading import RLock
from uuid import UUID, uuid4

from clozflow_brain.contracts.common import utc_now
from clozflow_brain.contracts.events import CognitiveEvent, EventType
from clozflow_brain.contracts.sessions import BrainSession, SessionStatus
from clozflow_brain.infrastructure.repositories import SessionRepository, WorldModelRepository
from clozflow_brain.kernel.kernel import CognitiveKernel
from clozflow_brain.kernel.observability import Telemetry, TelemetrySignal
from clozflow_brain.kernel.security import assert_same_tenant


def serialized(method):
    @wraps(method)
    def call(self, **kwargs):
        sid = kwargs.get('session_id') or uuid4()
        if method.__name__ == 'create_session':
            kwargs['session_id'] = sid
        lock = self._kernel._cycle_locks[sid.int % len(self._kernel._cycle_locks)] if self._kernel else self._lock
        with lock:
            return method(self, **kwargs)
    return call


class SessionService:
    def __init__(
        self,
        *,
        sessions: SessionRepository,
        world_models: WorldModelRepository,
        telemetry: Telemetry,
        kernel: CognitiveKernel | None = None,
    ) -> None:
        self._sessions = sessions
        self._world_models = world_models
        self._telemetry = telemetry
        self._kernel = kernel
        self._lock = RLock()

    def attach_kernel(self, kernel: CognitiveKernel) -> None:
        self._kernel = kernel

    @serialized
    def create_session(
        self,
        *,
        tenant_id: UUID,
        salesperson_id: str,
        crm_opportunity_id: str | None = None,
        metadata: dict[str, Any] | None = None,
        session_id: UUID | None = None,
    ) -> BrainSession:
        if session_id is not None:
            try:
                existing = self._sessions.get(session_id)
            except KeyError:
                existing = None
            if existing:
                assert_same_tenant(tenant_id, existing.tenant_id)
                if existing.salesperson_id != salesperson_id or existing.status == SessionStatus.TERMINATED:
                    raise ValueError("Session is closed or belongs to a different salesperson")
                return existing
        session = BrainSession(
            session_id=session_id or uuid4(),
            tenant_id=tenant_id,
            salesperson_id=salesperson_id,
            crm_opportunity_id=crm_opportunity_id,
            status=SessionStatus.ACTIVE,
            metadata=metadata or {},
        )
        self._sessions.save(session)
        self._world_models.create(session)
        self._telemetry.observe(
            TelemetrySignal.BRAIN_ACTIVE_SESSIONS,
            len(self._sessions.list_active(tenant_id)),
            {"tenant_id": str(tenant_id), "environment": "local"},
        )
        if self._kernel is not None:
            start_event = CognitiveEvent.create(
                event_type=EventType.SESSION_START,
                session_id=session.session_id,
                tenant_id=session.tenant_id,
                sequence_num=0,
                source="session-service",
                confidence=1.0,
                payload={
                    "salesperson_id": session.salesperson_id,
                    "crm_opportunity_id": session.crm_opportunity_id,
                    "status": session.status.value,
                    "metadata": session.metadata,
                },
            )
            self._kernel.accept_event(start_event, execute=True)
        return session

    def get_session(self, *, tenant_id: UUID, session_id: UUID) -> BrainSession:
        session = self._sessions.get(session_id)
        assert_same_tenant(tenant_id, session.tenant_id)
        return session

    @serialized
    def update_session(
        self,
        *,
        tenant_id: UUID,
        session_id: UUID,
        status: SessionStatus | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> BrainSession:
        session = self.get_session(tenant_id=tenant_id, session_id=session_id)
        if status == SessionStatus.TERMINATED:
            return self.terminate_session(tenant_id=tenant_id, session_id=session_id)
        allowed = {
            SessionStatus.ACTIVE: {SessionStatus.SUSPENDED},
            SessionStatus.SUSPENDED: {SessionStatus.ACTIVE},
        }
        if status is not None and status != session.status and status not in allowed.get(session.status, set()):
            raise ValueError("Invalid session lifecycle transition")
        updates: dict[str, Any] = {"updated_at_utc": utc_now()}
        if status is not None:
            updates["status"] = status
        if metadata is not None:
            updates["metadata"] = {**session.metadata, **metadata}
        updated = session.model_copy(update=updates)
        return self._sessions.save(updated)

    @serialized
    def terminate_session(self, *, tenant_id: UUID, session_id: UUID) -> BrainSession:
        session = self.get_session(tenant_id=tenant_id, session_id=session_id)
        if session.status == SessionStatus.TERMINATED:
            return session
        terminated = session.model_copy(
            update={"status": SessionStatus.TERMINATED, "updated_at_utc": utc_now()}
        )
        self._telemetry.observe(
            TelemetrySignal.BRAIN_ACTIVE_SESSIONS,
            len(self._sessions.list_active(tenant_id)),
            {"tenant_id": str(tenant_id), "environment": "local"},
        )
        if self._kernel is not None:
            end_event = CognitiveEvent.create(
                event_type=EventType.SESSION_END,
                session_id=session_id,
                tenant_id=tenant_id,
                sequence_num=0,
                source="session-service",
                confidence=1.0,
                payload={"status": terminated.status.value},
            )
            result = self._kernel.accept_event(end_event, execute=True)
            assert result is not None
            failed = any(output.status.value in {'ERROR', 'TIMEOUT'} for output in result.engine_outputs)
            terminated = terminated.model_copy(update={'metadata': {**terminated.metadata, 'reflection_status': 'failed' if failed else 'complete'}})
        self._sessions.save(terminated)
        return terminated

    @serialized
    def retry_reflection(self, *, tenant_id: UUID, session_id: UUID) -> BrainSession:
        session = self.get_session(tenant_id=tenant_id, session_id=session_id)
        if session.status != SessionStatus.TERMINATED or not self._kernel:
            raise ValueError('End the session before retrying reflection')
        if session.metadata.get('reflection_status') == 'complete':
            return session
        event = CognitiveEvent.create(event_type=EventType.SESSION_END, tenant_id=tenant_id,
            session_id=session_id, source='session-reflection-retry', sequence_num=0, confidence=1, payload={})
        result = self._kernel.accept_event(event)
        assert result is not None
        failed = any(output.status.value in {'ERROR', 'TIMEOUT'} for output in result.engine_outputs)
        return self._sessions.save(session.model_copy(update={'metadata': {**session.metadata,
            'reflection_status': 'failed' if failed else 'complete'}, 'updated_at_utc': utc_now()}))
