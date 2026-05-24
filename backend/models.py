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
