"""Verification Engine implementation (CCBS-ENGINE-08)."""

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
    GoalNode,
    WorldModel,
    WorldModelMutation,
    WorldModelMutationType,
)
from clozflow_brain.engines._common import deterministic_uuid, empty_events_output

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal Schemas
# ---------------------------------------------------------------------------

class AuditResult(BaseModel):
    checker_name: str
    passed: bool
    score: float
    failure_reason: Optional[str] = None


class VerificationReport(BaseModel):
    is_verified: bool
    composite_score: float
    audit_results: List[AuditResult]
    fallback_triggered: bool


# ---------------------------------------------------------------------------
# Internal Managers
# ---------------------------------------------------------------------------

class CausalGraphIngestor:
    """Fetches the active goal and underlying beliefs from the World Model."""
    def ingest(self, world_model: WorldModel) -> Dict[str, Any]:
        graph: Dict[str, Any] = {
            "active_goal": next((g for g in world_model.active_goals if g.active), None),
            "decision": None,
            "plan": None,
            "sentiment": None
        }
        
        # Traverse beliefs in reverse order
        for belief in reversed(world_model.crm_beliefs):
            if belief.belief_type == "EXECUTIVE_DECISION" and not graph["decision"]:
                graph["decision"] = belief
            elif belief.belief_type == "EXECUTABLE_PLAN" and not graph["plan"]:
                graph["plan"] = belief
            elif belief.belief_type == "BUYER_SENTIMENT" and not graph["sentiment"]:
                graph["sentiment"] = belief
                
        return graph


class AdversarialAuditor:
    """Executes the three deterministic checks against the causal graph."""
    
    def audit(self, graph: Dict[str, Any]) -> List[AuditResult]:
        results = []
        
        # 1. Cumulative Confidence Check
        nodes_with_confidence = [
            n for n in [graph["active_goal"], graph["decision"], graph["plan"], graph["sentiment"]]
            if n is not None
        ]
        
        if not nodes_with_confidence:
            results.append(AuditResult(
                checker_name="Cumulative Confidence", passed=True, score=0.8, failure_reason=None
            ))
        else:
            min_confidence = min((n.confidence for n in nodes_with_confidence), default=0.0)
            passed = min_confidence >= 0.5
            results.append(AuditResult(
                checker_name="Cumulative Confidence", 
                passed=passed, 
                score=min_confidence, 
                failure_reason=None if passed else f"Chain confidence bottlenecked at {min_confidence:.2f}"
            ))

        # 2. Logic Check
        logic_passed = True
        logic_reason = None
        
        if graph["active_goal"] and graph["sentiment"]:
            goal_desc = str(graph["active_goal"].description).upper()
            sentiment_val = str(graph["sentiment"].value).upper()
            
            # Example Contradiction: Pushing to close when sentiment is hostile
            if "CLOSE" in goal_desc and "HOSTILE" in sentiment_val:
                logic_passed = False
                logic_reason = "Logical Contradiction: Attempting to close while sentiment is hostile."
                
        results.append(AuditResult(
            checker_name="Logic Check", passed=logic_passed, score=1.0 if logic_passed else 0.0, failure_reason=logic_reason
        ))
        
        # 3. Evidence Trace
        # Verify that the decision has a clear provenance
        trace_passed = graph["decision"] is not None or (graph["active_goal"] is None) # Passed if no goal to trace
        results.append(AuditResult(
            checker_name="Evidence Trace", 
            passed=trace_passed, 
            score=1.0 if trace_passed else 0.0, 
            failure_reason=None if trace_passed else "Decision provenance is missing."
        ))
        
        return results


class ThresholdValidator:
    """Checks if the audited metrics meet the safety bar."""
    def validate(self, audit_results: List[AuditResult]) -> tuple[bool, float]:
        # If any hard check fails, verification fails
        if any(not r.passed for r in audit_results):
            return False, 0.0
            
        composite = sum(r.score for r in audit_results) / len(audit_results)
        return composite >= 0.6, composite


class FallbackManager:
    """Provides safe fallback goals when verification fails."""
    def generate_fallback(self, cycle_id: UUID, engine_id: str) -> GoalNode:
        return GoalNode(
            goal_id=deterministic_uuid(cycle_id, engine_id, "fallback_goal"),
            description="Ask a clarifying question to re-engage safely.",
            priority=10,
            confidence=0.9,
            active=True
        )


# ---------------------------------------------------------------------------
# Engine Implementation
# ---------------------------------------------------------------------------

class VerificationEngine:
    """
    Verification Cognitive Subsystem (CCBS-ENGINE-08).
    Audits the entire causal chain to detect logical contradictions or low confidence.
    """

    def __init__(self) -> None:
        self._engine_id = "verification.concrete"
        self._registration = EngineRegistration(
            engine_id=self._engine_id,
            engine_type=EngineType.VERIFICATION,
            version="1.0.0",
            input_types=[EventType.TRANSCRIPT_SEGMENT],
            output_types=[],
            latency_budget_ms=100,
            priority=2,
            capabilities=["verification"],
        )
        
        self.ingestor = CausalGraphIngestor()
        self.auditor = AdversarialAuditor()
        self.validator = ThresholdValidator()
        self.fallback = FallbackManager()

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
            # Stage 1: Graph Assembly
            graph = self.ingestor.ingest(world_model)
            
            # Stage 2: Adversarial Audit
            audit_results = self.auditor.audit(graph)
            
            # Stage 3: Threshold Evaluation
            is_verified, composite_score = self.validator.validate(audit_results)
            
            # Stage 4: Verdict & Fallback
            fallback_triggered = not is_verified
            
            if fallback_triggered:
                logger.warning(f"Verification Failed. Triggering fallback. Reasons: {[r.failure_reason for r in audit_results if not r.passed]}")
                fallback_goal = self.fallback.generate_fallback(request.cycle_id, self._engine_id)
                mutations.append(WorldModelMutation(
                    mutation_type=WorldModelMutationType.SET_GOAL,
                    session_id=world_model.session_id,
                    tenant_id=world_model.tenant_id,
                    payload=fallback_goal.model_dump(mode="json"),
                ))
            
            # Stage 5: Mutation Generation
            report = VerificationReport(
                is_verified=is_verified,
                composite_score=composite_score,
                audit_results=audit_results,
                fallback_triggered=fallback_triggered
            )
            
            evidence_ids = [event.event_id for event in request.events]
            verification_belief = BeliefNode(
                belief_id=deterministic_uuid(request.cycle_id, self._engine_id, "verification_status"),
                belief_type="VERIFICATION_STATUS",
                subject="session",
                value=report.model_dump(),
                confidence=composite_score if is_verified else 1.0,
                evidence_ids=evidence_ids,
                is_explicit=True,
            )
            
            mutations.append(WorldModelMutation(
                mutation_type=WorldModelMutationType.UPSERT_BELIEF,
                session_id=world_model.session_id,
                tenant_id=world_model.tenant_id,
                payload=verification_belief.model_dump(mode="json"),
            ))

            status = EngineStatus.SUCCESS
            trace = f"Verification {'PASSED' if is_verified else 'FAILED (Fallback deployed)'}. Score: {composite_score:.2f}"
            final_conf = composite_score

        except Exception as e:
            logger.error("Verification Engine execution failed: %s", e)
            status = EngineStatus.ERROR
            trace = f"Verification failed: {str(e)}"
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
