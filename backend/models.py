from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class User(Base):
    __tablename__ = "users"
    id              = Column(Integer, primary_key=True, index=True)
    email           = Column(String, unique=True, index=True)
    password_hash   = Column(String)
    created_at      = Column(DateTime, default=datetime.utcnow)

    # ── Profile fields ──────────────────────────────
    username        = Column(String, unique=True, index=True, nullable=True)
    full_name       = Column(String, nullable=True)
    bio             = Column(Text, nullable=True)
    company_name    = Column(String, nullable=True)
    role            = Column(String, nullable=True)
    profile_image   = Column(String, nullable=True)   # stored URL/path
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # ── Workspace ───────────────────────────────────
    workspace_name  = Column(String, nullable=True)
    team_size       = Column(String, nullable=True)
    sales_style     = Column(String, default="Controlled Challenge")

    # ── AI Preferences ──────────────────────────────
    ai_response_length  = Column(String, default="balanced")
    ai_tone             = Column(String, default="assertive")
    ai_objection_pressure = Column(String, default="balanced")
    ai_speed            = Column(String, default="balanced")

    # ── Notifications ───────────────────────────────
    notif_call_summary      = Column(Boolean, default=True)
    notif_objection_alerts  = Column(Boolean, default=False)
    notif_deal_risk         = Column(Boolean, default=True)
    notif_coaching          = Column(Boolean, default=True)

    call_logs = relationship("CallLog", back_populates="user")

class CallLog(Base):
    __tablename__ = "call_logs"
    id              = Column(Integer, primary_key=True, index=True)
    user_id         = Column(Integer, ForeignKey("users.id"))
    transcript      = Column(Text)
    ai_suggestions  = Column(Text)
    message_count   = Column(Integer, default=0)
    insight_count   = Column(Integer, default=0)
    timestamp       = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="call_logs")


class Lead(Base):
    __tablename__ = "leads"
    id                = Column(Integer, primary_key=True, index=True)
    business_name     = Column(String, index=True)
    category          = Column(String, nullable=True)
    city              = Column(String, nullable=True)
    phone_number      = Column(String, nullable=True)
    website           = Column(String, nullable=True)
    instagram         = Column(String, nullable=True)
    google_rating     = Column(String, nullable=True)      # stored as string for flexibility
    ai_summary        = Column(Text, nullable=True)
    likely_pain_point = Column(Text, nullable=True)
    outreach_angle    = Column(Text, nullable=True)
    lead_score        = Column(Integer, default=0)
    created_at        = Column(DateTime, default=datetime.utcnow)

class CopilotSession(Base):
    __tablename__ = "copilot_sessions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    lead_id = Column(Integer, ForeignKey("leads.id"))
    platform = Column(String) # whatsapp, linkedin, gmail, outlook
    platform_identifier = Column(String)
    status = Column(String, default="active")
    conversation_summary = Column(Text, nullable=True)
    last_reply = Column(Text, nullable=True)
    buying_intent = Column(Integer, default=0)
    trust_score = Column(Integer, default=0)
    stage = Column(String, default="initial_contact")
    objections = Column(Text, nullable=True) # JSON string
    commitments = Column(Text, nullable=True) # JSON string
    unanswered_questions = Column(Text, nullable=True) # JSON string
    hidden_concern = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User")
    lead = relationship("Lead")

class Mission(Base):
    __tablename__ = "missions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    status = Column(String, default="pending")  # pending, planning, running, paused, completed, failed
    mission_input = Column(Text)  # Raw user prompt
    industry = Column(String, nullable=True)
    location = Column(String, nullable=True)
    quantity = Column(Integer, nullable=True)
    filters = Column(String, nullable=True)
    outreach_channel = Column(String, default="WhatsApp + Email")
    daily_limit = Column(Integer, default=50)
    working_hours = Column(String, default="9:00 AM - 6:00 PM")
    approval_mode = Column(String, default="Auto-approve qualified leads")
    safety_rules = Column(String, default="No follow-up after rejection")
    # Progress tracking
    current_stage = Column(String, default="planning")
    current_stage_index = Column(Integer, default=0)
    stage_progress = Column(Integer, default=0)  # 0-100 within current stage
    # Metrics
    leads_found = Column(Integer, default=0)
    leads_qualified = Column(Integer, default=0)
    messages_sent = Column(Integer, default=0)
    replies_received = Column(Integer, default=0)
    meetings_booked = Column(Integer, default=0)
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    user = relationship("User")


class MissionActivity(Base):
    __tablename__ = "mission_activities"
    id = Column(Integer, primary_key=True, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id"))
    text = Column(Text)
    activity_type = Column(String, default="default")  # default, success, warning, accent
    created_at = Column(DateTime, default=datetime.utcnow)
    
    mission = relationship("Mission")


class WhatsAppSession(Base):
    __tablename__ = "whatsapp_sessions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    status = Column(String, default="disconnected")  # disconnected, connecting, connected
    phone_number = Column(String, nullable=True)
    connected_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    user = relationship("User")


class WhatsAppMessage(Base):
    __tablename__ = "whatsapp_messages"
    id = Column(Integer, primary_key=True, index=True)
    mission_id = Column(Integer, ForeignKey("missions.id"), nullable=True)
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    direction = Column(String)  # 'outbound' or 'inbound'
    phone_number = Column(String)
    message_text = Column(Text)
    wa_message_id = Column(String, nullable=True)
    status = Column(String, default="pending")  # pending, sent, delivered, read, failed
    push_name = Column(String, nullable=True)  # Contact name from WhatsApp
    created_at = Column(DateTime, default=datetime.utcnow)
    
    mission = relationship("Mission")
    lead = relationship("Lead")
    user = relationship("User")


class PearlReport(Base):
    __tablename__ = "pearl_reports"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    report_date = Column(DateTime)
    missions_active = Column(Integer, default=0)
    leads_found = Column(Integer, default=0)
    leads_contacted = Column(Integer, default=0)
    replies_received = Column(Integer, default=0)
    follow_ups_sent = Column(Integer, default=0)
    meetings_booked = Column(Integer, default=0)
    report_html = Column(Text, nullable=True)
    email_sent = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User")
