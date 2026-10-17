"""
Clozflow Admin Intelligence — Pearl AI & Usage Engine
Analyzes real telemetry from pearl_calls, pearl_conversations, pearl_messages, and pearl_agents.
Integrates unit economics pricing matrices for COGS and margin analysis.
Zero fake data: If calls have 0 seconds or no transcripts, records report true zero values.
"""
from datetime import datetime
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func, desc

from models_pearl import PearlCall, PearlAgent, PearlConversation, PearlMessage
from models import User


# Reference rates from pearl_unit_economics.py
EXOTEL_RATE_PER_MINUTE_INR = 0.60
EXOTEL_RATE_PER_SECOND_INR = EXOTEL_RATE_PER_MINUTE_INR / 60.0
SARVAM_TTS_PER_CHAR_INR = 0.002  # Sarvam Bulbul v4-flash: ₹20 / 10,000 characters (1/3 cheaper than v3)
GEMINI_STT_PER_SEC_INR = 0.005
INFRASTRUCTURE_PER_CALL_INR = 0.50


def get_pearl_intelligence_summary(
    db: Session,
    start_date: datetime,
    end_date: datetime
) -> Dict[str, Any]:
    """
    Computes real metrics across all Pearl AI calls within the reporting period.
    """
    calls = db.query(PearlCall).filter(
        PearlCall.created_at >= start_date,
        PearlCall.created_at <= end_date
    ).all()

    total_initiated = len(calls)
    total_connected_seconds = 0
    status_counts = {}
    outcome_counts = {}
    provider_counts = {}

    for c in calls:
        # Status aggregation
        st = c.status or "unknown"
        status_counts[st] = status_counts.get(st, 0) + 1

        # Outcome aggregation
        out = c.outcome or ("none" if not c.outcome else c.outcome)
        outcome_counts[out] = outcome_counts.get(out, 0) + 1

        # Provider aggregation
        pr = c.provider or "unknown"
        provider_counts[pr] = provider_counts.get(pr, 0) + 1

        # Duration
        dur = c.duration_seconds or 0
        total_connected_seconds += dur

    completed_count = status_counts.get("completed", 0)
    failed_count = status_counts.get("failed", 0)
    cancelled_count = status_counts.get("cancelled", 0)
    connected_count = status_counts.get("connected", 0) + completed_count

    total_connected_minutes = round(total_connected_seconds / 60.0, 2)
    avg_duration_seconds = round(total_connected_seconds / connected_count, 1) if connected_count > 0 else 0.0
    completion_rate = round((completed_count / total_initiated) * 100.0, 1) if total_initiated > 0 else 0.0

    # Total characters generated in Pearl messages
    total_chars = db.query(func.coalesce(func.sum(func.length(PearlMessage.text)), 0)).filter(
        PearlMessage.timestamp >= start_date,
        PearlMessage.timestamp <= end_date,
        PearlMessage.speaker == "agent"
    ).scalar() or 0

    total_messages = db.query(func.count(PearlMessage.id)).filter(
        PearlMessage.timestamp >= start_date,
        PearlMessage.timestamp <= end_date
    ).scalar() or 0

    # Unit economics & COGS calculation based on actual records
    exotel_cogs = round(total_connected_seconds * EXOTEL_RATE_PER_SECOND_INR, 2)
    sarvam_cogs = round(total_chars * SARVAM_TTS_PER_CHAR_INR, 2)
    gemini_cogs = round(total_connected_seconds * GEMINI_STT_PER_SEC_INR, 2)
    infra_cogs = round(total_initiated * INFRASTRUCTURE_PER_CALL_INR, 2)
    total_estimated_cogs_inr = round(exotel_cogs + sarvam_cogs + gemini_cogs + infra_cogs, 2)

    # Agents breakdown
    agents = db.query(PearlAgent).all()
    agent_summaries = []
    for a in agents:
        agent_calls = [c for c in calls if c.agent_id == a.id]
        agent_seconds = sum(c.duration_seconds or 0 for c in agent_calls)
        agent_summaries.append({
            "agent_id": a.id,
            "agent_name": a.name,
            "user_id": a.user_id,
            "status": a.status,
            "call_provider": a.call_provider,
            "total_calls": len(agent_calls),
            "connected_minutes": round(agent_seconds / 60.0, 2),
            "created_at": a.created_at.isoformat() if a.created_at else None
        })

    # Recent calls list (for drilldown)
    recent_calls = []
    sorted_calls = sorted(calls, key=lambda x: x.created_at or datetime.min, reverse=True)[:50]
    for c in sorted_calls:
        recent_calls.append({
            "id": c.id,
            "agent_id": c.agent_id,
            "status": c.status,
            "provider": c.provider,
            "duration_seconds": c.duration_seconds or 0,
            "outcome": c.outcome or "unspecified",
            "error_code": c.error_code,
            "created_at": c.created_at.isoformat() if c.created_at else None
        })

    return {
        "call_metrics": {
            "total_initiated": total_initiated,
            "connected_count": connected_count,
            "completed_count": completed_count,
            "failed_count": failed_count,
            "cancelled_count": cancelled_count,
            "total_connected_minutes": total_connected_minutes,
            "avg_duration_seconds": avg_duration_seconds,
            "completion_rate_percentage": completion_rate,
        },
        "breakdowns": {
            "statuses": status_counts,
            "outcomes": outcome_counts,
            "providers": provider_counts
        },
        "message_intelligence": {
            "total_messages": total_messages,
            "agent_generated_characters": total_chars
        },
        "unit_economics": {
            "label": "Estimated COGS based on Clozflow unit economics cost matrix",
            "currency": "INR",
            "telephony_cogs": exotel_cogs,
            "tts_cogs": sarvam_cogs,
            "stt_cogs": gemini_cogs,
            "infra_cogs": infra_cogs,
            "total_cogs": total_estimated_cogs_inr,
            "rates": {
                "exotel_per_minute": EXOTEL_RATE_PER_MINUTE_INR,
                "sarvam_per_char": SARVAM_TTS_PER_CHAR_INR,
                "gemini_stt_per_sec": GEMINI_STT_PER_SEC_INR,
                "infra_per_call": INFRASTRUCTURE_PER_CALL_INR
            }
        },
        "agents": agent_summaries,
        "recent_calls": recent_calls
    }
