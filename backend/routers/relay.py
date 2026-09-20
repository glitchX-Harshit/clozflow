"""
Clozflow Relay V1 — API Router
All Relay endpoints: seller-authenticated + public buyer-facing.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import json

from database import get_db
from models import User, CallLog, Capsule
from models_relay import Relay, RelayAvailabilitySlot, RelayBooking, RelayQuestion
from routers.auth import get_current_user

router = APIRouter(prefix="/api/relay", tags=["relay"])


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
    summary: Optional[str] = None
    benefits: Optional[List[str]] = None
    next_step: Optional[str] = None
    prospect_name: Optional[str] = None
    prospect_email: Optional[str] = None
    prospect_business: Optional[str] = None

class SlotCreateRequest(BaseModel):
    date: str          # YYYY-MM-DD
    start_time: str    # HH:MM
    end_time: str      # HH:MM
    duration_minutes: Optional[int] = 30
    meeting_type: Optional[str] = "Video Call"

class BookingCreateRequest(BaseModel):
    slot_id: int
    buyer_name: str
    buyer_email: Optional[str] = None
    buyer_phone: Optional[str] = None

class QuestionCreateRequest(BaseModel):
    question_text: str

class QuestionReplyRequest(BaseModel):
    answer_text: str


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
        ai_data = json.loads(call.ai_suggestions or "[]")
    except:
        transcript_data = []
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
        summary=content["summary"],
        benefits=json.dumps(content["benefits"]),
        next_step=content["next_step"],
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
        "summary": relay.summary,
        "benefits": content["benefits"],
        "next_step": relay.next_step,
        "prospect_name": relay.prospect_name,
        "seller_name": relay.seller_name,
        "seller_company": relay.seller_company,
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
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "published_at": r.published_at.isoformat() if r.published_at else None,
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
        "created_at": b.created_at.isoformat() if b.created_at else None,
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
        "asked_at": q.asked_at.isoformat() if q.asked_at else None,
        "answered_at": q.answered_at.isoformat() if q.answered_at else None,
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
        "next_step": relay.next_step,
        "seller_name": relay.seller_name,
        "seller_company": relay.seller_company,
        "created_at": relay.created_at.isoformat() if relay.created_at else None,
        "published_at": relay.published_at.isoformat() if relay.published_at else None,
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
    if data.next_step is not None:
        relay.next_step = data.next_step
    if data.prospect_name is not None:
        relay.prospect_name = data.prospect_name
    if data.prospect_email is not None:
        relay.prospect_email = data.prospect_email
    if data.prospect_business is not None:
        relay.prospect_business = data.prospect_business

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
    if not relay.summary:
        raise HTTPException(status_code=400, detail="Relay must have a summary before publishing")

    relay.status = "published"
    relay.published_at = datetime.utcnow()
    relay.updated_at = datetime.utcnow()
    db.commit()

    return {
        "message": "Relay published",
        "slug": relay.slug,
        "status": relay.status,
    }


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
        "created_at": b.created_at.isoformat() if b.created_at else None,
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
    """Seller replies to a buyer question."""
    relay = db.query(Relay).filter(
        Relay.id == relay_id,
        Relay.user_id == current_user.id
    ).first()
    if not relay:
        raise HTTPException(status_code=404, detail="Relay not found")

    question = db.query(RelayQuestion).filter(
        RelayQuestion.id == question_id,
        RelayQuestion.relay_id == relay.id
    ).first()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    question.answer_text = data.answer_text
    question.answered_at = datetime.utcnow()
    db.commit()

    return {"message": "Reply sent", "question_id": question.id}


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC BUYER ENDPOINTS (no auth required)
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/public/{slug}")
def get_public_relay(
    slug: str,
    db: Session = Depends(get_db)
):
    """Get buyer-facing Relay page data. No authentication required.
    Returns ONLY safe, buyer-facing information — never internal data."""
    relay = db.query(Relay).filter(Relay.slug == slug).first()
    if not relay:
        raise HTTPException(status_code=404, detail="Relay not found")

    if relay.status == "draft":
        raise HTTPException(status_code=404, detail="This relay is not available yet")

    # Update status to opened if first time
    if relay.status == "published":
        relay.status = "opened"
        relay.updated_at = datetime.utcnow()
        db.commit()

    try:
        benefits = json.loads(relay.benefits or "[]")
    except:
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

    # Only return questions with answers visible, plus buyer's own unanswered
    questions = [{
        "id": q.id,
        "question_text": q.question_text,
        "answer_text": q.answer_text,
        "asked_at": q.asked_at.isoformat() if q.asked_at else None,
        "answered_at": q.answered_at.isoformat() if q.answered_at else None,
    } for q in relay.questions]

    # Check if already booked
    has_booking = db.query(RelayBooking).filter(
        RelayBooking.relay_id == relay.id,
        RelayBooking.status == "confirmed"
    ).first()

    return {
        "slug": relay.slug,
        "status": relay.status,
        "prospect_name": relay.prospect_name,
        "summary": relay.summary,
        "benefits": benefits,
        "next_step": relay.next_step,
        "seller_name": relay.seller_name,
        "seller_company": relay.seller_company,
        "available_slots": available_slots,
        "questions": questions,
        "has_booking": has_booking is not None,
        "booking": {
            "buyer_name": has_booking.buyer_name,
            "date": has_booking.slot.date if has_booking.slot else None,
            "start_time": has_booking.slot.start_time if has_booking.slot else None,
            "end_time": has_booking.slot.end_time if has_booking.slot else None,
            "meeting_type": has_booking.slot.meeting_type if has_booking.slot else None,
        } if has_booking else None,
    }


@router.post("/public/{slug}/book")
def create_booking(
    slug: str,
    data: BookingCreateRequest,
    db: Session = Depends(get_db)
):
    """Buyer books a follow-up meeting. Server-side slot validation prevents double-booking."""
    relay = db.query(Relay).filter(Relay.slug == slug).first()
    if not relay:
        raise HTTPException(status_code=404, detail="Relay not found")
    if relay.status == "draft":
        raise HTTPException(status_code=400, detail="Relay is not published")

    # Validate and lock the slot (atomic check + update)
    slot = db.query(RelayAvailabilitySlot).filter(
        RelayAvailabilitySlot.id == data.slot_id,
        RelayAvailabilitySlot.relay_id == relay.id,
    ).with_for_update().first()  # Row lock for concurrency

    if not slot:
        raise HTTPException(status_code=404, detail="Slot not found")
    if slot.is_booked:
        raise HTTPException(status_code=409, detail="This slot is no longer available. Please choose another time.")

    # Mark slot as booked
    slot.is_booked = True

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
def submit_question(
    slug: str,
    data: QuestionCreateRequest,
    db: Session = Depends(get_db)
):
    """Buyer submits a question."""
    relay = db.query(Relay).filter(Relay.slug == slug).first()
    if not relay:
        raise HTTPException(status_code=404, detail="Relay not found")
    if relay.status == "draft":
        raise HTTPException(status_code=400, detail="Relay is not published")

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


@router.post("/public/{slug}/not-interested")
def mark_not_interested(
    slug: str,
    db: Session = Depends(get_db)
):
    """Buyer marks not interested."""
    relay = db.query(Relay).filter(Relay.slug == slug).first()
    if not relay:
        raise HTTPException(status_code=404, detail="Relay not found")

    relay.status = "not_interested"
    relay.updated_at = datetime.utcnow()
    db.commit()

    return {"message": "Response recorded"}


@router.post("/public/{slug}/contact-later")
def mark_contact_later(
    slug: str,
    db: Session = Depends(get_db)
):
    """Buyer requests to be contacted later."""
    relay = db.query(Relay).filter(Relay.slug == slug).first()
    if not relay:
        raise HTTPException(status_code=404, detail="Relay not found")

    # Don't downgrade from 'booked'
    if relay.status not in ("booked", "completed"):
        relay.status = "opened"  # Keep as opened, they showed interest
        relay.updated_at = datetime.utcnow()
        db.commit()

    return {"message": "Response recorded"}
