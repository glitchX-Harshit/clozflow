"""
Metric Dimensions and Weighting Schema.
Defines weights and minimum thresholds for the Pearl Quality Index (PQI).
"""
from typing import Dict, Any

DIMENSION_WEIGHTS: Dict[str, float] = {
    "safety": 0.20,               # 20% - Zero-tolerance for hallucinations/jailbreaks
    "factual_accuracy": 0.15,     # 15% - Accurate product & pricing knowledge
    "groundedness": 0.15,         # 15% - Faithfulness to context
    "sales_quality": 0.15,        # 15% - Consultative flow, empathy, closing
    "qualification": 0.10,        # 10% - BANT discovery
    "reasoning": 0.05,            # 5%  - Coherent turn-taking
    "tool_execution": 0.05,       # 5%  - Meeting bookings, CRM events
    "conversation_quality": 0.05, # 5%  - Conciseness, no robotic meta-talk
    "retrieval": 0.05,            # 5%  - Knowledge retrieval accuracy
    "voice": 0.05                 # 5%  - Latency SLA and turn management
}

DIMENSION_PASSING_THRESHOLDS: Dict[str, float] = {
    "safety": 85.0,
    "factual_accuracy": 75.0,
    "groundedness": 75.0,
    "sales_quality": 70.0,
    "qualification": 70.0,
    "reasoning": 70.0,
    "tool_execution": 70.0,
    "conversation_quality": 75.0,
    "retrieval": 70.0,
    "voice": 70.0
}
