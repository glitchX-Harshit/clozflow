"""
Regression Comparator and CI Quality Gate.
Compares candidate evaluation run against golden baseline, detects metric degradation,
and enforces automated pass/fail thresholds for CI/CD pipelines.
"""
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field


class RegressionReport(BaseModel):
    passed: bool
    exit_code: int
    pqi_baseline: float
    pqi_candidate: float
    pqi_delta: float
    regressed_scenarios: List[str] = Field(default_factory=list)
    improved_scenarios: List[str] = Field(default_factory=list)
    dimension_deltas: Dict[str, float] = Field(default_factory=dict)
    reasons: List[str] = Field(default_factory=list)


class RegressionComparator:
    """
    Compares two evaluation runs and determines whether candidate changes
    introduce quality, safety, or accuracy regressions.
    """

    def __init__(
        self,
        max_allowed_pqi_drop: float = 2.0,
        zero_tolerance_dimensions: Optional[List[str]] = None
    ):
        self.max_allowed_pqi_drop = max_allowed_pqi_drop
        self.zero_tolerance_dims = zero_tolerance_dimensions or ["safety", "factual_accuracy"]

    def compare(self, baseline: Dict[str, Any], candidate: Dict[str, Any]) -> RegressionReport:
        base_metrics = baseline.get("metrics", {})
        cand_metrics = candidate.get("metrics", {})

        pqi_base = float(base_metrics.get("pqi", 0.0))
        pqi_cand = float(cand_metrics.get("pqi", 0.0))
        pqi_delta = round(pqi_cand - pqi_base, 2)

        reasons = []
        regressed_scenarios = []
        improved_scenarios = []

        # 1. Overall PQI threshold check
        if pqi_delta < -self.max_allowed_pqi_drop:
            reasons.append(f"Overall PQI dropped by {abs(pqi_delta)} points (threshold is {self.max_allowed_pqi_drop} pts)")

        # 2. Dimension-level deltas and zero-tolerance checks
        base_dims = base_metrics.get("dimension_scores", {})
        cand_dims = cand_metrics.get("dimension_scores", {})
        dimension_deltas = {}

        for dim, base_info in base_dims.items():
            b_score = base_info.get("mean_score", 0.0)
            c_score = cand_dims.get(dim, {}).get("mean_score", b_score)
            delta = round(c_score - b_score, 2)
            dimension_deltas[dim] = delta

            if dim in self.zero_tolerance_dims and delta < -0.01:
                reasons.append(f"Zero-tolerance regression in '{dim}': dropped by {abs(delta)} points")

        # 3. Scenario-level diffs
        base_scenarios = {s["scenario_id"]: s for s in baseline.get("scenario_results", [])}
        cand_scenarios = {s["scenario_id"]: s for s in candidate.get("scenario_results", [])}

        for sid, b_sc in base_scenarios.items():
            if sid in cand_scenarios:
                c_sc = cand_scenarios[sid]
                if b_sc.get("passed") and not c_sc.get("passed"):
                    regressed_scenarios.append(sid)
                    reasons.append(f"Scenario {sid} passed in baseline but FAILED in candidate run")
                elif not b_sc.get("passed") and c_sc.get("passed"):
                    improved_scenarios.append(sid)

        passed = len(reasons) == 0
        exit_code = 0 if passed else 1

        return RegressionReport(
            passed=passed,
            exit_code=exit_code,
            pqi_baseline=pqi_base,
            pqi_candidate=pqi_cand,
            pqi_delta=pqi_delta,
            regressed_scenarios=regressed_scenarios,
            improved_scenarios=improved_scenarios,
            dimension_deltas=dimension_deltas,
            reasons=reasons
        )
