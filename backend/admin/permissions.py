"""
Clozflow Admin Intelligence — Security & Authorization
Enforces strict server-side authorization for all /admin endpoints.
Default Deny: All requests require verified admin authentication.
"""
from fastapi import Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import Dict, Tuple

from database import get_db
from models import User
from routers.auth import get_current_user


# In-memory rate limiting tracker: IP/user -> (timestamp_window_start, count)
_rate_limits: Dict[str, Tuple[datetime, int]] = {}
RATE_LIMIT_WINDOW_SECONDS = 60
MAX_ADMIN_REQUESTS_PER_MINUTE = 120


def enforce_admin_rate_limit(request: Request, client_id: str):
    """
    Prevent abuse and automated scraping of administrative intelligence APIs.
    """
    now = datetime.utcnow()
    key = f"{client_id}:{request.url.path}"
    
    if key in _rate_limits:
        window_start, count = _rate_limits[key]
        if (now - window_start).total_seconds() < RATE_LIMIT_WINDOW_SECONDS:
            if count >= MAX_ADMIN_REQUESTS_PER_MINUTE:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Admin API rate limit exceeded. Please wait a moment."
                )
            _rate_limits[key] = (window_start, count + 1)
        else:
            _rate_limits[key] = (now, 1)
    else:
        _rate_limits[key] = (now, 1)


def get_current_admin_user(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> User:
    """
    Primary admin authorization guard.
    Requires:
      1. Valid authenticated user session (from get_current_user).
      2. is_admin == True in the server database record.
      3. account_status == 'active'.
      4. Rate limit check.
    Does NOT trust frontend parameters or client-side claims.
    """
    # Rate limit check per user ID
    enforce_admin_rate_limit(request, f"user_{current_user.id}")

    # Explicit server-side role verification
    if not getattr(current_user, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden: Administrator privileges required."
        )

    # Active status verification
    account_status = getattr(current_user, "account_status", "active")
    if account_status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access forbidden: Administrative account is {account_status}."
        )

    return current_user


def require_super_admin(
    admin_user: User = Depends(get_current_admin_user)
) -> User:
    """
    Restricts highly sensitive actions (e.g. changing admin roles, irreversible data purge)
    to super administrators only.
    """
    if getattr(admin_user, "admin_role", "user") != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access forbidden: Super administrator role required for this operation."
        )
    return admin_user
