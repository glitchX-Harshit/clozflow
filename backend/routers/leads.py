"""
Lead Finder API Router
──────────────────────
POST /leads/search          — Search for business leads (with opportunity scoring)
POST /leads/deep-search     — Deep area-level iteration search with real-time SSE progress
POST /leads/save            — Save a lead to the database (tenant-isolated)
GET  /leads/saved           — Get saved leads for current user
DELETE /leads/saved/{id}    — Delete a saved lead

Every route requires ``Authorization: Bearer <token>``: search spends paid
Google Places / LLM quota and the saved-lead routes touch user data.
"""

import asyncio
import contextlib
import json
from typing import AsyncIterator, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Request, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from models import Lead, User
from routers.auth import get_current_user, verify_token_string
from services.usage_limits import StreamSlots, WindowRateLimiter, user_key

router = APIRouter(prefix="/leads", tags=["leads"])

# Per-user limits (search spends one Places call + up to 20 LLM calls).
MAX_SEARCHES_PER_MINUTE = 40
MAX_DEEP_SEARCHES_PER_MINUTE = 6
MAX_CONCURRENT_DEEP_SEARCHES = 2
SSE_HEARTBEAT_SECONDS = 15.0

_search_limiter = WindowRateLimiter(
    "lead-search", MAX_SEARCHES_PER_MINUTE, 60,
    "Lead search rate limit exceeded. Please wait a moment before searching again.",
)
_deep_search_limiter = WindowRateLimiter(
    "lead-deep-search", MAX_DEEP_SEARCHES_PER_MINUTE, 60,
    "Deep search rate limit exceeded. Please wait a moment before starting another deep search.",
)
_deep_search_slots = StreamSlots(
    MAX_CONCURRENT_DEEP_SEARCHES,
    f"You already have {MAX_CONCURRENT_DEEP_SEARCHES} deep searches running. "
    "Wait for one to finish (or cancel it) and try again.",
)

# Backwards-compatible alias: all routes now use the project-wide dependency.
get_current_user_from_header = get_current_user


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
    business_name: str = Field(..., max_length=300)
    category: str = Field("", max_length=300)
    city: str = Field("", max_length=300)
    phone_number: str = Field("", max_length=64)
    website: str = Field("", max_length=2048)
    instagram: str = Field("", max_length=300)
    google_rating: float = 0
    ai_summary: str = Field("", max_length=10000)
    likely_pain_point: str = Field("", max_length=10000)
    outreach_angle: str = Field("", max_length=10000)
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
    reviews_count: int = 0
    # True for fabricated sample leads (no Google Places key configured).
    is_sample: bool = False
    # False when the AI provider was unavailable and rule-based text was used.
    ai_enriched: bool = False

    class Config:
        from_attributes = True


# ── Validation helpers ───────────────────────────────────────────────────────

MAX_QUERY_CHARS = 300
MAX_OFFER_CHARS = 1000
MAX_FILTER_TEXT_CHARS = 120


def _validated_filters(body: LeadSearchRequest) -> Dict:
    """Checks the search body and returns sanitized filters (400 on bad input)."""
    query = (body.query or "").strip()
    if len(query) < 2:
        raise HTTPException(status_code=400, detail="Search query is too short")
    if len(query) > MAX_QUERY_CHARS:
        raise HTTPException(status_code=400, detail="Search query exceeds maximum allowed length")
    if len(body.user_offer or "") > MAX_OFFER_CHARS:
        raise HTTPException(status_code=400, detail=f"user_offer exceeds maximum allowed length ({MAX_OFFER_CHARS} characters)")

    raw = body.filters or {}
    clean: Dict = {}
    rating = raw.get("rating")
    if rating not in (None, "", 0, False):
        try:
            rating_value = float(rating)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="filters.rating must be a number between 0 and 5")
        if not 0 <= rating_value <= 5:
            raise HTTPException(status_code=400, detail="filters.rating must be a number between 0 and 5")
        clean["rating"] = rating_value
    for key in ("city", "business_category"):
        value = raw.get(key)
        if value in (None, ""):
            continue
        if not isinstance(value, str) or len(value) > MAX_FILTER_TEXT_CHARS:
            raise HTTPException(status_code=400, detail=f"filters.{key} must be text of at most {MAX_FILTER_TEXT_CHARS} characters")
        if value.strip():
            clean[key] = value.strip()
    for key in ("website_presence", "instagram_presence"):
        if raw.get(key):
            clean[key] = True
    return clean


def _sse_frame(event: str, payload: Dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, default=str)}\n\n"


_TERMINAL_EVENTS = ("event: complete\n", "event: error\n")


async def sse_guarded_stream(
    request,
    source: AsyncIterator[str],
    *,
    heartbeat_seconds: float = SSE_HEARTBEAT_SECONDS,
    on_close: Optional[Callable[[], None]] = None,
) -> AsyncIterator[str]:
    """Relays SSE frames from ``source`` to the client.

    * sends an opening comment immediately and a ``: keep-alive`` comment
      whenever the producer is quiet for ``heartbeat_seconds`` (keeps proxies
      from buffering / timing out);
    * stops the producer as soon as the client disconnects (also when the
      server does not cancel streaming responses on disconnect);
    * guarantees exactly one terminal ``complete`` or ``error`` event unless
      the client went away;
    * never leaves the producer task running, whatever happens.
    """
    queue: asyncio.Queue = asyncio.Queue(maxsize=32)
    end = object()

    async def _produce() -> None:
        try:
            async for frame in source:
                await queue.put(frame)
        except Exception as exc:  # CancelledError is not an Exception: it propagates
            print(f"[LeadsSSE] producer failed: {type(exc).__name__}")
            await queue.put(_sse_frame("error", {
                "detail": "The search stopped unexpectedly. Please try again.",
                "code": "internal_error",
            }))
        finally:
            with contextlib.suppress(Exception):
                await source.aclose()
        await queue.put(end)

    task = asyncio.create_task(_produce())
    task.add_done_callback(lambda t: t.cancelled() or t.exception())
    terminal_sent = False
    try:
        yield ": stream-open\n\n"
        while True:
            try:
                frame = await asyncio.wait_for(queue.get(), timeout=heartbeat_seconds)
            except asyncio.TimeoutError:
                if await request.is_disconnected():
                    return
                yield ": keep-alive\n\n"
                continue
            if frame is end:
                break
            if frame.startswith(_TERMINAL_EVENTS):
                terminal_sent = True
            yield frame
            if terminal_sent:
                break
            if await request.is_disconnected():
                return
        if not terminal_sent:
            yield _sse_frame("error", {
                "detail": "The search ended without a result. Please try again.",
                "code": "incomplete",
            })
    finally:
        if not task.done():
            task.cancel()
        with contextlib.suppress(BaseException):
            await asyncio.wait_for(asyncio.shield(task), timeout=5)
        if on_close is not None:
            with contextlib.suppress(Exception):
                on_close()


def _provider_http_error(exc) -> HTTPException:
    headers = {"Retry-After": "60"} if exc.quota else None
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE if exc.quota else status.HTTP_502_BAD_GATEWAY,
        detail=exc.public_detail,
        headers=headers,
    )


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/search", response_model=List[LeadResponse])
async def search_leads_endpoint(
    request: Request,
    body: LeadSearchRequest,
    response: Response,
    current_user: User = Depends(get_current_user),
):
    """Search for business leads using natural language query with opportunity scoring.

    Sample (fabricated) leads are only returned when no Google Places key is
    configured; they carry ``is_sample: true`` and the response has the
    header ``X-Sample-Data: true``.
    """
    _search_limiter.hit(user_key(current_user))
    filters = _validated_filters(body)
    from services.lead_engine import PlacesProviderError, search_leads

    try:
        results = await search_leads(
            body.query,
            filters,
            user_offer=body.user_offer,
            search_mode=body.search_mode,
        )
    except PlacesProviderError as exc:
        raise _provider_http_error(exc)
    if any(lead.get("is_sample") for lead in results):
        response.headers["X-Sample-Data"] = "true"
    return results


@router.post("/deep-search")
async def deep_search_leads_endpoint(
    request: Request,
    body: LeadSearchRequest,
    current_user: User = Depends(get_current_user),
):
    """Deep area-level iteration search with real-time SSE progress updates.

    Events: ``searching``, ``lead_found``, ``area_done`` and exactly one
    terminal ``complete`` or ``error`` event. Comment lines (``: ...``) are
    heartbeats.
    """
    key = user_key(current_user)
    _search_limiter.hit(key)
    _deep_search_limiter.hit(key)
    filters = _validated_filters(body)
    from services.lead_engine import deep_search_leads

    slot = _deep_search_slots.acquire(key)
    source = deep_search_leads(
        body.query,
        filters,
        user_offer=body.user_offer,
        search_mode=body.search_mode,
    )
    return StreamingResponse(
        sse_guarded_stream(request, source, on_close=lambda: _deep_search_slots.release(key, slot)),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/save")
def save_lead(
    request: LeadSaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Save a discovered lead to the database with strict tenant isolation."""
    # Check for duplicates by business name + city for THIS user
    existing = db.query(Lead).filter(
        Lead.business_name == request.business_name,
        Lead.city == request.city,
        Lead.user_id == current_user.id
    ).first()

    if existing:
        # Contact details the client sent win over the stored ones (e.g. a
        # corrected phone number must be the one Pearl redials); empty values
        # never erase what is already saved. The lookup above is owner-scoped.
        for field in ("phone_number", "website", "instagram", "category"):
            value = (getattr(request, field) or "").strip()
            if value:
                setattr(existing, field, value)
        if request.google_rating:
            existing.google_rating = request.google_rating
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
def get_saved_leads(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all saved leads strictly isolated to the authenticated user."""
    leads = db.query(Lead).filter(Lead.user_id == current_user.id).order_by(Lead.lead_score.desc()).all()
    return leads


@router.delete("/saved/{lead_id}")
def delete_saved_lead(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a saved lead ensuring the authenticated user owns it."""
    lead = db.query(Lead).filter(Lead.id == lead_id, Lead.user_id == current_user.id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    db.delete(lead)
    db.commit()
    return {"message": "Lead deleted"}
