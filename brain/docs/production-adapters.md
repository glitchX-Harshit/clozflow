> Historical implementation notes. For the current runtime and verified limitations, see [implementation-status.md](implementation-status.md) and the repository README.

# Production Adapters

This slice adds deployable infrastructure adapters while keeping the Kernel and service contracts unchanged.

## PostgreSQL-Compatible Persistence

`SQLAlchemySessionRepository` stores Brain Session metadata.

`SQLAlchemyPersistenceRepository` stores canonical cognitive artifacts, versions, and explicit artifact relationships.

The implementation uses SQLAlchemy Core and is PostgreSQL-compatible. Tests run against SQLite through the same repository contract so local verification does not require a database service.

## Redis JSON World Model

`RedisWorldModelRepository` stores the hot World Model as a JSON document keyed by session:

```text
clozflow:wm:{session_id}
```

The adapter uses RedisJSON when available and falls back to plain Redis string storage for compatibility. World Model mutations are applied through the same shared mutation function used by the in-memory repository.

## Kafka Event Bus

`KafkaEventBus` publishes immutable `CognitiveEvent` envelopes to `cognitive.events`.

Properties:

- Persistent producer on a dedicated event loop.
- Idempotence enabled by default in the underlying `AIOKafkaProducer`.
- Kafka key is `{tenant_id}:{session_id}` to preserve session-local ordering.
- Headers include `event_type` and `event_id`.
- The adapter keeps a local published-event audit buffer for diagnostics and tests.

## Adapter Status

- Implemented: SQLAlchemy session repository.
- Implemented: SQLAlchemy canonical artifact repository.
- Implemented: Redis JSON World Model repository.
- Implemented: Kafka Cognitive Event Bus publisher.
- Implemented: environment-based adapter factory.
- Pending: Kafka consumer groups per engine type.
- Pending: Redis optimistic locking/Lua transaction hardening for highly concurrent mutation writers.

## Environment Selection

The API factory selects infrastructure adapters through environment variables:

```powershell
$env:CEB_EVENT_BUS = "kafka"
$env:CEB_SESSION_REPOSITORY = "postgresql"
$env:CEB_WORLD_MODEL_REPOSITORY = "redis_json"
$env:CEB_PERSISTENCE_REPOSITORY = "postgresql"
$env:CEB_DATABASE_URL = "postgresql+psycopg://clozflow:local-dev-only@localhost:5432/clozflow_brain"
$env:CEB_REDIS_URL = "redis://:local-dev-only@localhost:6379/0"
$env:CEB_KAFKA_BOOTSTRAP_SERVERS = "localhost:9092"
```
