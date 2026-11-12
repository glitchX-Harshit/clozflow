"""Per-call fan-out of copilot events to the app's WebSocket(s), with replay.

``publish`` never blocks the audio pipeline: every app socket has its own bounded
queue and sender task. A socket that falls too far behind is closed (1013); the
app reconnects and gets the replay (current ``callStatus``, the last 200 transcript
lines, the latest ``aiAnalysis``, and the latest ``coach`` card, ``deal_record``,
``deal_health``, ``metrics`` and ``strip`` of the Meeting Wizard protocol).
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections import deque
from typing import Deque, Dict, Optional

log = logging.getLogger("clozflow.bridge")

REPLAY_TRANSCRIPT_LINES = 200
SUBSCRIBER_QUEUE_MAX = 1000
MAX_SUBSCRIBERS_PER_CALL = 4
# Message types whose latest instance is replayed to a (re)connecting app, in this order.
REPLAY_LATEST_TYPES = ("coach", "deal_record", "deal_health", "metrics", "strip")
_CLOSE = object()


class _Subscriber:
    def __init__(self, websocket, hub: "EventHub"):
        self.websocket = websocket
        self.hub = hub
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_MAX)
        self.closed = asyncio.Event()
        self.task: Optional[asyncio.Task] = None
        self._close_code = 1000

    def offer(self, message) -> None:
        if self.closed.is_set():
            return
        try:
            self.queue.put_nowait(message)
        except asyncio.QueueFull:
            self.request_close(1013)

    def request_close(self, code: int = 1000) -> None:
        """Send whatever is queued, then close with ``code``."""
        self._close_code = code
        while True:
            try:
                self.queue.put_nowait(_CLOSE)
                return
            except asyncio.QueueFull:
                try:  # make room for the close marker: drop the oldest message
                    self.queue.get_nowait()
                except asyncio.QueueEmpty:  # pragma: no cover - racing consumer
                    return

    async def run(self) -> None:
        try:
            while True:
                message = await self.queue.get()
                if message is _CLOSE:
                    break
                await self.websocket.send_text(json.dumps(message, default=str))
        except Exception:  # the socket went away; the app will reconnect
            pass
        finally:
            self.closed.set()
            self.hub._subscribers.pop(self, None)
            try:
                await self.websocket.close(code=self._close_code)
            except Exception:
                pass


class EventHub:
    def __init__(self):
        self._transcript: Deque[dict] = deque(maxlen=REPLAY_TRANSCRIPT_LINES)
        self._latest_analysis: Optional[dict] = None
        self._latest: Dict[str, dict] = {}
        self._subscribers: Dict[_Subscriber, None] = {}   # insertion ordered: oldest first
        self.closed = False

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def publish(self, message: dict) -> None:
        kind = message.get("type")
        if kind == "transcriptUpdate":
            self._transcript.append(message)
        elif kind == "aiAnalysis":
            self._latest_analysis = message
        elif kind in REPLAY_LATEST_TYPES:
            self._latest[kind] = message
        for subscriber in list(self._subscribers):
            subscriber.offer(message)

    def subscribe(self, websocket, call_status: dict) -> _Subscriber:
        """Registers ``websocket`` and queues the replay, atomically with respect to
        ``publish`` (no await in between, so nothing is lost or sent twice)."""
        while len(self._subscribers) >= MAX_SUBSCRIBERS_PER_CALL:
            oldest = next(iter(self._subscribers))
            self._subscribers.pop(oldest, None)
            oldest.request_close(1000)
        subscriber = _Subscriber(websocket, self)
        subscriber.offer(call_status)
        for line in self._transcript:
            subscriber.offer(line)
        if self._latest_analysis is not None:
            subscriber.offer(self._latest_analysis)
        for kind in REPLAY_LATEST_TYPES:
            latest = self._latest.get(kind)
            if latest is not None:
                subscriber.offer(latest)
        if self.closed:
            subscriber.request_close(1000)
        else:
            self._subscribers[subscriber] = None
        subscriber.task = asyncio.create_task(subscriber.run())
        return subscriber

    def close_all(self, code: int = 1000) -> None:
        """No more events: flush every socket, then close it."""
        self.closed = True
        for subscriber in list(self._subscribers):
            subscriber.request_close(code)
