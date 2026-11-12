"""Pytest setup for the backend.

* ``async def`` tests run on asyncio through anyio's pytest plugin (anyio ships
  with FastAPI/httpx), so pytest-asyncio is not needed.
* Before anything imports ``database``, the app is pointed at a throw-away
  SQLite file, so tests never touch ``web/backend/hexagon.db``. An explicit
  ``DATABASE_URL`` is respected unless it points at ``hexagon.db``.
* Test tokens are signed with a throw-away key, not the one in ``web/.env``.
"""
import inspect
import os
import shutil
import sys
import tempfile
from datetime import timedelta
from uuid import uuid4

import pytest

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

_LIVE_DB = os.path.normcase(os.path.realpath(os.path.join(BACKEND_DIR, "hexagon.db")))


def _is_live_db(url: str) -> bool:
    from sqlalchemy.engine import make_url

    try:
        parsed = make_url(url)
    except Exception:
        return False
    if not parsed.drivername.startswith("sqlite") or not parsed.database or parsed.database == ":memory:":
        return False
    return os.path.normcase(os.path.realpath(os.path.abspath(parsed.database))) == _LIVE_DB


_TEMP_DIR = None
if not os.environ.get("DATABASE_URL") or _is_live_db(os.environ["DATABASE_URL"]):
    _TEMP_DIR = tempfile.mkdtemp(prefix="clozflow-pytest-")
    os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(_TEMP_DIR, "test.db").replace("\\", "/")

os.environ.setdefault("JWT_SECRET_KEY", "pytest-only-signing-key-" + uuid4().hex)


# ── async tests ──────────────────────────────────────────────────────────────

def _wants_anyio(config, obj) -> bool:
    inner = obj.hypothesis.inner_test if hasattr(obj, "hypothesis") else obj
    if not inspect.iscoroutinefunction(inner):
        return False
    marks = {mark.name for mark in getattr(obj, "pytestmark", [])}
    if "anyio" in marks:
        return False  # anyio already handles it
    if "asyncio" in marks and config.pluginmanager.hasplugin("asyncio"):
        return False  # explicitly left to pytest-asyncio when that is installed
    return True


@pytest.hookimpl(tryfirst=True)
def pytest_pycollect_makeitem(collector, name, obj):
    """Mark every ``async def`` test for anyio while it is collected, and request
    ``anyio_backend`` directly so it works whatever order the plugins run in."""
    if collector.istestfunction(obj, name) and _wants_anyio(collector.config, obj):
        pytest.mark.anyio(obj)
        pytest.mark.usefixtures("anyio_backend")(obj)


def pytest_collection_modifyitems(config, items):
    # Fallback for coroutine tests created some other way: anyio's own
    # pytest_collection_finish adds the backend fixture to marked items.
    for item in items:
        function = getattr(item, "function", None)
        if function is not None and inspect.iscoroutinefunction(function) and item.get_closest_marker("anyio") is None:
            if not (item.get_closest_marker("asyncio") and config.pluginmanager.hasplugin("asyncio")):
                item.add_marker(pytest.mark.anyio)


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


def pytest_unconfigure(config):
    if _TEMP_DIR:
        database = sys.modules.get("database")
        if database is not None:
            database.engine.dispose()
        shutil.rmtree(_TEMP_DIR, ignore_errors=True)


# ── shared fixtures ──────────────────────────────────────────────────────────

@pytest.fixture(scope="session", autouse=True)
def _test_schema():
    """Create every table in the test database once."""
    import models  # noqa: F401  (registers all tables on Base.metadata)
    from database import Base, engine

    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture(scope="session")
def core_app():
    """The core routers (auth, user, wallet, calls, Brain gateway) mounted as in
    main.py, without importing main (so Pearl/voice imports can't break them)."""
    from fastapi import FastAPI
    from routers import auth, brain_local, calls, user, wallet

    app = FastAPI()
    app.include_router(brain_local.router)
    app.include_router(auth.router)
    app.include_router(auth.router, prefix="/api")
    app.include_router(calls.router)
    app.include_router(user.router)
    app.include_router(wallet.router)
    return app


@pytest.fixture
def core_client(core_app):
    """HTTP client for the app. The lifespan (VAD warm-up) is not started."""
    from fastapi.testclient import TestClient

    client = TestClient(core_app)
    yield client
    client.close()


_PASSWORD_HASH_CACHE = {}

CORE_TEST_PASSWORD = "correct-horse-battery-1"


@pytest.fixture
def core_make_user():
    """``make(**columns) -> (user_id, auth_headers)``; the default password is
    ``CORE_TEST_PASSWORD``. Pass ``session_factory=`` to create the row elsewhere."""
    from database import SessionLocal
    from models import User
    from routers.auth import create_access_token, get_password_hash

    def make(session_factory=None, **fields):
        if "password_hash" not in fields:
            if "default" not in _PASSWORD_HASH_CACHE:
                _PASSWORD_HASH_CACHE["default"] = get_password_hash(CORE_TEST_PASSWORD)
            fields["password_hash"] = _PASSWORD_HASH_CACHE["default"]
        fields.setdefault("email", f"core-{uuid4().hex[:12]}@example.com")
        db = (session_factory or SessionLocal)()
        try:
            user = User(**fields)
            db.add(user)
            db.commit()
            db.refresh(user)
            token = create_access_token({"sub": str(user.id)}, timedelta(minutes=30))
            return user.id, {"Authorization": f"Bearer {token}"}
        finally:
            db.close()

    return make
