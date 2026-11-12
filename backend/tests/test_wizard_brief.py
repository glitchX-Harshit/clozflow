"""Brief generation: deterministic fallback, LLM merge rules, pre-rendered cards, rehearsal."""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
import test_wizard_helpers as h  # noqa: E402

import pytest  # noqa: E402

from database import SessionLocal  # noqa: E402
from models import Capsule  # noqa: E402
from models_wizard import WizardMeeting  # noqa: E402
from services.wizard import brief as brief_svc  # noqa: E402
from services.wizard import contracts, llm  # noqa: E402

BRIEF_KEYS = {"objective", "home_run", "backup_next_step", "attendee", "recap", "hypotheses", "agenda", "likely_objections",
              "pricing_posture", "proof_points", "risks", "opener", "methodology", "sources", "pre_rendered_cards", "consent"}


@pytest.fixture
def http():
    c = h.client()
    yield c
    c.close()


def _capsule(user_id):
    with SessionLocal() as db:
        capsule = Capsule(user_id=user_id, name="ClozFlow Pro", product_name="ClozFlow Pro", product_price="₹2,400 per user per month plus GST",
                          key_differentiators="WhatsApp-native follow-ups; Tally stays for accounts", pain_points_solved="Leads slip overnight",
                          is_default=True)
        db.add(capsule)
        db.commit()
        return capsule.id


def test_deterministic_brief_shape_and_pre_rendered_cards(http):
    user_id, headers = h.make_user()
    capsule_id = _capsule(user_id)
    meeting = h.make_meeting(http, headers, capsule_id=capsule_id, battlecard_ids=["in-promoter-signoff"])
    assert meeting["product_name"] == "ClozFlow Pro"
    result = http.post(f"/api/wizard/meetings/{meeting['id']}/brief", headers=headers).json()
    brief = result["brief"]
    assert result["degraded"] is True and result["model"] is None and BRIEF_KEYS <= set(brief)
    assert brief["methodology"]["name"] == "meddpicc" and len(brief["methodology"]["fields"]) == 8
    assert brief["consent"]["mode_hint"] == "announced" and brief["consent"]["script_en"].startswith("Hi, quick note")
    assert "₹2,400" in brief["pricing_posture"]
    assert any(s["kind"] == "capsule" for s in brief["sources"])
    assert brief["likely_objections"] and all(o["battlecard_id"] for o in brief["likely_objections"])
    cards = brief["pre_rendered_cards"]
    assert 3 <= len(cards) <= 5 and cards[0]["battlecard_id"] == "in-promoter-signoff"
    for card in cards:
        assert contracts.SAY_MIN_WORDS <= card["say_words"] <= contracts.SAY_MAX_WORDS, card["battlecard_id"]
        assert card["say"] and card["then_ask"].endswith("?") and len(card["headline"].split()) <= 6
        assert 1 <= len(card["trigger_keywords"]) <= 12 and card["moment"] in ("objection", "pricing", "competitor", "stall", "next_step_missing", "info")
    assert brief["prospect_language_hint"] == "hinglish"
    assert cards[0]["say_lang"] == "hinglish" and cards[0]["say"].startswith("Aapke jaise")
    # battlecard ids merged into the meeting, status ready, cached unless forced
    refreshed = http.get(f"/api/wizard/meetings/{meeting['id']}", headers=headers).json()
    assert refreshed["status"] == "ready" and "in-promoter-signoff" in refreshed["battlecard_ids"] and len(refreshed["battlecards"]) >= 4
    again = http.post(f"/api/wizard/meetings/{meeting['id']}/brief", headers=headers).json()
    assert again["cached"] is True
    assert brief["recap"]["has_history"] is False and "Nothing on file" in brief["recap"]["summary"]


def test_bridge_channel_sets_bridge_disclosure_hint_and_english_for_tech_buyers(http):
    _, headers = h.make_user()
    meeting = h.make_meeting(http, headers, platform="phone", channel="phone_bridge", company="Nimbus Software Technologies", role="CTO",
                             industry="SaaS", prospect_phone="+919876543210")
    brief = http.post(f"/api/wizard/meetings/{meeting['id']}/brief", headers=headers).json()["brief"]
    assert brief["consent"]["mode_hint"] == "bridge_disclosure"
    assert brief["prospect_language_hint"] == "en-IN" and brief["pre_rendered_cards"][0]["say_lang"] == "en-IN"


def test_llm_merge_validates_ids_and_say_lengths(http, monkeypatch):
    user_id, headers = h.make_user()
    meeting = h.make_meeting(http, headers)

    requested = []
    good_say = " ".join(["word"] * 30)

    def handler(system, user, schema, **kw):
        assert "CAPSULE FACTS" in user and "CARDS TO PRE-RENDER" in user
        section = user.split("CARDS TO PRE-RENDER")[1].split("DRAFT BRIEF")[0]
        requested.extend(re.findall(r"^- ([a-z0-9\-]+) \|", section, re.M))
        assert 3 <= len(requested) <= 5
        return {
            "objective": "Sharpened objective", "home_run": "HR", "backup_next_step": "BK",
            "hypotheses": [{"hypothesis": "H1", "question": "Q1?"}], "agenda": ["one", "two"],
            "likely_objections": [{"battlecard_id": "pricing", "title": "Pricing Resistance", "why_likely": "deal size"},
                                  {"battlecard_id": "not-a-card", "title": "Unknown", "why_likely": "x"},
                                  {"battlecard_id": "nope", "title": "Delay & \"Think About It\"", "why_likely": "matched by title"}],
            "pricing_posture": "PP", "proof_points": ["p1"], "risks": [{"text": "r1", "severity": "high"}], "opener": "Open",
            "pre_rendered_cards": [{"battlecard_id": requested[0], "headline": "Price pushback now please more words", "say": good_say,
                                    "then_ask": "Is it the budget or the value?", "extra_trigger_keywords": ["itna mehenga", "too costly"]},
                                   {"battlecard_id": requested[1], "headline": "Stall", "say": "too short", "then_ask": "no question mark"},
                                   {"battlecard_id": "made-up", "headline": "x", "say": good_say}],
        }

    calls = h.fake_llm(monkeypatch, handler)
    result = http.post(f"/api/wizard/meetings/{meeting['id']}/brief?force=1", headers=headers).json()
    assert len(calls) == 1 and result["degraded"] is False and result["model"] == "fake-model"
    brief = result["brief"]
    assert brief["objective"] == "Sharpened objective" and brief["generated_by"] == "llm"
    ids = [o["battlecard_id"] for o in brief["likely_objections"]]
    assert ids == ["pricing", "delay"]                        # unknown id dropped, known title mapped back to its id
    by_id = {c["battlecard_id"]: c for c in brief["pre_rendered_cards"]}
    assert "made-up" not in by_id and set(requested) == set(by_id)   # every requested card is rendered, nothing else
    first, second = by_id[requested[0]], by_id[requested[1]]
    assert first["say_words"] == 30 and first["tailored"] is True and first["say"] == good_say
    assert len(first["headline"].split()) == 6 and "itna mehenga" in first["trigger_keywords"] and first["then_ask"] == "Is it the budget or the value?"
    assert second["tailored"] is False and second["then_ask"].endswith("?") and second["say_words"] >= contracts.SAY_MIN_WORDS   # fell back to the card's act
    assert all(contracts.SAY_MIN_WORDS <= c["say_words"] <= contracts.SAY_MAX_WORDS for c in brief["pre_rendered_cards"])


def test_llm_failure_falls_back_to_template(http, monkeypatch):
    _, headers = h.make_user()
    meeting = h.make_meeting(http, headers)
    h.fake_llm(monkeypatch, lambda *a, **k: llm.LLMUnavailable("down"))
    result = http.post(f"/api/wizard/meetings/{meeting['id']}/brief", headers=headers).json()
    assert result["degraded"] is True and result["brief"]["generated_by"] == "template"


def test_rehearse_fallback_and_llm(http, monkeypatch):
    _, headers = h.make_user()
    meeting = h.make_meeting(http, headers)
    http.post(f"/api/wizard/meetings/{meeting['id']}/brief", headers=headers)
    first = http.post(f"/api/wizard/meetings/{meeting['id']}/rehearse", json={"messages": [{"role": "rep", "text": "Hi Ravi, thanks for the time."}]}, headers=headers)
    assert first.status_code == 200, first.text
    assert first.json()["degraded"] is True and first.json()["reply"]
    # a rep line that trips a battlecard trigger produces a sparse hint card
    second = http.post(f"/api/wizard/meetings/{meeting['id']}/rehearse",
                       json={"messages": [{"role": "rep", "text": "Hi"}, {"role": "prospect", "text": "ok"},
                                          {"role": "rep", "text": "This is honestly too expensive for most but we can discount"}]}, headers=headers).json()
    hint = second["hint"]
    assert hint and hint["battlecard_id"] and 15 <= hint["say_words"] <= 60 and hint["tier"] == 0
    h.fake_llm(monkeypatch, lambda *a, **k: {"reply": "Hmm, MD se poochna padega.", "hint_headline": "Map the buyer", "hint_say": " ".join(["w"] * 28),
                                              "hint_then_ask": "Who signs off?", "hint_battlecard_id": "obj-authority-boss", "moment": "objection"})
    third = http.post(f"/api/wizard/meetings/{meeting['id']}/rehearse", json={"messages": [{"role": "rep", "text": "Shall we go ahead?"}]}, headers=headers).json()
    assert third["degraded"] is False and third["reply"].startswith("Hmm") and third["hint"]["battlecard_id"] == "obj-authority-boss"
    assert third["hint"]["headline"] == "Map the buyer" and third["hint"]["say_words"] == 28


def test_language_hint_and_history_recap(http):
    user_id, headers = h.make_user()
    assert brief_svc.language_hint(WizardMeeting(prospect_phone_e164="+14155550100")) == "en-IN"
    assert brief_svc.language_hint(WizardMeeting(company="Sharma Traders")) == "hinglish"
    assert brief_svc.language_hint(WizardMeeting(company="Acme", role="VP Engineering")) == "en-IN"
    # a previous debriefed meeting with the same company shows up in the recap
    first = h.make_meeting(http, headers)
    http.post(f"/api/wizard/meetings/{first['id']}/start", json={}, headers=headers)
    http.post(f"/api/wizard/meetings/{first['id']}/end", json={"call_log_id": h.make_call_log(user_id)}, headers=headers)
    second = h.make_meeting(http, headers, prospect_name="Ravi Kumar")
    brief = http.post(f"/api/wizard/meetings/{second['id']}/brief", headers=headers).json()["brief"]
    assert brief["recap"]["has_history"] is True and brief["recap"]["last_meeting_at"]
    assert any(s["kind"] == "history" for s in brief["sources"])
    assert any("Tuesday" in item or "next step" in item.lower() for item in brief["recap"]["open_items"])
