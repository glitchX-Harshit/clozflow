import io
import json
from urllib.error import HTTPError

import pytest
from pydantic import BaseModel

from clozflow_brain.infrastructure.llm_gemini import GeminiAPIError, GeminiLLMClient


class Result(BaseModel):
    message: str
    optional: str | None = None


def test_gemini_header_schema_and_response_parts(monkeypatch):
    def request(req, timeout):
        assert "secret" not in req.full_url
        assert req.get_header("X-goog-api-key") == "secret"
        body = json.loads(req.data)
        assert "anyOf" in body["generationConfig"]["responseJsonSchema"]["properties"]["optional"]
        assert body["systemInstruction"]["parts"][0]["text"] == "system"
        return io.BytesIO(json.dumps({"candidates": [{"finishReason": "STOP", "content": {"parts": [
            {"text": "hidden thought", "thought": True}, {"text": '{"message":'}, {"text": '"ready"}'},
        ]}}]}).encode())
    monkeypatch.setattr("urllib.request.urlopen", request)
    assert GeminiLLMClient("secret").generate_structured_output("test", Result, "system").message == "ready"


def test_quota_blocks_following_requests_and_redacts_errors(monkeypatch):
    calls = []
    def request(req, timeout):
        calls.append(req)
        raise HTTPError(req.full_url, 429, "secret", {}, io.BytesIO(json.dumps({"error": {"details": [
            {"@type": "google.rpc.RetryInfo", "retryDelay": "30s"}
        ]}}).encode()))
    monkeypatch.setattr("urllib.request.urlopen", request)
    client = GeminiLLMClient("secret")
    for _ in range(2):
        with pytest.raises(GeminiAPIError) as err:
            client.generate_structured_output("test", Result)
        assert "secret" not in str(err.value)
    assert len(calls) == 1


@pytest.mark.parametrize("result", [{"candidates": []}, {"candidates": [{"finishReason": "MAX_TOKENS"}]},
    {"candidates": [{"content": {"parts": [{"text": '{"incorrect":"secret"}'}]}}]}])
def test_incomplete_or_invalid_model_output_is_rejected(monkeypatch, result):
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: io.BytesIO(json.dumps(result).encode()))
    with pytest.raises(GeminiAPIError) as err:
        GeminiLLMClient("secret").generate_structured_output("test", Result)
    assert "secret" not in str(err.value)
