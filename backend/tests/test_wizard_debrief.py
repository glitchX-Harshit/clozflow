"""Debrief generation: transcript parsing, verbatim evidence, heuristics, benchmarks, LLM merge, background job."""
import asyncio
import json
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
import test_wizard_helpers as h  # noqa: E402


from database import SessionLocal  # noqa: E402
from models import CallLog  # noqa: E402
from models_wizard import WizardDebrief, WizardMeeting  # noqa: E402
from services.wizard import battlecards as cards_svc  # noqa: E402
from services.wizard import contracts, hooks  # noqa: E402
from services.wizard import debrief as d  # noqa: E402


def _segments():
    return d.load_call(type("L", (), {"transcript": json.dumps(h.sample_transcript()), "ai_suggestions": json.dumps(h.sample_insights()),
                                      "timestamp": h.CALL_DATE, "metrics": None, "deal_record": None, "duration_seconds": None, "started_at": None})())


def test_load_call_and_card_feedback():
    inputs = _segments()
    assert len(inputs["segments"]) == 10 and inputs["segments"][1]["speaker"] == "prospect" and inputs["segments"][1]["t_end"] == 13.0
    assert inputs["duration_s"] == 52
    assert inputs["card_feedback"] == {"cards_shown": 3, "cards_used": 1, "cards_dismissed": 1, "cards_up": 0, "cards_down": 1}
    assert d.language_of(inputs["segments"]) == "en-IN"


def test_verify_fields_drops_unverified_quotes():
    segments = _segments()["segments"]
    fields = [{"field": "metrics", "value": "40 enquiries a week", "evidence_quote": "Around forty a week.", "confidence": 0.9},
              {"field": "economic_buyer", "value": "The MD", "evidence_quote": "the final call is with our md", "confidence": 0.8},
              {"field": "champion", "value": "Manager", "evidence_quote": "My manager loves it", "confidence": 0.7}]
    verified = d.verify_fields(fields, segments, "meddpicc")
    by = {f["field"]: f for f in verified}
    assert len(verified) == 8
    assert by["metrics"]["value"] == "40 enquiries a week" and by["metrics"]["speaker"] == "prospect"
    assert by["economic_buyer"]["value"] == "The MD"            # case/punctuation-insensitive match
    assert by["champion"]["value"] is None and by["champion"]["evidence_quote"] is None and by["champion"]["confidence"] == 0.0
    assert by["paper_process"]["value"] is None


def test_heuristics_objections_signals_next_step_and_stage():
    segments = _segments()["segments"]
    with SessionLocal() as db:
        cards = cards_svc.visible_cards(db, user_id=-1)
    objections = d.detect_objections(segments, cards)
    price = next(o for o in objections if o["battlecard_id"] in ("pricing", "obj-price-expensive"))
    assert price["handled"] is True and price["turn_index"] == 5 and price["quote"].startswith("Okay. But this looks")
    assert all(o["battlecard_id"] not in ("in-whatsapp-followup", "in-hinglish-mirroring") for o in objections)
    signals = d.detect_buying_signals(segments)
    assert any("implementation" in s["why"] for s in signals)
    step = d.detect_next_step(segments, h.CALL_DATE)
    assert step["date"] == "2026-11-17" and "Tuesday" in step["text"]
    assert d.detect_stage(segments, objections, step) == "next_steps"
    assert d.outcome_for(step, segments, None) == "next_step_set"
    assert d.outcome_for({"text": "will send", "date": None}, segments, None) == "follow_up_needed"
    assert d.outcome_for({"text": None, "date": None}, [], "won") == "no_show"
    assert d.outcome_for({"text": None, "date": None}, segments, "won") == "won"
    base = datetime(2026, 11, 12)   # Thursday
    assert d._parse_date_phrase("let's meet tomorrow", base) == "2026-11-13"
    assert d._parse_date_phrase("call me on 20th nov", base) == "2026-11-20"
    assert d._parse_date_phrase("agle hafte baat karte hain", base) == "2026-11-16"
    assert d._parse_date_phrase("somvaar ko milte hain", base) == "2026-11-16"
    assert d._parse_date_phrase("no date here", base) is None


def test_coaching_tips_cover_the_four_gong_benchmarks_and_word_limits():
    inputs = _segments()
    with SessionLocal() as db:
        cards = cards_svc.visible_cards(db, user_id=-1)
    meeting = WizardMeeting(id="m", user_id=1, prospect_name="Ravi Kumar", company="Acme Bakery", methodology="meddpicc", title="Discovery")
    result = d.deterministic_debrief(meeting, inputs, cards)
    metrics = {t["metric"] for t in result["coaching"]}
    assert {"talk_ratio_rep", "longest_monologue_rep_s", "pause_after_objection_s"} <= metrics
    pause = next(t for t in result["coaching"] if t["metric"] == "pause_after_objection_s")
    # three prospect lines trip cards (Excel status quo, "final call is with our MD", price): pauses 1.0, 1.0 and 2.5 s
    assert pause["value"] == round((1.0 + 1.0 + 2.5) / 3, 1) and pause["evidence_quote"]
    assert contracts.word_count(result["summary"]) <= 80
    assert contracts.word_count(result["follow_up_email"]["body"]) <= 180 and result["follow_up_email"]["subject"]
    assert contracts.word_count(result["follow_up_whatsapp"]) <= 90 and "Tuesday" in result["follow_up_whatsapp"]
    assert result["metrics"]["cards_used"] == 1 and result["metrics"]["talk_ratio_rep"] is not None
    assert result["deal_health"]["score"] is not None and "coverage" in result["deal_health"]
    assert result["crm_payload"]["next_step_date"] == "2026-11-17" and result["crm_payload"]["outcome"] == "next_step_set"
    assert all(item["id"] and item["owner"] in ("rep", "prospect") for item in result["action_items"])


def test_hinglish_prospect_gets_hinglish_whatsapp():
    transcript = [{"speaker": "prospect", "text": "Haan ji, abhi toh Excel mein hai, theek chal raha hai lekin follow-up nahi hota.", "timestamp": h.CALL_DATE.isoformat()},
                  {"speaker": "salesperson", "text": "Samajh gaya. Kal 11 baje walkthrough karte hain?", "timestamp": h.CALL_DATE.isoformat()},
                  {"speaker": "prospect", "text": "Haan kal theek hai, WhatsApp kar dena.", "timestamp": h.CALL_DATE.isoformat()}]
    log = type("L", (), {"transcript": json.dumps(transcript), "ai_suggestions": "[]", "timestamp": h.CALL_DATE, "metrics": None,
                         "deal_record": None, "duration_seconds": 90, "started_at": None})()
    inputs = d.load_call(log)
    assert d.language_of(inputs["segments"]) == "hinglish"
    meeting = WizardMeeting(id="m2", user_id=1, prospect_name="Mehta", methodology="bant")
    result = d.deterministic_debrief(meeting, inputs, [])
    assert result["follow_up_whatsapp"].startswith("Namaste Mehta ji")
    assert result["next_step"]["date"] == "2026-11-13"


async def test_run_debrief_job_links_log_and_uses_live_metrics_when_present():
    user_id, _ = h.make_user()
    call_id = h.make_call_log(user_id, metrics={"elapsed_s": 600, "talk_ratio_rep": 0.7, "longest_monologue_rep_s": 200, "questions_rep": 4, "estimated": False},
                              deal_record={"methodology": "meddpicc", "fields": [{"field": "metrics", "label": "Metrics", "value": "40/week",
                                                                                  "evidence_quote": "Around forty a week.", "confidence": 0.9}],
                                           "objections": [], "buying_signals": [], "risks": [], "next_step": {"text": "Walkthrough with MD Tuesday", "date": "2026-11-17"}, "stage": "next_steps"})
    with SessionLocal() as db:
        meeting = WizardMeeting(user_id=user_id, prospect_name="Ravi Kumar", company="Acme Bakery", methodology="meddpicc", status="live", title="T")
        db.add(meeting)
        db.commit()
        meeting_id = meeting.id
    await d.run_debrief_job(meeting_id, call_id, user_id)
    with SessionLocal() as db:
        meeting = db.get(WizardMeeting, meeting_id)
        row = db.query(WizardDebrief).filter(WizardDebrief.meeting_id == meeting_id).one()
        log = db.get(CallLog, call_id)
        assert meeting.status == "debriefed" and meeting.call_log_id == call_id and log.meeting_id == meeting_id
        assert row.status == "ready" and row.metrics["talk_ratio_rep"] == 0.7 and row.metrics["cards_shown"] == 3
        assert next(f for f in row.methodology_fields if f["field"] == "metrics")["value"] == "40/week"
        talk = next(t for t in row.coaching if t["metric"] == "talk_ratio_rep")
        assert "70%" in talk["tip"]
        assert row.next_step["date"] == "2026-11-17" and row.outcome == "next_step_set"
    # the hook schedules a task on the running loop and returns None (never awaited by the live pipeline)
    hooks.register_session_saved(d.on_session_saved)
    assert d.on_session_saved(None, call_id, user_id) is None
    task = d.schedule_debrief(meeting_id, call_id, user_id)
    assert isinstance(task, asyncio.Task)
    await task
    # foreign user ids are ignored
    other_id, _ = h.make_user("other")
    await d.run_debrief_job(meeting_id, call_id, other_id)
    with SessionLocal() as db:
        assert db.get(WizardMeeting, meeting_id).user_id == user_id


async def test_llm_merge_drops_unverified_quotes_and_enforces_outcome_rules(monkeypatch):
    user_id, _ = h.make_user()
    call_id = h.make_call_log(user_id)
    with SessionLocal() as db:
        meeting = WizardMeeting(user_id=user_id, prospect_name="Ravi Kumar", company="Acme Bakery", methodology="meddpicc", status="ended",
                                call_log_id=call_id, title="Discovery")
        db.add(meeting)
        db.commit()
        meeting_id = meeting.id

    def handler(system, user, schema, **kw):
        assert "TRANSCRIPT" in user and "CALL DATE: 2026-11-12" in user
        return {
            "summary": " ".join(["s"] * 120), "outcome": "won", "stage_reached": "pricing",
            "methodology_fields": [{"field": "metrics", "value": "Forty enquiries a week", "evidence_quote": "Around forty a week.", "speaker": "prospect", "confidence": 0.9},
                                   {"field": "champion", "value": "Manager", "evidence_quote": "I will champion this internally", "confidence": 0.9}],
            "objections": [{"type": "price", "quote": "this looks bahut expensive for a business our size", "handled": True, "battlecard_id": "pricing"},
                           {"type": "trust", "quote": "we got burnt before", "handled": False}],
            "buying_signals": [{"quote": "How long does implementation take if we start?", "why": "implementation question"}, {"quote": "fake", "why": "x"}],
            "risks": [{"text": "Single-threaded", "severity": "medium"}],
            "action_items": [{"text": "Send invite", "owner": "rep", "due": "2026-11-13"}, {"text": "Share CA one-pager", "owner": "rep", "due": "soon"}],
            "next_step": {"text": "Walkthrough with the MD", "date": "2026-11-17", "evidence_quote": "Tuesday works."},
            "follow_up_email": {"subject": "Recap", "body": " ".join(["e"] * 250)}, "follow_up_whatsapp": " ".join(["w"] * 120),
            "coaching": [{"tip": "Nice isolate question.", "evidence_quote": "Expensive compared to the budget you had in mind, or compared to the forty enquiries that slip?"},
                         {"tip": "Bad quote", "evidence_quote": "never said"}],
        }

    h.fake_llm(monkeypatch, handler)
    with SessionLocal() as db:
        meeting = db.get(WizardMeeting, meeting_id)
        row = await d.generate_debrief(db, meeting, force=True)
        assert row.status == "ready" and row.degraded is False and row.model == "fake-model"
        assert contracts.word_count(row.summary) == 80
        by = {f["field"]: f for f in row.methodology_fields}
        assert by["metrics"]["value"] == "Forty enquiries a week" and by["champion"]["value"] is None
        assert [o["type"] for o in row.objections] == ["price"] and row.objections[0]["battlecard_id"] == "pricing"
        assert [s["why"] for s in row.buying_signals] == ["implementation question"]
        assert row.outcome == "won" and row.next_step["date"] == "2026-11-17" and row.next_step["evidence_quote"] == "Tuesday works."
        assert row.action_items[0]["due"] == "2026-11-13" and row.action_items[1]["due"] is None
        assert contracts.word_count(row.follow_up_email["body"]) == 180 and contracts.word_count(row.follow_up_whatsapp) == 90
        tips = [t["tip"] for t in row.coaching]
        assert "Nice isolate question." in tips and "Bad quote" not in tips
        assert {t["metric"] for t in row.coaching if t["metric"]} >= {"talk_ratio_rep", "pause_after_objection_s"}
        assert row.deal_health["score"] is not None and row.crm_payload["outcome"] == "won"
        assert meeting.status == "debriefed"


def test_apply_patch_merges_items_and_fields():
    row = WizardDebrief(meeting_id="m", user_id=1, status="ready", action_items=[{"id": "a", "text": "A", "owner": "rep", "due": None, "done": False}],
                        methodology_fields=[{"field": "metrics", "label": "Metrics", "value": "x", "evidence_quote": "q", "confidence": 0.5, "confirmed": None}])
    d.apply_patch(row, {"action_items": [{"id": "a", "done": True}, {"text": "B", "owner": "prospect", "due": "2026-12-01"}],
                        "methodology_fields": [{"field": "metrics", "confirmed": False, "value": "y"}, {"field": "bogus", "value": "z"}],
                        "next_step": {"text": "Call", "date": "2026-12-02"}})
    assert row.action_items[0]["done"] is True and row.action_items[1]["text"] == "B" and row.action_items[1]["id"]
    assert row.methodology_fields[0]["confirmed"] is False and row.methodology_fields[0]["value"] == "y" and len(row.methodology_fields) == 1
    assert row.next_step["date"] == "2026-12-02" and row.edited_at is not None
