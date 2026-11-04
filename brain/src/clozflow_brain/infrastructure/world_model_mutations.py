"""Shared World Model mutation application logic."""

from __future__ import annotations

from time import perf_counter
from uuid import UUID

from clozflow_brain.contracts.common import utc_now
from clozflow_brain.contracts.recommendations import Recommendation
from clozflow_brain.contracts.world_model import (
    BeliefNode,
    ConversationPhase,
    GoalNode,
    KnowledgeRef,
    MemoryRef,
    ObjectionNode,
    ObjectionStatus,
    WorldModel,
    WorldModelMutation,
    WorldModelMutationType,
)


def apply_world_model_mutation(world_model: WorldModel, mutation: WorldModelMutation) -> None:
    """Apply one already-authorized mutation to a World Model in memory."""

    payload = mutation.payload
    if mutation.mutation_type == WorldModelMutationType.RECORD_EVENTS:
        world_model.processed_event_ids = list(dict.fromkeys(world_model.processed_event_ids + [UUID(x) for x in payload["event_ids"]]))[-4096:]
        return
    if mutation.mutation_type == WorldModelMutationType.UPSERT_BELIEF:
        belief = BeliefNode.model_validate(payload)
        world_model.crm_beliefs = [
            existing for existing in world_model.crm_beliefs if existing.belief_id != belief.belief_id
            and (existing.belief_type, existing.subject) != (belief.belief_type, belief.subject)
        ]
        world_model.crm_beliefs.append(belief)
        return
    if mutation.mutation_type == WorldModelMutationType.RETRACT_BELIEF:
        belief_id = UUID(str(payload["belief_id"]))
        for index, belief in enumerate(world_model.crm_beliefs):
            if belief.belief_id == belief_id:
                world_model.crm_beliefs[index] = belief.model_copy(
                    update={"retracted_at_utc": utc_now(), "updated_at_utc": utc_now()}
                )
                return
        return
    if mutation.mutation_type == WorldModelMutationType.ADD_OBJECTION:
        objection = ObjectionNode.model_validate(payload)
        world_model.active_objections = [o for o in world_model.active_objections if o.objection_id != objection.objection_id]
        world_model.active_objections.append(objection)
        return
    if mutation.mutation_type == WorldModelMutationType.RESOLVE_OBJECTION:
        objection_id = UUID(str(payload["objection_id"]))
        for index, objection in enumerate(world_model.active_objections):
            if objection.objection_id == objection_id:
                world_model.active_objections[index] = objection.model_copy(
                    update={"status": ObjectionStatus.RESOLVED, "updated_at_utc": utc_now()}
                )
                return
        return
    if mutation.mutation_type == WorldModelMutationType.UPDATE_PHASE:
        world_model.conversation_state.phase = ConversationPhase(str(payload["phase"]))
        return
    if mutation.mutation_type == WorldModelMutationType.PUSH_RECOMMENDATION:
        rec = Recommendation.model_validate(payload)
        world_model.pending_recommendations = [r for r in world_model.pending_recommendations if r.rec_id != rec.rec_id and r.content.body != rec.content.body][-4:]
        world_model.pending_recommendations.append(rec)
        return
    if mutation.mutation_type == WorldModelMutationType.ADD_MEMORY_REF:
        memory_ref = MemoryRef.model_validate(payload)
        world_model.memory_refs = [
            existing for existing in world_model.memory_refs if existing.memory_id != memory_ref.memory_id
        ]
        world_model.memory_refs.append(memory_ref)
        return
    if mutation.mutation_type == WorldModelMutationType.ADD_KNOWLEDGE_REF:
        ref = KnowledgeRef.model_validate(payload)
        world_model.knowledge_refs = [r for r in world_model.knowledge_refs if (r.source, r.title) != (ref.source, ref.title)][-19:]
        world_model.knowledge_refs.append(ref)
        return
    if mutation.mutation_type == WorldModelMutationType.SET_GOAL:
        goal = GoalNode.model_validate(payload)
        world_model.active_goals = [
            existing.model_copy(update={"active": False}) for existing in world_model.active_goals[-19:] if existing.goal_id != goal.goal_id
        ]
        world_model.active_goals.append(goal)
        return
    if mutation.mutation_type == WorldModelMutationType.APPEND_CONTEXT:
        text = str(payload["text"])
        world_model.context_window.append(text)
        world_model.context_window = world_model.context_window[-50:]
        world_model.conversation_state.turn_count += 1
        return
    raise ValueError(f"unsupported mutation type: {mutation.mutation_type}")


def apply_world_model_mutations(
    current: WorldModel,
    mutations: list[WorldModelMutation],
) -> WorldModel:
    """Return a new World Model with a validated atomic mutation batch applied."""

    if not mutations:
        return current.model_copy(deep=True)
    started = perf_counter()
    status = "success"
    next_model = current.model_copy(deep=True)
    try:
        for mutation in mutations:
            if mutation.session_id != current.session_id:
                raise PermissionError("world model mutation session mismatch")
            if mutation.tenant_id != current.tenant_id:
                raise PermissionError("world model mutation rejected due to tenant mismatch")
            apply_world_model_mutation(next_model, mutation)
        next_model.version += 1
        next_model.updated_at_utc = utc_now()
        return next_model
    except Exception:
        status = "error"
        raise
    finally:
        # Lazy import avoids a circular dependency: kernel.__init__ imports the
        # kernel module, which imports the repositories, which import this
        # module. Resolving telemetry at call time keeps import order clean.
        from clozflow_brain.kernel.observability import TelemetrySignal, get_global_telemetry

        duration_ms = (perf_counter() - started) * 1000.0
        labels = {
            "mutation_type": mutations[0].mutation_type.value if mutations else "none",
            "status": status,
        }
        get_global_telemetry().observe(
            TelemetrySignal.BRAIN_WM_MUTATION_APPLY_MS, duration_ms, labels
        )
