"""Redis JSON World Model adapter."""

from __future__ import annotations

import json
from threading import RLock
from typing import Any
from uuid import UUID

from clozflow_brain.contracts.sessions import BrainSession
from clozflow_brain.contracts.world_model import WorldModel, WorldModelMutation
from clozflow_brain.infrastructure.world_model_mutations import apply_world_model_mutations


class RedisWorldModelRepository:
    """World Model repository backed by Redis JSON.

    The adapter accepts a redis-py client. If RedisJSON is unavailable, it falls back
    to ordinary Redis string values while preserving the repository contract.
    """

    def __init__(self, redis_client: Any, *, key_prefix: str = "clozflow:wm") -> None:
        self._local_lock = RLock()
        self._redis = redis_client
        self._key_prefix = key_prefix

    def create(self, session: BrainSession) -> WorldModel:
        world_model = WorldModel(session_id=session.session_id, tenant_id=session.tenant_id)
        self._set_document(session.session_id, world_model)
        return world_model

    def get(self, session_id: UUID) -> WorldModel:
        raw = self._get_document(session_id)
        if raw is None:
            raise KeyError(f"world model not found for session: {session_id}")
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        if isinstance(raw, str):
            raw = json.loads(raw)
        return WorldModel.model_validate(raw)

    def session_lock(self, session_id: UUID):
        if hasattr(self._redis, "lock"):
            return self._redis.lock(f"{self._key(session_id)}:cycle", timeout=120, blocking_timeout=5)
        return self._local_lock

    def apply_mutations(self, session_id: UUID, mutations: list[WorldModelMutation]) -> WorldModel:
        lock = self._redis.lock(f"{self._key(session_id)}:write", timeout=30, blocking_timeout=5) if hasattr(self._redis, "lock") else self._local_lock
        with lock:
            return self._apply_locked(session_id, mutations)

    def _apply_locked(self, session_id: UUID, mutations: list[WorldModelMutation]) -> WorldModel:
        current = self.get(session_id)
        next_model = apply_world_model_mutations(current, mutations)
        self._set_document(session_id, next_model)
        try:
            self._redis.publish(f"clozflow:wm:updates:{session_id}", "updated")
        except Exception:
            pass
        return next_model

    def _key(self, session_id: UUID) -> str:
        return f"{self._key_prefix}:{session_id}"

    def _get_document(self, session_id: UUID) -> Any:
        key = self._key(session_id)
        json_api = getattr(self._redis, "json", None)
        if callable(json_api):
            api: Any = json_api()
            return api.get(key)
        return self._redis.get(key)

    def _set_document(self, session_id: UUID, world_model: WorldModel) -> None:
        key = self._key(session_id)
        data = world_model.model_dump(mode="json")
        json_api = getattr(self._redis, "json", None)
        if callable(json_api):
            api: Any = json_api()
            api.set(key, "$", data)
            return
        self._redis.set(key, json.dumps(data))

