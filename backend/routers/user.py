import os
import shutil
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime

from database import get_db
from models import User
from routers.auth import get_current_user, get_password_hash, verify_password

router = APIRouter(prefix="/api/user", tags=["user"])

AVATAR_DIR = "static/avatars"
os.makedirs(AVATAR_DIR, exist_ok=True)


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class UserProfile(BaseModel):
    id: int
    email: str
    username: Optional[str]
    full_name: Optional[str]
    bio: Optional[str]
    company_name: Optional[str]
    role: Optional[str]
    profile_image: Optional[str]
    workspace_name: Optional[str]
    team_size: Optional[str]
    sales_style: Optional[str]
    ai_response_length: Optional[str]
    ai_tone: Optional[str]
    ai_objection_pressure: Optional[str]
    ai_speed: Optional[str]
    notif_call_summary: bool
    notif_objection_alerts: bool
    notif_deal_risk: bool
    notif_coaching: bool
    created_at: datetime

    class Config:
        from_attributes = True


class ProfileUpdate(BaseModel):
    username: Optional[str] = None
    full_name: Optional[str] = None
    bio: Optional[str] = None
    company_name: Optional[str] = None
    role: Optional[str] = None
    workspace_name: Optional[str] = None
    team_size: Optional[str] = None
    sales_style: Optional[str] = None
    ai_response_length: Optional[str] = None
    ai_tone: Optional[str] = None
    ai_objection_pressure: Optional[str] = None
    ai_speed: Optional[str] = None
    notif_call_summary: Optional[bool] = None
    notif_objection_alerts: Optional[bool] = None
    notif_deal_risk: Optional[bool] = None
    notif_coaching: Optional[bool] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/me", response_model=UserProfile)
def get_me(current_user: User = Depends(get_current_user)):
    """Return the full profile of the authenticated user."""
    return current_user


@router.patch("/update", response_model=UserProfile)
def update_profile(
    data: ProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Partially update profile, workspace, AI preferences, or notifications."""
    update_data = data.dict(exclude_unset=True)

    # Validate username uniqueness if being changed
    if "username" in update_data and update_data["username"] != current_user.username:
        existing = db.query(User).filter(
            User.username == update_data["username"],
            User.id != current_user.id
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Username already taken"
            )

    for field, value in update_data.items():
        setattr(current_user, field, value)

    current_user.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/avatar", response_model=UserProfile)
async def upload_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a new profile picture. Accepts image files only."""
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    ext = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "jpg"
    filename = f"user_{current_user.id}.{ext}"
    filepath = os.path.join(AVATAR_DIR, filename)

    with open(filepath, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    current_user.profile_image = f"/static/avatars/{filename}"
    current_user.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/change-password")
def change_password(
    data: PasswordChange,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Change password after verifying the current one."""
    if not verify_password(data.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(data.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")

    current_user.password_hash = get_password_hash(data.new_password)
    current_user.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "Password updated successfully"}


@router.delete("/delete-account")
def delete_account(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Permanently delete the account and all associated data."""
    db.delete(current_user)
    db.commit()
    return {"message": "Account deleted"}


@router.post("/clear-history")
def clear_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete all call logs for the current user."""
    from models import CallLog
    db.query(CallLog).filter(CallLog.user_id == current_user.id).delete()
    db.commit()
    return {"message": "Call history cleared"}
