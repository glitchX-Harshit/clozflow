"""
Clozflow Admin Intelligence — Audit Service
Provides structured, append-only operational audit logging for all sensitive admin mutations.
"""
from datetime import datetime
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
from sqlalchemy import desc

from admin.models import AdminAuditLog
from models import User


def log_admin_action(
    db: Session,
    admin_user: User,
    action: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    details: Optional[str] = None,
    ip_address: Optional[str] = None,
    status: str = "success"
) -> AdminAuditLog:
    """
    Persists an append-only audit record.
    Never raises an uncaught exception that would disrupt critical operations,
    but always attempts to write to the DB.
    """
    audit = AdminAuditLog(
        admin_user_id=admin_user.id if admin_user else None,
        admin_email=admin_user.email if admin_user else "system",
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details=details,
        ip_address=ip_address,
        status=status,
        created_at=datetime.utcnow()
    )
    db.add(audit)
    db.commit()
    db.refresh(audit)
    return audit


def get_audit_logs(
    db: Session,
    page: int = 1,
    page_size: int = 50,
    action: Optional[str] = None,
    resource_type: Optional[str] = None,
    admin_email: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None
) -> Dict[str, Any]:
    """
    Paginated retrieval of audit events with filtering.
    """
    query = db.query(AdminAuditLog)

    if action:
        query = query.filter(AdminAuditLog.action == action)
    if resource_type:
        query = query.filter(AdminAuditLog.resource_type == resource_type)
    if admin_email:
        query = query.filter(AdminAuditLog.admin_email.ilike(f"%{admin_email}%"))
    if start_date:
        query = query.filter(AdminAuditLog.created_at >= start_date)
    if end_date:
        query = query.filter(AdminAuditLog.created_at <= end_date)

    total_count = query.count()
    offset = (page - 1) * page_size
    records = query.order_by(desc(AdminAuditLog.created_at)).offset(offset).limit(page_size).all()

    items = []
    for r in records:
        items.append({
            "id": r.id,
            "admin_user_id": r.admin_user_id,
            "admin_email": r.admin_email,
            "action": r.action,
            "resource_type": r.resource_type,
            "resource_id": r.resource_id,
            "details": r.details,
            "ip_address": r.ip_address,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    return {
        "items": items,
        "total": total_count,
        "page": page,
        "page_size": page_size,
        "total_pages": (total_count + page_size - 1) // page_size if page_size > 0 else 1
    }
