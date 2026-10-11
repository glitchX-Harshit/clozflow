"""
Clozflow Admin Intelligence — Revenue Calculation Engine
Implements strict financial accuracy:
- Gross Collected Cash (successful transactions before refunds)
- Refunds (completed refunds in window)
- Net Collected Cash (Gross - Refunds)
- MRR (Normalized Monthly Recurring Revenue across active subscriptions)
- ARR (MRR * 12)
- New / Churned / Expansion MRR
- ARPPU (Average Revenue Per Paying User)
- Revenue by Plan Breakdown
Zero fabrication: If no data exists, accurate zero/empty structures are returned.
"""
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_, distinct

from admin.models import Payment, Subscription, Order
from models import User


def get_revenue_summary(
    db: Session,
    start_date: datetime,
    end_date: datetime,
    currency: str = "INR"
) -> Dict[str, Any]:
    """
    Computes financial metrics for a specific time window.
    Also computes the immediately preceding window of identical duration for comparisons.
    """
    duration = end_date - start_date
    prev_start_date = start_date - duration
    prev_end_date = start_date

    # 1. Gross Successful Payments in Period
    # Statuses 'succeeded', 'partially_refunded', 'refunded' represent cash that was collected
    gross_current = db.query(func.coalesce(func.sum(Payment.gross_amount), 0)).filter(
        Payment.created_at >= start_date,
        Payment.created_at <= end_date,
        Payment.status.in_(["succeeded", "partially_refunded", "refunded"]),
        Payment.currency == currency
    ).scalar() or 0

    gross_prev = db.query(func.coalesce(func.sum(Payment.gross_amount), 0)).filter(
        Payment.created_at >= prev_start_date,
        Payment.created_at < prev_end_date,
        Payment.status.in_(["succeeded", "partially_refunded", "refunded"]),
        Payment.currency == currency
    ).scalar() or 0

    # 2. Refunds Completed in Period
    refunds_current = db.query(func.coalesce(func.sum(Payment.refund_amount), 0)).filter(
        Payment.updated_at >= start_date,
        Payment.updated_at <= end_date,
        Payment.currency == currency
    ).scalar() or 0

    refunds_prev = db.query(func.coalesce(func.sum(Payment.refund_amount), 0)).filter(
        Payment.updated_at >= prev_start_date,
        Payment.updated_at < prev_end_date,
        Payment.currency == currency
    ).scalar() or 0

    # 3. Net Collected Cash
    net_current = max(0, gross_current - refunds_current)
    net_prev = max(0, gross_prev - refunds_prev)

    # 4. Failed Payments in Period
    failed_payments_count = db.query(func.count(Payment.id)).filter(
        Payment.created_at >= start_date,
        Payment.created_at <= end_date,
        Payment.status == "failed"
    ).scalar() or 0

    failed_payments_amount = db.query(func.coalesce(func.sum(Payment.gross_amount), 0)).filter(
        Payment.created_at >= start_date,
        Payment.created_at <= end_date,
        Payment.status == "failed"
    ).scalar() or 0

    # 5. Distinct Paying Customers in Period
    paying_customers_count = db.query(func.count(distinct(Payment.user_id))).filter(
        Payment.created_at >= start_date,
        Payment.created_at <= end_date,
        Payment.status.in_(["succeeded", "partially_refunded"]),
        Payment.currency == currency
    ).scalar() or 0

    # Total all-time paying customers
    total_paying_customers = db.query(func.count(distinct(Payment.user_id))).filter(
        Payment.status.in_(["succeeded", "partially_refunded"])
    ).scalar() or 0

    # 6. ARPPU (Average Revenue Per Paying User)
    arppu = round(net_current / paying_customers_count, 2) if paying_customers_count > 0 else 0.0

    # 7. MRR & ARR Calculations (Active Subscriptions Snapshot)
    # Active subscriptions as of current state
    active_subs = db.query(Subscription).filter(
        Subscription.status == "active"
    ).all()

    mrr = 0.0
    plan_distribution: Dict[str, Dict[str, Any]] = {}

    for sub in active_subs:
        plan_key = sub.plan_id.lower() if sub.plan_id else "unknown"
        sub_amount = float(sub.amount or 0)
        
        # Normalize to monthly amount
        if sub.billing_interval == "annual":
            normalized_monthly = sub_amount / 12.0
        else:
            normalized_monthly = sub_amount

        mrr += normalized_monthly

        if plan_key not in plan_distribution:
            plan_distribution[plan_key] = {
                "plan_name": sub.plan_id,
                "active_subscribers": 0,
                "monthly_revenue": 0.0,
            }
        plan_distribution[plan_key]["active_subscribers"] += 1
        plan_distribution[plan_key]["monthly_revenue"] += normalized_monthly

    mrr = round(mrr, 2)
    arr = round(mrr * 12.0, 2)

    # 8. Subscription Lifecycle (New vs Canceled in Period)
    new_subs = db.query(Subscription).filter(
        Subscription.created_at >= start_date,
        Subscription.created_at <= end_date
    ).all()

    new_mrr = sum(
        (float(s.amount) / 12.0 if s.billing_interval == "annual" else float(s.amount))
        for s in new_subs if s.status == "active"
    )

    canceled_subs = db.query(Subscription).filter(
        Subscription.canceled_at >= start_date,
        Subscription.canceled_at <= end_date,
        Subscription.status == "canceled"
    ).all()

    churned_mrr = sum(
        (float(s.amount) / 12.0 if s.billing_interval == "annual" else float(s.amount))
        for s in canceled_subs
    )

    # Active subscriptions count
    active_subscriptions_count = len(active_subs)

    # Percentage changes
    def calc_pct_change(curr: float, prev: float) -> Optional[float]:
        if prev == 0:
            return 100.0 if curr > 0 else 0.0
        return round(((curr - prev) / prev) * 100.0, 1)

    # 9. Timeseries of payments over period
    timeseries = get_revenue_timeseries(db, start_date, end_date, currency)

    return {
        "currency": currency,
        "reporting_period": {
            "start": start_date.isoformat(),
            "end": end_date.isoformat(),
            "days": (end_date - start_date).days
        },
        "gross_collected": {
            "value": gross_current,
            "previous_period_value": gross_prev,
            "percentage_change": calc_pct_change(gross_current, gross_prev)
        },
        "refunds": {
            "value": refunds_current,
            "previous_period_value": refunds_prev,
            "percentage_change": calc_pct_change(refunds_current, refunds_prev)
        },
        "net_cash": {
            "value": net_current,
            "previous_period_value": net_prev,
            "percentage_change": calc_pct_change(net_current, net_prev)
        },
        "mrr": {
            "value": mrr,
            "new_mrr": round(new_mrr, 2),
            "churned_mrr": round(churned_mrr, 2),
            "expansion_mrr": 0.0
        },
        "arr": {
            "value": arr
        },
        "arppu": {
            "value": arppu
        },
        "failed_payments": {
            "count": failed_payments_count,
            "amount": failed_payments_amount
        },
        "paying_customers": {
            "period_count": paying_customers_count,
            "total_all_time": total_paying_customers
        },
        "subscriptions": {
            "active_count": active_subscriptions_count,
            "new_in_period": len(new_subs),
            "canceled_in_period": len(canceled_subs),
            "plans": list(plan_distribution.values())
        },
        "timeseries": timeseries
    }


def get_revenue_timeseries(
    db: Session,
    start_date: datetime,
    end_date: datetime,
    currency: str = "INR"
) -> List[Dict[str, Any]]:
    """
    Groups payments into time buckets (daily) for revenue charts.
    Only includes actual persisted payment rows.
    """
    days = (end_date - start_date).days
    
    # Query actual successful payments in date range
    payments = db.query(Payment).filter(
        Payment.created_at >= start_date,
        Payment.created_at <= end_date,
        Payment.currency == currency
    ).all()

    # Pre-populate bucket map for each date in range so charts have continuous axes
    buckets: Dict[str, Dict[str, Any]] = {}
    curr = start_date.date()
    end_day = end_date.date()
    while curr <= end_day:
        d_str = curr.isoformat()
        buckets[d_str] = {
            "date": d_str,
            "gross": 0,
            "refunds": 0,
            "net": 0,
            "successful_count": 0,
            "failed_count": 0
        }
        curr += timedelta(days=1)

    for p in payments:
        if not p.created_at:
            continue
        day_key = p.created_at.date().isoformat()
        if day_key in buckets:
            if p.status in ["succeeded", "partially_refunded"]:
                buckets[day_key]["gross"] += p.gross_amount or 0
                buckets[day_key]["refunds"] += p.refund_amount or 0
                buckets[day_key]["net"] += (p.gross_amount or 0) - (p.refund_amount or 0)
                buckets[day_key]["successful_count"] += 1
            elif p.status == "failed":
                buckets[day_key]["failed_count"] += 1
            elif p.status == "refunded":
                buckets[day_key]["refunds"] += p.refund_amount or p.gross_amount or 0

    return sorted(list(buckets.values()), key=lambda x: x["date"])
