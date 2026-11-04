"""Embedding client protocol and implementations for the RAG knowledge pipeline.

Clients:
  - MockEmbeddingClient  — deterministic, no external dependencies (default for tests/local).
  - OpenAIEmbeddingClient — uses text-embedding-3-small (1536-dims); requires OPENAI_API_KEY.

The active client is selected by ``CEB_EMBEDDING_CLIENT`` (mock|openai).
"""

from __future__ import annotations

import hashlib
import logging
import math
import os
from typing import Protocol, runtime_checkable

logger = logging.getLogger(__name__)

EMBEDDING_DIM = 1536  # text-embedding-3-small dimension


@runtime_checkable
class EmbeddingClient(Protocol):
    """Protocol for a text embedding client."""

    def embed(self, text: str) -> list[float]:
        """Return a normalised embedding vector for *text*."""
        ...

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Return normalised embedding vectors for each element in *texts*."""
        ...


class MockEmbeddingClient:
    """Deterministic mock embedding client.

    Produces 1536-dimensional float vectors derived purely from the SHA-256 hash
    and character-level statistics of the input text.  No external calls are made.
    The output is always the same for the same input, making tests reproducible.
    """

    def embed(self, text: str) -> list[float]:
        return _deterministic_vector(text, dim=EMBEDDING_DIM)

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        return [self.embed(t) for t in texts]


class OpenAIEmbeddingClient:
    """Production embedding client backed by OpenAI's text-embedding-3-small model.

    Requires:
        - ``openai`` package installed (``pip install openai``).
        - ``OPENAI_API_KEY`` environment variable set.
    """

    def __init__(
        self,
        model: str = "text-embedding-3-small",
        api_key: str | None = None,
    ) -> None:
        try:
            import openai  # type: ignore[import-untyped]
        except ImportError as exc:
            raise ImportError(
                "The 'openai' package is required for OpenAIEmbeddingClient. "
                "Install it with: pip install openai"
            ) from exc

        self._client = openai.OpenAI(api_key=api_key or os.environ.get("OPENAI_API_KEY"))
        self._model = model

    def embed(self, text: str) -> list[float]:
        response = self._client.embeddings.create(input=[text], model=self._model)
        vector = response.data[0].embedding
        return _normalise(vector)

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        response = self._client.embeddings.create(input=texts, model=self._model)
        # Sort by index to preserve input order
        items = sorted(response.data, key=lambda item: item.index)
        return [_normalise(item.embedding) for item in items]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _deterministic_vector(text: str, dim: int = EMBEDDING_DIM) -> list[float]:
    """Produce a deterministic unit vector in *dim* dimensions from *text*.

    Strategy:
    1. Compute SHA-256 of the UTF-8 encoded text to seed a 256-bit value.
    2. Expand the seed into *dim* floats by cycling through 8-byte chunks
       of repeated hash concatenations.
    3. Normalise to unit length.
    """
    raw = text.encode("utf-8")
    seed_hash = hashlib.sha256(raw).digest()

    # Expand seed until we have enough bytes for *dim* floats (8 bytes each)
    needed_bytes = dim * 8
    expanded = bytearray()
    counter = 0
    while len(expanded) < needed_bytes:
        block = hashlib.sha256(seed_hash + counter.to_bytes(4, "big")).digest()
        expanded.extend(block)
        counter += 1

    floats: list[float] = []
    for i in range(dim):
        chunk = expanded[i * 8 : i * 8 + 8]
        # Interpret 8 bytes as an unsigned 64-bit int and map to [-1, 1]
        value = int.from_bytes(chunk, "big")
        floats.append((value / (2**63)) - 1.0)

    return _normalise(floats)


def _normalise(vector: list[float]) -> list[float]:
    """Return the L2-normalised version of *vector*."""
    magnitude = math.sqrt(sum(v * v for v in vector))
    if magnitude == 0.0:
        return vector
    return [v / magnitude for v in vector]


def get_embedding_client() -> EmbeddingClient:
    """Return the configured embedding client based on ``CEB_EMBEDDING_CLIENT``."""
    backend = os.getenv("CEB_EMBEDDING_CLIENT", "mock").lower()
    if backend == "mock":
        return MockEmbeddingClient()
    if backend == "openai":
        return OpenAIEmbeddingClient()
    raise ValueError(f"unsupported CEB_EMBEDDING_CLIENT: {backend!r}")
