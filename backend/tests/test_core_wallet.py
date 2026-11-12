"""Core wallet: rental never charges, balance maths, concurrency-safe deductions."""
import threading

import pytest
from fastapi import HTTPException

from admin.models import CreditTransaction
from database import SessionLocal
from models import User
from routers import wallet
from services.credit_service import add_credits, charge_post_call, deduct_credits, get_balance


def _transactions(user_id):
    with SessionLocal() as db:
        return db.query(CreditTransaction).filter(CreditTransaction.user_id == user_id).all()


def test_renting_a_number_never_charges(core_client, core_make_user):
    user_id, headers = core_make_user(credit_balance=500.0)
    r = core_client.post("/api/wallet/rent-phone-number", headers=headers)
    assert r.status_code == 501
    assert r.json()["detail"] == wallet.PHONE_RENTAL_UNAVAILABLE_DETAIL
    assert "not been charged" in r.json()["detail"]
    with SessionLocal() as db:
        assert get_balance(db, user_id) == 500.0
    assert _transactions(user_id) == []

    _, admin_headers = core_make_user(is_admin=True, admin_role="super_admin")
    assert core_client.post("/api/wallet/rent-phone-number", headers=admin_headers).status_code == 501


def test_balance_is_rounded_and_reports_rental_unavailable(core_client, core_make_user):
    _, headers = core_make_user(credit_balance=7.829999999999)
    body = core_client.get("/api/wallet/balance", headers=headers).json()
    assert body["credit_balance"] == 7.83
    assert body["phone_rental_available"] is False
    assert body["rates"]["phone_rental_monthly"] == 179.0


def test_transactions_are_listed_with_utc_timestamps(core_client, core_make_user):
    user_id, headers = core_make_user()
    with SessionLocal() as db:
        add_credits(db, user_id, 25, "seed", payment_method="test")
    rows = core_client.get("/api/wallet/transactions", headers=headers).json()["transactions"]
    assert len(rows) == 1 and rows[0]["amount"] == 25.0
    assert rows[0]["created_at"].endswith("Z")


def test_concurrent_deductions_never_overdraw(core_make_user):
    user_id, _ = core_make_user(credit_balance=10.0)
    results, lock = [], threading.Lock()

    def spend():
        db = SessionLocal()
        try:
            deduct_credits(db, user_id, 2.5, "parallel test")
            outcome = "ok"
        except HTTPException as exc:
            outcome = exc.status_code
        finally:
            db.close()
        with lock:
            results.append(outcome)

    threads = [threading.Thread(target=spend) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)

    assert sorted(results, key=str) == [402] * 4 + ["ok"] * 4
    with SessionLocal() as db:
        assert get_balance(db, user_id) == 0.0
    txns = _transactions(user_id)
    assert len(txns) == 4 and min(t.balance_after for t in txns) == 0.0


def test_a_stale_session_cannot_spend_credits_twice(core_make_user):
    # The old code locked the row but read the balance from an already-loaded
    # ORM object, so a second request saw the pre-deduction balance.
    user_id, _ = core_make_user(credit_balance=5.0)
    stale = SessionLocal()
    try:
        assert stale.get(User, user_id).credit_balance == 5.0  # loaded before the other spend
        with SessionLocal() as other:
            assert deduct_credits(other, user_id, 4.0, "first") == 1.0
        with pytest.raises(HTTPException) as exc:
            deduct_credits(stale, user_id, 4.0, "second")
        assert exc.value.status_code == 402
    finally:
        stale.close()
    with SessionLocal() as db:
        assert get_balance(db, user_id) == 1.0


def test_insufficient_balance_leaves_the_callers_pending_changes(core_make_user):
    # Pearl's webhook marks the call finished, then charges; a 402 must not undo its update.
    user_id, _ = core_make_user(credit_balance=1.0)
    db = SessionLocal()
    try:
        db.get(User, user_id).full_name = "Pending Update"
        with pytest.raises(HTTPException) as exc:
            deduct_credits(db, user_id, 3.0, "too expensive")
        assert exc.value.status_code == 402
        db.commit()
    finally:
        db.close()
    with SessionLocal() as db:
        row = db.get(User, user_id)
        assert (row.full_name, row.credit_balance) == ("Pending Update", 1.0)
    assert _transactions(user_id) == []


def test_add_credits_rounds_and_handles_a_null_balance(core_make_user):
    user_id, _ = core_make_user(credit_balance=None)
    with SessionLocal() as db:
        assert add_credits(db, user_id, 10.25, "first", payment_method="test") == 10.25
        assert add_credits(db, user_id, 0.1, "second", payment_method="test") == 10.35
        assert deduct_credits(db, user_id, 0.35, "spend") == 10.0


def test_superusers_are_never_blocked_or_charged(core_make_user):
    user_id, _ = core_make_user(credit_balance=0.0, is_admin=True)
    with SessionLocal() as db:
        assert deduct_credits(db, user_id, 50.0, "admin test") == 0.0
    txns = _transactions(user_id)
    assert len(txns) == 1 and txns[0].description.startswith("[Superuser Test]")


def test_topup_is_superuser_only_and_bounded(core_client, core_make_user):
    _, headers = core_make_user()
    assert core_client.post("/api/wallet/topup", json={"amount": 100}, headers=headers).status_code == 403
    _, admin = core_make_user(is_admin=True)
    assert core_client.post("/api/wallet/topup", json={"amount": 5}, headers=admin).status_code == 400
    assert core_client.post("/api/wallet/topup", json={"amount": 2_000_000}, headers=admin).status_code == 422
    r = core_client.post("/api/wallet/topup", json={"amount": 100}, headers=admin)
    assert r.status_code == 200 and r.json()["new_balance"] == 100.0


# ── post-call charging (usage that already happened) ────────────────────────

def test_post_call_charge_takes_what_is_left_and_records_the_shortfall(core_make_user):
    user_id, _ = core_make_user(credit_balance=2.5)
    with SessionLocal() as db:
        result = charge_post_call(db, user_id, 7.0, "Outbound Call #abc (140s)")
    assert result == {"charged": 2.5, "shortfall": 4.5, "balance_after": 0.0}
    (txn,) = _transactions(user_id)
    assert (txn.amount, txn.balance_after, txn.type) == (-2.5, 0.0, "consumption")
    assert txn.description.startswith("Outbound Call #abc") and "Shortfall ₹4.50 not collected" in txn.description

    with SessionLocal() as db:  # empty wallet: still recorded, never negative, no 402
        assert charge_post_call(db, user_id, 3.0, "second call") == {"charged": 0.0, "shortfall": 3.0, "balance_after": 0.0}
        assert get_balance(db, user_id) == 0.0
    assert [t.amount for t in _transactions(user_id)] == [-2.5, 0.0]


def test_post_call_charge_in_full_and_for_superusers(core_make_user):
    user_id, _ = core_make_user(credit_balance=10.0)
    with SessionLocal() as db:
        assert charge_post_call(db, user_id, 4.25, "call") == {"charged": 4.25, "shortfall": 0.0, "balance_after": 5.75}
    assert "Shortfall" not in _transactions(user_id)[0].description

    admin_id, _ = core_make_user(credit_balance=0.0, is_admin=True)
    with SessionLocal() as db:
        assert charge_post_call(db, admin_id, 9.0, "admin call")["shortfall"] == 0.0
        assert get_balance(db, admin_id) == 0.0
    assert _transactions(admin_id)[0].description.startswith("[Superuser Test]")


def test_post_call_charges_and_deductions_never_overdraw_together(core_make_user):
    user_id, _ = core_make_user(credit_balance=10.0)
    taken, lock = [], threading.Lock()

    def post_call():
        with SessionLocal() as db:
            charged = charge_post_call(db, user_id, 3.0, "post-call")["charged"]
        with lock:
            taken.append(charged)

    def pre_call():
        try:
            with SessionLocal() as db:
                deduct_credits(db, user_id, 3.0, "pre-call")
            charged = 3.0
        except HTTPException:
            charged = 0.0
        with lock:
            taken.append(charged)

    threads = [threading.Thread(target=post_call if i % 2 else pre_call) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    assert len(taken) == 8 and round(sum(taken), 2) == 10.0  # every credit taken exactly once
    with SessionLocal() as db:
        assert get_balance(db, user_id) == 0.0
    assert all(t.balance_after >= 0 for t in _transactions(user_id))


def test_bridge_billing_uses_the_post_call_path(core_make_user):
    from services.bridge import billing

    user_id, _ = core_make_user(credit_balance=2.0)
    with SessionLocal() as db:
        assert billing.charge_call(db, user_id=user_id, seconds=120, rate_per_minute=3.0, call_ref="ref1") == 2.0
    (txn,) = _transactions(user_id)
    assert txn.amount == -2.0 and "Shortfall ₹4.00" in txn.description


def test_pearl_post_call_metering_charges_a_short_wallet(core_make_user):
    from models_pearl import PearlAgent, PearlCall
    from routers.pearl import _bill_finished_call

    user_id, _ = core_make_user(credit_balance=1.0)
    with SessionLocal() as db:
        agent = PearlAgent(user_id=user_id, name="Metering test agent")
        db.add(agent)
        db.flush()
        call = PearlCall(agent_id=agent.id, provider="mock", duration_seconds=600)  # 10 min = 30 credits
        db.add(call)
        db.commit()
        _bill_finished_call(db, call)  # used to 402 internally and charge nothing
        db.refresh(call)
        assert call.revenue_billed == 30.0  # stays set, so the call is never billed twice
        assert get_balance(db, user_id) == 0.0
        _bill_finished_call(db, call)
    (txn,) = _transactions(user_id)
    assert txn.amount == -1.0 and "Shortfall ₹29.00" in txn.description
