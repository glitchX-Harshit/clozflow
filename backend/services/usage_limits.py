"""
In-process request limiting for the Lead Finder, Outreach, Lead Intelligence,
Knowledge and Relay routers.

* ``WindowRateLimiter`` — fixed-window request counter. Keys are
  ``"user:<id>"`` on authenticated routes and ``"ip:<addr>"`` (or a slug) on
  the public Relay buyer routes.
* ``StreamSlots`` — caps how many long-running streams (deep search) one key
  may hold at once. Slots expire after ``max_age_seconds`` so a stream that
  never started (client vanished before the first byte) cannot pin a slot.

State lives in this process only (the backend runs a single uvicorn worker).
Exceeding a limit raises ``HTTPException(429)`` with a ``Retry-After`` header.
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Dict, Optional, Tuple

from fastapi import HTTPException, Request, status


def client_ip(request: Request) -> str:
    """Best-effort client address.

    uvicorn rewrites ``request.client`` from ``X-Forwarded-For`` only for
    trusted proxies (``--forwarded-allow-ips``, default 127.0.0.1, which is
    where nginx connects from), so this is not spoofable by clients.
    """
    return request.client.host if request.client and request.client.host else "unknown"


def user_key(user) -> str:
    return f"user:{getattr(user, 'id', 'anonymous')}"


class WindowRateLimiter:
    """Fixed-window limiter: at most ``limit`` hits per ``window_seconds`` per key."""

    def __init__(self, name: str, limit: int, window_seconds: float, detail: str, max_keys: int = 20000):
        self.name = name
        self.limit = int(limit)
        self.window = float(window_seconds)
        self.detail = detail
        self.max_keys = max_keys
        self._hits: Dict[str, Tuple[float, int]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            start, count = self._hits.get(key, (now, 0))
            if now - start >= self.window:
                start, count = now, 0
            if count >= self.limit:
                retry_after = max(1, int(self.window - (now - start)) + 1)
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=self.detail,
                    headers={"Retry-After": str(retry_after)},
                )
            self._hits[key] = (start, count + 1)
            if len(self._hits) > self.max_keys:
                self._prune(now)

    def _prune(self, now: float) -> None:
        # Drop expired windows first; never wipe live counters wholesale (that
        # would let anyone reset every limit by spraying new keys).
        for k in [k for k, (s, _) in self._hits.items() if now - s >= self.window]:
            del self._hits[k]
        overflow = len(self._hits) - self.max_keys
        if overflow > 0:
            for k, _ in sorted(self._hits.items(), key=lambda kv: kv[1][0])[:overflow]:
                del self._hits[k]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


class StreamSlots:
    """Per-key cap on concurrently running streams."""

    def __init__(self, limit: int, detail: str, max_age_seconds: float = 900.0):
        self.limit = int(limit)
        self.detail = detail
        self.max_age = float(max_age_seconds)
        self._slots: Dict[str, Dict[str, float]] = {}
        self._lock = threading.Lock()

    def acquire(self, key: str) -> str:
        now = time.monotonic()
        with self._lock:
            slots = self._slots.setdefault(key, {})
            for token in [t for t, started in slots.items() if now - started >= self.max_age]:
                del slots[token]
            if len(slots) >= self.limit:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=self.detail,
                    headers={"Retry-After": "30"},
                )
            token = uuid.uuid4().hex
            slots[token] = now
            return token

    def release(self, key: str, token: Optional[str]) -> None:
        if not token:
            return
        with self._lock:
            slots = self._slots.get(key)
            if slots is not None:
                slots.pop(token, None)
                if not slots:
                    self._slots.pop(key, None)

    def active(self, key: str) -> int:
        with self._lock:
            return len(self._slots.get(key, {}))

    def reset(self) -> None:
        with self._lock:
            self._slots.clear()
