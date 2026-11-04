> Historical implementation notes. For the current runtime and verified limitations, see [implementation-status.md](implementation-status.md) and the repository README.

# Phase 1-2 Architecture

The implementation follows CCBS Volume X Chapter 10 while preserving the architectural laws from Volumes I, II, V, VII, and VIII.

## Primary Boundaries

- `contracts`: canonical schemas and interfaces. This layer contains no infrastructure.
- `kernel`: Cognitive Kernel, event buses, scheduler, engine registry, and telemetry coordination.
- `application`: use-case services for sessions, event ingestion, context, memory, knowledge, and persistence.
- `infrastructure`: replaceable adapters. Local adapters remain available; Kafka, Redis JSON, SQLAlchemy, and SQLite adapters are implemented behind the same contracts.
- `api`: detached public API adapter. Future applications must use this boundary rather than Brain internals.
- `apps/reference-ui`: detachable test UI only.

## CCBS Decisions

- Volume X is used for concrete implementation contracts because it is the definitive implementation reference.
- The repository still keeps Volumes I-IX as authoritative for cognitive philosophy, architectural laws, and module boundaries.
- Local execution defaults to in-memory/SQLite adapters. Kafka, Redis JSON, and PostgreSQL-compatible SQLAlchemy adapters are implemented and selectable through environment variables.
- Engines are registered with the Kernel and selected by event type. They receive state snapshots and emit output events plus World Model mutations.
- The Kernel constructs context, activates memory, discovers knowledge, attaches memory/knowledge refs to the World Model, then schedules engines.
- Engines still never directly mutate the World Model or directly own memory/knowledge/persistence.

## Phase 1 Components

- Cognitive Event registry and validation.
- World Model state object with versioning.
- Recommendation schema.
- Engine registration and execution contracts.
- Brain Session model and lifecycle service.
- Cognitive Kernel coordination loop.
- In-memory event bus and repositories.
- Required telemetry signal names.
- Public API adapter skeleton for sessions, events, batch events, World Model snapshots, recommendations, and stream delivery.

## Phase 2 Components

- Canonical cognitive artifact and lifecycle contracts.
- Runtime Cognitive Context.
- Memory records, activations, and Working Memory.
- Semantic knowledge artifacts and Knowledge Packages.
- Context, memory, knowledge, and persistence repositories.
- SQLAlchemy session/artifact/context/memory/knowledge repositories.
- Redis JSON World Model repository.
- Kafka Event Bus publisher.
- Kernel pre-reasoning context enrichment.
- Session-start memory injection cycle.

## Not Yet Implemented

- Kafka consumer groups per engine type.
- OpenTelemetry exporter, Kong gateway, and Kubernetes manifests.
- Production JWT verification and tenant rate limiting.
- Cognitive engines beyond contract registration.
- Full reasoning, planning, learning, governance, workflow execution, and LLM adapters.
- Enterprise-grade vector/graph retrieval backend and embeddings.

These omissions are later-phase boundaries, not architecture changes.
