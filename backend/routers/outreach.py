"""
Outreach Studio API Router
───────────────────────────
POST /outreach/generate   — Generate a personalized outreach message
POST /outreach/channels   — Detect available channels for a lead
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, List

router = APIRouter(prefix="/outreach", tags=["outreach"])


# ── Request / Response Schemas ───────────────────────────────────────────────

class OutreachGenerateRequest(BaseModel):
    lead_data: dict
    channel: str = "whatsapp"
    user_offer: str = ""
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
async def generate_outreach_endpoint(request: OutreachGenerateRequest):
    """Generate a personalized outreach message for a lead on a specific channel."""
    from services.outreach_engine import generate_outreach_message

    valid_channels = ["whatsapp", "instagram", "linkedin", "email"]
    if request.channel.lower() not in valid_channels:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid channel '{request.channel}'. Must be one of: {', '.join(valid_channels)}"
        )

    if not request.lead_data:
        raise HTTPException(status_code=400, detail="lead_data is required")

    result = await generate_outreach_message(
        lead_data=request.lead_data,
        channel=request.channel,
        user_offer=request.user_offer,
        language=request.language,
    )
    return result


@router.post("/channels", response_model=ChannelDetectResponse)
async def detect_channels_endpoint(request: ChannelDetectRequest):
    """Detect available outreach channels for a lead based on their data."""
    from services.outreach_engine import detect_available_channels

    if not request.lead_data:
        raise HTTPException(status_code=400, detail="lead_data is required")

    result = detect_available_channels(request.lead_data)
    return result
