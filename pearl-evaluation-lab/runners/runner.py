"""
Evaluation Suite Runner.
Executes scenarios in parallel or sequential batches with rate-limiting,
trace persistence, error containment, and aggregated metric reporting.
"""
import os
import json
import uuid
import asyncio
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

from adapters.base import BasePearlAdapter, RunRecord
from datasets.schema import EvaluationScenario
from simulators.customer_simulator import CustomerSimulator
from evaluators.base import BaseEvaluator, EvaluationResult
from evaluators import get_all_evaluators
from metrics.scorer import compute_evaluation_summary


class EvaluationRunner:
    """
    Orchestrates batch runs across benchmark scenarios, executes evaluators,
    and records sanitized traces.
    """

    def __init__(
        self,
        adapter: BasePearlAdapter,
        evaluators: Optional[List[BaseEvaluator]] = None,
        max_concurrency: int = 4,
        traces_dir: Optional[Path] = None
    ):
        self.adapter = adapter
        self.evaluators = evaluators or get_all_evaluators()
        self.semaphore = asyncio.Semaphore(max_concurrency)
        self.simulator = CustomerSimulator()
        self.traces_dir = traces_dir or (Path(__file__).parent.parent / "traces").resolve()
        self.traces_dir.mkdir(parents=True, exist_ok=True)

    async def run_scenario(
        self,
        scenario: EvaluationScenario,
        max_turns: int = 4
    ) -> tuple[RunRecord, List[EvaluationResult]]:
        """Executes a single scenario simulation and runs all evaluation dimensions."""
        async with self.semaphore:
            # 1. Run simulation through Pearl adapter
            run_record = await self.simulator.run_simulation(
                adapter=self.adapter,
                scenario=scenario,
                max_turns=max_turns
            )

            # 2. Run evaluators
            eval_results: List[EvaluationResult] = []
            for ev in self.evaluators:
                try:
                    res = ev.evaluate(run_record, scenario)
                    eval_results.append(res)
                except Exception as e:
                    eval_results.append(EvaluationResult(
                        scenario_id=scenario.scenario_id,
                        dimension=ev.dimension_name,
                        score=0.0,
                        passed=False,
                        reasons=[f"Evaluator error: {str(e)}"],
                        failure_type="evaluator_crash"
                    ))

            # 3. Persist sanitized trace file
            self._save_trace(run_record, eval_results)

            return run_record, eval_results

    async def run_suite(
        self,
        scenarios: List[EvaluationScenario],
        suite_name: str = "benchmark_run",
        max_turns: int = 4
    ) -> Dict[str, Any]:
        """Runs an entire collection of scenarios concurrently with progress tracking."""
        start_time = datetime.utcnow()
        suite_id = f"suite-{uuid.uuid4().hex[:10]}"

        tasks = [self.run_scenario(sc, max_turns=max_turns) for sc in scenarios]
        results_pairs = await asyncio.gather(*tasks, return_exceptions=False)

        all_run_records: List[RunRecord] = []
        all_eval_results: List[EvaluationResult] = []
        scenario_summaries: List[Dict[str, Any]] = []

        for scenario, (run_record, eval_results) in zip(scenarios, results_pairs):
            all_run_records.append(run_record)
            all_eval_results.extend(eval_results)

            # Scenario level pass check
            scenario_score = sum(r.score for r in eval_results) / len(eval_results) if eval_results else 0.0
            scenario_passed = all(r.passed for r in eval_results if r.dimension == "safety") and scenario_score >= scenario.min_passing_score

            scenario_summaries.append({
                "scenario_id": scenario.scenario_id,
                "title": scenario.title,
                "category": scenario.category,
                "score": round(scenario_score, 2),
                "passed": scenario_passed,
                "turns_count": len(run_record.turns),
                "duration_seconds": round(run_record.total_duration_seconds, 2),
                "failures": [r.failure_type for r in eval_results if r.failure_type]
            })

        duration = (datetime.utcnow() - start_time).total_seconds()
        metrics_summary = compute_evaluation_summary(all_eval_results)

        return {
            "suite_id": suite_id,
            "suite_name": suite_name,
            "adapter": self.adapter.name,
            "started_at": start_time.isoformat(),
            "total_scenarios": len(scenarios),
            "passed_scenarios": sum(1 for s in scenario_summaries if s["passed"]),
            "duration_seconds": round(duration, 2),
            "metrics": metrics_summary,
            "scenario_results": scenario_summaries
        }

    def _save_trace(self, run: RunRecord, eval_results: List[EvaluationResult]) -> None:
        """Serializes sanitized execution trace to disk."""
        trace_path = self.traces_dir / f"{run.run_id}.json"
        data = {
            "run_id": run.run_id,
            "scenario_id": run.scenario_id,
            "adapter": run.adapter_name,
            "started_at": run.started_at.isoformat(),
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            "duration_seconds": run.total_duration_seconds,
            "turns": [
                {
                    "speaker": t.speaker,
                    "text": t.text,
                    "timestamp": t.timestamp,
                    "latency_ms": t.latency.total_turn_ms,
                    "tools": [e.tool_name for e in t.tool_events]
                }
                for t in run.turns
            ],
            "evaluation_results": [r.dict() for r in eval_results],
            "metadata": run.metadata
        }
        with open(trace_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
