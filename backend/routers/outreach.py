"""
Outreach Studio API Router
───────────────────────────
POST /outreach/generate   — Generate a personalized outreach message
POST /outreach/channels   — Detect available channels for a lead

Both routes require ``Authorization: Bearer <token>`` (generation spends LLM
quota). Generation failures are real HTTP errors (502/503), never a fake draft.
"""

from fastapi import APIRouter, HTTPException, Request, Depends, status
from pydantic import BaseModel, Field
from typing import Optional, Dict, List

from models import User
from routers.auth import get_current_user
from services.usage_limits import WindowRateLimiter, user_key

router = APIRouter(prefix="/outreach", tags=["outreach"])

OUTREACH_RATE_LIMIT_WINDOW = 60
MAX_OUTREACH_PER_MINUTE = 25
MAX_LEAD_DATA_BYTES = 20000

_outreach_limiter = WindowRateLimiter(
    "outreach", MAX_OUTREACH_PER_MINUTE, OUTREACH_RATE_LIMIT_WINDOW,
    "Outreach generation rate limit exceeded. Please wait a moment.",
)


def enforce_outreach_rate_limit(current_user: User) -> None:
    _outreach_limiter.hit(user_key(current_user))


# ── Request / Response Schemas ───────────────────────────────────────────────

class OutreachGenerateRequest(BaseModel):
    lead_data: dict
    channel: str = "whatsapp"
    user_offer: str = Field(default="", max_length=1000)
    language: str = Field(default="english", max_length=40)


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


def _check_lead_data(lead_data) -> None:
    if not lead_data or not isinstance(lead_data, dict):
        raise HTTPException(status_code=400, detail="lead_data is required and must be an object")
    if len(repr(lead_data)) > MAX_LEAD_DATA_BYTES:
        raise HTTPException(status_code=400, detail="lead_data is too large")


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/generate", response_model=OutreachGenerateResponse)
async def generate_outreach_endpoint(
    request: Request,
    body: OutreachGenerateRequest,
    current_user: User = Depends(get_current_user),
):
    """Generate a personalized outreach message for a lead on a specific channel.

    Errors: 503 (AI not configured / provider quota exhausted, with
    Retry-After), 502 (provider failure). The response never contains a
    placeholder such as "quota limit exceeded" as if it were a draft.
    """
    enforce_outreach_rate_limit(current_user)
    from services.outreach_engine import OutreachGenerationError, generate_outreach_message

    valid_channels = ["whatsapp", "instagram", "linkedin", "email"]
    if body.channel.lower() not in valid_channels:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid channel '{body.channel}'. Must be one of: {', '.join(valid_channels)}"
        )

    _check_lead_data(body.lead_data)

    try:
        result = await generate_outreach_message(
            lead_data=body.lead_data,
            channel=body.channel,
            user_offer=body.user_offer,
            language=body.language,
            user_id=current_user.id,
        )
    except OutreachGenerationError as exc:
        headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
        raise HTTPException(status_code=exc.status_code, detail=exc.detail, headers=headers)
    return result


@router.post("/channels", response_model=ChannelDetectResponse)
async def detect_channels_endpoint(
    request: Request,
    body: ChannelDetectRequest,
    current_user: User = Depends(get_current_user),
):
    """Detect available outreach channels for a lead based on their data."""
    enforce_outreach_rate_limit(current_user)
    from services.outreach_engine import detect_available_channels

    _check_lead_data(body.lead_data)

    result = detect_available_channels(body.lead_data)
    return result
