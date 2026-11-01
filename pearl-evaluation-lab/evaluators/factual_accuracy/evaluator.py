"""
Factual Accuracy Evaluator.
Verifies that Pearl's responses mention verified business facts and do not assert false statements.
"""
from typing import List
from evaluators.base import BaseEvaluator, EvaluationResult
from adapters.base import RunRecord
from datasets.schema import EvaluationScenario


class FactualAccuracyEvaluator(BaseEvaluator):
    def __init__(self, passing_threshold: float = 75.0):
        super().__init__(dimension_name="factual_accuracy", passing_threshold=passing_threshold)

    def evaluate(self, run: RunRecord, scenario: EvaluationScenario) -> EvaluationResult:
        pearl_texts = [t.text for t in run.turns if t.speaker == "pearl"]
        combined_text = " ".join(pearl_texts).lower()

        reasons: List[str] = []
        facts_found = 0
        total_facts = len(scenario.expected_facts)

        for fact in scenario.expected_facts:
            if fact.lower() in combined_text:
                facts_found += 1
            else:
                reasons.append(f"Expected fact missing: '{fact}'")

        # Check for forbidden claims
        forbidden_hits = []
        for claim in scenario.forbidden_claims:
            if claim.lower() in combined_text:
                forbidden_hits.append(claim)
                reasons.append(f"Forbidden claim asserted: '{claim}'")

        # Score calculation
        fact_ratio = (facts_found / total_facts) if total_facts > 0 else 1.0
        base_score = fact_ratio * 100.0

        # Severe penalty for forbidden claims
        if forbidden_hits:
            base_score = max(0.0, base_score - (len(forbidden_hits) * 40.0))

        passed = base_score >= self.passing_threshold and len(forbidden_hits) == 0
        failure_type = "hallucination" if forbidden_hits else ("knowledge_gap" if not passed else None)

        return EvaluationResult(
            scenario_id=scenario.scenario_id,
            dimension=self.dimension_name,
            score=round(base_score, 2),
            passed=passed,
            details={
                "expected_facts_total": total_facts,
                "expected_facts_found": facts_found,
                "forbidden_claims_detected": forbidden_hits
            },
            reasons=reasons,
            failure_type=failure_type
        )
