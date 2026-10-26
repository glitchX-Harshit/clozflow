"""
Clozflow Admin Intelligence — Database Entities
Provides production models for Subscriptions, Orders, Payments, Webhook Events,
Admin Audit Logs, and User Activity Events.
"""
from datetime import datetime
import uuid
from sqlalchemy import Column, Integer, Float, String, DateTime, Text, ForeignKey, Boolean, JSON
from sqlalchemy.orm import relationship

from database import Base


def generate_uuid():
    return uuid.uuid4().hex


class AdminAuditLog(Base):
    """
    Append-only audit trail for all sensitive administrative operations.
    Captures actor, action, target resource, outcome, and context.
    """
    __tablename__ = "admin_audit_logs"

    id             = Column(Integer, primary_key=True, index=True)
    admin_user_id  = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    admin_email    = Column(String, nullable=False, index=True)
    action         = Column(String, nullable=False, index=True)
    resource_type  = Column(String, nullable=False, index=True)
    resource_id    = Column(String, nullable=True)
    details        = Column(Text, nullable=True)
    ip_address     = Column(String, nullable=True)
    status         = Column(String, default="success")  # success | failure
    created_at     = Column(DateTime, default=datetime.utcnow, index=True)

    admin_user = relationship("User", foreign_keys=[admin_user_id])


class ActivityEvent(Base):
    """
    Product activity events for genuine behavioral analytics (DAU, WAU, MAU, retention).
    Recorded only for meaningful product interactions.
    """
    __tablename__ = "activity_events"

    id          = Column(Integer, primary_key=True, index=True)
    user_id     = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    event_type  = Column(String, nullable=False, index=True)
    metadata_json = Column(Text, nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow, index=True)

    user = relationship("User")


class Subscription(Base):
    """
    Customer subscription records for recurring revenue and lifecycle tracking.
    """
    __tablename__ = "subscriptions"

    id                       = Column(Integer, primary_key=True, index=True)
    subscription_number      = Column(String, unique=True, default=generate_uuid, index=True)
    user_id                  = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    plan_id                  = Column(String, nullable=False, index=True)  # starter | professional | enterprise
    billing_interval         = Column(String, default="monthly")           # monthly | annual
    amount                   = Column(Integer, nullable=False)             # in currency units (INR)
    currency                 = Column(String, default="INR")
    status                   = Column(String, default="active", index=True) # trialing | active | past_due | canceled | expired
    current_period_start     = Column(DateTime, default=datetime.utcnow)
    current_period_end       = Column(DateTime, nullable=True)
    cancel_at_period_end     = Column(Boolean, default=False)
    canceled_at              = Column(DateTime, nullable=True)
    provider                 = Column(String, default="manual")            # stripe | razorpay | manual
    provider_subscription_id = Column(String, nullable=True, index=True)
    created_at               = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at               = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User")
    payments = relationship("Payment", back_populates="subscription")


class Order(Base):
    """
    Customer orders for subscription purchases or one-off product offerings.
    """
    __tablename__ = "orders"

    id                = Column(Integer, primary_key=True, index=True)
    order_number      = Column(String, unique=True, default=generate_uuid, index=True)
    user_id           = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    product_name      = Column(String, nullable=False)
    amount            = Column(Integer, nullable=False)
    currency          = Column(String, default="INR")
    status            = Column(String, default="pending", index=True)  # pending | paid | failed | refunded
    provider          = Column(String, default="manual")
    provider_order_id = Column(String, nullable=True, index=True)
    created_at        = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at        = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User")
    payments = relationship("Payment", back_populates="order")


class Payment(Base):
    """
    Financial transactions representing actual collected cash, failed charges, and refunds.
    Source of truth for financial reporting.
    """
    __tablename__ = "payments"

    id                  = Column(Integer, primary_key=True, index=True)
    transaction_id      = Column(String, unique=True, default=generate_uuid, index=True)
    order_id            = Column(Integer, ForeignKey("orders.id"), nullable=True, index=True)
    subscription_id     = Column(Integer, ForeignKey("subscriptions.id"), nullable=True, index=True)
    user_id             = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    gross_amount        = Column(Integer, nullable=False)   # in currency units
    refund_amount       = Column(Integer, default=0)        # amount refunded so far
    net_amount          = Column(Integer, nullable=False)   # gross_amount - refund_amount
    currency            = Column(String, default="INR")
    status              = Column(String, default="succeeded", index=True)  # succeeded | failed | refunded | partially_refunded
    failure_reason      = Column(String, nullable=True)
    provider            = Column(String, default="manual")
    provider_payment_id = Column(String, nullable=True, index=True)
    created_at          = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at          = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User")
    order = relationship("Order", back_populates="payments")
    subscription = relationship("Subscription", back_populates="payments")


class PaymentWebhookEvent(Base):
    """
    Audit log of incoming payment provider webhooks for idempotency and signature reconciliation.
    """
    __tablename__ = "payment_webhook_events"

    id           = Column(Integer, primary_key=True, index=True)
    event_id     = Column(String, unique=True, nullable=False, index=True)  # Provider event ID
    provider     = Column(String, nullable=False, index=True)
    event_type   = Column(String, nullable=False, index=True)
    payload      = Column(Text, nullable=True)
    processed    = Column(Boolean, default=False)
    processed_at = Column(DateTime, nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow, index=True)


class CreditTransaction(Base):
    """
    PAYG credit balances, top-ups, consumption, refunds, and adjustments.
    """
    __tablename__ = "credit_transactions"

    id            = Column(Integer, primary_key=True, index=True)
    user_id       = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    amount        = Column(Float, nullable=False)  # delta credits: positive for top-up/adjustment, negative for usage
    balance_after = Column(Float, nullable=False)
    type          = Column(String, nullable=False, index=True)  # topup | consumption | adjustment | refund
    description   = Column(String, nullable=True)
    created_at    = Column(DateTime, default=datetime.utcnow, index=True)

    user = relationship("User")
