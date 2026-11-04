"""Semantic knowledge discovery service — Phase 6 RAG-enhanced.

When a :class:`QdrantVectorStore` and :class:`EmbeddingClient` are injected,
discovery queries use vector similarity search (CCBS V10 §6.1).  When they are
absent (or when Qdrant returns zero hits), the service falls back to the original
token-overlap scoring so the system degrades gracefully in offline / test scenarios.
"""

from __future__ import annotations

import logging
import math
import re
from collections import Counter

from clozflow_brain.contracts.context import CognitiveContext
from clozflow_brain.contracts.knowledge import (
    DiscoveryIntent,
    KnowledgeArtifact,
    KnowledgeCandidate,
    KnowledgePackage,
)
from clozflow_brain.infrastructure.cognitive_repositories import KnowledgeRepository

logger = logging.getLogger(__name__)


def _terms(values: list[str] | str) -> set[str]:
    text = " ".join(values) if isinstance(values, list) else values
    stop = {"the", "and", "for", "with", "that", "this", "have", "what", "your", "our", "are", "you"}
    return {token.lower() for token in re.findall(r"[^\W_]+", text, re.UNICODE) if len(token) > 1 and token.lower() not in stop}


class KnowledgeService:
    """Assembles contextually relevant enterprise knowledge for a cognitive cycle.

    Two retrieval strategies are supported (selected at runtime by the presence of
    optional dependencies):

    1. **RAG (primary)** — embeds the query and performs Qdrant ANN search.
    2. **Token-overlap (fallback)** — Jaccard-style keyword overlap scoring against
       the in-process ``KnowledgeRepository``.
    """

    def __init__(
        self,
        repository: KnowledgeRepository,
        *,
        vector_store: object | None = None,  # QdrantVectorStore | None
        embedding_client: object | None = None,  # EmbeddingClient | None
    ) -> None:
        self._repository = repository
        self._vector_store = vector_store
        self._embedding_client = embedding_client

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def store(self, artifact: KnowledgeArtifact) -> KnowledgeArtifact:
        """Persist an artefact to the SQL repository and optionally to Qdrant."""
        saved = self._repository.save_knowledge(artifact)
        if self._vector_store is not None and self._embedding_client is not None:
            try:
                text = f"{artifact.title} {artifact.body} {' '.join(artifact.concepts)}"
                vector = self._embedding_client.embed(text)  # type: ignore[union-attr]
                self._vector_store.upsert_knowledge(saved, vector)  # type: ignore[union-attr]
            except Exception:
                logger.warning(
                    "Failed to index knowledge '%s' in Qdrant — continuing without vector index.",
                    artifact.knowledge_id,
                    exc_info=True,
                )
        return saved

    def list_for_tenant(self, tenant_id) -> list[KnowledgeArtifact]:
        return self._repository.list_knowledge(tenant_id)

    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------

    def discover(self, intent: DiscoveryIntent) -> KnowledgePackage:
        """Retrieve the most relevant knowledge artefacts for *intent*.

        Tries Qdrant vector search first; falls back to token-overlap scoring.
        """
        candidates = self._rag_search(intent)
        if not candidates:
            candidates = self._token_overlap_search(intent)

        candidates.sort(key=lambda c: c.relevance, reverse=True)
        selected = candidates[: intent.top_k]
        confidence = 0.0 if not selected else sum(c.relevance for c in selected) / len(selected)
        concepts = sorted({concept for candidate in selected for concept in candidate.knowledge.concepts})
        provenance_refs = [candidate.knowledge.provenance for candidate in selected]

        return KnowledgePackage(
            tenant_id=intent.tenant_id,
            session_id=intent.session_id,
            intent=intent,
            candidates=selected,
            concepts=concepts,
            provenance_refs=provenance_refs,
            confidence=confidence,
        )

    def discover_for_context(self, context: CognitiveContext, *, top_k: int = 5) -> KnowledgePackage:
        concepts = sorted(
            {
                term
                for fragment in context.fragments
                for term in _terms(str(fragment.content))
            }
        )
        return self.discover(
            DiscoveryIntent(
                tenant_id=context.tenant_id,
                session_id=context.session_id,
                objective="assemble contextually relevant enterprise knowledge",
                concepts=concepts,
                top_k=top_k,
            )
        )

    # ------------------------------------------------------------------
    # Private search strategies
    # ------------------------------------------------------------------

    def _rag_search(self, intent: DiscoveryIntent) -> list[KnowledgeCandidate]:
        """Vector-similarity search via Qdrant.

        Returns an empty list if the vector store / embedding client is not
        configured, or if a remote call fails.
        """
        if self._vector_store is None or self._embedding_client is None:
            return []

        try:
            query_text = " ".join([intent.objective] + intent.concepts)
            vector = self._embedding_client.embed(query_text)  # type: ignore[union-attr]
            hits = self._vector_store.search_knowledge(  # type: ignore[union-attr]
                intent.tenant_id,
                vector,
                limit=intent.top_k,
                similarity_threshold=0.70,
            )
            candidates = [
                KnowledgeCandidate(
                    knowledge=artifact,
                    relevance=float(score),
                    rationale=f"vector similarity: {score:.3f}",
                )
                for artifact, score in hits
                if artifact.lifecycle_state.value not in {"ARCHIVED", "RETIRED"}
            ]
            if candidates:
                logger.debug(
                    "RAG search returned %d candidates for intent '%s'.",
                    len(candidates),
                    intent.objective,
                )
            return candidates
        except Exception:
            logger.warning("Qdrant search failed — falling back to token overlap.", exc_info=True)
            return []

    def _token_overlap_search(self, intent: DiscoveryIntent) -> list[KnowledgeCandidate]:
        """BM25-style lexical retrieval; deterministic and durable without API keys."""
        query_terms = _terms(intent.concepts + [intent.objective])
        artifacts = [artifact for artifact in self._repository.list_knowledge(intent.tenant_id)
                     if artifact.lifecycle_state.value not in {"ARCHIVED", "DELETED", "DEPRECATED", "REJECTED", "RETIRED"}]
        term_sets = [_terms(artifact.concepts + [artifact.title, artifact.body]) for artifact in artifacts]
        frequencies = Counter(term for terms in term_sets for term in terms)
        avg_length = sum(len(terms) for terms in term_sets) / max(len(term_sets), 1)
        candidates: list[KnowledgeCandidate] = []
        for artifact, artifact_terms in zip(artifacts, term_sets):
            overlap = query_terms.intersection(artifact_terms)
            if not overlap:
                continue
            score = sum(math.log(1 + (len(artifacts) - frequencies[term] + 0.5) / (frequencies[term] + 0.5))
                        * 2.2 / (1 + 1.2 * (0.25 + 0.75 * len(artifact_terms) / max(avg_length, 1)))
                        for term in overlap)
            relevance = (1 - math.exp(-score)) * artifact.confidence
            candidates.append(
                KnowledgeCandidate(
                    knowledge=artifact,
                    relevance=relevance,
                    rationale=f"lexical BM25 terms: {', '.join(sorted(overlap))}",
                )
            )
        return candidates
