"""Infrastructure adapter factory.

Environment variables keep adapter selection outside the Cognitive Kernel:

- CEB_EVENT_BUS=memory|kafka
- CEB_SESSION_REPOSITORY=memory|sqlalchemy
- CEB_WORLD_MODEL_REPOSITORY=memory|redis
- CEB_PERSISTENCE_REPOSITORY=memory|sqlite|sqlalchemy
- CEB_EMBEDDING_CLIENT=mock|openai          (Phase 6)
- CEB_QDRANT_MODE=memory|disk|remote        (Phase 6)
- CEB_QDRANT_URL=<url>                      (Phase 6 remote mode)
- CEB_QDRANT_API_KEY=<key>                  (Phase 6 remote mode)
- CEB_QDRANT_DISK_PATH=<path>               (Phase 6 disk mode)
"""

from __future__ import annotations

import os
from pathlib import Path

from clozflow_brain.infrastructure.cognitive_repositories import InMemoryPersistenceRepository
from clozflow_brain.infrastructure.cognitive_repositories import (
    InMemoryContextRepository,
    InMemoryKnowledgeRepository,
    InMemoryMemoryRepository,
)
from clozflow_brain.infrastructure.repositories import (
    InMemorySessionRepository,
    InMemoryWorldModelRepository,
    SessionRepository,
    WorldModelRepository,
    WorldModelCheckpointRepository,
)
from clozflow_brain.kernel.buses import EventBus, InMemoryEventBus


def _repository_default() -> str:
    return "sqlalchemy" if os.getenv("CEB_STORAGE_PROFILE") == "durable" else "memory"


def build_event_bus_from_env() -> EventBus:
    backend = os.getenv("CEB_EVENT_BUS", "memory").lower()
    if backend == "memory":
        return InMemoryEventBus()
    if backend == "kafka":
        from clozflow_brain.infrastructure.kafka_bus import KafkaEventBus

        return KafkaEventBus(
            bootstrap_servers=os.getenv("CEB_KAFKA_BOOTSTRAP_SERVERS", "localhost:9092"),
            topic=os.getenv("CEB_KAFKA_EVENTS_TOPIC", "cognitive.events"),
        )
    raise ValueError(f"unsupported CEB_EVENT_BUS: {backend}")


def build_session_repository_from_env() -> SessionRepository:
    backend = os.getenv("CEB_SESSION_REPOSITORY", _repository_default()).lower()
    if backend == "memory":
        return InMemorySessionRepository()
    if backend in {"sqlalchemy", "postgresql"}:
        from clozflow_brain.infrastructure.sqlalchemy_repositories import (
            SQLAlchemySessionRepository,
            create_repository_engine,
        )

        url = os.getenv(
            "CEB_DATABASE_URL",
            "sqlite:///data/runtime.sqlite",
        )
        return SQLAlchemySessionRepository(create_repository_engine(url))
    raise ValueError(f"unsupported CEB_SESSION_REPOSITORY: {backend}")


def build_world_model_repository_from_env() -> WorldModelRepository:
    backend = os.getenv("CEB_WORLD_MODEL_REPOSITORY", _repository_default()).lower()
    if backend == "memory":
        return InMemoryWorldModelRepository()
    if backend in {"sqlalchemy", "postgresql"}:
        from clozflow_brain.infrastructure.sqlalchemy_repositories import (
            SQLAlchemyWorldModelRepository, create_repository_engine,
        )
        return SQLAlchemyWorldModelRepository(create_repository_engine(_database_url()))
    if backend in {"redis", "redis_json"}:
        from redis import Redis

        from clozflow_brain.infrastructure.redis_world_model import RedisWorldModelRepository

        redis_url = os.getenv("CEB_REDIS_URL", "redis://:local-dev-only@localhost:6379/0")
        return RedisWorldModelRepository(
            Redis.from_url(redis_url),
            key_prefix=os.getenv("CEB_REDIS_WM_KEY_PREFIX", "clozflow:wm"),
        )
    raise ValueError(f"unsupported CEB_WORLD_MODEL_REPOSITORY: {backend}")


def build_persistence_repository_from_env():
    backend = os.getenv("CEB_PERSISTENCE_REPOSITORY", "sqlalchemy" if os.getenv("CEB_STORAGE_PROFILE") == "durable" else "sqlite").lower()
    if backend == "memory":
        return InMemoryPersistenceRepository()
    if backend == "sqlite":
        from clozflow_brain.infrastructure.sqlite_persistence import SQLitePersistenceRepository

        path = Path(os.getenv("CEB_SQLITE_PATH", "data/brain.sqlite"))
        return SQLitePersistenceRepository(path)
    if backend in {"sqlalchemy", "postgresql"}:
        from clozflow_brain.infrastructure.sqlalchemy_repositories import (
            SQLAlchemyPersistenceRepository,
            create_repository_engine,
        )

        url = os.getenv(
            "CEB_DATABASE_URL",
            "sqlite:///data/runtime.sqlite",
        )
        return SQLAlchemyPersistenceRepository(create_repository_engine(url))
    raise ValueError(f"unsupported CEB_PERSISTENCE_REPOSITORY: {backend}")


def build_context_repository_from_env():
    backend = os.getenv("CEB_CONTEXT_REPOSITORY", _repository_default()).lower()
    if backend == "memory":
        return InMemoryContextRepository()
    if backend in {"sqlalchemy", "postgresql"}:
        from clozflow_brain.infrastructure.sqlalchemy_repositories import (
            SQLAlchemyContextRepository,
            create_repository_engine,
        )

        return SQLAlchemyContextRepository(create_repository_engine(_database_url()))
    raise ValueError(f"unsupported CEB_CONTEXT_REPOSITORY: {backend}")


def build_memory_repository_from_env():
    backend = os.getenv("CEB_MEMORY_REPOSITORY", _repository_default()).lower()
    if backend == "memory":
        return InMemoryMemoryRepository()
    if backend in {"sqlalchemy", "postgresql"}:
        from clozflow_brain.infrastructure.sqlalchemy_repositories import (
            SQLAlchemyMemoryRepository,
            create_repository_engine,
        )

        return SQLAlchemyMemoryRepository(create_repository_engine(_database_url()))
    raise ValueError(f"unsupported CEB_MEMORY_REPOSITORY: {backend}")


def build_knowledge_repository_from_env():
    backend = os.getenv("CEB_KNOWLEDGE_REPOSITORY", _repository_default()).lower()
    if backend == "memory":
        return InMemoryKnowledgeRepository()
    if backend in {"sqlalchemy", "postgresql"}:
        from clozflow_brain.infrastructure.sqlalchemy_repositories import (
            SQLAlchemyKnowledgeRepository,
            create_repository_engine,
        )

        return SQLAlchemyKnowledgeRepository(create_repository_engine(_database_url()))
    raise ValueError(f"unsupported CEB_KNOWLEDGE_REPOSITORY: {backend}")


def _database_url() -> str:
    return os.getenv(
        "CEB_DATABASE_URL",
        "sqlite:///data/runtime.sqlite",
    )


def build_checkpoint_repository_from_env() -> WorldModelCheckpointRepository:
    backend = os.getenv("CEB_CHECKPOINT_REPOSITORY", _repository_default()).lower()
    if backend == "memory":
        from clozflow_brain.infrastructure.repositories import InMemoryWorldModelCheckpointRepository
        return InMemoryWorldModelCheckpointRepository()
    if backend in {"sqlalchemy", "postgresql"}:
        from clozflow_brain.infrastructure.sqlalchemy_repositories import (
            SQLAlchemyWorldModelCheckpointRepository,
            create_repository_engine,
        )
        return SQLAlchemyWorldModelCheckpointRepository(create_repository_engine(_database_url()))
    raise ValueError(f"unsupported CEB_CHECKPOINT_REPOSITORY: {backend}")


def build_embedding_client_from_env():
    """Return the configured :class:`~clozflow_brain.infrastructure.embeddings.EmbeddingClient`.

    Controlled by ``CEB_EMBEDDING_CLIENT`` (mock|openai).  Defaults to ``mock``
    so that the system works offline without any API credentials.
    """
    if os.getenv("CEB_EMBEDDING_CLIENT") == "lexical":
        return None
    from clozflow_brain.infrastructure.embeddings import get_embedding_client

    return get_embedding_client()


def build_vector_store_from_env():
    """Return a configured :class:`~clozflow_brain.infrastructure.qdrant_vector_store.QdrantVectorStore`.

    Controlled by ``CEB_QDRANT_MODE`` (memory|disk|remote).  Defaults to ``memory``
    so that the system works offline without a running Qdrant server.
    """
    if os.getenv("CEB_EMBEDDING_CLIENT") == "lexical":
        return None
    from clozflow_brain.infrastructure.qdrant_vector_store import (
        QdrantVectorStore,
        build_qdrant_client,
    )

    client = build_qdrant_client()
    return QdrantVectorStore(client)
