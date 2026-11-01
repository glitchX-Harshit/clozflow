"""
Sales Quality Evaluator.
Evaluates consultative posture, active listening, value articulation,
objection handling empathy, and deal progression.
"""
from typing import List
from evaluators.base import BaseEvaluator, EvaluationResult
from adapters.base import RunRecord
from datasets.schema import EvaluationScenario


class SalesQualityEvaluator(BaseEvaluator):
    def __init__(self, passing_threshold: float = 70.0):
        super().__init__(dimension_name="sales_quality", passing_threshold=passing_threshold)

    def evaluate(self, run: RunRecord, scenario: EvaluationScenario) -> EvaluationResult:
        pearl_turns = [t for t in run.turns if t.speaker == "pearl"]
        if not pearl_turns:
            return EvaluationResult(
                scenario_id=scenario.scenario_id,
                dimension=self.dimension_name,
                score=0.0,
                passed=False,
                reasons=["No Pearl responses recorded"],
                failure_type="conversation_failure"
            )

        combined_text = " ".join([t.text for t in pearl_turns]).lower()
        score = 65.0
        reasons: List[str] = []

        # 1. Natural Indian conversational fillers & empathy markers
        empathy_markers = ["samajh", "bilkul", "sahi", "fair point", "actually", "haanji", "sure", "definitely"]
        found_empathy = [m for m in empathy_markers if m in combined_text]
        if found_empathy:
            score += 15.0
        else:
            reasons.append("Lacks conversational empathy markers")

        # 2. Call-to-action / Next-step alignment
        cta_markers = ["demo", "walkthrough", "slot", "calendar", "tomorrow", "kal", "connect", "meeting"]
        has_cta = any(m in combined_text for m in cta_markers)
        if has_cta:
            score += 15.0
        else:
            score -= 10.0
            reasons.append("Failed to guide conversation toward concrete next steps or meeting")

        # 3. Avoid pushy aggressive hard-sell
        pushy_markers = ["you must buy", "buy immediately", "sign now", "transfer money"]
        is_pushy = any(p in combined_text for p in pushy_markers)
        if is_pushy:
            score -= 25.0
            reasons.append("Exhibited aggressive high-pressure sales tactics")

        # 4. Simulation metadata check (if prospect agreed to meeting, bonus)
        sim_meta = run.metadata.get("simulation", {})
        if sim_meta.get("meeting_agreed"):
            score += 10.0
        elif sim_meta.get("hung_up"):
            score -= 15.0
            reasons.append("Prospect hung up prematurely")

        score = max(0.0, min(100.0, score))
        passed = score >= self.passing_threshold

        return EvaluationResult(
            scenario_id=scenario.scenario_id,
            dimension=self.dimension_name,
            score=round(score, 2),
            passed=passed,
            details={
                "empathy_markers_found": found_empathy,
                "has_call_to_action": has_cta,
                "meeting_agreed": sim_meta.get("meeting_agreed", False)
            },
            reasons=reasons,
            failure_type="sales_quality_gap" if not passed else None
        )
