"""
Pearl Event Logger
Append-only event recording for agent observability, debugging, and analytics.
Events are persisted to the database and can be streamed via SSE.
"""
from datetime import datetime
from typing import Optional
from sqlalchemy.orm import Session

from models_pearl import PearlEvent


class EventLogger:
    """
    Records every meaningful agent action as an append-only event.
    Used by the orchestrator, tool executor, and state machine.
    """

    def __init__(self, db: Session, agent_id: str):
        self.db = db
        self.agent_id = agent_id

    def log(self,
            event_type: str,
            summary: str = "",
            payload: Optional[dict] = None,
            call_id: Optional[str] = None,
            lead_id: Optional[int] = None) -> PearlEvent:
        """
        Record a single event. Returns the created event.
        """
        event = PearlEvent(
            agent_id=self.agent_id,
            call_id=call_id,
            lead_id=lead_id,
            event_type=event_type,
            summary=summary,
            payload=payload or {},
            timestamp=datetime.utcnow(),
        )
        self.db.add(event)
        self.db.commit()
        self.db.refresh(event)
        return event

    # ── Convenience Methods ──────────────────────────────────────────────────

    def agent_created(self, agent_name: str) -> PearlEvent:
        return self.log("agent_created", f"Agent '{agent_name}' created")

    def agent_ready(self) -> PearlEvent:
        return self.log("agent_ready", "Agent configured and ready for deployment")

    def agent_deployed(self) -> PearlEvent:
        return self.log("agent_deployed", "Agent deployed and active")

    def state_changed(self, from_state: str, to_state: str, reason: str = "") -> PearlEvent:
        summary = f"State: {from_state} → {to_state}"
        if reason:
            summary += f" ({reason})"
        return self.log("state_changed", summary, {
            "from_state": from_state,
            "to_state": to_state,
            "reason": reason,
        })

    def lead_selected(self, lead_id: int, lead_name: str) -> PearlEvent:
        return self.log("lead_selected", lead_name, {"lead_name": lead_name}, lead_id=lead_id)

    def prospect_researched(self, lead_id: int, lead_name: str, findings: dict = None) -> PearlEvent:
        return self.log("prospect_researched", f"Researched: {lead_name}",
                       findings or {}, lead_id=lead_id)

    def call_queued(self, call_id: str, lead_id: int) -> PearlEvent:
        return self.log("call_queued", "Call queued", call_id=call_id, lead_id=lead_id)

    def call_started(self, call_id: str, lead_id: int) -> PearlEvent:
        return self.log("call_started", "Call initiated", call_id=call_id, lead_id=lead_id)

    def prospect_answered(self, call_id: str, lead_id: int) -> PearlEvent:
        return self.log("prospect_answered", "Prospect answered", call_id=call_id, lead_id=lead_id)

    def signal_detected(self, signal_type: str, detail: str,
                        call_id: str = None, lead_id: int = None) -> PearlEvent:
        return self.log("signal_detected", f"{signal_type}: {detail}",
                       {"signal_type": signal_type, "detail": detail},
                       call_id=call_id, lead_id=lead_id)

    def objection_detected(self, objection_type: str, detail: str,
                           call_id: str = None, lead_id: int = None) -> PearlEvent:
        return self.log("objection_detected", f"Objection: {objection_type}",
                       {"objection_type": objection_type, "detail": detail},
                       call_id=call_id, lead_id=lead_id)

    def buying_signal_detected(self, signal: str,
                               call_id: str = None, lead_id: int = None) -> PearlEvent:
        return self.log("buying_signal_detected", f"Buying signal: {signal}",
                       {"signal": signal}, call_id=call_id, lead_id=lead_id)

    def qualification_updated(self, result: dict,
                              call_id: str = None, lead_id: int = None) -> PearlEvent:
        score = result.get("overall_score", 0)
        return self.log("qualification_updated", f"Qualification score: {score}%",
                       result, call_id=call_id, lead_id=lead_id)

    def meeting_booked(self, detail: str, call_id: str = None, lead_id: int = None) -> PearlEvent:
        return self.log("meeting_booked", f"Meeting booked: {detail}",
                       call_id=call_id, lead_id=lead_id)

    def relay_requested(self, reason: str, call_id: str = None, lead_id: int = None) -> PearlEvent:
        return self.log("relay_requested", f"Human takeover: {reason}",
                       {"reason": reason}, call_id=call_id, lead_id=lead_id)

    def call_completed(self, call_id: str, outcome: str,
                       duration: int = 0, lead_id: int = None) -> PearlEvent:
        return self.log("call_completed", f"Call ended: {outcome} ({duration}s)",
                       {"outcome": outcome, "duration_seconds": duration},
                       call_id=call_id, lead_id=lead_id)

    def crm_updated(self, field: str, value: str, lead_id: int = None) -> PearlEvent:
        return self.log("crm_updated", f"CRM: {field} → {value}",
                       {"field": field, "value": value}, lead_id=lead_id)

    def agent_paused(self, reason: str = "") -> PearlEvent:
        return self.log("agent_paused", f"Agent paused{': ' + reason if reason else ''}")

    def agent_failed(self, error: str) -> PearlEvent:
        return self.log("agent_failed", f"Agent failed: {error}", {"error": error})
