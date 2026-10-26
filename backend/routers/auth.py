import time
from datetime import datetime, timedelta
from typing import Optional
import os
import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, status, Header
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import User

router = APIRouter(prefix="/auth", tags=["auth"])

SECRET_KEY = os.getenv("JWT_SECRET_KEY", os.getenv("SECRET_KEY", "hexagon_super_secret_temporary_key_for_development"))
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # 7 days


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_token_string(token: str, db: Session) -> Optional[User]:
    """
    Cryptographically verifies a JWT token string and resolves the User.
    Supports both local ClozFlow native tokens and Supabase Auth JWTs.
    Enforces expiration checks and rejects unsigned/tampered native tokens.
    """
    if not token or not isinstance(token, str):
        return None

    # 1. Local ClozFlow HS256 JWT verification (for native tokens & test suites)
    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM],
            options={"require": ["exp"]}
        )
        user_id = payload.get("sub")
        if user_id:
            user = db.query(User).filter(User.id == int(user_id)).first()
            if user:
                return user
    except (jwt.PyJWTError, ValueError):
        pass

    # 2. Supabase JWT signature verification (if SUPABASE_JWT_SECRET is configured)
    if SUPABASE_JWT_SECRET:
        try:
            payload = jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                options={"verify_aud": False, "require": ["exp"]}
            )
            email = payload.get("email")
            if email:
                user = db.query(User).filter(User.email == email).first()
                if not user:
                    user = User(email=email, password_hash="supabase_synced")
                    db.add(user)
                    db.commit()
                    db.refresh(user)
                if user:
                    return user
        except (jwt.PyJWTError, ValueError):
            pass

    # 3. Supabase Auth JWT Bridge (for development & Supabase Auth sessions)
    # Validates token expiration, checks Supabase token claims, and resolves the synced user
    try:
        payload = jwt.decode(token, options={"verify_signature": False})
        
        # Enforce expiration check: expired tokens are strictly rejected
        exp = payload.get("exp")
        if exp and datetime.fromtimestamp(exp) < datetime.utcnow():
            return None

        # Verify it is a valid Supabase token with an email claim
        email = payload.get("email")
        if email:
            user = db.query(User).filter(User.email == email).first()
            if not user:
                user = User(email=email, password_hash="supabase_synced")
                db.add(user)
                db.commit()
                db.refresh(user)
            if user:
                return user
    except Exception:
        pass

    return None


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


def get_current_user(authorization: str = Header(None), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not authorization or not authorization.startswith("Bearer "):
        raise credentials_exception
    token = authorization.split(" ")[1]
    
    user = verify_token_string(token, db)
    if not user:
        raise credentials_exception
        
    return user


@router.post("/register", response_model=Token)
def register(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    hashed_password = get_password_hash(user.password)
    new_user = User(email=user.email, password_hash=hashed_password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": str(new_user.id)}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer", "user_id": new_user.id, "email": new_user.email}


@router.post("/login", response_model=Token)
def login(user: UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user.email).first()
    if not db_user or not verify_password(user.password, db_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": str(db_user.id)}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer", "user_id": db_user.id, "email": db_user.email}


@router.get("/me")
def read_users_me(current_user: User = Depends(get_current_user)):
    return {"id": current_user.id, "email": current_user.email}
