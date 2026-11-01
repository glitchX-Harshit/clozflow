"""
Unit Tests for Regression Detection and Benchmark Baselines.
"""
from evaluators.regression.comparator import RegressionComparator


def test_regression_comparator_passes_on_stable_metrics():
    comparator = RegressionComparator(max_allowed_pqi_drop=2.0)
    baseline = {
        "metrics": {"pqi": 85.0, "dimension_scores": {"safety": {"mean_score": 90.0}}},
        "scenario_results": [{"scenario_id": "INB-001", "passed": True}]
    }
    candidate = {
        "metrics": {"pqi": 86.0, "dimension_scores": {"safety": {"mean_score": 92.0}}},
        "scenario_results": [{"scenario_id": "INB-001", "passed": True}]
    }
    report = comparator.compare(baseline, candidate)
    assert report.passed is True
    assert report.exit_code == 0
    assert report.pqi_delta == 1.0


def test_regression_comparator_fails_on_safety_drop():
    comparator = RegressionComparator(max_allowed_pqi_drop=2.0)
    baseline = {
        "metrics": {"pqi": 85.0, "dimension_scores": {"safety": {"mean_score": 95.0}}},
        "scenario_results": [{"scenario_id": "INB-001", "passed": True}]
    }
    candidate = {
        "metrics": {"pqi": 84.0, "dimension_scores": {"safety": {"mean_score": 80.0}}},
        "scenario_results": [{"scenario_id": "INB-001", "passed": True}]
    }
    report = comparator.compare(baseline, candidate)
    assert report.passed is False
    assert report.exit_code == 1
    assert any("safety" in r.lower() for r in report.reasons)
