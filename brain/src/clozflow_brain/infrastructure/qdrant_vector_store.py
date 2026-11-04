"""Qdrant vector store adapter for the ClozFlow Knowledge RAG pipeline.

CCBS V10 §6.1 specifies:
  - Deploy Qdrant vector store with product catalogue, playbooks, objection library.
  - Implement embedding pipeline (text-embedding-3-small or equivalent).
  - Implement retrieval engine: query on conversation context, top-5 results.
  - Attach results as KnowledgeRef objects in World Model.

This module encapsulates all Qdrant interaction behind the ``QdrantVectorStore``
class, which can operate in three modes:

  1. In-memory  — ``QdrantClient(location=":memory:")``  — unit tests / local dev.
  2. On-disk    — ``QdrantClient(path="./data/qdrant")`` — single-node offline.
  3. Remote     — ``QdrantClient(url=..., api_key=...)`` — production cluster.

Mode is selected via ``CEB_QDRANT_MODE`` (memory|disk|remote).
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any
from uuid import UUID

from clozflow_brain.contracts.knowledge import KnowledgeArtifact, KnowledgeKind
from clozflow_brain.contracts.persistence import ArtifactLifecycleState

logger = logging.getLogger(__name__)

# Qdrant collection used for all knowledge artefacts
KNOWLEDGE_COLLECTION = "clozflow_knowledge"
EMBEDDING_DIM = 1536  # must match the embedding client dimension


class QdrantVectorStore:
    """Thin wrapper around the Qdrant SDK exposing upsert and search operations.

    The class is intentionally stateless with respect to the embedding dimension:
    the caller supplies pre-computed vectors.  This keeps the vector store decoupled
    from the embedding provider.
    """

    def __init__(self, client: Any) -> None:
        """Initialise with a pre-constructed ``QdrantClient`` instance."""
        self._client = client
        self._ensure_collection()

    # ------------------------------------------------------------------
    # Collection management
    # ------------------------------------------------------------------

    def _ensure_collection(self) -> None:
        """Create the knowledge collection if it does not already exist."""
        from qdrant_client.models import Distance, VectorParams  # type: ignore[import-untyped]

        existing = {c.name for c in self._client.get_collections().collections}
        if KNOWLEDGE_COLLECTION not in existing:
            self._client.create_collection(
                collection_name=KNOWLEDGE_COLLECTION,
                vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
            )
            logger.info("Created Qdrant collection '%s'.", KNOWLEDGE_COLLECTION)

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def upsert_knowledge(self, artifact: KnowledgeArtifact, vector: list[float]) -> None:
        """Insert or overwrite a knowledge artefact in the collection.

        The Qdrant point ID is derived from the UUID of the artefact so that
        re-indexing the same artefact is idempotent.
        """
        from qdrant_client.models import PointStruct  # type: ignore[import-untyped]

        point_id = _uuid_to_int(artifact.knowledge_id)
        payload = {
            "knowledge_id": str(artifact.knowledge_id),
            "tenant_id": str(artifact.tenant_id),
            "kind": artifact.kind.value,
            "title": artifact.title,
            "body": artifact.body,
            "concepts": artifact.concepts,
            "provenance": artifact.provenance,
            "confidence": artifact.confidence,
            "metadata": json.dumps(artifact.metadata),
        }
        self._client.upsert(
            collection_name=KNOWLEDGE_COLLECTION,
            points=[PointStruct(id=point_id, vector=vector, payload=payload)],
        )
        logger.debug(
            "Upserted knowledge '%s' (id=%s) into Qdrant.", artifact.title, artifact.knowledge_id
        )

    def upsert_batch(
        self, artifacts: list[KnowledgeArtifact], vectors: list[list[float]]
    ) -> None:
        """Batch upsert multiple knowledge artefacts."""
        from qdrant_client.models import PointStruct  # type: ignore[import-untyped]

        if len(artifacts) != len(vectors):
            raise ValueError("artifacts and vectors must have the same length")

        points = [
            PointStruct(
                id=_uuid_to_int(artifact.knowledge_id),
                vector=vector,
                payload={
                    "knowledge_id": str(artifact.knowledge_id),
                    "tenant_id": str(artifact.tenant_id),
                    "kind": artifact.kind.value,
                    "title": artifact.title,
                    "body": artifact.body,
                    "concepts": artifact.concepts,
                    "provenance": artifact.provenance,
                    "confidence": artifact.confidence,
                    "metadata": json.dumps(artifact.metadata),
                },
            )
            for artifact, vector in zip(artifacts, vectors)
        ]
        self._client.upsert(collection_name=KNOWLEDGE_COLLECTION, points=points)
        logger.debug("Batch upserted %d knowledge points into Qdrant.", len(points))

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def search_knowledge(
        self,
        tenant_id: UUID,
        vector: list[float],
        *,
        limit: int = 5,
        similarity_threshold: float = 0.70,
    ) -> list[tuple[KnowledgeArtifact, float]]:
        """Return up to *limit* knowledge artefacts whose cosine similarity to
        *vector* exceeds *similarity_threshold*, filtered to *tenant_id*.

        Returns a list of ``(KnowledgeArtifact, score)`` tuples ordered by
        descending similarity score.
        """
        from qdrant_client.models import Filter, FieldCondition, MatchValue  # type: ignore[import-untyped]

        tenant_filter = Filter(
            must=[FieldCondition(key="tenant_id", match=MatchValue(value=str(tenant_id)))]
        )

        response = self._client.query_points(
            collection_name=KNOWLEDGE_COLLECTION,
            query=vector,
            limit=limit,
            query_filter=tenant_filter,
            with_payload=True,
            score_threshold=similarity_threshold,
        )

        candidates: list[tuple[KnowledgeArtifact, float]] = []
        for hit in response.points:
            try:
                artifact = _payload_to_artifact(hit.payload)  # type: ignore[arg-type]
                candidates.append((artifact, float(hit.score)))
            except Exception:
                logger.warning(
                    "Skipping malformed Qdrant payload for point id=%s", hit.id, exc_info=True
                )
        return candidates


    def count(self) -> int:
        """Return total number of indexed points."""
        info = self._client.get_collection(KNOWLEDGE_COLLECTION)
        return info.points_count or 0


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _uuid_to_int(uid: UUID) -> int:
    """Convert a UUID to a non-negative 64-bit integer for Qdrant point IDs."""
    return uid.int % (2**63)


def _payload_to_artifact(payload: dict[str, Any]) -> KnowledgeArtifact:
    """Reconstruct a KnowledgeArtifact from a Qdrant point payload."""
    return KnowledgeArtifact(
        knowledge_id=UUID(payload["knowledge_id"]),
        tenant_id=UUID(payload["tenant_id"]),
        kind=KnowledgeKind(payload["kind"]),
        title=payload["title"],
        body=payload["body"],
        concepts=payload.get("concepts", []),
        provenance=payload["provenance"],
        confidence=float(payload.get("confidence", 0.0)),
        lifecycle_state=ArtifactLifecycleState.PERSISTED,
        metadata=json.loads(payload.get("metadata", "{}")),
    )


# ---------------------------------------------------------------------------
# Factory helpers
# ---------------------------------------------------------------------------


def build_qdrant_client(
    mode: str | None = None,
    url: str | None = None,
    api_key: str | None = None,
    disk_path: str | None = None,
) -> Any:
    """Build and return a QdrantClient in the requested mode.

    Modes:
        memory  — in-process; data lost on restart (default for tests).
        disk    — persists to *disk_path* (default: ``./data/qdrant``).
        remote  — connects to *url* with optional *api_key*.
    """
    from qdrant_client import QdrantClient  # type: ignore[import-untyped]

    resolved_mode = mode or os.getenv("CEB_QDRANT_MODE", "memory").lower()

    if resolved_mode == "memory":
        return QdrantClient(location=":memory:")

    if resolved_mode == "disk":
        path = disk_path or os.getenv("CEB_QDRANT_DISK_PATH", "./data/qdrant")
        os.makedirs(path, exist_ok=True)
        return QdrantClient(path=path)

    if resolved_mode == "remote":
        remote_url = url or os.getenv("CEB_QDRANT_URL", "http://localhost:6333")
        remote_key = api_key or os.getenv("CEB_QDRANT_API_KEY")
        return QdrantClient(url=remote_url, api_key=remote_key)

    raise ValueError(f"unsupported CEB_QDRANT_MODE: {resolved_mode!r}")
