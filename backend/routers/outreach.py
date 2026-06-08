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
    channel: str                              
    outreach_goal: str                        
    outreach_strategy: str                    
    user_offer: str = ""                      


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

    valid_goals = ["start_conversation", "book_call", "follow_up", "re_engage"]
    if request.outreach_goal.lower() not in valid_goals:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid outreach_goal '{request.outreach_goal}'. Must be one of: {', '.join(valid_goals)}"
        )

    valid_strategies = ["direct_observation", "curiosity_hook", "pattern_interrupt", "contrarian_observation", "founder_to_founder", "local_market_insight"]
    if request.outreach_strategy.lower() not in valid_strategies:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid outreach_strategy '{request.outreach_strategy}'. Must be one of: {', '.join(valid_strategies)}"
        )

    if not request.lead_data:
        raise HTTPException(status_code=400, detail="lead_data is required")

    result = await generate_outreach_message(
        lead_data=request.lead_data,
        channel=request.channel,
        outreach_goal=request.outreach_goal,
        outreach_strategy=request.outreach_strategy,
        user_offer=request.user_offer,
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
