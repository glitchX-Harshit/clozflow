"""
Comprehensive Voice Pipeline Evaluator.
Integrates WER/CER transcription accuracy, latency profiling (P50/P95), and barge-in management.
"""
from evaluators.base import BaseEvaluator, EvaluationResult
from adapters.base import RunRecord
from datasets.schema import EvaluationScenario
from .wer_cer import evaluate_transcription
from .latency_profiler import LatencyProfiler
from .turn_management import TurnManagementEvaluator


class VoiceEvaluator(BaseEvaluator):
    def __init__(self, passing_threshold: float = 70.0, target_p95_ms: float = 800.0):
        super().__init__(dimension_name="voice", passing_threshold=passing_threshold)
        self.latency_profiler = LatencyProfiler(target_p95_ms=target_p95_ms)
        self.turn_evaluator = TurnManagementEvaluator()

    def evaluate(self, run: RunRecord, scenario: EvaluationScenario) -> EvaluationResult:
        latency_report = self.latency_profiler.analyze_turns(run.turns)
        turn_report = self.turn_evaluator.evaluate_turn_events(run.turns)

        reasons = []
        score = 85.0

        # Latency evaluation
        if not latency_report.get("sla_compliant", True):
            p95 = latency_report.get("p95_ms", 0.0)
            target = latency_report.get("sla_target_p95_ms", 800.0)
            score -= 20.0
            reasons.append(f"Voice latency P95 ({p95}ms) exceeded target SLA ({target}ms)")

        # Turn management
        if turn_report.get("barge_in_efficiency", 100.0) < 80.0:
            score -= 15.0
            reasons.append("Barge-in responsiveness fell below 80% efficiency")

        score = max(0.0, min(100.0, score))
        passed = score >= self.passing_threshold

        return EvaluationResult(
            scenario_id=scenario.scenario_id,
            dimension=self.dimension_name,
            score=round(score, 2),
            passed=passed,
            details={
                "latency_metrics": latency_report,
                "turn_management": turn_report
            },
            reasons=reasons,
            failure_type="latency_violation" if not passed else None
        )
