"""Kernel bus interfaces and in-memory implementation."""

from __future__ import annotations

from collections import deque
from threading import RLock
from typing import Protocol

from clozflow_brain.contracts.events import CognitiveEvent, EventType


class EventBus(Protocol):
    def publish(self, event: CognitiveEvent) -> None:
        """Publish an immutable cognitive event."""
        ...

    def list_events(self, event_type: EventType | None = None) -> list[CognitiveEvent]:
        """Return published events for diagnostics and tests."""
        ...


class InMemoryEventBus:
    """Local development Event Bus preserving event immutability and ordering."""

    def __init__(self) -> None:
        self._events: deque[CognitiveEvent] = deque(maxlen=10000)
        self._lock = RLock()

    def publish(self, event: CognitiveEvent) -> None:
        with self._lock:
            self._events.append(event)

    def list_events(self, event_type: EventType | None = None) -> list[CognitiveEvent]:
        with self._lock:
            if event_type is None:
                return list(self._events)
            return [event for event in self._events if event.event_type == event_type]

    def purge(self, tenant_id, session_ids=None):
        with self._lock:
            self._events = deque((event for event in self._events if event.tenant_id != tenant_id or
                                 (session_ids is not None and str(event.session_id) not in session_ids)), maxlen=10000)

