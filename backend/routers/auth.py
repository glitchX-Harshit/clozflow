import re
import secrets
from calendar import timegm
from datetime import datetime, timedelta, timezone
from typing import Optional
import os
import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, status, Header, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from models import User, SUPABASE_SYNCED_PASSWORD_HASH

router = APIRouter(prefix="/auth", tags=["auth"])


def _load_secret_key() -> str:
    configured = os.getenv("JWT_SECRET_KEY") or os.getenv("SECRET_KEY")
    if configured:
        return configured
    # Never fall back to a key that is published in the repository: anyone could
    # mint tokens for any user id. A random key keeps tokens unforgeable; they
    # just stop working when the process restarts.
    print("WARNING: JWT_SECRET_KEY is not set. Using a random signing key for this process; "
          "users will be signed out on every restart. Set JWT_SECRET_KEY in production.")
    return secrets.token_urlsafe(64)


SECRET_KEY = _load_secret_key()
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # 7 days

# Accounts an admin suspended or deactivated (PATCH /api/admin/users/{id}/status)
# can neither sign in nor use existing tokens.
INACTIVE_ACCOUNT_STATUSES = {"suspended", "deactivated"}
ACCOUNT_DISABLED_DETAIL = "This account has been suspended or deactivated. Contact support to restore access."

_USER_ID_RE = re.compile(r"[0-9]{1,18}")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def is_valid_password_length(password: str) -> bool:
    """bcrypt only accepts 1-72 bytes (bcrypt 5 raises above that); we require 8+."""
    return 8 <= len(password.encode("utf-8")) <= 72


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def find_user_by_email(db: Session, email: str) -> Optional[User]:
    """Case-insensitive lookup. New accounts are stored lower-case (indexed fast
    path); older rows may still be mixed-case."""
    normalized = normalize_email(email)
    if not normalized:
        return None
    user = db.query(User).filter(User.email == normalized).first()
    if user is None:
        user = db.query(User).filter(func.lower(User.email) == normalized).first()
    return user


def is_account_active(user: User) -> bool:
    return (user.account_status or "active").strip().lower() not in INACTIVE_ACCOUNT_STATUSES


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta if expires_delta else timedelta(minutes=15))
    to_encode.update({"exp": expire, "iat": now})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def _parse_user_id(sub) -> Optional[int]:
    if isinstance(sub, bool):
        return None
    if isinstance(sub, int):
        return sub if sub > 0 else None
    if isinstance(sub, str) and _USER_ID_RE.fullmatch(sub.strip()):
        return int(sub.strip())
    return None


def _issued_before_account(payload: dict, user: User) -> bool:
    """True when the token predates the account it names.

    SQLite reuses the highest row id after a delete, so a token minted for a
    deleted account must not unlock a newer account that got the same id.
    Tokens without ``iat`` (issued before this check existed) are accepted.
    """
    iat = payload.get("iat")
    created = user.created_at
    if created is None or isinstance(iat, bool) or not isinstance(iat, (int, float)):
        return False
    if created.tzinfo is not None:
        created = created.astimezone(timezone.utc).replace(tzinfo=None)
    return int(iat) < timegm(created.utctimetuple())


def _user_from_supabase_email(email: str, db: Session) -> Optional[User]:
    user = find_user_by_email(db, email)
    if user is not None:
        return user
    user = User(email=normalize_email(email), password_hash=SUPABASE_SYNCED_PASSWORD_HASH)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # A concurrent request for the same new cloud user created the row first.
        db.rollback()
        return find_user_by_email(db, email)
    db.refresh(user)
    return user


def _resolve_token_user(token: str, db: Session) -> Optional[User]:
    """Verify a token's signature and expiry and return its user, whatever the
    account status. Supports local ClozFlow tokens and Supabase Auth JWTs."""
    if not token or not isinstance(token, str):
        return None

    # 1. Local ClozFlow HS256 JWT verification (for native tokens & test suites)
    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM],
            options={"require": ["exp"]},
            leeway=30,
        )
        user_id = _parse_user_id(payload.get("sub"))
        if user_id is not None:
            user = db.query(User).filter(User.id == user_id).first()
            if user is not None and not _issued_before_account(payload, user):
                return user
            return None
    except (jwt.PyJWTError, ValueError, TypeError):
        pass

    # 2. Supabase JWT signature verification (if SUPABASE_JWT_SECRET is configured)
    if SUPABASE_JWT_SECRET:
        try:
            payload = jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                options={"verify_aud": False, "require": ["exp"]},
                leeway=30,
            )
            email = payload.get("email")
            if isinstance(email, str) and "@" in email:
                return _user_from_supabase_email(email, db)
        except (jwt.PyJWTError, ValueError, TypeError):
            pass

    return None


def verify_token_string(token: str, db: Session) -> Optional[User]:
    """
    Cryptographically verifies a JWT token string and resolves the User.
    Supports both local ClozFlow native tokens and Supabase Auth JWTs.
    Enforces expiration checks and rejects unsigned/tampered native tokens.
    Returns None for suspended/deactivated accounts (used by WebSocket handlers).
    """
    user = _resolve_token_user(token, db)
    if user is None or not is_account_active(user):
        return None
    return user



class UserCreate(BaseModel):
    email: str
    password: str


class UserLogin(BaseModel):
    email: str
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str
    user_id: int
    email: str


def _extract_token(authorization: Optional[str], token: Optional[str]) -> Optional[str]:
    if authorization:
        scheme, _, credentials = authorization.strip().partition(" ")
        if scheme.lower() == "bearer" and credentials.strip():
            return credentials.strip()
    if token:
        raw = token.strip()
        if raw.lower().startswith("bearer "):
            raw = raw[7:].strip()
        return raw or None
    return None


def get_current_user(
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    raw_token = _extract_token(authorization, token)
    if not raw_token:
        raise credentials_exception

    user = _resolve_token_user(raw_token, db)
    if not user:
        raise credentials_exception
    if not is_account_active(user):
        # 401 so clients drop the session; the detail says why.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=ACCOUNT_DISABLED_DETAIL,
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


@router.post("/register", response_model=Token)
def register(user: UserCreate, db: Session = Depends(get_db)):
    if not is_valid_password_length(user.password):
        raise HTTPException(422, "Password must be between 8 and 72 UTF-8 bytes")
    email = normalize_email(user.email)
    if "@" not in email or len(email) > 254:
        raise HTTPException(422, "Enter a valid email address")
    if find_user_by_email(db, email):
        raise HTTPException(status_code=400, detail="Email already registered")

    hashed_password = get_password_hash(user.password)
    new_user = User(email=email, password_hash=hashed_password)
    db.add(new_user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Email already registered")
    db.refresh(new_user)

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": str(new_user.id)}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer", "user_id": new_user.id, "email": new_user.email}


@router.post("/login", response_model=Token)
def login(user: UserLogin, db: Session = Depends(get_db)):
    db_user = find_user_by_email(db, user.email)
    if not db_user or not verify_password(user.password, db_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not is_account_active(db_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=ACCOUNT_DISABLED_DETAIL)

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": str(db_user.id)}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer", "user_id": db_user.id, "email": db_user.email}


@router.get("/me")
def read_users_me(current_user: User = Depends(get_current_user)):
    return {"id": current_user.id, "email": current_user.email}
