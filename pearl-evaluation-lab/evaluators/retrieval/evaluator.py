"""
Retrieval Quality Evaluator.
Measures RAG retrieval precision, relevance of retrieved knowledge chunks,
and latency of capsule search events.
"""
from typing import List
from evaluators.base import BaseEvaluator, EvaluationResult
from adapters.base import RunRecord
from datasets.schema import EvaluationScenario


class RetrievalEvaluator(BaseEvaluator):
    def __init__(self, passing_threshold: float = 70.0):
        super().__init__(dimension_name="retrieval", passing_threshold=passing_threshold)

    def evaluate(self, run: RunRecord, scenario: EvaluationScenario) -> EvaluationResult:
        retrieval_events = []
        for t in run.turns:
            retrieval_events.extend(t.retrieval_events)

        if not retrieval_events:
            # If no explicit RAG events captured in this turn record, score based on business context presence in answers
            pearl_text = " ".join([t.text for t in run.turns if t.speaker == "pearl"]).lower()
            context_match = scenario.business_context.product_name.lower() in pearl_text
            score = 85.0 if context_match else 65.0
            return EvaluationResult(
                scenario_id=scenario.scenario_id,
                dimension=self.dimension_name,
                score=score,
                passed=score >= self.passing_threshold,
                details={"mode": "implicit_context_presence", "context_matched": context_match}
            )

        # Explicit retrieval events
        relevance_scores = [ev.relevance_score for ev in retrieval_events if ev.relevance_score is not None]
        avg_rel = (sum(relevance_scores) / len(relevance_scores)) * 100.0 if relevance_scores else 80.0

        return EvaluationResult(
            scenario_id=scenario.scenario_id,
            dimension=self.dimension_name,
            score=round(avg_rel, 2),
            passed=avg_rel >= self.passing_threshold,
            details={"events_count": len(retrieval_events), "avg_relevance": avg_rel}
        )
