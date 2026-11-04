> Historical implementation notes. For the current runtime and verified limitations, see [implementation-status.md](implementation-status.md) and the repository README.

# Extension Points

The Phase 1 code intentionally keeps extension points at CCBS architectural boundaries.

## Cognitive Engines

Register a new engine through `EngineRegistry.register(engine)`. The engine must expose an `EngineRegistration` and implement `execute(request)`.

Engines receive:

- triggering `CognitiveEvent` objects,
- a `WorldModel` snapshot,
- runtime configuration,
- a hard timeout budget.

Engines return:

- output events,
- `WorldModelMutation` objects,
- confidence,
- duration,
- status,
- reasoning trace for observability.

Engines must not store persistent state or directly modify the World Model.

## Infrastructure Adapters

The in-memory bus and repositories are replaceable behind protocols:

- `EventBus`
- `SessionRepository`
- `WorldModelRepository`
- `Telemetry`

Production adapters should map these to Kafka, PostgreSQL, Redis JSON, and OpenTelemetry.

Current adapter implementations:

- `KafkaEventBus`
- `RedisWorldModelRepository`
- `SQLAlchemySessionRepository`
- `SQLAlchemyPersistenceRepository`

## Model Layer

No LLM provider is wired into Phase 1. Future providers should be added behind a Model Abstraction Layer and invoked only by modules allowed by CCBS, especially the Communication Module for language generation.
