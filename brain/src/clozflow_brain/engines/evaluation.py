"""Evaluation Engine implementation (CCBS-ENGINE-05)."""

from __future__ import annotations

import logging
from time import perf_counter
from typing import List

from pydantic import BaseModel, Field

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
    WorldModelMutation,
    WorldModelMutationType,
)
from clozflow_brain.engines._common import build_context_str, deterministic_uuid, empty_events_output
from clozflow_brain.infrastructure.llm import get_llm_client

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pydantic Schemas for LLM Extraction
# ---------------------------------------------------------------------------

class COHScores(BaseModel):
    integrity: int = Field(ge=0, le=10, description="L1: Cognitive Integrity (honesty, avoiding manipulation). Score 0 to 10.")
    trust: int = Field(ge=0, le=10, description="L2: Buyer Trust (rapport, empathy, feeling heard). Score 0 to 10.")
    success: int = Field(ge=0, le=10, description="L3: Salesperson Success (protecting margins, following policy). Score 0 to 10.")
    commercial: int = Field(ge=0, le=10, description="L4: Commercial Progress (moving the deal forward). Score 0 to 10.")
    communication: int = Field(ge=0, le=10, description="L5: Communication Excellence (clarity, brevity). Score 0 to 10.")
    efficiency: int = Field(ge=0, le=10, description="L6: Operational Efficiency (saving time). Score 0 to 10.")


class EvaluatedStrategy(BaseModel):
    strategy_id: str = Field(description="Short identifier, e.g., 'STRAT_A'")
    description: str = Field(description="High-level description of the strategy.")
    intent_target: str = Field(description="The primary intent this strategy aims to achieve.")
    scores: COHScores = Field(description="Projected scores across the 6 COH levels if executed.")


class StrategyList(BaseModel):
    strategies: List[EvaluatedStrategy] = Field(description="3 to 5 candidate strategies evaluated.")


# ---------------------------------------------------------------------------
# Internal Managers
# ---------------------------------------------------------------------------

class COHScoringMatrix:
    """Validates and standardizes scores for COH levels."""

    def validate(self, strategy: EvaluatedStrategy) -> EvaluatedStrategy:
        # Preserve the schema's 0-10 scale used by hierarchy thresholds
        for field in COHScores.model_fields.keys():
            val = getattr(strategy.scores, field)
            setattr(strategy.scores, field, max(0, min(10, int(val))))
        return strategy


class HierarchyEnforcer:
    """Applies strict lexicographic ranking and hard-pruning."""

    def enforce(self, strategies: List[EvaluatedStrategy]) -> List[EvaluatedStrategy]:
        viable_strategies = []
        for s in strategies:
            # Prune strategies that violate Cognitive Integrity (L1) or Buyer Trust (L2)
            if s.scores.integrity < 5:
                logger.warning(f"Pruned strategy {s.strategy_id} due to low Integrity ({s.scores.integrity})")
                continue
            if s.scores.trust < 5:
                logger.warning(f"Pruned strategy {s.strategy_id} due to low Trust ({s.scores.trust})")
                continue
            viable_strategies.append(s)

        # Lexicographic sorting: Higher is better, L1 > L2 > L3 > L4 > L5 > L6
        viable_strategies.sort(
            key=lambda s: (
                s.scores.integrity,
                s.scores.trust,
                s.scores.success,
                s.scores.commercial,
                s.scores.communication,
                s.scores.efficiency
            ),
            reverse=True
        )
        return viable_strategies


class TradeoffAnalyzer:
    """Generates natural language summaries of strategic trade-offs."""

    def analyze(self, strategies: List[EvaluatedStrategy]) -> str:
        if not strategies:
            return "No viable strategies generated."

        if len(strategies) == 1:
            return f"Only one viable strategy: {strategies[0].description}"

        top = strategies[0]
        runner_up = strategies[1]

        return (
            f"Top Strategy ({top.strategy_id}) maximizes L1/L2 over Runner Up ({runner_up.strategy_id}). "
            f"Trade-off: {top.description} vs {runner_up.description}."
        )


# ---------------------------------------------------------------------------
# Engine Implementation
# ---------------------------------------------------------------------------

class EvaluationEngine:
    """
    Evaluation Cognitive Subsystem (CCBS-ENGINE-05).
    Scores strategies against the Cognitive Objective Hierarchy.
    """

    def __init__(self) -> None:
        self._engine_id = "evaluation.concrete"
        self._registration = EngineRegistration(
            engine_id=self._engine_id,
            engine_type=EngineType.EVALUATION,
            version="1.0.0",
            input_types=[EventType.TRANSCRIPT_SEGMENT],
            output_types=[],
            latency_budget_ms=400,
            priority=3,
            capabilities=["evaluation"],
        )

        self.scoring_matrix = COHScoringMatrix()
        self.hierarchy_enforcer = HierarchyEnforcer()
        self.tradeoff_analyzer = TradeoffAnalyzer()

        self.llm_client = get_llm_client(self._engine_id)

        self.system_prompt = (
            "You are the Evaluation Engine of ClozFlow Cognitive Brain. "
            "You MUST generate 3 to 5 distinct strategic approaches for the salesperson to take next. "
            "Score each strategy against the 6 levels of the Cognitive Objective Hierarchy (COH) by projecting its likely outcome on a scale of 0 to 10. "
            "L1 Integrity and L2 Trust are paramount. Do not recommend manipulative tactics."
        )

    @property
    def registration(self) -> EngineRegistration:
        return self._registration

    def execute(self, request: EngineExecutionInput) -> EngineExecutionOutput:
        started = perf_counter()
        mutations: list[WorldModelMutation] = []

        if not request.events:
            return empty_events_output(self._engine_id, request.cycle_id, 0)

        world_model = request.world_model

        # Build Context
        context_str = build_context_str(world_model, request.cognitive_context, window_size=8)

        # Grab predictions to feed into evaluation
        predictions_str = "None"
        pred_beliefs = [b for b in world_model.crm_beliefs if b.belief_type == "DEAL_PREDICTION"]
        if pred_beliefs:
            latest_pred = pred_beliefs[-1]
            predictions_str = str(latest_pred.value)

        objections_str = ", ".join(
            f"{o.objection_type}: '{o.summary}'" for o in world_model.active_objections
        ) or "None"

        prompt = (
            f"CURRENT PHASE: {world_model.conversation_state.phase.value}\n"
            f"OPEN OBJECTIONS: {objections_str}\n"
            f"LATEST PREDICTIONS: {predictions_str}\n\n"
            f"CONVERSATION HISTORY:\n{context_str}\n\n"
            "Task: Generate 3-5 Candidate Strategies. Project outcomes and score them against the COH."
        )

        try:
            # Stage 1-3: Candidate Generation & Scoring (LLM)
            strategy_output = self.llm_client.generate_structured_output(
                prompt=prompt,
                response_schema=StrategyList,
                system_prompt=self.system_prompt,
                temperature=0.2
            )

            # Validation
            validated_strategies = [self.scoring_matrix.validate(s) for s in strategy_output.strategies]

            # Stage 4: Hierarchy Enforcement & Pruning
            viable_strategies = self.hierarchy_enforcer.enforce(validated_strategies)

            # Stage 5: Trade-off Analysis
            tradeoffs = self.tradeoff_analyzer.analyze(viable_strategies)

            # Stage 6: Mutation Generation (UPSERT_BELIEF as workaround)
            evidence_ids = [event.event_id for event in request.events]

            for i, strategy in enumerate(viable_strategies):
                rank = i + 1
                strat_belief = BeliefNode(
                    belief_id=deterministic_uuid(request.cycle_id, self._engine_id, f"eval_strategy_{rank}"),
                    belief_type="EVALUATED_STRATEGY",
                    subject=f"strategy:{rank}",
                    value={
                        "rank": rank,
                        "strategy_id": strategy.strategy_id,
                        "description": strategy.description,
                        "intent_target": strategy.intent_target,
                        "scores": strategy.scores.model_dump(),
                        "tradeoffs": tradeoffs if rank == 1 else ""
                    },
                    confidence=1.0,  # Confidence in this engine refers to certainty in scoring, which LLM doesn't easily emit here, defaulting to 1.0.
                    evidence_ids=evidence_ids,
                    is_explicit=True,
                )

                mutations.append(WorldModelMutation(
                    mutation_type=WorldModelMutationType.UPSERT_BELIEF,
                    session_id=world_model.session_id,
                    tenant_id=world_model.tenant_id,
                    payload=strat_belief.model_dump(mode="json"),
                ))

            status = EngineStatus.SUCCESS

            if viable_strategies:
                top = viable_strategies[0]
                trace = f"Generated {len(validated_strategies)} strategies. {len(viable_strategies)} survived pruning. Top choice: {top.strategy_id} (L1: {top.scores.integrity}, L2: {top.scores.trust}). Trade-offs: {tradeoffs}"
            else:
                trace = "All generated strategies were pruned due to COH violations."

        except Exception as e:
            logger.error("Evaluation Engine execution failed: %s", e)
            status = EngineStatus.ERROR
            trace = f"Evaluation failed: {str(e)}"

        duration_ms = int((perf_counter() - started) * 1000)

        return EngineExecutionOutput(
            engine_id=self.registration.engine_id,
            cycle_id=request.cycle_id,
            output_events=[],
            wm_mutations=mutations,
            confidence=1.0,
            reasoning_trace=trace,
            duration_ms=duration_ms,
            status=status,
        )
