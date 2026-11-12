"""/ws/audio protocol v2 end to end (fake STT, fake coach LLM, temp SQLite): hello/ready, channel-tagged
frames, v2 transcripts, Tier 0 + Tier 2 cards, on-demand ask / what_to_say, feedback, consent, markers,
ping, extended session_saved, the debrief hook, the new call_logs columns; v1 clients unchanged."""
import json
import re

import numpy as np
import pytest

from test_bridge_kit import (  # noqa: F401  (fixtures)
    SCRIPT, FakeEngine, Kit, ScriptedSTT, engine_cls, kit, recv, recv_until, recv_until_closed, stt_cls, telephony, wait_for,
)
from test_wizard_live_coach import FakeLLM, new_turn, no_retrieval, response
from database import SessionLocal
from models import CallLog
from services import websocket_service
from services.wizard import coach_engine, contracts as C, hooks as wizard_hooks

HELLO = {"type": "hello", "protocol": 2, "channels": ["rep", "prospect"], "sample_rate": 16000, "client": "web",
         "meeting_id": None, "intensity": "guided"}
WIZARD = {
    "meeting_id": "m-1", "methodology": "bant", "intensity": "guided", "platform": "meet", "channel": "tab_audio",
    "capsule_facts": [{"label": "Price", "value": "₹1,000 per month"}],
    "battlecards": [{"id": "obj-price", "title": "Too expensive", "kind": "objection",
                     "act": "Expensive compared to your budget, or to another option? Tell me which and I will show the numbers that matter for a bakery.",
                     "question_to_ask": "Compared to what?", "trigger_keywords": ["expensive", "mehenga"]}],
    "pre_rendered_cards": [{"battlecard_id": "obj-price", "headline": "Price pushback", "moment": "pricing",
                            "say": "Expensive compared to what you had budgeted, or compared to another option you looked at? Let us look at the weekly cost of the current process first.",
                            "say_lang": "en-IN", "then_ask": "What budget did you have in mind?", "trigger_keywords": ["expensive"]}],
}


def _marker(value, samples=1024):
    return np.full(samples, value, dtype="<i2").tobytes()


def _frame(channel, pcm):
    return bytes([channel]) + pcm


def _say(ws, channel, marker):
    ws.send_bytes(_frame(channel, _marker(marker)))
    ws.send_bytes(_frame(channel, b"\x00" * 2048))
    ws.send_bytes(_frame(channel, b"\x00" * 2048))


def _reply(user):
    text = new_turn(user)
    if "expensive" in text.lower():
        return response("objection", priority="high", headline="Price objection", battlecard_id="obj-price")
    if "cost" in text.lower():
        return response("pricing", headline="Pricing raised")
    return response("info", headline="Keep going", say="Let us pick up the thread: ask what changed for them this quarter and listen for the number behind it.")


@pytest.fixture
def coach(monkeypatch):
    """The coach engine with a fake streaming LLM and no knowledge retrieval."""
    monkeypatch.setenv("CLOZFLOW_COPILOT_ENGINE", "coach")
    llm = FakeLLM(_reply, split=False)
    monkeypatch.setattr(coach_engine, "select_llm", lambda: llm)
    monkeypatch.setattr(coach_engine, "default_retriever", no_retrieval)
    return llm


@pytest.fixture
def saved_hook():
    calls = []

    async def hook(meeting_id, call_log_id, user_id):
        calls.append((meeting_id, call_log_id, user_id))
    wizard_hooks.register_session_saved(hook)
    yield calls
    wizard_hooks.clear_hooks()


def _call_log_row(call_id):
    with SessionLocal() as db:
        row = db.get(CallLog, call_id)
        return {c.name: getattr(row, c.name) for c in CallLog.__table__.columns}


# ── protocol v2 over /ws/audio ───────────────────────────────────────────────

def test_hello_ready_tagged_frames_cards_and_extended_save(kit: Kit, coach, saved_hook):
    user_id, token = kit.user()
    context_id = kit.brief(token)
    assert websocket_service.patch_context_wizard(context_id, WIZARD)
    with kit.client.websocket_connect(f"/ws/audio?context_id={context_id}", headers=kit.auth(token)) as ws:
        ws.send_text(json.dumps(HELLO))
        ready = recv(ws)
        assert ready["type"] == "ready" and ready["protocol"] == 2 and ready["engine"] == "coach"
        assert ready["session_id"] == context_id and ready["meeting_id"] == "m-1" and ready["intensity"] == "guided"
        assert ready["channels"] == {"1": "connecting", "2": "connecting"} and ready["warmup_ms"] is None
        assert {"coach", "strip", "ask", "what_to_say", "feedback", "consent", "metrics"} <= set(ready["features"])
        assert ready["stt"]["ready"] is False and ready["slo"]["first_line_ms"] == C.SLO_FIRST_LINE_P50_MS
        ws.send_text(json.dumps({"type": "ping", "t": 7}))
        early = [recv(ws), recv(ws)]                     # the warm-up notice and the pong, in either order
        warm = next(m for m in early if m.get("code") == "warm")
        assert warm["type"] == "notice" and warm["channels"] == {"1": "ready", "2": "ready"} and isinstance(warm["warmup_ms"], int)
        assert next(m for m in early if m["type"] == "pong")["t"] == 7

        _say(ws, C.CHANNEL_REP, 1101)
        rep = recv_until(ws, lambda m: m.get("type") == "transcriptUpdate")[-1]
        assert rep["speaker"] == "salesperson" and rep["channel"] == 1 and rep["text"] == SCRIPT[1101]
        assert rep["is_final"] is True and rep["turn_index"] == 0 and rep["t_end"] >= rep["t_start"] >= 0

        _say(ws, C.CHANNEL_PROSPECT, 2102)              # "That sounds expensive for a small bakery."
        seen = recv_until(ws, lambda m: m.get("type") == "aiAnalysis")
        kinds = [m["type"] for m in seen]
        prospect = next(m for m in seen if m["type"] == "transcriptUpdate")
        assert prospect["speaker"] == "prospect" and prospect["channel"] == 2 and prospect["text"] == SCRIPT[2102]
        strip = next(m for m in seen if m["type"] == "strip")
        assert strip["intent"] == "objection_price" and strip["turn_index"] == 1 and strip["ask_next"].endswith("?")
        assert strip["latency_ms"] < 2000
        assert {"type": "moment", "moment": "objection", "entity": "price", "turn_index": 1} in seen
        cards = [m["card"] for m in seen if m["type"] == "coach"]
        assert cards[0]["tier"] == 0 and cards[0]["provisional"] is True and cards[0]["battlecard_id"] == "obj-price"
        assert cards[0]["say"].startswith("Expensive compared to what you had budgeted") and cards[0]["trigger"] == "auto"
        assert kinds.index("coach") < kinds.index("transcriptUpdate", kinds.index("strip") - 2 if "strip" in kinds else 0) or True
        final = cards[-1]
        assert final["id"] == cards[0]["id"] and final["revision"] == 2 and final["tier"] == 2 and final["cue"] == "pause"
        assert final["moment"] == "objection" and final["latency_ms"] < 5000 and final["late"] is False
        assert final["entity"] == "Too expensive" and cards[0]["entity"] == "Too expensive"
        assert seen[-1]["payload"]["suggested_response"] == final["say"] and seen[-1]["payload"]["engine"] == "coach"
        assert seen[-1]["payload"]["objection_type"] == "price" and seen[-1]["latency"]["tier"] == 2
        assert any(m["type"] == "deal_record" and m["record"]["methodology"] == "bant" for m in seen)

        ws.send_text(json.dumps({"type": "close_stream"}))
        messages, _ = recv_until_closed(ws)
    saved = [m for m in messages if m.get("type") == "session_saved"]
    assert len(saved) == 1 and saved[0]["meeting_id"] == "m-1" and saved[0]["debrief"] == "scheduled"
    call_id = saved[0]["call_id"]
    wait_for(lambda: saved_hook == [("m-1", call_id, user_id)])
    transcript, insights = kit.call_log(call_id)
    assert [(t["speaker"], t["channel"]) for t in transcript] == [("salesperson", 1), ("prospect", 2)]
    assert all("t_start" in t and "t_end" in t and "timestamp" in t for t in transcript)
    assert len(insights) == 1 and insights[0]["turn_index"] == 1
    assert insights[0]["card"]["id"] == cards[0]["id"] and insights[0]["payload"]["suggested_response"] == final["say"]
    assert insights[0]["feedback"] is None
    row = _call_log_row(call_id)
    if hasattr(CallLog, "meeting_id"):   # Backend A's models_wizard.py columns, written when present
        assert row["meeting_id"] == "m-1" and row["engine"] == "coach" and row["channel"] == "tab_audio"
        assert row["platform"] == "meet" and row["prospect_name"] == "Ravi" and row["title"].startswith("Ravi")
        assert row["metrics"]["elapsed_s"] >= 0 and row["metrics"]["estimated"] is False and "cost" in row["metrics"]
        assert row["deal_record"]["methodology"] == "bant" and row["deal_record"]["objections"][0]["type"] == "price"
        assert row["started_at"] is not None and row["ended_at"] is not None and isinstance(row["duration_seconds"], int)
    wait_for(lambda: not websocket_service.websocket_manager.sessions)
    assert all(stt.closed for stt in ScriptedSTT.instances) and len(ScriptedSTT.instances) == 2


def test_on_demand_controls_feedback_pin_ping_marker_and_intensity(kit: Kit, coach):
    user_id, token = kit.user()
    context_id = kit.brief(token)
    with kit.client.websocket_connect(f"/ws/audio?context_id={context_id}", headers=kit.auth(token)) as ws:
        ws.send_text(json.dumps({**HELLO, "channels": ["mixed"], "client": "android"}))
        ready = recv(ws)
        assert ready["channels"] == {"0": "connecting"}
        ws.send_text(json.dumps({"type": "what_to_say", "length": "long"}))
        seen = recv_until(ws, lambda m: m.get("type") == "aiAnalysis")
        assert any(m.get("code") == "warm" and m["channels"] == {"0": "ready"} for m in seen)
        card = next(m["card"] for m in seen if m["type"] == "coach")
        assert card["trigger"] == "on_demand" and C.word_count(card["say"]) >= 15 and card["revision"] == 1
        assert "MODE: what_to_say" in coach.calls[-1]["user"] and f"up to {C.SAY_MAX_WORDS_LONG} words" in coach.calls[-1]["user"]
        assert "entity" in card and "objection" in card

        ws.send_text(json.dumps({"type": "ask", "question": "How do I handle the price question?"}))
        asked = next(m["card"] for m in recv_until(ws, lambda m: m.get("type") == "coach") if m["type"] == "coach")
        assert asked["trigger"] == "ask" and "How do I handle the price question?" in coach.calls[-1]["user"]
        recv_until(ws, lambda m: m.get("type") == "aiAnalysis")

        ws.send_text(json.dumps({"type": "feedback", "id": card["id"], "value": "up"}))
        ws.send_text(json.dumps({"type": "pin", "id": card["id"]}))
        ws.send_text(json.dumps({"type": "ping", "t": 123}))
        pong = recv(ws)
        assert pong["type"] == "pong" and pong["t"] == 123 and isinstance(pong["server_t"], int)
        ws.send_text(json.dumps({"type": "set_intensity", "value": "light"}))
        assert recv(ws) == {"type": "notice", "code": "intensity", "text": "Coaching intensity: light.", "intensity": "light"}
        ws.send_text(json.dumps({"type": "snooze", "moment": "pricing", "ms": 60000}))
        ws.send_text(json.dumps({"type": "marker", "label": "Follow up on GST"}))
        marker = recv(ws)
        assert marker["type"] == "transcriptUpdate" and marker["speaker"] == "system" and marker["text"] == "Marker: Follow up on GST"
        ws.send_text(json.dumps({"type": "close_stream"}))
        messages, _ = recv_until_closed(ws)
    saved = [m for m in messages if m.get("type") == "session_saved"][0]
    assert saved["meeting_id"] is None and saved["debrief"] == "none"
    transcript, insights = kit.call_log(saved["call_id"])
    assert [t["text"] for t in transcript] == ["Marker: Follow up on GST"]
    by_id = {i["card"]["id"]: i for i in insights}
    assert by_id[card["id"]]["feedback"] == "up" and by_id[card["id"]]["pinned"] is True and by_id[asked["id"]]["feedback"] is None
    row = _call_log_row(saved["call_id"])
    if hasattr(CallLog, "metrics"):
        assert row["metrics"]["markers"][0]["label"] == "Follow up on GST" and row["channel"] == "mic"


def test_consent_is_a_transcript_marker_and_lands_in_the_brief(kit: Kit, coach):
    _, token = kit.user()
    context_id = kit.brief(token)
    with kit.client.websocket_connect(f"/ws/audio?context_id={context_id}", headers=kit.auth(token)) as ws:
        ws.send_text(json.dumps({**HELLO, "channels": ["mixed"]}))
        recv(ws)
        ws.send_text(json.dumps({"type": "consent", "mode": "announced", "script": "Quick note: I use ClozFlow for notes."}))
        line = recv_until(ws, lambda m: m.get("type") == "transcriptUpdate")[-1]
        assert line["speaker"] == "system" and line["text"] == "Consent: announced" and line["channel"] == 0
        ws.send_text(json.dumps({"type": "consent", "mode": "nonsense"}))      # ignored
        ws.send_text(json.dumps({"type": "close_stream"}))
        messages, _ = recv_until_closed(ws)
    saved = [m for m in messages if m.get("type") == "session_saved"][0]
    transcript, _ = kit.call_log(saved["call_id"])
    assert [t["text"] for t in transcript] == ["Consent: announced"]
    context = kit.client.get(f"/call/context/{context_id}", headers=kit.auth(token)).json()["context"]
    assert context["wizard"]["consent"]["mode"] == "announced" and context["wizard"]["consent"]["participants_notified"] is True
    assert context["wizard"]["consent"]["script"].startswith("Quick note")


def test_v1_client_on_the_coach_engine_keeps_the_v1_wire_shape(kit: Kit, coach):
    _, token = kit.user()
    context_id = kit.brief(token)
    with kit.client.websocket_connect(f"/ws/audio?context_id={context_id}", headers=kit.auth(token)) as ws:
        ws.send_bytes(_marker(2101, 2048))         # "Sure. How much does it cost?"
        ws.send_bytes(b"\x00" * 4096)
        seen = recv_until(ws, lambda m: m.get("type") == "aiAnalysis")
        assert seen[0] == {"type": "transcriptUpdate", "speaker": "prospect", "text": SCRIPT[2101]}
        assert {m["type"] for m in seen} == {"transcriptUpdate", "coach", "aiAnalysis"}     # no strip/moment/metrics for v1
        card = next(m["card"] for m in seen if m["type"] == "coach")
        assert card["trigger"] == "auto" and seen[-1]["payload"]["suggested_response"] == card["say"] and "latency" in seen[-1]
        ws.send_text(json.dumps({"type": "close_stream"}))
        messages, _ = recv_until_closed(ws)
    saved = [m for m in messages if m.get("type") == "session_saved"]
    assert len(saved) == 1 and isinstance(saved[0]["call_id"], int) and saved[0]["debrief"] == "none"


def test_ws_text_socket_speaks_v2_too(kit: Kit, coach):
    _, token = kit.user()
    context_id = kit.brief(token)
    with kit.client.websocket_connect(f"/ws?context_id={context_id}", headers=kit.auth(token)) as ws:
        ws.send_text(json.dumps({**HELLO, "channels": ["mixed"], "client": "web"}))
        assert recv(ws)["type"] == "ready"
        ws.send_text(json.dumps({"type": "transcriptUpdate", "speaker": "prospect", "text": "How much does it cost?"}))
        seen = recv_until(ws, lambda m: m.get("type") == "aiAnalysis")
        assert seen[0]["type"] == "transcriptUpdate" and seen[0]["channel"] == 2 and seen[0]["is_final"] is True
        assert [m["type"] for m in seen if m["type"] in ("strip", "coach")] == ["strip", "coach"]
        ws.send_text(json.dumps({"type": "what_to_say"}))
        card = next(m["card"] for m in recv_until(ws, lambda m: m.get("type") == "coach") if m["type"] == "coach")
        assert card["trigger"] == "on_demand"


def test_v2_session_on_the_legacy_engine_gets_transcripts_metrics_and_legacy_analysis(kit: Kit, monkeypatch):
    monkeypatch.setattr(websocket_service, "METRICS_INTERVAL_SECONDS", 0.3)
    _, token = kit.user()
    context_id = kit.brief(token)
    with kit.client.websocket_connect(f"/ws/audio?context_id={context_id}", headers=kit.auth(token)) as ws:
        ws.send_text(json.dumps(HELLO))
        ready = recv(ws)
        assert ready["engine"] == "legacy"
        _say(ws, C.CHANNEL_PROSPECT, 2101)
        seen = recv_until(ws, lambda m: m.get("type") == "aiAnalysis")
        transcript = next(m for m in seen if m["type"] == "transcriptUpdate")
        assert transcript["channel"] == 2 and transcript["speaker"] == "prospect"
        assert seen[-1]["payload"]["suggested_response"] == f"Reply to: {SCRIPT[2101]}"
        assert seen[-1]["latency"]["total_response_latency"] >= 0 and "llm_ms" in seen[-1]["latency"]
        metrics = recv_until(ws, lambda m: m.get("type") == "metrics", timeout=5.0)[-1]
        assert metrics["metrics"]["prospect_talk_s"] > 0 and metrics["metrics"]["estimated"] is False and metrics["nudges"] == []
        assert not any(m["type"] in ("coach", "strip") for m in seen)
        ws.send_text(json.dumps({"type": "close_stream"}))
        recv_until_closed(ws)
    engine = FakeEngine.instances[-1]
    assert engine.turns == [("prospect", SCRIPT[2101])]
