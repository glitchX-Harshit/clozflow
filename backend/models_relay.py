"""Clozflow Relay V1 — Domain Models (separate file for easy identification)"""

import uuid
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base


def generate_slug():
    return uuid.uuid4().hex


class Relay(Base):
    __tablename__ = "relays"
    id              = Column(Integer, primary_key=True, index=True)
    slug            = Column(String, unique=True, index=True, default=generate_slug)
    user_id         = Column(Integer, ForeignKey("users.id"), nullable=False)
    call_id         = Column(Integer, ForeignKey("call_logs.id"), nullable=False)
    status          = Column(String, default="draft")  # draft, published, opened, question_received, booked, cancelled, completed, not_interested

    # Prospect info
    prospect_name     = Column(String, nullable=True)
    prospect_email    = Column(String, nullable=True)
    prospect_business = Column(String, nullable=True)

    # AI-generated content (editable by seller)
    summary         = Column(Text, nullable=True)
    benefits        = Column(Text, nullable=True)   # JSON array string
    next_step       = Column(Text, nullable=True)

    # Seller branding
    seller_name     = Column(String, nullable=True)
    seller_company  = Column(String, nullable=True)

    # Timestamps
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    published_at    = Column(DateTime, nullable=True)

    # Relationships
    user    = relationship("User")
    call    = relationship("CallLog")
    slots   = relationship("RelayAvailabilitySlot", back_populates="relay", cascade="all, delete-orphan")
    bookings = relationship("RelayBooking", back_populates="relay", cascade="all, delete-orphan")
    questions = relationship("RelayQuestion", back_populates="relay", cascade="all, delete-orphan")


class RelayAvailabilitySlot(Base):
    __tablename__ = "relay_availability_slots"
    id              = Column(Integer, primary_key=True, index=True)
    relay_id        = Column(Integer, ForeignKey("relays.id"), nullable=False)
    date            = Column(String, nullable=False)       # YYYY-MM-DD
    start_time      = Column(String, nullable=False)       # HH:MM (24h)
    end_time        = Column(String, nullable=False)       # HH:MM (24h)
    duration_minutes = Column(Integer, default=30)
    meeting_type    = Column(String, default="Video Call")  # Video Call, Phone Call, In-Person
    is_booked       = Column(Boolean, default=False)
    created_at      = Column(DateTime, default=datetime.utcnow)

    relay = relationship("Relay", back_populates="slots")


class RelayBooking(Base):
    __tablename__ = "relay_bookings"
    id              = Column(Integer, primary_key=True, index=True)
    relay_id        = Column(Integer, ForeignKey("relays.id"), nullable=False)
    slot_id         = Column(Integer, ForeignKey("relay_availability_slots.id"), nullable=False)
    buyer_name      = Column(String, nullable=False)
    buyer_email     = Column(String, nullable=True)
    buyer_phone     = Column(String, nullable=True)
    status          = Column(String, default="confirmed")  # confirmed, cancelled
    created_at      = Column(DateTime, default=datetime.utcnow)

    relay = relationship("Relay", back_populates="bookings")
    slot  = relationship("RelayAvailabilitySlot")


class RelayQuestion(Base):
    __tablename__ = "relay_questions"
    id              = Column(Integer, primary_key=True, index=True)
    relay_id        = Column(Integer, ForeignKey("relays.id"), nullable=False)
    question_text   = Column(Text, nullable=False)
    answer_text     = Column(Text, nullable=True)
    asked_at        = Column(DateTime, default=datetime.utcnow)
    answered_at     = Column(DateTime, nullable=True)

    relay = relationship("Relay", back_populates="questions")
