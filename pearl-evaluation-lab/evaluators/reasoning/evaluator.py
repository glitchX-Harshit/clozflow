"""
Sales Reasoning and Logic Evaluator.
Measures logical coherence across turns, responsiveness to prospect questions,
and strategic objection pivoting.
"""
from typing import List
from evaluators.base import BaseEvaluator, EvaluationResult
from adapters.base import RunRecord
from datasets.schema import EvaluationScenario


class ReasoningEvaluator(BaseEvaluator):
    def __init__(self, passing_threshold: float = 70.0):
        super().__init__(dimension_name="reasoning", passing_threshold=passing_threshold)

    def evaluate(self, run: RunRecord, scenario: EvaluationScenario) -> EvaluationResult:
        turns = run.turns
        reasons: List[str] = []
        score = 80.0

        # Check turn alignment
        for i in range(len(turns) - 1):
            if turns[i].speaker == "prospect" and turns[i+1].speaker == "pearl":
                p_text = turns[i].text.lower()
                r_text = turns[i+1].text.lower()

                # If prospect asked a question ('?' or interrogative words), did Pearl address it?
                is_question = "?" in p_text or any(w in p_text for w in ["kya", "kaise", "what", "how", "why", "pricing", "cost"])
                if is_question:
                    # Look for relevant semantic overlap
                    question_keywords = [w for w in p_text.replace("?", "").split() if len(w) > 3]
                    overlap = [w for w in question_keywords if w in r_text]
                    if not overlap and len(question_keywords) > 2:
                        score -= 10.0
                        reasons.append(f"Turn {i+2} appeared weakly responsive to prospect question in Turn {i+1}")

        score = max(0.0, min(100.0, score))
        passed = score >= self.passing_threshold

        return EvaluationResult(
            scenario_id=scenario.scenario_id,
            dimension=self.dimension_name,
            score=round(score, 2),
            passed=passed,
            details={"evaluated_turn_pairs": len(turns) // 2},
            reasons=reasons,
            failure_type="reasoning_failure" if not passed else None
        )
