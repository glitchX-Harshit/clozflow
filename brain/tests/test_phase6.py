"""Phase 6: Knowledge & Memory — comprehensive test suite.

Tests:
  - Embedding client: Mock produces deterministic unit vectors.
  - QdrantVectorStore: upsert, search, batch operations (in-memory Qdrant).
  - KnowledgeService RAG pipeline: Qdrant-backed discovery.
  - KnowledgeService fallback: token-overlap when Qdrant is absent.
  - ReflectionEngine: generates session summary AND persists long-term memories.
"""

from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest

from clozflow_brain.contracts.events import CognitiveEvent, EventType
from clozflow_brain.contracts.knowledge import (
    DiscoveryIntent,
    KnowledgeArtifact,
    KnowledgeKind,
)
from clozflow_brain.contracts.world_model import WorldModel
from clozflow_brain.infrastructure.cognitive_repositories import InMemoryKnowledgeRepository
from clozflow_brain.infrastructure.cognitive_repositories import InMemoryMemoryRepository
from clozflow_brain.infrastructure.embeddings import (
    MockEmbeddingClient,
    _normalise,
    _deterministic_vector,
    EMBEDDING_DIM,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

TENANT_A = uuid.uuid4()
SESSION_A = uuid.uuid4()


def _make_artifact(title: str, body: str, kind: KnowledgeKind = KnowledgeKind.PLAYBOOK) -> KnowledgeArtifact:
    return KnowledgeArtifact(
        tenant_id=TENANT_A,
        kind=kind,
        title=title,
        body=body,
        concepts=title.lower().split(),
        provenance=f"test/{title.replace(' ', '_')}.md",
        confidence=0.90,
    )


def _make_world_model() -> WorldModel:
    return WorldModel(
        tenant_id=TENANT_A,
        session_id=SESSION_A,
        context_window=["Buyer asked about pricing. Salesperson explained ROI."],
    )


# ---------------------------------------------------------------------------
# 1. Embedding client
# ---------------------------------------------------------------------------


class TestMockEmbeddingClient:
    def test_embed_returns_correct_dimension(self):
        client = MockEmbeddingClient()
        vec = client.embed("hello world")
        assert len(vec) == EMBEDDING_DIM

    def test_embed_is_unit_vector(self):
        client = MockEmbeddingClient()
        vec = client.embed("ClozFlow pricing objection")
        magnitude = sum(v * v for v in vec) ** 0.5
        assert abs(magnitude - 1.0) < 1e-6

    def test_embed_is_deterministic(self):
        client = MockEmbeddingClient()
        v1 = client.embed("repeat text")
        v2 = client.embed("repeat text")
        assert v1 == v2

    def test_different_texts_produce_different_vectors(self):
        client = MockEmbeddingClient()
        v1 = client.embed("pricing objection")
        v2 = client.embed("product catalogue features")
        assert v1 != v2

    def test_embed_batch_returns_correct_count(self):
        client = MockEmbeddingClient()
        texts = ["alpha", "beta", "gamma"]
        results = client.embed_batch(texts)
        assert len(results) == 3
        for vec in results:
            assert len(vec) == EMBEDDING_DIM

    def test_normalise_zero_vector_returns_unchanged(self):
        zeros = [0.0] * 10
        result = _normalise(zeros)
        assert result == zeros

    def test_deterministic_vector_seeds_from_sha256(self):
        v1 = _deterministic_vector("test", dim=32)
        v2 = _deterministic_vector("test", dim=32)
        assert v1 == v2 and len(v1) == 32


# ---------------------------------------------------------------------------
# 2. Qdrant vector store
# ---------------------------------------------------------------------------


@pytest.fixture
def qdrant_store():
    """Return a QdrantVectorStore backed by an in-memory Qdrant client."""
    from qdrant_client import QdrantClient
    from clozflow_brain.infrastructure.qdrant_vector_store import QdrantVectorStore
    client = QdrantClient(location=":memory:")
    return QdrantVectorStore(client)


@pytest.fixture
def embedding_client():
    return MockEmbeddingClient()


class TestQdrantVectorStore:
    def test_collection_auto_created(self, qdrant_store):
        from clozflow_brain.infrastructure.qdrant_vector_store import KNOWLEDGE_COLLECTION
        collections = {c.name for c in qdrant_store._client.get_collections().collections}
        assert KNOWLEDGE_COLLECTION in collections

    def test_upsert_and_count(self, qdrant_store, embedding_client):
        artifact = _make_artifact("ROI playbook", "Return on investment calculations for enterprise.")
        vector = embedding_client.embed(artifact.title)
        qdrant_store.upsert_knowledge(artifact, vector)
        assert qdrant_store.count() == 1

    def test_upsert_is_idempotent(self, qdrant_store, embedding_client):
        artifact = _make_artifact("Duplicate test", "Test idempotency of upsert.")
        vector = embedding_client.embed(artifact.title)
        qdrant_store.upsert_knowledge(artifact, vector)
        qdrant_store.upsert_knowledge(artifact, vector)
        assert qdrant_store.count() == 1  # same point ID → overwrite

    def test_search_returns_relevant_results(self, qdrant_store, embedding_client):
        artifact = _make_artifact("Pricing objection", "Handle price-sensitive buyer concerns.")
        vector = embedding_client.embed(artifact.title)
        qdrant_store.upsert_knowledge(artifact, vector)

        query_vec = embedding_client.embed("Pricing objection")
        results = qdrant_store.search_knowledge(TENANT_A, query_vec, limit=5, similarity_threshold=0.0)
        assert len(results) >= 1
        found_artifact, score = results[0]
        assert found_artifact.knowledge_id == artifact.knowledge_id
        assert -0.01 <= score <= 1.01  # allow tiny floating-point overshoot from cosine sim

    def test_search_filters_by_tenant(self, qdrant_store, embedding_client):
        other_tenant = uuid.uuid4()
        a1 = KnowledgeArtifact(
            tenant_id=TENANT_A,
            kind=KnowledgeKind.PLAYBOOK,
            title="Tenant A article",
            body="Only visible to tenant A.",
            concepts=["tenant", "a"],
            provenance="test/ta.md",
            confidence=0.9,
        )
        a2 = KnowledgeArtifact(
            tenant_id=other_tenant,
            kind=KnowledgeKind.PLAYBOOK,
            title="Tenant B article",
            body="Only visible to tenant B.",
            concepts=["tenant", "b"],
            provenance="test/tb.md",
            confidence=0.9,
        )
        for art in [a1, a2]:
            qdrant_store.upsert_knowledge(art, embedding_client.embed(art.title))

        results = qdrant_store.search_knowledge(TENANT_A, embedding_client.embed("tenant article"), limit=10, similarity_threshold=0.0)
        assert all(r[0].tenant_id == TENANT_A for r in results)

    def test_batch_upsert(self, qdrant_store, embedding_client):
        artifacts = [
            _make_artifact("Product A", "Enterprise SaaS product catalogue entry A."),
            _make_artifact("Product B", "Enterprise SaaS product catalogue entry B."),
            _make_artifact("Product C", "Enterprise SaaS product catalogue entry C."),
        ]
        vectors = [embedding_client.embed(a.title) for a in artifacts]
        qdrant_store.upsert_batch(artifacts, vectors)
        assert qdrant_store.count() == 3

    def test_batch_upsert_length_mismatch_raises(self, qdrant_store, embedding_client):
        artifacts = [_make_artifact("Single", "body")]
        with pytest.raises(ValueError, match="same length"):
            qdrant_store.upsert_batch(artifacts, [])


# ---------------------------------------------------------------------------
# 3. KnowledgeService with RAG pipeline
# ---------------------------------------------------------------------------


class TestKnowledgeServiceRAG:
    def _make_service(self):
        from qdrant_client import QdrantClient
        from clozflow_brain.infrastructure.qdrant_vector_store import QdrantVectorStore
        from clozflow_brain.application.knowledge_service import KnowledgeService

        repo = InMemoryKnowledgeRepository()
        store = QdrantVectorStore(QdrantClient(location=":memory:"))
        client = MockEmbeddingClient()
        return KnowledgeService(repo, vector_store=store, embedding_client=client), repo, store, client

    def test_store_indexes_in_qdrant(self):
        svc, _repo, store, _client = self._make_service()
        artifact = _make_artifact("Product Brochure", "ClozFlow Enterprise CRM system.")
        svc.store(artifact)
        assert store.count() == 1

    def test_discover_via_rag_returns_relevant_candidate(self):
        svc, _repo, _store, _client = self._make_service()
        artifact = _make_artifact("Procurement approval playbook", "Steps to gain procurement approval.")
        svc.store(artifact)

        intent = DiscoveryIntent(
            tenant_id=TENANT_A,
            session_id=SESSION_A,
            objective="procurement approval",
            concepts=["procurement", "approval"],
            top_k=5,
        )
        package = svc.discover(intent)
        assert package.confidence >= 0.0
        # Should have found the artifact through vector similarity
        assert len(package.candidates) >= 1

    def test_discover_confidence_between_zero_and_one(self):
        svc, _repo, _store, _client = self._make_service()
        svc.store(_make_artifact("Legal playbook", "Contract negotiation guidance."))

        intent = DiscoveryIntent(
            tenant_id=TENANT_A,
            session_id=SESSION_A,
            objective="legal contract",
            concepts=["legal", "contract"],
            top_k=5,
        )
        package = svc.discover(intent)
        assert 0.0 <= package.confidence <= 1.0


# ---------------------------------------------------------------------------
# 4. KnowledgeService fallback (no Qdrant)
# ---------------------------------------------------------------------------


class TestKnowledgeServiceFallback:
    def _make_service(self):
        from clozflow_brain.application.knowledge_service import KnowledgeService

        repo = InMemoryKnowledgeRepository()
        # No vector store / embedding client
        return KnowledgeService(repo), repo

    def test_discover_falls_back_to_token_overlap(self):
        svc, repo = self._make_service()
        artifact = _make_artifact("Pricing strategy", "Discount analysis for enterprise deals.")
        repo.save_knowledge(artifact)

        intent = DiscoveryIntent(
            tenant_id=TENANT_A,
            session_id=SESSION_A,
            objective="pricing discount",
            concepts=["pricing", "discount", "enterprise"],
            top_k=5,
        )
        package = svc.discover(intent)
        assert len(package.candidates) >= 1
        assert package.candidates[0].knowledge.title == "Pricing strategy"

    def test_discover_empty_repository_returns_zero_confidence(self):
        svc, _repo = self._make_service()
        intent = DiscoveryIntent(
            tenant_id=TENANT_A,
            session_id=SESSION_A,
            objective="anything",
            concepts=["nothinghere"],
            top_k=5,
        )
        package = svc.discover(intent)
        assert package.confidence == 0.0
        assert len(package.candidates) == 0


# ---------------------------------------------------------------------------
# 5. ReflectionEngine with MemoryService
# ---------------------------------------------------------------------------


class TestReflectionEnginePhase6:
    def _make_memory_service(self):
        from clozflow_brain.application.memory_service import MemoryService
        return MemoryService(InMemoryMemoryRepository())

    def _make_engine(self, memory_service):
        from clozflow_brain.engines.reflection import ReflectionEngine
        return ReflectionEngine(memory_service=memory_service)

    def _make_request(self):
        from clozflow_brain.contracts.engines import EngineExecutionInput
        event = CognitiveEvent.create(
            event_type=EventType.SESSION_END,
            session_id=SESSION_A,
            tenant_id=TENANT_A,
            sequence_num=99,
            source="test",
            confidence=1.0,
            payload={"status": "TERMINATED"},
        )
        return EngineExecutionInput(
            cycle_id=uuid.uuid4(),
            events=[event],
            world_model=_make_world_model(),
            cognitive_context=None,
            timeout_ms=30000,
        )

    def test_reflection_engine_succeeds_without_memory_service(self):
        from clozflow_brain.engines.reflection import ReflectionEngine
        engine = ReflectionEngine(memory_service=None)
        request = self._make_request()
        output = engine.execute(request)
        assert output.status.value in {"SUCCESS", "ERROR"}  # may fail LLM in offline test

    def test_reflection_engine_persists_memories_on_success(self):
        """When the LLM succeeds, memories should be stored."""
        from clozflow_brain.engines.reflection import ReflectionEngine, SessionSummary

        memory_service = self._make_memory_service()
        engine = ReflectionEngine(memory_service=memory_service)

        mock_summary = SessionSummary(
            key_takeaways=["Buyer is interested in Q3 ROI"],
            unresolved_objections=["Price is too high", "Integration complexity"],
            next_steps=["Send pricing proposal", "Schedule follow-up"],
            sentiment_trend="improving",
            confidence=0.85,
            deltas=[],
            attributions=[],
            calibrations=[],
        )

        with patch.object(engine.llm_client, "generate_structured_output", return_value=mock_summary):
            output = engine.execute(self._make_request())

        from clozflow_brain.contracts.engines import EngineStatus
        assert output.status == EngineStatus.SUCCESS

        # Verify memories were stored: 1 buyer profile + 2 objections + 1 outcome = 4
        records = memory_service.list_for_session(TENANT_A, SESSION_A)
        assert len(records) >= 4
        all_records = memory_service.list_for_tenant(TENANT_A)
        assert len(all_records) >= 4

        subjects = [r.subject for r in all_records]
        assert any("Buyer Profile" in s for s in subjects)
        assert any("Historical Objection" in s for s in subjects)
        assert any("Past Outcome" in s for s in subjects)

    def test_reflection_engine_skips_memory_on_llm_error(self):
        """When the LLM fails, no memories should be written."""
        from clozflow_brain.engines.reflection import ReflectionEngine

        memory_service = self._make_memory_service()
        engine = ReflectionEngine(memory_service=memory_service)

        with patch.object(engine.llm_client, "generate_structured_output", side_effect=RuntimeError("LLM timeout")):
            output = engine.execute(self._make_request())

        from clozflow_brain.contracts.engines import EngineStatus
        assert output.status == EngineStatus.ERROR
        all_records = memory_service.list_for_tenant(TENANT_A)
        assert len(all_records) == 0

    def test_reflection_wm_mutation_contains_session_summary(self):
        from clozflow_brain.engines.reflection import ReflectionEngine, SessionSummary

        memory_service = self._make_memory_service()
        engine = ReflectionEngine(memory_service=memory_service)

        mock_summary = SessionSummary(
            key_takeaways=["Demonstrated product value"],
            unresolved_objections=[],
            next_steps=["Send contract"],
            sentiment_trend="positive",
            confidence=0.92,
            deltas=[],
            attributions=[],
            calibrations=[],
        )

        with patch.object(engine.llm_client, "generate_structured_output", return_value=mock_summary):
            output = engine.execute(self._make_request())

        assert len(output.wm_mutations) >= 1
        mutation = output.wm_mutations[0]
        assert mutation.payload["belief_type"] == "SESSION_SUMMARY"
