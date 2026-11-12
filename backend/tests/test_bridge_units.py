"""Unit tests: phone rules, answer XML, carrier audio decoding, config, hang-up reasons."""
import base64
import xml.etree.ElementTree as ET

import numpy as np
import pytest

import test_bridge_kit  # noqa: F401  (test environment first)
from services.bridge import config as bridge_config
from services.bridge.audio import FrameDecoder, PcmChunker, Preroll, parse_media_format
from services.bridge.phones import mask_phone, normalize_phone
from services.bridge.service import dial_reason, dial_status_from_cause, rep_reason, serialize
from services.bridge.xml_builder import answer_xml


@pytest.mark.parametrize("raw, expected", [
    ("9876543210", "+919876543210"),
    ("98765 43210", "+919876543210"),
    ("(98765) 432-10", "+919876543210"),
    ("09876543210", "+919876543210"),
    ("+91 98765-43210", "+919876543210"),
    ("919876543210", "+919876543210"),
    ("+1 415 555 0100", "+14155550100"),
    ("0044 20 7946 0958", "+442079460958"),
    (9876543210, "+919876543210"),
    ("+12345678", "+12345678"),
    ("1234567", None), ("+1234567890123456", None), ("98765.43210", None), ("+91+98765", None),
    ("98765+43210", None), ("abc", None), ("", None), (None, None), (True, None), ("+0123456789", None),
])
def test_normalize_phone(raw, expected):
    assert normalize_phone(raw) == expected


def test_mask_phone():
    assert mask_phone("+919876543210") == "+91•••••43210"
    assert mask_phone("+14155550100") == "+1•••••50100"
    assert mask_phone("+12345678") == "+1•••5678"
    assert mask_phone(None) is None


def test_answer_xml_escapes_everything():
    xml = answer_xml(stream_url="wss://h/api/x/media?bid=1&t=a<b", stream_status_url='https://h/s?bid=1&t="q"',
                     caller_id="+918000000001", prospect_e164="+919876543210", max_seconds=600,
                     dial_events_url="https://h/e?bid=1&t=x", dial_result_url="https://h/r?bid=1&t=x")
    assert "&t=" not in xml and "&amp;t=" in xml and "a&lt;b" in xml and "&quot;q&quot;" in xml
    root = ET.fromstring(xml.split("?>", 1)[1])
    assert [child.tag for child in root] == ["Speak", "Stream", "Dial", "Hangup"]
    assert root.find("Stream").text == "wss://h/api/x/media?bid=1&t=a<b"
    assert root.find("Stream").get("statusCallbackUrl") == 'https://h/s?bid=1&t="q"'
    dial = root.find("Dial")
    assert dial.get("timeLimit") == "600" and dial.get("action") == "https://h/r?bid=1&t=x"
    assert dial.get("callbackUrl") == "https://h/e?bid=1&t=x" and dial.get("method") == "POST"


def _b64(samples, dtype="<i2"):
    return base64.b64encode(np.asarray(samples, dtype=dtype).tobytes()).decode()


def test_frame_decoder_formats():
    pcm = np.array([0, 1000, -1000, 32767], dtype="<i2")
    little = FrameDecoder(byte_order="little")
    assert np.array_equal(np.frombuffer(little.decode(_b64(pcm)), "<i2"), pcm)
    big = FrameDecoder(byte_order="big")
    assert np.array_equal(np.frombuffer(big.decode(_b64(pcm, ">i2")), "<i2"), pcm)
    eight = FrameDecoder("audio/x-l16", 8000)
    out = np.frombuffer(eight.decode(_b64([100, 200])), "<i2")
    assert out.tolist() == [50, 100, 150, 200]     # 2× samples, continuous from silence
    mulaw = FrameDecoder("audio/x-mulaw", 8000)
    decoded = np.frombuffer(mulaw.decode(base64.b64encode(bytes([0xFF, 0x7F, 0x00])).decode()), "<i2")
    assert decoded.size == 6 and decoded[1] == 0 and decoded[5] == -32124
    for bad in ("%%%", "", None, 42, "A" * 50_000):
        assert little.decode(bad) is None
    assert little.decode(base64.b64encode(b"\x01\x02\x03").decode()) == b"\x01\x02"   # odd byte dropped


def test_chunker_and_preroll():
    chunker = PcmChunker(2048)
    assert chunker.push(b"\x01" * 1500) == []
    chunks = chunker.push(b"\x02" * 3000)
    assert [len(c) for c in chunks] == [2048, 2048] and len(chunker.flush()) == 2048 and chunker.flush() is None
    preroll = Preroll(seconds=0.1)
    for i in range(10):
        preroll.add(bytes([i]))
    assert preroll.drain() == [bytes([i]) for i in range(5, 10)] and preroll.drain() == []


def test_public_url_rules():
    assert bridge_config.normalize_public_url("https://Copilot.Example.com/") == "https://copilot.example.com"
    assert bridge_config.normalize_public_url("https://x.example.com:8443/base/") == "https://x.example.com:8443/base"
    for bad in ("", "http://x.example.com", "https://localhost", "https://127.0.0.1", "https://10.0.0.5",
                "https://u:p@x.example.com", "https://x.example.com/?a=1",
                "https://circle-riverbank-mumbling.ngrok-free.dev"):
        assert bridge_config.normalize_public_url(bad) is None, bad
    assert bridge_config.normalize_caller_id("+91 80000 00001") == "+918000000001"
    assert bridge_config.normalize_caller_id("abc") is None


def test_reason_classification():
    assert rep_reason({"CallStatus": "no-answer"}) == "rep_no_answer"
    assert rep_reason({"CallStatus": "completed", "HangupCause": "USER_BUSY"}) == "rep_busy"
    assert rep_reason({"HangupCause": "CALL_REJECTED"}) == "rep_busy"
    assert rep_reason({"HangupCause": "UNALLOCATED_NUMBER"}) == "rep_failed"
    assert rep_reason({}) == "rep_no_answer"
    assert dial_reason("busy") == "prospect_busy" and dial_reason("no-answer") == "prospect_no_answer"
    assert dial_reason("timeout") == "prospect_no_answer" and dial_reason("failed") == "prospect_failed"
    assert dial_reason("cancel") == "cancelled" and dial_reason("completed") == "completed"
    assert dial_reason(None) is None and dial_reason("weird") == "prospect_failed"
    assert dial_status_from_cause({"DialBLegHangupCause": "NO_ANSWER"}) == "no-answer"
    assert dial_status_from_cause({}) is None


def test_serialize_contract_shape():
    from datetime import datetime
    row = {"id": "c1", "context_id": "x", "status": "ringing_prospect", "reason": None, "prospect_name": None,
           "prospect_phone_e164": "+919876543210", "rep_phone_e164": "+919123412345",
           "created_at": datetime(2026, 11, 12, 10, 0, 0, 123456), "connected_at": None, "ended_at": None,
           "duration_seconds": 0, "charged_credits": 0, "call_log_id": None, "max_seconds": 600}
    data = serialize(row)
    assert list(data) == ["call_id", "context_id", "status", "reason", "detail", "prospect_name",
                          "prospect_phone_masked", "rep_phone_masked", "created_at", "connected_at", "ended_at",
                          "duration_seconds", "charged_credits", "call_log_id"]
    assert data["created_at"] == "2026-11-12T10:00:00Z" and data["detail"] == "Calling the prospect…"
    assert data["charged_credits"] == 0.0 and isinstance(data["charged_credits"], float)


# ── Vobiz wire format (https://www.vobiz.ai/docs/xml/stream) ─────────────────

def test_answer_xml_stream_attributes_match_vobiz_docs():
    xml = answer_xml(stream_url="wss://h/m", stream_status_url="https://h/s", caller_id="+918000000001",
                     prospect_e164="+919876543210", max_seconds=600, dial_events_url="https://h/e",
                     dial_result_url="https://h/r")
    stream = ET.fromstring(xml.split("?>", 1)[1]).find("Stream")
    # Listen-only fork of both legs: "both" is only valid with bidirectional="false", and
    # keepCallAlive requires bidirectional="true", so it must not be set (the Dial follows).
    assert stream.get("bidirectional") == "false" and stream.get("audioTrack") == "both"
    assert stream.get("keepCallAlive") in (None, "false")
    assert stream.get("contentType") in ("audio/x-l16;rate=8000", "audio/x-l16;rate=16000", "audio/x-mulaw;rate=8000")
    assert 0 <= int(stream.get("maxRetries")) <= 10 and int(stream.get("streamTimeout")) > 0
    assert stream.get("statusCallbackMethod") in ("GET", "POST")


@pytest.mark.parametrize("media_format, expected", [
    ({"encoding": "audio/x-l16", "sampleRate": 16000}, ("audio/x-l16", 16000)),
    ({"encoding": "audio/x-mulaw", "sampleRate": "8000"}, ("audio/x-mulaw", 8000)),
    ({"encoding": "audio/x-l16;rate=8000"}, ("audio/x-l16", 8000)),
    ("audio/x-mulaw;rate=8000", ("audio/x-mulaw", 8000)),
    ({"sampleRate": 8000}, (None, 8000)),
    ({}, (None, None)), (None, (None, None)), ({"encoding": 5, "sampleRate": "x"}, (None, None)),
])
def test_parse_media_format(media_format, expected):
    assert parse_media_format(media_format) == expected


def test_decoder_keeps_its_rate_when_the_format_omits_it():
    decoder = FrameDecoder("audio/x-l16", 8000)
    decoder.configure("audio/x-l16", None)
    assert decoder.sample_rate == 8000
    decoder.configure("audio/x-mulaw", None)
    assert (decoder.encoding, decoder.sample_rate) == ("audio/x-mulaw", 8000)


def _speech_frames(count=20, rate=16000):
    t = np.arange(count * rate // 50) / rate
    signal = (3000 * np.sin(2 * np.pi * 300 * t) + 800 * np.sin(2 * np.pi * 1100 * t)).astype(np.int16)
    return [signal[i:i + rate // 50] for i in range(0, signal.size, rate // 50)]


@pytest.mark.parametrize("wire_dtype, order", [("<i2", "little"), (">i2", "big")])
def test_auto_byte_order_detects_the_wire_order(wire_dtype, order):
    decoder = FrameDecoder("audio/x-l16", 16000, byte_order="auto")
    frames = _speech_frames()
    outputs = [decoder.decode(_b64(frame, wire_dtype)) for frame in frames]
    assert decoder.byte_order == order
    assert np.array_equal(np.frombuffer(outputs[-1], "<i2"), frames[-1])   # decoded correctly once decided


def test_auto_byte_order_on_the_frame_from_vobiz_docs_stays_little():
    # Real inbound payload from Vobiz's Bun media-stream example (low-level noise ±8, little-endian).
    payload = "+P/4/wgACAAIAAgA+P/o//j/+P/4//j/CAAIAAgACAAIAAgACAAIAPj/"
    decoder = FrameDecoder("audio/x-l16", 16000, byte_order="auto")
    for _ in range(20):
        decoder.decode(payload)
    assert decoder.byte_order == "little"
    assert np.abs(np.frombuffer(decoder.decode_native(payload), "<i2")).max() <= 24


def test_auto_byte_order_ignores_digital_silence_and_env_pins_it(monkeypatch):
    decoder = FrameDecoder("audio/x-l16", 16000, byte_order="auto")
    for _ in range(200):
        decoder.decode(_b64(np.zeros(320)))
    assert decoder.byte_order == "little" and decoder._detector.order is None
    monkeypatch.setenv("COPILOT_BRIDGE_L16_BYTE_ORDER", "big")
    assert FrameDecoder().byte_order == "big"
    monkeypatch.setenv("COPILOT_BRIDGE_L16_BYTE_ORDER", "little")
    assert FrameDecoder()._detector is None and FrameDecoder().byte_order == "little"


@pytest.mark.parametrize("params, reason", [
    ({"Event": "Hangup", "CallStatus": "completed", "HangupCauseCode": "3010", "HangupCauseName": "Busy Line"},
     "rep_busy"),
    ({"HangupCauseCode": "3020", "HangupCauseName": "Rejected"}, "rep_busy"),
    ({"HangupCause": "NO_ANSWER", "HangupCauseCode": "6010", "HangupCauseName": "Ring Timeout Reached"},
     "rep_no_answer"),
    ({"HangupCauseCode": "3000"}, "rep_no_answer"),
    ({"HangupCauseCode": "2000", "HangupCauseName": "Invalid Destination Address"}, "rep_failed"),
    ({"HangupCauseCode": "5030"}, "rep_failed"),
    ({"HangupCauseName": "Destination Out Of Service"}, "rep_failed"),
    ({"HangupCauseName": "Spam block"}, "rep_failed"),
])
def test_rep_reason_reads_vobiz_cause_codes_and_names(params, reason):
    assert rep_reason(params) == reason
