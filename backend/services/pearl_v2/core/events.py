from dataclasses import dataclass
from typing import Optional

@dataclass
class TurnCompleteEvent:
    text: str
    reason: str

@dataclass
class BargeInEvent:
    pass

@dataclass
class AgentSpeechStartEvent:
    pass

@dataclass
class AgentSpeechEndEvent:
    pass
