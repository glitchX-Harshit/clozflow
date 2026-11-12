"""
Lead Intelligence API Router
─────────────────────────────
POST /intelligence/derive-icp      — Derive ICP from product/service description
POST /intelligence/chat            — Conversational search refinement
POST /intelligence/why-this-lead   — Explain lead relevance
POST /intelligence/suggestions     — Get contextual suggestions for current search

All routes require ``Authorization: Bearer <token>`` (they spend LLM quota).
The engine uses a blocking SDK client, so calls run in a worker thread.
"""

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
from typing import Optional, List, Dict

from models import User
from routers.auth import get_current_user
from services.usage_limits import WindowRateLimiter, user_key

router = APIRouter(prefix="/intelligence", tags=["intelligence"])

RATE_LIMIT_WINDOW = 60
MAX_REQUESTS_PER_MINUTE = 35
MAX_OFFER_CHARS = 1000
MAX_MESSAGE_CHARS = 2000

_intelligence_limiter = WindowRateLimiter(
    "intelligence", MAX_REQUESTS_PER_MINUTE, RATE_LIMIT_WINDOW,
    "Intelligence API rate limit exceeded. Please wait a moment.",
)


def enforce_rate_limit(current_user: User) -> None:
    _intelligence_limiter.hit(user_key(current_user))


# ── Request schemas ───────────────────────────────────────────────────────────

class DeriveICPRequest(BaseModel):
    offer: str  # What the user sells


class ChatRequest(BaseModel):
    message: str
    user_offer: str = ""
    current_query: str = ""
    icp: Optional[Dict] = None
    # Each item: {"role": "user" | "assistant" (legacy "ai" accepted), "content": str}
    conversation_history: Optional[List[Dict]] = []


class WhyLeadRequest(BaseModel):
    lead: Dict           # Full lead object
    user_offer: str = ""


class SuggestionsRequest(BaseModel):
    current_query: str = ""
    user_offer: str = ""
    leads_count: int = 0
    icp: Optional[Dict] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/derive-icp")
async def derive_icp_endpoint(req: Request, request: DeriveICPRequest, current_user: User = Depends(get_current_user)):
    """
    Derive an Ideal Customer Profile from the user's product/service description.
    Returns structured ICP with segments, signals, and a suggested search query.
    """
    enforce_rate_limit(current_user)
    from services.intelligence_engine import derive_icp

    offer = (request.offer or "").strip()
    if len(offer) < 3:
        return {
            "success": False,
            "error": "Please describe what you sell in a few words.",
        }
    if len(offer) > MAX_OFFER_CHARS:
        return {
            "success": False,
            "error": f"Please keep the description under {MAX_OFFER_CHARS} characters.",
        }

    return await run_in_threadpool(derive_icp, offer)


@router.post("/chat")
async def chat_endpoint(req: Request, request: ChatRequest, current_user: User = Depends(get_current_user)):
    """
    Process a conversational message from the Lead Intelligence panel.
    May return a reply + optional search_command to update the Lead Finder.
    """
    enforce_rate_limit(current_user)
    from services.intelligence_engine import process_chat_message

    message = (request.message or "").strip()
    if not message:
        return {
            "success": False,
            "error": "Message cannot be empty.",
        }
    if len(message) > MAX_MESSAGE_CHARS:
        return {
            "success": False,
            "error": f"Message is too long (max {MAX_MESSAGE_CHARS} characters).",
        }

    return await run_in_threadpool(
        process_chat_message,
        user_message=message,
        user_offer=(request.user_offer or "")[:MAX_OFFER_CHARS],
        current_query=(request.current_query or "")[:300],
        icp=request.icp,
        conversation_history=request.conversation_history or [],
    )


@router.post("/why-this-lead")
async def why_lead_endpoint(req: Request, request: WhyLeadRequest, current_user: User = Depends(get_current_user)):
    """
    Explain why a specific lead is (or isn't) a good prospect.
    Uses existing enrichment data first, then AI for deeper analysis.
    """
    enforce_rate_limit(current_user)
    from services.intelligence_engine import explain_lead

    if not request.lead or not request.lead.get("business_name"):
        return {
            "success": False,
            "error": "Invalid lead data.",
        }

    return await run_in_threadpool(explain_lead, request.lead, (request.user_offer or "")[:MAX_OFFER_CHARS])


@router.post("/suggestions")
async def suggestions_endpoint(req: Request, request: SuggestionsRequest, current_user: User = Depends(get_current_user)):
    """
    Generate contextual action suggestions based on the current search state.
    These are short, natural-language prompts shown in the panel.
    """
    enforce_rate_limit(current_user)
    from services.intelligence_engine import generate_suggestions

    suggestions = generate_suggestions(
        current_query=request.current_query or "",
        user_offer=request.user_offer or "",
        leads_count=request.leads_count,
        icp=request.icp,
    )
    return {"success": True, "suggestions": suggestions}
