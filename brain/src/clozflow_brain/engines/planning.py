"""Planning Engine implementation (CCBS-ENGINE-06)."""

from __future__ import annotations

import logging
from time import perf_counter
from typing import Dict, List, Optional

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
    ConversationPhase,
    WorldModel,
    WorldModelMutation,
    WorldModelMutationType,
)
from clozflow_brain.engines._common import build_context_str, deterministic_uuid, empty_events_output
from clozflow_brain.infrastructure.llm import get_llm_client

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic Schemas for LLM Extraction
# ---------------------------------------------------------------------------

class PlanStep(BaseModel):
    step_type: str = Field(
        description="The structural type of step (e.g., ACKNOWLEDGE, VALIDATE, PAYLOAD_DELIVERY, PIVOT, PROBE, CLARIFY)."
    )
    objective: str = Field(
        description="What this specific step aims to achieve conceptually (e.g., 'Lower defenses by validating the pricing concern')."
    )
    knowledge_refs: List[str] = Field(
        description="Names of any specific battlecards, playbooks, or data points needed for this step."
    )


class ExecutionPlan(BaseModel):
    playbook_name: str = Field(description="The overarching playbook being executed.")
    steps: List[PlanStep] = Field(description="The sequential cognitive steps to execute.")
    is_multi_turn: bool = Field(description="True if this plan should unfold over multiple conversational turns.")
    confidence: float = Field(description="Confidence in this plan's robustness (0.0 to 1.0).", ge=0.0, le=1.0)


# ---------------------------------------------------------------------------
# Internal Managers
# ---------------------------------------------------------------------------

class StrategyIngestor:
    """Extracts the top-ranked EVALUATED_STRATEGY from the World Model."""
    def ingest(self, world_model: WorldModel) -> Optional[Dict]:
        strategies = [b for b in world_model.crm_beliefs if b.belief_type == "EVALUATED_STRATEGY"]
        if not strategies:
            # Fallback for testing environments where Evaluation Engine hasn't run
            return {
                "strategy_id": "DEFAULT_STRATEGY",
                "description": "Proceed with default conversational flow.",
                "intent_target": "GENERAL",
                "rank": 1
            }
            
        # The highest ranked strategy has rank == 1
        top_strategy = next((s for s in strategies if isinstance(s.value, dict) and s.value.get("rank") == 1), None)
        return top_strategy.value if top_strategy else None


class PacingManager:
    """Evaluates conversation tempo to dictate plan density."""
    def get_max_steps(self, world_model: WorldModel) -> int:
        # In a real system, we'd analyze wpm and turn durations.
        # For this prototype, we'll return a static max steps.
        return 3


class KnowledgeRetriever:
    """Mocks integration with a Knowledge Service to fetch playbooks."""
    def retrieve(self, strategy_intent: str, phase: ConversationPhase) -> str:
        # A mock mapping logic
        intent = strategy_intent.upper()
        if "PRICE" in intent or "BUDGET" in intent:
            return "Battlecard: Enterprise ROI Metrics"
        if "TRUST" in intent or "RAPP" in intent:
            return "Playbook: Empathic Listening"
        if "COMPETIT" in intent:
            return "Battlecard: Competitor Displacement Matrix"
        
        return "General Framework: Value Selling"


class PlanValidator:
    """Enforces CCBS Law 270: No language generation in Planning."""
    def validate(self, plan: ExecutionPlan) -> ExecutionPlan:
        # Check if the LLM attempted to write actual script
        script_indicators = ["say:", "saying", "\"", "hello", "hi", "thanks", "let me"]
        for step in plan.steps:
            lower_obj = step.objective.lower()
            if any(indicator in lower_obj for indicator in script_indicators):
                logger.warning(f"CCBS Law 270 Violation detected in plan step: {step.objective}. Sanitizing.")
                step.objective = "[SANITIZED] Execute structural intent without scripting."
        return plan


# ---------------------------------------------------------------------------
# Engine Implementation
# ---------------------------------------------------------------------------

class PlanningEngine:
    """
    Planning Cognitive Subsystem (CCBS-ENGINE-06).
    Translates strategies into executable, structured plans without scripting.
    """

    def __init__(self) -> None:
        self._engine_id = "planning.concrete"
        self._registration = EngineRegistration(
            engine_id=self._engine_id,
            engine_type=EngineType.PLANNING,
            version="1.0.0",
            input_types=[EventType.TRANSCRIPT_SEGMENT],
            output_types=[],
            latency_budget_ms=300,
            priority=3,
            capabilities=["planning"],
        )
        
        self.ingestor = StrategyIngestor()
        self.pacing_manager = PacingManager()
        self.retriever = KnowledgeRetriever()
        self.validator = PlanValidator()
        
        self.llm_client = get_llm_client(self._engine_id)
        
        self.system_prompt = (
            "You are the Planning Engine of ClozFlow Cognitive Brain. "
            "Your task is to take a high-level strategy and break it down into a logical sequence of cognitive steps. "
            "CRITICAL LAW: You must NOT write actual dialogue or scripts. Describe the structural maneuvers "
            "(e.g., 'Acknowledge the specific budget constraint', NOT 'I hear your budget is tight')."
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

        # Stage 1: Strategy Ingestion
        current_ids = {event.event_id for event in request.events}
        eligible = [belief for belief in world_model.crm_beliefs if belief.belief_type == "EVALUATED_STRATEGY" and belief.retracted_at_utc is None and current_ids.intersection(belief.evidence_ids)]
        strategy = next((belief.value for belief in reversed(eligible) if belief.value.get("rank") == 1), None)
        if not strategy:
            logger.warning("No evaluated strategy found. Planning Engine cannot proceed.")
            return empty_events_output(self._engine_id, request.cycle_id, 0)

        # Stage 2: Knowledge Retrieval
        knowledge_context = "\n".join(str(fragment.content) for fragment in request.cognitive_context.fragments
            if fragment.source_type.value == "KNOWLEDGE") if request.cognitive_context else "No reference material supplied"

        # Stage 3: Pacing
        max_steps = self.pacing_manager.get_max_steps(world_model)
        
        # Build Context
        context_str = build_context_str(world_model, request.cognitive_context, window_size=8)
        
        prompt = (
            f"STRATEGY TO EXECUTE: {strategy.get('description')}\n"
            f"INTENT TARGET: {strategy.get('intent_target')}\n"
            f"RETRIEVED KNOWLEDGE: {knowledge_context}\n"
            f"MAX STEPS ALLOWED: {max_steps}\n\n"
            f"CONVERSATION HISTORY:\n{context_str}\n\n"
            "Task: Generate a concrete execution plan consisting of structural steps."
        )

        try:
            # Stage 4: LLM Structuring
            raw_plan = self.llm_client.generate_structured_output(
                prompt=prompt,
                response_schema=ExecutionPlan,
                system_prompt=self.system_prompt,
                temperature=0.1
            )
            
            # Truncate steps based on pacing
            if len(raw_plan.steps) > max_steps:
                raw_plan.steps = raw_plan.steps[:max_steps]
                raw_plan.is_multi_turn = True
                
            # Stage 5: Validation (CCBS Law 270)
            validated_plan = self.validator.validate(raw_plan)
            
            # Stage 6: Mutation Generation (UPSERT_BELIEF as workaround for UPSERT_PLAN)
            evidence_ids = [event.event_id for event in request.events]
            
            plan_belief = BeliefNode(
                belief_id=deterministic_uuid(request.cycle_id, self._engine_id, "executable_plan"),
                belief_type="EXECUTABLE_PLAN",
                subject="session",
                value={
                    "strategy_id": strategy.get("strategy_id"),
                    "playbook_name": validated_plan.playbook_name,
                    "steps": [s.model_dump() for s in validated_plan.steps],
                    "is_multi_turn": validated_plan.is_multi_turn,
                    "confidence": validated_plan.confidence,
                },
                confidence=validated_plan.confidence,
                evidence_ids=evidence_ids,
                is_explicit=True,
            )
            
            mutations.append(WorldModelMutation(
                mutation_type=WorldModelMutationType.UPSERT_BELIEF,
                session_id=world_model.session_id,
                tenant_id=world_model.tenant_id,
                payload=plan_belief.model_dump(mode="json"),
            ))
            
            status = EngineStatus.SUCCESS
            step_types = [s.step_type for s in validated_plan.steps]
            trace = f"Generated {len(validated_plan.steps)}-step plan for {validated_plan.playbook_name}: {' -> '.join(step_types)}."
            final_conf = validated_plan.confidence

        except Exception as e:
            logger.error("Planning Engine execution failed: %s", e)
            status = EngineStatus.ERROR
            trace = f"Planning failed: {str(e)}"
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
