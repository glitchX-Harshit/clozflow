import os
import re
import secrets
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from pydantic import BaseModel, ConfigDict, field_serializer, field_validator
from typing import Optional
from datetime import datetime

from database import get_db, utc_isoformat
from models import CallLog, User
from models_bridge import CopilotBridgeCall
from models_relay import Relay
from routers.auth import get_current_user, get_password_hash, verify_password

router = APIRouter(prefix="/api/user", tags=["user"])

# Anchored to the backend folder so uploads land where main.py serves /static from.
AVATAR_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "avatars")
AVATAR_URL_PREFIX = "/static/avatars/"
os.makedirs(AVATAR_DIR, exist_ok=True)
MAX_AVATAR_SIZE = 5 * 1024 * 1024 # 5 MB
ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
# Files this router writes: user_<id>.<ext> (legacy) or user_<id>_<random>.<ext>.
_AVATAR_FILE_RE = re.compile(r"user_(\d+)(?:_[0-9a-f]{8,32})?\.(?:jpg|png|webp)")

MAX_OVERRIDE_PROMPT_CHARS = 4000

CLOUD_PASSWORD_DETAIL = (
    "This account signs in through ClozFlow Cloud (Supabase), so its password is managed by that "
    "sign-in provider and can't be changed here. Use \"Forgot password\" on the sign-in screen, "
    "or your Google account if you sign in with Google."
)


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class UserProfile(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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
    ai_override_prompt: Optional[str] = None
    notif_call_summary: bool
    notif_objection_alerts: bool
    notif_deal_risk: bool
    notif_coaching: bool
    is_admin: Optional[bool] = False
    admin_role: Optional[str] = "user"
    credit_balance: Optional[float] = 0.0
    auth_provider: str = "local"            # "local" | "supabase" (password managed by Supabase)
    created_at: Optional[datetime] = None

    # Rows written before a notification column existed may hold NULL.
    @field_validator("notif_call_summary", "notif_deal_risk", "notif_coaching", mode="before")
    @classmethod
    def _null_means_on(cls, value):
        return True if value is None else value

    @field_validator("notif_objection_alerts", mode="before")
    @classmethod
    def _null_means_off(cls, value):
        return False if value is None else value

    @field_serializer("created_at")
    def _created_at_utc(self, value: Optional[datetime]) -> Optional[str]:
        return utc_isoformat(value)

    @field_serializer("credit_balance")
    def _round_balance(self, value: Optional[float]) -> float:
        return round(float(value or 0.0), 2)


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
    ai_override_prompt: Optional[str] = None
    notif_call_summary: Optional[bool] = None
    notif_objection_alerts: Optional[bool] = None
    notif_deal_risk: Optional[bool] = None
    notif_coaching: Optional[bool] = None

    @field_validator("username", mode="before")
    @classmethod
    def _clean_username(cls, value):
        # A blank username means "no username" (NULL): "" would collide on the unique index.
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Username must be text.")
        return value.strip() or None

    @field_validator("ai_override_prompt", mode="before")
    @classmethod
    def _clean_override_prompt(cls, value):
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("Prompt override must be text.")
        value = value.strip()
        if not value:
            return None
        if len(value) > MAX_OVERRIDE_PROMPT_CHARS:
            raise ValueError(f"Prompt override must be {MAX_OVERRIDE_PROMPT_CHARS} characters or fewer.")
        return value


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


# Boolean columns the profile schema requires; an explicit null leaves them unchanged.
_NON_NULL_FIELDS = ("notif_call_summary", "notif_objection_alerts", "notif_deal_risk", "notif_coaching")

# Personal data wiped from a deleted account's row.
_PROFILE_FIELDS_TO_WIPE = (
    "username", "full_name", "bio", "company_name", "role", "profile_image",
    "workspace_name", "team_size", "ai_override_prompt",
)


def _remove_avatar_file(image_url: Optional[str], user_id: int) -> None:
    """Delete an avatar file this router created for ``user_id``; never anything else."""
    if not image_url or not image_url.startswith(AVATAR_URL_PREFIX):
        return
    name = image_url[len(AVATAR_URL_PREFIX):]
    match = _AVATAR_FILE_RE.fullmatch(name)
    if not match or int(match.group(1)) != user_id:
        return
    try:
        os.remove(os.path.join(AVATAR_DIR, name))
    except FileNotFoundError:
        pass
    except OSError as exc:
        print(f"⚠️ Could not delete old avatar file: {type(exc).__name__}")


def _relay_linked_call_ids():
    return select(Relay.call_id).where(Relay.call_id.isnot(None))


def _delete_unlinked_call_logs(db: Session, user_id: int) -> tuple:
    """Delete the user's call logs except those a Relay page still points at
    (relays.call_id is a NOT NULL foreign key). Returns (deleted, kept)."""
    owned = db.query(CallLog).filter(CallLog.user_id == user_id)
    kept = owned.filter(CallLog.id.in_(_relay_linked_call_ids())).count()
    deleted = owned.filter(CallLog.id.notin_(_relay_linked_call_ids())).delete(synchronize_session=False)
    return deleted, kept


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
    update_data = data.model_dump(exclude_unset=True)
    for field in _NON_NULL_FIELDS:
        if field in update_data and update_data[field] is None:
            del update_data[field]

    # Validate username uniqueness if being changed (clearing it is always allowed)
    new_username = update_data.get("username")
    if new_username and new_username != current_user.username:
        existing = db.query(User).filter(
            User.username == new_username,
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
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")
    db.refresh(current_user)
    return current_user


@router.post("/avatar", response_model=UserProfile)
async def upload_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a new profile picture. Strictly validates type, size, and image headers."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file selected")

    raw_ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if raw_ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file extension. Allowed extensions are: {', '.join(sorted(ALLOWED_IMAGE_EXTENSIONS))}"
        )

    # Read initial chunk to inspect magic bytes & size
    header = await file.read(512)
    if len(header) < 12:
        raise HTTPException(status_code=400, detail="File is too small to be a valid image")

    # Validate magic bytes (the stored extension comes from these, not the filename)
    is_jpeg = header.startswith(b"\xff\xd8\xff")
    is_png = header.startswith(b"\x89PNG\r\n\x1a\n")
    is_webp = header[:4] == b"RIFF" and header[8:12] == b"WEBP"

    if not (is_jpeg or is_png or is_webp):
        raise HTTPException(status_code=400, detail="Invalid image file format")

    # Read at most one byte past the limit so oversized uploads aren't buffered whole
    rest = await file.read(MAX_AVATAR_SIZE + 1 - len(header))
    total_size = len(header) + len(rest)
    if total_size > MAX_AVATAR_SIZE:
        raise HTTPException(status_code=413, detail=f"Image exceeds maximum size limit of {MAX_AVATAR_SIZE // (1024 * 1024)}MB")

    # A fresh name per upload so clients and caches never show the previous picture
    canonical_ext = "png" if is_png else ("webp" if is_webp else "jpg")
    filename = f"user_{current_user.id}_{secrets.token_hex(8)}.{canonical_ext}"
    filepath = os.path.join(AVATAR_DIR, filename)

    with open(filepath, "wb") as buffer:
        buffer.write(header)
        buffer.write(rest)

    previous_image = current_user.profile_image
    current_user.profile_image = f"{AVATAR_URL_PREFIX}{filename}"
    current_user.updated_at = datetime.utcnow()
    try:
        db.commit()
    except Exception:
        db.rollback()
        _remove_avatar_file(f"{AVATAR_URL_PREFIX}{filename}", current_user.id)
        raise
    db.refresh(current_user)
    if previous_image != current_user.profile_image:
        _remove_avatar_file(previous_image, current_user.id)
    return current_user


@router.post("/change-password")
def change_password(
    data: PasswordChange,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Change password after verifying the current one.

    Cloud (Supabase) accounts have no local password: they sign in through
    Supabase, so a local password would be a second, unmanaged credential.
    They get a 400 that says where to change it instead.
    """
    if current_user.auth_provider == "supabase":
        raise HTTPException(status_code=400, detail=CLOUD_PASSWORD_DETAIL)
    if not verify_password(data.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(data.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    if len(data.new_password.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail="New password is too long (maximum 72 bytes)")

    current_user.password_hash = get_password_hash(data.new_password)
    current_user.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "Password updated successfully"}


@router.delete("/delete-account")
def delete_account(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Permanently delete the account: its call history, Relay pages, bridge
    calls (they hold phone numbers) and avatar are removed and its profile data
    is wiped.

    The users row itself is kept as an anonymised, deactivated tombstone: other
    tables reference users.id with NOT NULL foreign keys (a hard DELETE fails on
    Postgres), and SQLite would otherwise give the freed id - with the old
    account's tokens and rows - to the next sign-up. The email is released, so
    the person can register again.
    """
    user_id = current_user.id
    previous_image = current_user.profile_image

    for relay in db.query(Relay).filter(Relay.user_id == user_id).all():
        db.delete(relay)  # cascades to its slots, bookings and questions
    db.flush()
    # The users row survives (tombstone), so the FK's ON DELETE CASCADE never fires.
    db.query(CopilotBridgeCall).filter(CopilotBridgeCall.user_id == user_id).delete(synchronize_session=False)
    db.query(CallLog).filter(CallLog.user_id == user_id).delete(synchronize_session=False)

    current_user.email = f"deleted-user-{user_id}-{secrets.token_hex(6)}@deleted.invalid"
    current_user.password_hash = "!account-deleted"
    for field in _PROFILE_FIELDS_TO_WIPE:
        setattr(current_user, field, None)
    current_user.account_status = "deactivated"
    current_user.is_admin = False
    current_user.admin_role = "user"
    current_user.updated_at = datetime.utcnow()
    db.commit()

    _remove_avatar_file(previous_image, user_id)
    return {"message": "Account deleted"}


@router.post("/clear-history")
def clear_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete the current user's call logs. Calls a Relay page was built from are
    kept (delete the Relay first) because the Relay references them."""
    deleted, kept = _delete_unlinked_call_logs(db, current_user.id)
    db.commit()
    message = "Call history cleared"
    if kept:
        message += f". {kept} call(s) linked to Relay pages were kept"
    return {"message": message, "deleted": deleted, "kept": kept}
