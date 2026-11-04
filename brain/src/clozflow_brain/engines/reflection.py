"""Reflection Engine implementation (CCBS-ENGINE-10)."""

from __future__ import annotations

import logging
from time import perf_counter
from typing import Any, Dict, List
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from clozflow_brain.application.memory_service import MemoryService
from clozflow_brain.contracts.engines import (
    EngineExecutionInput,
    EngineExecutionOutput,
    EngineRegistration,
    EngineStatus,
    EngineType,
)
from clozflow_brain.contracts.events import EventType
from clozflow_brain.contracts.memory import MemoryRecord, MemoryScope, MemoryType
from clozflow_brain.contracts.world_model import BeliefNode, WorldModelMutation, WorldModelMutationType
from clozflow_brain.infrastructure.llm import get_llm_client

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Internal Schemas
# ---------------------------------------------------------------------------

class DeltaAnalysis(BaseModel):
    metric: str
    expected_val: str
    actual_val: str
    variance: str

class Attribution(BaseModel):
    primary_cause: str  # AI_ERROR, HUMAN_ERROR, EXTERNAL_NOISE
    confidence: float

class CalibrationUpdate(BaseModel):
    target_engine: str
    parameter: str
    adjustment_val: float

class SessionSummary(BaseModel):
    """Pydantic schema for structured LLM session reflection."""
    key_takeaways: list[str] = Field(description="Key insights and highlights from the conversation")
    unresolved_objections: list[str] = Field(description="List of objections that were raised but not resolved")
    next_steps: list[str] = Field(description="Action items agreed upon by the buyer and salesperson")
    sentiment_trend: str = Field(description="Trend profile of buyer sentiment throughout the session")
    deltas: list[DeltaAnalysis] = Field(description="Analysis of what we expected vs what actually happened")
    attributions: list[Attribution] = Field(description="Attributions for why plans succeeded or failed")
    calibrations: list[CalibrationUpdate] = Field(description="Calibration weights to improve future cycles")
    confidence: float = Field(description="Reflection confidence score", ge=0.0, le=1.0)


# ---------------------------------------------------------------------------
# Internal Managers
# ---------------------------------------------------------------------------

class TargetStateExtractor:
    def extract(self, world_model) -> List[Dict[str, Any]]:
        # Find all DEAL_PREDICTION expectations
        expectations = []
        for belief in world_model.crm_beliefs:
            if belief.belief_type == "DEAL_PREDICTION":
                expectations.append({
                    "id": belief.belief_id,
                    "expected_action": str(belief.value.get("next_buyer_action", "unknown")),
                    "expected_risk": str(belief.value.get("biggest_risk", "unknown"))
                })
        return expectations


class ActualStateExtractor:
    def extract(self, world_model) -> Dict[str, Any]:
        # Extract the final known state to compare against predictions
        final_intent = next((b.value for b in reversed(world_model.crm_beliefs) if b.belief_type == "BUYER_INTENT"), "unknown")
        return {
            "final_intent": str(final_intent)
        }


class AdherenceChecker:
    def check_adherence(self, world_model) -> float:
        # In a real system, we'd embed the script and the transcript and compute cosine similarity.
        # Here we simulate an adherence score by checking if they just ignored recommendations.
        # For simplicity, if there were recommendations and transcript events, we assume some adherence.
        if not world_model.context_window:
            return 0.0

        return 0.7  # Simulated placeholder for 70% adherence


class CalibrationScorer:
    def score(self, error_rate: float, adherence: float) -> CalibrationUpdate:
        # If human didn't follow script (adherence < 0.4), don't penalize the AI's prediction heavily
        adjustment = 0.0
        if adherence > 0.5:
            # Human followed script, but we got an error. Penalize Prediction Engine.
            adjustment = -error_rate * 0.1

        return CalibrationUpdate(
            target_engine="prediction.concrete",
            parameter="brier_score_weight",
            adjustment_val=adjustment
        )


# ---------------------------------------------------------------------------
# Engine Implementation
# ---------------------------------------------------------------------------

class ReflectionEngine:
    """
    Reflection Cognitive Subsystem (CCBS-ENGINE-10).
    Consolidates long-term insights, analyzes deltas between intent and reality,
    and attributes successes/failures.
    """

    def __init__(self, memory_service: MemoryService | None = None) -> None:
        self._registration = EngineRegistration(
            engine_id="reflection.concrete",
            engine_type=EngineType.REFLECTION,
            version="1.0.0",
            input_types=[EventType.SESSION_END],
            output_types=[],
            latency_budget_ms=30000,
            priority=5,
            capabilities=["reflection"],
        )
        self.llm_client = get_llm_client("reflection.concrete")
        self._memory_service = memory_service

        self.target_extractor = TargetStateExtractor()
        self.actual_extractor = ActualStateExtractor()
        self.adherence_checker = AdherenceChecker()
        self.scorer = CalibrationScorer()

    @property
    def registration(self) -> EngineRegistration:
        return self._registration

    def execute(self, request: EngineExecutionInput) -> EngineExecutionOutput:
        started = perf_counter()
        mutations: list[WorldModelMutation] = []

        context_str = "\n".join(request.world_model.context_window)
        if not context_str and request.cognitive_context:
            context_str = "\n".join(
                str(frag.content) for frag in request.cognitive_context.fragments
            )

        # Stage 1: State Extraction (for prompting and manual logic)
        targets = self.target_extractor.extract(request.world_model)
        actuals = self.actual_extractor.extract(request.world_model)

        # Stage 3: Adherence Check (executed here mathematically)
        adherence_score = "unknown (not measured)"

        prompt = f"""Review the full session conversation context, goals, and history,
and compile a comprehensive post-session reflection and action items.

You MUST calculate deltas between the engine's predictions and actual outcomes.
Salesperson adherence: {adherence_score}. Do not infer causation or assign blame without evidence.

Leave attributions and calibrations empty when outcomes or adherence are unobserved.

EXPECTATIONS WE HAD (Target States):
{targets}

ACTUAL FINAL STATES:
{actuals}

CONVERSATION TRANSCRIPT:
{context_str}
"""
        system_prompt = (
            "You are the Reflection component of the ClozFlow Cognitive Brain. "
            "Act as an internal post-mortem analyst. Synthesize outcomes, calculate deltas, "
            "attribute failures to HUMAN_ERROR or AI_ERROR based on adherence, and provide calibration weights."
        )

        try:
            summary = self.llm_client.generate_structured_output(
                prompt=prompt,
                response_schema=SessionSummary,
                system_prompt=system_prompt,
                temperature=0.1,
            )

            # Stage 5: Calibration Scoring (injecting programmatic math score if needed)
            # We also let the LLM generate calibrations in the schema, but we can override or append.
            # Calibration requires measured outcomes; never fabricate a training target.
            summary.calibrations = []

            evidence_ids = [event.event_id for event in request.events]

            # Stage 6: Mutation Generation (UPSERT_REFLECTION concept via UPSERT_BELIEF)
            summary_belief = BeliefNode(
                belief_id=uuid4(),
                belief_type="SESSION_SUMMARY",
                subject="session",
                value=summary.model_dump(mode="json"),
                confidence=summary.confidence,
                evidence_ids=evidence_ids,
            )
            mutations.append(
                WorldModelMutation(
                    mutation_type=WorldModelMutationType.UPSERT_BELIEF,
                    session_id=request.world_model.session_id,
                    tenant_id=request.world_model.tenant_id,
                    payload=summary_belief.model_dump(mode="json"),
                )
            )

            # Phase 6: Persist long-term memory records (Must retain this functionality)
            if self._memory_service is not None:
                self._persist_long_term_memories(
                    summary=summary,
                    tenant_id=request.world_model.tenant_id,
                    session_id=request.world_model.session_id,
                    evidence_ids=evidence_ids,
                )

            status = EngineStatus.SUCCESS
            reasoning_trace = (
                f"Generated reflection. Deltas analyzed: {len(summary.deltas)}. "
                f"Attributions: {len(summary.attributions)}. Adherence: {adherence_score}"
            )
            confidence = summary.confidence

        except Exception as e:
            logger.error("ReflectionEngine LLM compilation failed: %s", e)
            status = EngineStatus.ERROR
            reasoning_trace = f"Error during reflection generation: {str(e)}"
            confidence = 0.0

        duration_ms = int((perf_counter() - started) * 1000)
        return EngineExecutionOutput(
            engine_id=self.registration.engine_id,
            cycle_id=request.cycle_id,
            output_events=[],
            wm_mutations=mutations,
            confidence=confidence,
            reasoning_trace=reasoning_trace,
            duration_ms=duration_ms,
            status=status,
        )

    # ------------------------------------------------------------------
    # Private helpers (Memory Integration)
    # ------------------------------------------------------------------

    def _persist_long_term_memories(
        self,
        summary: SessionSummary,
        tenant_id: UUID,
        session_id: UUID,
        evidence_ids: list[UUID],
    ) -> None:
        """Store buyer profile, unresolved objections, and past outcome as durable memories."""
        assert self._memory_service is not None  # narrowing

        # 1. Buyer profile
        try:
            buyer_profile = MemoryRecord(
                tenant_id=tenant_id,
                memory_type=MemoryType.EPISODIC,
                scope=MemoryScope.TENANT,
                subject="Buyer Profile",
                content={
                    "session_id": str(session_id),
                    "key_takeaways": summary.key_takeaways,
                    "sentiment_trend": summary.sentiment_trend,
                    "next_steps": summary.next_steps,
                },
                concepts=["buyer", "profile", "session", "summary"],
                confidence=summary.confidence,
                provenance_event_ids=evidence_ids,
            )
            self._memory_service.store(buyer_profile)
            logger.debug("Stored buyer profile memory for session %s.", session_id)
        except Exception:
            logger.warning(
                "Failed to store buyer profile memory for session %s.", session_id, exc_info=True
            )

        # 2. One memory per unresolved objection
        for objection in summary.unresolved_objections:
            try:
                concepts = ["objection", "unresolved"] + [
                    token.lower()
                    for token in objection.split()
                    if len(token) > 3
                ][:5]
                objection_memory = MemoryRecord(
                    tenant_id=tenant_id,
                    memory_type=MemoryType.EPISODIC,
                    scope=MemoryScope.TENANT,
                    subject=f"Historical Objection: {objection[:120]}",
                    content={
                        "session_id": str(session_id),
                        "objection": objection,
                        "resolution_status": "unresolved",
                    },
                    concepts=concepts,
                    confidence=summary.confidence * 0.9,
                    provenance_event_ids=evidence_ids,
                )
                self._memory_service.store(objection_memory)
                logger.debug("Stored objection memory: '%s'.", objection[:60])
            except Exception:
                logger.warning(
                    "Failed to store objection memory for session %s.", session_id, exc_info=True
                )

        # 3. Past outcome
        try:
            outcome_memory = MemoryRecord(
                tenant_id=tenant_id,
                memory_type=MemoryType.REFLECTIVE,
                scope=MemoryScope.TENANT,
                subject="Past Outcome",
                content={
                    "session_id": str(session_id),
                    "sentiment_trend": summary.sentiment_trend,
                    "unresolved_count": len(summary.unresolved_objections),
                    "next_steps": summary.next_steps,
                    "deltas": [d.model_dump() for d in summary.deltas]
                },
                concepts=["outcome", "session", "result", "reflection"],
                confidence=summary.confidence,
                provenance_event_ids=evidence_ids,
            )
            self._memory_service.store(outcome_memory)
            logger.debug("Stored past outcome memory for session %s.", session_id)
        except Exception:
            logger.warning(
                "Failed to store past outcome memory for session %s.", session_id, exc_info=True
            )
