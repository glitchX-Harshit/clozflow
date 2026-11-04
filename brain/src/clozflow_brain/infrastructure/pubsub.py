"""Real-time update pub/sub mechanisms."""

from __future__ import annotations

import asyncio
from threading import RLock
from typing import AsyncGenerator


class InMemoryPubSub:
    """In-memory pub/sub for local development and unit tests."""

    def __init__(self) -> None:
        self._lock = RLock()
        self._listeners: dict[str, set[tuple[asyncio.Queue[str], asyncio.AbstractEventLoop]]] = {}

    def publish(self, channel: str, message: str) -> None:
        with self._lock:
            listeners = list(self._listeners.get(channel, set()))
        if listeners:
            for queue, loop in listeners:
                try:
                    loop.call_soon_threadsafe(self._offer, queue, message)
                except Exception:
                    pass

    @staticmethod
    def _offer(queue: asyncio.Queue[str], message: str) -> None:
        if queue.full():
            queue.get_nowait()
        queue.put_nowait(message)

    async def subscribe(self, channel: str) -> AsyncGenerator[str, None]:
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=100)
        loop = asyncio.get_running_loop()
        listener = (queue, loop)
        with self._lock:
            self._listeners.setdefault(channel, set()).add(listener)
        try:
            while True:
                yield await queue.get()
        finally:
            if channel in self._listeners and listener in self._listeners[channel]:
                self._listeners[channel].remove(listener)
            if channel in self._listeners and not self._listeners[channel]:
                del self._listeners[channel]


_in_memory_pubsub = InMemoryPubSub()


def get_in_memory_pubsub() -> InMemoryPubSub:
    return _in_memory_pubsub


class RedisPubSub:
    """Redis-backed pub/sub for production environments."""

    def __init__(self, redis_url: str) -> None:
        self._redis_url = redis_url

    async def subscribe(self, channel: str) -> AsyncGenerator[str, None]:
        import redis.asyncio as aioredis

        client = aioredis.from_url(self._redis_url)
        pubsub = client.pubsub()
        await pubsub.subscribe(channel)
        try:
            while True:
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message and message.get("type") == "message":
                    data = message.get("data")
                    if isinstance(data, bytes):
                        yield data.decode("utf-8")
                    elif isinstance(data, str):
                        yield data
                await asyncio.sleep(0.01)
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
            await client.close()
