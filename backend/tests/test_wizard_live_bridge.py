"""Bridged phone calls on the Meeting Wizard pipeline: channel-tagged tracks (inbound = rep = 1,
outbound = prospect = 2), the new messages on the app events socket with replay, and the spoken
disclosure pre-roll (Vobiz ``confirmSound``) with its consent record."""
import contextlib
import xml.etree.ElementTree as ET

import pytest

from test_bridge_kit import (  # noqa: F401  (fixtures)
    SCRIPT, Kit, bridge_service, engine_cls, kit, recv, recv_until, recv_until_closed, status_of, stt_cls, telephony, wait_for,
)
from test_wizard_live_coach import FakeLLM, new_turn, no_retrieval, response
from database import SessionLocal
from models import CallLog
from services.wizard import coach_engine

BRIDGE = "/api/copilot/bridge"


def _events_path(call_id, token=None):
    return f"{BRIDGE}/calls/{call_id}/events" + (f"?token={token}" if token else "")


def _parse_xml(text):
    return ET.fromstring(text.split("?>", 1)[1])


@pytest.fixture
def coach(monkeypatch):
    monkeypatch.setenv("CLOZFLOW_COPILOT_ENGINE", "coach")
    llm = FakeLLM(lambda user: response("pricing", headline="Pricing raised") if "cost" in new_turn(user).lower()
                  else response("objection", priority="high", headline="Objection"), split=False)
    monkeypatch.setattr(coach_engine, "select_llm", lambda: llm)
    monkeypatch.setattr(coach_engine, "default_retriever", no_retrieval)
    return llm


@contextlib.contextmanager
def connected_call(kit: Kit, call_id, app_ws, *, connected_events=("DialAnswer",)):
    """Answer → media socket → bridge. Yields (carrier path builder, media socket, answer XML);
    the media socket is always closed on exit so a failing assertion never stalls the TestClient."""
    path, carrier_token = kit.carrier()
    assert status_of(recv(app_ws)) == "ringing_rep"
    xml = kit.answer(path)
    assert [status_of(recv(app_ws)) for _ in range(2)] == ["rep_answered", "ringing_prospect"]
    with kit.client.websocket_connect(f"{BRIDGE}/vobiz/media?bid={call_id}&t={carrier_token}") as media:
        media.send_text(kit.start_event())
        wait_for(lambda: call_id in bridge_service.calls and bridge_service.calls[call_id].session is not None)
        for event in connected_events:
            kit.post(path, "dial-events", Event=event, DialAction="answer" if event == "DialAnswer" else "connected",
                     DialBLegUUID="b-leg-1", DialBLegStatus="answered")
        early = recv_until(app_ws, lambda m: status_of(m) == "connected")
        assert status_of(early[-1]) == "connected"
        yield path, media, xml, early


def test_bridge_events_carry_strip_cards_and_channels_with_replay(kit: Kit, coach):
    user_id, token = kit.user(credits=100)
    call_id = kit.start_call(token, kit.brief(token)).json()["call_id"]
    with kit.client.websocket_connect(_events_path(call_id), headers=kit.auth(token)) as app_ws:
        with connected_call(kit, call_id, app_ws) as (path, media, _, early):
            assert all(m["type"] == "callStatus" for m in early)     # no disclosure line when it is off
            kit.say(media, "inbound", 1101)
            rep = recv_until(app_ws, lambda m: m.get("type") == "transcriptUpdate")[-1]
            assert rep == {"type": "transcriptUpdate", "speaker": "salesperson", "text": SCRIPT[1101]}   # v1 wire shape kept
            kit.say(media, "outbound", 2101)                      # "Sure. How much does it cost?"
            seen = recv_until(app_ws, lambda m: m.get("type") == "aiAnalysis")
        assert {"type": "transcriptUpdate", "speaker": "prospect", "text": SCRIPT[2101]} in seen
        strip = next(m for m in seen if m["type"] == "strip")
        assert strip["intent"] == "pricing_question" and strip["turn_index"] == 1
        assert {"type": "moment", "moment": "pricing", "entity": None, "turn_index": 1} in seen
        card = next(m["card"] for m in seen if m["type"] == "coach")
        assert card["trigger"] == "auto" and card["moment"] == "pricing" and card["tier"] == 2
        assert seen[-1]["payload"]["suggested_response"] == card["say"]

        with kit.client.websocket_connect(_events_path(call_id, token)) as again:
            replay = recv_until(again, lambda m: m.get("type") == "strip")
        kinds = [m["type"] for m in replay]
        assert kinds[:3] == ["callStatus", "transcriptUpdate", "transcriptUpdate"] and "aiAnalysis" in kinds
        assert kinds.index("aiAnalysis") < kinds.index("coach") < kinds.index("strip")
        assert next(m for m in replay if m["type"] == "coach")["card"]["id"] == card["id"]

        kit.post(path, "hangup", Event="Hangup", CallStatus="completed", CallUUID="a-leg-1")
        messages, code = recv_until_closed(app_ws)
    assert code == 1000
    final_status = [m["call"] for m in messages if m.get("type") == "callStatus"][-1]
    assert final_status["call_log_id"] is not None
    assert any(m.get("type") == "metrics" and m.get("final") for m in messages)
    transcript, insights = kit.call_log(final_status["call_log_id"])
    assert [(t["speaker"], t["channel"]) for t in transcript] == [("salesperson", 1), ("prospect", 2)]
    assert len(insights) == 1 and insights[0]["card"]["id"] == card["id"]
    with SessionLocal() as db:
        row = db.get(CallLog, final_status["call_log_id"])
        if hasattr(CallLog, "channel"):
            assert row.channel == "phone_bridge" and row.engine == "coach" and row.metrics["estimated"] is False


def test_disclosure_is_off_by_default(kit: Kit):
    _, token = kit.user()
    kit.start_call(token, kit.brief(token))
    path, _ = kit.carrier()
    dial = _parse_xml(kit.answer(path)).find("Dial")
    assert dial.get("confirmSound") is None and dial.get("confirmKey") is None


def test_disclosure_gate_plays_confirm_sound_and_records_bridge_consent(kit: Kit, coach, monkeypatch):
    monkeypatch.setenv("COPILOT_BRIDGE_DISCLOSURE", "gate")
    _, token = kit.user(credits=100)
    call_id = kit.start_call(token, kit.brief(token)).json()["call_id"]
    with kit.client.websocket_connect(_events_path(call_id), headers=kit.auth(token)) as app_ws:
        with connected_call(kit, call_id, app_ws, connected_events=("DialAnswer", "DialConnected")) as (path, media, xml, early):
            dial = _parse_xml(xml).find("Dial")
            assert dial.get("confirmSound").startswith("https://copilot.example.test/api/copilot/bridge/vobiz/confirm?bid=")
            assert dial.get("confirmKey") == "1" and dial.get("confirmTimeout") == "8"
            confirm_path = dial.get("confirmSound").replace("https://copilot.example.test", "")
            spoken = kit.client.get(confirm_path)
            assert spoken.status_code == 200 and spoken.headers["content-type"].startswith("application/xml")
            speaks = [el.text for el in _parse_xml(spoken.text).findall("Speak")]
            assert len(speaks) == 2 and "ClozFlow" in speaks[0] and "Press 1" in speaks[0] and "1 dabayein" in speaks[1]
            assert kit.client.get(confirm_path.replace("&t=", "&t=x")).status_code == 403
            kit.say(media, "outbound", 2101)
            seen = early + recv_until(app_ws, lambda m: m.get("type") == "aiAnalysis")
            # the disclosure played by the carrier is the consent record (published as soon as the stream starts)
            assert {"type": "transcriptUpdate", "speaker": "system", "text": "Consent: bridge_disclosure"} in seen
            assert {"type": "transcriptUpdate", "speaker": "prospect", "text": SCRIPT[2101]} in seen
        kit.post(path, "hangup", Event="Hangup", CallStatus="completed", CallUUID="a-leg-1")
        messages, _ = recv_until_closed(app_ws)
    call_log_id = [m["call"] for m in messages if m.get("type") == "callStatus"][-1]["call_log_id"]
    transcript, _ = kit.call_log(call_log_id)
    assert [t["text"] for t in transcript][0] == "Consent: bridge_disclosure"
    with SessionLocal() as db:
        row = db.get(CallLog, call_log_id)
        if hasattr(CallLog, "metrics"):
            assert row.metrics["consent"]["mode"] == "bridge_disclosure"


def test_disclosure_on_without_gate_has_no_confirm_key(kit: Kit, monkeypatch):
    monkeypatch.setenv("COPILOT_BRIDGE_DISCLOSURE", "on")
    monkeypatch.setenv("COPILOT_BRIDGE_DISCLOSURE_TEXT", "Yeh call ClozFlow notes ke liye record ho rahi hai.")
    _, token = kit.user()
    kit.start_call(token, kit.brief(token))
    path, _ = kit.carrier()
    dial = _parse_xml(kit.answer(path)).find("Dial")
    assert dial.get("confirmSound") and dial.get("confirmKey") is None
    spoken = kit.client.get(dial.get("confirmSound").replace("https://copilot.example.test", "")).text
    assert [el.text for el in _parse_xml(spoken).findall("Speak")] == ["Yeh call ClozFlow notes ke liye record ho rahi hai."]
