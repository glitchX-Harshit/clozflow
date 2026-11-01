"""
Qualification Evaluator.
Measures Pearl's ability to discover BANT (Budget, Authority, Need, Timeline)
and qualify leads without sounding like a robotic survey.
"""
from typing import List
from evaluators.base import BaseEvaluator, EvaluationResult
from adapters.base import RunRecord
from datasets.schema import EvaluationScenario


class QualificationEvaluator(BaseEvaluator):
    def __init__(self, passing_threshold: float = 70.0):
        super().__init__(dimension_name="qualification", passing_threshold=passing_threshold)

    def evaluate(self, run: RunRecord, scenario: EvaluationScenario) -> EvaluationResult:
        criteria = scenario.qualification_criteria
        if not criteria:
            # If scenario does not mandate qualification, return neutral pass
            return EvaluationResult(
                scenario_id=scenario.scenario_id,
                dimension=self.dimension_name,
                score=100.0,
                passed=True,
                details={"status": "not_applicable"}
            )

        combined_text = " ".join([t.text for t in run.turns if t.speaker == "pearl"]).lower()
        prospect_text = " ".join([t.text for t in run.turns if t.speaker == "prospect"]).lower()

        reasons: List[str] = []
        dimensions_covered = 0
        total_required = len(criteria.required_dimensions)

        for dim in criteria.required_dimensions:
            dim = dim.lower()
            if dim == "need":
                if any(w in combined_text or w in prospect_text for w in ["leads", "problem", "calls", "team", "requirement", "volume"]):
                    dimensions_covered += 1
                else:
                    reasons.append("Need dimension not uncovered")
            elif dim == "budget":
                if any(w in combined_text or w in prospect_text for w in ["budget", "price", "plan", "inr", "rupees", "cost"]):
                    dimensions_covered += 1
                else:
                    reasons.append("Budget dimension not uncovered")
            elif dim == "authority":
                if any(w in combined_text or w in prospect_text for w in ["director", "founder", "head", "decision", "vp", "manager", "team"]):
                    dimensions_covered += 1
                else:
                    reasons.append("Authority dimension not uncovered")
            elif dim == "timeline":
                if any(w in combined_text or w in prospect_text for w in ["week", "month", "start", "timeline", "kal", "tomorrow", "soon"]):
                    dimensions_covered += 1
                else:
                    reasons.append("Timeline dimension not uncovered")

        ratio = (dimensions_covered / total_required) if total_required > 0 else 1.0
        score = ratio * 100.0
        passed = score >= self.passing_threshold

        return EvaluationResult(
            scenario_id=scenario.scenario_id,
            dimension=self.dimension_name,
            score=round(score, 2),
            passed=passed,
            details={
                "dimensions_required": criteria.required_dimensions,
                "dimensions_covered_count": dimensions_covered,
                "coverage_ratio": ratio
            },
            reasons=reasons,
            failure_type="qualification_gap" if not passed else None
        )
