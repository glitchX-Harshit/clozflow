"""Requires the declared PyJWT dependency; validates real RSA signatures."""
import time
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

jwt = pytest.importorskip("jwt", reason="Install declared PyJWT[crypto] dependency")


@pytest.fixture
def protected_app(monkeypatch, tmp_path):
    from clozflow_brain.api.main import create_app
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_path = tmp_path / "public.pem"
    public_path.write_bytes(key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
    for name in ("SESSION", "WORLD_MODEL", "MEMORY", "CONTEXT", "KNOWLEDGE", "PERSISTENCE", "CHECKPOINT"):
        monkeypatch.setenv(f"CEB_{name}_REPOSITORY", "memory")
    monkeypatch.setenv("CEB_AUTH_MODE", "jwt")
    monkeypatch.setenv("CEB_JWT_PUBLIC_KEY_FILE", str(public_path))
    monkeypatch.setenv("CEB_JWT_ISSUER", "test-issuer")
    monkeypatch.setenv("CEB_JWT_AUDIENCE", "clozflow")
    def token(tenant, expired=False):
        now = int(time.time())
        return jwt.encode({"sub": "tester", "tenant_id": str(tenant),
            "iat": now - 100, "exp": now - 1 if expired else now + 300,
            "iss": "test-issuer", "aud": "clozflow", "scope": "brain:read brain:write"}, key, algorithm="RS256")
    with TestClient(create_app()) as client:
        yield client, token


def test_jwt_tenant_isolation_for_state_and_streams(protected_app):
    client, token = protected_app
    tenant = uuid4()
    own = {"Authorization": f"Bearer {token(tenant)}"}
    other = {"Authorization": f"Bearer {token(uuid4())}"}
    session = client.post("/v1/sessions", headers=own,
        json={"tenant_id": str(tenant), "salesperson_id": "rep"})
    assert session.status_code == 201
    sid = session.json()["session_id"]
    assert client.get(f"/v1/sessions/{sid}/wm", headers=own).status_code == 200
    assert client.get(f"/v1/sessions/{sid}/wm", headers=other).status_code == 403
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/v1/sessions/{sid}/recommendations/stream", headers=other):
            pass


def test_missing_expired_and_tampered_tokens_rejected(protected_app):
    client, token = protected_app
    tenant = uuid4()
    payload = {"tenant_id": str(tenant), "salesperson_id": "rep"}
    assert client.post("/v1/sessions", json=payload).status_code == 401
    for bad in (token(tenant, expired=True), token(tenant) + "x"):
        assert client.post("/v1/sessions", json=payload,
            headers={"Authorization": f"Bearer {bad}"}).status_code == 401
