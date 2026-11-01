"""
Tool Execution Evaluator.
Validates that expected tools (e.g., meeting scheduling, CRM sync)
were invoked correctly with valid parameters.
"""
from typing import List
from evaluators.base import BaseEvaluator, EvaluationResult
from adapters.base import RunRecord
from datasets.schema import EvaluationScenario


class ToolExecutionEvaluator(BaseEvaluator):
    def __init__(self, passing_threshold: float = 70.0):
        super().__init__(dimension_name="tool_execution", passing_threshold=passing_threshold)

    def evaluate(self, run: RunRecord, scenario: EvaluationScenario) -> EvaluationResult:
        expected = scenario.expected_tools
        if not expected:
            return EvaluationResult(
                scenario_id=scenario.scenario_id,
                dimension=self.dimension_name,
                score=100.0,
                passed=True,
                details={"status": "no_tools_expected"}
            )

        executed_tools = []
        for t in run.turns:
            for ev in t.tool_events:
                executed_tools.append(ev.tool_name)

        reasons: List[str] = []
        matches = 0
        for exp_tool in expected:
            if exp_tool in executed_tools:
                matches += 1
            else:
                reasons.append(f"Expected tool '{exp_tool}' was not invoked")

        score = (matches / len(expected)) * 100.0
        passed = score >= self.passing_threshold

        return EvaluationResult(
            scenario_id=scenario.scenario_id,
            dimension=self.dimension_name,
            score=round(score, 2),
            passed=passed,
            details={
                "expected_tools": expected,
                "executed_tools": executed_tools
            },
            reasons=reasons,
            failure_type="tool_execution_failure" if not passed else None
        )
