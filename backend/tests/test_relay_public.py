import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(__file__))
import test_leads_helpers as h  # noqa: E402

import pytest  # noqa: E402

import routers.relay as relay_router  # noqa: E402
from database import SessionLocal  # noqa: E402
from models import CallLog  # noqa: E402
from models_relay import Relay, RelayAvailabilitySlot, RelayQuestion  # noqa: E402
from services.usage_limits import WindowRateLimiter  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh():
    h.reset_limits()
    yield
    h.reset_limits()


def _relay(status="published"):
    """Seller + published relay with two slots and two questions (one answered)."""
    uid, headers = h.make_user("seller")
    with SessionLocal() as db:
        call = CallLog(user_id=uid, transcript="[]", ai_suggestions="[]")
        db.add(call)
        db.commit()
        relay = Relay(user_id=uid, call_id=call.id, status=status, problem_statement="Leads go cold",
                      prospect_name="Priya", prospect_email="priya@example.test", seller_name="Sam",
                      published_at=datetime.utcnow() if status != "draft" else None)
        db.add(relay)
        db.commit()
        db.add_all([
            RelayAvailabilitySlot(relay_id=relay.id, date="2026-12-01", start_time="10:00", end_time="10:30"),
            RelayAvailabilitySlot(relay_id=relay.id, date="2026-12-01", start_time="11:00", end_time="11:30"),
            RelayQuestion(relay_id=relay.id, question_text="Does it work on WhatsApp?",
                          answer_text="Yes, natively.", answered_at=datetime.utcnow()),
            RelayQuestion(relay_id=relay.id, question_text="What does it cost?"),
        ])
        db.commit()
        slots = [s.id for s in relay.slots]
        return relay.slug, relay.id, slots, headers


def test_public_page_includes_only_answered_seller_replies():
    slug, _, _, _ = _relay()
    resp = h.client().get(f"/api/relay/public/{slug}")
    assert resp.status_code == 200
    page = resp.json()["relay"]
    assert [r["answer_text"] for r in page["seller_replies"]] == ["Yes, natively."]
    assert set(page["seller_replies"][0]) == {"question_id", "question_text", "answer_text", "asked_at", "answered_at"}
    assert [q["answered"] for q in page["questions"]] == [True, False]
    assert "prospect_email" not in page and "user_id" not in page
    assert page["status"] == "opened"


def _utc_z(value):
    """True for ISO-8601 text with an explicit UTC ``Z`` (clients must not guess the zone)."""
    if not isinstance(value, str) or not value.endswith("Z"):
        return False
    return datetime.fromisoformat(value[:-1] + "+00:00").utcoffset() == timedelta(0)


def test_relay_timestamps_are_utc_with_z():
    slug, relay_id, slots, seller = _relay()
    c = h.client()
    booked = c.post(f"/api/relay/public/{slug}/book",
                    json={"slot_id": slots[0], "buyer_name": "Priya", "buyer_email": "p@example.test"})
    assert booked.status_code == 200, booked.text

    listed = next(r for r in c.get("/api/relay/", headers=seller).json() if r["id"] == relay_id)
    detail = c.get(f"/api/relay/{relay_id}", headers=seller).json()
    bookings = c.get(f"/api/relay/{relay_id}/bookings", headers=seller).json()
    page = c.get(f"/api/relay/public/{slug}").json()["relay"]

    questions = detail["questions"] + page["questions"] + page["seller_replies"]
    stamps = [listed["created_at"], listed["published_at"], detail["created_at"], detail["published_at"]]
    stamps += [b["created_at"] for b in detail["bookings"] + bookings]
    stamps += [q["asked_at"] for q in questions]
    stamps += [q["answered_at"] for q in questions if q["answer_text"]]
    assert len(stamps) == 14 and all(_utc_z(s) for s in stamps), stamps
    # Unset timestamps stay null, and the instant itself is unchanged (stored naive UTC + "Z").
    assert [q["answered_at"] for q in page["questions"] if not q["answer_text"]] == [None]
    with SessionLocal() as db:
        stored = db.query(Relay).filter(Relay.id == relay_id).one()
        assert detail["created_at"] == stored.created_at.isoformat() + "Z"
        assert detail["published_at"] == stored.published_at.isoformat() + "Z"


def test_drafts_and_malformed_slugs_are_404():
    slug, _, _, _ = _relay(status="draft")
    c = h.client()
    assert c.get(f"/api/relay/public/{slug}").status_code == 404
    assert c.post(f"/api/relay/public/{slug}/question", json={"question_text": "hi"}).status_code == 404
    assert c.post(f"/api/relay/public/{slug}/not-interested").status_code == 404
    assert c.get("/api/relay/public/bad%20slug!").status_code == 404


@pytest.mark.parametrize("path", ["question", "questions"])
def test_buyer_can_ask_on_both_paths(path):
    slug, relay_id, _, _ = _relay()
    resp = h.client().post(f"/api/relay/public/{slug}/{path}", json={"question_text": "  Any setup fee?  "})
    assert resp.status_code == 200, resp.text
    with SessionLocal() as db:
        q = db.query(RelayQuestion).filter(RelayQuestion.id == resp.json()["question_id"]).one()
        assert q.question_text == "Any setup fee?" and q.relay_id == relay_id


@pytest.mark.parametrize("text", ["", "   ", "x" * 2001])
def test_question_validation(text):
    slug, _, _, _ = _relay()
    assert h.client().post(f"/api/relay/public/{slug}/questions", json={"question_text": text}).status_code == 422


def test_seller_reply_becomes_visible_to_buyer():
    slug, relay_id, _, seller = _relay()
    c = h.client()
    qid = c.post(f"/api/relay/public/{slug}/questions", json={"question_text": "Is there a trial?"}).json()["question_id"]
    assert c.post(f"/api/relay/{relay_id}/questions/{qid}/reply", json={"answer_text": "14 days."}, headers=seller).status_code == 200
    replies = c.get(f"/api/relay/public/{slug}").json()["relay"]["seller_replies"]
    assert [r["answer_text"] for r in replies][-1] == "14 days."


def test_buyer_confirmation_uses_public_slug_endpoint():
    slug, relay_id, _, seller = _relay()
    c = h.client()
    # The seller-only endpoint stays protected.
    assert c.patch(f"/api/relay/{relay_id}", json={"buyer_confirmed": True}).status_code == 401
    ok = c.post(f"/api/relay/public/{slug}/confirm", json={"buyer_confirmed": True})
    assert ok.status_code == 200 and ok.json()["buyer_confirmed"] is True
    assert c.get(f"/api/relay/public/{slug}").json()["relay"]["buyer_confirmed"] is True
    corr = c.patch(f"/api/relay/public/{slug}/confirm", json={"buyer_confirmed": False, "buyer_corrections": "Team is 12, not 8"})
    assert corr.status_code == 200 and corr.json()["buyer_corrections"] == "Team is 12, not 8"
    detail = c.get(f"/api/relay/{relay_id}", headers=seller).json()
    assert detail["buyer_confirmed"] is False and detail["buyer_corrections"] == "Team is 12, not 8"
    assert c.post(f"/api/relay/public/{slug}/confirm", json={"buyer_confirmed": False}).status_code == 422


def test_booking_is_atomic_and_validated():
    slug, relay_id, slots, seller = _relay()
    c = h.client()
    bad = c.post(f"/api/relay/public/{slug}/book", json={"slot_id": slots[0], "buyer_name": "Priya", "buyer_email": "nope"})
    assert bad.status_code == 422
    ok = c.post(f"/api/relay/public/{slug}/book", json={"slot_id": slots[0], "buyer_name": "Priya", "buyer_email": "p@example.test"})
    assert ok.status_code == 200, ok.text
    again = c.post(f"/api/relay/public/{slug}/book", json={"slot_id": slots[0], "buyer_name": "Raj"})
    assert again.status_code == 409
    assert c.post(f"/api/relay/public/{slug}/book", json={"slot_id": 999999, "buyer_name": "Raj"}).status_code == 404
    # Re-publishing must not reset buyer progress.
    assert c.post(f"/api/relay/{relay_id}/publish", headers=seller).json()["status"] == "booked"


def test_public_write_rate_limit_per_ip(monkeypatch):
    monkeypatch.setattr(relay_router, "_public_write_limiter", WindowRateLimiter("t", 2, 60, "Too many requests."))
    slug, _, _, _ = _relay()
    c = h.client()
    assert c.post(f"/api/relay/public/{slug}/questions", json={"question_text": "a?"}).status_code == 200
    assert c.post(f"/api/relay/public/{slug}/questions", json={"question_text": "b?"}).status_code == 200
    limited = c.post(f"/api/relay/public/{slug}/questions", json={"question_text": "c?"})
    assert limited.status_code == 429 and limited.headers.get("Retry-After")


def test_seller_routes_are_owner_only():
    _, relay_id, _, _ = _relay()
    _, other = h.make_user("other")
    c = h.client()
    assert c.get(f"/api/relay/{relay_id}", headers=other).status_code == 404
    assert c.patch(f"/api/relay/{relay_id}", json={"next_step": "x"}, headers=other).status_code == 404
    assert c.delete(f"/api/relay/{relay_id}", headers=other).status_code == 404
    assert all(r["id"] != relay_id for r in c.get("/api/relay/", headers=other).json())


def test_relay_create_flags_ai_fallback_without_provider_key():
    uid, headers = h.make_user("seller")
    with SessionLocal() as db:
        call = CallLog(user_id=uid, transcript='{"not": "a list"}', ai_suggestions="garbage")
        db.add(call)
        db.commit()
        call_id = call.id
    resp = h.client().post("/api/relay/create", json={"call_id": call_id}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["ai_fallback"] is True
