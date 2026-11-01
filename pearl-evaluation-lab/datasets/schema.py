"""
Evaluation Dataset Schemas.
Defines strongly-typed Pydantic models for evaluation scenarios, business contexts, and personas.
"""
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field, validator


class BusinessContext(BaseModel):
    industry: str
    company_name: str
    product_name: str
    approved_pricing: Dict[str, Any] = Field(default_factory=dict)
    approved_features: List[str] = Field(default_factory=list)
    capsule_snippet: str
    disallowed_claims: List[str] = Field(default_factory=list)


class ProspectPersona(BaseModel):
    name: str
    role: str
    company_type: str = "SMB"
    buying_intent: float = Field(0.5, ge=0.0, le=1.0)      # 0.0 = hostile/uninterested, 1.0 = ready to buy
    price_sensitivity: float = Field(0.5, ge=0.0, le=1.0)  # 0.0 = price agnostic, 1.0 = extremely price sensitive
    patience: float = Field(0.5, ge=0.0, le=1.0)           # 0.0 = hangs up fast, 1.0 = infinite patience
    preferred_language: str = "Hinglish"                   # "English" | "Hindi" | "Hinglish"
    communication_style: str = "Direct and inquisitive"
    primary_pain_point: Optional[str] = None
    target_objection: Optional[str] = None


class QualificationCriteria(BaseModel):
    required_dimensions: List[str] = Field(default_factory=lambda: ["need", "budget", "authority", "timeline"])
    budget_range: Optional[str] = None
    decision_maker: bool = True
    timeline_days: Optional[int] = None


class TurnPrompt(BaseModel):
    turn_index: int
    user_input: str
    expected_intent: Optional[str] = None
    expected_objection_type: Optional[str] = None
    expected_pearl_contains: List[str] = Field(default_factory=list)
    forbidden_pearl_contains: List[str] = Field(default_factory=list)


class EvaluationScenario(BaseModel):
    scenario_id: str
    version: str = "1.0.0"
    category: str
    title: str
    description: str
    business_context: BusinessContext
    prospect_persona: ProspectPersona
    conversation_turns: List[TurnPrompt] = Field(default_factory=list)
    expected_facts: List[str] = Field(default_factory=list)
    forbidden_claims: List[str] = Field(default_factory=list)
    expected_tools: List[str] = Field(default_factory=list)
    qualification_criteria: Optional[QualificationCriteria] = None
    tags: List[str] = Field(default_factory=list)
    min_passing_score: float = Field(70.0, ge=0.0, le=100.0)

    @validator("scenario_id")
    def validate_scenario_id(cls, v):
        if not v or not v.strip():
            raise ValueError("scenario_id cannot be empty")
        return v.strip().upper()
