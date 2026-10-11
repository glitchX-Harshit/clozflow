"""
Clozflow Admin Intelligence — User Analytics & Behavioral Engine
Computes:
- Total Registered Users
- New User Registrations (with previous-period comparisons)
- DAU, WAU, MAU from genuine qualifying product activity
- User Growth Timeseries
- Cohort Retention & Returning Customers
- Account Status Distribution
Zero placeholder data: Derived strictly from persisted records.
"""
from datetime import datetime, timedelta
from typing import Dict, Any, List, Set, Optional
from collections import defaultdict
from sqlalchemy.orm import Session
from sqlalchemy import func, distinct, and_, or_

from models import User, CallLog, CopilotSession
from models_pearl import PearlAgent, PearlCall
from admin.models import ActivityEvent, Payment, Subscription


def get_user_analytics_summary(
    db: Session,
    start_date: datetime,
    end_date: datetime
) -> Dict[str, Any]:
    """
    Computes user registration metrics, active users, and status breakdown.
    """
    duration = end_date - start_date
    prev_start_date = start_date - duration
    prev_end_date = start_date

    # 1. Total Registered Users
    total_users = db.query(func.count(User.id)).scalar() or 0

    # 2. New Registrations in Period & Previous Period
    new_users_current = db.query(func.count(User.id)).filter(
        User.created_at >= start_date,
        User.created_at <= end_date
    ).scalar() or 0

    new_users_prev = db.query(func.count(User.id)).filter(
        User.created_at >= prev_start_date,
        User.created_at < prev_end_date
    ).scalar() or 0

    pct_change = 0.0
    if new_users_prev == 0:
        pct_change = 100.0 if new_users_current > 0 else 0.0
    else:
        pct_change = round(((new_users_current - new_users_prev) / new_users_prev) * 100.0, 1)

    # 3. Account Status Breakdown
    status_counts = db.query(
        User.account_status, func.count(User.id)
    ).group_by(User.account_status).all()
    status_map = {s or "active": count for s, count in status_counts}

    # 4. Activity Collection (for DAU, WAU, MAU)
    active_user_dates = get_active_user_activity_map(db)

    # Calculate DAU for today (or end_date)
    target_day = end_date.date()
    dau = len(active_user_dates.get(target_day, set()))

    # Calculate WAU (unique users active in trailing 7 days from end_date)
    wau_users: Set[int] = set()
    for d_offset in range(7):
        day = (end_date - timedelta(days=d_offset)).date()
        wau_users.update(active_user_dates.get(day, set()))
    wau = len(wau_users)

    # Calculate MAU (unique users active in trailing 30 days from end_date)
    mau_users: Set[int] = set()
    for d_offset in range(30):
        day = (end_date - timedelta(days=d_offset)).date()
        mau_users.update(active_user_dates.get(day, set()))
    mau = len(mau_users)

    # 5. Timeseries of Daily Active Users and New Users over selected period
    timeline = get_user_activity_timeline(db, start_date, end_date, active_user_dates)

    return {
        "reporting_period": {
            "start": start_date.isoformat(),
            "end": end_date.isoformat(),
            "days": duration.days
        },
        "total_users": total_users,
        "new_users": {
            "value": new_users_current,
            "previous_period_value": new_users_prev,
            "percentage_change": pct_change
        },
        "engagement": {
            "dau": dau,
            "wau": wau,
            "mau": mau,
            "dau_to_mau_ratio": round((dau / mau) * 100.0, 1) if mau > 0 else 0.0
        },
        "account_statuses": {
            "active": status_map.get("active", 0),
            "suspended": status_map.get("suspended", 0),
            "deactivated": status_map.get("deactivated", 0)
        },
        "timeline": timeline
    }


def get_active_user_activity_map(db: Session) -> Dict[datetime.date, Set[int]]:
    """
    Builds a mapping of date -> set of active user IDs across all genuine behavioral sources:
    1. ActivityEvent table
    2. CopilotSession creation
    3. CallLog recordings
    4. Pearl calls (linked via PearlAgent.user_id)
    """
    date_map: Dict[datetime.date, Set[int]] = defaultdict(set)

    # 1. ActivityEvent
    events = db.query(ActivityEvent.user_id, ActivityEvent.created_at).all()
    for uid, ts in events:
        if ts and uid:
            date_map[ts.date()].add(uid)

    # 2. CopilotSession
    copilots = db.query(CopilotSession.user_id, CopilotSession.created_at).all()
    for uid, ts in copilots:
        if ts and uid:
            date_map[ts.date()].add(uid)

    # 3. CallLog
    call_logs = db.query(CallLog.user_id, CallLog.timestamp).all()
    for uid, ts in call_logs:
        if ts and uid:
            date_map[ts.date()].add(uid)

    # 4. Pearl calls linked through agent
    pearl_calls = db.query(PearlAgent.user_id, PearlCall.created_at).join(
        PearlCall, PearlCall.agent_id == PearlAgent.id
    ).all()
    for uid, ts in pearl_calls:
        if ts and uid:
            date_map[ts.date()].add(uid)

    return date_map


def get_user_activity_timeline(
    db: Session,
    start_date: datetime,
    end_date: datetime,
    active_user_dates: Dict[datetime.date, Set[int]]
) -> List[Dict[str, Any]]:
    """
    Generates daily day-by-day active user count and new registrations.
    """
    # Query registrations in period
    new_users = db.query(User.created_at).filter(
        User.created_at >= start_date,
        User.created_at <= end_date
    ).all()

    reg_counts = defaultdict(int)
    for (ts,) in new_users:
        if ts:
            reg_counts[ts.date().isoformat()] += 1

    timeline = []
    curr = start_date.date()
    end_day = end_date.date()

    while curr <= end_day:
        d_str = curr.isoformat()
        active_cnt = len(active_user_dates.get(curr, set()))
        new_cnt = reg_counts.get(d_str, 0)

        timeline.append({
            "date": d_str,
            "active_users": active_cnt,
            "new_registrations": new_cnt
        })
        curr += timedelta(days=1)

    return timeline


def get_retention_cohorts(db: Session, num_cohorts: int = 6) -> Dict[str, Any]:
    """
    Computes cohort retention based on actual registration timestamps and activity events.
    Cohorts are organized by month of signup.
    """
    users = db.query(User.id, User.created_at).all()
    if not users:
        return {"cohorts": [], "message": "No registered users in system"}

    activity_map = get_active_user_activity_map(db)

    # Group users by signup year-month
    cohorts_map = defaultdict(list)
    for uid, created_at in users:
        if not created_at:
            continue
        cohort_key = created_at.strftime("%Y-%m")
        cohorts_map[cohort_key].append(uid)

    sorted_cohort_keys = sorted(cohorts_map.keys(), reverse=True)[:num_cohorts]
    sorted_cohort_keys.reverse()

    cohort_results = []
    for c_key in sorted_cohort_keys:
        cohort_user_ids = cohorts_map[c_key]
        cohort_size = len(cohort_user_ids)
        c_year, c_month = map(int, c_key.split("-"))

        # Measure activity for Month 0, Month 1, Month 2, Month 3...
        retention_periods = []
        for period_idx in range(4):
            # Month start/end
            m = c_month + period_idx
            y = c_year + (m - 1) // 12
            m = ((m - 1) % 12) + 1
            
            # Count users active during this month
            active_in_month = set()
            for date_obj, uids in activity_map.items():
                if date_obj.year == y and date_obj.month == m:
                    active_in_month.update(uids.intersection(set(cohort_user_ids)))

            retained_count = len(active_in_month)
            rate = round((retained_count / cohort_size) * 100.0, 1) if cohort_size > 0 else 0.0
            retention_periods.append({
                "period": f"M{period_idx}",
                "retained_users": retained_count,
                "retention_rate": rate
            })

        cohort_results.append({
            "cohort": c_key,
            "size": cohort_size,
            "periods": retention_periods
        })

    return {
        "cohorts": cohort_results
    }
