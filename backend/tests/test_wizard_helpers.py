"""Shared setup for the Meeting Wizard test modules (no tests here).

Temp SQLite only (never ``web/backend/hexagon.db``), blank provider keys (no LLM, no network;
tests monkeypatch ``services.wizard.llm.generate_json`` and the outbound HTTP factories), and
``dotenv.load_dotenv`` stubbed so ``web/.env`` is never read even when ``main`` is imported.
"""
from __future__ import annotations

import json
import os
import sys
import uuid
from datetime import datetime, timedelta

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

_DB_PATH = (os.environ.get("CLOZFLOW_WIZARD_TEST_DB")
            or os.path.join(os.environ.get("TEMP") or os.environ.get("TMP") or "/tmp", "clozflow-wizard-tests", "wizard.db")).replace("\\", "/")
if not os.environ.get("_CLOZFLOW_WIZARD_TESTS_READY"):
    os.environ["_CLOZFLOW_WIZARD_TESTS_READY"] = "1"
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
    for suffix in ("", "-wal", "-shm"):
        try:
            os.remove(_DB_PATH + suffix)
        except OSError:
            pass
if "database" not in sys.modules:
    os.environ["DATABASE_URL"] = f"sqlite:///{_DB_PATH}"
os.environ.setdefault("JWT_SECRET_KEY", "clozflow-wizard-tests-secret")
# Blank provider keys (never a real vendor call). The bridge (VOBIZ_*) env is left alone: the bridge
# test kit configures it for the whole session and the wizard tests accept either state.
for _key in ("GEMINI_API_KEY", "GROQ_API_KEY", "DEEPGRAM_API_KEY", "SARVAM_API_KEY", "GOOGLE_CALENDAR_CLIENT_ID",
             "GOOGLE_CALENDAR_CLIENT_SECRET", "MS_GRAPH_CLIENT_ID", "MS_GRAPH_CLIENT_SECRET", "ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET"):
    os.environ[_key] = ""
os.environ["CLOZFLOW_WIZARD_ENRICH"] = "0"
os.environ["CLOZFLOW_WIZARD_RETENTION_SWEEP"] = "0"
os.environ["ALLOW_LOCALHOST_CRAWL"] = "false"

import dotenv  # noqa: E402

dotenv.load_dotenv = lambda *args, **kwargs: False   # never read web/.env in tests

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from database import Base, SessionLocal, add_missing_columns, engine  # noqa: E402
import models  # noqa: E402,F401
import models_wizard  # noqa: E402,F401
from models import CallLog, User  # noqa: E402
from routers import auth, calls, capsules, leads, relay, wizard  # noqa: E402
from routers.auth import create_access_token  # noqa: E402
from services.wizard import battlecards  # noqa: E402

Base.metadata.create_all(bind=engine)
add_missing_columns(engine)   # call_logs columns when another module created the table first

with SessionLocal() as _db:
    battlecards.seed_if_empty(_db)


def build_app() -> FastAPI:
    app = FastAPI()
    for module in (auth, calls, capsules, leads, relay, wizard):
        app.include_router(module.router)
    return app


_APP = build_app()


def client() -> TestClient:
    return TestClient(_APP)


def make_user(prefix: str = "wiz", **fields):
    with SessionLocal() as db:
        user = User(email=f"{prefix}-{uuid.uuid4().hex[:10]}@example.test", password_hash="x", **fields)
        db.add(user)
        db.commit()
        db.refresh(user)
        user_id = user.id
    token = create_access_token({"sub": str(user_id)}, expires_delta=timedelta(hours=1))
    return user_id, {"Authorization": f"Bearer {token}"}


# A speaker-labelled transcript with timing, a price objection, a buying signal and a dated next step.
CALL_DATE = datetime(2026, 11, 12, 9, 30, 0)   # a Thursday


def sample_transcript():
    base = CALL_DATE
    rows = [
        ("salesperson", "Thanks for joining Ravi, we have thirty minutes. I'd like to understand how you handle follow-ups today.", 0.0, 6.0),
        ("prospect", "Sure. Right now the team tracks enquiries in Excel and follow-ups slip when we get busy.", 7.0, 13.0),
        ("salesperson", "How many enquiries a week are we talking about, and who owns the sheet?", 14.0, 18.0),
        ("prospect", "Around forty a week. My manager owns the sheet, but honestly the final call is with our MD.", 19.0, 25.0),
        ("salesperson", "Got it. Let me show you only the follow-up workflow then.", 26.0, 29.0),
        ("prospect", "Okay. But this looks bahut expensive for a business our size.", 30.0, 34.0),
        ("salesperson", "Expensive compared to the budget you had in mind, or compared to the forty enquiries that slip?", 36.5, 41.0),
        ("prospect", "Fair point. How long does implementation take if we start?", 42.0, 45.0),
        ("salesperson", "Two hours of setup from your side. Shall we do a walkthrough with your MD on Tuesday at 11?", 46.0, 51.0),
        ("prospect", "Tuesday works. Send me the details on WhatsApp.", 52.0, 55.0),
    ]
    transcript = []
    for speaker, text, t0, t1 in rows:
        transcript.append({"speaker": speaker, "text": text, "timestamp": (base + timedelta(seconds=t0)).isoformat(),
                           "t_start": t0, "t_end": t1})
    return transcript


def sample_insights():
    return [
        {"payload": {"response": "x"}, "timestamp": CALL_DATE.isoformat(), "turn_index": 5,
         "card": {"id": "c1", "battlecard_id": "pricing", "headline": "Price pushback"}, "feedback": "used"},
        {"payload": {"response": "y"}, "timestamp": CALL_DATE.isoformat(), "turn_index": 7,
         "card": {"id": "c2", "battlecard_id": "obj-send-email", "headline": "Brush-off"}, "feedback": "down"},
        {"payload": {"response": "z"}, "timestamp": CALL_DATE.isoformat(), "turn_index": 9, "card": {"id": "c3"}},
    ]


def make_call_log(user_id: int, transcript=None, insights=None, when: datetime = CALL_DATE, **columns) -> int:
    transcript = sample_transcript() if transcript is None else transcript
    insights = sample_insights() if insights is None else insights
    with SessionLocal() as db:
        row = CallLog(user_id=user_id, transcript=json.dumps(transcript), ai_suggestions=json.dumps(insights),
                      message_count=len(transcript), insight_count=len(insights), timestamp=when)
        for key, value in columns.items():
            setattr(row, key, value)
        db.add(row)
        db.commit()
        return row.id


def make_meeting(http: TestClient, headers: dict, **body) -> dict:
    payload = {"prospect_name": "Ravi Kumar", "company": "Acme Bakery", "industry": "Retail bakery chain", "role": "Operations Manager",
               "deal_value": "₹4.5L", "objective": "Discovery: understand how enquiries are followed up", "methodology": "meddpicc",
               "platform": "meet", "prospect_phone": "98765 43210", "prospect_email": "ravi@acmebakery.in"}
    payload.update(body)
    response = http.post("/api/wizard/meetings", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def fake_llm(monkeypatch, handler):
    """Make ``services.wizard.llm`` look configured and answer with ``handler(system, user, schema, **kw)``."""
    from services.wizard import llm

    calls = []

    async def _generate(system, user, schema, **kwargs):
        calls.append({"system": system, "user": user, "schema": schema, **kwargs})
        result = handler(system, user, schema, **kwargs)
        if isinstance(result, BaseException):
            raise result
        return result

    monkeypatch.setattr(llm, "generate_json", _generate)
    monkeypatch.setattr(llm, "is_configured", lambda: True)
    monkeypatch.setattr(llm, "available_vendors", lambda: ["gemini"])
    monkeypatch.setattr(llm, "describe", lambda: {"vendor": "gemini", "model": "fake-model", "ready": True})
    return calls


# ── ICS fixtures ─────────────────────────────────────────────────────────────

def ics_fixture(now: datetime) -> str:
    """Google Meet link in DESCRIPTION, Zoom link in LOCATION, Teams via X-GOOGLE-CONFERENCE, a weekly RRULE with an
    EXDATE, an all-day event, a cancelled event, a TZID event and a folded line."""
    d1 = (now + timedelta(days=1)).replace(hour=4, minute=30, second=0, microsecond=0)
    d2 = (now + timedelta(days=2)).replace(hour=9, minute=0, second=0, microsecond=0)
    weekly_start = (now - timedelta(days=21)).replace(hour=10, minute=0, second=0, microsecond=0)
    exdate = weekly_start + timedelta(days=21)
    allday = (now + timedelta(days=3)).date()
    cancelled = (now + timedelta(days=4)).replace(hour=6, minute=0, second=0, microsecond=0)
    fmt = "%Y%m%dT%H%M%SZ"
    return "\r\n".join([
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN",
        "BEGIN:VEVENT", "UID:meet-1@example.com", f"DTSTART:{d1.strftime(fmt)}", f"DTEND:{(d1 + timedelta(minutes=45)).strftime(fmt)}",
        "SUMMARY:Discovery with Acme Bakery", "DESCRIPTION:Agenda\\, pricing and next steps.\\nJoin: https://meet.google.com/abc-defg-hij",
        "ORGANIZER;CN=Me:mailto:me@myco.in", "ATTENDEE;CN=Ravi Kumar;ROLE=REQ-PARTICIPANT:mailto:ravi@acmebakery.in",
        "ATTENDEE;CN=Me:mailto:me@myco.in", "END:VEVENT",
        "BEGIN:VEVENT", "UID:zoom-2@example.com", f"DTSTART;TZID=Asia/Kolkata:{(d2 + timedelta(hours=5, minutes=30)).strftime('%Y%m%dT%H%M%S')}",
        "DURATION:PT30M", "SUMMARY:Pricing call", "LOCATION:https://us02web.zoom.us/j/1234567890?pwd=abc", "END:VEVENT",
        "BEGIN:VEVENT", "UID:weekly-3@example.com", f"DTSTART:{weekly_start.strftime(fmt)}", f"DTEND:{(weekly_start + timedelta(minutes=30)).strftime(fmt)}",
        "RRULE:FREQ=WEEKLY;BYDAY=" + ["MO", "TU", "WE", "TH", "FR", "SA", "SU"][weekly_start.weekday()], f"EXDATE:{exdate.strftime(fmt)}",
        "SUMMARY:Weekly sync with Mehta Traders", "X-GOOGLE-CONFERENCE:https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0",
        "END:VEVENT",
        "BEGIN:VEVENT", "UID:allday-4@example.com", f"DTSTART;VALUE=DATE:{allday.strftime('%Y%m%d')}", f"DTEND;VALUE=DATE:{(allday + timedelta(days=1)).strftime('%Y%m%d')}",
        "SUMMARY:Trade fair visit", "LOCATION:Pragati Maidan\\, New Delhi", "END:VEVENT",
        "BEGIN:VEVENT", "UID:cancelled-5@example.com", f"DTSTART:{cancelled.strftime(fmt)}", f"DTEND:{(cancelled + timedelta(minutes=30)).strftime(fmt)}",
        "SUMMARY:Cancelled thing", "STATUS:CANCELLED", "END:VEVENT",
        "BEGIN:VEVENT", "UID:folded-6@example.com", f"DTSTART:{(d1 + timedelta(hours=3)).strftime(fmt)}", f"DTEND:{(d1 + timedelta(hours=3, minutes=30)).strftime(fmt)}",
        "SUMMARY:A very long summary that is folded onto the next", "  line per RFC 5545", "END:VEVENT",
        "END:VCALENDAR", "",
    ])
