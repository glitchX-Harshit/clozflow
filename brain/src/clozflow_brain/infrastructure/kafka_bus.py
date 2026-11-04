"""Kafka-backed Cognitive Event Bus adapter."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from threading import RLock
from threading import Event, Thread
from typing import Any, Callable

from clozflow_brain.contracts.events import CognitiveEvent, EventType


ProducerFactory = Callable[[], Any]


class KafkaEventBus:
    """Publishes canonical Cognitive Events to Kafka with local audit visibility."""

    def __init__(
        self,
        *,
        bootstrap_servers: str,
        topic: str = "cognitive.events",
        producer_factory: ProducerFactory | None = None,
        publish_timeout_seconds: float = 5.0,
    ) -> None:
        self._bootstrap_servers = bootstrap_servers
        self._topic = topic
        self._producer_factory = producer_factory or self._default_producer_factory
        self._publish_timeout_seconds = publish_timeout_seconds
        self._events: list[CognitiveEvent] = []
        self._by_type: dict[EventType, list[CognitiveEvent]] = defaultdict(list)
        self._lock = RLock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: Thread | None = None
        self._producer: Any | None = None
        self._ready = Event()
        self._start_error: BaseException | None = None

    def publish(self, event: CognitiveEvent) -> None:
        self._ensure_started()
        if self._loop is None:
            raise RuntimeError("Kafka event loop failed to start")
        future = asyncio.run_coroutine_threadsafe(self.publish_async(event), self._loop)
        future.result(timeout=self._publish_timeout_seconds)
        with self._lock:
            self._events.append(event)
            self._by_type[event.event_type].append(event)

    async def publish_async(self, event: CognitiveEvent) -> None:
        if self._producer is None:
            raise RuntimeError("Kafka producer is not started")
        await self._producer.send_and_wait(
            self._topic,
            event.model_dump_json().encode("utf-8"),
            key=f"{event.tenant_id}:{event.session_id}".encode("utf-8"),
            headers=[
                ("event_type", event.event_type.value.encode("utf-8")),
                ("event_id", str(event.event_id).encode("utf-8")),
            ],
        )

    def list_events(self, event_type: EventType | None = None) -> list[CognitiveEvent]:
        with self._lock:
            if event_type is None:
                return list(self._events)
            return list(self._by_type[event_type])

    def _default_producer_factory(self) -> Any:
        from aiokafka import AIOKafkaProducer

        return AIOKafkaProducer(
            bootstrap_servers=self._bootstrap_servers,
            enable_idempotence=True,
        )

    def close(self) -> None:
        if self._loop is None or self._thread is None:
            return
        if self._producer is not None:
            future = asyncio.run_coroutine_threadsafe(self._producer.stop(), self._loop)
            future.result(timeout=self._publish_timeout_seconds)
            self._producer = None
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._thread.join(timeout=self._publish_timeout_seconds)
        self._loop = None
        self._thread = None
        self._ready.clear()

    def _ensure_started(self) -> None:
        if self._thread is not None:
            if self._start_error is not None:
                raise RuntimeError("Kafka event bus failed to start") from self._start_error
            return
        self._ready.clear()
        self._loop = asyncio.new_event_loop()
        self._thread = Thread(target=self._run_loop, name="clozflow-kafka-event-bus", daemon=True)
        self._thread.start()
        if not self._ready.wait(timeout=self._publish_timeout_seconds):
            raise TimeoutError("Kafka event bus startup timed out")
        if self._start_error is not None:
            raise RuntimeError("Kafka event bus failed to start") from self._start_error

    def _run_loop(self) -> None:
        if self._loop is None:
            self._start_error = RuntimeError("Kafka event loop was not initialized")
            self._ready.set()
            return
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._start_producer())
        except BaseException as exc:  # noqa: BLE001 - start errors must reach caller.
            self._start_error = exc
            self._ready.set()
            self._loop.close()
            return
        self._ready.set()
        self._loop.run_forever()
        self._loop.close()

    async def _start_producer(self) -> None:
        producer = self._producer_factory()
        await producer.start()
        self._producer = producer
