"""
Lead Finder API Router
──────────────────────
POST /leads/search          — Search for business leads (with opportunity scoring)
POST /leads/{lead_id}/save  — Save a lead to the database
GET  /leads/saved           — Get saved leads for current user
DELETE /leads/saved/{id}    — Delete a saved lead
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, Dict, List
from sqlalchemy.orm import Session
from database import get_db
from models import Lead
from datetime import datetime

router = APIRouter(prefix="/leads", tags=["leads"])


# ── Request / Response Schemas ───────────────────────────────────────────────

class LeadSearchRequest(BaseModel):
    query: str
    filters: Optional[Dict] = None
    user_offer: str = ""            # NEW: what service the user sells
    search_mode: str = "high_fit_leads"  # NEW: search mode

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
    # NEW opportunity fields
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
async def search_leads_endpoint(request: LeadSearchRequest):
    """Search for business leads using natural language query with opportunity scoring."""
    from services.lead_engine import search_leads

    if not request.query or len(request.query.strip()) < 2:
        raise HTTPException(status_code=400, detail="Search query is too short")

    results = await search_leads(
        request.query,
        request.filters,
        user_offer=request.user_offer,
        search_mode=request.search_mode,
    )
    return results


@router.post("/deep-search")
async def deep_search_leads_endpoint(request: LeadSearchRequest):
    """Deep area-level iteration search with real-time SSE progress updates."""
    from services.lead_engine import deep_search_leads
    
    if not request.query or len(request.query.strip()) < 2:
        raise HTTPException(status_code=400, detail="Search query is too short")
    
    async def event_generator():
        async for event in deep_search_leads(
            request.query,
            request.filters,
            user_offer=request.user_offer,
            search_mode=request.search_mode,
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
async def save_lead(request: LeadSaveRequest, db: Session = Depends(get_db)):
    """Save a discovered lead to the database."""
    # Check for duplicates by business name + city
    existing = db.query(Lead).filter(
        Lead.business_name == request.business_name,
        Lead.city == request.city
    ).first()

    if existing:
        # Update existing lead
        existing.ai_summary = request.ai_summary or existing.ai_summary
        existing.likely_pain_point = request.likely_pain_point or existing.likely_pain_point
        existing.outreach_angle = request.outreach_angle or existing.outreach_angle
        existing.lead_score = request.lead_score or existing.lead_score
        db.commit()
        return {"message": "Lead updated", "id": existing.id}

    lead = Lead(
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
async def get_saved_leads(db: Session = Depends(get_db)):
    """Get all saved leads."""
    leads = db.query(Lead).order_by(Lead.lead_score.desc()).all()
    return leads


@router.delete("/saved/{lead_id}")
async def delete_saved_lead(lead_id: int, db: Session = Depends(get_db)):
    """Delete a saved lead."""
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    db.delete(lead)
    db.commit()
    return {"message": "Lead deleted"}
