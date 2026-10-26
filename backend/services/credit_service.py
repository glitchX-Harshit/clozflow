"""
ClozFlow Credit & Telephony Metering Service
Enforces the 1 INR = 1 Credit billing architecture:
- Pearl Agent Test Simulation: 2.0 Credits (₹2.00) flat per session
- Pearl Live Lead Call: 2.5 Credits (₹2.50) per minute
- Vobiz Telephony Usage: 0.2 Credits (₹0.20) per 30s pulse for business plans
- Phone Number Rental: 199.0 Credits (₹199.00) per month
"""
import math
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from fastapi import HTTPException

from models import User
from admin.models import CreditTransaction, Payment

# ── Canonical Pricing Rates ───────────────────────────────────────────────────
RATE_PER_TEST_SIMULATION   = 2.0     # ₹2.00 flat per simulation
RATE_PEARL_CALL_PER_MIN    = 2.5     # ₹2.50 per 60 seconds
RATE_TELEPHONY_PULSE_30S   = 0.2     # ₹0.20 per 30-second pulse
RATE_PHONE_RENTAL_MONTHLY  = 199.0   # ₹199.00 / month


def is_user_superuser(db: Session, user_id: int) -> bool:
    """Check if the user has superuser / admin privileges."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return False
    return bool(getattr(user, "is_admin", False) or getattr(user, "admin_role", "user") in ["admin", "super_admin"])


def get_balance(db: Session, user_id: int) -> float:
    """Return user's live credit balance rounded to 2 decimal places."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return 0.0
    return round(float(user.credit_balance or 0.0), 2)


def has_sufficient_balance(db: Session, user_id: int, required_credits: float) -> bool:
    """
    Check if user has at least required_credits.
    Superusers have unlimited credits and always pass.
    """
    if is_user_superuser(db, user_id):
        return True
    return get_balance(db, user_id) >= required_credits


def deduct_credits(
    db: Session,
    user_id: int,
    amount: float,
    description: str,
    category: str = "consumption"
) -> float:
    """
    Atomically deduct credits from user balance and record CreditTransaction.
    Superusers have unlimited money and are never blocked.
    Normal users get HTTP 402 if balance is insufficient.
    """
    amount = round(float(amount), 2)
    if amount <= 0:
        return get_balance(db, user_id)

    user = db.query(User).filter(User.id == user_id).with_for_update().first()
    if not user:
        raise HTTPException(status_code=404, detail="User account not found")

    is_super = bool(getattr(user, "is_admin", False) or getattr(user, "admin_role", "user") in ["admin", "super_admin"])
    current_balance = round(float(user.credit_balance or 0.0), 2)

    if not is_super and current_balance < amount:
        raise HTTPException(
            status_code=402,
            detail=(
                f"Insufficient credits. Required: {amount} Credits (₹{amount:.2f}), "
                f"Available Balance: {current_balance:.2f} Credits (₹{current_balance:.2f}). "
                f"Please upgrade or contact administrator for top-up."
            )
        )

    # For superuser, keep balance intact or simulate deduction without blocking
    new_balance = current_balance if is_super else round(current_balance - amount, 2)
    if not is_super:
        user.credit_balance = new_balance

    txn = CreditTransaction(
        user_id=user_id,
        amount=-amount,
        balance_after=new_balance,
        type=category,
        description=f"[Superuser Test] {description}" if is_super else description
    )
    db.add(txn)
    db.commit()
    db.refresh(user)

    return new_balance


def add_credits(
    db: Session,
    user_id: int,
    amount: float,
    description: str,
    payment_method: str = "razorpay",
    provider_payment_id: Optional[str] = None
) -> float:
    """
    Top up user credit balance (1 INR = 1 Credit) and log transaction & payment.
    """
    amount = round(float(amount), 2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Top up amount must be greater than zero")

    user = db.query(User).filter(User.id == user_id).with_for_update().first()
    if not user:
        raise HTTPException(status_code=404, detail="User account not found")

    current_balance = round(float(user.credit_balance or 0.0), 2)
    new_balance = round(current_balance + amount, 2)
    user.credit_balance = new_balance

    # Record Credit Transaction
    txn = CreditTransaction(
        user_id=user_id,
        amount=amount,
        balance_after=new_balance,
        type="topup",
        description=description
    )
    db.add(txn)

    # Record Payment Ledger Entry
    payment = Payment(
        user_id=user_id,
        gross_amount=int(amount),
        net_amount=int(amount),
        currency="INR",
        status="succeeded",
        provider=payment_method,
        provider_payment_id=provider_payment_id or f"topup_{user_id}_{int(amount)}"
    )
    db.add(payment)

    db.commit()
    db.refresh(user)

    return new_balance


def calculate_call_metering(duration_seconds: int) -> Dict[str, Any]:
    """
    Calculate dual-metered cost for an outbound Pearl call:
    1. Pearl Voice AI: 2.5 Credits / min
    2. Vobiz Telephony: 0.2 Credits per 30-second pulse
    """
    duration_seconds = max(0, int(duration_seconds))
    if duration_seconds == 0:
        return {
            "duration_seconds": 0,
            "pearl_voice_cost": 0.0,
            "pulses": 0,
            "telephony_cost": 0.0,
            "total_credits": 0.0
        }

    # Pearl AI Voice Engine (2.5 Rs / min calculated pro-rata)
    pearl_voice_cost = round((duration_seconds / 60.0) * RATE_PEARL_CALL_PER_MIN, 2)

    # Vobiz Telephony Pulse (0.2 Rs per 30 seconds pulse)
    pulses = math.ceil(duration_seconds / 30.0)
    telephony_cost = round(pulses * RATE_TELEPHONY_PULSE_30S, 2)

    total_credits = round(pearl_voice_cost + telephony_cost, 2)

    return {
        "duration_seconds": duration_seconds,
        "pearl_voice_cost": pearl_voice_cost,
        "pulses": pulses,
        "telephony_cost": telephony_cost,
        "total_credits": total_credits
    }
