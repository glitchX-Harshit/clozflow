"""VobizXML documents returned to the carrier (every value XML-escaped)."""
from __future__ import annotations

from typing import Optional
from xml.sax.saxutils import escape

_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n'
_QUOTE_ENTITY = {'"': "&quot;"}


def _attr_value(value) -> str:
    return escape(str(value), _QUOTE_ENTITY)


def _attrs(values: dict) -> str:
    return "".join(" %s=\"%s\"" % (name, _attr_value(value)) for name, value in values.items())


def answer_xml(*, stream_url: str, stream_status_url: str, caller_id: str, prospect_e164: str,
               max_seconds: int, dial_events_url: str, dial_result_url: str,
               dial_timeout: int = 40, stream_timeout: int = 7200,
               confirm_url: Optional[str] = None, confirm_key: Optional[str] = None,
               confirm_timeout: int = 8) -> str:
    """``Speak`` first (so the prompt isn't transcribed), then fork both tracks to
    our media socket in the background and bridge the prospect; hang up after.

    With ``confirm_url`` Vobiz fetches that URL after the prospect answers and plays
    the XML it returns (our recording disclosure, see ``confirm_xml``) before
    bridging. ``confirm_key`` adds "press 1 to continue" (Vobiz documents its
    enforcement as unverified, so the call is bridged either way)."""
    stream = _attrs({
        "bidirectional": "false",
        "audioTrack": "both",
        "contentType": "audio/x-l16;rate=16000",
        "streamTimeout": stream_timeout,
        "statusCallbackUrl": stream_status_url,
        "statusCallbackMethod": "POST",
        "maxRetries": 2,
    })
    dial_values = {
        "callerId": caller_id,
        "timeout": dial_timeout,
        "timeLimit": max(1, int(max_seconds)),
        "redirect": "false",
        "callbackUrl": dial_events_url,
        "callbackMethod": "POST",
        "action": dial_result_url,
        "method": "POST",
    }
    if confirm_url:
        dial_values["confirmSound"] = confirm_url
        dial_values["confirmTimeout"] = max(3, int(confirm_timeout))
        if confirm_key:
            dial_values["confirmKey"] = str(confirm_key)[:1]
    dial = _attrs(dial_values)
    return (
        _HEADER
        + "<Response>\n"
        + "  <Speak>Connecting you now.</Speak>\n"
        + f"  <Stream{stream}>{escape(stream_url)}</Stream>\n"
        + f"  <Dial{dial}>\n"
        + f"    <Number>{escape(prospect_e164)}</Number>\n"
        + "  </Dial>\n"
        + "  <Hangup/>\n"
        + "</Response>\n"
    )


def confirm_xml(text: str) -> str:
    """The disclosure played to the prospect's leg after they answer (``confirmSound``);
    Vobiz only allows ``Play``/``Speak``/``Wait`` here."""
    lines = [line.strip() for line in str(text or "").replace("\r", "\n").split("\n") if line.strip()]
    body = "".join(f"  <Speak>{escape(line)}</Speak>\n" for line in lines) or "  <Wait length=\"1\"/>\n"
    return _HEADER + "<Response>\n" + body + "</Response>\n"


def hangup_xml() -> str:
    return _HEADER + "<Response>\n  <Hangup/>\n</Response>\n"


def empty_xml() -> str:
    return _HEADER + "<Response></Response>\n"
