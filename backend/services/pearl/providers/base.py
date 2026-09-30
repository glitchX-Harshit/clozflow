"""
Pearl Voice Provider — Base Interface
Abstract interface for voice/telephony providers.
All providers (Mock, ElevenLabs, Exotel) implement this interface.
"""
from abc import ABC, abstractmethod
from typing import Optional
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class CallConfig:
    """Configuration for initiating an outbound call."""
    agent_id: str
    lead_id: int
    phone_number: str
    agent_name: str = "Pearl"
    voice_personality: str = "professional"
    language: str = "en"
    system_prompt: str = ""
    first_message: str = ""
    max_duration_seconds: int = 600  # 10 minutes default


@dataclass
class CallStatus:
    """Current status of a call."""
    call_id: str
    provider_call_id: Optional[str] = None
    status: str = "queued"  # queued, initiating, ringing, connected, completed, failed
    duration_seconds: int = 0
    outcome: Optional[str] = None
    transcript: Optional[list] = None
    error: Optional[str] = None
    metadata: dict = field(default_factory=dict)


@dataclass
class ConversationTurn:
    """A single turn in the conversation."""
    speaker: str  # "agent" or "prospect"
    text: str
    timestamp: datetime = field(default_factory=datetime.utcnow)
    intent: Optional[str] = None
    signals: dict = field(default_factory=dict)


class VoiceProvider(ABC):
    """
    Abstract base class for Pearl voice/telephony providers.
    Implement this to add a new calling provider.
    """

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Return the provider identifier (e.g. 'mock', 'elevenlabs', 'exotel')."""
        ...

    @abstractmethod
    async def create_outbound_call(self, config: CallConfig) -> CallStatus:
        """
        Initiate an outbound call. Returns initial CallStatus.
        The actual call lifecycle is managed asynchronously.
        """
        ...

    @abstractmethod
    async def get_call_status(self, provider_call_id: str) -> CallStatus:
        """Get the current status of a call."""
        ...

    @abstractmethod
    async def end_call(self, provider_call_id: str) -> CallStatus:
        """End an active call."""
        ...

    async def transfer_call(self, provider_call_id: str, transfer_to: str) -> CallStatus:
        """Transfer a call to a human. Optional — not all providers support this."""
        raise NotImplementedError(f"{self.provider_name} does not support call transfer")

    async def get_conversation_metadata(self, provider_call_id: str) -> dict:
        """Get conversation metadata (transcript, signals, etc). Optional."""
        return {}
