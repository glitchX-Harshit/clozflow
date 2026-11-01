"""
Standalone Test Runner for Pearl Evaluation Lab.
Runs all unit and integration tests using Python standard library without requiring pytest.
"""
import sys
import traceback
from pathlib import Path

# Add lab root to path
LAB_ROOT = Path(__file__).parent.parent.resolve()
if str(LAB_ROOT) not in sys.path:
    sys.path.insert(0, str(LAB_ROOT))

# Import test functions
import asyncio
from tests.test_isolation import (
    test_production_modules_do_not_import_lab,
    test_isolation_policy_config,
    test_lab_does_not_touch_production_database
)
from tests.test_adapters import (
    test_mock_adapter_lifecycle,
    test_direct_adapter_graceful_missing_credentials,
    test_api_adapter_graceful_offline
)
from tests.test_dataset_validation import (
    test_all_100_scenarios_valid,
    test_scenario_filtering
)
from tests.test_simulator import (
    test_persona_engine_intent_updates,
    test_customer_simulator_end_to_end
)
from tests.test_evaluators import (
    test_factual_accuracy_evaluator,
    test_safety_evaluator,
    test_voice_wer_cer,
    test_latency_profiler
)
from tests.test_regression import (
    test_regression_comparator_passes_on_stable_metrics,
    test_regression_comparator_fails_on_safety_drop
)

SYNC_TESTS = [
    ("test_production_modules_do_not_import_lab", test_production_modules_do_not_import_lab),
    ("test_isolation_policy_config", test_isolation_policy_config),
    ("test_lab_does_not_touch_production_database", test_lab_does_not_touch_production_database),
    ("test_all_100_scenarios_valid", test_all_100_scenarios_valid),
    ("test_scenario_filtering", test_scenario_filtering),
    ("test_persona_engine_intent_updates", test_persona_engine_intent_updates),
    ("test_factual_accuracy_evaluator", test_factual_accuracy_evaluator),
    ("test_safety_evaluator", test_safety_evaluator),
    ("test_voice_wer_cer", test_voice_wer_cer),
    ("test_latency_profiler", test_latency_profiler),
    ("test_regression_comparator_passes_on_stable_metrics", test_regression_comparator_passes_on_stable_metrics),
    ("test_regression_comparator_fails_on_safety_drop", test_regression_comparator_fails_on_safety_drop),
]

ASYNC_TESTS = [
    ("test_mock_adapter_lifecycle", test_mock_adapter_lifecycle),
    ("test_direct_adapter_graceful_missing_credentials", test_direct_adapter_graceful_missing_credentials),
    ("test_api_adapter_graceful_offline", test_api_adapter_graceful_offline),
    ("test_customer_simulator_end_to_end", test_customer_simulator_end_to_end),
]


def run_all():
    print("=" * 60)
    print(" Running Pearl Evaluation Lab Test Suite")
    print("=" * 60)
    passed = 0
    failed = 0

    for name, fn in SYNC_TESTS:
        try:
            fn()
            print(f"[PASS] {name}")
            passed += 1
        except Exception as e:
            print(f"[FAIL] {name}: {e}")
            traceback.print_exc()
            failed += 1

    for name, fn in ASYNC_TESTS:
        try:
            asyncio.run(fn())
            print(f"[PASS] {name}")
            passed += 1
        except Exception as e:
            print(f"[FAIL] {name}: {e}")
            traceback.print_exc()
            failed += 1

    print("=" * 60)
    print(f"Results: {passed} PASSED, {failed} FAILED (Total: {passed + failed})")
    print("=" * 60)
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    run_all()
