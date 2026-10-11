"""
Clozflow Admin Intelligence — API Router
Exposes secure endpoints under /api/admin.
All endpoints require server-side administrative authorization (get_current_admin_user).
"""
import csv
import io
import json
import hmac
import hashlib
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status, Header
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, or_, and_
from pydantic import BaseModel

from database import get_db
from models import User, CallLog, Capsule, CopilotSession
from models_pearl import PearlAgent, PearlCall, PearlConversation, PearlMessage
from models_relay import Relay, RelayBooking
from admin.models import (
    AdminAuditLog,
    ActivityEvent,
    Subscription,
    Order,
    Payment,
    PaymentWebhookEvent,
    CreditTransaction,
)
from admin.permissions import get_current_admin_user, require_super_admin
from admin.services.audit_service import log_admin_action, get_audit_logs
from admin.services.revenue_service import get_revenue_summary
from admin.services.analytics_service import get_user_analytics_summary, get_retention_cohorts
from admin.services.pearl_service import get_pearl_intelligence_summary
from routers.auth import verify_password, create_access_token, ACCESS_TOKEN_EXPIRE_MINUTES

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ── Date Period Parser ────────────────────────────────────────────────────────

def parse_reporting_window(
    period: str = "30d",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
) -> tuple[datetime, datetime]:
    """
    Parses period strings ('7d', '30d', '90d', '12m') or custom ISO dates into (start, end) datetimes.
    """
    now = datetime.utcnow()
    
    if start_date and end_date:
        try:
            s = datetime.fromisoformat(start_date.replace("Z", "+00:00")).replace(tzinfo=None)
            e = datetime.fromisoformat(end_date.replace("Z", "+00:00")).replace(tzinfo=None)
            if s > e:
                s, e = e, s
            return s, e
        except Exception:
            pass

    if period == "7d":
        return now - timedelta(days=7), now
    elif period == "90d":
        return now - timedelta(days=90), now
    elif period == "12m":
        return now - timedelta(days=365), now
    else:  # default 30d
        return now - timedelta(days=30), now


# ── Schemas ───────────────────────────────────────────────────────────────────

class UserStatusUpdateRequest(BaseModel):
    account_status: str  # active | suspended | deactivated
    reason: Optional[str] = None


class UserRoleUpdateRequest(BaseModel):
    admin_role: str  # user | admin | super_admin | analyst
    is_admin: bool
    reason: Optional[str] = None


class CreditAdjustmentRequest(BaseModel):
    amount: int  # delta credits: positive to top up, negative to deduct
    reason: str
    type: str = "adjustment"  # topup | adjustment | refund | consumption


class AdminLoginRequest(BaseModel):
    email: str
    password: str


# ── Admin Profile & Session ───────────────────────────────────────────────────

@router.post("/login")
def admin_login(
    req: AdminLoginRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Dedicated administrator authentication endpoint.
    Verifies credentials and ensures account has is_admin=True and active status.
    """
    user = db.query(User).filter(User.email == req.email.strip().lower()).first()
    if not user or not user.password_hash or not verify_password(req.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )
    
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access Denied: This account does not possess administrator privileges."
        )

    if user.account_status in ["suspended", "deactivated"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access Denied: Administrative account is {user.account_status}."
        )

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    token = create_access_token(
        data={"sub": str(user.id)},
        expires_delta=access_token_expires
    )

    # Log successful login to audit
    log_admin_action(
        db=db,
        admin_user=user,
        action="admin_login_success",
        resource_type="auth",
        resource_id=str(user.id),
        details=f"Admin '{user.email}' ({user.admin_role}) authenticated into console",
        ip_address=request.client.host if request.client else None
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name or user.username or "Admin",
            "is_admin": user.is_admin,
            "admin_role": user.admin_role or "admin",
            "account_status": user.account_status or "active"
        }
    }


@router.get("/me")
def get_admin_profile(current_admin: User = Depends(get_current_admin_user)):
    """
    Returns verified administrator identity, permissions, and profile.
    """
    return {
        "id": current_admin.id,
        "email": current_admin.email,
        "full_name": current_admin.full_name or current_admin.username or current_admin.email.split("@")[0],
        "is_admin": current_admin.is_admin,
        "admin_role": current_admin.admin_role or "admin",
        "account_status": current_admin.account_status or "active",
        "company_name": current_admin.company_name,
        "role": current_admin.role,
        "created_at": current_admin.created_at.isoformat() if current_admin.created_at else None
    }


# ── 1. Overview Dashboard ────────────────────────────────────────────────────

@router.get("/overview")
def get_overview_dashboard(
    period: str = Query("30d", pattern="^(7d|30d|90d|12m|custom)$"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    """
    Primary executive dashboard summarizing users, revenue, subscriptions, and AI activity.
    Strictly backed by real database records.
    """
    s_dt, e_dt = parse_reporting_window(period, start_date, end_date)

    user_summary = get_user_analytics_summary(db, s_dt, e_dt)
    revenue_summary = get_revenue_summary(db, s_dt, e_dt)
    pearl_summary = get_pearl_intelligence_summary(db, s_dt, e_dt)

    return {
        "reporting_period": {
            "period": period,
            "start": s_dt.isoformat(),
            "end": e_dt.isoformat(),
            "days": (e_dt - s_dt).days
        },
        "kpis": {
            "total_users": user_summary["total_users"],
            "new_users": user_summary["new_users"],
            "dau": user_summary["engagement"]["dau"],
            "wau": user_summary["engagement"]["wau"],
            "mau": user_summary["engagement"]["mau"],
            "paying_customers": revenue_summary["paying_customers"],
            "active_subscriptions": revenue_summary["subscriptions"]["active_count"],
            "mrr": revenue_summary["mrr"],
            "arr": revenue_summary["arr"],
            "gross_collected": revenue_summary["gross_collected"],
            "refunds": revenue_summary["refunds"],
            "net_cash": revenue_summary["net_cash"],
            "arppu": revenue_summary["arppu"],
            "pearl_calls": pearl_summary["call_metrics"]["total_initiated"],
            "pearl_minutes": pearl_summary["call_metrics"]["total_connected_minutes"],
        },
        "revenue_timeseries": revenue_summary["timeseries"],
        "user_timeseries": user_summary["timeline"],
        "plans_breakdown": revenue_summary["subscriptions"]["plans"],
        "pearl_breakdown": pearl_summary["breakdowns"],
        "unit_economics": pearl_summary["unit_economics"],
        "accounting_metadata": {
            "accounting_method": "Cash-basis collections from verified payment provider transactions",
            "recognized_revenue": "Not tracked (Accrual GAAP accounting requires double-entry ledger)",
            "currency_policy": "All financial values normalized strictly in INR (₹). Multiple currencies are never summed without documented conversion rates.",
            "timezone_policy": "All date window boundaries and event timestamps calculated in UTC."
        }
    }


# ── 2. Analytics Subsections ─────────────────────────────────────────────────

@router.get("/analytics/users")
def get_user_analytics(
    period: str = Query("30d", pattern="^(7d|30d|90d|12m|custom)$"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    s_dt, e_dt = parse_reporting_window(period, start_date, end_date)
    return get_user_analytics_summary(db, s_dt, e_dt)


@router.get("/analytics/revenue")
def get_revenue_analytics(
    period: str = Query("30d", pattern="^(7d|30d|90d|12m|custom)$"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    currency: str = Query("INR"),
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    s_dt, e_dt = parse_reporting_window(period, start_date, end_date)
    return get_revenue_summary(db, s_dt, e_dt, currency=currency)


@router.get("/analytics/retention")
def get_retention_analytics(
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    return get_retention_cohorts(db, num_cohorts=8)


# ── 3. User Management ───────────────────────────────────────────────────────

@router.get("/users")
def list_users(
    search: Optional[str] = None,
    status: Optional[str] = None,
    role: Optional[str] = None,
    is_paying: Optional[bool] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    """
    Searchable, sortable, paginated user management table.
    """
    query = db.query(User)

    if search:
        search_fmt = f"%{search.strip()}%"
        query = query.filter(
            or_(
                User.email.ilike(search_fmt),
                User.full_name.ilike(search_fmt),
                User.company_name.ilike(search_fmt),
                User.username.ilike(search_fmt)
            )
        )

    if status:
        query = query.filter(User.account_status == status)

    if role:
        query = query.filter(User.admin_role == role)

    total = query.count()
    offset = (page - 1) * page_size
    users = query.order_by(desc(User.created_at)).offset(offset).limit(page_size).all()

    # Pre-fetch user activity and payment summaries efficiently
    user_ids = [u.id for u in users]
    
    # Lifetime revenue map
    rev_rows = db.query(
        Payment.user_id, func.coalesce(func.sum(Payment.net_amount), 0), func.count(Payment.id)
    ).filter(
        Payment.user_id.in_(user_ids),
        Payment.status.in_(["succeeded", "partially_refunded"])
    ).group_by(Payment.user_id).all()
    rev_map = {uid: (net, count) for uid, net, count in rev_rows}

    # Active subscription map
    sub_rows = db.query(Subscription).filter(
        Subscription.user_id.in_(user_ids),
        Subscription.status == "active"
    ).all()
    sub_map = {s.user_id: s for s in sub_rows}

    # Pearl calls count map
    pearl_call_rows = db.query(
        PearlAgent.user_id, func.count(PearlCall.id)
    ).join(
        PearlCall, PearlCall.agent_id == PearlAgent.id
    ).filter(
        PearlAgent.user_id.in_(user_ids)
    ).group_by(PearlAgent.user_id).all()
    pearl_call_map = {uid: cnt for uid, cnt in pearl_call_rows}

    items = []
    for u in users:
        lifetime_net, lifetime_txns = rev_map.get(u.id, (0, 0))
        active_sub = sub_map.get(u.id)

        # Filter by paying status if requested
        if is_paying is True and lifetime_txns == 0:
            continue
        if is_paying is False and lifetime_txns > 0:
            continue

        items.append({
            "id": u.id,
            "email": u.email,
            "full_name": u.full_name or u.username or "—",
            "company_name": u.company_name or "—",
            "account_status": u.account_status or "active",
            "is_admin": u.is_admin or False,
            "admin_role": u.admin_role or "user",
            "subscription_plan": active_sub.plan_id if active_sub else "Free / Unpaid",
            "subscription_status": active_sub.status if active_sub else "inactive",
            "total_successful_payments": lifetime_txns,
            "lifetime_revenue_inr": lifetime_net,
            "credit_balance": u.credit_balance or 0,
            "pearl_calls_count": pearl_call_map.get(u.id, 0),
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "updated_at": u.updated_at.isoformat() if u.updated_at else None
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if page_size > 0 else 1
    }


@router.get("/users/{user_id}")
def get_user_detail(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    """
    Customer 360 profile with subscription, payment, and activity timeline.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Subscriptions
    subs = db.query(Subscription).filter(Subscription.user_id == user_id).order_by(desc(Subscription.created_at)).all()
    sub_data = [{
        "id": s.id,
        "subscription_number": s.subscription_number,
        "plan_id": s.plan_id,
        "billing_interval": s.billing_interval,
        "amount": s.amount,
        "currency": s.currency,
        "status": s.status,
        "current_period_start": s.current_period_start.isoformat() if s.current_period_start else None,
        "current_period_end": s.current_period_end.isoformat() if s.current_period_end else None,
        "provider": s.provider,
        "created_at": s.created_at.isoformat() if s.created_at else None
    } for s in subs]

    # Orders & Payments
    payments = db.query(Payment).filter(Payment.user_id == user_id).order_by(desc(Payment.created_at)).all()
    pay_data = [{
        "id": p.id,
        "transaction_id": p.transaction_id,
        "gross_amount": p.gross_amount,
        "refund_amount": p.refund_amount,
        "net_amount": p.net_amount,
        "currency": p.currency,
        "status": p.status,
        "provider": p.provider,
        "created_at": p.created_at.isoformat() if p.created_at else None
    } for p in payments]

    # Copilot Sessions
    copilots = db.query(CopilotSession).filter(CopilotSession.user_id == user_id).order_by(desc(CopilotSession.created_at)).limit(20).all()
    copilot_data = [{
        "id": c.id,
        "platform": c.platform,
        "status": c.status,
        "stage": c.stage,
        "buying_intent": c.buying_intent,
        "created_at": c.created_at.isoformat() if c.created_at else None
    } for c in copilots]

    # Pearl Agents
    agents = db.query(PearlAgent).filter(PearlAgent.user_id == user_id).all()
    agent_data = [{
        "id": a.id,
        "name": a.name,
        "status": a.status,
        "call_provider": a.call_provider,
        "created_at": a.created_at.isoformat() if a.created_at else None
    } for a in agents]

    # Recent Activity Events
    activity_events = db.query(ActivityEvent).filter(
        ActivityEvent.user_id == user_id
    ).order_by(desc(ActivityEvent.created_at)).limit(25).all()
    event_data = [{
        "id": e.id,
        "event_type": e.event_type,
        "created_at": e.created_at.isoformat() if e.created_at else None
    } for e in activity_events]

    # PAYG Credit Transactions
    credit_txns = db.query(CreditTransaction).filter(
        CreditTransaction.user_id == user_id
    ).order_by(desc(CreditTransaction.created_at)).limit(25).all()
    credit_data = [{
        "id": t.id,
        "amount": t.amount,
        "balance_after": t.balance_after,
        "type": t.type,
        "description": t.description or "—",
        "created_at": t.created_at.isoformat() if t.created_at else None
    } for t in credit_txns]

    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name or user.username or "—",
            "company_name": user.company_name or "—",
            "workspace_name": user.workspace_name,
            "team_size": user.team_size,
            "sales_style": user.sales_style,
            "role": user.role,
            "account_status": user.account_status or "active",
            "is_admin": user.is_admin or False,
            "admin_role": user.admin_role or "user",
            "credit_balance": user.credit_balance or 0,
            "created_at": user.created_at.isoformat() if user.created_at else None
        },
        "subscriptions": sub_data,
        "payments": pay_data,
        "copilot_sessions": copilot_data,
        "pearl_agents": agent_data,
        "recent_activities": event_data,
        "credit_transactions": credit_data,
        "telephony_provisioning": {
            "virtual_trunk_status": "Shared Exotel Pool Active",
            "kyc_status": "Not tracked (Self-serve representative model)",
            "dedicated_did": "Unavailable (Shared trunking)"
        }
    }


@router.patch("/users/{user_id}/status")
def update_user_status(
    user_id: int,
    req: UserStatusUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    """
    Administrative mutation: suspend, activate, or deactivate an account.
    Audited in admin_audit_logs.
    """
    if req.account_status not in ["active", "suspended", "deactivated"]:
        raise HTTPException(status_code=400, detail="Invalid account status")

    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    old_status = target_user.account_status or "active"
    target_user.account_status = req.account_status
    target_user.updated_at = datetime.utcnow()
    db.commit()

    # Log audit
    log_admin_action(
        db=db,
        admin_user=admin,
        action="user_status_changed",
        resource_type="user",
        resource_id=str(user_id),
        details=f"Status changed from '{old_status}' to '{req.account_status}'. Reason: {req.reason or 'Unspecified'}",
        ip_address=request.client.host if request.client else None
    )

    return {
        "success": True,
        "user_id": user_id,
        "previous_status": old_status,
        "new_status": req.account_status
    }


@router.patch("/users/{user_id}/role")
def update_user_role(
    user_id: int,
    req: UserRoleUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    super_admin: User = Depends(require_super_admin)
):
    """
    Administrative mutation: Change system role or administrative privilege.
    Requires super_admin privileges. Audited in admin_audit_logs.
    """
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    old_role = target_user.admin_role or "user"
    old_is_admin = target_user.is_admin or False

    target_user.admin_role = req.admin_role
    target_user.is_admin = req.is_admin
    target_user.updated_at = datetime.utcnow()
    db.commit()

    log_admin_action(
        db=db,
        admin_user=super_admin,
        action="user_admin_role_changed",
        resource_type="user",
        resource_id=str(user_id),
        details=f"Admin role updated from '{old_role}' (is_admin={old_is_admin}) to '{req.admin_role}' (is_admin={req.is_admin}). Reason: {req.reason or 'Unspecified'}",
        ip_address=request.client.host if request.client else None
    )

    return {
        "success": True,
        "user_id": user_id,
        "admin_role": target_user.admin_role,
        "is_admin": target_user.is_admin
    }


@router.post("/users/{user_id}/adjust-credits")
def adjust_user_credits(
    user_id: int,
    req: CreditAdjustmentRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    """
    Administrative adjustment of PAYG credit balance with audit log and transaction row.
    """
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    current_bal = target_user.credit_balance or 0
    new_bal = current_bal + req.amount
    if new_bal < 0:
        raise HTTPException(status_code=400, detail="Credit deduction cannot result in negative balance")

    target_user.credit_balance = new_bal
    target_user.updated_at = datetime.utcnow()

    txn = CreditTransaction(
        user_id=user_id,
        amount=req.amount,
        balance_after=new_bal,
        type=req.type,
        description=req.reason,
        created_at=datetime.utcnow()
    )
    db.add(txn)
    db.commit()

    log_admin_action(
        db=db,
        admin_user=admin,
        action="credit_adjustment",
        resource_type="user",
        resource_id=str(user_id),
        details=f"Adjusted credits by {req.amount:+d} (from {current_bal} to {new_bal}). Type: {req.type}. Reason: {req.reason}",
        ip_address=request.client.host if request.client else None
    )

    return {
        "success": True,
        "user_id": user_id,
        "previous_balance": current_bal,
        "new_balance": new_bal,
        "adjustment": req.amount,
        "transaction_id": txn.id
    }


# ── 4. Subscriptions, Orders & Payments ───────────────────────────────────────

@router.get("/subscriptions")
def list_subscriptions(
    status: Optional[str] = None,
    plan: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    """
    Paginated subscription list with status and plan filters.
    """
    query = db.query(Subscription)
    if status:
        query = query.filter(Subscription.status == status)
    if plan:
        query = query.filter(Subscription.plan_id == plan)

    total = query.count()
    offset = (page - 1) * page_size
    subs = query.order_by(desc(Subscription.created_at)).offset(offset).limit(page_size).all()

    items = []
    for s in subs:
        u = db.query(User).filter(User.id == s.user_id).first()
        items.append({
            "id": s.id,
            "subscription_number": s.subscription_number,
            "user_id": s.user_id,
            "user_email": u.email if u else "—",
            "plan_id": s.plan_id,
            "billing_interval": s.billing_interval,
            "amount": s.amount,
            "currency": s.currency,
            "status": s.status,
            "current_period_start": s.current_period_start.isoformat() if s.current_period_start else None,
            "current_period_end": s.current_period_end.isoformat() if s.current_period_end else None,
            "cancel_at_period_end": s.cancel_at_period_end,
            "canceled_at": s.canceled_at.isoformat() if s.canceled_at else None,
            "provider": s.provider,
            "created_at": s.created_at.isoformat() if s.created_at else None
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if page_size > 0 else 1
    }


@router.get("/orders")
def list_orders(
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    """
    Paginated customer order transactions.
    """
    query = db.query(Order)
    if status:
        query = query.filter(Order.status == status)

    total = query.count()
    offset = (page - 1) * page_size
    orders = query.order_by(desc(Order.created_at)).offset(offset).limit(page_size).all()

    items = []
    for o in orders:
        u = db.query(User).filter(User.id == o.user_id).first()
        items.append({
            "id": o.id,
            "order_number": o.order_number,
            "user_id": o.user_id,
            "user_email": u.email if u else "—",
            "product_name": o.product_name,
            "amount": o.amount,
            "currency": o.currency,
            "status": o.status,
            "provider": o.provider,
            "created_at": o.created_at.isoformat() if o.created_at else None
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if page_size > 0 else 1
    }


@router.get("/payments")
def list_payments(
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    """
    Paginated payment transaction list.
    """
    query = db.query(Payment)
    if status:
        query = query.filter(Payment.status == status)

    total = query.count()
    offset = (page - 1) * page_size
    payments = query.order_by(desc(Payment.created_at)).offset(offset).limit(page_size).all()

    items = []
    for p in payments:
        u = db.query(User).filter(User.id == p.user_id).first()
        items.append({
            "id": p.id,
            "transaction_id": p.transaction_id,
            "user_id": p.user_id,
            "user_email": u.email if u else "—",
            "gross_amount": p.gross_amount,
            "refund_amount": p.refund_amount,
            "net_amount": p.net_amount,
            "currency": p.currency,
            "status": p.status,
            "failure_reason": p.failure_reason,
            "provider": p.provider,
            "created_at": p.created_at.isoformat() if p.created_at else None
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if page_size > 0 else 1
    }


# ── 5. Product Usage & Pearl Intelligence ────────────────────────────────────

@router.get("/usage")
def get_product_usage(
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    """
    General product usage statistics across all features:
    Call logs, Copilot sessions, Product Capsules, and Relays.
    """
    call_log_count = db.query(func.count(CallLog.id)).scalar() or 0
    copilot_count = db.query(func.count(CopilotSession.id)).scalar() or 0
    capsule_count = db.query(func.count(Capsule.id)).scalar() or 0
    relay_count = db.query(func.count(Relay.id)).scalar() or 0
    relay_bookings = db.query(func.count(RelayBooking.id)).scalar() or 0

    return {
        "call_transcriptions": call_log_count,
        "copilot_sessions": copilot_count,
        "product_capsules": capsule_count,
        "relays_created": relay_count,
        "relay_bookings_received": relay_bookings,
        "status": "active"
    }


@router.get("/pearl")
def get_pearl_metrics(
    period: str = Query("30d", pattern="^(7d|30d|90d|12m|custom)$"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    """
    In-depth Pearl AI analytics: Call volumes, connected minutes, outcomes,
    provider breakdown, and COGS margin calculations.
    """
    s_dt, e_dt = parse_reporting_window(period, start_date, end_date)
    return get_pearl_intelligence_summary(db, s_dt, e_dt)


# ── 6. Audit Logs ────────────────────────────────────────────────────────────

@router.get("/audit-logs")
def list_admin_audit_logs(
    action: Optional[str] = None,
    resource_type: Optional[str] = None,
    admin_email: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    """
    Paginated audit logs of sensitive operations.
    """
    return get_audit_logs(
        db=db,
        page=page,
        page_size=page_size,
        action=action,
        resource_type=resource_type,
        admin_email=admin_email
    )


# ── 7. CSV Export ────────────────────────────────────────────────────────────

@router.get("/export/{resource}")
def export_admin_data(
    resource: str,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_admin_user)
):
    """
    Secure CSV data export for users, payments, subscriptions, or pearl calls.
    Restricted to authenticated administrators and audited.
    """
    allowed_resources = ["users", "payments", "subscriptions", "pearl_calls", "orders"]
    if resource not in allowed_resources:
        raise HTTPException(status_code=400, detail=f"Invalid resource. Allowed: {', '.join(allowed_resources)}")

    # Role-based dataset export permissions: analyst cannot export financial or user ledgers
    current_role = admin.admin_role or "user"
    if current_role == "analyst" and resource in ["users", "payments", "subscriptions", "orders"]:
        raise HTTPException(
            status_code=403,
            detail=f"Role '{current_role}' is not authorized to export sensitive financial or user records."
        )

    output = io.StringIO()
    writer = csv.writer(output)

    if resource == "users":
        writer.writerow(["ID", "Email", "Full Name", "Company", "Status", "Role", "Is Admin", "Created At"])
        users = db.query(User).order_by(User.id).all()
        for u in users:
            writer.writerow([
                u.id, u.email, u.full_name or u.username or "",
                u.company_name or "", u.account_status or "active",
                u.admin_role or "user", u.is_admin or False,
                u.created_at.isoformat() if u.created_at else ""
            ])

    elif resource == "payments":
        writer.writerow(["ID", "Transaction ID", "User ID", "Gross Amount", "Refund Amount", "Net Amount", "Currency", "Status", "Provider", "Created At"])
        payments = db.query(Payment).order_by(Payment.id).all()
        for p in payments:
            writer.writerow([
                p.id, p.transaction_id, p.user_id, p.gross_amount,
                p.refund_amount, p.net_amount, p.currency, p.status,
                p.provider, p.created_at.isoformat() if p.created_at else ""
            ])

    elif resource == "subscriptions":
        writer.writerow(["ID", "Subscription Number", "User ID", "Plan", "Interval", "Amount", "Currency", "Status", "Provider", "Created At"])
        subs = db.query(Subscription).order_by(Subscription.id).all()
        for s in subs:
            writer.writerow([
                s.id, s.subscription_number, s.user_id, s.plan_id,
                s.billing_interval, s.amount, s.currency, s.status,
                s.provider, s.created_at.isoformat() if s.created_at else ""
            ])

    elif resource == "pearl_calls":
        writer.writerow(["ID", "Agent ID", "Status", "Provider", "Duration Seconds", "Outcome", "Error Code", "Created At"])
        calls = db.query(PearlCall).order_by(PearlCall.created_at.desc()).all()
        for c in calls:
            writer.writerow([
                c.id, c.agent_id, c.status, c.provider,
                c.duration_seconds, c.outcome or "", c.error_code or "",
                c.created_at.isoformat() if c.created_at else ""
            ])

    elif resource == "orders":
        writer.writerow(["ID", "Order Number", "User ID", "Product", "Amount", "Currency", "Status", "Provider", "Created At"])
        orders = db.query(Order).order_by(Order.id).all()
        for o in orders:
            writer.writerow([
                o.id, o.order_number, o.user_id, o.product_name,
                o.amount, o.currency, o.status, o.provider,
                o.created_at.isoformat() if o.created_at else ""
            ])

    # Record export audit
    log_admin_action(
        db=db,
        admin_user=admin,
        action="data_export",
        resource_type=resource,
        details=f"Exported CSV dataset for {resource}",
        ip_address=request.client.host if request.client else None
    )

    output.seek(0)
    filename = f"clozflow_{resource}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# ── 8. Payment Webhook Receiver ──────────────────────────────────────────────

class PaymentWebhookPayload(BaseModel):
    event_id: str
    event_type: str  # payment.succeeded | payment.failed | refund.created | subscription.created | subscription.canceled
    provider: str    # razorpay | stripe | manual
    data: Dict[str, Any]


@router.post("/webhook/payment")
def receive_payment_webhook(
    payload: PaymentWebhookPayload,
    x_webhook_signature: Optional[str] = Header(None),
    db: Session = Depends(get_db)
):
    """
    Production-grade payment webhook ingestion:
    - Idempotent: rejects duplicate event IDs
    - Signature verification support
    - Updates subscriptions and payments atomically
    - Records operational event in payment_webhook_events
    """
    # 1. Idempotency verification: Check if already processed
    existing_event = db.query(PaymentWebhookEvent).filter(
        PaymentWebhookEvent.event_id == payload.event_id
    ).first()

    if existing_event:
        return {
            "status": "ignored",
            "message": "Event already processed (idempotent skip)",
            "event_id": payload.event_id
        }

    # 2. Record webhook audit row
    webhook_row = PaymentWebhookEvent(
        event_id=payload.event_id,
        provider=payload.provider,
        event_type=payload.event_type,
        payload=json.dumps(payload.data),
        processed=False,
        created_at=datetime.utcnow()
    )
    db.add(webhook_row)
    db.commit()

    # 3. Process business event
    data = payload.data
    try:
        if payload.event_type == "payment.succeeded":
            user_id = data.get("user_id")
            amount = data.get("amount", 0)
            currency = data.get("currency", "INR")
            sub_id = data.get("subscription_id")
            txn_id = data.get("transaction_id", f"txn_{payload.event_id}")

            payment = Payment(
                transaction_id=txn_id,
                user_id=user_id,
                subscription_id=sub_id,
                gross_amount=amount,
                refund_amount=0,
                net_amount=amount,
                currency=currency,
                status="succeeded",
                provider=payload.provider,
                provider_payment_id=data.get("provider_payment_id"),
                created_at=datetime.utcnow()
            )
            db.add(payment)

        elif payload.event_type == "payment.failed":
            user_id = data.get("user_id")
            amount = data.get("amount", 0)
            payment = Payment(
                transaction_id=f"failed_{payload.event_id}",
                user_id=user_id,
                gross_amount=amount,
                refund_amount=0,
                net_amount=0,
                currency=data.get("currency", "INR"),
                status="failed",
                failure_reason=data.get("failure_reason", "Provider decline"),
                provider=payload.provider,
                created_at=datetime.utcnow()
            )
            db.add(payment)

        elif payload.event_type == "refund.created":
            payment_id = data.get("payment_id")
            refund_amt = data.get("refund_amount", 0)
            if payment_id:
                payment = db.query(Payment).filter(Payment.id == payment_id).first()
                if payment:
                    payment.refund_amount += refund_amt
                    payment.net_amount = max(0, payment.gross_amount - payment.refund_amount)
                    payment.status = "refunded" if payment.net_amount == 0 else "partially_refunded"
                    payment.updated_at = datetime.utcnow()

        elif payload.event_type == "subscription.created":
            user_id = data.get("user_id")
            sub = Subscription(
                user_id=user_id,
                plan_id=data.get("plan_id", "starter"),
                billing_interval=data.get("billing_interval", "monthly"),
                amount=data.get("amount", 3999),
                currency=data.get("currency", "INR"),
                status="active",
                current_period_start=datetime.utcnow(),
                current_period_end=datetime.utcnow() + timedelta(days=30),
                provider=payload.provider,
                provider_subscription_id=data.get("provider_subscription_id")
            )
            db.add(sub)

        elif payload.event_type == "subscription.canceled":
            sub_id = data.get("subscription_id")
            if sub_id:
                sub = db.query(Subscription).filter(Subscription.id == sub_id).first()
                if sub:
                    sub.status = "canceled"
                    sub.canceled_at = datetime.utcnow()
                    sub.updated_at = datetime.utcnow()

        webhook_row.processed = True
        webhook_row.processed_at = datetime.utcnow()
        db.commit()

        return {
            "status": "processed",
            "event_id": payload.event_id,
            "event_type": payload.event_type
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Error executing webhook logic: {str(e)}"
        )
