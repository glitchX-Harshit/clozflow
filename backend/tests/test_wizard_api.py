"""Meeting Wizard REST API: meetings, start/end, debrief lifecycle, home, preflight, integrations, CallStartRequest."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import test_wizard_helpers as h  # noqa: E402

import pytest  # noqa: E402

from database import SessionLocal  # noqa: E402
from models import Lead  # noqa: E402
from models_wizard import WizardIntegration  # noqa: E402
from services.call_context_engine import call_context_engine  # noqa: E402


@pytest.fixture
def http():
    c = h.client()
    yield c
    c.close()


def test_meeting_crud_and_ownership(http):
    user_id, headers = h.make_user()
    meeting = h.make_meeting(http, headers)
    assert meeting["status"] == "planned"
    assert meeting["deal_value_inr"] == 450000.0 and meeting["deal_value_text"] == "₹4.5L"
    assert meeting["prospect_phone_e164"] == "+919876543210"
    assert meeting["title"] == "Meeting with Ravi Kumar"
    assert meeting["created_at"].endswith("Z")
    assert meeting["battlecard_ids"] == []

    got = http.get(f"/api/wizard/meetings/{meeting['id']}", headers=headers)
    assert got.status_code == 200 and got.json()["battlecards"] == []

    patched = http.patch(f"/api/wizard/meetings/{meeting['id']}", json={"deal_value": "12 lakh", "platform": "zoom", "methodology": "bant",
                                                                       "scheduled_start": "2026-11-20T10:30:00+05:30"}, headers=headers)
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["deal_value_inr"] == 1_200_000.0 and body["platform"] == "zoom" and body["methodology"] == "bant"
    assert body["scheduled_start"] == "2026-11-20T05:00:00Z"

    assert http.patch(f"/api/wizard/meetings/{meeting['id']}", json={"methodology": "nonsense"}, headers=headers).status_code == 422
    assert http.patch(f"/api/wizard/meetings/{meeting['id']}", json={"prospect_phone": "12"}, headers=headers).status_code == 422

    listed = http.get("/api/wizard/meetings?status=planned", headers=headers).json()
    assert [m["id"] for m in listed] == [meeting["id"]]

    _, other = h.make_user("other")
    for method, path in (("get", f"/api/wizard/meetings/{meeting['id']}"), ("patch", f"/api/wizard/meetings/{meeting['id']}"),
                         ("delete", f"/api/wizard/meetings/{meeting['id']}"), ("post", f"/api/wizard/meetings/{meeting['id']}/brief"),
                         ("get", f"/api/wizard/meetings/{meeting['id']}/debrief")):
        kwargs = {"json": {}} if method in ("patch", "post") else {}
        assert getattr(http, method)(path, headers=other, **kwargs).status_code == 404, (method, path)
    assert http.get("/api/wizard/meetings").status_code == 401

    assert http.delete(f"/api/wizard/meetings/{meeting['id']}", headers=headers).status_code == 200
    assert http.get(f"/api/wizard/meetings/{meeting['id']}", headers=headers).status_code == 404


def test_meeting_requires_someone_and_prefills_from_lead(http):
    user_id, headers = h.make_user()
    assert http.post("/api/wizard/meetings", json={"objective": "x"}, headers=headers).status_code == 422
    with SessionLocal() as db:
        lead = Lead(user_id=user_id, business_name="Mehta Traders", category="Wholesale", city="Surat", phone_number="0 98765 00000",
                    website="https://mehtatraders.in", likely_pain_point="Collections run late")
        db.add(lead)
        db.commit()
        lead_id = lead.id
    created = http.post("/api/wizard/meetings", json={"lead_id": lead_id}, headers=headers)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["company"] == "Mehta Traders" and body["industry"] == "Wholesale" and body["prospect_phone_e164"] == "+919876500000"
    # client aliases: prospect_phone_e164 / deal_value_text / product snapshot / consent object / unknown keys
    aliased = http.post("/api/wizard/meetings", json={"prospect_name": "Asha", "prospect_phone_e164": "+91 90000 00000", "deal_value_text": "2 cr",
                                                      "product_name": "Custom product", "product_price": "₹999", "consent": {"mode": "in_invite", "script": "s", "participants_notified": True},
                                                      "coaching_intensity": "full", "channel": "mic", "unknown_key": 1}, headers=headers)
    assert aliased.status_code == 201, aliased.text
    body = aliased.json()
    assert body["prospect_phone_e164"] == "+919000000000" and body["deal_value_inr"] == 20_000_000.0 and body["deal_value_text"] == "2 cr"
    assert body["product_name"] == "Custom product" and body["consent"]["mode"] == "in_invite" and body["coaching_intensity"] == "full" and body["channel"] == "mic"
    _, other = h.make_user("other")
    assert http.post("/api/wizard/meetings", json={"lead_id": lead_id}, headers=other).status_code == 404


def test_start_stores_wizard_context_and_end_schedules_debrief(http):
    user_id, headers = h.make_user()
    meeting = h.make_meeting(http, headers, channel="tab_audio")
    brief = http.post(f"/api/wizard/meetings/{meeting['id']}/brief", headers=headers)
    assert brief.status_code == 200, brief.text
    assert brief.json()["degraded"] is True

    started = http.post(f"/api/wizard/meetings/{meeting['id']}/start", json={"consent": {"mode": "announced"}}, headers=headers)
    assert started.status_code == 200, started.text
    body = started.json()
    assert body["ws"] == {"audio": "/ws/audio", "text": "/ws"}
    assert body["consent_script"].startswith("Hi, quick note")
    assert {"enabled", "rate_per_minute", "reason", "create_url"} <= set(body["bridge"]) and body["bridge"]["create_url"] == "/api/copilot/bridge/calls"
    assert body["meeting"]["status"] == "live"
    context = call_context_engine.get_context(body["context_id"])
    assert context["user_id"] == user_id and context["client_name"] == "Ravi Kumar"
    wizard = context["wizard"]
    assert wizard["meeting_id"] == meeting["id"]
    assert wizard["channel"] == "tab_audio" and wizard["intensity"] == "guided" and wizard["coaching_intensity"] == "guided"
    assert wizard["consent"]["mode"] == "announced" and wizard["consent"]["announced_at"]
    assert wizard["bridge_disclosure"] is True and wizard["notetaker_name"] == "ClozFlow Notetaker"
    assert wizard["prospect_language_hint"] in ("hinglish", "en-IN")
    assert wizard["brief"]["objective"]
    assert 3 <= len(wizard["pre_rendered_cards"]) <= 5
    card = wizard["pre_rendered_cards"][0]
    assert 15 <= card["say_words"] <= 60 and card["trigger_keywords"] and card["headline"]
    assert wizard["battlecards"] and {"id", "act", "do_not", "trigger_keywords", "moment"} <= set(wizard["battlecards"][0])
    assert "Ravi Kumar" in wizard["keyterms"]

    # a second start while live is allowed (rejoin), debriefed/cancelled is not
    assert http.post(f"/api/wizard/meetings/{meeting['id']}/start", json={}, headers=headers).status_code == 200

    # end without a call log: ended, nothing scheduled
    ended = http.post(f"/api/wizard/meetings/{meeting['id']}/end", json={}, headers=headers)
    assert ended.status_code == 200 and ended.json()["status"] == "ended" and ended.json()["debrief_scheduled"] is False
    # end with a call log: the debrief job runs as a background task (deterministic: no LLM)
    call_id = h.make_call_log(user_id)
    ended = http.post(f"/api/wizard/meetings/{meeting['id']}/end", json={"call_log_id": call_id}, headers=headers)
    assert ended.status_code == 200 and ended.json()["debrief_scheduled"] is True and ended.json()["call_log_id"] == call_id
    debrief = http.get(f"/api/wizard/meetings/{meeting['id']}/debrief", headers=headers)
    assert debrief.status_code == 200, debrief.text
    body = debrief.json()
    assert body["status"] == "ready" and body["degraded"] is True
    assert body["outcome"] == "next_step_set" and body["next_step"]["date"] == "2026-11-17"
    assert body["deal_health"]["score"] is not None and body["deal_health"]["rationale"]
    assert len(body["coaching"]) >= 4 and body["metrics"]["cards_shown"] == 3
    assert http.get(f"/api/wizard/meetings/{meeting['id']}", headers=headers).json()["status"] == "debriefed"
    # a foreign call log is refused
    other_id, _ = h.make_user("other")
    foreign = h.make_call_log(other_id)
    assert http.post(f"/api/wizard/meetings/{meeting['id']}/end", json={"call_log_id": foreign}, headers=headers).status_code == 404


def test_debrief_lifecycle_409_202_patch(http):
    user_id, headers = h.make_user()
    meeting = h.make_meeting(http, headers)
    assert http.get(f"/api/wizard/meetings/{meeting['id']}/debrief", headers=headers).status_code == 404   # "not yet" for pollers
    assert http.post(f"/api/wizard/meetings/{meeting['id']}/debrief", headers=headers).status_code == 409
    http.post(f"/api/wizard/meetings/{meeting['id']}/start", json={}, headers=headers)
    http.post(f"/api/wizard/meetings/{meeting['id']}/end", json={}, headers=headers)
    # ended without a call log: GET creates + runs the job (no transcript → no_show-style debrief), first answer is 202
    first = http.get(f"/api/wizard/meetings/{meeting['id']}/debrief", headers=headers)
    assert first.status_code in (200, 202)
    second = http.get(f"/api/wizard/meetings/{meeting['id']}/debrief", headers=headers)
    assert second.status_code == 200 and second.json()["outcome"] == "no_show"
    # synchronous regeneration with a call log attached
    call_id = h.make_call_log(user_id)
    http.post(f"/api/wizard/meetings/{meeting['id']}/end", json={"call_log_id": call_id}, headers=headers)
    regen = http.post(f"/api/wizard/meetings/{meeting['id']}/debrief?force=1", headers=headers)
    assert regen.status_code == 200 and regen.json()["outcome"] == "next_step_set"
    items = regen.json()["action_items"]
    patched = http.patch(f"/api/wizard/meetings/{meeting['id']}/debrief",
                         json={"summary": "Edited summary.", "action_items": [{"id": items[0]["id"], "done": True}, {"text": "Call the CA", "owner": "rep"}],
                               "methodology_fields": [{"field": "metrics", "confirmed": True}]}, headers=headers)
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["summary"] == "Edited summary." and body["edited_at"]
    assert len(body["action_items"]) == 2   # the array is authoritative: unlisted items are removed
    assert body["action_items"][0]["done"] is True and body["action_items"][-1]["text"] == "Call the CA" and body["action_items"][-1]["id"]
    assert next(f for f in body["methodology_fields"] if f["field"] == "metrics")["confirmed"] is True
    assert http.patch(f"/api/wizard/meetings/{meeting['id']}/debrief", json={"outcome": "maybe"}, headers=headers).status_code == 422


def test_home_preflight_and_stats(http):
    user_id, headers = h.make_user()
    empty = http.get("/api/wizard/home", headers=headers).json()
    assert empty == {**empty, "today": [], "live": None, "upcoming": [], "recent": []}
    assert empty["stats"]["meetings_30d"] == 0 and empty["stats"]["next_step_rate"] is None
    meeting = h.make_meeting(http, headers)
    http.post(f"/api/wizard/meetings/{meeting['id']}/start", json={}, headers=headers)
    home = http.get("/api/wizard/home", headers=headers).json()
    assert home["live"]["id"] == meeting["id"]
    call_id = h.make_call_log(user_id)
    http.post(f"/api/wizard/meetings/{meeting['id']}/end", json={"call_log_id": call_id}, headers=headers)
    home = http.get("/api/wizard/home", headers=headers).json()
    assert home["live"] is None and home["recent"][0]["debrief"]["outcome"] == "next_step_set"
    assert home["recent"][0]["outcome"] == "next_step_set" and home["recent"][0]["debrief_summary"]   # flat copies for cards
    assert home["stats"]["meetings_30d"] == 1 and home["stats"]["next_step_rate"] == 1.0

    pre = http.get("/api/wizard/preflight", headers=headers).json()
    assert pre["stt"]["ready"] is False and pre["coach"]["ready"] is False and pre["bot"]["enabled"] is False
    assert {"enabled", "reason", "rate_per_minute", "min_balance", "country_default"} <= set(pre["bridge"])
    assert pre["consent_script"].startswith("Hi, quick note") and pre["notetaker_name"] == "ClozFlow Notetaker"
    assert pre["slo"]["first_line_ms"] == 1200


def test_integrations_round_trip_secret_write_only(http):
    user_id, headers = h.make_user()
    before = http.get("/api/wizard/integrations", headers=headers).json()
    assert before["has_webhook_secret"] is False and before["retention_days_transcript"] == 180 and before["bridge_disclosure"] is True
    put = http.put("/api/wizard/integrations", json={"crm_webhook_url": "https://hooks.example.com/clozflow", "crm_webhook_secret": "s3cret",
                                                     "crm_bcc_email": "Crm@Example.com", "notetaker_name": "Acme Notetaker",
                                                     "consent_script": "Namaste, main notes le raha hoon, theek hai?", "bridge_disclosure": False,
                                                     "retention_days_transcript": 30}, headers=headers)
    assert put.status_code == 200, put.text
    body = put.json()
    assert body["has_webhook_secret"] is True and "crm_webhook_secret" not in body
    assert body["crm_bcc_email"] == "crm@example.com" and body["bridge_disclosure"] is False and body["retention_days_transcript"] == 30
    assert http.put("/api/wizard/integrations", json={"crm_webhook_url": "http://localhost:9/x"}, headers=headers).status_code == 422
    assert http.put("/api/wizard/integrations", json={"crm_bcc_email": "nope"}, headers=headers).status_code == 422
    pre = http.get("/api/wizard/preflight", headers=headers).json()
    assert pre["consent_script"].startswith("Namaste") and pre["notetaker_name"] == "Acme Notetaker" and pre["bridge_disclosure"] is False
    # the start payload carries the per-user settings
    meeting = h.make_meeting(http, headers)
    started = http.post(f"/api/wizard/meetings/{meeting['id']}/start", json={}, headers=headers).json()
    assert started["notetaker_name"] == "Acme Notetaker" and call_context_engine.get_context(started["context_id"])["wizard"]["bridge_disclosure"] is False
    with SessionLocal() as db:
        assert db.get(WizardIntegration, user_id).crm_webhook_secret == "s3cret"


def test_phone_bridge_start_needs_number_and_sets_disclosure(http):
    _, headers = h.make_user()
    meeting = h.make_meeting(http, headers, prospect_phone=None, platform="phone")
    assert meeting["channel"] == "phone_bridge"
    assert http.post(f"/api/wizard/meetings/{meeting['id']}/start", json={}, headers=headers).status_code == 422
    started = http.post(f"/api/wizard/meetings/{meeting['id']}/start", json={"prospect_phone": "+91 98765 43210"}, headers=headers)
    assert started.status_code == 200, started.text
    assert started.json()["meeting"]["consent"]["mode"] == "bridge_disclosure"


def test_admin_retention_requires_superuser(http):
    _, headers = h.make_user()
    assert http.post("/api/wizard/admin/retention/run", headers=headers).status_code == 403
    _, admin = h.make_user("admin", is_admin=True)
    result = http.post("/api/wizard/admin/retention/run", headers=admin)
    assert result.status_code == 200 and "transcripts_cleared" in result.json()


def test_call_start_request_extension_stores_wizard_subdict_and_keeps_old_payloads():
    import main  # loads with the stubbed dotenv; the temp DB from the helper
    from fastapi.testclient import TestClient

    user_id, headers = h.make_user()
    with TestClient(main.app) as http:
        legacy = {"client_name": "Ravi", "client_industry": "Bakery", "client_role": "Owner", "product_name": "ClozFlow", "call_goal": "Demo"}
        old = http.post("/call/start", json=legacy, headers=headers)
        assert old.status_code == 200, old.text
        assert "wizard" not in call_context_engine.get_context(old.json()["context_id"])
        new = http.post("/call/start", json={**legacy, "platform": "zoom", "deal_value": "₹2.4L", "active_battlecard": "Pricing Resistance",
                                             "methodology": "bant", "coaching_intensity": "light", "battlecard_ids": ["delay"],
                                             "consent": {"mode": "in_invite"}, "prospect_phone": "9876543210"}, headers=headers)
        assert new.status_code == 200, new.text
        context = call_context_engine.get_context(new.json()["context_id"])
        wizard = context["wizard"]
        assert context["client_name"] == "Ravi"
        assert wizard["platform"] == "zoom" and wizard["deal_value"] == "₹2.4L" and wizard["deal_value_inr"] == 240000.0
        assert wizard["methodology"] == "bant" and wizard["intensity"] == "light"
        assert wizard["battlecard_ids"][:2] == ["pricing", "delay"]
        assert wizard["consent"] == {"mode": "in_invite"} and wizard["meeting_id"] is None
        assert wizard["pre_rendered_cards"] and wizard["pre_rendered_cards"][0]["battlecard_id"] == "pricing"
        meeting_json = http.get("/api/wizard/preflight", headers=headers)
        assert meeting_json.status_code == 200
