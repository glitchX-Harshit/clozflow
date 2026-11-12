"""Core auth: email handling, token checks, suspended accounts, cloud sign-in sync."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import jwt

from database import SessionLocal
from models import SUPABASE_SYNCED_PASSWORD_HASH, User
from routers import auth


def _token(claims: dict, key: str = None) -> str:
    claims = {"exp": datetime.now(timezone.utc) + timedelta(hours=1), **claims}
    return jwt.encode(claims, key or auth.SECRET_KEY, algorithm="HS256")


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_register_and_login_ignore_email_case_and_spaces(core_client):
    email = f"Mixed.{uuid4().hex[:8]}@Example.COM"
    r = core_client.post("/auth/register", json={"email": f"  {email} ", "password": "s3cret-pass"})
    assert r.status_code == 200, r.text
    assert r.json()["email"] == email.lower()

    r = core_client.post("/auth/login", json={"email": email.upper(), "password": "s3cret-pass"})
    assert r.status_code == 200, r.text

    r = core_client.post("/auth/register", json={"email": email.lower(), "password": "another-pass"})
    assert r.status_code == 400
    assert r.json()["detail"] == "Email already registered"


def test_login_finds_older_mixed_case_rows(core_client, core_make_user):
    email = f"Legacy.{uuid4().hex[:8]}@Example.com"
    core_make_user(email=email)  # stored exactly as typed, like pre-normalisation rows
    r = core_client.post("/auth/login", json={"email": email.lower(), "password": "correct-horse-battery-1"})
    assert r.status_code == 200, r.text


def test_suspended_account_cannot_use_tokens_or_sign_in(core_client, core_make_user):
    email = f"suspended-{uuid4().hex[:8]}@example.com"
    user_id, headers = core_make_user(email=email)
    assert core_client.get("/auth/me", headers=headers).status_code == 200

    with SessionLocal() as db:
        db.get(User, user_id).account_status = "suspended"
        db.commit()

    r = core_client.get("/api/user/me", headers=headers)
    assert r.status_code == 401
    assert r.json()["detail"] == auth.ACCOUNT_DISABLED_DETAIL

    r = core_client.post("/auth/login", json={"email": email, "password": "correct-horse-battery-1"})
    assert r.status_code == 403
    assert r.json()["detail"] == auth.ACCOUNT_DISABLED_DETAIL

    with SessionLocal() as db:  # WebSocket handlers use this helper
        assert auth.verify_token_string(headers["Authorization"][7:], db) is None


def test_token_issued_before_the_account_existed_is_rejected(core_client, core_make_user):
    # SQLite hands a deleted account's id to the next sign-up; the old token must not follow it.
    user_id, _ = core_make_user()
    before = datetime.now(timezone.utc) - timedelta(hours=1)
    stale = _token({"sub": str(user_id), "iat": before})
    assert core_client.get("/auth/me", headers=_bearer(stale)).status_code == 401

    fresh = _token({"sub": str(user_id), "iat": datetime.now(timezone.utc)})
    assert core_client.get("/auth/me", headers=_bearer(fresh)).status_code == 200

    legacy = _token({"sub": str(user_id)})  # issued before tokens carried iat
    assert core_client.get("/auth/me", headers=_bearer(legacy)).status_code == 200


def test_malformed_subjects_are_rejected_without_errors(core_client, core_make_user):
    user_id, _ = core_make_user()
    for sub in ("abc", f"{user_id}.5", "-1", "0", "", " ", "9" * 19, str(user_id) + "x"):
        r = core_client.get("/auth/me", headers=_bearer(_token({"sub": sub})))
        assert r.status_code == 401, sub
    expired = jwt.encode({"sub": str(user_id), "exp": datetime.now(timezone.utc) - timedelta(minutes=5)},
                         auth.SECRET_KEY, algorithm="HS256")
    assert core_client.get("/auth/me", headers=_bearer(expired)).status_code == 401
    forged = _token({"sub": str(user_id)}, key="not-the-server-key-but-long-enough-for-hs256")
    assert core_client.get("/auth/me", headers=_bearer(forged)).status_code == 401


def test_bearer_scheme_is_case_insensitive(core_client, core_make_user):
    _, headers = core_make_user()
    token = headers["Authorization"][7:]
    assert core_client.get("/auth/me", headers={"Authorization": f"bearer {token}"}).status_code == 200
    assert core_client.get("/auth/me", params={"token": token}).status_code == 200
    assert core_client.get("/auth/me", headers={"Authorization": "Bearer "}).status_code == 401


def test_missing_jwt_secret_never_uses_a_published_key(monkeypatch):
    monkeypatch.delenv("JWT_SECRET_KEY", raising=False)
    monkeypatch.delenv("SECRET_KEY", raising=False)
    first, second = auth._load_secret_key(), auth._load_secret_key()
    assert first != second and len(first) >= 64
    assert "hexagon_super_secret" not in first
    monkeypatch.setenv("JWT_SECRET_KEY", "configured-key")
    assert auth._load_secret_key() == "configured-key"


def test_supabase_sign_in_creates_one_cloud_account(core_client, monkeypatch):
    monkeypatch.setattr(auth, "SUPABASE_JWT_SECRET", "supabase-test-secret-at-least-32-bytes")
    email = f"Cloud.{uuid4().hex[:8]}@Example.com"
    token = _token({"sub": str(uuid4()), "email": email, "aud": "authenticated", "role": "authenticated"},
                   key="supabase-test-secret-at-least-32-bytes")

    first = core_client.get("/api/user/me", headers=_bearer(token))
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["email"] == email.lower()
    assert body["auth_provider"] == "supabase"
    second = core_client.get("/api/user/me", headers=_bearer(token))
    assert second.json()["id"] == body["id"]

    anon = _token({"role": "anon"}, key="supabase-test-secret-at-least-32-bytes")  # public anon key: no email
    assert core_client.get("/auth/me", headers=_bearer(anon)).status_code == 401


def test_concurrent_cloud_sign_in_reuses_the_row_another_request_created(core_make_user, monkeypatch):
    email = f"race-{uuid4().hex[:8]}@example.com"
    existing_id, _ = core_make_user(email=email, password_hash=SUPABASE_SYNCED_PASSWORD_HASH)
    real_find = auth.find_user_by_email
    calls = {"n": 0}

    def find_misses_once(db, value):
        calls["n"] += 1
        return None if calls["n"] == 1 else real_find(db, value)

    monkeypatch.setattr(auth, "find_user_by_email", find_misses_once)
    with SessionLocal() as db:
        user = auth._user_from_supabase_email(email, db)  # insert hits the unique index
        assert user is not None and user.id == existing_id
