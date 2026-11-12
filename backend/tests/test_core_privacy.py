"""Secrets and call speech stay out of logs: nginx/uvicorn query strings, learning log opt-in."""
import logging
import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
WEB = BACKEND.parent
if str(WEB) not in sys.path:  # ml/ lives next to backend/ (main.py adds it the same way)
    sys.path.insert(0, str(WEB))


def test_nginx_access_log_drops_query_strings():
    conf = (WEB / "nginx.conf.template").read_text(encoding="utf-8")
    fmt = re.search(r"log_format\s+clozflow_redacted\s+(.*?);", conf, re.S)
    assert fmt, "clozflow_redacted log_format missing"
    for leaky in ("$request ", '$request"', "$request_uri", "$args", "$query_string", "$http_referer", "$arg_"):
        assert leaky not in fmt.group(1), leaky
    assert re.search(r"^\s*access_log\s+\S+\s+clozflow_redacted;", conf, re.M)
    # The maps feed the format with everything before "?" (same regex as nginx uses)
    for pattern in re.findall(r'"~\^\(\?<\w+>(\[\^\?\]\*)\)"', conf):
        assert re.match(rf"^({pattern})", "/api/copilot/bridge/vobiz/answer?t=s3cret").group(1) == \
            "/api/copilot/bridge/vobiz/answer"


def test_uvicorn_logs_drop_query_strings():
    import main

    access = logging.getLogger("uvicorn.access")
    assert any(isinstance(f, main._RedactQueryStrings) for f in access.filters)
    assert any(isinstance(f, main._RedactQueryStrings) for f in logging.getLogger("uvicorn.error").filters)

    record = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
                               ("127.0.0.1:50000", "POST", "/api/copilot/bridge/vobiz/answer?t=s3cret", "1.1", 200), None)
    assert access.filter(record)
    assert record.getMessage() == '127.0.0.1:50000 - "POST /api/copilot/bridge/vobiz/answer HTTP/1.1" 200'

    socket_line = logging.LogRecord("uvicorn.error", logging.INFO, __file__, 1, '%s - "WebSocket %s" [accepted]',
                                    ("127.0.0.1:50001", "/api/pearl/calls/abc/stream?token=eyJhbGciOi"), None)
    logging.getLogger("uvicorn.error").filter(socket_line)
    assert "eyJ" not in socket_line.getMessage()


def _interaction():
    from ml.evaluation import learning_filter

    return learning_filter, dict(message="We already pay for a CRM", response="What made you choose it?",
                                 strategy="Discovery", confidence=0.9, emotional_state="neutral",
                                 is_fallback=False, api_error=False, is_repetitive=False)


def test_learning_log_is_off_by_default(tmp_path, monkeypatch):
    learning_filter, kwargs = _interaction()
    monkeypatch.setattr(learning_filter, "APPROVED_LOG", str(tmp_path / "approved.jsonl"))
    monkeypatch.setattr(learning_filter, "REJECTED_LOG", str(tmp_path / "rejected.jsonl"))
    monkeypatch.delenv("CLOZFLOW_LEARNING_LOG", raising=False)

    assert isinstance(learning_filter.filter_and_log_interaction(**kwargs), bool)
    assert list(tmp_path.iterdir()) == []  # the prospect's words were not written anywhere


def test_learning_log_can_be_enabled(tmp_path, monkeypatch):
    learning_filter, kwargs = _interaction()
    monkeypatch.setattr(learning_filter, "APPROVED_LOG", str(tmp_path / "approved.jsonl"))
    monkeypatch.setattr(learning_filter, "REJECTED_LOG", str(tmp_path / "rejected.jsonl"))
    monkeypatch.setenv("CLOZFLOW_LEARNING_LOG", "true")

    learning_filter.filter_and_log_interaction(**kwargs)
    written = [p for p in tmp_path.iterdir() if p.read_text(encoding="utf-8").strip()]
    assert len(written) == 1 and "We already pay for a CRM" in written[0].read_text(encoding="utf-8")
