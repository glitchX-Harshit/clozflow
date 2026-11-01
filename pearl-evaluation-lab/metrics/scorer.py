"""
Score Aggregator and Pearl Quality Index (PQI) Calculator.
Computes weighted overall scores, dimension sub-scores, and letter grades.
"""
from typing import List, Dict, Any
from evaluators.base import EvaluationResult
from .dimensions import DIMENSION_WEIGHTS, DIMENSION_PASSING_THRESHOLDS


def get_letter_grade(score: float) -> str:
    if score >= 95.0:
        return "A+"
    elif score >= 90.0:
        return "A"
    elif score >= 80.0:
        return "B"
    elif score >= 70.0:
        return "C"
    else:
        return "F"


def compute_evaluation_summary(results: List[EvaluationResult]) -> Dict[str, Any]:
    """
    Aggregates list of EvaluationResult objects across all scenarios and dimensions.
    Returns composite PQI score, dimension averages, pass rates, and letter grade.
    """
    if not results:
        return {
            "pqi": 0.0,
            "grade": "F",
            "passed": False,
            "total_evaluations": 0,
            "passed_evaluations": 0,
            "pass_rate_pct": 0.0,
            "dimension_scores": {}
        }

    # Group scores by dimension
    dim_scores: Dict[str, List[float]] = {}
    dim_passes: Dict[str, List[bool]] = {}

    for res in results:
        dim = res.dimension
        if dim not in dim_scores:
            dim_scores[dim] = []
            dim_passes[dim] = []
        dim_scores[dim].append(res.score)
        dim_passes[dim].append(res.passed)

    dimension_summary = {}
    weighted_pqi = 0.0
    total_weights_applied = 0.0

    for dim, scores in dim_scores.items():
        avg_score = sum(scores) / len(scores)
        pass_count = sum(1 for p in dim_passes[dim] if p)
        pass_rate = (pass_count / len(scores)) * 100.0

        weight = DIMENSION_WEIGHTS.get(dim, 0.05)
        weighted_pqi += avg_score * weight
        total_weights_applied += weight

        dimension_summary[dim] = {
            "mean_score": round(avg_score, 2),
            "pass_rate_pct": round(pass_rate, 2),
            "weight_pct": round(weight * 100.0, 1),
            "threshold": DIMENSION_PASSING_THRESHOLDS.get(dim, 70.0)
        }

    # Normalize PQI if not all dimensions were evaluated
    final_pqi = (weighted_pqi / total_weights_applied) if total_weights_applied > 0 else 0.0
    final_pqi = round(final_pqi, 2)

    total_evals = len(results)
    total_passed = sum(1 for r in results if r.passed)
    overall_pass_rate = round((total_passed / total_evals) * 100.0, 2)

    return {
        "pqi": final_pqi,
        "grade": get_letter_grade(final_pqi),
        "passed": final_pqi >= 70.0 and overall_pass_rate >= 80.0,
        "total_evaluations": total_evals,
        "passed_evaluations": total_passed,
        "pass_rate_pct": overall_pass_rate,
        "dimension_scores": dimension_summary
    }
