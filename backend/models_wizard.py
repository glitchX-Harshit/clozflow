"""Meeting Wizard tables (spec §3) and the ``call_logs`` column extension.

Imported by ``main.py`` before ``Base.metadata.create_all`` / ``add_missing_columns``
so the tables are created and existing databases gain the new nullable columns.
Timestamps are naive UTC like the rest of the schema; ``database.utc_isoformat``
renders them with a ``Z``.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON, Boolean, Column, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint,
)

from database import Base
from models import CallLog


def _uuid() -> str:
    return str(uuid.uuid4())


class WizardMeeting(Base):
    __tablename__ = "wizard_meetings"
    __table_args__ = (Index("ix_wizard_meetings_user_status", "user_id", "status"),)

    id = Column(String(36), primary_key=True, default=_uuid)           # public meeting_id
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(200), nullable=True)
    status = Column(String(20), nullable=False, default="planned")      # planned|ready|live|ended|debriefed|cancelled|no_show
    prospect_name = Column(String(200), nullable=True)
    company = Column(String(200), nullable=True)
    industry = Column(String(200), nullable=True)
    role = Column(String(200), nullable=True)
    prospect_phone_e164 = Column(String(32), nullable=True)
    prospect_email = Column(String(254), nullable=True)
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=True)
    deal_value_inr = Column(Float, nullable=True)
    deal_value_text = Column(String(64), nullable=True)
    objective = Column(Text, nullable=True)
    methodology = Column(String(20), nullable=False, default="meddpicc")
    capsule_id = Column(Integer, ForeignKey("capsules.id"), nullable=True)
    product_name = Column(String(500), nullable=True)                   # capsule snapshot
    product_price = Column(String(1000), nullable=True)
    product_specification = Column(Text, nullable=True)
    platform = Column(String(20), nullable=False, default="meet")       # meet|zoom|teams|phone|in_person|whatsapp|other
    channel = Column(String(20), nullable=False, default="tab_audio")   # tab_audio|phone_bridge|mic|bot
    scheduled_start = Column(DateTime, nullable=True)
    scheduled_end = Column(DateTime, nullable=True)
    meeting_link = Column(String(1000), nullable=True)
    calendar_event_id = Column(String(300), nullable=True)
    calendar_source = Column(String(16), nullable=True)                 # ics|google|microsoft|manual
    brief = Column(JSON, nullable=True)
    brief_generated_at = Column(DateTime, nullable=True)
    battlecard_ids = Column(JSON, nullable=True)                        # list[str]
    coaching_intensity = Column(String(16), nullable=False, default="guided")
    consent = Column(JSON, nullable=True)
    context_id = Column(String(36), nullable=True)
    call_log_id = Column(Integer, ForeignKey("call_logs.id", ondelete="SET NULL"), nullable=True)
    bridge_call_id = Column(String(36), nullable=True)
    started_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class WizardBattlecard(Base):
    __tablename__ = "wizard_battlecards"

    id = Column(String(40), primary_key=True)                           # seed slug or uuid4
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)   # null = system seed card
    kind = Column(String(20), nullable=False, default="objection")      # objection|competitive|methodology|india_context|stage|closing|persona|custom
    category = Column(String(80), nullable=True)
    title = Column(String(120), nullable=False)
    tag = Column(String(40), nullable=True)
    accent = Column(String(16), nullable=True)
    trigger_keywords = Column(JSON, nullable=True)                      # list[str], English + Hinglish
    trigger_description = Column(Text, nullable=True)
    fact = Column(Text, nullable=True)
    impact = Column(Text, nullable=True)
    act = Column(Text, nullable=True)                                   # 2–3 complete spoken sentences the rep reads aloud
    act_hinglish = Column(Text, nullable=True)                          # same meaning in Hinglish (Latin script)
    question_to_ask = Column(Text, nullable=True)                       # one complete question sentence
    proof_point = Column(Text, nullable=True)
    do_not = Column(Text, nullable=True)                                # the trap
    psychology = Column(Text, nullable=True)
    methodology_field = Column(String(40), nullable=True)
    tags = Column(JSON, nullable=True)                                  # list[str]
    is_active = Column(Boolean, nullable=False, default=True)
    usage_count = Column(Integer, nullable=False, default=0)
    source = Column(String(10), nullable=False, default="user")         # seed|user|ai
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class WizardDebrief(Base):
    __tablename__ = "wizard_debriefs"

    id = Column(String(36), primary_key=True, default=_uuid)
    meeting_id = Column(String(36), ForeignKey("wizard_meetings.id", ondelete="CASCADE"), nullable=False, unique=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    status = Column(String(16), nullable=False, default="generating")   # generating|ready|failed
    error = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)                               # BLUF ≤ 80 words
    outcome = Column(String(24), nullable=True)                         # next_step_set|follow_up_needed|won|lost|no_show|unclear
    stage_reached = Column(String(24), nullable=True)
    methodology_fields = Column(JSON, nullable=True)
    objections = Column(JSON, nullable=True)
    buying_signals = Column(JSON, nullable=True)
    risks = Column(JSON, nullable=True)
    action_items = Column(JSON, nullable=True)
    next_step = Column(JSON, nullable=True)
    metrics = Column(JSON, nullable=True)
    deal_health = Column(JSON, nullable=True)
    follow_up_email = Column(JSON, nullable=True)                       # {subject, body}
    follow_up_whatsapp = Column(Text, nullable=True)
    coaching = Column(JSON, nullable=True)
    crm_payload = Column(JSON, nullable=True)
    sent = Column(JSON, nullable=True)                                  # {email_at, whatsapp_at, relay_id, crm_at, crm_status}
    degraded = Column(Boolean, nullable=False, default=False)
    generated_at = Column(DateTime, nullable=True)
    edited_at = Column(DateTime, nullable=True)
    model = Column(String(80), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class WizardCalendarSource(Base):
    __tablename__ = "wizard_calendar_sources"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    kind = Column(String(16), nullable=False)                           # ics|google|microsoft
    label = Column(String(120), nullable=True)
    # TODO(security): the repo has no at-rest encryption scheme for secrets yet; the
    # private ICS URL is stored as-is. The API never echoes it back (masked only).
    ics_url = Column(Text, nullable=True)
    oauth = Column(JSON, nullable=True)                                 # tokens (write-only via API)
    last_synced_at = Column(DateTime, nullable=True)
    status = Column(String(16), nullable=False, default="idle")         # idle|syncing|ok|error
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class WizardCalendarEvent(Base):
    __tablename__ = "wizard_calendar_events"
    __table_args__ = (UniqueConstraint("source_id", "external_id", name="uq_wizard_calendar_event"),
                      Index("ix_wizard_calendar_events_user_start", "user_id", "start"))

    id = Column(String(36), primary_key=True, default=_uuid)
    source_id = Column(String(36), ForeignKey("wizard_calendar_sources.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    external_id = Column(String(300), nullable=False)
    title = Column(String(300), nullable=True)
    start = Column(DateTime, nullable=True)
    end = Column(DateTime, nullable=True)
    attendees = Column(JSON, nullable=True)                             # [{name, email}]
    meeting_link = Column(String(1000), nullable=True)
    platform = Column(String(20), nullable=True)                        # meet|zoom|teams|in_person|other
    location = Column(String(500), nullable=True)
    meeting_id = Column(String(36), ForeignKey("wizard_meetings.id", ondelete="SET NULL"), nullable=True)
    raw_hash = Column(String(64), nullable=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class WizardIntegration(Base):
    __tablename__ = "wizard_integrations"

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    crm_webhook_url = Column(String(1000), nullable=True)
    crm_webhook_secret = Column(String(200), nullable=True)             # HMAC key, write-only
    crm_bcc_email = Column(String(254), nullable=True)
    default_country = Column(String(8), nullable=False, default="+91")
    notetaker_name = Column(String(80), nullable=False, default="ClozFlow Notetaker")
    consent_script = Column(Text, nullable=True)                        # None = built-in default
    bridge_disclosure = Column(Boolean, nullable=False, default=True)   # play the pre-roll on bridged calls
    retention_days_audio = Column(Integer, nullable=False, default=0)   # audio is never stored
    retention_days_transcript = Column(Integer, nullable=False, default=180)   # 0 = keep forever
    zoho_oauth = Column(JSON, nullable=True)                            # Zoho CRM tokens (write-only)
    zoho_connected_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── call_logs extension (spec §3) ────────────────────────────────────────────
# Backend B writes these at save time; Backend A reads them. Declarative lets us
# append columns to the mapped class; add_missing_columns() adds them to an
# existing database (all nullable).
CALL_LOG_EXTENSION = {
    "meeting_id": lambda: Column(String(36), nullable=True, index=True),
    "title": lambda: Column(String(200), nullable=True),
    "prospect_name": lambda: Column(String(200), nullable=True),
    "platform": lambda: Column(String(20), nullable=True),
    "channel": lambda: Column(String(20), nullable=True),
    "engine": lambda: Column(String(32), nullable=True),
    "duration_seconds": lambda: Column(Integer, nullable=True),
    "started_at": lambda: Column(DateTime, nullable=True),
    "ended_at": lambda: Column(DateTime, nullable=True),
    "metrics": lambda: Column(JSON, nullable=True),
    "deal_record": lambda: Column(JSON, nullable=True),
}

for _name, _factory in CALL_LOG_EXTENSION.items():
    if _name not in CallLog.__table__.columns:
        setattr(CallLog, _name, _factory())
