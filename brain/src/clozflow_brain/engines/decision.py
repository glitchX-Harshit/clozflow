"""Decision Engine implementation (CCBS-ENGINE-07)."""

from __future__ import annotations

import logging
from time import perf_counter
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel

from clozflow_brain.contracts.engines import (
    EngineExecutionInput,
    EngineExecutionOutput,
    EngineRegistration,
    EngineStatus,
    EngineType,
)
from clozflow_brain.contracts.events import EventType
from clozflow_brain.contracts.world_model import (
    BeliefNode,
    ConversationPhase,
    GoalNode,
    WorldModel,
    WorldModelMutation,
    WorldModelMutationType,
)
from clozflow_brain.engines._common import deterministic_uuid, empty_events_output, fingerprint

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal Schemas
# ---------------------------------------------------------------------------

class PolicyRule(BaseModel):
    rule_id: str
    description: str
    target_phase_exclusion: Optional[ConversationPhase] = None


class ScoredPlan(BaseModel):
    plan_id: UUID
    plan_data: Dict[str, Any]
    base_score: float
    final_score: float = 0.0
    is_vetoed: bool = False
    veto_reason: Optional[str] = None


class DecisionRationale(BaseModel):
    selected_playbook: str
    vetoed_playbooks: List[str]
    primary_justification: str


# ---------------------------------------------------------------------------
# Internal Managers
# ---------------------------------------------------------------------------

class PlanIngestor:
    """Extracts all EXECUTABLE_PLANs from the World Model generated in this cycle."""
    def ingest(self, world_model: WorldModel) -> List[Dict[str, Any]]:
        plans = [b for b in world_model.crm_beliefs if b.belief_type == "EXECUTABLE_PLAN"]
        
        # If no plans exist (e.g., test environment), provide a safe fallback
        if not plans:
            return [{
                "plan_id": deterministic_uuid(world_model.session_id, "decision.concrete", "fallback"),
                "playbook_name": "DEFAULT_CONVERSATIONAL_FLOW",
                "steps": [{"step_type": "ACKNOWLEDGE", "objective": "Acknowledge the buyer's statement."}],
                "is_multi_turn": False,
                "confidence": 0.8
            }]
            
        return [p.value for p in plans if isinstance(p.value, dict)]


class PolicyEnforcer:
    """Applies hard organizational rules to veto invalid plans."""
    
    def __init__(self) -> None:
        # Mocking an external policy registry
        self.active_policies = [
            PolicyRule(
                rule_id="PR-01", 
                description="No pricing negotiations before Discovery is complete.",
                target_phase_exclusion=ConversationPhase.OPENING
            ),
            PolicyRule(
                rule_id="PR-02",
                description="Do not offer discounts in early phases.",
                target_phase_exclusion=ConversationPhase.DISCOVERY
            )
        ]

    def enforce(self, scored_plans: List[ScoredPlan], current_phase: ConversationPhase) -> None:
        for plan in scored_plans:
            playbook = str(plan.plan_data.get("playbook_name", "")).upper()
            
            for policy in self.active_policies:
                if policy.target_phase_exclusion == current_phase:
                    if "PRICE" in playbook or "DISCOUNT" in playbook:
                        plan.is_vetoed = True
                        plan.veto_reason = f"Violates {policy.rule_id}: {policy.description} in {current_phase} phase."
                        logger.info(f"Vetoed plan {plan.plan_id}: {plan.veto_reason}")
                        break


class ContinuityManager:
    """Calculates momentum to favor continuing current strategies over erratic switching."""
    
    def __init__(self, momentum_bonus: float = 0.2):
        self.momentum_bonus = momentum_bonus
        
    def apply_momentum(self, scored_plans: List[ScoredPlan], world_model: WorldModel) -> None:
        active_goals = [g.description.lower() for g in world_model.active_goals if g.active]
        
        for plan in scored_plans:
            if plan.is_vetoed:
                continue
                
            plan.final_score = plan.base_score
            playbook = str(plan.plan_data.get("playbook_name", "")).lower()
            
            # If the plan playbook aligns with an existing active goal, boost its score
            for goal in active_goals:
                if playbook in goal or goal in playbook:
                    plan.final_score += (plan.base_score * self.momentum_bonus)
                    break
                    
            # Clamp to 1.0 maximum
            plan.final_score = min(plan.final_score, 1.0)


class ExecutiveSelector:
    """Selects the plan with the highest final score."""
    def select(self, scored_plans: List[ScoredPlan]) -> Optional[ScoredPlan]:
        viable_plans = [p for p in scored_plans if not p.is_vetoed]
        if not viable_plans:
            return None
        return max(viable_plans, key=lambda p: p.final_score)


# ---------------------------------------------------------------------------
# Engine Implementation
# ---------------------------------------------------------------------------

class DecisionEngine:
    """
    Decision Cognitive Subsystem (CCBS-ENGINE-07).
    Selects the single best executable plan, applying organizational policies and final executive judgment.
    """

    def __init__(self) -> None:
        self._engine_id = "decision.concrete"
        self._registration = EngineRegistration(
            engine_id=self._engine_id,
            engine_type=EngineType.DECISION,
            version="1.0.0",
            input_types=[EventType.TRANSCRIPT_SEGMENT],
            output_types=[],
            latency_budget_ms=150,
            priority=3,
            capabilities=["decision"],
        )
        
        self.ingestor = PlanIngestor()
        self.enforcer = PolicyEnforcer()
        self.continuity_manager = ContinuityManager()
        self.selector = ExecutiveSelector()

    @property
    def registration(self) -> EngineRegistration:
        return self._registration

    def execute(self, request: EngineExecutionInput) -> EngineExecutionOutput:
        started = perf_counter()
        mutations: list[WorldModelMutation] = []
        
        if not request.events:
            return empty_events_output(self._engine_id, request.cycle_id, 0)
            
        world_model = request.world_model

        try:
            # Stage 1: Ingestion
            current_ids = {event.event_id for event in request.events}
            eligible = [belief for belief in world_model.crm_beliefs if belief.belief_type == "EXECUTABLE_PLAN" and belief.retracted_at_utc is None and current_ids.intersection(belief.evidence_ids)]
            raw_plans = [belief.value for belief in eligible]
            scored_plans = [
                ScoredPlan(
                    plan_id=deterministic_uuid(request.cycle_id, self._engine_id, str(i)),
                    plan_data=rp,
                    base_score=rp.get("confidence", 0.8)
                ) for i, rp in enumerate(raw_plans)
            ]

            # Stage 2: Policy Enforcement
            self.enforcer.enforce(scored_plans, world_model.conversation_state.phase)

            # Stage 3: Continuity Weighting
            self.continuity_manager.apply_momentum(scored_plans, world_model)

            # Stage 4: Selection
            winner = self.selector.select(scored_plans)
            
            if not winner:
                return EngineExecutionOutput(engine_id=self._engine_id, cycle_id=request.cycle_id,
                    status=EngineStatus.ERROR, confidence=0, duration_ms=0,
                    reasoning_trace="No current, policy-compliant executable plan is available")

            # Stage 5: Commitment Recording
            vetoed = [p.plan_data.get("playbook_name", "Unknown") for p in scored_plans if p.is_vetoed]
            rationale = DecisionRationale(
                selected_playbook=winner.plan_data.get("playbook_name", "Unknown"),
                vetoed_playbooks=vetoed,
                primary_justification="Selected due to highest final score after policy enforcement and continuity momentum."
            )

            evidence_ids = [event.event_id for event in request.events]

            # Emit UPSERT_BELIEF (as specified in CCBS for logging the rationale/DecisionNode)
            decision_belief = BeliefNode(
                belief_id=deterministic_uuid(request.cycle_id, self._engine_id, "executive_decision"),
                belief_type="EXECUTIVE_DECISION",
                subject="session",
                value={
                    "rationale": rationale.model_dump(),
                    "selected_plan": winner.plan_data
                },
                confidence=winner.final_score,
                evidence_ids=evidence_ids,
                is_explicit=True,
            )
            
            mutations.append(WorldModelMutation(
                mutation_type=WorldModelMutationType.UPSERT_BELIEF,
                session_id=world_model.session_id,
                tenant_id=world_model.tenant_id,
                payload=decision_belief.model_dump(mode="json"),
            ))

            # Emit SET_GOAL (to satisfy existing Kernel API and tests)
            playbook_name = winner.plan_data.get("playbook_name", "General Playbook")
            primary_goal = GoalNode(
                goal_id=deterministic_uuid(request.cycle_id, self._engine_id, f"goal:{fingerprint(playbook_name)}"),
                description=f"Execute playbook: {playbook_name}",
                priority=10,
                confidence=winner.final_score,
                active=True,
            )
            
            mutations.append(WorldModelMutation(
                mutation_type=WorldModelMutationType.SET_GOAL,
                session_id=world_model.session_id,
                tenant_id=world_model.tenant_id,
                payload=primary_goal.model_dump(mode="json"),
            ))

            status = EngineStatus.SUCCESS
            trace = f"Selected {playbook_name}. Vetoed {len(vetoed)} plans."
            final_conf = winner.final_score

        except Exception as e:
            logger.error("Decision Engine execution failed: %s", e)
            status = EngineStatus.ERROR
            trace = f"Decision failed: {str(e)}"
            final_conf = 0.0

        duration_ms = int((perf_counter() - started) * 1000)
        
        return EngineExecutionOutput(
            engine_id=self.registration.engine_id,
            cycle_id=request.cycle_id,
            output_events=[],
            wm_mutations=mutations,
            confidence=final_conf,
            reasoning_trace=trace,
            duration_ms=duration_ms,
            status=status,
        )
