"""
Clozflow Relay V1 — API Router
All Relay endpoints: seller-authenticated + public buyer-facing.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, field_validator
from typing import Optional, List
from datetime import datetime
import json
import re

from database import get_db, utc_isoformat
from models import User, CallLog, Capsule
from models_relay import Relay, RelayAvailabilitySlot, RelayBooking, RelayQuestion
from routers.auth import get_current_user
from services.usage_limits import WindowRateLimiter, client_ip, user_key

router = APIRouter(prefix="/api/relay", tags=["relay"])

# ── Limits ─────────────────────────────────────────────────────────────────────
# Seller: relay drafts are LLM-generated.
_relay_create_limiter = WindowRateLimiter(
    "relay-create", 10, 60, "Relay generation rate limit exceeded. Please wait a moment."
)
# Public buyer routes (no login): per client IP, plus per page for writes.
_public_read_limiter = WindowRateLimiter("relay-public-read", 60, 60, "Too many requests. Please wait a moment.")
_public_write_limiter = WindowRateLimiter("relay-public-write", 10, 60, "Too many requests. Please wait a moment and try again.")
_public_question_page_limiter = WindowRateLimiter(
    "relay-public-question-page", 30, 3600, "This page has received too many questions. Please try again later."
)

_SLUG_RE = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
_EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$")
_PHONE_RE = re.compile(r"^[0-9+()\-.\s]{4,32}$")


def _clean_text(value: Optional[str]) -> Optional[str]:
    """Strip and drop control characters (keeps newlines/tabs)."""
    if value is None:
        return None
    value = "".join(ch for ch in str(value) if ch in ("\n", "\t") or ch.isprintable())
    return value.strip()


# ═══════════════════════════════════════════════════════════════════════════════
# PYDANTIC SCHEMAS
# ═══════════════════════════════════════════════════════════════════════════════

class RelayCreateRequest(BaseModel):
    call_id: int
    prospect_name: Optional[str] = None
    prospect_email: Optional[str] = None
    prospect_business: Optional[str] = None
    capsule_id: Optional[int] = None  # optional capsule for product context

class RelayUpdateRequest(BaseModel):
    summary: Optional[str] = None # Legacy
    benefits: Optional[List[str]] = None # Legacy
    primary_need: Optional[str] = None
    interest: Optional[str] = None
    concern: Optional[str] = None
    buyer_context: Optional[str] = None
    problem_statement: Optional[str] = None
    conversation_points: Optional[str] = None # Expecting JSON string
    impact: Optional[str] = None # Expecting JSON string
    solution_approach: Optional[str] = None
    next_step: Optional[str] = None
    prospect_name: Optional[str] = None
    prospect_email: Optional[str] = None
    prospect_business: Optional[str] = None
    buyer_confirmed: Optional[bool] = None
    buyer_corrections: Optional[str] = None

class SlotCreateRequest(BaseModel):
    date: str          # YYYY-MM-DD
    start_time: str    # HH:MM
    end_time: str      # HH:MM
    duration_minutes: Optional[int] = 30
    meeting_type: Optional[str] = "Video Call"

class BookingCreateRequest(BaseModel):
    slot_id: int = Field(..., ge=1)
    buyer_name: str = Field(..., max_length=120)
    buyer_email: Optional[str] = Field(None, max_length=254)
    buyer_phone: Optional[str] = Field(None, max_length=32)

    @field_validator("buyer_name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = _clean_text(v)
        if not v:
            raise ValueError("Please enter your name.")
        return v

    @field_validator("buyer_email")
    @classmethod
    def _email(cls, v: Optional[str]) -> Optional[str]:
        v = _clean_text(v)
        if not v:
            return None
        if not _EMAIL_RE.match(v):
            raise ValueError("Please enter a valid email address.")
        return v

    @field_validator("buyer_phone")
    @classmethod
    def _phone(cls, v: Optional[str]) -> Optional[str]:
        v = _clean_text(v)
        if not v:
            return None
        if not _PHONE_RE.match(v):
            raise ValueError("Please enter a valid phone number.")
        return v

class QuestionCreateRequest(BaseModel):
    question_text: str = Field(..., max_length=2000)

    @field_validator("question_text")
    @classmethod
    def _question(cls, v: str) -> str:
        v = _clean_text(v)
        if not v:
            raise ValueError("Question cannot be empty.")
        return v

class BuyerConfirmRequest(BaseModel):
    """Buyer's answer to "Is this accurate?" on the public page."""
    buyer_confirmed: bool = True
    buyer_corrections: Optional[str] = Field(None, max_length=4000)

    @field_validator("buyer_corrections")
    @classmethod
    def _corrections(cls, v: Optional[str]) -> Optional[str]:
        v = _clean_text(v)
        return v or None

class QuestionReplyRequest(BaseModel):
    answer_text: str = Field(..., max_length=5000)

    @field_validator("answer_text")
    @classmethod
    def _answer(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Reply cannot be empty.")
        return v


# ═══════════════════════════════════════════════════════════════════════════════
# SELLER ENDPOINTS (authenticated)
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/create")
async def create_relay(
    data: RelayCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Generate a Relay draft from a completed call."""
    _relay_create_limiter.hit(user_key(current_user))
    # Verify call ownership
    call = db.query(CallLog).filter(
        CallLog.id == data.call_id,
        CallLog.user_id == current_user.id
    ).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    # Check if relay already exists for this call
    existing = db.query(Relay).filter(
        Relay.call_id == data.call_id,
        Relay.user_id == current_user.id
    ).first()
    if existing:
        return {
            "relay_id": existing.id,
            "slug": existing.slug,
            "status": existing.status,
            "message": "Relay already exists for this call",
            "existing": True
        }

    # Parse call data
    try:
        transcript_data = json.loads(call.transcript or "[]")
    except (TypeError, ValueError):
        transcript_data = []
    try:
        ai_data = json.loads(call.ai_suggestions or "[]")
    except (TypeError, ValueError):
        ai_data = []
    if not isinstance(transcript_data, list):
        transcript_data = []
    if not isinstance(ai_data, list):
        ai_data = []

    # Get capsule for product context if specified, else get default
    capsule_dict = None
    if data.capsule_id:
        capsule = db.query(Capsule).filter(
            Capsule.id == data.capsule_id,
            Capsule.user_id == current_user.id
        ).first()
    else:
        capsule = db.query(Capsule).filter(
            Capsule.user_id == current_user.id,
            Capsule.is_default == True
        ).first()

    if capsule:
        capsule_dict = {
            "product_name": capsule.product_name,
            "product_price": capsule.product_price,
            "product_specification": capsule.product_specification,
            "target_audience": capsule.target_audience,
            "key_differentiators": capsule.key_differentiators,
            "pain_points_solved": capsule.pain_points_solved,
        }

    # Generate AI content
    from services.relay_engine import generate_relay_content
    content = await generate_relay_content(
        transcript_data=transcript_data,
        ai_data=ai_data,
        capsule=capsule_dict,
        prospect_name=data.prospect_name or "",
        prospect_business=data.prospect_business or "",
        seller_name=current_user.full_name or current_user.username or current_user.email.split("@")[0],
        seller_company=current_user.company_name or "",
    )

    # Create Relay record
    relay = Relay(
        user_id=current_user.id,
        call_id=data.call_id,
        prospect_name=data.prospect_name,
        prospect_email=data.prospect_email,
        prospect_business=data.prospect_business,
        
        # Legacy
        summary=content.get("summary", ""),
        benefits=json.dumps(content.get("benefits", [])),
        
        # New spec
        primary_need=content.get("primary_need"),
        interest=content.get("interest"),
        concern=content.get("concern"),
        buyer_context=content.get("buyer_context"),
        problem_statement=content.get("problem_statement"),
        conversation_points=content.get("conversation_points"),
        impact=content.get("impact"),
        solution_approach=content.get("solution_approach"),
        
        next_step=content.get("next_step"),
        seller_name=current_user.full_name or current_user.username or current_user.email.split("@")[0],
        seller_company=current_user.company_name or "",
    )
    db.add(relay)
    db.commit()
    db.refresh(relay)

    return {
        "id": relay.id,
        "relay_id": relay.id,
        "slug": relay.slug,
        "status": relay.status,
        "primary_need": relay.primary_need,
        "interest": relay.interest,
        "concern": relay.concern,
        "buyer_context": relay.buyer_context,
        "problem_statement": relay.problem_statement,
        "conversation_points": relay.conversation_points,
        "impact": relay.impact,
        "solution_approach": relay.solution_approach,
        "next_step": relay.next_step,
        "prospect_name": relay.prospect_name,
        "seller_name": relay.seller_name,
        "seller_company": relay.seller_company,
        # True when the AI provider failed and generic placeholder copy was used.
        "ai_fallback": bool(content.get("ai_fallback")),
        "message": "Relay draft created"
    }

@router.get("/")
def list_relays(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all Relays for the current seller."""
    relays = db.query(Relay).filter(
        Relay.user_id == current_user.id
    ).order_by(Relay.created_at.desc()).all()

    results = []
    for r in relays:
        booking_count = db.query(RelayBooking).filter(RelayBooking.relay_id == r.id).count()
        question_count = db.query(RelayQuestion).filter(RelayQuestion.relay_id == r.id).count()
        unanswered = db.query(RelayQuestion).filter(
            RelayQuestion.relay_id == r.id,
            RelayQuestion.answer_text == None
        ).count()

        results.append({
            "id": r.id,
            "slug": r.slug,
            "status": r.status,
            "prospect_name": r.prospect_name,
            "prospect_business": r.prospect_business,
            "created_at": utc_isoformat(r.created_at),
            "published_at": utc_isoformat(r.published_at),
            "booking_count": booking_count,
            "question_count": question_count,
            "unanswered_questions": unanswered,
            "call_id": r.call_id,
        })

    return results


@router.get("/{relay_id}")
def get_relay(
    relay_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get full Relay detail for the seller."""
    relay = db.query(Relay).filter(
        Relay.id == relay_id,
        Relay.user_id == current_user.id
    ).first()
    if not relay:
        raise HTTPException(status_code=404, detail="Relay not found")

    try:
        benefits = json.loads(relay.benefits or "[]")
    except:
        benefits = []

    slots = [{
        "id": s.id,
        "date": s.date,
        "start_time": s.start_time,
        "end_time": s.end_time,
        "duration_minutes": s.duration_minutes,
        "meeting_type": s.meeting_type,
        "is_booked": s.is_booked,
    } for s in relay.slots]

    bookings = [{
        "id": b.id,
        "buyer_name": b.buyer_name,
        "buyer_email": b.buyer_email,
        "buyer_phone": b.buyer_phone,
        "status": b.status,
        "created_at": utc_isoformat(b.created_at),
        "slot": {
            "date": b.slot.date,
            "start_time": b.slot.start_time,
            "end_time": b.slot.end_time,
            "meeting_type": b.slot.meeting_type,
        } if b.slot else None,
    } for b in relay.bookings]

    questions = [{
        "id": q.id,
        "question_text": q.question_text,
        "answer_text": q.answer_text,
        "asked_at": utc_isoformat(q.asked_at),
        "answered_at": utc_isoformat(q.answered_at),
    } for q in relay.questions]

    return {
        "id": relay.id,
        "slug": relay.slug,
        "status": relay.status,
        "prospect_name": relay.prospect_name,
        "prospect_email": relay.prospect_email,
        "prospect_business": relay.prospect_business,
        "summary": relay.summary,
        "benefits": benefits,
        "primary_need": relay.primary_need,
        "interest": relay.interest,
        "concern": relay.concern,
        "buyer_context": relay.buyer_context,
        "problem_statement": relay.problem_statement,
        "conversation_points": relay.conversation_points,
        "impact": relay.impact,
        "solution_approach": relay.solution_approach,
        "buyer_confirmed": relay.buyer_confirmed,
        "buyer_corrections": relay.buyer_corrections,
        "next_step": relay.next_step,
        "seller_name": relay.seller_name,
        "seller_company": relay.seller_company,
        "created_at": utc_isoformat(relay.created_at),
        "published_at": utc_isoformat(relay.published_at),
        "call_id": relay.call_id,
        "slots": slots,
        "bookings": bookings,
        "questions": questions,
    }

@router.delete("/{relay_id}")
def delete_relay(
    relay_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a Relay and all its associated data."""
    relay = db.query(Relay).filter(
        Relay.id == relay_id,
        Relay.user_id == current_user.id
    ).first()
    if not relay:
        raise HTTPException(status_code=404, detail="Relay not found")

    db.delete(relay)
    db.commit()
    return {"message": "Relay deleted successfully"}

@router.patch("/{relay_id}")
def update_relay(
    relay_id: int,
    data: RelayUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update Relay draft content."""
    relay = db.query(Relay).filter(
        Relay.id == relay_id,
        Relay.user_id == current_user.id
    ).first()
    if not relay:
        raise HTTPException(status_code=404, detail="Relay not found")

    if data.summary is not None:
        relay.summary = data.summary
    if data.benefits is not None:
        relay.benefits = json.dumps(data.benefits)
    if data.primary_need is not None: relay.primary_need = data.primary_need
    if data.interest is not None: relay.interest = data.interest
    if data.concern is not None: relay.concern = data.concern
    if data.buyer_context is not None: relay.buyer_context = data.buyer_context
    if data.problem_statement is not None: relay.problem_statement = data.problem_statement
    if data.conversation_points is not None: relay.conversation_points = data.conversation_points
    if data.impact is not None: relay.impact = data.impact
    if data.solution_approach is not None: relay.solution_approach = data.solution_approach
    if data.next_step is not None:
        relay.next_step = data.next_step
    if data.prospect_name is not None:
        relay.prospect_name = data.prospect_name
    if data.prospect_email is not None:
        relay.prospect_email = data.prospect_email
    if data.prospect_business is not None:
        relay.prospect_business = data.prospect_business
    if data.buyer_confirmed is not None:
        relay.buyer_confirmed = data.buyer_confirmed
    if data.buyer_corrections is not None:
        relay.buyer_corrections = data.buyer_corrections


    relay.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(relay)

    return {"message": "Relay updated", "relay_id": relay.id}


@router.post("/{relay_id}/publish")
def publish_relay(
    relay_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Publish Relay and generate shareable link."""
    relay = db.query(Relay).filter(
        Relay.id == relay_id,
        Relay.user_id == current_user.id
    ).first()
    if not relay:
        raise HTTPException(status_code=404, detail="Relay not found")

    # Validate relay has required content
    if not relay.problem_statement and not relay.buyer_context:
        raise HTTPException(status_code=400, detail="Relay must have a problem statement or context before publishing")

    # Idempotent: re-publishing must not reset buyer progress (opened/booked/...).
    if relay.status == "draft" or not relay.published_at:
        if relay.status == "draft":
            relay.status = "published"
        relay.published_at = relay.published_at or datetime.utcnow()
        relay.updated_at = datetime.utcnow()
        db.commit()

    return {
        "message": "Relay published",
        "slug": relay.slug,
        "status": relay.status,
    }


@router.get("/{relay_id}/slots")
def get_slots(
    relay_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get availability slots for a Relay (Seller endpoint)."""
    relay = db.query(Relay).filter(
        Relay.id == relay_id,
        Relay.user_id == current_user.id
    ).first()
    if not relay:
        raise HTTPException(status_code=404, detail="Relay not found")

    return [{
        "id": s.id,
        "date": s.date,
        "start_time": s.start_time,
        "end_time": s.end_time,
        "duration_minutes": s.duration_minutes,
        "meeting_type": s.meeting_type,
        "is_booked": s.is_booked,
    } for s in relay.slots]


@router.post("/{relay_id}/slots")
def add_slot(
    relay_id: int,
    data: SlotCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add an availability slot to a Relay."""
    relay = db.query(Relay).filter(
        Relay.id == relay_id,
        Relay.user_id == current_user.id
    ).first()
    if not relay:
        raise HTTPException(status_code=404, detail="Relay not found")

    slot = RelayAvailabilitySlot(
        relay_id=relay.id,
        date=data.date,
        start_time=data.start_time,
        end_time=data.end_time,
        duration_minutes=data.duration_minutes or 30,
        meeting_type=data.meeting_type or "Video Call",
    )
    db.add(slot)
    db.commit()
    db.refresh(slot)

    return {
        "id": slot.id,
        "date": slot.date,
        "start_time": slot.start_time,
        "end_time": slot.end_time,
        "duration_minutes": slot.duration_minutes,
        "meeting_type": slot.meeting_type,
        "is_booked": slot.is_booked,
    }


@router.delete("/{relay_id}/slots/{slot_id}")
def delete_slot(
    relay_id: int,
    slot_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove an availability slot."""
    relay = db.query(Relay).filter(
        Relay.id == relay_id,
        Relay.user_id == current_user.id
    ).first()
    if not relay:
        raise HTTPException(status_code=404, detail="Relay not found")

    slot = db.query(RelayAvailabilitySlot).filter(
        RelayAvailabilitySlot.id == slot_id,
        RelayAvailabilitySlot.relay_id == relay.id
    ).first()
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")

    if slot.is_booked:
        raise HTTPException(status_code=400, detail="Cannot delete a booked slot")

    db.delete(slot)
    db.commit()
    return {"message": "Slot deleted"}


# ═══════════════════════════════════════════════════════════════════════════════
# INBOX ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/{relay_id}/bookings")
def get_relay_bookings(
    relay_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all bookings for a Relay."""
    relay = db.query(Relay).filter(
        Relay.id == relay_id,
        Relay.user_id == current_user.id
    ).first()
    if not relay:
        raise HTTPException(status_code=404, detail="Relay not found")

    bookings = db.query(RelayBooking).filter(RelayBooking.relay_id == relay.id).all()
    return [{
        "id": b.id,
        "buyer_name": b.buyer_name,
        "buyer_email": b.buyer_email,
        "buyer_phone": b.buyer_phone,
        "status": b.status,
        "created_at": utc_isoformat(b.created_at),
        "slot": {
            "date": b.slot.date,
            "start_time": b.slot.start_time,
            "end_time": b.slot.end_time,
            "meeting_type": b.slot.meeting_type,
        } if b.slot else None,
    } for b in bookings]


@router.post("/{relay_id}/questions/{question_id}/reply")
def reply_to_question(
    relay_id: int,
    question_id: int,
    data: QuestionReplyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Seller replies to a buyer's question from the builder inbox."""
    question = db.query(RelayQuestion).join(Relay).filter(
        RelayQuestion.id == question_id,
        RelayQuestion.relay_id == relay_id,
        Relay.user_id == current_user.id
    ).first()

    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    question.answer_text = data.answer_text
    question.answered_at = datetime.utcnow()
    db.commit()

    return {"message": "Reply sent", "question_id": question.id}


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC BUYER ENDPOINTS (no auth required; addressed by the unguessable slug)
# Per-IP rate limits, strict input validation, drafts are invisible (404).
# ═══════════════════════════════════════════════════════════════════════════════

def _public_relay(slug: str, request: Request, db: Session, *, write: bool) -> Relay:
    """Rate-limits the caller and resolves a published relay by slug (404 otherwise)."""
    limiter = _public_write_limiter if write else _public_read_limiter
    limiter.hit(f"ip:{client_ip(request)}")
    if not slug or not _SLUG_RE.match(slug):
        raise HTTPException(status_code=404, detail="Relay not found")
    relay = db.query(Relay).filter(Relay.slug == slug).first()
    if not relay:
        raise HTTPException(status_code=404, detail="Relay not found")
    if relay.status == "draft":
        raise HTTPException(status_code=404, detail="This relay is not available yet")
    return relay


@router.get("/public/{slug}")
def get_public_relay(
    slug: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """Get buyer-facing Relay page data. No authentication required.
    Returns ONLY safe, buyer-facing information — never internal data."""
    relay = _public_relay(slug, request, db, write=False)

    # Update status to opened if first time
    if relay.status == "published":
        relay.status = "opened"
        relay.updated_at = datetime.utcnow()
        db.commit()

    try:
        benefits = json.loads(relay.benefits or "[]")
    except (TypeError, ValueError):
        benefits = []

    # Only return available (unbooked) slots
    available_slots = [{
        "id": s.id,
        "date": s.date,
        "start_time": s.start_time,
        "end_time": s.end_time,
        "duration_minutes": s.duration_minutes,
        "meeting_type": s.meeting_type,
    } for s in relay.slots if not s.is_booked]

    # Questions asked on THIS page (oldest first), with the seller's reply if any.
    ordered_questions = sorted(relay.questions, key=lambda q: (q.asked_at or datetime.min, q.id or 0))
    questions = [{
        "id": q.id,
        "question_text": q.question_text,
        "answer_text": q.answer_text,
        "answered": bool(q.answer_text),
        "asked_at": utc_isoformat(q.asked_at),
        "answered_at": utc_isoformat(q.answered_at),
    } for q in ordered_questions]

    # Answered questions only — the seller's replies the buyer should see.
    seller_replies = [{
        "question_id": q.id,
        "question_text": q.question_text,
        "answer_text": q.answer_text,
        "asked_at": utc_isoformat(q.asked_at),
        "answered_at": utc_isoformat(q.answered_at),
    } for q in sorted(
        (q for q in relay.questions if q.answer_text),
        key=lambda q: (q.answered_at or q.asked_at or datetime.min, q.id or 0),
    )]

    # Check if already booked
    has_booking = db.query(RelayBooking).filter(
        RelayBooking.relay_id == relay.id,
        RelayBooking.status == "confirmed"
    ).first()

    return {
        "relay": {
            "slug": relay.slug,
            "status": relay.status,
            "prospect_name": relay.prospect_name,
            "summary": relay.summary,
            "benefits": benefits,
            "primary_need": relay.primary_need,
            "interest": relay.interest,
            "concern": relay.concern,
            "buyer_context": relay.buyer_context,
            "problem_statement": relay.problem_statement,
            "conversation_points": relay.conversation_points,
            "impact": relay.impact,
            "solution_approach": relay.solution_approach,
            "buyer_confirmed": relay.buyer_confirmed,
            "buyer_corrections": relay.buyer_corrections,
            "next_step": relay.next_step,
            "seller_name": relay.seller_name,
            "seller_company": relay.seller_company,
            "has_booking": has_booking is not None,
            "booking": {
                "buyer_name": has_booking.buyer_name,
                "date": has_booking.slot.date if has_booking.slot else None,
                "start_time": has_booking.slot.start_time if has_booking.slot else None,
                "end_time": has_booking.slot.end_time if has_booking.slot else None,
                "meeting_type": has_booking.slot.meeting_type if has_booking.slot else None,
            } if has_booking else None,
            "questions": questions,
            "seller_replies": seller_replies,
        },
        "slots": available_slots,
    }


@router.post("/public/{slug}/book")
def create_booking(
    slug: str,
    data: BookingCreateRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """Buyer books a follow-up meeting. Server-side slot validation prevents double-booking."""
    relay = _public_relay(slug, request, db, write=True)

    slot = db.query(RelayAvailabilitySlot).filter(
        RelayAvailabilitySlot.id == data.slot_id,
        RelayAvailabilitySlot.relay_id == relay.id,
    ).first()
    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")

    # Atomic claim: only one concurrent request can flip is_booked (works on
    # SQLite, where SELECT ... FOR UPDATE is a no-op, and on PostgreSQL).
    claimed = db.query(RelayAvailabilitySlot).filter(
        RelayAvailabilitySlot.id == slot.id,
        RelayAvailabilitySlot.relay_id == relay.id,
        RelayAvailabilitySlot.is_booked.is_(False),
    ).update({"is_booked": True}, synchronize_session=False)
    if claimed != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail="This slot is no longer available. Please choose another time.")

    # Create booking
    booking = RelayBooking(
        relay_id=relay.id,
        slot_id=slot.id,
        buyer_name=data.buyer_name,
        buyer_email=data.buyer_email,
        buyer_phone=data.buyer_phone,
    )
    db.add(booking)

    # Update relay status
    relay.status = "booked"
    relay.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(booking)
    db.refresh(slot)

    return {
        "message": "Meeting booked successfully!",
        "booking_id": booking.id,
        "date": slot.date,
        "start_time": slot.start_time,
        "end_time": slot.end_time,
        "meeting_type": slot.meeting_type,
        "duration_minutes": slot.duration_minutes,
        "seller_name": relay.seller_name,
        "seller_company": relay.seller_company,
    }


@router.post("/public/{slug}/question")
@router.post("/public/{slug}/questions")
def submit_question(
    slug: str,
    data: QuestionCreateRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """Buyer submits a question (both `/question` and `/questions` are accepted)."""
    relay = _public_relay(slug, request, db, write=True)
    _public_question_page_limiter.hit(f"slug:{relay.slug}")

    question = RelayQuestion(
        relay_id=relay.id,
        question_text=data.question_text,
    )
    db.add(question)

    # Update status if not already booked
    if relay.status in ("published", "opened"):
        relay.status = "question_received"
        relay.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(question)

    return {
        "message": "Question submitted",
        "question_id": question.id,
    }


@router.api_route("/public/{slug}/confirm", methods=["POST", "PATCH"])
def confirm_relay_accuracy(
    slug: str,
    data: BuyerConfirmRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """Buyer answers "Is this accurate?": `buyer_confirmed: true` ("Yes, that's
    accurate") or `buyer_confirmed: false` with `buyer_corrections` text."""
    relay = _public_relay(slug, request, db, write=True)

    if not data.buyer_confirmed and not data.buyer_corrections:
        raise HTTPException(status_code=422, detail="Please describe what should be corrected.")

    relay.buyer_confirmed = bool(data.buyer_confirmed)
    relay.buyer_corrections = None if data.buyer_confirmed else data.buyer_corrections
    relay.updated_at = datetime.utcnow()
    db.commit()

    return {
        "message": "Confirmation recorded" if relay.buyer_confirmed else "Correction recorded",
        "buyer_confirmed": relay.buyer_confirmed,
        "buyer_corrections": relay.buyer_corrections,
    }


@router.post("/public/{slug}/not-interested")
def mark_not_interested(
    slug: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """Buyer marks not interested."""
    relay = _public_relay(slug, request, db, write=True)

    relay.status = "not_interested"
    relay.updated_at = datetime.utcnow()
    db.commit()

    return {"message": "Response recorded"}


@router.post("/public/{slug}/contact-later")
def mark_contact_later(
    slug: str,
    request: Request,
    db: Session = Depends(get_db)
):
    """Buyer requests to be contacted later."""
    relay = _public_relay(slug, request, db, write=True)

    # Don't downgrade from 'booked'
    if relay.status not in ("booked", "completed"):
        relay.status = "opened"  # Keep as opened, they showed interest
        relay.updated_at = datetime.utcnow()
        db.commit()

    return {"message": "Response recorded"}
