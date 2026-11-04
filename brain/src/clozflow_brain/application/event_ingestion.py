"""Event ingestion use cases."""

from __future__ import annotations

from clozflow_brain.contracts.events import CognitiveEvent
from clozflow_brain.kernel.kernel import CognitiveCycleResult, CognitiveKernel


class EventIngestionService:
    def __init__(self, kernel: CognitiveKernel) -> None:
        self._kernel = kernel

    def ingest(self, event: CognitiveEvent) -> CognitiveCycleResult:
        result = self._kernel.accept_event(event, execute=True)
        if result is None:
            raise RuntimeError("kernel returned no cycle result for executable event")
        return result

    def ingest_batch(self, events: list[CognitiveEvent]) -> CognitiveCycleResult:
        if not events:
            raise ValueError("Empty event batch")
        session_id, tenant_id = events[0].session_id, events[0].tenant_id
        for event in events:
            if (event.session_id, event.tenant_id) != (session_id, tenant_id):
                raise ValueError("Batch must belong to one tenant and session")
            session = self._kernel.session_repository.get(event.session_id)
            if session.tenant_id != tenant_id:
                raise PermissionError("Tenant mismatch")
            if session.status.value != "ACTIVE":
                raise ValueError("Session is not active")
            self._kernel.validate_event(event)
        if self._kernel.runtime:
            self._kernel.runtime.store.accept(events)
        for event in events:
            self._kernel.accept_event(event, execute=False)
        return self._kernel.execute_cycle(events)

