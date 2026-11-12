"""
Pearl API contract tests: /deploy, auth + ownership on every user-data / money route,
cold-call dialer, call cancel, the UI call-status socket, test-session billing order,
campaign edits and agent deletion.

Runs against a throwaway SQLite DB (DATABASE_URL must point at a temp file) and never
touches the network: telephony providers are replaced by in-process fakes.
"""
import os
import pathlib
import sys
import tempfile
import uuid

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
if not os.environ.get("DATABASE_URL"):
    os.environ["DATABASE_URL"] = "sqlite:///" + (pathlib.Path(tempfile.mkdtemp()) / "pearl_tests.db").as_posix()

import database  # noqa: E402

if database.SQLALCHEMY_DATABASE_URL.replace("\\", "/").endswith("/hexagon.db"):
    raise RuntimeError("Refusing to run Pearl tests against the real hexagon.db; set DATABASE_URL to a temp file")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

import models  # noqa: E402,F401
import models_pearl  # noqa: E402,F401
import admin.models  # noqa: E402,F401
from database import Base, engine, SessionLocal  # noqa: E402
from models import User, Lead, Capsule  # noqa: E402
from models_pearl import (  # noqa: E402
    PearlAgent, PearlCall, PearlCampaign, PearlCampaignRecipient, PearlTestSession, AgentTool,
)
from routers import pearl  # noqa: E402
from routers.auth import create_access_token  # noqa: E402
from services.pearl.providers import vobiz_provider  # noqa: E402

Base.metadata.create_all(bind=engine)

app = FastAPI()
app.include_router(pearl.router)
client = TestClient(app)

_PROVIDER_ENV = (
    "VOBIZ_AUTH_ID", "VOBIZ_AUTH_SECRET", "EXOTEL_ACCOUNT_SID", "EXOTEL_API_KEY", "EXOTEL_API_TOKEN",
    "GROQ_API_KEY", "SARVAM_API_KEY", "GEMINI_API_KEY", "PEARL_PUBLIC_URL",
)


@pytest.fixture(autouse=True)
def _offline_env(monkeypatch):
    for key in _PROVIDER_ENV:
        monkeypatch.delenv(key, raising=False)


@pytest.fixture
def vobiz(monkeypatch):
    """Vobiz 'configured' with an in-process fake carrier that records dial requests."""
    monkeypatch.setenv("VOBIZ_AUTH_ID", "test-auth-id")
    monkeypatch.setenv("VOBIZ_AUTH_SECRET", "test-auth-secret")
    monkeypatch.setenv("PEARL_PUBLIC_URL", "https://pearl.example.test")
    dialed = []
    outcome = {"success": True}

    async def fake_create(self, to_number, from_number=None, custom_field=""):
        dialed.append({"to": to_number, "call_id": custom_field})
        if outcome["success"]:
            return {"success": True, "provider_call_id": f"req-{custom_field[:6]}"}
        return {"success": False, "error": "Vobiz HTTP 400: invalid destination"}

    async def fake_hangup(self, provider_call_id):
        return {"success": True}

    monkeypatch.setattr(vobiz_provider.VobizTelephonyProvider, "create_outbound_call", fake_create)
    monkeypatch.setattr(vobiz_provider.VobizTelephonyProvider, "hangup_call", fake_hangup)
    return {"dialed": dialed, "outcome": outcome}


def make_user(balance: float = 100.0):
    with SessionLocal() as s:
        user = User(email=f"pearl-{uuid.uuid4().hex[:10]}@example.test", password_hash="x", credit_balance=balance)
        s.add(user)
        s.commit()
        s.refresh(user)
        token = create_access_token({"sub": str(user.id)})
        return user.id, {"Authorization": f"Bearer {token}"}, token


def make_agent(user_id: int, **fields) -> str:
    with SessionLocal() as s:
        agent = PearlAgent(user_id=user_id, name=fields.pop("name", "Saved Agent"), status=fields.pop("status", "draft"), **fields)
        s.add(agent)
        s.commit()
        return agent.id


def make_lead(user_id: int, phone: str = "9876543210", name: str = "Direct Prospect") -> int:
    with SessionLocal() as s:
        lead = Lead(user_id=user_id, business_name=name, phone_number=phone)
        s.add(lead)
        s.commit()
        return lead.id


def make_call(agent_id: str, status: str = "initiating", **fields) -> str:
    with SessionLocal() as s:
        call = PearlCall(agent_id=agent_id, provider=fields.pop("provider", "vobiz"), status=status, **fields)
        s.add(call)
        s.commit()
        return call.id


def balance_of(user_id: int) -> float:
    with SessionLocal() as s:
        return round(float(s.get(User, user_id).credit_balance or 0.0), 2)


SAVED_VOICE = {
    "speaker": "ritu_hi_customer", "language": "Hindi", "pace": 1.2,
    "settings": {"callCutRule": "immediate_disconnect", "bargeIn": True},
    "tools_config": [{"name": "crm_lookup"}],
}


# ── POST /deploy ──────────────────────────────────────────────────────────────

def test_deploy_places_call_without_touching_saved_agents(vobiz):
    uid, hdr, _ = make_user()
    saved_id = make_agent(uid, voice_config=dict(SAVED_VOICE), system_prompt="Keep me")
    lead_id = make_lead(uid)

    res = client.post("/api/pearl/deploy", headers=hdr, json={
        "lead_id": lead_id, "objective": "Book a demo", "voice_speaker": "shubh_enhi_ads",
        "voice_language": "Auto", "voice_pace": 1.0, "voice_provider": "Sarvam Bulbul v4-flash",
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True and body["status"] == "initiating" and body["call_id"]
    assert vobiz["dialed"] == [{"to": "+919876543210", "call_id": body["call_id"]}]

    with SessionLocal() as s:
        saved = s.get(PearlAgent, saved_id)
        assert saved.voice_config == SAVED_VOICE  # the saved agent's voice/settings/tools survive
        assert saved.system_prompt == "Keep me"
        call = s.get(PearlCall, body["call_id"])
        assert call.agent_id != saved_id
        console = s.get(PearlAgent, call.agent_id)
        assert console.user_id == uid and console.provider_agent_id == pearl.CONSOLE_AGENT_MARKER
        assert console.voice_config["speaker"] == "shubh_enhi_ads"
        assert call.provider_call_id and call.conversation.objective == "Book a demo"


def test_deploy_with_explicit_agent_uses_it_unmodified(vobiz):
    uid, hdr, _ = make_user()
    saved_id = make_agent(uid, voice_config=dict(SAVED_VOICE))
    res = client.post("/api/pearl/deploy", headers=hdr, json={
        "phone_number": "+91 98765 11111", "agent_id": saved_id, "voice_speaker": "kabir_enhi_ads",
    })
    assert res.status_code == 200, res.text
    with SessionLocal() as s:
        assert s.get(PearlCall, res.json()["call_id"]).agent_id == saved_id
        assert s.get(PearlAgent, saved_id).voice_config == SAVED_VOICE


def test_deploy_redial_with_corrected_number_dials_new_number(vobiz):
    uid, hdr, _ = make_user()
    lead_id = make_lead(uid, phone="9000000001")
    res = client.post("/api/pearl/deploy", headers=hdr, json={"lead_id": lead_id, "phone_number": "9000000002"})
    assert res.status_code == 200, res.text
    assert vobiz["dialed"][-1]["to"] == "+919000000002"
    with SessionLocal() as s:
        assert s.get(Lead, lead_id).phone_number == "+919000000002"

    # Phone-only request (the documented "Deploy with code" payload) works too.
    res = client.post("/api/pearl/deploy", headers=hdr, json={"phone_number": "9000000003", "recipient_name": "Asha"})
    assert res.status_code == 200, res.text
    assert vobiz["dialed"][-1]["to"] == "+919000000003"


def test_deploy_errors_are_clear_4xx_and_never_modify_agents(vobiz, monkeypatch):
    uid, hdr, _ = make_user()
    other_uid, _, _ = make_user()
    saved_id = make_agent(uid, voice_config=dict(SAVED_VOICE))
    foreign_lead = make_lead(other_uid)
    foreign_agent = make_agent(other_uid)

    cases = [
        ({}, 400, "lead_id or phone_number"),
        ({"lead_id": foreign_lead}, 404, "Lead not found"),
        ({"phone_number": "9876543210", "agent_id": foreign_agent}, 404, "Agent not found"),
        ({"phone_number": "12345"}, 400, "Invalid phone number"),
        ({"phone_number": "9876543210", "call_provider": "twilio"}, 400, "Unsupported call_provider"),
        ({"phone_number": "9876543210", "capsule_id": 987654}, 404, "Capsule not found"),
    ]
    for payload, code, detail in cases:
        res = client.post("/api/pearl/deploy", headers=hdr, json=payload)
        assert res.status_code == code, (payload, res.text)
        assert detail in res.json()["detail"]

    poor_uid, poor_hdr, _ = make_user(balance=0.0)
    res = client.post("/api/pearl/deploy", headers=poor_hdr, json={"phone_number": "9876543210"})
    assert res.status_code == 402 and "Insufficient credits" in res.json()["detail"]

    vobiz["outcome"]["success"] = False
    res = client.post("/api/pearl/deploy", headers=hdr, json={"phone_number": "9876543210"})
    assert res.status_code == 502 and "Telephony provider failed" in res.json()["detail"]

    monkeypatch.delenv("VOBIZ_AUTH_ID")
    res = client.post("/api/pearl/deploy", headers=hdr, json={"phone_number": "9876543210"})
    assert res.status_code == 503 and "VOBIZ_AUTH_ID" in res.json()["detail"]

    with SessionLocal() as s:
        assert s.get(PearlAgent, saved_id).voice_config == SAVED_VOICE


# ── Auth & ownership ──────────────────────────────────────────────────────────

PROTECTED = [
    ("post", "/api/pearl/deploy", {"phone_number": "9876543210"}),
    ("get", "/api/pearl/calls/some-call", None),
    ("post", "/api/pearl/calls/some-call/cancel", None),
    ("post", "/api/pearl/agents/draft/calls", {"phone_number": "9876543210"}),
    ("post", "/api/pearl/sage/chat", {"query": "hi"}),
    ("post", "/api/pearl/sage/feedback", {"notes": "x"}),
    ("get", "/api/pearl/agents/a1/tools", None),
    ("post", "/api/pearl/agents/a1/tools", {"name": "t", "tool_type": "mock_api"}),
    ("get", "/api/pearl/agents/a1/tools/t1", None),
    ("put", "/api/pearl/agents/a1/tools/t1", {"name": "t"}),
    ("patch", "/api/pearl/agents/a1/tools/t1", {"is_active": False}),
    ("delete", "/api/pearl/agents/a1/tools/t1", None),
    ("post", "/api/pearl/tools/test", {"tool_type": "mock_api"}),
    ("post", "/api/pearl/agents/a1/tools/test", {"tool_type": "mock_api"}),
    ("post", "/api/pearl/tools/parse-curl", {"curl_command": "curl https://example.com"}),
    ("post", "/api/pearl/agents/a1/tools/parse-curl", {"curl_command": "curl https://example.com"}),
    ("get", "/api/pearl/agents/a1/events", None),
    ("get", "/api/pearl/agents/a1/calls", None),
    ("get", "/api/pearl/agents/a1/stream", None),
    ("get", "/api/pearl/campaigns", None),
    ("post", "/api/pearl/test-sessions", {"agent_id": "a1"}),
    ("post", "/api/pearl/preview_voice", {"speaker": "shubh_enhi_ads"}),
]


@pytest.mark.parametrize("method,path,body", PROTECTED)
def test_routes_require_login(method, path, body):
    kwargs = {"json": body} if body is not None else {}
    res = getattr(client, method)(path, **kwargs)
    assert res.status_code == 401, (path, res.status_code, res.text)


def test_other_users_resources_are_404():
    owner_uid, owner_hdr, _ = make_user()
    intruder_uid, intruder_hdr, _ = make_user()
    agent_id = make_agent(owner_uid)
    call_id = make_call(agent_id)
    with SessionLocal() as s:
        tool = AgentTool(agent_id=agent_id, name="lookup", tool_type="mock_api", config={})
        s.add(tool)
        camp = PearlCampaign(user_id=owner_uid, agent_id=agent_id, name="Owner campaign")
        s.add(camp)
        sess = PearlTestSession(user_id=owner_uid, agent_id=agent_id, mode="chat", status="active", agent_snapshot={})
        s.add(sess)
        s.commit()
        tool_id, camp_id, sess_id = tool.id, camp.id, sess.id

    checks = [
        ("get", f"/api/pearl/calls/{call_id}", None),
        ("post", f"/api/pearl/calls/{call_id}/cancel", None),
        ("get", f"/api/pearl/agents/{agent_id}/tools", None),
        ("post", f"/api/pearl/agents/{agent_id}/tools", {"name": "evil", "tool_type": "mock_api"}),
        ("get", f"/api/pearl/agents/{agent_id}/tools/{tool_id}", None),
        ("put", f"/api/pearl/agents/{agent_id}/tools/{tool_id}", {"name": "pwned"}),
        ("patch", f"/api/pearl/agents/{agent_id}/tools/{tool_id}", {"is_active": False}),
        ("delete", f"/api/pearl/agents/{agent_id}/tools/{tool_id}", None),
        ("post", f"/api/pearl/agents/{agent_id}/tools/test", {"tool_type": "mock_api"}),
        ("post", f"/api/pearl/agents/{agent_id}/calls", {"phone_number": "9876543210"}),
        ("get", f"/api/pearl/agents/{agent_id}/events", None),
        ("get", f"/api/pearl/agents/{agent_id}/calls", None),
        ("get", f"/api/pearl/campaigns/{camp_id}", None),
        ("patch", f"/api/pearl/campaigns/{camp_id}", {"name": "pwned"}),
        ("get", f"/api/pearl/test-sessions/{sess_id}", None),
        ("post", "/api/pearl/test-sessions", {"agent_id": agent_id, "mode": "chat"}),
    ]
    start_balance = balance_of(intruder_uid)
    for method, path, body in checks:
        kwargs = {"json": body} if body is not None else {}
        res = getattr(client, method)(path, headers=intruder_hdr, **kwargs)
        assert res.status_code == 404, (method, path, res.status_code, res.text)
    assert balance_of(intruder_uid) == start_balance  # nothing was charged

    with SessionLocal() as s:
        assert s.get(AgentTool, tool_id).name == "lookup"
        assert s.get(PearlCall, call_id).status == "initiating"
        assert s.get(PearlCampaign, camp_id).name == "Owner campaign"

    # The owner still has full access.
    assert client.get(f"/api/pearl/calls/{call_id}", headers=owner_hdr).status_code == 200
    assert client.get(f"/api/pearl/agents/{agent_id}/tools/{tool_id}", headers=owner_hdr).status_code == 200
    res = client.post("/api/pearl/agents/test_sandbox/tools/test", headers=owner_hdr,
                      json={"tool_type": "data_validator", "config": {"preset": "pincode"}, "test_input": {"value": "560034"}})
    assert res.status_code == 200, res.text


# ── Cold-call dialer, cancel ──────────────────────────────────────────────────

def test_cold_call_draft_never_overwrites_saved_draft_agent():
    uid, hdr, _ = make_user()
    saved_draft = make_agent(uid, name="My real draft", system_prompt="original", status="draft")
    res = client.post("/api/pearl/agents/draft/calls", headers=hdr, json={
        "phone_number": "9876543210", "call_provider": "vobiz",
        "agent_snapshot": {"name": "Unsaved", "system_prompt": "snapshot prompt", "voice_config": {"speaker": "kabir_enhi_ads"}},
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "initiating" and body["provider_call_id"].startswith("sim-")  # no credentials: simulated
    with SessionLocal() as s:
        real = s.get(PearlAgent, saved_draft)
        assert (real.name, real.system_prompt) == ("My real draft", "original")
        scratch = s.get(PearlAgent, s.get(PearlCall, body["call_id"]).agent_id)
        assert scratch.provider_agent_id == pearl.DRAFT_DIALER_AGENT_MARKER and scratch.system_prompt == "snapshot prompt"


def test_cancel_call_and_finished_call(vobiz):
    uid, hdr, _ = make_user()
    agent_id = make_agent(uid)
    call_id = make_call(agent_id, status="ringing", provider_call_id="req-123")
    with SessionLocal() as s:
        camp = PearlCampaign(user_id=uid, agent_id=agent_id, name="c")
        s.add(camp)
        s.flush()
        s.add(PearlCampaignRecipient(campaign_id=camp.id, phone_number="9876543210", normalized_phone="+919876543210",
                                     status="calling", call_id=call_id))
        s.commit()
    res = client.post(f"/api/pearl/calls/{call_id}/cancel", headers=hdr)
    assert res.status_code == 200 and res.json()["status"] == "cancelled"
    with SessionLocal() as s:
        rec = s.query(PearlCampaignRecipient).filter_by(call_id=call_id).one()
        assert (rec.status, rec.outcome) == ("failed", "cancelled")
    res = client.post(f"/api/pearl/calls/{call_id}/cancel", headers=hdr)
    assert res.status_code == 400 and "already finished" in res.json()["detail"]


# ── UI call-status socket ─────────────────────────────────────────────────────

def test_call_status_socket_requires_owner_token():
    uid, _, token = make_user()
    _, _, other_token = make_user()
    agent_id = make_agent(uid)
    call_id = make_call(agent_id, status="completed")

    for url in (f"/api/pearl/calls/{call_id}/stream", f"/api/pearl/calls/{call_id}/stream?token={other_token}"):
        with pytest.raises(WebSocketDisconnect) as exc:
            with client.websocket_connect(url) as ws:
                ws.receive_json()
        assert exc.value.code == 1008

    with client.websocket_connect(f"/api/pearl/calls/{call_id}/stream?token={token}") as ws:
        msg = ws.receive_json()
        assert msg == {"type": "call.status", "data": {"status": "completed", "outcome": None, "duration": 0}}
        with pytest.raises(WebSocketDisconnect):  # terminal status: the server closes the stream
            ws.receive_json()


# ── Test sessions, campaigns, agents ──────────────────────────────────────────

def test_test_session_validates_before_charging():
    uid, hdr, _ = make_user(balance=10.0)
    agent_id = make_agent(uid)
    assert client.post("/api/pearl/test-sessions", headers=hdr, json={"agent_id": "missing", "mode": "chat"}).status_code == 404
    assert client.post("/api/pearl/test-sessions", headers=hdr, json={"agent_id": agent_id, "mode": "video"}).status_code == 400
    assert balance_of(uid) == 10.0
    res = client.post("/api/pearl/test-sessions", headers=hdr, json={"agent_id": agent_id, "mode": "voice"})
    assert res.status_code == 200, res.text
    assert balance_of(uid) == 8.0


def test_campaign_patch_guards_agent_and_status():
    uid, hdr, _ = make_user()
    other_uid, _, _ = make_user()
    own_agent, foreign_agent = make_agent(uid), make_agent(other_uid)
    camp = client.post("/api/pearl/campaigns", headers=hdr, json={"name": "Q4", "agent_id": own_agent}).json()

    res = client.patch(f"/api/pearl/campaigns/{camp['id']}", headers=hdr, json={"agent_id": foreign_agent})
    assert res.status_code == 404
    res = client.patch(f"/api/pearl/campaigns/{camp['id']}", headers=hdr, json={"status": "running"})
    assert res.status_code == 400 and "launch" in res.json()["detail"]
    with SessionLocal() as s:
        s.get(PearlCampaign, camp["id"]).status = "running"
        s.commit()
    res = client.patch(f"/api/pearl/campaigns/{camp['id']}", headers=hdr, json={"objective": "changed"})
    assert res.status_code == 400 and "running" in res.json()["detail"]
    res = client.patch(f"/api/pearl/campaigns/{camp['id']}", headers=hdr, json={"status": "paused"})
    assert res.status_code == 200 and res.json()["status"] == "paused"


def test_manual_recipient_duplicate_phone_is_excluded():
    uid, hdr, _ = make_user()
    camp = client.post("/api/pearl/campaigns", headers=hdr, json={"name": "dupes"}).json()
    first = client.post(f"/api/pearl/campaigns/{camp['id']}/add-manual-recipient", headers=hdr, json={"phone_number": "9876543210"})
    second = client.post(f"/api/pearl/campaigns/{camp['id']}/add-manual-recipient", headers=hdr, json={"phone_number": "+91 98765 43210"})
    assert first.json()["recipient"]["status"] == "valid"
    assert second.json()["recipient"]["status"] == "excluded" and second.json()["eligible_count"] == 1


def test_delete_agent_referenced_by_campaign_and_test_session():
    uid, hdr, _ = make_user()
    agent_id = make_agent(uid)
    call_id = make_call(agent_id, status="completed")
    with SessionLocal() as s:
        camp = PearlCampaign(user_id=uid, agent_id=agent_id, name="uses agent")
        s.add(camp)
        s.flush()
        s.add(PearlCampaignRecipient(campaign_id=camp.id, phone_number="1", call_id=call_id, status="completed"))
        s.add(PearlTestSession(user_id=uid, agent_id=agent_id, mode="chat", agent_snapshot={}))
        s.commit()
        camp_id = camp.id
    res = client.delete(f"/api/pearl/agents/{agent_id}", headers=hdr)
    assert res.status_code == 200, res.text
    with SessionLocal() as s:
        assert s.get(PearlAgent, agent_id) is None
        assert s.get(PearlCampaign, camp_id).agent_id is None
        assert s.query(PearlTestSession).filter_by(agent_id=agent_id).count() == 0
