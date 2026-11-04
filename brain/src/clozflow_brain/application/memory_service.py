"""Goal-directed cognitive memory activation."""

from __future__ import annotations

import re

from clozflow_brain.contracts.context import CognitiveContext
from clozflow_brain.contracts.memory import ActivatedMemory, MemoryRecord, WorkingMemory
from clozflow_brain.infrastructure.cognitive_repositories import MemoryRepository


def _tokens(text: str) -> set[str]:
    return {token.lower() for token in re.findall(r"[a-zA-Z0-9_]+", text) if len(token) > 2}


class MemoryService:
    def __init__(self, repository: MemoryRepository) -> None:
        self._repository = repository

    def store(self, memory: MemoryRecord) -> MemoryRecord:
        return self._repository.save_memory(memory)

    def list_for_tenant(self, tenant_id) -> list[MemoryRecord]:
        return self._repository.list_memories(tenant_id)

    def list_for_session(self, tenant_id, session_id) -> list[MemoryRecord]:
        """Return memories associated with a specific session.

        Falls back to filtering list_for_tenant if the repository does not
        expose a session-level query method.
        """
        list_session = getattr(self._repository, "list_memories_for_session", None)
        if list_session is not None:
            return list_session(tenant_id, session_id)
        return [
            m for m in self._repository.list_memories(tenant_id)
            if str(session_id) in str(m.content)
        ]

    def get(self, tenant_id, memory_id) -> MemoryRecord:
        return self._repository.get_memory(tenant_id, memory_id)

    def get_many(self, tenant_id, memory_ids) -> list[MemoryRecord]:
        return [self._repository.get_memory(tenant_id, memory_id) for memory_id in memory_ids]

    def activate_for_context(self, context: CognitiveContext, *, limit: int = 5, half_life_days: int = 90) -> WorkingMemory:
        context_terms = self._context_terms(context)
        scored: list[tuple[float, MemoryRecord, str]] = []
        for memory in self._repository.list_memories(context.tenant_id):
            if memory.lifecycle_state.value in {"ARCHIVED", "DELETED", "DEPRECATED", "REJECTED", "RETIRED"}:
                continue
            if memory.scope.value == "SESSION" and memory.content.get("session_id") != str(context.session_id):
                continue
            memory_terms = set(memory.concepts)
            memory_terms.update(_tokens(str(memory.content)))
            overlap = context_terms.intersection({term.lower() for term in memory_terms})
            if not overlap:
                continue
            from clozflow_brain.contracts.common import utc_now
            age_days = max(0, (utc_now() - memory.updated_at_utc).total_seconds() / 86400)
            decay = 0.5 ** (age_days / half_life_days)
            relevance = min(1.0, ((len(overlap) / max(len(context_terms), 1)) + (memory.confidence * 0.35)) * decay)
            scored.append((relevance, memory, f"concept overlap: {', '.join(sorted(overlap))}"))

        scored.sort(key=lambda item: item[0], reverse=True)
        active_ids = []
        for relevance, memory, reason in scored[:limit]:
            activation = ActivatedMemory(
                tenant_id=context.tenant_id,
                session_id=context.session_id,
                context_id=context.context_id,
                memory_id=memory.memory_id,
                relevance=relevance,
                activation_reason=reason,
            )
            self._repository.record_activation(activation)
            active_ids.append(memory.memory_id)
        return WorkingMemory(
            tenant_id=context.tenant_id,
            session_id=context.session_id,
            context_id=context.context_id,
            active_memory_ids=active_ids,
            temporary_state={"activation_count": len(active_ids)},
        )

    def _context_terms(self, context: CognitiveContext) -> set[str]:
        terms: set[str] = set()
        for fragment in context.fragments:
            terms.update(_tokens(str(fragment.content)))
        return terms

    def concepts_for_context(self, context: CognitiveContext) -> list[str]:
        return sorted(self._context_terms(context))
