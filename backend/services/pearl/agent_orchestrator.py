"""
Pearl Agent Orchestrator
The main control loop for the autonomous agent.
Coordinates the state machine, policy engine, tools, and providers.
"""
from sqlalchemy.orm import Session
from typing import Optional

from models_pearl import PearlAgent
from services.pearl.state_machine import AgentStateMachine, InvalidTransition
from services.pearl.policy_engine import PolicyEngine
from services.pearl.tool_executor import ToolExecutor
from services.pearl.event_logger import EventLogger
from services.pearl.conversation_engine import ConversationEngine


class AgentOrchestrator:
    """
    Core orchestrator that runs the Pearl agent.
    Responsible for executing state transitions safely.
    """
    
    def __init__(self, db: Session, agent_id: str):
        self.db = db
        self.agent_id = agent_id
        
        self.agent = db.query(PearlAgent).filter(PearlAgent.id == agent_id).first()
        if not self.agent:
            raise ValueError(f"Agent {agent_id} not found")
            
        self.state_machine = AgentStateMachine(self.agent.current_state)
        self.policy = PolicyEngine(self.agent.autonomy_policy, self.agent.qualification_rules)
        self.tools = ToolExecutor(db, agent_id, self.policy)
        self.logger = EventLogger(db, agent_id)
        
    def _update_state(self, new_state: str, reason: str = "") -> None:
        """Execute a state transition and persist it."""
        old_state = self.agent.current_state
        self.state_machine.transition(new_state, reason)
        self.agent.current_state = new_state
        self.db.commit()
        self.logger.state_changed(old_state, new_state, reason)
        
    def fail(self, reason: str) -> None:
        """Transition agent to failed state."""
        try:
            old_state = self.agent.current_state
            self.state_machine.fail(reason)
            self.agent.current_state = "failed"
            self.db.commit()
            self.logger.agent_failed(reason)
        except Exception:
            pass
