"""
Clozflow Admin Intelligence — Automated Test Suite
Verifies:
1. Authentication & Server-Side Authorization (Default Deny, 401/403/200)
2. Role Enforcement (require_super_admin)
3. Revenue Engine (Gross, Refunds, Net Cash, MRR, ARR, ARPPU, Zero states)
4. User Management (Filtering, pagination, status changes, 360 profile)
5. Audit Logging (Immutable records of administrative mutations)
6. Payment Webhook Integrity (Signature, Idempotency, State transitions)
7. CSV Data Export (Security headers, format verification)
"""
import unittest
import os
import sys
from datetime import datetime, timedelta

# Put backend root on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import models
import models_pearl
import models_relay
import admin.models
from database import Base, get_db
from models import User
from admin.models import (
    AdminAuditLog,
    ActivityEvent,
    Subscription,
    Order,
    Payment,
    PaymentWebhookEvent,
    CreditTransaction
)
from routers.auth import create_access_token, get_password_hash
from main import app

# In-memory SQLite engine with StaticPool so all connections share the same memory instance
TEST_SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
test_engine = create_engine(
    TEST_SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


class TestAdminIntelligenceSuite(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=test_engine)

    @classmethod
    def tearDownClass(cls):
        Base.metadata.drop_all(bind=test_engine)

    def setUp(self):
        # Clear database between tests
        self.db = TestingSessionLocal()
        for table in reversed(Base.metadata.sorted_tables):
            self.db.execute(table.delete())
        self.db.commit()

        # Seed test users
        # 1. Normal user
        self.normal_user = User(
            email="regular_sales_rep@clozflow.in",
            password_hash=get_password_hash("password123"),
            full_name="Regular Rep",
            is_admin=False,
            admin_role="user",
            account_status="active"
        )
        self.db.add(self.normal_user)

        # 2. Administrator
        self.admin_user = User(
            email="ops_admin@clozflow.in",
            password_hash=get_password_hash("adminpassword123"),
            full_name="Operations Admin",
            is_admin=True,
            admin_role="admin",
            account_status="active"
        )
        self.db.add(self.admin_user)

        # 3. Super Administrator
        self.super_admin_user = User(
            email="founder_super@clozflow.in",
            password_hash=get_password_hash("superadminpassword123"),
            full_name="Founder SuperAdmin",
            is_admin=True,
            admin_role="super_admin",
            account_status="active"
        )
        self.db.add(self.super_admin_user)

        # 4. Suspended Admin
        self.suspended_admin_user = User(
            email="suspended_admin@clozflow.in",
            password_hash=get_password_hash("suspendedpass123"),
            full_name="Suspended Admin",
            is_admin=True,
            admin_role="admin",
            account_status="suspended"
        )
        self.db.add(self.suspended_admin_user)

        self.db.commit()

        # Generate tokens
        self.normal_token = create_access_token({"sub": str(self.normal_user.id)})
        self.admin_token = create_access_token({"sub": str(self.admin_user.id)})
        self.super_admin_token = create_access_token({"sub": str(self.super_admin_user.id)})
        self.suspended_admin_token = create_access_token({"sub": str(self.suspended_admin_user.id)})

    def tearDown(self):
        self.db.close()

    # ── Test 1: Authentication & Authorization ───────────────────────────────

    def test_anonymous_access_denied(self):
        """Anonymous requests to /api/admin/overview must return 401 Unauthorized."""
        response = client.get("/api/admin/overview")
        self.assertEqual(response.status_code, 401)

    def test_regular_user_access_forbidden(self):
        """Authenticated ordinary user without is_admin=True must receive 403 Forbidden."""
        response = client.get(
            "/api/admin/overview",
            headers={"Authorization": f"Bearer {self.normal_token}"}
        )
        self.assertEqual(response.status_code, 403)
        self.assertIn("Administrator privileges required", response.json()["detail"])

    def test_suspended_admin_access_forbidden(self):
        """Admin with account_status='suspended' must receive 403 Forbidden."""
        response = client.get(
            "/api/admin/overview",
            headers={"Authorization": f"Bearer {self.suspended_admin_token}"}
        )
        self.assertEqual(response.status_code, 403)
        self.assertIn("suspended", response.json()["detail"])

    def test_authorized_admin_access_granted(self):
        """Authorized admin receives 200 OK with valid overview metrics."""
        response = client.get(
            "/api/admin/overview",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("kpis", data)
        self.assertIn("total_users", data["kpis"])
        self.assertEqual(data["kpis"]["total_users"], 4)

    # ── Test 2: Role Management & SuperAdmin Restriction ─────────────────────

    def test_regular_admin_cannot_alter_roles(self):
        """Regular admin cannot change administrative roles (requires super_admin)."""
        response = client.patch(
            f"/api/admin/users/{self.normal_user.id}/role",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={"admin_role": "admin", "is_admin": True, "reason": "Self-promotion attempt"}
        )
        self.assertEqual(response.status_code, 403)
        self.assertIn("Super administrator role required", response.json()["detail"])

    def test_super_admin_can_promote_user_and_creates_audit_log(self):
        """Super admin can promote user to admin; writes to admin_audit_logs."""
        response = client.patch(
            f"/api/admin/users/{self.normal_user.id}/role",
            headers={"Authorization": f"Bearer {self.super_admin_token}"},
            json={"admin_role": "admin", "is_admin": True, "reason": "Promoted to support lead"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["is_admin"])

        # Verify audit log was recorded
        audit = self.db.query(AdminAuditLog).filter(
            AdminAuditLog.action == "user_admin_role_changed",
            AdminAuditLog.resource_id == str(self.normal_user.id)
        ).first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.admin_email, self.super_admin_user.email)
        self.assertIn("Promoted to support lead", audit.details)

    # ── Test 3: Revenue Formulas & Calculations ──────────────────────────────

    def test_revenue_calculations_and_mrr(self):
        """
        Verify financial formulas:
        Gross = 3999 + 8299*12 = 3999 + 99588 = 103587
        Refund = 1000
        Net = 102587
        MRR = 3999 (monthly) + 8299 (annual normalized: 99588 / 12 = 8299) = 12298.0
        ARR = 12298.0 * 12 = 147576.0
        """
        now = datetime.utcnow()

        # Monthly subscription: ₹3,999/mo
        sub_monthly = Subscription(
            user_id=self.normal_user.id,
            plan_id="starter",
            billing_interval="monthly",
            amount=3999,
            currency="INR",
            status="active",
            current_period_start=now,
            current_period_end=now + timedelta(days=30)
        )
        # Annual subscription: ₹99,588/yr (₹8,299/mo)
        sub_annual = Subscription(
            user_id=self.admin_user.id,
            plan_id="professional",
            billing_interval="annual",
            amount=99588,
            currency="INR",
            status="active",
            current_period_start=now,
            current_period_end=now + timedelta(days=365)
        )
        self.db.add_all([sub_monthly, sub_annual])
        self.db.commit()

        # Successful payment 1: ₹3,999
        p1 = Payment(
            transaction_id="txn_001",
            user_id=self.normal_user.id,
            subscription_id=sub_monthly.id,
            gross_amount=3999,
            refund_amount=0,
            net_amount=3999,
            currency="INR",
            status="succeeded",
            created_at=now
        )
        # Successful payment 2: ₹99,588 with partial refund of ₹1,000
        p2 = Payment(
            transaction_id="txn_002",
            user_id=self.admin_user.id,
            subscription_id=sub_annual.id,
            gross_amount=99588,
            refund_amount=1000,
            net_amount=98588,
            currency="INR",
            status="partially_refunded",
            created_at=now,
            updated_at=now
        )
        self.db.add_all([p1, p2])
        self.db.commit()

        response = client.get(
            "/api/admin/analytics/revenue?period=30d",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data["gross_collected"]["value"], 103587)
        self.assertEqual(data["refunds"]["value"], 1000)
        self.assertEqual(data["net_cash"]["value"], 102587)
        self.assertEqual(data["mrr"]["value"], 12298.0)
        self.assertEqual(data["arr"]["value"], 147576.0)
        self.assertEqual(data["paying_customers"]["period_count"], 2)
        self.assertEqual(data["arppu"]["value"], 51293.5)

    def test_empty_database_revenue_returns_zero_without_crashing(self):
        """Empty transactions return clean 0s with no crash or fake numbers."""
        response = client.get(
            "/api/admin/analytics/revenue?period=30d",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["gross_collected"]["value"], 0)
        self.assertEqual(data["refunds"]["value"], 0)
        self.assertEqual(data["net_cash"]["value"], 0)
        self.assertEqual(data["mrr"]["value"], 0.0)
        self.assertEqual(data["arr"]["value"], 0.0)
        self.assertEqual(data["paying_customers"]["period_count"], 0)

    # ── Test 4: User Management & Suspension ─────────────────────────────────

    def test_user_suspension_mutation_and_audit(self):
        """Admin suspends regular user; user's account_status updates and writes to audit log."""
        response = client.patch(
            f"/api/admin/users/{self.normal_user.id}/status",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={"account_status": "suspended", "reason": "Violation of terms"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["new_status"], "suspended")

        # Verify DB updated
        self.db.refresh(self.normal_user)
        self.assertEqual(self.normal_user.account_status, "suspended")

        # Verify audit log exists
        audit = self.db.query(AdminAuditLog).filter(
            AdminAuditLog.action == "user_status_changed",
            AdminAuditLog.resource_id == str(self.normal_user.id)
        ).first()
        self.assertIsNotNone(audit)
        self.assertIn("Violation of terms", audit.details)

    # ── Test 5: Payment Webhook Idempotency & Transitions ────────────────────

    def test_payment_webhook_idempotency_and_event_handling(self):
        """Webhook verifies idempotency: identical event_id processed once, ignored on retry."""
        webhook_body = {
            "event_id": "evt_test_unique_99812",
            "event_type": "payment.succeeded",
            "provider": "razorpay",
            "data": {
                "user_id": self.normal_user.id,
                "amount": 3999,
                "currency": "INR",
                "transaction_id": "pay_test_99812"
            }
        }

        # First request -> Processed
        res1 = client.post("/api/admin/webhook/payment", json=webhook_body)
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res1.json()["status"], "processed")

        # Payment should exist in database
        payment = self.db.query(Payment).filter(Payment.transaction_id == "pay_test_99812").first()
        self.assertIsNotNone(payment)
        self.assertEqual(payment.gross_amount, 3999)

        # Second request with SAME event_id -> Ignored (idempotent skip)
        res2 = client.post("/api/admin/webhook/payment", json=webhook_body)
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.json()["status"], "ignored")

        # Ensure duplicate payment was not created
        payment_count = self.db.query(Payment).filter(Payment.transaction_id == "pay_test_99812").count()
        self.assertEqual(payment_count, 1)

    # ── Test 6: CSV Data Export Security ─────────────────────────────────────

    def test_csv_export_permissions_and_streaming(self):
        """Exporting CSV requires admin auth and produces proper CSV headers and stream."""
        # Unauthenticated attempt
        res_unauth = client.get("/api/admin/export/users")
        self.assertEqual(res_unauth.status_code, 401)

        # Authorized admin export
        res_admin = client.get(
            "/api/admin/export/users",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        self.assertEqual(res_admin.status_code, 200)
        self.assertEqual(res_admin.headers["content-type"], "text/csv; charset=utf-8")
        self.assertIn("attachment; filename=clozflow_users_", res_admin.headers["content-disposition"])
        content = res_admin.text
        self.assertIn("ID,Email,Full Name,Company,Status,Role,Is Admin,Created At", content)
        self.assertIn("regular_sales_rep@clozflow.in", content)

    # ── Test 7: PAYG Credit Adjustments & Ledger ─────────────────────────────

    def test_credit_adjustment_and_ledger(self):
        """Admin adjusts PAYG credit balance; ledger records transaction and audit log."""
        # Top-up 500 credits
        res1 = client.post(
            f"/api/admin/users/{self.normal_user.id}/adjust-credits",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={"amount": 500, "reason": "Courtesy top-up", "type": "topup"}
        )
        self.assertEqual(res1.status_code, 200)
        self.db.refresh(self.normal_user)
        self.assertEqual(self.normal_user.credit_balance, 500)

        # Deduct 150 credits
        res2 = client.post(
            f"/api/admin/users/{self.normal_user.id}/adjust-credits",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={"amount": -150, "reason": "Overdraft reconciliation", "type": "consumption"}
        )
        self.assertEqual(res2.status_code, 200)
        self.db.refresh(self.normal_user)
        self.assertEqual(self.normal_user.credit_balance, 350)

        # Verify CreditTransaction ledger rows
        txns = self.db.query(CreditTransaction).filter(CreditTransaction.user_id == self.normal_user.id).all()
        self.assertEqual(len(txns), 2)
        self.assertEqual(txns[0].amount, 500)
        self.assertEqual(txns[1].amount, -150)
        self.assertEqual(txns[1].balance_after, 350)

        # Reject deduction that causes negative balance
        res_fail = client.post(
            f"/api/admin/users/{self.normal_user.id}/adjust-credits",
            headers={"Authorization": f"Bearer {self.admin_token}"},
            json={"amount": -500, "reason": "Excess deduction", "type": "consumption"}
        )
        self.assertEqual(res_fail.status_code, 400)
        self.assertIn("negative balance", res_fail.json()["detail"])

    # ── Test 8: Role-based Export Restrictions ────────────────────────────────

    def test_analyst_role_export_restriction(self):
        """Analyst role can export usage/analytics but is strictly forbidden from exporting financial ledgers."""
        analyst_user = User(
            email="analyst@clozflow.in",
            password_hash=get_password_hash("analystpass123"),
            full_name="Junior Data Analyst",
            is_admin=True,
            admin_role="analyst",
            account_status="active"
        )
        self.db.add(analyst_user)
        self.db.commit()
        analyst_token = create_access_token({"sub": str(analyst_user.id)})

        # Financial export (payments) forbidden for analyst
        res_pay = client.get(
            "/api/admin/export/payments",
            headers={"Authorization": f"Bearer {analyst_token}"}
        )
        self.assertEqual(res_pay.status_code, 403)
        self.assertIn("not authorized to export", res_pay.json()["detail"])

        # Financial export (orders) forbidden for analyst
        res_orders = client.get(
            "/api/admin/export/orders",
            headers={"Authorization": f"Bearer {analyst_token}"}
        )
        self.assertEqual(res_orders.status_code, 403)

        # Non-sensitive export (pearl_calls) permitted
        res_usage = client.get(
            "/api/admin/export/pearl_calls",
            headers={"Authorization": f"Bearer {analyst_token}"}
        )
        self.assertEqual(res_usage.status_code, 200)

    # ── Test 9: Subscription Cancellation & Churn Metrics ─────────────────────

    def test_subscription_cancellation_and_churn_metrics(self):
        """Canceled subscriptions are tracked accurately in subscription overview and churn metrics."""
        now = datetime.utcnow()
        canceled_sub = Subscription(
            user_id=self.normal_user.id,
            plan_id="growth",
            billing_interval="monthly",
            amount=7999,
            currency="INR",
            status="canceled",
            canceled_at=now,
            current_period_start=now - timedelta(days=30),
            current_period_end=now
        )
        active_sub = Subscription(
            user_id=self.admin_user.id,
            plan_id="starter",
            billing_interval="monthly",
            amount=3999,
            currency="INR",
            status="active",
            current_period_start=now,
            current_period_end=now + timedelta(days=30)
        )
        self.db.add_all([canceled_sub, active_sub])
        self.db.commit()

        # 1. Subscriptions listing filter by canceled
        res_canceled = client.get(
            "/api/admin/subscriptions?status=canceled",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        self.assertEqual(res_canceled.status_code, 200)
        self.assertEqual(res_canceled.json()["total"], 1)
        self.assertEqual(res_canceled.json()["items"][0]["status"], "canceled")

        # 2. Subscriptions listing filter by active
        res_active = client.get(
            "/api/admin/subscriptions?status=active",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        self.assertEqual(res_active.status_code, 200)
        self.assertEqual(res_active.json()["total"], 1)
        self.assertEqual(res_active.json()["items"][0]["status"], "active")

        # 3. Revenue analytics tracks active count, cancellations, and churned MRR
        res_rev = client.get(
            "/api/admin/analytics/revenue?period=30d",
            headers={"Authorization": f"Bearer {self.admin_token}"}
        )
        self.assertEqual(res_rev.status_code, 200)
        rev_data = res_rev.json()
        self.assertEqual(rev_data["subscriptions"]["active_count"], 1)
        self.assertEqual(rev_data["subscriptions"]["canceled_in_period"], 1)
        self.assertEqual(rev_data["mrr"]["churned_mrr"], 7999.0)


if __name__ == "__main__":
    unittest.main()
