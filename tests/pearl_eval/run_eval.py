"""
Command Line Runner for Pearl AI Voice Agent Evaluation.

Usage:
    # Run full 60-call evaluation benchmark
    python tests/pearl_eval/run_eval.py --full

    # Run quick smoke test (2 calls)
    python tests/pearl_eval/run_eval.py --smoke

    # Run specific scenario (12 calls)
    python tests/pearl_eval/run_eval.py --scenario S1

    # Regenerate report from existing transcripts
    python tests/pearl_eval/run_eval.py --report-only
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

async def main():
    parser = argparse.ArgumentParser(description="Pearl AI Voice Agent Evaluation Harness")
    parser.add_argument("--full", action="store_true", help="Execute the complete 60-call matrix (5x6x2)")
    parser.add_argument("--smoke", action="store_true", help="Run 2-call smoke test to verify execution")
    parser.add_argument("--scenario", type=str, choices=["S1", "S2", "S3", "S4", "S5"], help="Run specific scenario (12 calls)")
    parser.add_argument("--max-calls", type=int, help="Limit maximum calls to run")
    parser.add_argument("--report-only", action="store_true", help="Only generate report from existing transcripts")

    args = parser.parse_args()

    if args.report_only:
        print("Generating evaluation report from stored transcripts...")
        generator = PearlReportGenerator()
        generator.generate_report()
        return

    harness = PearlEvaluationHarness(delay_between_turns=0.8, delay_between_calls=1.2)

    if args.smoke:
        print("=== RUNNING SMOKE TEST (2 CALLS) ===")
        await harness.run_matrix(max_calls=2)
    elif args.scenario:
        print(f"=== RUNNING SCENARIO {args.scenario} (12 CALLS) ===")
        await harness.run_matrix(single_scenario=args.scenario)
    elif args.full or not any([args.smoke, args.scenario, args.max_calls]):
        print("=== RUNNING FULL EVALUATION MATRIX (60 CALLS: 5 SCENARIOS x 6 PERSONAS x 2 SEEDS) ===")
        await harness.run_matrix(max_calls=args.max_calls)
    else:
        await harness.run_matrix(max_calls=args.max_calls)

    print("\n=== COMPILING EVALUATION REPORT (tests/pearl_eval/report.md) ===")
    generator = PearlReportGenerator()
    generator.generate_report()
    print("Benchmark complete!")

if __name__ == "__main__":
    asyncio.run(main())
