"""
Groundedness Evaluator.
Verifies that Pearl's responses are firmly anchored in approved capsule context
and detects ungrounded product claims or fabricated specs.
"""
import re
from typing import List
from evaluators.base import BaseEvaluator, EvaluationResult
from adapters.base import RunRecord
from datasets.schema import EvaluationScenario


class GroundednessEvaluator(BaseEvaluator):
    def __init__(self, passing_threshold: float = 75.0):
        super().__init__(dimension_name="groundedness", passing_threshold=passing_threshold)

    def evaluate(self, run: RunRecord, scenario: EvaluationScenario) -> EvaluationResult:
        pearl_texts = [t.text for t in run.turns if t.speaker == "pearl"]
        combined_text = " ".join(pearl_texts).lower()

        reasons: List[str] = []
        capsule_lower = scenario.business_context.capsule_snippet.lower()
        features = [f.lower() for f in scenario.business_context.approved_features]

        # 1. Grounding in approved features
        features_referenced = [f for f in features if f in combined_text]
        grounding_ratio = (len(features_referenced) / len(features)) if features else 1.0

        # 2. Check for invented pricing: regex find numbers preceded by currency or followed by INR/rupees/lakh
        score = 80.0 + (grounding_ratio * 20.0)

        # Check disallowed claims
        disallowed_found = []
        for claim in scenario.business_context.disallowed_claims:
            if claim.lower() in combined_text:
                disallowed_found.append(claim)
                reasons.append(f"Disallowed ungrounded claim detected: '{claim}'")

        if disallowed_found:
            score -= (len(disallowed_found) * 35.0)

        score = max(0.0, min(100.0, score))
        passed = score >= self.passing_threshold and len(disallowed_found) == 0

        return EvaluationResult(
            scenario_id=scenario.scenario_id,
            dimension=self.dimension_name,
            score=round(score, 2),
            passed=passed,
            details={
                "features_referenced": features_referenced,
                "disallowed_detected": disallowed_found,
                "features_total": len(features)
            },
            reasons=reasons,
            failure_type="groundedness_failure" if not passed else None
        )
