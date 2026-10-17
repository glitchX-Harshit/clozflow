"""
Pearl Domain Models
Autonomous AI Sales Agent — Database entities for PearlAgent, PearlCall, PearlEvent.
Follows the same patterns as models.py and models_relay.py.
"""
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Boolean, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from database import Base


def generate_uuid():
    return uuid.uuid4().hex


# ── Agent Status Enum Values ─────────────────────────────────────────────────
# draft | ready | active | paused | completed | error
AGENT_STATUSES = ["draft", "ready", "active", "paused", "completed", "error"]

# ── Agent Role Enum Values ───────────────────────────────────────────────────
AGENT_ROLES = ["outbound_qualification"]

# ── Call Status Enum Values ──────────────────────────────────────────────────
CALL_STATUSES = ["queued", "initiating", "ringing", "connected", "completed", "failed", "transferred"]

# ── Agent State Machine States ───────────────────────────────────────────────
AGENT_STATES = [
    "idle", "discovering", "researching", "preparing", "contacting",
    "conversation", "qualifying", "booking", "relaying",
    "completed", "failed", "paused"
]


class PearlAgent(Base):
    """
    An autonomous sales agent configured by the user.
    References existing Capsule and User models — no duplication.
    """
    __tablename__ = "pearl_agents"

    id              = Column(String, primary_key=True, default=generate_uuid, index=True)
    user_id         = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name            = Column(String, nullable=False)
    role            = Column(String, default="outbound_qualification")
    status          = Column(String, default="draft")  # draft → ready → active → paused → completed → error

    # Knowledge — reference to existing Capsule (not copied)
    capsule_id      = Column(Integer, ForeignKey("capsules.id"), nullable=True)

    # Mission & targeting
    mission         = Column(Text, nullable=True)
    target_market   = Column(JSON, nullable=True)   # { industry, company_size, geography, job_titles, buying_signals, exclusions }

    # Qualification & autonomy
    qualification_rules = Column(JSON, nullable=True)  # { decision_maker, problem, product_fit, intent, timeline, budget, meeting }
    autonomy_policy     = Column(JSON, nullable=True)  # { research, outreach, calls, objections, qualify, book, crm, relay, closing }

    # Voice & provider
    voice_config        = Column(JSON, nullable=True)   # { personality, language, tone, pace, speaker }
    lead_source_config  = Column(JSON, nullable=True)   # { source_type, filters, csv_data }
    call_provider       = Column(String, default="mock") # mock | elevenlabs | exotel
    provider_agent_id   = Column(String, nullable=True)

    # Detailed agent instructions & runtime config
    system_prompt       = Column(Text, nullable=True)   # Explicit directives & sales behavior
    greeting            = Column(Text, nullable=True)   # Opening greeting message
    test_variables      = Column(JSON, nullable=True)   # Dynamic test variables e.g. { prospect_name: ... }
    version             = Column(Integer, default=1)

    # Runtime state
    current_state       = Column(String, default="idle")
    current_lead_id     = Column(Integer, ForeignKey("leads.id"), nullable=True)

    # Metrics (updated by runtime)
    prospects_count     = Column(Integer, default=0)
    contacted_count     = Column(Integer, default=0)
    conversations_count = Column(Integer, default=0)
    qualified_count     = Column(Integer, default=0)
    meetings_count      = Column(Integer, default=0)
    relay_count         = Column(Integer, default=0)

    # Timestamps
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deployed_at     = Column(DateTime, nullable=True)
    completed_at    = Column(DateTime, nullable=True)

    # Relationships (reference existing models)
    user            = relationship("User")
    capsule         = relationship("Capsule")
    current_lead    = relationship("Lead", foreign_keys=[current_lead_id])
    calls           = relationship("PearlCall", back_populates="agent", cascade="all, delete-orphan")
    events          = relationship("PearlEvent", back_populates="agent", cascade="all, delete-orphan",
                                   order_by="PearlEvent.timestamp.desc()")


class PearlCall(Base):
    """
    A single outbound call made by a Pearl agent.
    """
    __tablename__ = "pearl_calls"

    id                  = Column(String, primary_key=True, default=generate_uuid, index=True)
    agent_id            = Column(String, ForeignKey("pearl_agents.id"), nullable=False, index=True)
    lead_id             = Column(Integer, ForeignKey("leads.id"), nullable=True)

    # Provider
    provider            = Column(String, nullable=False)  # mock | elevenlabs | exotel
    provider_call_id    = Column(String, nullable=True)

    # Status
    status              = Column(String, default="queued")  # queued → initiating → ringing → connected → completed → failed → transferred
    duration_seconds    = Column(Integer, default=0)
    outcome             = Column(String, nullable=True)     # qualified | not_interested | callback | no_answer | voicemail | error
    error_code          = Column(String, nullable=True)

    # Results
    qualification_result = Column(JSON, nullable=True)      # { decision_maker, problem, fit, intent, timeline, budget, meeting, score }
    transcript_reference = Column(String, nullable=True)    # Reference to stored transcript

    # Timestamps
    created_at          = Column(DateTime, default=datetime.utcnow)
    started_at          = Column(DateTime, nullable=True)
    answered_at         = Column(DateTime, nullable=True)
    ended_at            = Column(DateTime, nullable=True)
    completed_at        = Column(DateTime, nullable=True)
    updated_at          = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    agent               = relationship("PearlAgent", back_populates="calls")
    lead                = relationship("Lead")
    events              = relationship("PearlEvent", back_populates="call", cascade="all, delete-orphan")
    conversation        = relationship("PearlConversation", back_populates="call", uselist=False, cascade="all, delete-orphan")


class PearlEvent(Base):
    """
    Append-only event log for agent observability.
    Every meaningful agent action is recorded here.
    """
    __tablename__ = "pearl_events"

    id          = Column(String, primary_key=True, default=generate_uuid, index=True)
    agent_id    = Column(String, ForeignKey("pearl_agents.id"), nullable=False, index=True)
    call_id     = Column(String, ForeignKey("pearl_calls.id"), nullable=True, index=True)
    lead_id     = Column(Integer, ForeignKey("leads.id"), nullable=True)

    event_type  = Column(String, nullable=False, index=True)  # agent_created, call_started, signal_detected, etc.
    payload     = Column(JSON, nullable=True)                  # Structured event data
    summary     = Column(String, nullable=True)                # Human-readable one-liner

    timestamp   = Column(DateTime, default=datetime.utcnow, index=True)

    # Relationships
    agent       = relationship("PearlAgent", back_populates="events")
    call        = relationship("PearlCall", back_populates="events")


# ── Event Type Constants ─────────────────────────────────────────────────────
EVENT_TYPES = [
    "agent_created",
    "agent_ready",
    "agent_deployed",
    "lead_selected",
    "prospect_researched",
    "call_queued",
    "call_started",
    "prospect_answered",
    "signal_detected",
    "objection_detected",
    "buying_signal_detected",
    "qualification_updated",
    "meeting_requested",
    "meeting_booked",
    "relay_requested",
    "relay_completed",
    "call_completed",
    "crm_updated",
    "agent_paused",
    "agent_stopped",
    "agent_completed",
    "agent_failed",
    "state_changed",
]

class PearlConversation(Base):
    __tablename__ = "pearl_conversations"
    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    call_id = Column(String, ForeignKey("pearl_calls.id"), nullable=False, index=True)
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=True)
    status = Column(String, default="active")
    objective = Column(String, nullable=True)
    qualification_state = Column(JSON, nullable=True)
    meeting_requested = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    call = relationship("PearlCall", back_populates="conversation")
    messages = relationship("PearlMessage", back_populates="conversation", cascade="all, delete-orphan", order_by="PearlMessage.timestamp.asc()")

class PearlMessage(Base):
    __tablename__ = "pearl_messages"
    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    conversation_id = Column(String, ForeignKey("pearl_conversations.id"), nullable=False, index=True)
    speaker = Column(String, nullable=False) # "agent" or "prospect"
    text = Column(String, nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    intent = Column(String, nullable=True)
    msg_metadata = Column(JSON, nullable=True)

    conversation = relationship("PearlConversation", back_populates="messages")


# ── Browser Test Sessions & Messages ─────────────────────────────────────────

class PearlTestSession(Base):
    """
    Browser-based agent test session (Chat or Voice).
    Completely isolated from real campaigns and telephony dispatch.
    """
    __tablename__ = "pearl_test_sessions"

    id              = Column(String, primary_key=True, default=generate_uuid, index=True)
    user_id         = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    agent_id        = Column(String, ForeignKey("pearl_agents.id"), nullable=False, index=True)
    mode            = Column(String, default="chat")  # "chat" | "voice"
    status          = Column(String, default="active") # "active" | "completed" | "error"
    agent_snapshot  = Column(JSON, nullable=True)     # Immutable snapshot of agent config for this session
    summary         = Column(Text, nullable=True)     # Post-session summary
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    agent           = relationship("PearlAgent")
    user            = relationship("User")
    messages        = relationship("PearlTestMessage", back_populates="session", cascade="all, delete-orphan",
                                   order_by="PearlTestMessage.timestamp.asc()")


class PearlTestMessage(Base):
    """
    Individual turn within a browser test session.
    """
    __tablename__ = "pearl_test_messages"

    id              = Column(String, primary_key=True, default=generate_uuid, index=True)
    session_id      = Column(String, ForeignKey("pearl_test_sessions.id"), nullable=False, index=True)
    role            = Column(String, nullable=False)   # "user" | "assistant"
    text            = Column(Text, nullable=False)
    timestamp       = Column(DateTime, default=datetime.utcnow, index=True)
    meta            = Column(JSON, nullable=True)      # latency_ms, tokens, etc.

    session         = relationship("PearlTestSession", back_populates="messages")


# ── Outbound Campaigns & Recipients ──────────────────────────────────────────

class PearlCampaign(Base):
    """
    Outbound sales campaign executing calls using a selected PearlAgent.
    """
    __tablename__ = "pearl_campaigns"

    id                  = Column(String, primary_key=True, default=generate_uuid, index=True)
    user_id             = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    agent_id            = Column(String, ForeignKey("pearl_agents.id"), nullable=True, index=True)
    name                = Column(String, nullable=False)
    objective           = Column(Text, nullable=True)
    description         = Column(Text, nullable=True)
    status              = Column(String, default="draft") # draft | scheduled | queued | running | paused | completed | failed
    source_type         = Column(String, default="lead_finder") # lead_finder | csv_upload | manual
    
    # Calling & retry configurations
    call_settings       = Column(JSON, nullable=True) # { caller_id, calling_hours, timezone, max_attempts, retry_interval, concurrency_limit }
    schedule_time       = Column(DateTime, nullable=True)

    # Progress & metrics
    total_recipients    = Column(Integer, default=0)
    eligible_recipients = Column(Integer, default=0)
    completed_calls     = Column(Integer, default=0)
    failed_calls        = Column(Integer, default=0)
    qualified_calls     = Column(Integer, default=0)

    # Timestamps
    created_at          = Column(DateTime, default=datetime.utcnow)
    updated_at          = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    started_at          = Column(DateTime, nullable=True)
    completed_at        = Column(DateTime, nullable=True)

    # Relationships
    user                = relationship("User")
    agent               = relationship("PearlAgent")
    recipients          = relationship("PearlCampaignRecipient", back_populates="campaign", cascade="all, delete-orphan",
                                       order_by="PearlCampaignRecipient.created_at.asc()")


class PearlCampaignRecipient(Base):
    """
    A single lead recipient targeted in a campaign.
    """
    __tablename__ = "pearl_campaign_recipients"

    id                  = Column(String, primary_key=True, default=generate_uuid, index=True)
    campaign_id         = Column(String, ForeignKey("pearl_campaigns.id"), nullable=False, index=True)
    lead_id             = Column(Integer, ForeignKey("leads.id"), nullable=True)

    # Canonical lead attributes
    name                = Column(String, nullable=True)
    business_name       = Column(String, nullable=True)
    phone_number        = Column(String, nullable=False)
    normalized_phone    = Column(String, nullable=True, index=True)
    email               = Column(String, nullable=True)
    website             = Column(String, nullable=True)
    company             = Column(String, nullable=True)
    source              = Column(String, default="lead_finder") # lead_finder | csv_upload | manual
    
    # Recipient validation and selection state
    status              = Column(String, default="valid") # valid | invalid | excluded | queued | calling | completed | failed
    validation_error    = Column(String, nullable=True)

    # Execution telemetry
    call_id             = Column(String, ForeignKey("pearl_calls.id"), nullable=True)
    attempts            = Column(Integer, default=0)
    duration_seconds    = Column(Integer, default=0)
    outcome             = Column(String, nullable=True) # qualified | not_interested | callback | no_answer | error
    error_reason        = Column(String, nullable=True)
    transcript          = Column(Text, nullable=True)
    summary             = Column(Text, nullable=True)

    # Timestamps
    created_at          = Column(DateTime, default=datetime.utcnow)
    updated_at          = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    campaign            = relationship("PearlCampaign", back_populates="recipients")
    lead                = relationship("Lead")
    call                = relationship("PearlCall")

