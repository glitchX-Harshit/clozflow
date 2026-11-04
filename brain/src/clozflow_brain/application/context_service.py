"""Runtime context construction and validation."""

from __future__ import annotations

from clozflow_brain.contracts.context import (
    CognitiveContext,
    ContextFragment,
    ContextLayer,
    ContextQuality,
    ContextSourceType,
)
from clozflow_brain.contracts.events import CognitiveEvent, EventType
from clozflow_brain.contracts.knowledge import KnowledgePackage
from clozflow_brain.contracts.memory import MemoryRecord, WorkingMemory
from clozflow_brain.contracts.persistence import ArtifactType, CognitiveArtifact
from clozflow_brain.contracts.world_model import WorldModel
from clozflow_brain.infrastructure.cognitive_repositories import ContextRepository
from clozflow_brain.application.persistence_service import PersistenceService


class ContextService:
    def __init__(
        self,
        *,
        repository: ContextRepository,
        persistence: PersistenceService | None = None,
    ) -> None:
        self._repository = repository
        self._persistence = persistence

    def construct(self, *, events: list[CognitiveEvent], world_model: WorldModel,
                  session_metadata: dict | None = None) -> CognitiveContext:
        fragments = self._event_fragments(events)
        fragments.extend(self._world_model_fragments(world_model))
        if session_metadata and any(session_metadata.get(key) for key in ("call_context", "crm", "organization")):
            fragments.append(ContextFragment(
                source_type=ContextSourceType.BUSINESS_STATE,
                source_id=f"session:{world_model.session_id}", layer=ContextLayer.BUSINESS_CONTEXT,
                content={key: session_metadata[key] for key in ("call_context", "crm", "organization") if session_metadata.get(key)},
                relevance=1.0, confidence=1.0,
            ))
        quality = self._evaluate_quality(fragments)
        context = CognitiveContext(
            tenant_id=world_model.tenant_id,
            session_id=world_model.session_id,
            fragments=fragments,
            quality=quality,
        )
        return self._persist_context(context, provenance_event_ids=[event.event_id for event in events])

    def latest_for_session(self, session_id):
        return self._repository.latest_for_session(session_id)

    def enrich_with_working_memory(
        self,
        context: CognitiveContext,
        working_memory: WorkingMemory,
        memory_records: list[MemoryRecord],
    ) -> CognitiveContext:
        fragments = list(context.fragments)
        for memory in memory_records:
            fragments.append(
                ContextFragment(
                    source_type=ContextSourceType.MEMORY,
                    source_id=str(memory.memory_id),
                    layer=ContextLayer.COGNITIVE_CONTEXT,
                    content={
                        "memory_type": memory.memory_type.value,
                        "subject": memory.subject,
                        "content": memory.content,
                        "concepts": memory.concepts,
                    },
                    relevance=0.85,
                    confidence=memory.confidence,
                    provenance_event_ids=memory.provenance_event_ids,
                )
            )
        enriched = context.model_copy(
            update={
                "version": context.version + 1,
                "fragments": fragments,
                "active_memory_ids": working_memory.active_memory_ids,
                "quality": self._evaluate_quality(fragments),
            }
        )
        return self._persist_context(enriched, provenance_event_ids=[])

    def enrich_with_knowledge(
        self,
        context: CognitiveContext,
        package: KnowledgePackage,
    ) -> CognitiveContext:
        fragments = list(context.fragments)
        knowledge_ids = []
        for candidate in package.candidates:
            knowledge = candidate.knowledge
            knowledge_ids.append(knowledge.knowledge_id)
            fragments.append(
                ContextFragment(
                    source_type=ContextSourceType.KNOWLEDGE,
                    source_id=str(knowledge.knowledge_id),
                    layer=ContextLayer.COGNITIVE_CONTEXT,
                    content={
                        "kind": knowledge.kind.value,
                        "title": knowledge.title,
                        "body": knowledge.body,
                        "concepts": knowledge.concepts,
                        "provenance": knowledge.provenance,
                        "rationale": candidate.rationale,
                    },
                    relevance=candidate.relevance,
                    confidence=knowledge.confidence,
                )
            )
        enriched = context.model_copy(
            update={
                "version": context.version + 1,
                "fragments": fragments,
                "knowledge_ref_ids": knowledge_ids,
                "quality": self._evaluate_quality(fragments),
            }
        )
        return self._persist_context(enriched, provenance_event_ids=[])

    def _persist_context(
        self,
        context: CognitiveContext,
        *,
        provenance_event_ids,
    ) -> CognitiveContext:
        saved = self._repository.save(context)
        if self._persistence is not None:
            artifact = CognitiveArtifact(
                tenant_id=saved.tenant_id,
                artifact_type=ArtifactType.CONTEXT,
                owner="context-service",
                namespace=f"sessions/{saved.session_id}/contexts",
                semantic_type="runtime_context",
                confidence=saved.quality.confidence,
                payload=saved.model_dump(mode="json"),
                provenance_event_ids=provenance_event_ids,
            )
            self._persistence.register_artifact(artifact)
        return saved

    def _event_fragments(self, events: list[CognitiveEvent]) -> list[ContextFragment]:
        fragments: list[ContextFragment] = []
        for event in events:
            content = {"event_type": event.event_type.value, "payload": event.payload}
            if event.event_type == EventType.TRANSCRIPT_SEGMENT:
                layer = ContextLayer.SEMANTIC_CONTEXT
            else:
                layer = ContextLayer.ENTERPRISE_DATA
            fragments.append(
                ContextFragment(
                    source_type=ContextSourceType.EVENT,
                    source_id=str(event.event_id),
                    layer=layer,
                    content=content,
                    relevance=0.9,
                    confidence=event.confidence,
                    provenance_event_ids=[event.event_id],
                )
            )
        return fragments

    def _world_model_fragments(self, world_model: WorldModel) -> list[ContextFragment]:
        fragments: list[ContextFragment] = []
        fragments.append(
            ContextFragment(
                source_type=ContextSourceType.WORLD_MODEL,
                source_id=str(world_model.wm_id),
                layer=ContextLayer.BUSINESS_CONTEXT,
                content={
                    "phase": world_model.conversation_state.phase.value,
                    "turn_count": world_model.conversation_state.turn_count,
                    "buyer": world_model.buyer.model_dump(mode="json"),
                },
                relevance=0.8,
                confidence=1.0,
            )
        )
        for belief in world_model.crm_beliefs:
            fragments.append(
                ContextFragment(
                    source_type=ContextSourceType.WORLD_MODEL,
                    source_id=str(belief.belief_id),
                    layer=ContextLayer.COGNITIVE_CONTEXT,
                    content=belief.model_dump(mode="json"),
                    relevance=0.75,
                    confidence=belief.confidence,
                    provenance_event_ids=belief.evidence_ids,
                )
            )
        return fragments

    def _evaluate_quality(self, fragments: list[ContextFragment]) -> ContextQuality:
        if not fragments:
            return ContextQuality(
                completeness=0.0,
                freshness=0.0,
                consistency=0.0,
                provenance=0.0,
                confidence=0.0,
                relevance=0.0,
                ready_for_reasoning=False,
            )
        confidence = sum(fragment.confidence for fragment in fragments) / len(fragments)
        relevance = sum(fragment.relevance for fragment in fragments) / len(fragments)
        provenance = sum(1 for fragment in fragments if fragment.provenance_event_ids) / len(fragments)
        has_event = any(fragment.source_type == ContextSourceType.EVENT for fragment in fragments)
        has_world_model = any(fragment.source_type == ContextSourceType.WORLD_MODEL for fragment in fragments)
        completeness = (0.5 if has_event else 0.0) + (0.5 if has_world_model else 0.0)
        ready = completeness >= 0.75 and confidence >= 0.5 and relevance >= 0.5
        return ContextQuality(
            completeness=completeness,
            freshness=1.0,
            consistency=1.0,
            provenance=provenance,
            confidence=confidence,
            relevance=relevance,
            ready_for_reasoning=ready,
        )
