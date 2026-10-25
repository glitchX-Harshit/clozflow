"""
Outreach Studio API Router
───────────────────────────
POST /outreach/generate   — Generate a personalized outreach message
POST /outreach/channels   — Detect available channels for a lead
"""

from fastapi import APIRouter, HTTPException, Request, Depends, status
from pydantic import BaseModel, Field
from typing import Optional, Dict, List
from datetime import datetime
from sqlalchemy.orm import Session
from database import get_db

router = APIRouter(prefix="/outreach", tags=["outreach"])

# Rate limit state: ip -> (window_start, count)
_outreach_rate_limits: Dict[str, tuple[datetime, int]] = {}
OUTREACH_RATE_LIMIT_WINDOW = 60
MAX_OUTREACH_PER_MINUTE = 25

def enforce_outreach_rate_limit(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    now = datetime.utcnow()
    
    if len(_outreach_rate_limits) > 2000:
        _outreach_rate_limits.clear()
        
    if client_ip in _outreach_rate_limits:
        window_start, count = _outreach_rate_limits[client_ip]
        if (now - window_start).total_seconds() < OUTREACH_RATE_LIMIT_WINDOW:
            if count >= MAX_OUTREACH_PER_MINUTE:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Outreach generation rate limit exceeded. Please wait a moment."
                )
            _outreach_rate_limits[client_ip] = (window_start, count + 1)
        else:
            _outreach_rate_limits[client_ip] = (now, 1)
    else:
        _outreach_rate_limits[client_ip] = (now, 1)


# ── Request / Response Schemas ───────────────────────────────────────────────

class OutreachGenerateRequest(BaseModel):
    lead_data: dict
    channel: str = "whatsapp"
    user_offer: str = Field(default="", max_length=1000)
    language: str = "english"


class OutreachGenerateResponse(BaseModel):
    opportunity_angle: str = ""
    opening_strategy: str = ""
    generated_thought: str = ""
    attention_hook: str = ""
    observation: str
    curiosity_angle: str = ""
    opening_message: str
    likely_reply: str
    reply_probability: str = ""
    next_move: str = ""
    reasoning: str = ""
    personalization_points: List[str] = []
    likely_response_rate: str                 
    personalization_score: int                
    curiosity_score: int                      
    insight_score: int
    spam_risk: str                            


class ChannelDetectRequest(BaseModel):
    lead_data: dict


class ChannelInfo(BaseModel):
    available: bool
    contact: str


class ChannelDetectResponse(BaseModel):
    whatsapp: ChannelInfo
    instagram: ChannelInfo
    linkedin: ChannelInfo
    email: ChannelInfo


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/generate", response_model=OutreachGenerateResponse)
async def generate_outreach_endpoint(request: Request, body: OutreachGenerateRequest):
    """Generate a personalized outreach message for a lead on a specific channel."""
    enforce_outreach_rate_limit(request)
    from services.outreach_engine import generate_outreach_message

    valid_channels = ["whatsapp", "instagram", "linkedin", "email"]
    if body.channel.lower() not in valid_channels:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid channel '{body.channel}'. Must be one of: {', '.join(valid_channels)}"
        )

    if not body.lead_data or not isinstance(body.lead_data, dict):
        raise HTTPException(status_code=400, detail="lead_data is required and must be an object")

    result = await generate_outreach_message(
        lead_data=body.lead_data,
        channel=body.channel,
        user_offer=body.user_offer,
        language=body.language,
    )
    return result


@router.post("/channels", response_model=ChannelDetectResponse)
async def detect_channels_endpoint(request: Request, body: ChannelDetectRequest):
    """Detect available outreach channels for a lead based on their data."""
    enforce_outreach_rate_limit(request)
    from services.outreach_engine import detect_available_channels

    if not body.lead_data or not isinstance(body.lead_data, dict):
        raise HTTPException(status_code=400, detail="lead_data is required and must be an object")

    result = detect_available_channels(body.lead_data)
    return result
