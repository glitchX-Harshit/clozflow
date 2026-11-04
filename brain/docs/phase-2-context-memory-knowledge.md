> Historical implementation notes. For the current runtime and verified limitations, see [implementation-status.md](implementation-status.md) and the repository README.

# Phase 2 Context, Memory, Knowledge, Persistence

This slice implements the CCBS foundations for:

- Canonical Cognitive Persistence Architecture (CCPA), Volume V Chapter 11.
- Cognitive Memory Architecture (CMA2), Volume V Chapter 12.
- Semantic Knowledge Fabric (SKF), Volume V Chapter 13.
- Cognitive Information Lifecycle Framework (CILF), Volume V Chapter 15.
- Enterprise Cognitive Context Framework (ECCF), Volume VII Chapter 3.
- Enterprise Context Processing Engine (ECPE), Volume VIII Chapter 4.
- Enterprise Cognitive Memory Engine (ECME), Volume VIII Chapter 5.

## Completed Phase 2 Scope

- Canonical `CognitiveArtifact` contracts with identity, owner, namespace, lifecycle state, version, confidence, payload, provenance, and governance metadata.
- Explicit `CognitiveContext` assembled before engine execution.
- Memory records separated by memory type: working, episodic, semantic, procedural, strategic, organizational, reflective, and governance.
- Goal-directed memory activation into `WorkingMemory`.
- Semantic knowledge artifacts, discovery intents, candidates, and reasoning-ready `KnowledgePackage` outputs.
- In-memory context, memory, knowledge, and artifact repositories.
- SQLite artifact persistence adapter for local restart survival.
- SQLAlchemy repositories for sessions, canonical artifacts, context, memory, and knowledge.
- Redis JSON World Model adapter.
- Kafka Event Bus publisher adapter.
- Kernel integration so engines receive `cognitive_context` through `EngineExecutionInput`.
- Kernel pre-engine enrichment: construct context, activate relevant memory, discover relevant knowledge, attach MemoryRefs and KnowledgeRefs to the World Model, then schedule engines.
- Session-start Cognitive Execution Cycle, allowing metadata-driven memory injection at Brain Session creation.
- API endpoints for current context, memory storage/listing, knowledge storage/listing, and knowledge discovery.

## Architectural Notes

- Context is constructed from Cognitive Events and the World Model before scheduler-selected engines run.
- Memory activation is relevance-driven and distinct from storage lookup.
- Knowledge discovery returns packages with provenance, not isolated document strings.
- SQLite is a local adapter under the same persistence contract; production storage remains PostgreSQL/graph/vector/search as specified by CCBS.
- Engines still do not directly access memory, knowledge, or persistence. The Kernel coordinates pre-reasoning context enrichment.

## Still Pending

- Enterprise-grade vector/graph retrieval backend and embeddings.
- Governance approval workflows around lifecycle transitions.
- Full context enrichment from policy, business state, and human context sources.
- Kafka consumer groups per cognitive engine.
- Redis optimistic locking/Lua hardening for concurrent World Model mutations.

These remaining items belong to later reasoning, governance, and runtime-hardening phases, not the Phase 2 foundation.
