"""
Evaluation Engine Module.
Provides all core evaluators and the evaluator registry.
"""
from typing import List
from .base import BaseEvaluator, EvaluationResult
from .factual_accuracy.evaluator import FactualAccuracyEvaluator
from .groundedness.evaluator import GroundednessEvaluator
from .safety.evaluator import SafetyEvaluator
from .sales_quality.evaluator import SalesQualityEvaluator
from .qualification.evaluator import QualificationEvaluator
from .tool_execution.evaluator import ToolExecutionEvaluator
from .conversation_quality.evaluator import ConversationQualityEvaluator
from .reasoning.evaluator import ReasoningEvaluator
from .retrieval.evaluator import RetrievalEvaluator
from .voice.evaluator import VoiceEvaluator


def get_all_evaluators() -> List[BaseEvaluator]:
    """Returns a full suite of all standard evaluation dimension evaluators."""
    return [
        FactualAccuracyEvaluator(),
        GroundednessEvaluator(),
        SafetyEvaluator(),
        SalesQualityEvaluator(),
        QualificationEvaluator(),
        ToolExecutionEvaluator(),
        ConversationQualityEvaluator(),
        ReasoningEvaluator(),
        RetrievalEvaluator(),
        VoiceEvaluator()
    ]


__all__ = [
    "BaseEvaluator",
    "EvaluationResult",
    "FactualAccuracyEvaluator",
    "GroundednessEvaluator",
    "SafetyEvaluator",
    "SalesQualityEvaluator",
    "QualificationEvaluator",
    "ToolExecutionEvaluator",
    "ConversationQualityEvaluator",
    "ReasoningEvaluator",
    "RetrievalEvaluator",
    "VoiceEvaluator",
    "get_all_evaluators"
]
