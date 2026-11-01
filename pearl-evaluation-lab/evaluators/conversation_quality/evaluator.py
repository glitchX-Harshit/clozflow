"""
Conversation Quality Evaluator.
Evaluates spoken conciseness, rhythm, avoidance of markdown/bullets in spoken audio,
and lack of robotic meta-commentary.
"""
import re
from typing import List
from evaluators.base import BaseEvaluator, EvaluationResult
from adapters.base import RunRecord
from datasets.schema import EvaluationScenario


class ConversationQualityEvaluator(BaseEvaluator):
    def __init__(self, passing_threshold: float = 75.0):
        super().__init__(dimension_name="conversation_quality", passing_threshold=passing_threshold)

    def evaluate(self, run: RunRecord, scenario: EvaluationScenario) -> EvaluationResult:
        pearl_turns = [t for t in run.turns if t.speaker == "pearl"]
        if not pearl_turns:
            return EvaluationResult(
                scenario_id=scenario.scenario_id,
                dimension=self.dimension_name,
                score=0.0,
                passed=False,
                reasons=["No turns to evaluate"]
            )

        score = 100.0
        reasons: List[str] = []

        for idx, turn in enumerate(pearl_turns, 1):
            text = turn.text

            # 1. Spoken length: ideally 15 to 60 words for phone conversation
            word_count = len(text.split())
            if word_count > 75:
                score -= 10.0
                reasons.append(f"Turn {idx} too verbose for phone ({word_count} words)")
            elif word_count < 3 and idx > 1:
                score -= 5.0
                reasons.append(f"Turn {idx} too abrupt ({word_count} words)")

            # 2. Markdown artifacts in spoken response (bullets, bold, headings)
            if any(sym in text for sym in ["**", "##", "* ", "- ", "```"]):
                score -= 20.0
                reasons.append(f"Turn {idx} contains markdown symbols unsuited for TTS speech")

            # 3. Robotic AI meta-commentary
            ai_phrases = ["as an ai", "large language model", "my training", "my instructions", "i cannot feel"]
            for phrase in ai_phrases:
                if phrase in text.lower():
                    score -= 25.0
                    reasons.append(f"Turn {idx} broke fourth wall with robotic meta-commentary: '{phrase}'")

        score = max(0.0, min(100.0, score))
        passed = score >= self.passing_threshold

        return EvaluationResult(
            scenario_id=scenario.scenario_id,
            dimension=self.dimension_name,
            score=round(score, 2),
            passed=passed,
            details={"pearl_turn_count": len(pearl_turns)},
            reasons=reasons,
            failure_type="conversation_quality_gap" if not passed else None
        )
