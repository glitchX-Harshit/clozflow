"""Copilot bridge calls: the backend calls the rep's phone, then bridges the prospect.

One row per call placed through ``POST /api/copilot/bridge/calls``. Timestamps are
naive UTC like the rest of the schema. The table is created by the app's
``Base.metadata.create_all`` (``routers/copilot_bridge.py`` imports this module
before ``main.py`` runs it, and the router's lifespan re-checks at startup).
See ``docs/copilot_bridge.md``.
"""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Index, Integer, String

from database import Base


class CopilotBridgeCall(Base):
    __tablename__ = "copilot_bridge_calls"
    __table_args__ = (Index("ix_copilot_bridge_calls_user_status", "user_id", "status"),)

    id = Column(String(36), primary_key=True)                      # uuid4, the public call_id
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    context_id = Column(String(64), nullable=False)                 # call brief from /call/start
    status = Column(String(24), nullable=False, default="created", index=True)
    reason = Column(String(32), nullable=True)                      # set when status == "ended"
    prospect_name = Column(String(120), nullable=True)
    prospect_phone_e164 = Column(String(20), nullable=False)
    rep_phone_e164 = Column(String(20), nullable=False)
    vobiz_request_uuid = Column(String(64), nullable=True)          # make-call response (queued call)
    vobiz_a_leg_uuid = Column(String(64), nullable=True)            # CallUUID of the rep leg
    vobiz_b_leg_uuid = Column(String(64), nullable=True)            # DialBLegUUID of the prospect leg
    token_hash = Column(String(64), nullable=False)                 # sha256 of the per-call carrier secret
    rate_per_minute = Column(Float, nullable=False, default=3.0)    # frozen at creation
    max_seconds = Column(Integer, nullable=False, default=3600)     # Dial timeLimit
    balance_capped = Column(Boolean, nullable=False, default=False)  # max_seconds limited by the wallet
    cancel_requested = Column(Boolean, nullable=False, default=False)
    dial_status = Column(String(24), nullable=True)                 # final DialStatus of the prospect leg
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    status_changed_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_carrier_event_at = Column(DateTime, nullable=True)
    rep_answered_at = Column(DateTime, nullable=True)
    connected_at = Column(DateTime, nullable=True)
    bridge_ended_at = Column(DateTime, nullable=True)               # prospect leg finished (DialHangup)
    ended_at = Column(DateTime, nullable=True)
    duration_seconds = Column(Integer, nullable=False, default=0)    # connected (billable) seconds
    charged_credits = Column(Float, nullable=False, default=0.0)
    billed_at = Column(DateTime, nullable=True)                     # set once: guards double charging
    call_log_id = Column(Integer, ForeignKey("call_logs.id", ondelete="SET NULL"), nullable=True)
