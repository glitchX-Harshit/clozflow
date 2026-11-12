import json
import re
from datetime import datetime, timezone
from typing import Any, List, Optional


class TranscriptManager:
    def __init__(self, buffer_size=20):
        self.buffer = []
        self.buffer_size = buffer_size

    def add_message(self, speaker: str, text: str):
        self.buffer.append({"speaker": speaker, "text": text})
        if len(self.buffer) > self.buffer_size:
            self.buffer.pop(0)

    def get_recent_context(self):
        return self.buffer

transcript_buffer = TranscriptManager()


# ── Stored call-log parsing ──────────────────────────────────────────────────
# services/websocket_service.py saves CallLog.transcript as a JSON list of
# {"speaker", "text", "timestamp"} and CallLog.ai_suggestions as a JSON list of
# {"payload": <analysis dict>, "timestamp"} (timestamps are naive-UTC ISO
# strings). Older or hand-made rows may hold other shapes or plain text, so the
# readers below never raise and always return clean, typed lists.

_SPEAKER_LINE_RE = re.compile(r"^\s*\[?([A-Za-z][\w .'-]{0,30}?)\]?\s*:\s*(.+)$")


def normalize_timestamp(value: Any) -> Optional[str]:
    """ISO-8601 UTC with a ``Z`` for parseable timestamps (naive means UTC);
    other non-empty strings are passed through unchanged."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value, tz=timezone.utc).replace(tzinfo=None).isoformat() + "Z"
        except (OverflowError, OSError, ValueError):
            return None
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    try:
        parsed = datetime.fromisoformat(raw[:-1] + "+00:00" if raw.endswith(("Z", "z")) else raw)
    except ValueError:
        return raw
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed.isoformat() + "Z"


def _load(raw: Any) -> Any:
    """JSON-decoded value, or the original string when it isn't JSON."""
    if raw is None:
        return None
    if not isinstance(raw, str):
        return raw
    if not raw.strip():
        return None
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return raw


def _unwrap_list(data: Any, keys) -> Any:
    if isinstance(data, dict):
        for key in keys:
            if isinstance(data.get(key), list):
                return data[key]
        return [data]
    return data


def _text(value: Any) -> str:
    if value is None:
        return ""
    return value.strip() if isinstance(value, str) else str(value).strip()


def _positioned_transcript(raw: Any) -> List[tuple]:
    """``(stored_index, entry)`` pairs; ``stored_index`` is the item's position
    in the stored JSON list (what an insight's ``turn_index`` refers to)."""
    data = _unwrap_list(_load(raw), ("transcript", "transcripts", "messages", "turns"))
    if data is None:
        return []
    if isinstance(data, str):
        return [(None, entry) for entry in _parse_plain_transcript(data)]
    if not isinstance(data, list):
        return []
    entries = []
    for index, item in enumerate(data):
        if isinstance(item, dict):
            text = _text(item.get("text", item.get("content", item.get("message"))))
            if not text:
                continue
            speaker = _text(item.get("speaker") or item.get("role")) or "unknown"
            entries.append((index, {
                "speaker": speaker,
                "text": text,
                "timestamp": normalize_timestamp(item.get("timestamp", item.get("ts"))),
            }))
        elif isinstance(item, str) and item.strip():
            entries.extend((index, entry) for entry in _parse_plain_transcript(item))
    return entries


def parse_transcript(raw: Any) -> List[dict]:
    """``[{"speaker": str, "text": str, "timestamp": str|None}]`` from a stored transcript."""
    return [entry for _, entry in _positioned_transcript(raw)]


def _parse_plain_transcript(text: str) -> List[dict]:
    entries = []
    for line in text.splitlines():
        if not line.strip():
            continue
        match = _SPEAKER_LINE_RE.match(line)
        if match:
            entries.append({"speaker": match.group(1).strip().lower(), "text": match.group(2).strip(), "timestamp": None})
        else:
            entries.append({"speaker": "unknown", "text": line.strip(), "timestamp": None})
    return entries


def _turn_index(value: Any) -> Optional[int]:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def parse_insights(raw: Any) -> List[dict]:
    """``[{"payload": dict, "timestamp": str|None, "turn_index": int|None}]`` from
    stored AI suggestions. ``turn_index`` is the stored transcript position of the
    line the insight answered (None for rows saved before it was recorded)."""
    data = _unwrap_list(_load(raw), ("insights", "ai_suggestions", "suggestions"))
    if data is None:
        return []
    if isinstance(data, str):
        return [{"payload": {"text": line.strip()}, "timestamp": None, "turn_index": None}
                for line in data.splitlines() if line.strip()]
    if not isinstance(data, list):
        return []
    insights = []
    for item in data:
        if isinstance(item, dict):
            payload = item.get("payload")
            if not isinstance(payload, dict) and isinstance(item.get("data"), dict):
                payload = item["data"].get("payload", item["data"])
            if not isinstance(payload, dict):
                payload = ({k: v for k, v in item.items() if k not in ("timestamp", "turn_index")}
                           if payload is None else {"text": _text(payload)})
            insights.append({"payload": payload, "timestamp": normalize_timestamp(item.get("timestamp")),
                             "turn_index": _turn_index(item.get("turn_index"))})
        elif isinstance(item, str) and item.strip():
            insights.append({"payload": {"text": item.strip()}, "timestamp": None, "turn_index": None})
    return insights


def parse_call_log(transcript_raw: Any, insights_raw: Any) -> tuple:
    """``(transcript, insights)`` with each insight's ``turn_index`` pointing into
    the returned ``transcript`` list (None when unknown, e.g. older rows)."""
    positioned = _positioned_transcript(transcript_raw)
    position_of = {}
    for position, (stored_index, _) in enumerate(positioned):
        if stored_index is not None:
            position_of.setdefault(stored_index, position)
    insights = parse_insights(insights_raw)
    for insight in insights:
        stored = insight["turn_index"]
        insight["turn_index"] = position_of.get(stored) if stored is not None else None
    return [entry for _, entry in positioned], insights


def as_number(value: Any, default: float) -> float:
    """A float from an analysis field that may be missing, a string, or junk."""
    if isinstance(value, bool):
        return default
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if number == number else default  # NaN -> default


def as_text(value: Any, default: str = "") -> str:
    """A display string from an analysis field that may be missing or non-text."""
    if value is None:
        return default
    text = value if isinstance(value, str) else str(value)
    return text if text.strip() else default
