"""
Pearl Evaluation Lab CLI (pearl-eval).
Standalone command-line interface for AI benchmarking, simulation, and CI regression gating.
"""
import sys
import os
import json
import asyncio
import argparse
from pathlib import Path
from typing import Optional, List

# Ensure lab package is importable
LAB_ROOT = Path(__file__).parent.parent.resolve()
if str(LAB_ROOT) not in sys.path:
    sys.path.insert(0, str(LAB_ROOT))

from adapters import get_adapter
from datasets.loader import load_scenarios, validate_all_datasets
from runners.runner import EvaluationRunner
from simulators.customer_simulator import CustomerSimulator
from benchmarks.benchmark import BenchmarkManager
from evaluators.regression.comparator import RegressionComparator
from reports.reporter import ReportGenerator


def cmd_inspect(args):
    """Check adapter availability, system isolation, and environment readiness."""
    print("==================================================")
    print(" Pearl Evaluation Lab — Isolation & Adapter Check")
    print("==================================================")
    print(f"Lab Root: {LAB_ROOT}")
    print(f"Backend Isolation: Strict (Read-Only / Sandboxed)")
    print(f"Telephony Policy: allow_real_telephony = FALSE (Enforced)")

    adapters_to_test = ["mock", "direct", "api"]
    for name in adapters_to_test:
        try:
            adapter = get_adapter(name)
            ready, msg = asyncio.run(adapter.is_available())
            status = "READY" if ready else "UNAVAILABLE"
            print(f"[{status}] Adapter '{name}': {msg}")
        except Exception as e:
            print(f"[ERROR] Adapter '{name}': {e}")
    print("==================================================")


def cmd_validate_datasets(args):
    """Validate all benchmark datasets against schema."""
    print("Validating all benchmark datasets...")
    report = validate_all_datasets()
    print(f"Scenarios Validated: {report['valid_scenarios']}")
    print(f"Categories Found: {len(report['categories_found'])} -> {report['categories_found']}")
    if report["errors"]:
        print(f"Validation FAILED with {len(report['errors'])} errors:")
        for err in report["errors"][:10]:
            print(f" - {err}")
        sys.exit(1)
    else:
        print("Dataset validation PASSED with 0 errors.")


def cmd_list_datasets(args):
    """List available scenarios filtered by category or tags."""
    scenarios = load_scenarios(category=args.category, scenario_id=args.scenario)
    print(f"Found {len(scenarios)} matching scenario(s):")
    for sc in scenarios:
        print(f" - [{sc.scenario_id}] ({sc.category}) {sc.title} [min_score: {sc.min_passing_score}]")


def cmd_simulate(args):
    """Run an automated multi-turn prospect simulation for a specific scenario."""
    scenarios = load_scenarios(scenario_id=args.scenario)
    if not scenarios:
        print(f"Scenario '{args.scenario}' not found.")
        sys.exit(1)
    scenario = scenarios[0]

    adapter = get_adapter(args.adapter)
    ready, msg = asyncio.run(adapter.is_available())
    if not ready:
        print(f"Adapter '{args.adapter}' is not ready: {msg}")
        sys.exit(1)

    print(f"\n--- Starting Simulation for Scenario: {scenario.scenario_id} ({scenario.title}) ---")
    sim = CustomerSimulator()
    run = asyncio.run(sim.run_simulation(adapter, scenario, max_turns=args.max_turns))

    print(f"\nSimulation Complete! Total Turns: {len(run.turns)} (Duration: {round(run.total_duration_seconds, 2)}s)")
    for t in run.turns:
        speaker_tag = "[PROSPECT]" if t.speaker == "prospect" else "[PEARL]   "
        latency_str = f"({round(t.latency.total_turn_ms)}ms)" if t.speaker == "pearl" else ""
        print(f"{speaker_tag} {t.text} {latency_str}")

    print("\nPersona Outcome State:")
    sim_meta = run.metadata.get("simulation", {})
    for k, v in sim_meta.items():
        print(f" - {k}: {v}")


def cmd_run(args):
    """Run an evaluation suite across selected scenarios."""
    scenarios = load_scenarios(category=args.category, scenario_id=args.scenario)
    if not scenarios:
        print("No matching scenarios found for evaluation.")
        sys.exit(1)

    adapter = get_adapter(args.adapter)
    ready, msg = asyncio.run(adapter.is_available())
    if not ready:
        print(f"Adapter '{args.adapter}' is not available: {msg}")
        sys.exit(1)

    print(f"Starting evaluation of {len(scenarios)} scenario(s) using adapter '{args.adapter}'...")
    runner = EvaluationRunner(adapter=adapter, max_concurrency=args.concurrency)
    suite_summary = asyncio.run(runner.run_suite(scenarios, suite_name=args.suite_name, max_turns=args.max_turns))

    # Generate reports
    reporter = ReportGenerator()
    report_paths = reporter.generate_all(suite_summary, output_prefix=args.suite_name)

    # Save baseline if requested
    if args.save_baseline:
        bm = BenchmarkManager()
        bm.save_baseline(args.save_baseline, suite_summary)
        print(f"Saved golden baseline: '{args.save_baseline}'")

    m = suite_summary["metrics"]
    print("\n==================================================")
    print(f" Suite Completed: {suite_summary['suite_id']}")
    print(f" Overall PQI Score: {m['pqi']} / 100.0 (Grade: {m['grade']})")
    print(f" Total Scenarios: {suite_summary['total_scenarios']} | Passed: {suite_summary['passed_scenarios']}")
    print(f" Pass Rate: {m['pass_rate_pct']}% | Overall: {'PASSED' if m['passed'] else 'FAILED'}")
    print(f" Markdown Report: {report_paths['markdown']}")
    print(f" HTML Dashboard:  {report_paths['html']}")
    print("==================================================")


def cmd_compare(args):
    """Compare candidate evaluation run against a baseline file."""
    bm = BenchmarkManager()
    base_data = bm.load_baseline(args.baseline)

    with open(args.candidate, "r", encoding="utf-8") as f:
        cand_data = json.load(f)

    comparator = RegressionComparator(max_allowed_pqi_drop=args.max_pqi_drop)
    report = comparator.compare(base_data, cand_data)

    print("==================================================")
    print(" Pearl Evaluation Lab — Benchmark Comparison")
    print("==================================================")
    print(f"Baseline PQI:  {report.pqi_baseline}")
    print(f"Candidate PQI: {report.pqi_candidate}")
    print(f"Delta:         {'+' if report.pqi_delta >= 0 else ''}{report.pqi_delta} pts")
    print(f"Regressed Scenarios ({len(report.regressed_scenarios)}): {report.regressed_scenarios}")
    print(f"Improved Scenarios  ({len(report.improved_scenarios)}): {report.improved_scenarios}")
    if report.reasons:
        print("\nRegression Alerts:")
        for r in report.reasons:
            print(f" [!] {r}")
    print(f"\nFinal CI Result: {'PASSED' if report.passed else 'FAILED'}")
    print("==================================================")
    sys.exit(report.exit_code)


def cmd_regression(args):
    """CI/CD Regression Check: Run evaluation on candidate and compare against baseline."""
    bm = BenchmarkManager()
    try:
        baseline = bm.load_baseline(args.baseline)
    except FileNotFoundError:
        print(f"Baseline '{args.baseline}' not found. Creating new baseline from this run...")
        scenarios = load_scenarios(category=args.category)
        adapter = get_adapter(args.adapter)
        runner = EvaluationRunner(adapter=adapter, max_concurrency=args.concurrency)
        candidate = asyncio.run(runner.run_suite(scenarios, suite_name="baseline_init"))
        bm.save_baseline(args.baseline, candidate)
        print(f"Baseline '{args.baseline}' created successfully (PQI: {candidate['metrics']['pqi']}).")
        sys.exit(0)

    scenarios = load_scenarios(category=args.category)
    adapter = get_adapter(args.adapter)
    runner = EvaluationRunner(adapter=adapter, max_concurrency=args.concurrency)
    candidate = asyncio.run(runner.run_suite(scenarios, suite_name="regression_candidate"))

    comparator = RegressionComparator(max_allowed_pqi_drop=args.max_pqi_drop)
    report = comparator.compare(baseline, candidate)

    print("==================================================")
    print(" CI/CD Regression Evaluation Summary")
    print("==================================================")
    print(f"Baseline PQI:  {report.pqi_baseline}")
    print(f"Candidate PQI: {report.pqi_candidate}")
    print(f"Delta:         {report.pqi_delta}")
    print(f"Status:        {'PASSED (No Regressions)' if report.passed else 'FAILED (Regressions Detected)'}")
    print("==================================================")
    sys.exit(report.exit_code)


def cmd_cleanup(args):
    """Clean traces and generated report files safely."""
    traces_dir = LAB_ROOT / "traces"
    reports_dir = LAB_ROOT / "reports"
    cleaned = 0

    if traces_dir.exists():
        for f in traces_dir.glob("*.json"):
            f.unlink()
            cleaned += 1

    print(f"Cleaned {cleaned} temporary trace files.")


def main():
    parser = argparse.ArgumentParser(
        prog="pearl-eval",
        description="Pearl Evaluation Lab — AI Sales Agent Benchmarking Framework"
    )
    subparsers = parser.add_subparsers(dest="command", help="Available subcommands")

    # inspect
    subparsers.add_parser("inspect", help="Inspect adapter connectivity and isolation")

    # validate-datasets
    subparsers.add_parser("validate-datasets", help="Validate benchmark dataset schemas")

    # list-datasets
    p_list = subparsers.add_parser("list-datasets", help="List scenarios")
    p_list.add_argument("--category", "-c", type=str, default=None, help="Filter by category")
    p_list.add_argument("--scenario", "-s", type=str, default=None, help="Filter by scenario ID")

    # simulate
    p_sim = subparsers.add_parser("simulate", help="Run dynamic prospect simulation")
    p_sim.add_argument("--scenario", "-s", type=str, required=True, help="Scenario ID (e.g. INB-001)")
    p_sim.add_argument("--adapter", "-a", type=str, default="mock", choices=["mock", "direct", "api"], help="Adapter mode")
    p_sim.add_argument("--max-turns", "-t", type=int, default=4, help="Max conversation turns")

    # run
    p_run = subparsers.add_parser("run", help="Run evaluation suite")
    p_run.add_argument("--adapter", "-a", type=str, default="mock", choices=["mock", "direct", "api"], help="Adapter mode")
    p_run.add_argument("--category", "-c", type=str, default=None, help="Category filter")
    p_run.add_argument("--scenario", "-s", type=str, default=None, help="Specific scenario ID")
    p_run.add_argument("--suite-name", type=str, default="benchmark_run", help="Suite identifier")
    p_run.add_argument("--concurrency", type=int, default=4, help="Max concurrent executions")
    p_run.add_argument("--max-turns", type=int, default=4, help="Max turns per scenario")
    p_run.add_argument("--save-baseline", type=str, default=None, help="Save result as golden baseline")

    # compare
    p_comp = subparsers.add_parser("compare", help="Compare candidate run against baseline")
    p_comp.add_argument("--baseline", "-b", type=str, required=True, help="Baseline name")
    p_comp.add_argument("--candidate", "-c", type=str, required=True, help="Candidate run JSON file")
    p_comp.add_argument("--max-pqi-drop", type=float, default=2.0, help="Max allowed PQI drop")

    # regression
    p_reg = subparsers.add_parser("regression", help="Run CI regression evaluation")
    p_reg.add_argument("--baseline", "-b", type=str, default="v1_baseline", help="Baseline name")
    p_reg.add_argument("--adapter", "-a", type=str, default="mock", help="Adapter mode")
    p_reg.add_argument("--category", "-c", type=str, default=None, help="Category filter")
    p_reg.add_argument("--concurrency", type=int, default=4, help="Max concurrency")
    p_reg.add_argument("--max-pqi-drop", type=float, default=2.0, help="Max allowed drop")

    # cleanup
    subparsers.add_parser("cleanup", help="Clean up trace files")

    args = parser.parse_args()

    commands = {
        "inspect": cmd_inspect,
        "validate-datasets": cmd_validate_datasets,
        "list-datasets": cmd_list_datasets,
        "simulate": cmd_simulate,
        "run": cmd_run,
        "compare": cmd_compare,
        "regression": cmd_regression,
        "cleanup": cmd_cleanup
    }

    if args.command in commands:
        commands[args.command](args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
