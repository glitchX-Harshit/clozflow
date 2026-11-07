"""
Command Line Runner for Pearl AI Voice Agent Evaluation.

Usage:
    # Run full 300-call evaluation benchmark (5 scenarios x 6 personas x 10 seeds)
    python -m tests.pearl_eval.run_eval --full

    # Run quick smoke test (2 calls)
    python -m tests.pearl_eval.run_eval --smoke

    # Run specific scenario (60 calls)
    python -m tests.pearl_eval.run_eval --scenario S1

    # Run 15-case mutation test benchmark
    python -m tests.pearl_eval.run_eval --mutation-test

    # Regenerate report from existing transcripts
    python -m tests.pearl_eval.run_eval --report-only
"""
import sys
import argparse
import asyncio
from pathlib import Path

# Add project root to sys.path
root_dir = Path(__file__).parent.parent.parent.resolve()
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from tests.pearl_eval.harness import PearlEvaluationHarness
from tests.pearl_eval.reporter import PearlReportGenerator
from tests.pearl_eval.mutation_test import run_mutation_tests

async def main():
    parser = argparse.ArgumentParser(description="Pearl AI Voice Agent Evaluation Harness")
    parser.add_argument("--full", action="store_true", help="Execute the complete 300-call matrix (5x6x10)")
    parser.add_argument("--smoke", action="store_true", help="Run 2-call smoke test to verify execution")
    parser.add_argument("--scenario", type=str, choices=["S1", "S2", "S3", "S4", "S5"], help="Run specific scenario")
    parser.add_argument("--max-calls", type=int, help="Limit maximum calls to run")
    parser.add_argument("--concurrency", type=int, default=4, help="Concurrent async calls (default: 4)")
    parser.add_argument("--seeds", type=int, default=10, help="Number of seeds/variations (default: 10 -> 300 calls)")
    parser.add_argument("--mutation-test", action="store_true", help="Run 15-case mutation benchmark")
    parser.add_argument("--report-only", action="store_true", help="Only generate report from existing transcripts")

    args = parser.parse_args()

    if args.mutation_test:
        print("=== RUNNING MUTATION BENCHMARK (15 KNOWN INJECTED VIOLATIONS) ===")
        run_mutation_tests()
        return

    if args.report_only:
        print("Generating evaluation report from stored transcripts...")
        generator = PearlReportGenerator()
        generator.generate_report()
        return

    harness = PearlEvaluationHarness(delay_between_turns=0.1, delay_between_calls=0.1, concurrency=args.concurrency)
    active_seeds = list(range(1, args.seeds + 1))

    if args.smoke:
        print("=== RUNNING SMOKE TEST (2 CALLS) ===")
        await harness.run_matrix(max_calls=2, seeds=[1])
    elif args.scenario:
        print(f"=== RUNNING SCENARIO {args.scenario} ({6 * len(active_seeds)} CALLS) ===")
        await harness.run_matrix(single_scenario=args.scenario, seeds=active_seeds, max_calls=args.max_calls)
    elif args.full or not any([args.smoke, args.scenario, args.max_calls]):
        print(f"=== RUNNING FULL EVALUATION MATRIX ({5 * 6 * len(active_seeds)} CALLS: 5 SCENARIOS x 6 PERSONAS x {len(active_seeds)} SEEDS) ===")
        await harness.run_matrix(seeds=active_seeds, max_calls=args.max_calls)
    else:
        await harness.run_matrix(seeds=active_seeds, max_calls=args.max_calls)

    print("\n=== COMPILING EVALUATION REPORT (tests/pearl_eval/report.md) ===")
    generator = PearlReportGenerator()
    generator.generate_report()
    print("Benchmark complete!")

if __name__ == "__main__":
    asyncio.run(main())
