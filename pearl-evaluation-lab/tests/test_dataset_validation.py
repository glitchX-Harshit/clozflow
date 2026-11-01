"""
Unit Tests for Benchmark Datasets.
Verifies all 100 scenario schemas, non-empty contexts, and tag validity.
"""
from datasets.loader import validate_all_datasets, load_scenarios


def test_all_100_scenarios_valid():
    report = validate_all_datasets()
    assert report["is_valid"] is True, f"Errors in dataset: {report['errors']}"
    assert report["valid_scenarios"] >= 100, f"Expected at least 100 scenarios, got {report['valid_scenarios']}"
    assert len(report["categories_found"]) == 10, f"Expected 10 categories, got {len(report['categories_found'])}"


def test_scenario_filtering():
    inbound = load_scenarios(category="inbound_enquiries")
    assert len(inbound) == 10
    for sc in inbound:
        assert sc.category == "inbound_enquiries"
        assert len(sc.business_context.product_name) > 0

    specific = load_scenarios(scenario_id="INB-001")
    assert len(specific) == 1
    assert specific[0].scenario_id == "INB-001"
