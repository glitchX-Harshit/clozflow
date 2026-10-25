"""
Lead Intelligence API Router
─────────────────────────────
POST /intelligence/derive-icp      — Derive ICP from product/service description
POST /intelligence/chat            — Conversational search refinement
POST /intelligence/why-this-lead   — Explain lead relevance
POST /intelligence/suggestions     — Get contextual suggestions for current search
"""

from fastapi import APIRouter, Request, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional, List, Dict
from datetime import datetime

router = APIRouter(prefix="/intelligence", tags=["intelligence"])

# In-memory rate limiting tracker: ip -> (window_start, count)
_intelligence_rate_limits: Dict[str, tuple[datetime, int]] = {}
RATE_LIMIT_WINDOW = 60
MAX_REQUESTS_PER_MINUTE = 35

def enforce_rate_limit(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    now = datetime.utcnow()
    if len(_intelligence_rate_limits) > 2000:
        _intelligence_rate_limits.clear()
        
    if client_ip in _intelligence_rate_limits:
        window_start, count = _intelligence_rate_limits[client_ip]
        if (now - window_start).total_seconds() < RATE_LIMIT_WINDOW:
            if count >= MAX_REQUESTS_PER_MINUTE:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Intelligence API rate limit exceeded. Please wait a moment."
                )
            _intelligence_rate_limits[client_ip] = (window_start, count + 1)
        else:
            _intelligence_rate_limits[client_ip] = (now, 1)
    else:
        _intelligence_rate_limits[client_ip] = (now, 1)



# ── Request schemas ───────────────────────────────────────────────────────────

class DeriveICPRequest(BaseModel):
    offer: str  # What the user sells


class ChatRequest(BaseModel):
    message: str
    user_offer: str = ""
    current_query: str = ""
    icp: Optional[Dict] = None
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
async def derive_icp_endpoint(req: Request, request: DeriveICPRequest):
    enforce_rate_limit(req)
    """
    Derive an Ideal Customer Profile from the user's product/service description.
    Returns structured ICP with segments, signals, and a suggested search query.
    """
    from services.intelligence_engine import derive_icp

    if not request.offer or len(request.offer.strip()) < 3:
        return {
            "success": False,
            "error": "Please describe what you sell in a few words.",
        }

    result = derive_icp(request.offer.strip())
    return result


@router.post("/chat")
async def chat_endpoint(req: Request, request: ChatRequest):
    enforce_rate_limit(req)
    """
    Process a conversational message from the Lead Intelligence panel.
    May return a reply + optional search_command to update the Lead Finder.
    """
    from services.intelligence_engine import process_chat_message

    if not request.message or not request.message.strip():
        return {
            "success": False,
            "error": "Message cannot be empty.",
        }

    result = process_chat_message(
        user_message=request.message.strip(),
        user_offer=request.user_offer,
        current_query=request.current_query,
        icp=request.icp,
        conversation_history=request.conversation_history or [],
    )
    return result


@router.post("/why-this-lead")
async def why_lead_endpoint(req: Request, request: WhyLeadRequest):
    enforce_rate_limit(req)
    """
    Explain why a specific lead is (or isn't) a good prospect.
    Uses existing enrichment data first, then AI for deeper analysis.
    """
    from services.intelligence_engine import explain_lead

    if not request.lead or not request.lead.get("business_name"):
        return {
            "success": False,
            "error": "Invalid lead data.",
        }

    result = explain_lead(request.lead, request.user_offer)
    return result


@router.post("/suggestions")
async def suggestions_endpoint(req: Request, request: SuggestionsRequest):
    enforce_rate_limit(req)
    """
    Generate contextual action suggestions based on the current search state.
    These are short, natural-language prompts shown in the panel.
    """
    from services.intelligence_engine import generate_suggestions

    suggestions = generate_suggestions(
        current_query=request.current_query,
        user_offer=request.user_offer,
        leads_count=request.leads_count,
        icp=request.icp,
    )
    return {"success": True, "suggestions": suggestions}
