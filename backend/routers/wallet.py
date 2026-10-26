"""
ClozFlow Wallet & Credits Router
Handles credit balance queries, transaction history, top-ups (1 INR = 1 Credit),
metering estimates, and phone number rentals.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime

from database import get_db
from models import User
from admin.models import CreditTransaction
from routers.auth import get_current_user
from services.credit_service import (
    get_balance,
    add_credits,
    deduct_credits,
    calculate_call_metering,
    RATE_PER_TEST_SIMULATION,
    RATE_PEARL_CALL_PER_MIN,
    RATE_TELEPHONY_PULSE_30S,
    RATE_PHONE_RENTAL_MONTHLY,
)

router = APIRouter(prefix="/api/wallet", tags=["wallet"])


# ── Pydantic Request / Response Schemas ────────────────────────────────────────

class TopUpRequest(BaseModel):
    amount: float = Field(..., gt=0, description="Amount in INR (1 INR = 1 Credit)")
    payment_method: str = "razorpay"
    payment_id: Optional[str] = None


class CallCostEstimateRequest(BaseModel):
    duration_seconds: int = Field(..., ge=0, description="Call length in seconds")


class TransactionItem(BaseModel):
    id: int
    amount: float
    balance_after: float
    type: str
    description: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/balance")
def get_wallet_balance(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Fetch user's current credit balance, superuser status, and canonical metering rates."""
    is_super = bool(getattr(current_user, "is_admin", False) or getattr(current_user, "admin_role", "user") in ["admin", "super_admin"])
    balance = float(current_user.credit_balance or 0.0)

    return {
        "credit_balance": balance,
        "is_superuser": is_super,
        "is_unlimited": is_super,
        "currency": "INR",
        "conversion_rule": "1 INR = 1 Credit",
        "rates": {
            "test_simulation": RATE_PER_TEST_SIMULATION,
            "pearl_call_per_minute": RATE_PEARL_CALL_PER_MIN,
            "telephony_pulse_30s": RATE_TELEPHONY_PULSE_30S,
            "phone_rental_monthly": RATE_PHONE_RENTAL_MONTHLY,
        }
    }


@router.get("/transactions")
def get_transaction_history(
    limit: int = Query(30, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Fetch user's recent credit deductions, top-ups, and rentals."""
    txns = db.query(CreditTransaction).filter(
        CreditTransaction.user_id == current_user.id
    ).order_by(desc(CreditTransaction.created_at)).limit(limit).all()

    return {
        "total": len(txns),
        "transactions": [
            {
                "id": t.id,
                "amount": round(float(t.amount), 2),
                "balance_after": round(float(t.balance_after), 2),
                "type": t.type,
                "description": t.description or "",
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in txns
        ]
    }


@router.post("/topup")
def top_up_credits(
    req: TopUpRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Simulation top-up endpoint.
    Restricted to Superusers only. Normal users must wait for live payment gateway.
    """
    is_super = bool(getattr(current_user, "is_admin", False) or getattr(current_user, "admin_role", "user") in ["admin", "super_admin"])
    if not is_super:
        raise HTTPException(
            status_code=403,
            detail="Credit purchase gateway is currently under integration. Online self-serve top up is Coming Soon."
        )

    amount = round(req.amount, 2)
    if amount < 10.0:
        raise HTTPException(status_code=400, detail="Minimum top-up amount is ₹10.00 (10 Credits)")

    new_balance = add_credits(
        db=db,
        user_id=current_user.id,
        amount=amount,
        description=f"Superuser Test Top-Up (+₹{amount:.2f})",
        payment_method="superuser_simulation",
        provider_payment_id=req.payment_id
    )

    return {
        "ok": True,
        "amount_added": amount,
        "new_balance": new_balance,
        "message": f"Successfully credited {amount:.2f} Credits (₹{amount:.2f}) to your wallet."
    }


@router.post("/estimate-call-cost")
def estimate_call_cost(req: CallCostEstimateRequest):
    """Calculate the estimated credit burn for a prospective call duration."""
    breakdown = calculate_call_metering(req.duration_seconds)
    return {
        "ok": True,
        **breakdown,
        "summary": (
            f"Duration: {req.duration_seconds}s | "
            f"Pearl Voice AI: ₹{breakdown['pearl_voice_cost']:.2f} | "
            f"Telephony ({breakdown['pulses']} pulses): ₹{breakdown['telephony_cost']:.2f} | "
            f"Total: {breakdown['total_credits']:.2f} Credits (₹{breakdown['total_credits']:.2f})"
        )
    }


@router.post("/rent-phone-number")
def rent_phone_number(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Rent a dedicated virtual phone number for 30 days.
    Deducts ₹199 (199 Credits) from the user's balance.
    """
    cost = RATE_PHONE_RENTAL_MONTHLY
    new_balance = deduct_credits(
        db=db,
        user_id=current_user.id,
        amount=cost,
        description=f"Dedicated Phone Number Rental (30 Days) - Business Plan",
        category="phone_rental"
    )

    return {
        "ok": True,
        "deducted": cost,
        "new_balance": new_balance,
        "message": f"Dedicated caller ID provisioned. ₹{cost:.2f} deducted for 30 days rental."
    }
