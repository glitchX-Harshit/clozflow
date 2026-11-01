"""
Base Pearl Adapter Interface & Data Contracts.
Defines the strictly isolated interaction boundary between the evaluation lab and Pearl.
"""
from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
from datetime import datetime
from pydantic import BaseModel, Field


class ToolEvent(BaseModel):
    tool_name: str
    arguments: Dict[str, Any] = Field(default_factory=dict)
    result: Optional[Any] = None
    success: bool = True
    error: Optional[str] = None
    timestamp: float = Field(default_factory=lambda: datetime.utcnow().timestamp())


class RetrievalEvent(BaseModel):
    query: str
    sources_retrieved: List[Dict[str, Any]] = Field(default_factory=list)
    latency_ms: Optional[float] = None
    relevance_score: Optional[float] = None


class LatencyMetrics(BaseModel):
    ttft_ms: Optional[float] = None          # Time to first token
    total_turn_ms: float = 0.0              # Total round-trip turn time
    stt_latency_ms: Optional[float] = None   # Audio to text (if voice)
    tts_latency_ms: Optional[float] = None   # Text to first audio (if voice)


class TurnRecord(BaseModel):
    speaker: str                             # "prospect" | "pearl" | "system"
    text: str
    timestamp: float = Field(default_factory=lambda: datetime.utcnow().timestamp())
    latency: LatencyMetrics = Field(default_factory=LatencyMetrics)
    tool_events: List[ToolEvent] = Field(default_factory=list)
    retrieval_events: List[RetrievalEvent] = Field(default_factory=list)
    model_metadata: Dict[str, Any] = Field(default_factory=dict)


class RunRecord(BaseModel):
    run_id: str
    scenario_id: str
    adapter_name: str
    session_id: str
    started_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    turns: List[TurnRecord] = Field(default_factory=list)
    total_turns: int = 0
    total_duration_seconds: float = 0.0
    status: str = "completed"                # "completed" | "timeout" | "error"
    error: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class AgentConfig(BaseModel):
    objective: str = "Qualify prospect intent and schedule next steps."
    business_name: str = "ClozFlow Enterprise"
    product_name: str = "Pearl AI"
    capsule_context: str = "Autonomous AI sales platform for enterprise outbound calling."
    system_prompt_override: Optional[str] = None
    language: str = "Hinglish"
    voice_persona: str = "shubh"


class BasePearlAdapter(ABC):
    """Abstract interface for all Pearl invocation adapters."""

    def __init__(self, name: str):
        self.name = name

    @abstractmethod
    async def is_available(self) -> tuple[bool, str]:
        """Check if adapter is operational and ready to evaluate."""
        pass

    @abstractmethod
    async def start_session(self, config: AgentConfig, scenario_id: str) -> str:
        """Initialize a new evaluation conversation session."""
        pass

    @abstractmethod
    async def send_message(self, session_id: str, message: str) -> TurnRecord:
        """Send a prospect message turn to Pearl and return the evaluated response."""
        pass

    @abstractmethod
    async def end_session(self, session_id: str) -> RunRecord:
        """Finalize the session, collect telemetry, and return the complete run record."""
        pass
