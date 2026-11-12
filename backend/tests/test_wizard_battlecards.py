"""Battlecard library: seed quality, idempotent seeding, scoring, trigger matching, CRUD and seed protection."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import test_wizard_helpers as h  # noqa: E402

import pytest  # noqa: E402

from database import SessionLocal  # noqa: E402
from models_wizard import WizardBattlecard, WizardMeeting  # noqa: E402
from services.wizard import battlecards as svc  # noqa: E402
from services.wizard import contracts  # noqa: E402

LEGACY_IDS = {"pricing", "skepticism", "delay", "ego", "competitive"}


@pytest.fixture
def http():
    c = h.client()
    yield c
    c.close()


def test_seed_file_quality():
    cards = svc.load_seed()
    ids = [c["id"] for c in cards]
    assert 45 <= len(cards) <= 60 and len(ids) == len(set(ids))
    assert LEGACY_IDS <= set(ids)
    kinds = {c["kind"] for c in cards}
    assert {"objection", "competitive", "methodology", "india_context", "stage", "closing", "persona"} <= kinds
    assert sum(1 for c in cards if c["kind"] == "india_context") >= 8
    assert sum(1 for c in cards if c["kind"] == "methodology") >= 10
    for card in cards:
        words = contracts.word_count(card["act"])
        assert 25 <= words <= 60, (card["id"], words)
        assert card["act_hinglish"] and contracts.word_count(card["act_hinglish"]) >= 15, card["id"]
        assert card["question_to_ask"].strip().endswith("?"), card["id"]
        assert card["trigger_keywords"] and len(card["trigger_keywords"]) <= 14, card["id"]
        for field in ("fact", "impact", "do_not", "psychology", "proof_point", "category", "title", "trigger_description", "accent"):
            assert card.get(field), (card["id"], field)
        assert "As an AI" not in card["act"] and "•" not in card["act"]
        if card["kind"] == "methodology":
            assert card["methodology_field"] and any(t in ("meddpicc", "bant", "spin") for t in card["tags"]), card["id"]
    # Hinglish cues are present for live matching
    hinglish = [kw for c in cards for kw in c["trigger_keywords"] if kw in ("mehenga", "sochte hain", "sir se baat", "tally mein hai", "bharosa nahi")]
    assert len(hinglish) >= 4


def test_seed_is_idempotent_and_refresh_only_with_force():
    with SessionLocal() as db:
        assert svc.seed_if_empty(db) == 0
        row = db.get(WizardBattlecard, "pricing")
        original = row.act
        row.act = "edited"
        db.commit()
        assert svc.seed_battlecards(db) == 0 and db.get(WizardBattlecard, "pricing").act == "edited"
        assert svc.seed_battlecards(db, force=True) == len(svc.load_seed())
        assert db.get(WizardBattlecard, "pricing").act == original
        db.delete(db.get(WizardBattlecard, "delay"))
        db.commit()
        assert svc.seed_if_empty(db) == 1 and db.get(WizardBattlecard, "delay") is not None


def test_trigger_matching_and_scoring():
    with SessionLocal() as db:
        cards = svc.visible_cards(db, user_id=-1)
        hits = svc.match_triggers("Yeh toh bahut mehenga hai boss", cards)
        assert any(c.id in ("pricing", "obj-price-expensive") for c, _ in hits)
        assert svc.match_triggers("we use expensively priced tooling", [db.get(WizardBattlecard, "pricing")]) == []  # whole-word only
        meeting = WizardMeeting(id="x", user_id=-1, prospect_name="A", company="Sharma Textiles", industry="Manufacturing exporter", methodology="bant",
                                deal_value_inr=1_500_000, objective="Replace Tally-based follow-ups and fix GST invoicing", battlecard_ids=["delay"],
                                channel="phone_bridge", platform="phone")
        scored = svc.score_cards(cards, meeting)
        ids = [c.id for c, _s, _w in scored]
        assert ids[0] == "delay" and "picked for this meeting" in scored[0][2]
        assert "meth-bant-budget" in ids and "meth-meddpicc-metrics" not in ids   # methodology filter
        assert ids.index("obj-excel-tally") < len(ids) // 2 and ids.index("in-ca-finance-gate") < len(ids) // 2
        card = db.get(WizardBattlecard, "obj-authority-boss")
        assert svc.moment_for(card) == "objection" and svc.moment_for(db.get(WizardBattlecard, "pricing")) == "pricing"
        assert svc.moment_for(db.get(WizardBattlecard, "competitive")) == "competitor"
        pre = svc.pre_rendered(card, say_lang="hinglish", why="test")
        assert pre["say"] == card.act_hinglish and pre["then_ask"].endswith("?") and len(pre["headline"].split()) <= 6
        assert svc.pre_rendered(card, say_lang="en-IN")["say"] == card.act


def test_battlecard_api_crud_and_seed_protection(http):
    user_id, headers = h.make_user()
    listed = http.get("/api/wizard/battlecards", headers=headers).json()
    assert len(listed) >= 45 and all(c["is_seed"] for c in listed)
    assert {"act", "act_hinglish", "reframe", "trap", "moment"} <= set(listed[0])
    by_kind = http.get("/api/wizard/battlecards?kind=india_context", headers=headers).json()
    assert by_kind and all(c["kind"] == "india_context" for c in by_kind)
    assert http.get("/api/wizard/battlecards?kind=weird", headers=headers).status_code == 422
    searched = http.get("/api/wizard/battlecards?q=tally", headers=headers).json()
    assert any(c["id"] == "obj-excel-tally" for c in searched)

    assert http.patch("/api/wizard/battlecards/pricing", json={"title": "x"}, headers=headers).status_code == 403
    assert http.delete("/api/wizard/battlecards/pricing", headers=headers).status_code == 403

    copy = http.post("/api/wizard/battlecards", json={"copy_of": "pricing", "title": "My pricing card"}, headers=headers)
    assert copy.status_code == 201, copy.text
    mine = copy.json()
    assert mine["is_seed"] is False and mine["title"] == "My pricing card" and mine["act"] == listed[0]["act"] if listed[0]["id"] == "pricing" else True
    patched = http.patch(f"/api/wizard/battlecards/{mine['id']}", json={"act": "Say this instead, calmly and clearly, in two sentences.", "trigger_keywords": ["mehenga", "costly"]}, headers=headers)
    assert patched.status_code == 200 and patched.json()["trigger_keywords"] == ["mehenga", "costly"]

    created = http.post("/api/wizard/battlecards", json={"title": "Festive offer", "act": "We can hold the price till Diwali.", "kind": "custom",
                                                          "trigger_keywords": ["diwali offer"]}, headers=headers)
    assert created.status_code == 201 and created.json()["kind"] == "custom"
    assert http.post("/api/wizard/battlecards", json={"title": "no act"}, headers=headers).status_code == 422

    _, other = h.make_user("other")
    assert http.get("/api/wizard/battlecards", headers=other).json()
    assert all(c["id"] != mine["id"] for c in http.get("/api/wizard/battlecards", headers=other).json())
    assert http.patch(f"/api/wizard/battlecards/{mine['id']}", json={"title": "steal"}, headers=other).status_code == 404
    assert http.delete(f"/api/wizard/battlecards/{mine['id']}", headers=other).status_code == 404
    assert http.delete(f"/api/wizard/battlecards/{mine['id']}", headers=headers).status_code == 200

    meeting = h.make_meeting(http, headers)
    suggested = http.post("/api/wizard/battlecards/suggest", json={"meeting_id": meeting["id"], "limit": 5}, headers=headers).json()
    assert len(suggested) == 5 and all({"battlecard", "score", "why"} <= set(s) for s in suggested)
    assert suggested == sorted(suggested, key=lambda s: -s["score"])
    with_meeting = http.get(f"/api/wizard/battlecards?meeting_id={meeting['id']}", headers=headers).json()
    assert "score" in with_meeting[0] and "selected" in with_meeting[0]
    assert http.post("/api/wizard/battlecards/suggest", json={"meeting_id": meeting["id"]}, headers=other).status_code == 404
