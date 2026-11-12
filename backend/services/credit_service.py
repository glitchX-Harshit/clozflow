"""
ClozFlow Credit & Telephony Metering Service
Enforces the 1 INR = 1 Credit billing architecture:
- Pearl Agent Test Simulation: 2.0 Credits (₹2.00) flat per session
- Pearl Live Lead Call: 3.0 Credits (₹3.00) per minute, all-inclusive (Voice AI + Vobiz PSTN)
- Vobiz Telephony share of that: 0.25 Credits (₹0.25) per 30s pulse
- Phone Number Rental: 179.0 Credits (₹179.00) per month (rental is not available yet)

Balances are changed with a single guarded UPDATE (``balance = balance - x
WHERE balance >= x``), so concurrent deductions can't both spend the same
credits or push a balance below zero, on SQLite as well as Postgres.
"""
import math
from typing import Optional, Dict, Any
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from fastapi import HTTPException

from models import User
from admin.models import CreditTransaction, Payment

# ── Canonical Pricing Rates ───────────────────────────────────────────────────
RATE_PER_TEST_SIMULATION   = 2.0     # ₹2.00 flat per simulation
RATE_PEARL_CALL_PER_MIN    = 3.0     # ₹3.00 per 60 seconds (All-inclusive: Voice AI + Vobiz PSTN)
RATE_TELEPHONY_PULSE_30S   = 0.25    # ₹0.25 per 30-second pulse (Upstream Vobiz COGS)
RATE_PHONE_RENTAL_MONTHLY  = 179.0   # ₹179.00 / month (Customer price | Upstream Vobiz DID cost: $1.00 = ₹84.00)

# Tolerance for float noise when comparing a balance with a charge.
_EPSILON = 1e-9


def _is_super(user: User) -> bool:
    return bool(getattr(user, "is_admin", False) or getattr(user, "admin_role", "user") in ["admin", "super_admin"])


def is_user_superuser(db: Session, user_id: int) -> bool:
    """Check if the user has superuser / admin privileges."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return False
    return _is_super(user)


def _read_balance(db: Session, user_id: int) -> Optional[float]:
    """Current balance straight from the database (not a possibly stale ORM object)."""
    value = db.execute(select(User.credit_balance).where(User.id == user_id)).scalar_one_or_none()
    return None if value is None else float(value)


def _store_rounded_balance(db: Session, user_id: int) -> float:
    """Round the balance just written to 2 decimals (clamping float dust at 0).
    Runs inside the caller's transaction, which already holds the row's write lock."""
    raw = _read_balance(db, user_id) or 0.0
    rounded = max(0.0, round(raw, 2))
    if rounded != raw:
        db.execute(
            update(User).where(User.id == user_id).values(credit_balance=rounded)
            .execution_options(synchronize_session=False)
        )
    return rounded


def get_balance(db: Session, user_id: int) -> float:
    """Return user's live credit balance rounded to 2 decimal places."""
    return round(_read_balance(db, user_id) or 0.0, 2)


def has_sufficient_balance(db: Session, user_id: int, required_credits: float) -> bool:
    """
    Check if user has at least required_credits.
    Superusers have unlimited credits and always pass.
    """
    if is_user_superuser(db, user_id):
        return True
    return get_balance(db, user_id) >= round(float(required_credits), 2) - _EPSILON


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
    Normal users get HTTP 402 if balance is insufficient (nothing is written then,
    so the caller's own pending changes are left alone).
    """
    amount = round(float(amount), 2)
    if amount <= 0:
        return get_balance(db, user_id)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User account not found")

    is_super = _is_super(user)
    if is_super:
        # For superuser, keep balance intact and record a simulated deduction
        new_balance = get_balance(db, user_id)
    else:
        result = db.execute(
            update(User)
            .where(User.id == user_id, User.credit_balance >= amount - _EPSILON)
            .values(credit_balance=User.credit_balance - amount)
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            current_balance = get_balance(db, user_id)
            raise HTTPException(
                status_code=402,
                detail=(
                    f"Insufficient credits. Required: {amount} Credits (₹{amount:.2f}), "
                    f"Available Balance: {current_balance:.2f} Credits (₹{current_balance:.2f}). "
                    f"Please upgrade or contact administrator for top-up."
                )
            )
        new_balance = _store_rounded_balance(db, user_id)

    txn = CreditTransaction(
        user_id=user_id,
        amount=-amount,
        balance_after=new_balance,
        type=category,
        description=f"[Superuser Test] {description}" if is_super else description
    )
    db.add(txn)
    db.commit()

    return new_balance


def charge_post_call(
    db: Session,
    user_id: int,
    amount: float,
    reason: str,
    category: str = "consumption",
) -> Dict[str, float]:
    """
    Charge for usage that already happened (a finished call).

    Unlike ``deduct_credits`` (the pre-use check, which raises 402), this never
    raises for insufficient funds: it takes ``min(balance, amount)`` atomically,
    never leaves the balance below zero, and records the uncollected rest on the
    transaction row (``description`` ends with "Shortfall ₹x.xx not collected").
    A row is written even when nothing could be taken, so unpaid usage stays
    visible. Superusers get a "[Superuser Test]" row and keep their balance.
    Commits. Returns ``{"charged", "shortfall", "balance_after"}``.
    """
    amount = round(float(amount), 2)
    if amount <= 0:
        return {"charged": 0.0, "shortfall": 0.0, "balance_after": get_balance(db, user_id)}

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        print(f"[credits] Post-call charge skipped: user {user_id} not found")
        return {"charged": 0.0, "shortfall": amount, "balance_after": 0.0}

    if _is_super(user):
        balance = get_balance(db, user_id)
        db.add(CreditTransaction(user_id=user_id, amount=-amount, balance_after=balance, type=category,
                                 description=f"[Superuser Test] {reason}"))
        db.commit()
        return {"charged": 0.0, "shortfall": 0.0, "balance_after": balance}

    # Take the row's write lock first (a no-op UPDATE locks the row on Postgres and
    # the database on SQLite), so the balance read below can't change before we write.
    db.execute(
        update(User).where(User.id == user_id).values(credit_balance=User.credit_balance)
        .execution_options(synchronize_session=False)
    )
    balance = max(0.0, round(_read_balance(db, user_id) or 0.0, 2))
    charged = round(min(balance, amount), 2)
    shortfall = round(amount - charged, 2)
    new_balance = max(0.0, round(balance - charged, 2))
    db.execute(
        update(User).where(User.id == user_id).values(credit_balance=new_balance)
        .execution_options(synchronize_session=False)
    )

    description = reason
    if shortfall > 0:
        description = f"{reason} | Shortfall ₹{shortfall:.2f} not collected (insufficient balance)"
    db.add(CreditTransaction(user_id=user_id, amount=-charged if charged else 0.0, balance_after=new_balance,
                             type=category, description=description))
    db.commit()
    return {"charged": charged, "shortfall": shortfall, "balance_after": new_balance}


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

    result = db.execute(
        update(User)
        .where(User.id == user_id)
        .values(credit_balance=(User.credit_balance + amount))
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        raise HTTPException(status_code=404, detail="User account not found")
    # A NULL balance (legacy rows) stays NULL after "NULL + x"; treat it as 0.
    if _read_balance(db, user_id) is None:
        db.execute(
            update(User).where(User.id == user_id).values(credit_balance=amount)
            .execution_options(synchronize_session=False)
        )
    new_balance = _store_rounded_balance(db, user_id)

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

    return new_balance


def calculate_call_metering(duration_seconds: int) -> Dict[str, Any]:
    """
    Calculate dual-metered cost for an outbound Pearl call:
    1. All-inclusive ₹3.00 / min pro-rata (minimum 30 seconds)
    2. Of which Vobiz Telephony: ₹0.25 per 30-second pulse
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

    # All-inclusive Pearl Live Call (₹3.00 / min pro-rata, bundled with Vobiz telephony)
    pulses = math.ceil(duration_seconds / 30.0)
    total_credits = max(round(0.5 * RATE_PEARL_CALL_PER_MIN, 2), round((duration_seconds / 60.0) * RATE_PEARL_CALL_PER_MIN, 2))
    telephony_cost = round(pulses * RATE_TELEPHONY_PULSE_30S, 2)
    pearl_voice_cost = round(total_credits - telephony_cost, 2)

    return {
        "duration_seconds": duration_seconds,
        "pearl_voice_cost": pearl_voice_cost,
        "pulses": pulses,
        "telephony_cost": telephony_cost,
        "total_credits": total_credits
    }
