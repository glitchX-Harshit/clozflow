"""Bridge call end to end: app API, carrier webhooks, media socket, pipeline, billing."""
import json
import xml.etree.ElementTree as ET

import pytest
from starlette.websockets import WebSocketDisconnect

from test_bridge_kit import (  # noqa: F401  (fixtures)
    SCRIPT, FakeBrainEngine, FailingSTT, Kit, bridge_service, engine_cls, kit, recv, recv_until,
    recv_until_closed, status_of, stt_cls, telephony, wait_for,
)

BRIDGE = "/api/copilot/bridge"


def _events_path(call_id, token=None):
    return f"{BRIDGE}/calls/{call_id}/events" + (f"?token={token}" if token else "")


def _parse_xml(text):
    return ET.fromstring(text.split("?>", 1)[1] if text.startswith("<?xml") else text)


# ── config ───────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("env, reason_part", [
    ({"VOBIZ_AUTH_ID": ""}, "phone provider account"),
    ({"VOBIZ_CALLER_ID": ""}, "caller ID"),
    ({"PEARL_PUBLIC_URL": ""}, "public HTTPS"),
    ({"PEARL_PUBLIC_URL": "https://circle-riverbank-mumbling.ngrok-free.dev/"}, "public HTTPS"),
    ({"PEARL_PUBLIC_URL": "http://copilot.example.test"}, "public HTTPS"),
    ({"PEARL_PUBLIC_URL": "https://localhost:8000"}, "public HTTPS"),
])
def test_config_disabled(kit: Kit, monkeypatch, env, reason_part):
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    _, token = kit.user()
    config = kit.client.get(f"{BRIDGE}/config", headers=kit.auth(token)).json()
    assert config["enabled"] is False and reason_part in config["reason"]
    response = kit.start_call(token, kit.brief(token))
    assert response.status_code == 503
    assert response.json() == {"detail": "Calling isn't set up on this server yet."}
    assert kit.telephony.placed == []


def test_config_enabled(kit: Kit, monkeypatch):
    monkeypatch.setenv("COPILOT_BRIDGE_RATE_PER_MINUTE", "2.5")
    _, token = kit.user()
    assert kit.client.get(f"{BRIDGE}/config").status_code == 401
    config = kit.client.get(f"{BRIDGE}/config", headers=kit.auth(token)).json()
    assert config == {"enabled": True, "reason": None, "rate_per_minute": 2.5, "min_balance": 2.5,
                      "max_minutes": 60, "country_default": "+91"}


# ── validation ───────────────────────────────────────────────────────────────

def test_create_validation_errors(kit: Kit):
    user_id, token = kit.user(credits=100)
    context_id = kit.brief(token)

    def detail(response):
        return response.status_code, response.json()["detail"]

    assert detail(kit.start_call(token, context_id, prospect="12ab")) == \
        (400, "Enter a valid phone number for the prospect.")
    assert detail(kit.start_call(token, context_id, prospect="1234567")) == \
        (400, "Enter a valid phone number for the prospect.")
    assert detail(kit.start_call(token, context_id, rep="+91 98765.43210")) == \
        (400, "Enter a valid phone number for your phone.")
    assert detail(kit.start_call(token, context_id, prospect="9876543210", rep="+91 (98765) 43210")) == \
        (400, "Your number and the prospect's number must be different.")
    assert detail(kit.start_call(token, "no-such-brief")) == \
        (404, "Call brief not found or expired. Start the briefing again.")
    _, other_token = kit.user()
    assert detail(kit.start_call(other_token, context_id)) == \
        (404, "Call brief not found or expired. Start the briefing again.")

    _, poor_token = kit.user(credits=2.0)
    assert detail(kit.start_call(poor_token, kit.brief(poor_token))) == \
        (402, "Not enough wallet credits to place a call. You need at least ₹3.")

    first = kit.start_call(token, context_id)
    assert first.status_code == 201
    second = kit.start_call(token, context_id, prospect="9000000001")
    assert second.status_code == 409
    assert second.json() == {"detail": "You already have a call in progress.", "call_id": first.json()["call_id"]}
    assert len(kit.telephony.placed) == 1


def test_provider_failure_is_502_and_ends_the_row(kit: Kit):
    from database import SessionLocal
    from models_bridge import CopilotBridgeCall
    user_id, token = kit.user()
    kit.telephony.place_ok = False
    response = kit.start_call(token, kit.brief(token))
    assert response.status_code == 502
    assert response.json() == {"detail": "The phone provider couldn't place the call. Try again in a moment."}
    with SessionLocal() as db:
        rows = db.query(CopilotBridgeCall).filter(CopilotBridgeCall.user_id == user_id).all()
        assert [(row.status, row.reason) for row in rows] == [("ended", "telephony_error")]
    assert kit.client.get(f"{BRIDGE}/calls/does-not-exist", headers=kit.auth(token)).status_code == 404
    # The failed attempt is over, so a retry isn't blocked by 409.
    kit.telephony.place_ok = True
    assert kit.start_call(token, kit.brief(token)).status_code == 201


# ── the happy path ───────────────────────────────────────────────────────────

def _run_connected_call(kit: Kit, token, call_id):
    """Answer → media → bridge → three turns, checked on its own app socket.
    Returns (carrier path builder, the prospect turn's analysis)."""
    path, _ = kit.carrier()
    with kit.client.websocket_connect(_events_path(call_id), headers=kit.auth(token)) as app_ws:
        assert status_of(recv(app_ws)) == "ringing_rep"

        xml = kit.answer(path)
        root = _parse_xml(xml)
        assert [child.tag for child in root] == ["Speak", "Stream", "Dial", "Hangup"]
        stream, dial = root.find("Stream"), root.find("Dial")
        assert stream.get("bidirectional") == "false" and stream.get("audioTrack") == "both"
        assert stream.get("contentType") == "audio/x-l16;rate=16000"
        assert stream.text.startswith("wss://copilot.example.test/api/copilot/bridge/vobiz/media?bid=")
        assert stream.get("statusCallbackUrl").startswith("https://copilot.example.test/api/copilot/bridge/vobiz/stream-status?")
        assert dial.get("callerId") == "+918000000001" and dial.get("timeout") == "40"
        assert dial.get("redirect") == "false"
        assert dial.find("Number").text == "+919876543210"
        assert [status_of(recv(app_ws)) for _ in range(2)] == ["rep_answered", "ringing_prospect"]

        media_path = stream.text.replace("wss://copilot.example.test", "")
        with kit.client.websocket_connect(media_path) as media:
            media.send_text(kit.start_event())
            # Ringback on the prospect track before the bridge, then >1 s of silence.
            kit.send(media, [(0, 2999)] * 20 + [(0, 0)] * 60)
            wait_for(lambda: call_id in bridge_service.calls and bridge_service.calls[call_id].session is not None)
            kit.post(path, "dial-events", Event="DialAnswer", DialAction="answer", DialBLegUUID="b-leg-1",
                     DialBLegStatus="answered")
            assert status_of(recv(app_ws)) == "connected"

            kit.say(media, "inbound", 1101)
            seen = recv_until(app_ws, lambda m: m.get("type") == "transcriptUpdate")
            assert seen[-1] == {"type": "transcriptUpdate", "speaker": "salesperson", "text": SCRIPT[1101]}

            kit.say(media, "outbound", 2101)
            seen = recv_until(app_ws, lambda m: m.get("type") == "aiAnalysis")
            transcript = [m for m in seen if m.get("type") == "transcriptUpdate"]
            assert transcript == [{"type": "transcriptUpdate", "speaker": "prospect", "text": SCRIPT[2101]}]
            analysis = seen[-1]["payload"]
            assert SCRIPT[2101] in analysis["suggested_response"]

            kit.say(media, "inbound", 1102)
            seen = recv_until(app_ws, lambda m: m.get("type") == "transcriptUpdate")
            assert seen[-1]["speaker"] == "salesperson" and seen[-1]["text"] == SCRIPT[1102]
        live = bridge_service.calls[call_id]
        wait_for(lambda: len(live.session.transcripts) == 3)
        return path, analysis


def test_happy_path_legacy_engine(kit: Kit):
    user_id, token = kit.user(credits=100)
    response = kit.start_call(token, kit.brief(token))
    assert response.status_code == 201, response.text
    call = response.json()
    assert call["status"] == "ringing_rep" and call["reason"] is None and call["detail"] == "Calling your phone…"
    assert call["prospect_phone_masked"] == "+91•••••43210" and call["rep_phone_masked"] == "+91•••••12345"
    assert call["created_at"].endswith("Z") and call["connected_at"] is None and call["call_log_id"] is None
    placed = kit.telephony.placed[0]
    assert placed["to"] == "+919123412345" and placed["caller_id"] == "+918000000001"
    assert placed["answer_url"].startswith("https://copilot.example.test/api/copilot/bridge/vobiz/answer?bid=")
    call_id = call["call_id"]

    path, _ = kit.carrier()
    with kit.client.websocket_connect(_events_path(call_id), headers=kit.auth(token)) as app_ws:
        assert status_of(recv(app_ws)) == "ringing_rep"
        # (the scripted flow runs on a second socket, so this one keeps every message)
        path, analysis = _run_connected_call(kit, token, call_id)

        # App reconnect: status, the transcript so far (in order), the latest analysis.
        with kit.client.websocket_connect(_events_path(call_id, token)) as again:
            replay = [recv(again) for _ in range(5)]
        assert status_of(replay[0]) == "connected"
        assert [(m["speaker"], m["text"]) for m in replay[1:4]] == [
            ("salesperson", SCRIPT[1101]), ("prospect", SCRIPT[2101]), ("salesperson", SCRIPT[1102])]
        assert replay[4]["type"] == "aiAnalysis" and replay[4]["payload"] == analysis

        # Prospect hangs up: dial result, then the rep leg's hangup — delivered twice.
        kit.post(path, "dial-result", DialStatus="completed", DialHangupCause="NORMAL_CLEARING",
                 DialBLegUUID="b-leg-1")
        for _ in range(2):
            kit.post(path, "hangup", Event="Hangup", CallStatus="completed", CallUUID="a-leg-1",
                     HangupCause="NORMAL_CLEARING")
        messages, code = recv_until_closed(app_ws)
    assert code == 1000
    statuses = [m["call"] for m in messages if m.get("type") == "callStatus"]
    assert statuses[-1]["status"] == "ended" and statuses[-1]["reason"] == "completed"
    assert statuses[-1]["call_log_id"] is not None and statuses[-1]["charged_credits"] == 3.0

    final = kit.client.get(f"{BRIDGE}/calls/{call_id}", headers=kit.auth(token)).json()
    assert final["status"] == "ended" and final["reason"] == "completed" and final["detail"] == "Call ended."
    assert final["ended_at"].endswith("Z") and final["connected_at"].endswith("Z")
    assert 1 <= final["duration_seconds"] < 60
    assert final["charged_credits"] == 3.0 and final["call_log_id"] == statuses[-1]["call_log_id"]
    # Billed exactly once despite the duplicated webhooks.
    assert kit.balance(user_id) == 97.0 and kit.consumption(user_id) == [-3.0]

    transcript, insights = kit.call_log(final["call_log_id"])
    assert [(t["speaker"], t["text"]) for t in transcript] == [
        ("salesperson", SCRIPT[1101]), ("prospect", SCRIPT[2101]), ("salesperson", SCRIPT[1102])]
    assert len(insights) == 1 and insights[0]["turn_index"] == 1
    assert "RINGBACK" not in json.dumps(transcript)

    engine = [e for e in FakeEngine_instances() if e.call_context and e.call_context.get("_context_id") == f"bridge-{call_id}"][0]
    assert ("salesperson", SCRIPT[1101]) in engine.turns and ("salesperson", SCRIPT[1102]) in engine.turns
    assert [t for t in engine.turns if t[0] == "prospect"] == [("prospect", SCRIPT[2101])]
    assert engine.learning_log is False   # prospect's words never go to the learning log
    assert kit.telephony.hangups == []    # the carrier ended it; no REST hang-up needed


def FakeEngine_instances():
    from test_bridge_kit import FakeEngine
    return FakeEngine.instances


def test_happy_path_brain_engine(kit: Kit, engine_cls):
    engine_cls["cls"] = FakeBrainEngine
    user_id, token = kit.user(credits=100)
    call_id = kit.start_call(token, kit.brief(token)).json()["call_id"]
    with kit.client.websocket_connect(_events_path(call_id), headers=kit.auth(token)) as app_ws:
        path, analysis = _run_connected_call(kit, token, call_id)
        assert analysis["deal_signal"] == 64 and analysis["brain_status"] == "complete"
        kit.post(path, "hangup", Event="Hangup", CallStatus="completed", CallUUID="a-leg-1")
        messages, code = recv_until_closed(app_ws)
    assert code == 1000
    types = [m["type"] for m in messages]
    assert "session_ended" in types and types.index("session_ended") < len(types)
    ended = [m for m in messages if m["type"] == "session_ended"][0]
    assert ended["brain_session_id"] == "brain-session-1"
    # Salesperson turns reached the Brain as salesperson turns but produced no aiAnalysis.
    brain = [e for e in FakeEngine_instances() if isinstance(e, FakeBrainEngine)][0]
    assert [speaker for speaker, _ in brain.turns] == ["salesperson", "prospect", "salesperson"]
    assert brain.closed is True   # finalized at hangup
    analyses = [m for m in messages if m["type"] == "aiAnalysis"]
    assert all(m["payload"].get("brain_status") != "recorded" for m in analyses)
    assert kit.consumption(user_id) == [-3.0]


# ── hang-up / cancel / failures ─────────────────────────────────────────────

def test_app_hangup_is_idempotent(kit: Kit):
    _, token = kit.user()
    call_id = kit.start_call(token, kit.brief(token)).json()["call_id"]
    first = kit.client.post(f"{BRIDGE}/calls/{call_id}/hangup", headers=kit.auth(token))
    assert first.status_code == 200
    assert first.json()["status"] == "ended" and first.json()["reason"] == "cancelled"
    assert kit.telephony.hangups == ["req-1"]
    second = kit.client.post(f"{BRIDGE}/calls/{call_id}/hangup", headers=kit.auth(token))
    assert second.status_code == 200 and second.json() == first.json()
    assert kit.telephony.hangups == ["req-1"]
    # A late answer from the carrier is told to hang up.
    path, _ = kit.carrier()
    assert _parse_xml(kit.answer(path)).find("Hangup") is not None
    assert _parse_xml(kit.answer(path)).find("Dial") is None
    # Somebody else can't see or hang up the call.
    _, other = kit.user()
    assert kit.client.get(f"{BRIDGE}/calls/{call_id}", headers=kit.auth(other)).status_code == 404
    assert kit.client.post(f"{BRIDGE}/calls/{call_id}/hangup", headers=kit.auth(other)).status_code == 404


def test_rep_never_answers(kit: Kit):
    user_id, token = kit.user()
    call_id = kit.start_call(token, kit.brief(token)).json()["call_id"]
    path, _ = kit.carrier()
    with kit.client.websocket_connect(_events_path(call_id), headers=kit.auth(token)) as app_ws:
        assert status_of(recv(app_ws)) == "ringing_rep"
        kit.post(path, "hangup", Event="Hangup", CallStatus="no-answer", CallUUID="a-leg-1",
                 HangupCause="NO_ANSWER")
        messages, code = recv_until_closed(app_ws)
    assert code == 1000
    assert messages[-1]["call"]["status"] == "ended" and messages[-1]["call"]["reason"] == "rep_no_answer"
    final = kit.client.get(f"{BRIDGE}/calls/{call_id}", headers=kit.auth(token)).json()
    assert final["charged_credits"] == 0.0 and final["duration_seconds"] == 0 and final["call_log_id"] is None
    assert kit.consumption(user_id) == [] and kit.call_logs(user_id) == 0


@pytest.mark.parametrize("params, reason", [
    ({"CallStatus": "busy", "HangupCause": "USER_BUSY"}, "rep_busy"),
    ({"CallStatus": "completed", "HangupCauseName": "Rejected"}, "rep_busy"),
    ({"CallStatus": "failed", "HangupCause": "UNALLOCATED_NUMBER"}, "rep_failed"),
])
def test_rep_leg_reasons(kit: Kit, params, reason):
    _, token = kit.user()
    call_id = kit.start_call(token, kit.brief(token)).json()["call_id"]
    path, _ = kit.carrier()
    kit.post(path, "hangup", Event="Hangup", **params)
    assert kit.client.get(f"{BRIDGE}/calls/{call_id}", headers=kit.auth(token)).json()["reason"] == reason


def test_prospect_busy(kit: Kit):
    user_id, token = kit.user()
    call_id = kit.start_call(token, kit.brief(token)).json()["call_id"]
    path, _ = kit.carrier()
    kit.answer(path)
    kit.post(path, "dial-events", Event="DialHangup", DialAction="hangup", DialBLegHangupCause="USER_BUSY")
    kit.post(path, "dial-result", DialStatus="busy", DialHangupCause="USER_BUSY")
    final = kit.client.get(f"{BRIDGE}/calls/{call_id}", headers=kit.auth(token)).json()
    assert final["status"] == "ended" and final["reason"] == "prospect_busy"
    assert final["detail"] == "The prospect's line was busy or they declined."
    # The rep leg's hangup afterwards changes nothing.
    kit.post(path, "hangup", Event="Hangup", CallStatus="completed", CallUUID="a-leg-1")
    again = kit.client.get(f"{BRIDGE}/calls/{call_id}", headers=kit.auth(token)).json()
    assert again["reason"] == "prospect_busy" and again["charged_credits"] == 0.0
    assert kit.consumption(user_id) == []


def test_timeout_when_carrier_goes_quiet(kit: Kit):
    _, token = kit.user()
    call_id = kit.start_call(token, kit.brief(token)).json()["call_id"]
    kit.sweep(30)
    assert kit.row(call_id)["status"] == "ringing_rep"
    kit.sweep(91)   # (also expires other tests' abandoned rows in the shared test DB)
    row = kit.row(call_id)
    assert row["status"] == "ended" and row["reason"] == "timeout"
    assert row["vobiz_request_uuid"] in kit.telephony.hangups   # the carrier leg is cancelled too


def test_server_restart_cleanup(kit: Kit):
    from datetime import timedelta
    from database import SessionLocal
    from models_bridge import CopilotBridgeCall
    from services.bridge.service import utcnow
    user_id, _ = kit.user()
    stale_id, fresh_id = "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"
    with SessionLocal() as db:
        for call_id, age in ((stale_id, 30), (fresh_id, 2)):
            created = utcnow() - timedelta(minutes=age)
            db.add(CopilotBridgeCall(id=call_id, user_id=user_id, context_id="c", status="connected",
                                     prospect_phone_e164="+919876543210", rep_phone_e164="+919123412345",
                                     token_hash="0" * 64, created_at=created, status_changed_at=created,
                                     connected_at=created))
        db.commit()
    kit.client.portal.call(bridge_service.startup)
    assert kit.row(stale_id)["status"] == "ended" and kit.row(stale_id)["reason"] == "server_restart"
    assert kit.row(fresh_id)["status"] == "connected"


# ── security ─────────────────────────────────────────────────────────────────

def test_carrier_token_rejection(kit: Kit):
    _, token = kit.user()
    call_id = kit.start_call(token, kit.brief(token)).json()["call_id"]
    path, carrier_token = kit.carrier()
    for name in ("answer", "hangup", "dial-events", "dial-result", "stream-status"):
        assert kit.client.post(path(name, t="wrong-token")).status_code == 403
        assert kit.client.get(path(name, t="")).status_code == 403
        assert kit.client.post(path(name, b="00000000-0000-4000-8000-00000000dead")).status_code == 403
    assert kit.row(call_id)["status"] == "ringing_rep"
    with kit.client.websocket_connect(f"{BRIDGE}/vobiz/media?bid={call_id}&t=nope") as media:
        with pytest.raises(WebSocketDisconnect) as closed:
            media.receive_text()
    assert closed.value.code == 1008
    # Stored hashed, never in clear.
    assert carrier_token not in json.dumps(kit.row(call_id), default=str)


def test_single_media_socket_and_none_after_end(kit: Kit):
    _, token = kit.user()
    call_id = kit.start_call(token, kit.brief(token)).json()["call_id"]
    path, carrier_token = kit.carrier()
    kit.answer(path)
    media_path = f"{BRIDGE}/vobiz/media?bid={call_id}&t={carrier_token}"
    with kit.client.websocket_connect(media_path) as first:
        first.send_text(kit.start_event())
        wait_for(lambda: bridge_service.calls[call_id].media_socket is not None)
        with kit.client.websocket_connect(media_path) as second:
            with pytest.raises(WebSocketDisconnect) as closed:
                second.receive_text()
        assert closed.value.code == 1008
        # Malformed frames are ignored; the socket stays usable.
        for bad in ("not json", "[]", json.dumps({"event": "media", "media": {"track": "inbound", "payload": "%%%"}}),
                    json.dumps({"event": "media", "media": {"track": "sideways", "payload": "AAAA"}}),
                    json.dumps({"event": "media", "media": "x"})):
            first.send_text(bad)
        first.send_bytes(b"\x00\x01")
        kit.send(first, [(0, 0)] * 3)
        wait_for(lambda: bridge_service.calls[call_id].bad_frames >= 5)
    kit.client.post(f"{BRIDGE}/calls/{call_id}/hangup", headers=kit.auth(token))
    with kit.client.websocket_connect(media_path) as late:
        with pytest.raises(WebSocketDisconnect) as closed:
            late.receive_text()
    assert closed.value.code == 1008


def test_app_socket_auth(kit: Kit):
    _, token = kit.user()
    call_id = kit.start_call(token, kit.brief(token)).json()["call_id"]
    with kit.client.websocket_connect(_events_path(call_id)) as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
    assert closed.value.code == 4401
    _, other = kit.user()
    with kit.client.websocket_connect(_events_path(call_id), headers=kit.auth(other)) as ws:
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
    assert closed.value.code == 4404
    with kit.client.websocket_connect(_events_path(call_id, token)) as ws:
        assert status_of(recv(ws)) == "ringing_rep"
        ws.send_text(json.dumps({"type": "ping"}))
        ws.send_text("garbage")


def test_superuser_is_not_charged(kit: Kit):
    user_id, token = kit.user(credits=0.0, superuser=True)
    call_id = kit.start_call(token, kit.brief(token)).json()["call_id"]
    path, _ = kit.carrier()
    kit.answer(path)
    kit.post(path, "dial-events", Event="DialAnswer", DialBLegUUID="b-leg-1")
    kit.post(path, "hangup", Event="Hangup", CallStatus="completed")
    wait_for(lambda: kit.row(call_id)["billed_at"] is not None)
    assert kit.row(call_id)["charged_credits"] == 0.0 and kit.balance(user_id) == 0.0
    assert kit.consumption(user_id) == []


def test_wallet_caps_the_call_length(kit: Kit):
    _, token = kit.user(credits=10.0)
    call = kit.start_call(token, kit.brief(token)).json()
    path, _ = kit.carrier()
    dial = _parse_xml(kit.answer(path)).find("Dial")
    assert dial.get("timeLimit") == "180"   # ₹10 at ₹3/min → 3 whole minutes
    kit.post(path, "dial-events", Event="DialAnswer")
    detail = kit.client.get(f"{BRIDGE}/calls/{call['call_id']}", headers=kit.auth(token)).json()["detail"]
    assert detail == "Live · ends after 3 min (wallet balance)"


def test_stt_failure_keeps_the_call_up(kit: Kit, stt_cls):
    stt_cls["cls"] = FailingSTT
    _, token = kit.user()
    call_id = kit.start_call(token, kit.brief(token)).json()["call_id"]
    path, carrier_token = kit.carrier()
    kit.answer(path)
    with kit.client.websocket_connect(f"{BRIDGE}/vobiz/media?bid={call_id}&t={carrier_token}") as media:
        media.send_text(kit.start_event())
        kit.post(path, "dial-events", Event="DialAnswer")
        kit.say(media, "outbound", 2101)
    assert kit.row(call_id)["status"] == "connected"
    kit.post(path, "hangup", Event="Hangup", CallStatus="completed")
    wait_for(lambda: kit.row(call_id)["call_log_id"] is not None)
