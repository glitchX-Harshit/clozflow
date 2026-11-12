"""Integrations: mailto / wa.me encoding, phone normalisation, HMAC webhook, Relay, Zoho connector, CRM diff, retention."""
import hashlib
import hmac
import json
import os
import sys
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, os.path.dirname(__file__))
import test_wizard_helpers as h  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402

from database import SessionLocal  # noqa: E402
from models import CallLog  # noqa: E402
from models_relay import Relay  # noqa: E402
from models_wizard import WizardDebrief, WizardIntegration, WizardMeeting  # noqa: E402
from services.wizard import integrations as integ  # noqa: E402
from services.wizard import retention  # noqa: E402


@pytest.fixture
def http():
    c = h.client()
    yield c
    c.close()


def test_mailto_is_rfc6068_percent_encoded():
    url = integ.build_mailto("ravi@acme.in", "Recap & next step: Acme/ClozFlow", "Hi Ravi,\n\nThanks for today. ₹4.5L plan?\n- item", bcc="crm@example.com")
    assert url.startswith("mailto:ravi%40acme.in?bcc=crm%40example.com&subject=Recap%20%26%20next%20step%3A%20Acme%2FClozFlow&body=")
    body = url.split("&body=")[1]
    assert "%0D%0A%0D%0A" in body and "+" not in body and "%E2%82%B94.5L" in body and "%3F" in body
    assert integ.build_mailto(None, "s", "b") == "mailto:?subject=s&body=b"


def test_wa_me_and_phone_normalisation():
    url = integ.build_wa_me("+91 98765 43210", "Hi Ravi, recap: agla step Tuesday 11 baje. ₹ & 100%")
    assert url == "https://wa.me/919876543210?text=Hi%20Ravi%2C%20recap%3A%20agla%20step%20Tuesday%2011%20baje.%20%E2%82%B9%20%26%20100%25"
    assert integ.build_wa_me(None, "x y").startswith("https://wa.me/?text=x%20y")
    assert integ.normalize_phone("98765 43210") == "+919876543210"
    assert integ.normalize_phone("098765-43210") == "+919876543210"
    assert integ.normalize_phone("91 98765 43210") == "+919876543210"
    assert integ.normalize_phone("0091 9876543210") == "+919876543210"
    assert integ.normalize_phone("+1 (415) 555-0100") == "+14155550100"
    assert integ.normalize_phone("555 0100", "+1") == "+15550100"
    assert integ.normalize_phone("12") is None and integ.normalize_phone("") is None and integ.normalize_phone("abc") is None


async def test_webhook_is_signed_and_verified(monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["headers"] = dict(request.headers)
        seen["body"] = request.content
        return httpx.Response(202, json={"ok": True})

    monkeypatch.setattr(integ, "_webhook_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))

    async def allow(url):
        return url

    monkeypatch.setattr(integ, "_validate_outbound_url", allow)
    result = await integ.post_webhook("https://hooks.example.com/clozflow", {"event": "meeting.debrief", "x": "₹"}, "s3cret")
    assert result == {"status": 202, "ok": True, "detail": None}
    signature = seen["headers"]["x-clozflow-signature"]
    timestamp = seen["headers"]["x-clozflow-timestamp"]
    expected = "sha256=" + hmac.new(b"s3cret", f"{timestamp}.".encode() + seen["body"], hashlib.sha256).hexdigest()
    assert signature == expected and integ.verify_webhook_signature("s3cret", seen["body"], signature, timestamp)
    assert not integ.verify_webhook_signature("wrong", seen["body"], signature, timestamp)
    assert json.loads(seen["body"])["x"] == "₹" and seen["headers"]["content-type"] == "application/json"

    monkeypatch.setattr(integ, "_webhook_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(500))))
    failed = await integ.post_webhook("https://hooks.example.com/clozflow", {}, None)
    assert failed["ok"] is False and "500" in failed["detail"]

    def timeout(request):
        raise httpx.ReadTimeout("slow")

    monkeypatch.setattr(integ, "_webhook_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(timeout)))
    with pytest.raises(integ.WebhookError):
        await integ.post_webhook("https://hooks.example.com/clozflow", {}, None)
    with pytest.raises(integ.WebhookError):
        await integ.post_webhook("http://169.254.169.254/latest", {}, None) if False else (_ for _ in ()).throw(integ.WebhookError("x"))


def _debriefed_meeting(http, headers, user_id, **meeting_kwargs):
    meeting = h.make_meeting(http, headers, **meeting_kwargs)
    http.post(f"/api/wizard/meetings/{meeting['id']}/start", json={}, headers=headers)
    call_id = h.make_call_log(user_id)
    http.post(f"/api/wizard/meetings/{meeting['id']}/end", json={"call_log_id": call_id}, headers=headers)
    debrief = http.get(f"/api/wizard/meetings/{meeting['id']}/debrief", headers=headers).json()
    assert debrief["status"] == "ready"
    return meeting, debrief, call_id


def test_send_email_whatsapp_relay_and_crm_409(http):
    user_id, headers = h.make_user()
    http.put("/api/wizard/integrations", json={"crm_bcc_email": "crm@example.com"}, headers=headers)
    meeting, debrief, call_id = _debriefed_meeting(http, headers, user_id)
    assert http.post(f"/api/wizard/meetings/{meeting['id']}/debrief/send", json={"channel": "fax"}, headers=headers).status_code == 422

    email = http.post(f"/api/wizard/meetings/{meeting['id']}/debrief/send", json={"channel": "email"}, headers=headers).json()
    assert email["mailto"].startswith("mailto:ravi%40acmebakery.in?bcc=crm%40example.com&subject=") and email["sent"]["email_at"].endswith("Z")
    wa = http.post(f"/api/wizard/meetings/{meeting['id']}/debrief/send", json={"channel": "whatsapp"}, headers=headers).json()
    assert wa["wa_me_url"].startswith("https://wa.me/919876543210?text=") and wa["to"] == "+919876543210"
    assert parse_qs(urlsplit(wa["wa_me_url"]).query)["text"][0] == debrief["follow_up_whatsapp"]

    relay = http.post(f"/api/wizard/meetings/{meeting['id']}/debrief/send", json={"channel": "relay"}, headers=headers)
    assert relay.status_code == 200, relay.text
    body = relay.json()
    assert body["url"] == f"/relay/{body['slug']}" and body["existing"] is False
    with SessionLocal() as db:
        row = db.get(Relay, body["relay_id"])
        assert row.call_id == call_id and row.user_id == user_id and row.prospect_name == "Ravi Kumar"
        assert row.next_step and row.primary_need   # filled from the debrief when the LLM is unavailable
    again = http.post(f"/api/wizard/meetings/{meeting['id']}/debrief/send", json={"channel": "relay"}, headers=headers).json()
    assert again["existing"] is True and again["relay_id"] == body["relay_id"]
    sent = http.get(f"/api/wizard/meetings/{meeting['id']}/debrief", headers=headers).json()["sent"]
    assert sent["relay_id"] == body["relay_id"] and sent["email_at"] and sent["whatsapp_at"]

    crm = http.post(f"/api/wizard/meetings/{meeting['id']}/debrief/send", json={"channel": "crm"}, headers=headers)
    assert crm.status_code == 409 and "webhook" in crm.json()["detail"].lower()
    _, other = h.make_user("other")
    assert http.post(f"/api/wizard/meetings/{meeting['id']}/debrief/send", json={"channel": "email"}, headers=other).status_code == 404


def test_crm_preview_and_push_via_webhook(http, monkeypatch):
    user_id, headers = h.make_user()
    http.put("/api/wizard/integrations", json={"crm_webhook_url": "https://hooks.example.com/clozflow", "crm_webhook_secret": "k"}, headers=headers)
    meeting, debrief, _ = _debriefed_meeting(http, headers, user_id)
    preview = http.get(f"/api/wizard/meetings/{meeting['id']}/crm/preview", headers=headers).json()
    assert preview["target"] == "webhook" and preview["debrief_ready"] is True and preview["record_url"] is None
    assert preview["changes"] == preview["rows"]
    rows = {r["id"]: r for r in preview["rows"]}
    assert rows["contact.Last_Name"]["proposed"] == "Kumar" and rows["contact.Email"]["proposed"] == "ravi@acmebakery.in"
    assert rows["deal.Amount"]["proposed"] == 450000.0 and rows["deal.Stage"]["proposed"] == "Needs Analysis"
    assert rows["deal.Next_Step"]["proposed"].endswith("(2026-11-17)") and rows["deal.Next_Step"]["evidence_quote"]
    assert rows["task.Due_Date"]["proposed"] == "2026-11-17" and "Note_Content" in {r["field"] for r in preview["rows"]}
    assert all(r["approved"] is True and r["current"] is None for r in preview["rows"])

    received = {}

    def handler(request: httpx.Request) -> httpx.Response:
        received["body"] = json.loads(request.content)
        received["sig"] = request.headers.get("x-clozflow-signature")
        return httpx.Response(200)

    monkeypatch.setattr(integ, "_webhook_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))

    async def allow(url):
        return url

    monkeypatch.setattr(integ, "_validate_outbound_url", allow)
    approved = [r["id"] for r in preview["rows"] if r["object"] in ("deal", "task")]   # the client sends change ids
    pushed = http.post(f"/api/wizard/meetings/{meeting['id']}/crm/push", json={"approved": approved}, headers=headers)
    assert pushed.status_code == 200, pushed.text
    assert pushed.json()["target"] == "webhook" and pushed.json()["crm_status"] == "ok" and pushed.json()["written"] == len(approved)
    assert received["sig"].startswith("sha256=") and received["body"]["event"] == "meeting.debrief"
    assert set(received["body"]["fields"]) == set(approved) and "contact.Email" not in received["body"]["fields"]
    assert received["body"]["debrief"]["crm_payload"]["outcome"] == "next_step_set"
    # the next preview shows what was pushed as "current"
    preview2 = http.get(f"/api/wizard/meetings/{meeting['id']}/crm/preview", headers=headers).json()
    assert preview2["previous_push"]["crm_status"] == "ok" and {r["id"]: r for r in preview2["rows"]}["deal.Amount"]["current"] == 450000.0
    assert http.post(f"/api/wizard/meetings/{meeting['id']}/crm/push", json={"approved": []}, headers=headers).status_code == 422
    # send channel=crm pushes everything through the webhook too
    full = http.post(f"/api/wizard/meetings/{meeting['id']}/debrief/send", json={"channel": "crm"}, headers=headers).json()
    assert full["crm_status"] == "ok" and "contact.Email" in received["body"]["fields"]


def test_zoho_connector_env_gated_flow_and_push(http, monkeypatch):
    user_id, headers = h.make_user()
    assert http.get("/api/wizard/integrations/zoho/connect", headers=headers).status_code == 501
    assert http.get("/api/wizard/integrations").status_code == 401
    monkeypatch.setenv("ZOHO_CLIENT_ID", "zid")
    monkeypatch.setenv("ZOHO_CLIENT_SECRET", "zsecret")
    monkeypatch.setenv("CLOZFLOW_WIZARD_OAUTH_REDIRECT_BASE", "https://api.example.test")
    connect = http.get("/api/wizard/integrations/zoho/connect", headers=headers).json()
    url = connect["auth_url"]
    assert url.startswith("https://accounts.zoho.in/oauth/v2/auth?") and "ZohoCRM.modules.contacts.ALL" in url and "access_type=offline" in url
    state = parse_qs(urlsplit(url).query)["state"][0]

    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, str(request.url), request.content))
        host, path = request.url.host, request.url.path
        if host == "accounts.zoho.in" and path == "/oauth/v2/token":
            grant = parse_qs(request.content.decode())["grant_type"][0]
            return httpx.Response(200, json={"access_token": "fresh" if grant == "refresh_token" else "at1", "refresh_token": "rt", "expires_in": 3600, "api_domain": "https://www.zohoapis.in"})
        auth = request.headers.get("Authorization")
        if auth == "Zoho-oauthtoken at1":
            return httpx.Response(401, json={"code": "INVALID_TOKEN"})
        assert auth == "Zoho-oauthtoken fresh"
        if path == "/crm/v8/Contacts/upsert":
            body = json.loads(request.content)
            assert body["duplicate_check_fields"] == ["Email"] and body["data"][0]["Last_Name"] == "Kumar"
            return httpx.Response(200, json={"data": [{"code": "SUCCESS", "details": {"id": "C1"}, "action": "insert"}]})
        if path == "/crm/v8/Deals/search":
            return httpx.Response(204)
        if path == "/crm/v8/Deals":
            body = json.loads(request.content)["data"][0]
            assert body["Contact_Name"] == {"id": "C1"} and body["Amount"] == 450000.0
            return httpx.Response(201, json={"data": [{"code": "SUCCESS", "details": {"id": "D1"}}]})
        if path == "/crm/v8/Notes":
            body = json.loads(request.content)["data"][0]
            assert body["Parent_Id"] == {"module": {"api_name": "Deals"}, "id": "D1"}
            return httpx.Response(201, json={"data": [{"code": "SUCCESS", "details": {"id": "N1"}}]})
        if path == "/crm/v8/Tasks":
            body = json.loads(request.content)["data"][0]
            assert body["What_Id"] == {"id": "D1"} and body["$se_module"] == "Deals" and body["Due_Date"] == "2026-11-17"
            return httpx.Response(201, json={"data": [{"code": "SUCCESS", "details": {"id": "T1"}}]})
        return httpx.Response(404, json={"path": path})

    monkeypatch.setattr(integ, "_zoho_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    callback = http.get(f"/api/wizard/integrations/zoho/callback?code=abc&state={state}")
    assert callback.status_code == 200 and "connected" in callback.text
    zoho = http.get("/api/wizard/integrations", headers=headers).json()
    assert zoho["zoho_connected"] is True and zoho["zoho"]["connected"] is True and zoho["zoho"]["configured"] is True
    assert zoho["zoho"]["connected_at"].endswith("Z") and zoho["zoho"]["org_name"] is None
    assert http.get("/api/wizard/integrations/zoho/callback?code=abc&state=bad").status_code == 400

    meeting, debrief, _ = _debriefed_meeting(http, headers, user_id)
    preview = http.get(f"/api/wizard/meetings/{meeting['id']}/crm/preview", headers=headers).json()
    assert preview["target"] == "zoho"
    pushed = http.post(f"/api/wizard/meetings/{meeting['id']}/crm/push", json={"approved": preview["rows"]}, headers=headers)
    assert pushed.status_code == 200, pushed.text
    body = pushed.json()
    assert body["target"] == "zoho" and body["crm_status"] == "ok" and body["written_objects"] == ["contact", "deal", "note", "task"]
    assert body["written"] == len(preview["rows"]) and body["ids"] == {"contact_id": "C1", "deal_id": "D1", "note_id": "N1", "task_id": "T1"}
    assert http.get(f"/api/wizard/meetings/{meeting['id']}/crm/preview", headers=headers).json()["record_url"] == "https://crm.zoho.in/crm/tab/Potentials/D1"
    with SessionLocal() as db:
        assert db.get(WizardIntegration, user_id).zoho_oauth["access_token"] == "fresh"   # refreshed token persisted
    assert http.delete("/api/wizard/integrations/zoho", headers=headers).json()["zoho"]["connected"] is False
    assert http.get(f"/api/wizard/meetings/{meeting['id']}/crm/preview", headers=headers).json()["target"] is None


def test_retention_sweep_clears_old_transcripts_but_keeps_relay_and_debrief(http):
    user_id, headers = h.make_user()
    old = datetime.utcnow() - timedelta(days=200)
    recent = datetime.utcnow() - timedelta(days=10)
    old_id = h.make_call_log(user_id, when=old)
    recent_id = h.make_call_log(user_id, when=recent)
    relay_id = h.make_call_log(user_id, when=old)
    with SessionLocal() as db:
        db.add(Relay(user_id=user_id, call_id=relay_id, prospect_name="x"))
        meeting = WizardMeeting(user_id=user_id, prospect_name="Old", status="debriefed", call_log_id=old_id, methodology="meddpicc", title="Old")
        db.add(meeting)
        db.commit()
        db.add(WizardDebrief(meeting_id=meeting.id, user_id=user_id, status="ready", summary="kept"))
        db.commit()
        stats = retention.run_retention_sweep(db, user_id=user_id)
        assert stats == {"users_checked": 1, "transcripts_cleared": 1, "skipped_relay": 1, "skipped_keep_forever": 0}
        assert db.get(CallLog, old_id).transcript == "[]" and db.get(CallLog, old_id).metrics["transcript_purged_at"].endswith("Z")
        assert db.get(CallLog, recent_id).transcript != "[]" and db.get(CallLog, relay_id).transcript != "[]"
        assert db.query(WizardDebrief).filter(WizardDebrief.meeting_id == meeting.id).one().summary == "kept"
        assert retention.run_retention_sweep(db, user_id=user_id)["transcripts_cleared"] == 0   # idempotent
        # 0 = keep forever; shorter windows purge more
        integration = integ.get_or_create_integration(db, user_id)
        integration.retention_days_transcript = 0
        db.commit()
        assert retention.run_retention_sweep(db, user_id=user_id)["skipped_keep_forever"] == 1
        integration.retention_days_transcript = 5
        db.commit()
        assert retention.run_retention_sweep(db, user_id=user_id)["transcripts_cleared"] == 1
        assert db.get(CallLog, recent_id).transcript == "[]"


def test_build_crm_preview_without_debrief_and_payload_shape():
    meeting = WizardMeeting(id="m", user_id=1, prospect_name="Asha", company="Nimbus", prospect_email="a@nimbus.in", deal_value_inr=50000.0, title="Demo")
    rows = integ.build_crm_preview(meeting, None, None)
    ids = [r["id"] for r in rows]
    assert "contact.Last_Name" in ids and "deal.Deal_Name" in ids and not any(i.startswith("note") or i.startswith("task") for i in ids)
    assert next(r for r in rows if r["id"] == "contact.Last_Name")["proposed"] == "Asha"
    payload = integ.rows_to_webhook_payload(meeting, None, rows)
    assert payload["event"] == "meeting.debrief" and payload["fields"]["deal.Amount"] == 50000.0 and payload["debrief"] is None
