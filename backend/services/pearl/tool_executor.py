"""
Pearl Tool Executor
Provides concrete actions that the Agent Orchestrator can execute.
Validates policies before executing actions.
"""
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from datetime import datetime

from models import Lead, Capsule
from models_pearl import PearlCall, PearlAgent
from services.pearl.event_logger import EventLogger
from services.pearl.policy_engine import PolicyEngine, PolicyViolation


class ToolExecutor:
    """
    Executes concrete actions on behalf of the agent.
    Always enforces policy before taking action.
    """

    def __init__(self, db: Session, agent_id: str, policy_engine: PolicyEngine):
        self.db = db
        self.agent_id = agent_id
        self.policy = policy_engine
        self.logger = EventLogger(db, agent_id)

    # ── Context Gathering Tools ────────────────────────────────────────────────

    def get_lead_context(self, lead_id: int) -> Optional[Dict[str, Any]]:
        """Retrieve lead information and CRM context."""
        lead = self.db.query(Lead).filter(Lead.id == lead_id).first()
        if not lead:
            return None
        return {
            "business_name": lead.business_name,
            "category": lead.category,
            "city": lead.city,
            "website": lead.website,
            "ai_summary": lead.ai_summary,
            "pain_points": lead.likely_pain_point,
            "lead_score": lead.lead_score,
        }

    def get_capsule_context(self, capsule_id: int) -> Optional[Dict[str, Any]]:
        """Retrieve product knowledge capsule."""
        capsule = self.db.query(Capsule).filter(Capsule.id == capsule_id).first()
        if not capsule:
            return None
        return {
            "name": capsule.name,
            "product_name": capsule.product_name,
            "pricing": capsule.product_price,
            "specifications": capsule.product_specification,
            "audience": capsule.target_audience,
            "differentiators": capsule.key_differentiators,
            "pain_points": capsule.pain_points_solved,
            "additional_context": capsule.additional_context,
        }

    # ── Action Tools ───────────────────────────────────────────────────────────

    def update_crm(self, lead_id: int, updates: Dict[str, Any]) -> bool:
        """Update CRM fields for a lead."""
        self.policy.check_action("update_crm")
        
        lead = self.db.query(Lead).filter(Lead.id == lead_id).first()
        if not lead:
            return False

        allowed_fields = ["lead_score", "likely_pain_point", "ai_summary"]
        updated = False

        for field, value in updates.items():
            if field in allowed_fields:
                setattr(lead, field, value)
                self.logger.crm_updated(field, str(value), lead_id)
                updated = True

        if updated:
            self.db.commit()
            
        return updated

    def trigger_relay(self, call_id: str, lead_id: int, reason: str) -> None:
        """Hand off to a human via Relay."""
        self.policy.check_action("relay_to_human")
        self.logger.relay_requested(reason, call_id, lead_id)
        
        # In a real implementation, this would invoke the Relay engine
        # to generate a digital sales room draft for the prospect.

    def book_meeting(self, call_id: str, lead_id: int, details: str) -> None:
        """Book a meeting with the prospect."""
        self.policy.check_action("book_meeting")
        self.logger.meeting_booked(details, call_id, lead_id)
