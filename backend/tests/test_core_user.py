"""Core user routes: profile fields, password rules, avatars, account deletion."""
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, delete, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

import models  # noqa: F401  (registers every table)
from admin.models import ActivityEvent, CreditTransaction
from database import Base, SessionLocal, get_db
from models import CallLog, SUPABASE_SYNCED_PASSWORD_HASH, User
from models_bridge import CopilotBridgeCall
from models_relay import Relay, RelayAvailabilitySlot
from routers import user as user_router

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 64


@pytest.fixture
def fk_session(core_app, tmp_path):
    """Route the app to a SQLite DB that enforces foreign keys, like Postgres does."""
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
    yield factory
    core_app.dependency_overrides.pop(get_db, None)
    engine.dispose()


@pytest.fixture
def avatar_dir(tmp_path, monkeypatch):
    target = tmp_path / "avatars"
    target.mkdir()
    monkeypatch.setattr(user_router, "AVATAR_DIR", str(target))
    return target


def test_prompt_override_is_stored_trimmed_and_returned(core_client, core_make_user):
    user_id, headers = core_make_user()
    r = core_client.patch("/api/user/update", json={"ai_override_prompt": "  Always lead with ROI.  "}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["ai_override_prompt"] == "Always lead with ROI."
    assert core_client.get("/api/user/me", headers=headers).json()["ai_override_prompt"] == "Always lead with ROI."
    with SessionLocal() as db:
        assert db.get(User, user_id).ai_override_prompt == "Always lead with ROI."

    r = core_client.patch("/api/user/update", json={"ai_tone": "consultative"}, headers=headers)
    assert r.json()["ai_override_prompt"] == "Always lead with ROI."  # untouched by other updates

    assert core_client.patch("/api/user/update", json={"ai_override_prompt": "x" * 4000}, headers=headers).status_code == 200
    too_long = core_client.patch("/api/user/update", json={"ai_override_prompt": "x" * 4001}, headers=headers)
    assert too_long.status_code == 422
    assert "4000 characters" in too_long.json()["detail"][0]["msg"]

    r = core_client.patch("/api/user/update", json={"ai_override_prompt": "   "}, headers=headers)
    assert r.json()["ai_override_prompt"] is None


def test_profile_update_handles_nulls_and_blank_usernames(core_client, core_make_user):
    taken = f"taken-{uuid4().hex[:8]}"
    core_make_user(username=taken)
    core_make_user()  # another account without a username
    _, headers = core_make_user(username=f"mine-{uuid4().hex[:8]}")

    r = core_client.patch("/api/user/update", json={"notif_call_summary": None}, headers=headers)
    assert r.status_code == 200, r.text  # used to 500: NULL in a bool response field
    assert r.json()["notif_call_summary"] is True

    r = core_client.patch("/api/user/update", json={"username": ""}, headers=headers)
    assert r.status_code == 200, r.text  # used to 409 against every user with no username
    assert r.json()["username"] is None

    assert core_client.patch("/api/user/update", json={"username": taken}, headers=headers).status_code == 409
    spaced = f"spaced-{uuid4().hex[:8]}"
    r = core_client.patch("/api/user/update", json={"username": f"  {spaced}  "}, headers=headers)
    assert r.json()["username"] == spaced


def test_profile_reports_utc_timestamps_and_auth_provider(core_client, core_make_user):
    _, headers = core_make_user()
    body = core_client.get("/api/user/me", headers=headers).json()
    assert body["created_at"].endswith("Z")
    assert body["auth_provider"] == "local"


def test_cloud_accounts_get_a_clear_password_message(core_client, core_make_user):
    _, headers = core_make_user(password_hash=SUPABASE_SYNCED_PASSWORD_HASH)
    r = core_client.post("/api/user/change-password", headers=headers,
                         json={"current_password": "anything", "new_password": "new-password-1"})
    assert r.status_code == 400
    assert r.json()["detail"] == user_router.CLOUD_PASSWORD_DETAIL
    assert "Supabase" in r.json()["detail"]
    assert core_client.get("/api/user/me", headers=headers).json()["auth_provider"] == "supabase"


def test_change_password_rules(core_client, core_make_user):
    email = f"pw-{uuid4().hex[:8]}@example.com"
    _, headers = core_make_user(email=email)

    def change(current, new):
        return core_client.post("/api/user/change-password", headers=headers,
                                json={"current_password": current, "new_password": new})

    assert change("wrong-password", "new-password-1").json()["detail"] == "Current password is incorrect"
    assert change("correct-horse-battery-1", "short").status_code == 400
    too_long = change("correct-horse-battery-1", "p" * 73)
    assert too_long.status_code == 400  # bcrypt 5 raises above 72 bytes; this used to 500
    assert change("correct-horse-battery-1", "brand-new-pass-2").status_code == 200
    login = core_client.post("/auth/login", json={"email": email, "password": "brand-new-pass-2"})
    assert login.status_code == 200


def test_avatar_upload_uses_fresh_names_and_removes_the_old_file(core_client, core_make_user, avatar_dir):
    user_id, headers = core_make_user()
    first = core_client.post("/api/user/avatar", headers=headers, files={"file": ("me.png", PNG, "image/png")})
    assert first.status_code == 200, first.text
    url1 = first.json()["profile_image"]
    assert url1.startswith(f"/static/avatars/user_{user_id}_") and url1.endswith(".png")
    assert "ai_override_prompt" in first.json()
    file1 = avatar_dir / url1.rsplit("/", 1)[1]
    assert file1.read_bytes() == PNG

    second = core_client.post("/api/user/avatar", headers=headers, files={"file": ("me.jpg", JPEG, "image/jpeg")})
    url2 = second.json()["profile_image"]
    assert url2 != url1 and url2.endswith(".jpg")
    assert not file1.exists()
    assert (avatar_dir / url2.rsplit("/", 1)[1]).exists()

    third = core_client.post("/api/user/avatar", headers=headers, files={"file": ("me.webp", WEBP, "image/webp")})
    assert third.status_code == 200 and third.json()["profile_image"].endswith(".webp")


def test_avatar_rejects_bad_files(core_client, core_make_user, avatar_dir):
    _, headers = core_make_user()

    def upload(name, data):
        return core_client.post("/api/user/avatar", headers=headers, files={"file": (name, data, "image/png")})

    assert upload("page.png", b"<html><script>alert(1)</script></html>").status_code == 400
    assert upload("anim.gif", b"GIF89a" + b"\x00" * 64).status_code == 400
    assert upload("fake.webp", b"RIFF\x00\x00\x00\x00AVI WEBP" + b"\x00" * 64).status_code == 400
    too_big = upload("big.png", PNG + b"\x00" * (5 * 1024 * 1024))
    assert too_big.status_code == 413
    assert list(avatar_dir.iterdir()) == []


def test_old_avatar_cleanup_only_touches_this_users_files(avatar_dir):
    other = avatar_dir / "user_999999_abcdef0123456789.png"
    other.write_bytes(PNG)
    outside = avatar_dir.parent / "keep.txt"
    outside.write_text("keep")
    user_router._remove_avatar_file("/static/avatars/user_999999_abcdef0123456789.png", 5)
    user_router._remove_avatar_file("/static/avatars/../keep.txt", 5)
    user_router._remove_avatar_file("https://cdn.example.com/user_5.png", 5)
    assert other.exists() and outside.exists()


def test_delete_account_succeeds_when_other_tables_reference_the_user(core_client, core_make_user, fk_session):
    email = f"delete-{uuid4().hex[:8]}@example.com"
    user_id, headers = core_make_user(session_factory=fk_session, email=email, username=f"del-{uuid4().hex[:6]}",
                                      full_name="Del Me", ai_override_prompt="secret plan")
    with fk_session() as db:
        call = CallLog(user_id=user_id, transcript="[]", ai_suggestions="[]")
        db.add(call)
        db.flush()
        relay = Relay(user_id=user_id, call_id=call.id)
        db.add(relay)
        db.flush()
        db.add(RelayAvailabilitySlot(relay_id=relay.id, date="2026-12-01", start_time="10:00", end_time="10:30"))
        db.add(CreditTransaction(user_id=user_id, amount=10.0, balance_after=10.0, type="topup"))
        db.add(ActivityEvent(user_id=user_id, event_type="login"))
        db.add(CopilotBridgeCall(id=str(uuid4()), user_id=user_id, context_id="ctx", token_hash="0" * 64,
                                 prospect_phone_e164="+919800000001", rep_phone_e164="+919800000002",
                                 call_log_id=call.id))
        db.commit()

    with fk_session() as db, pytest.raises(IntegrityError):  # what the old hard DELETE ran into
        db.execute(delete(User).where(User.id == user_id))
        db.commit()

    r = core_client.delete("/api/user/delete-account", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"message": "Account deleted"}

    with fk_session() as db:
        row = db.get(User, user_id)
        assert row.account_status == "deactivated"
        assert row.email.endswith("@deleted.invalid") and email not in row.email
        assert (row.username, row.full_name, row.ai_override_prompt) == (None, None, None)
        assert db.query(CallLog).filter(CallLog.user_id == user_id).count() == 0
        assert db.query(Relay).filter(Relay.user_id == user_id).count() == 0
        assert db.query(RelayAvailabilitySlot).count() == 0
        assert db.query(CopilotBridgeCall).filter(CopilotBridgeCall.user_id == user_id).count() == 0

    assert core_client.get("/api/user/me", headers=headers).status_code == 401
    again = core_client.post("/auth/register", json={"email": email, "password": "fresh-start-1"})
    assert again.status_code == 200, again.text
    assert again.json()["user_id"] != user_id


def test_clear_history_keeps_calls_a_relay_points_at(core_client, core_make_user, fk_session):
    user_id, headers = core_make_user(session_factory=fk_session)
    with fk_session() as db:
        linked, plain = CallLog(user_id=user_id, transcript="[]"), CallLog(user_id=user_id, transcript="[]")
        db.add_all([linked, plain])
        db.flush()
        db.add(Relay(user_id=user_id, call_id=linked.id))
        db.commit()
        linked_id = linked.id

    r = core_client.post("/api/user/clear-history", headers=headers)
    assert r.status_code == 200, r.text
    assert (r.json()["deleted"], r.json()["kept"]) == (1, 1)
    assert r.json()["message"].startswith("Call history cleared")
    with fk_session() as db:
        assert [c.id for c in db.query(CallLog).filter(CallLog.user_id == user_id)] == [linked_id]
