"""
Base Evaluator Contract.
Defines EvaluationResult, failure categorization, and the BaseEvaluator abstraction.
"""
from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

from adapters.base import RunRecord
from datasets.schema import EvaluationScenario


class EvaluationResult(BaseModel):
    scenario_id: str
    dimension: str
    score: float = Field(..., ge=0.0, le=100.0)
    passed: bool
    details: Dict[str, Any] = Field(default_factory=dict)
    reasons: List[str] = Field(default_factory=list)
    failure_type: Optional[str] = None  # e.g., "hallucination", "safety_breach", "qualification_gap", "latency_violation"


class BaseEvaluator(ABC):
    """Abstract base class for all evaluation dimensions."""

    def __init__(self, dimension_name: str, passing_threshold: float = 70.0):
        self.dimension_name = dimension_name
        self.passing_threshold = passing_threshold

    @abstractmethod
    def evaluate(self, run: RunRecord, scenario: EvaluationScenario) -> EvaluationResult:
        """Evaluate a completed run against scenario criteria and ground truth."""
        pass
