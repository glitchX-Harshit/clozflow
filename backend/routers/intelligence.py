"""
Lead Intelligence API Router
─────────────────────────────
POST /intelligence/derive-icp      — Derive ICP from product/service description
POST /intelligence/chat            — Conversational search refinement
POST /intelligence/why-this-lead   — Explain lead relevance
POST /intelligence/suggestions     — Get contextual suggestions for current search
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, List, Dict

router = APIRouter(prefix="/intelligence", tags=["intelligence"])


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
async def derive_icp_endpoint(request: DeriveICPRequest):
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
async def chat_endpoint(request: ChatRequest):
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
async def why_lead_endpoint(request: WhyLeadRequest):
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
async def suggestions_endpoint(request: SuggestionsRequest):
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
