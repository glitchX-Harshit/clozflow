"""Cognitive Kernel coordination layer."""

from __future__ import annotations

from contextlib import nullcontext
from dataclasses import dataclass
from threading import RLock
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from clozflow_brain.contracts.engines import EngineExecutionOutput, EngineStatus
from clozflow_brain.contracts.context import CognitiveContext
from clozflow_brain.contracts.events import CognitiveEvent, EventType
from clozflow_brain.contracts.world_model import (
    KnowledgeRef,
    MemoryRef,
    WorldModel,
    WorldModelMutation,
    WorldModelMutationType,
)
from clozflow_brain.application.context_service import ContextService
from clozflow_brain.application.knowledge_service import KnowledgeService
from clozflow_brain.application.memory_service import MemoryService
from clozflow_brain.infrastructure.repositories import SessionRepository, WorldModelRepository
from clozflow_brain.kernel.buses import EventBus, InMemoryEventBus
from clozflow_brain.kernel.observability import (
    ExecutionTrace,
    InMemoryTelemetry,
    Telemetry,
    TelemetrySignal,
    set_global_telemetry,
)
from clozflow_brain.kernel.registry import EngineRegistry
from clozflow_brain.kernel.scheduler import CognitiveScheduler
from clozflow_brain.kernel.security import assert_same_tenant

if TYPE_CHECKING:
    from clozflow_brain.application.runtime_service import RuntimeService
    from clozflow_brain.infrastructure.repositories import WorldModelCheckpointRepository


@dataclass(frozen=True)
class CognitiveCycleResult:
    cycle_id: UUID
    accepted_events: list[CognitiveEvent]
    engine_outputs: list[EngineExecutionOutput]
    applied_mutations: list[WorldModelMutation]
    world_model: WorldModel
    cognitive_context: CognitiveContext | None
    trace: ExecutionTrace


class CognitiveKernel:
    """Permanent supervisory core coordinating cognition without doing domain reasoning."""

    def __init__(
        self,
        *,
        event_bus: EventBus | None = None,
        engine_registry: EngineRegistry | None = None,
        scheduler: CognitiveScheduler | None = None,
        session_repository: SessionRepository,
        world_model_repository: WorldModelRepository,
        context_service: ContextService | None = None,
        memory_service: MemoryService | None = None,
        knowledge_service: KnowledgeService | None = None,
        telemetry: Telemetry | None = None,
    ) -> None:
        self._cycle_locks = [RLock() for _ in range(128)]
        self.event_bus = event_bus or InMemoryEventBus()
        self.engine_registry = engine_registry or EngineRegistry()
        self.telemetry = telemetry or InMemoryTelemetry()
        # Publish the active sink globally so infrastructure adapters (LLM
        # client, World Model mutation applier, WebSocket delivery layer) that
        # cannot receive it via construction still reach the same sink.
        set_global_telemetry(self.telemetry)
        self.scheduler = scheduler or CognitiveScheduler(self.engine_registry, self.telemetry)
        self.session_repository = session_repository
        self.world_model_repository = world_model_repository
        self.context_service = context_service
        self.memory_service = memory_service
        self.knowledge_service = knowledge_service
        self.runtime: RuntimeService | None = None
        self.checkpoint_repository: WorldModelCheckpointRepository | None = None
        self._profile_schedulers = {}

    def scheduler_for(self, profile):
        if profile not in {"full", "compact"}:
            return self.scheduler
        with self._cycle_locks[0]:
            if profile not in self._profile_schedulers:
                registry = EngineRegistry()
                registry.load_from_yaml("configs/engines.yaml" if profile == "full" else "configs/engines.local.yaml")
                self._profile_schedulers[profile] = CognitiveScheduler(registry, self.telemetry)
            return self._profile_schedulers[profile]

    def close(self):
        self.scheduler.close()
        for scheduler in self._profile_schedulers.values():
            scheduler.close()

    def accept_event(self, event: CognitiveEvent, *, execute: bool = True) -> CognitiveCycleResult | None:
        """Validate session ownership, publish the event, and optionally execute a cycle."""

        self.validate_event(event)
        if self.runtime:
            self.runtime.store.accept([event])
        self.event_bus.publish(event)
        self.telemetry.increment(
            TelemetrySignal.BRAIN_EVENTS_TOTAL,
            {"event_type": event.event_type.value, "session_id": str(event.session_id),
             "tenant_id": str(event.tenant_id), "status": "accepted"},
        )
        if not execute:
            return None
        return self.execute_cycle([event])

    def validate_event(self, event):
        session = self.session_repository.get(event.session_id)
        assert_same_tenant(session.tenant_id, event.tenant_id)
        reflection_retry = event.event_type == EventType.SESSION_END and event.source == 'session-reflection-retry' and session.status.value == 'TERMINATED'
        if session.status.value != "ACTIVE" and not reflection_retry and not (event.event_type == EventType.SESSION_END and session.status.value == "SUSPENDED"):
            raise RuntimeError(f"session is not ACTIVE: {session.session_id}")
        if event.event_type in {EventType.TRANSCRIPT_SEGMENT, EventType.SILENCE_DETECTED}:
            from clozflow_brain.contracts.common import utc_now
            age_ms = (utc_now() - event.timestamp_utc).total_seconds() * 1000
            if (age_ms > event.ttl_ms + 1000 or age_ms < -30000) and event.event_id not in self.world_model_repository.get(event.session_id).processed_event_ids:
                raise ValueError("Event expired or timestamp is in the future")

    def recover_pending(self):
        if not self.runtime:
            return
        for event in self.runtime.store.pending():
            try:
                world = self.world_model_repository.get(event.session_id)
                if event.event_id in world.processed_event_ids:
                    if event.event_type == EventType.SESSION_END:
                        from clozflow_brain.contracts.sessions import SessionStatus
                        from clozflow_brain.contracts.common import utc_now
                        session = self.session_repository.get(event.session_id)
                        self.session_repository.save(session.model_copy(update={
                            "status": SessionStatus.TERMINATED, "updated_at_utc": utc_now(),
                            "metadata": {**session.metadata, 'reflection_status': 'complete' if any(
                                belief.belief_type == 'SESSION_SUMMARY' for belief in world.crm_beliefs) else 'failed'}}))
                    self.runtime.store.mark([event.event_id], "complete")
                    self.runtime.audit(event.tenant_id, "event.recovered_after_commit",
                                       {"event_id": str(event.event_id)}, session_id=event.session_id)
                    continue
                self.accept_event(event)
            except (KeyError, ValueError, RuntimeError, PermissionError):
                self.runtime.store.mark([event.event_id], "expired")

    def execute_cycle(self, events: list[CognitiveEvent]) -> CognitiveCycleResult:
        if not events:
            raise ValueError("Empty cycle")
        with self._cycle_locks[events[0].session_id.int % len(self._cycle_locks)]:
            remote_lock = getattr(self.world_model_repository, "session_lock", None)
            with remote_lock(events[0].session_id) if remote_lock else nullcontext():
                return self._execute_cycle(events)

    def _execute_cycle(self, events: list[CognitiveEvent]) -> CognitiveCycleResult:
        if not events:
            raise ValueError("a Cognitive Execution Cycle requires at least one event")
        session_id = events[0].session_id
        tenant_id = events[0].tenant_id
        for event in events:
            if event.session_id != session_id:
                raise ValueError("all events in a cycle must belong to one session")
            if event.tenant_id != tenant_id:
                raise PermissionError("cross-tenant event batch rejected")
        cycle_id = uuid4()
        world_model = self.world_model_repository.get(session_id)
        assert_same_tenant(world_model.tenant_id, tenant_id)
        seen = set(world_model.processed_event_ids)
        unique_events = []
        for event in events:
            if event.event_id not in seen:
                unique_events.append(event)
                seen.add(event.event_id)
        events = unique_events
        if not events:
            trace = ExecutionTrace(cycle_id=cycle_id, triggering_event_ids=[])
            return CognitiveCycleResult(cycle_id, [], [], [], world_model, None, trace)
        cognitive_context = None
        pre_engine_mutations: list[WorldModelMutation] = []
        if self.context_service is not None:
            cognitive_context = self.context_service.construct(
                events=events, world_model=world_model,
                session_metadata=self.session_repository.get(session_id).metadata,
            )
            if self.memory_service is not None:
                working_memory = self.memory_service.activate_for_context(cognitive_context,
                    half_life_days=self.runtime.policy(tenant_id).memory_half_life_days if self.runtime else 90)
                memory_records = self.memory_service.get_many(
                    tenant_id,
                    working_memory.active_memory_ids,
                )
                cognitive_context = self.context_service.enrich_with_working_memory(
                    cognitive_context,
                    working_memory,
                    memory_records,
                )
                for memory in memory_records:
                    ref = MemoryRef(
                        memory_id=memory.memory_id,
                        memory_type=memory.memory_type.value,
                        subject=memory.subject,
                        relevance=0.85,
                        confidence=memory.confidence,
                        metadata={
                            "scope": memory.scope.value,
                            "concepts": memory.concepts,
                        },
                    )
                    pre_engine_mutations.append(
                        WorldModelMutation(
                            mutation_type=WorldModelMutationType.ADD_MEMORY_REF,
                            session_id=session_id,
                            tenant_id=tenant_id,
                            payload=ref.model_dump(mode="json"),
                        )
                    )
            if self.knowledge_service is not None:
                package = self.knowledge_service.discover_for_context(cognitive_context)
                cognitive_context = self.context_service.enrich_with_knowledge(
                    cognitive_context,
                    package,
                )
                # Iterate over candidates and create KnowledgeRefs
                for candidate in package.candidates:
                    knowledge = candidate.knowledge
                    k_ref = KnowledgeRef(
                        source=knowledge.provenance,
                        title=knowledge.title,
                        relevance=candidate.relevance,
                        metadata={
                            "knowledge_id": str(knowledge.knowledge_id),
                            "kind": knowledge.kind.value,
                            "confidence": knowledge.confidence,
                            "package_id": str(package.package_id),
                        },
                    )
                    pre_engine_mutations.append(
                        WorldModelMutation(
                            mutation_type=WorldModelMutationType.ADD_KNOWLEDGE_REF,
                            session_id=session_id,
                            tenant_id=tenant_id,
                            payload=k_ref.model_dump(mode="json"),
                        )
                    )
            if pre_engine_mutations:
                world_model = self.world_model_repository.apply_mutations(
                    session_id,
                    pre_engine_mutations,
                )

        session = self.session_repository.get(session_id)
        scheduler = self.scheduler_for(session.metadata.get("reasoning_profile"))
        engine_outputs = scheduler.execute(
            cycle_id=cycle_id,
            events=events,
            world_model=world_model,
            cognitive_context=cognitive_context,
            policy=self.runtime.policy(tenant_id) if self.runtime else None,
        )
        if self.runtime:
            self.runtime.gate_recommendations(engine_outputs, cognitive_context, tenant_id)
        output_events: list[CognitiveEvent] = []
        mutations: list[WorldModelMutation] = list(pre_engine_mutations)
        error_count = 0
        for output in engine_outputs:
            if output.status in {EngineStatus.ERROR, EngineStatus.TIMEOUT}:
                error_count += 1
            output_events.extend(output.output_events)
            mutations.extend(output.wm_mutations)

            # Emit ENGINE_TELEMETRY for dashboard
            import os

            telemetry_event = CognitiveEvent(
                event_id=uuid4(),
                event_type=EventType.ENGINE_TELEMETRY,
                session_id=session_id,
                tenant_id=tenant_id,
                sequence_num=0,
                source="kernel_telemetry",
                priority=1,
                ttl_ms=1000,
                payload=output.model_dump(mode="json"),
                confidence=1.0,
            )
            self.event_bus.publish(telemetry_event)

            # Broadcast to UI websockets via PubSub
            backend = os.getenv("CEB_WORLD_MODEL_REPOSITORY", "memory").lower()
            if backend in {"redis", "redis_json"}:
                import redis
                redis_url = os.getenv("CEB_REDIS_URL", "redis://:local-dev-only@localhost:6379/0")
                try:
                    redis_client = redis.Redis.from_url(redis_url)
                    redis_client.publish(f"clozflow:telemetry:updates:{session_id}", telemetry_event.model_dump_json())
                    redis_client.publish("clozflow:telemetry:updates:global", telemetry_event.model_dump_json())
                    redis_client.close()
                except Exception:
                    pass
            else:
                from clozflow_brain.infrastructure.pubsub import get_in_memory_pubsub
                get_in_memory_pubsub().publish(f"clozflow:telemetry:updates:{session_id}", telemetry_event.model_dump_json())
                get_in_memory_pubsub().publish("clozflow:telemetry:updates:global", telemetry_event.model_dump_json())

        engine_mutations = mutations[len(pre_engine_mutations):]
        engine_mutations.append(WorldModelMutation(
            mutation_type=WorldModelMutationType.RECORD_EVENTS,
            session_id=session_id, tenant_id=tenant_id,
            payload={"event_ids": [str(event.event_id) for event in events]},
        ))
        updated_world_model = self.world_model_repository.apply_mutations(session_id, engine_mutations)
        if self.memory_service is not None:
            from clozflow_brain.application.learning_service import consolidate_reflection
            consolidate_reflection(self.memory_service, updated_world_model, engine_outputs)
        for output_event in output_events:
            self.event_bus.publish(output_event)
            self.telemetry.increment(
                TelemetrySignal.BRAIN_EVENTS_TOTAL,
                {
                    "event_type": output_event.event_type.value,
                    "session_id": str(output_event.session_id),
                    "tenant_id": str(output_event.tenant_id),
                    "status": "produced",
                },
            )
        self.telemetry.observe(
            TelemetrySignal.BRAIN_WORLD_MODEL_BELIEF_COUNT,
            len(updated_world_model.crm_beliefs),
            {"session_id": str(session_id), "belief_type": "all"},
        )
        trace = ExecutionTrace(
            cycle_id=cycle_id,
            triggering_event_ids=[event.event_id for event in events],
            engine_ids=[output.engine_id for output in engine_outputs],
            cdc_phases=[scheduler._registry.get(output.engine_id).registration.engine_type.value for output in engine_outputs],
            error_count=error_count,
            mutation_count=len(mutations),
        )
        result = CognitiveCycleResult(
            cycle_id=cycle_id,
            accepted_events=events,
            engine_outputs=engine_outputs,
            applied_mutations=mutations,
            world_model=updated_world_model,
            cognitive_context=cognitive_context,
            trace=trace,
        )
        if self.runtime:
            self.runtime.record_cycle(result, self.session_repository.get(session_id))
        return result
