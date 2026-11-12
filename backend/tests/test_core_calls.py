"""Core call history: transcript endpoint, tolerant parsing, reports, deletes."""
import json
from datetime import datetime
from io import BytesIO

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

import models  # noqa: F401
from database import Base, SessionLocal, get_db
from models import CallLog
from models_relay import Relay


def _call(user_id, transcript, insights, when=datetime(2026, 11, 11, 10, 0, 0), factory=SessionLocal):
    with factory() as db:
        row = CallLog(user_id=user_id, transcript=transcript, ai_suggestions=insights, timestamp=when)
        db.add(row)
        db.commit()
        return row.id


def test_transcript_endpoint_returns_normalised_json(core_client, core_make_user):
    user_id, headers = core_make_user()
    transcript = [
        {"speaker": "prospect", "text": "We use AT&T today", "timestamp": "2026-11-11T10:00:01.123456"},
        {"speaker": "rep", "text": "Got it", "timestamp": None},
        {"speaker": "prospect", "text": "   "},
    ]
    insights = [{"payload": {"confidence": 0.4, "strategy": "Probe"}, "timestamp": "2026-11-11T10:00:02"}]
    call_id = _call(user_id, json.dumps(transcript), json.dumps(insights))

    r = core_client.get(f"/calls/{call_id}/transcript", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json() == {
        "call_id": call_id,
        "timestamp": "2026-11-11T10:00:00Z",
        "transcript": [
            {"speaker": "prospect", "text": "We use AT&T today", "timestamp": "2026-11-11T10:00:01.123456Z"},
            {"speaker": "rep", "text": "Got it", "timestamp": None},
        ],
        "insights": [{"payload": {"confidence": 0.4, "strategy": "Probe"}, "timestamp": "2026-11-11T10:00:02Z",
                      "turn_index": None}],
        "message_count": 2,
        "insight_count": 1,
    }


def test_insights_pair_with_their_turn_index(core_client, core_make_user):
    user_id, headers = core_make_user()
    transcript = [
        {"speaker": "rep", "text": "Hi, thanks for joining"},
        {"speaker": "prospect", "text": "   "},              # dropped from the response
        {"speaker": "prospect", "text": "Pricing worries me"},
        {"speaker": "rep", "text": "Understood"},
    ]
    insights = [{"payload": {"confidence": 0.3, "hidden_concern": "uncertain_roi"}, "turn_index": 2}]
    call_id = _call(user_id, json.dumps(transcript), json.dumps(insights))

    body = core_client.get(f"/calls/{call_id}/transcript", headers=headers).json()
    assert body["insights"][0]["turn_index"] == 1  # index into the returned transcript list
    assert body["transcript"][1]["text"] == "Pricing worries me"

    branches = core_client.get(f"/calls/{call_id}", headers=headers).json()["details"]["opportunityBranches"]
    assert branches[0]["trigger_phrase"].startswith('"Pricing worries me')  # not the line at the same position

    legacy = [{"payload": {"confidence": 0.3}}]  # saved before turn_index existed: pair by position
    legacy_id = _call(user_id, json.dumps(transcript), json.dumps(legacy))
    legacy_branches = core_client.get(f"/calls/{legacy_id}", headers=headers).json()["details"]["opportunityBranches"]
    assert legacy_branches[0]["trigger_phrase"].startswith('"Hi, thanks for joining')


def test_transcript_endpoint_reads_legacy_plain_text(core_client, core_make_user):
    user_id, headers = core_make_user()
    call_id = _call(user_id, "Prospect: Hello there\nRep: Hi!\n\njust a note", "Ask about budget\n")
    body = core_client.get(f"/calls/{call_id}/transcript", headers=headers).json()
    assert body["transcript"] == [
        {"speaker": "prospect", "text": "Hello there", "timestamp": None},
        {"speaker": "rep", "text": "Hi!", "timestamp": None},
        {"speaker": "unknown", "text": "just a note", "timestamp": None},
    ]
    assert body["insights"] == [{"payload": {"text": "Ask about budget"}, "timestamp": None, "turn_index": None}]
    assert (body["message_count"], body["insight_count"]) == (3, 1)

    empty_id = _call(user_id, None, "")
    empty = core_client.get(f"/calls/{empty_id}/transcript", headers=headers).json()
    assert (empty["transcript"], empty["insights"], empty["message_count"]) == ([], [], 0)


def test_calls_are_owner_only(core_client, core_make_user):
    owner_id, owner = core_make_user()
    _, stranger = core_make_user()
    call_id = _call(owner_id, "[]", "[]")
    for path in (f"/calls/{call_id}", f"/calls/{call_id}/transcript", f"/calls/{call_id}/report"):
        assert core_client.get(path, headers=stranger).status_code == 404, path
        assert core_client.get(path).status_code == 401, path
    assert core_client.delete(f"/calls/{call_id}", headers=stranger).status_code == 404
    assert core_client.get("/calls/987654321/transcript", headers=owner).status_code == 404
    assert all(c["id"] != call_id for c in core_client.get("/calls/", headers=stranger).json())


def test_history_details_and_stats_survive_odd_payloads(core_client, core_make_user):
    user_id, headers = core_make_user()
    insights = [
        {"payload": {"confidence": "high", "hidden_concern": None, "quality_scores": "n/a"}},
        {"payload": {"confidence": None, "coaching_tip": 42, "strategy": None}},
        {"payload": "free text insight"},
        {"confidence": 0.3, "hidden_concern": "pricing"},  # analysis stored without a wrapper
        "plain string insight",
    ]
    transcript = [{"speaker": "prospect", "text": None}, {"speaker": None, "text": "Hello"}, "loose line"]
    call_id = _call(user_id, json.dumps(transcript), json.dumps(insights))

    history = core_client.get("/calls/", headers=headers).json()
    row = next(c for c in history if c["id"] == call_id)
    assert row["timestamp"] == "2026-11-11T10:00:00Z"
    assert (row["message_count"], row["insight_count"]) == (2, 5)

    details = core_client.get(f"/calls/{call_id}", headers=headers)
    assert details.status_code == 200, details.text
    assert details.json()["timestamp"].endswith("Z")
    assert core_client.get("/calls/stats", headers=headers).status_code == 200


def test_report_pdf_escapes_markup_and_uses_stored_insights(core_client, core_make_user):
    pypdf = pytest.importorskip("pypdf")
    user_id, headers = core_make_user()
    transcript = [{"speaker": "prospect", "text": "Our <b>R&D</b> team & AT&T <3", "timestamp": "2026-11-11T10:00:01"}]
    insights = [{"payload": {"confidence": 0.4, "strategy": "Probe <deep>", "suggested_response": "Ask & listen"},
                 "timestamp": "2026-11-11T10:00:02"}]
    call_id = _call(user_id, json.dumps(transcript), json.dumps(insights))

    r = core_client.get(f"/calls/{call_id}/report", headers=headers)
    assert r.status_code == 200, r.text  # an "&" or "<" in speech used to crash reportlab
    assert r.headers["content-type"] == "application/pdf"
    text = "".join(page.extract_text() for page in pypdf.PdfReader(BytesIO(r.content)).pages)
    assert "40% (Low)" in text  # was always 0% before (metrics read a key that is never stored)
    assert "60 / 100" in text
    assert "R&D" in text and "UTC" in text


def test_deleting_a_call_a_relay_uses_is_refused(core_client, core_make_user, core_app, tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'fk.db').as_posix()}", connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _enforce_foreign_keys(dbapi_connection, _record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(bind=engine)
    factory = sessionmaker(bind=engine, autoflush=False)

    def override():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    core_app.dependency_overrides[get_db] = override
    try:
        user_id, headers = core_make_user(session_factory=factory)
        linked_id = _call(user_id, "[]", "[]", factory=factory)
        plain_id = _call(user_id, "[]", "[]", factory=factory)
        with factory() as db:
            db.add(Relay(user_id=user_id, call_id=linked_id))
            db.commit()

        r = core_client.delete(f"/calls/{linked_id}", headers=headers)
        assert r.status_code == 409
        assert "Relay" in r.json()["detail"]
        assert core_client.delete(f"/calls/{plain_id}", headers=headers).status_code == 200
    finally:
        core_app.dependency_overrides.pop(get_db, None)
        engine.dispose()
