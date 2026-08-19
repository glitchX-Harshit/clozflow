from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from database import get_db
from models import User, Capsule
from routers.auth import get_current_user

router = APIRouter(prefix="/api/capsules", tags=["capsules"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class CapsuleCreate(BaseModel):
    name: str
    product_name: str
    product_price: Optional[str] = None
    product_specification: Optional[str] = None
    target_audience: Optional[str] = None
    key_differentiators: Optional[str] = None
    pain_points_solved: Optional[str] = None
    additional_context: Optional[str] = None
    is_default: Optional[bool] = False


class CapsuleUpdate(BaseModel):
    name: Optional[str] = None
    product_name: Optional[str] = None
    product_price: Optional[str] = None
    product_specification: Optional[str] = None
    target_audience: Optional[str] = None
    key_differentiators: Optional[str] = None
    pain_points_solved: Optional[str] = None
    additional_context: Optional[str] = None
    is_default: Optional[bool] = None


class CapsuleResponse(BaseModel):
    id: int
    name: str
    product_name: str
    product_price: Optional[str]
    product_specification: Optional[str]
    target_audience: Optional[str]
    key_differentiators: Optional[str]
    pain_points_solved: Optional[str]
    additional_context: Optional[str]
    is_default: bool
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("", response_model=list[CapsuleResponse])
def list_capsules(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all capsules belonging to the authenticated user."""
    return (
        db.query(Capsule)
        .filter(Capsule.user_id == current_user.id)
        .order_by(Capsule.is_default.desc(), Capsule.updated_at.desc())
        .all()
    )


@router.post("", response_model=CapsuleResponse, status_code=status.HTTP_201_CREATED)
def create_capsule(
    data: CapsuleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new product capsule."""
    # If this capsule is set as default, unset any existing default
    if data.is_default:
        db.query(Capsule).filter(
            Capsule.user_id == current_user.id,
            Capsule.is_default == True,
        ).update({"is_default": False})

    capsule = Capsule(
        user_id=current_user.id,
        **data.dict(),
    )
    db.add(capsule)
    db.commit()
    db.refresh(capsule)
    return capsule


@router.get("/{capsule_id}", response_model=CapsuleResponse)
def get_capsule(
    capsule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single capsule by ID."""
    capsule = db.query(Capsule).filter(
        Capsule.id == capsule_id,
        Capsule.user_id == current_user.id,
    ).first()
    if not capsule:
        raise HTTPException(status_code=404, detail="Capsule not found")
    return capsule


@router.patch("/{capsule_id}", response_model=CapsuleResponse)
def update_capsule(
    capsule_id: int,
    data: CapsuleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Partially update a capsule."""
    capsule = db.query(Capsule).filter(
        Capsule.id == capsule_id,
        Capsule.user_id == current_user.id,
    ).first()
    if not capsule:
        raise HTTPException(status_code=404, detail="Capsule not found")

    update_data = data.dict(exclude_unset=True)

    # If setting this as default, unset any existing default first
    if update_data.get("is_default"):
        db.query(Capsule).filter(
            Capsule.user_id == current_user.id,
            Capsule.is_default == True,
            Capsule.id != capsule_id,
        ).update({"is_default": False})

    for field, value in update_data.items():
        setattr(capsule, field, value)

    capsule.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(capsule)
    return capsule


@router.delete("/{capsule_id}")
def delete_capsule(
    capsule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a capsule."""
    capsule = db.query(Capsule).filter(
        Capsule.id == capsule_id,
        Capsule.user_id == current_user.id,
    ).first()
    if not capsule:
        raise HTTPException(status_code=404, detail="Capsule not found")

    db.delete(capsule)
    db.commit()
    return {"message": "Capsule deleted"}


@router.patch("/{capsule_id}/default", response_model=CapsuleResponse)
def set_default_capsule(
    capsule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Toggle a capsule as the default (unsets any previous default)."""
    capsule = db.query(Capsule).filter(
        Capsule.id == capsule_id,
        Capsule.user_id == current_user.id,
    ).first()
    if not capsule:
        raise HTTPException(status_code=404, detail="Capsule not found")

    # Unset all existing defaults
    db.query(Capsule).filter(
        Capsule.user_id == current_user.id,
        Capsule.is_default == True,
    ).update({"is_default": False})

    # Toggle: if it was already default, it stays unset; otherwise set it
    capsule.is_default = True
    capsule.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(capsule)
    return capsule
