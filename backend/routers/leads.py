"""
Lead Finder API Router
──────────────────────
POST /leads/search          — Search for business leads (with opportunity scoring)
POST /leads/deep-search     — Deep area-level iteration search with real-time SSE progress
POST /leads/save            — Save a lead to the database (tenant-isolated)
GET  /leads/saved           — Get saved leads for current user
DELETE /leads/saved/{id}    — Delete a saved lead
"""

from fastapi import APIRouter, Depends, HTTPException, Header, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, Dict, List
from sqlalchemy.orm import Session
from datetime import datetime, timedelta

from database import get_db
from models import Lead, User
from routers.auth import verify_token_string

router = APIRouter(prefix="/leads", tags=["leads"])

# In-memory rate limiting tracker for lead searches: ip -> (window_start, count)
_search_rate_limits: Dict[str, tuple[datetime, int]] = {}
SEARCH_RATE_LIMIT_WINDOW = 60
MAX_SEARCHES_PER_MINUTE = 40

def enforce_search_rate_limit(request: Request):
    """Prevent automated scraping and abuse of Google Places / LLM search APIs."""
    client_ip = request.client.host if request.client else "unknown"
    now = datetime.utcnow()
    
    # Clean stale entries if dictionary grows large
    if len(_search_rate_limits) > 2000:
        _search_rate_limits.clear()
        
    if client_ip in _search_rate_limits:
        window_start, count = _search_rate_limits[client_ip]
        if (now - window_start).total_seconds() < SEARCH_RATE_LIMIT_WINDOW:
            if count >= MAX_SEARCHES_PER_MINUTE:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Lead search rate limit exceeded. Please wait a moment before searching again."
                )
            _search_rate_limits[client_ip] = (window_start, count + 1)
        else:
            _search_rate_limits[client_ip] = (now, 1)
    else:
        _search_rate_limits[client_ip] = (now, 1)

def get_current_user_from_header(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization.split(" ")[1]
    user = verify_token_string(token, db)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user

def get_optional_user_from_header(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)) -> Optional[User]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.split(" ")[1]
    return verify_token_string(token, db)


# ── Request / Response Schemas ───────────────────────────────────────────────

class LeadSearchRequest(BaseModel):
    query: str
    filters: Optional[Dict] = None
    user_offer: str = ""
    search_mode: str = "high_fit_leads"

class LeadSaveRequest(BaseModel):
    business_name: str
    category: str = ""
    city: str = ""
    phone_number: str = ""
    website: str = ""
    instagram: str = ""
    google_rating: float = 0
    ai_summary: str = ""
    likely_pain_point: str = ""
    outreach_angle: str = ""
    lead_score: int = 0

class LeadResponse(BaseModel):
    business_name: str
    category: str
    city: str
    phone_number: str
    website: str
    instagram: str
    google_rating: float
    ai_summary: str
    likely_pain_point: str
    lead_score: int
    outreach_angle: str = ""
    address: str = ""
    opportunity_score: int = 0
    opportunity_reason: str = ""
    opportunity_signals: list = []
    buying_probability: str = ""
    opportunity_summary: str = ""
    service_fit_reason: str = ""

    class Config:
        from_attributes = True


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/search", response_model=List[LeadResponse])
async def search_leads_endpoint(request: Request, body: LeadSearchRequest):
    """Search for business leads using natural language query with opportunity scoring."""
    enforce_search_rate_limit(request)
    from services.lead_engine import search_leads

    if not body.query or len(body.query.strip()) < 2:
        raise HTTPException(status_code=400, detail="Search query is too short")
    if len(body.query.strip()) > 300:
        raise HTTPException(status_code=400, detail="Search query exceeds maximum allowed length")

    results = await search_leads(
        body.query,
        body.filters,
        user_offer=body.user_offer,
        search_mode=body.search_mode,
    )
    return results


@router.post("/deep-search")
async def deep_search_leads_endpoint(request: Request, body: LeadSearchRequest):
    """Deep area-level iteration search with real-time SSE progress updates."""
    enforce_search_rate_limit(request)
    from services.lead_engine import deep_search_leads
    
    if not body.query or len(body.query.strip()) < 2:
        raise HTTPException(status_code=400, detail="Search query is too short")
    if len(body.query.strip()) > 300:
        raise HTTPException(status_code=400, detail="Search query exceeds maximum allowed length")
    
    async def event_generator():
        async for event in deep_search_leads(
            body.query,
            body.filters,
            user_offer=body.user_offer,
            search_mode=body.search_mode,
        ):
            yield event
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/save")
async def save_lead(
    request: LeadSaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_header)
):
    """Save a discovered lead to the database with strict tenant isolation."""
    # Check for duplicates by business name + city for THIS user
    existing = db.query(Lead).filter(
        Lead.business_name == request.business_name,
        Lead.city == request.city,
        Lead.user_id == current_user.id
    ).first()

    if existing:
        existing.ai_summary = request.ai_summary or existing.ai_summary
        existing.likely_pain_point = request.likely_pain_point or existing.likely_pain_point
        existing.outreach_angle = request.outreach_angle or existing.outreach_angle
        existing.lead_score = request.lead_score or existing.lead_score
        db.commit()
        return {"message": "Lead updated", "id": existing.id}

    lead = Lead(
        user_id=current_user.id,
        business_name=request.business_name,
        category=request.category,
        city=request.city,
        phone_number=request.phone_number,
        website=request.website,
        instagram=request.instagram,
        google_rating=request.google_rating,
        ai_summary=request.ai_summary,
        likely_pain_point=request.likely_pain_point,
        outreach_angle=request.outreach_angle,
        lead_score=request.lead_score,
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return {"message": "Lead saved", "id": lead.id}


@router.get("/saved")
async def get_saved_leads(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_header)
):
    """Get all saved leads strictly isolated to the authenticated user."""
    leads = db.query(Lead).filter(Lead.user_id == current_user.id).order_by(Lead.lead_score.desc()).all()
    return leads


@router.delete("/saved/{lead_id}")
async def delete_saved_lead(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_from_header)
):
    """Delete a saved lead ensuring the authenticated user owns it."""
    lead = db.query(Lead).filter(Lead.id == lead_id, Lead.user_id == current_user.id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    db.delete(lead)
    db.commit()
    return {"message": "Lead deleted"}
