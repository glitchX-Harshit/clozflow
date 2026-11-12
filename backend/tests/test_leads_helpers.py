"""Shared setup for the leads / knowledge / relay test modules (no tests here).

Environment is configured BEFORE the app modules are imported: a temp SQLite
DB, a fixed JWT secret, and blank provider keys so nothing can reach a real
paid API (tests monkeypatch the provider calls they exercise).
"""

import os
import sys
import uuid
from datetime import timedelta

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

_DB_PATH = "C:/Users/ASUS/AppData/Local/Temp/claude/8559842b389ce5ac/0243e4b6-9487-4b9f-9157-b742caf3d904/scratchpad/pytest/leads.db"
if not os.environ.get("_CLOZFLOW_LEADS_TESTS_READY"):
    os.environ["_CLOZFLOW_LEADS_TESTS_READY"] = "1"
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
    for suffix in ("", "-wal", "-shm"):
        try:
            os.remove(_DB_PATH + suffix)
        except OSError:
            pass
# Forced (not setdefault): never let these tests touch a real DATABASE_URL.
# If another module already imported `database` (whole-suite run; the root
# conftest has then pointed it at a throw-away DB), leave the env alone.
if "database" not in sys.modules:
    os.environ["DATABASE_URL"] = f"sqlite:///{_DB_PATH}"
os.environ.setdefault("JWT_SECRET_KEY", "clozflow-leads-tests-secret")
for _key in ("GOOGLE_PLACES_API_KEY", "HEXAGON_RESEARCH_API_KEY", "GROQ_API_KEY"):
    os.environ[_key] = ""
os.environ["ALLOW_LOCALHOST_CRAWL"] = "false"

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from database import Base, SessionLocal, engine  # noqa: E402
import models  # noqa: E402,F401  (registers every table)
from models import User  # noqa: E402
from routers import auth, capsules, intelligence, knowledge, leads, outreach, relay  # noqa: E402
from routers.auth import create_access_token  # noqa: E402

Base.metadata.create_all(bind=engine)


def build_app() -> FastAPI:
    app = FastAPI()
    for module in (auth, leads, outreach, intelligence, knowledge, capsules, relay):
        app.include_router(module.router)
    return app


_APP = build_app()


def client() -> TestClient:
    return TestClient(_APP)


def make_user(prefix: str = "user"):
    """Creates a user; returns (user_id, auth_headers)."""
    with SessionLocal() as db:
        user = User(email=f"{prefix}-{uuid.uuid4().hex[:10]}@example.test", password_hash="x")
        db.add(user)
        db.commit()
        db.refresh(user)
        user_id = user.id
    token = create_access_token({"sub": str(user_id)}, expires_delta=timedelta(hours=1))
    return user_id, {"Authorization": f"Bearer {token}"}


def reset_limits() -> None:
    from services.usage_limits import StreamSlots, WindowRateLimiter
    for module in (leads, outreach, intelligence, knowledge, relay):
        for value in vars(module).values():
            if isinstance(value, (WindowRateLimiter, StreamSlots)):
                value.reset()


def parse_sse(text: str):
    """[(event, data_str)] for every dispatched event; comments -> ('comment', text)."""
    events = []
    for block in text.replace("\r\n", "\n").split("\n\n"):
        if not block.strip():
            continue
        event, data = None, []
        for line in block.split("\n"):
            if line.startswith(":"):
                events.append(("comment", line[1:].strip()))
            elif line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].strip())
        if data:
            events.append((event or "message", "\n".join(data)))
    return events
