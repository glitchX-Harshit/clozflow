"""Gemini text inference with JSON-schema validation and bounded quota backoff."""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.request
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from clozflow_brain.infrastructure.llm import LLMClient

T = TypeVar("T", bound=BaseModel)


class GeminiAPIError(RuntimeError):
    """A safe diagnostic: never contains provider bodies, prompts or credentials."""


class GeminiLLMClient(LLMClient):
    model_name = "gemini-3.8-flash"

    def __init__(self, api_key: str, model_name: str | None = None):
        self.api_key = api_key.strip()
        self.model_name = model_name or os.getenv("GEMINI_MODEL", self.model_name)
        if not self.model_name or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-._" for c in self.model_name):
            raise ValueError("GEMINI_MODEL must be a model identifier without a URL or prefix")
        self.url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model_name}:generateContent"
        self._lock = threading.Lock()
        self._retry_at = 0.0

    @classmethod
    def from_env(cls) -> GeminiLLMClient:
        key = os.getenv("GEMINI_API_KEY", "").strip()
        if not key:
            raise ValueError("GEMINI_API_KEY environment variable not set")
        return cls(key)

    def generate_structured_output(
        self, prompt: str, response_schema: type[T], system_prompt: str | None = None,
        temperature: float = 0.0,
    ) -> T:
        with self._lock:
            remaining = self._retry_at - time.monotonic()
        if remaining > 0:
            raise GeminiAPIError(f"Gemini rate limited; retry in {int(remaining) + 1}s")

        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": temperature,
                "responseMimeType": "application/json",
                "responseJsonSchema": response_schema.model_json_schema(),
            },
        }
        if system_prompt:
            payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}
        req = urllib.request.Request(
            self.url, data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "x-goog-api-key": self.api_key},
        )
        try:
            with urllib.request.urlopen(req, timeout=float(os.getenv("CEB_LLM_TIMEOUT_SECONDS", "30"))) as response:
                result = json.load(response)
        except urllib.error.HTTPError as exc:
            # No retries in a live turn: retries consume quota and can outlive the
            # stage deadline. Remember Google's retry delay for subsequent turns.
            if exc.code == 429:
                delay = self._retry_delay(exc)
                with self._lock:
                    self._retry_at = time.monotonic() + delay
                raise GeminiAPIError(f"Gemini quota/rate limit reached; retry in {int(delay)}s") from None
            exc.close()
            hint = {400: "request or schema rejected", 401: "credential rejected",
                    403: "access denied", 404: "model unavailable; check GEMINI_MODEL"}.get(exc.code, "provider unavailable")
            raise GeminiAPIError(f"Gemini HTTP {exc.code}: {hint}") from None
        except (TimeoutError, urllib.error.URLError):
            raise GeminiAPIError("Gemini network request timed out or could not connect") from None

        from clozflow_brain.kernel.observability import get_global_telemetry, TelemetrySignal
        from clozflow_brain.infrastructure.llm import active_engine
        usage = result.get("usageMetadata", {})
        for direction, key in (("in", "promptTokenCount"), ("out", "candidatesTokenCount")):
            if key in usage:
                get_global_telemetry().increment(
                    TelemetrySignal.BRAIN_LLM_TOKENS_TOTAL,
                    {"engine_id": active_engine.get(), "model": self.model_name, "direction": direction},
                    value=int(usage[key]),
                )
        candidates = result.get("candidates", [])
        if not candidates:
            raise GeminiAPIError("Gemini returned no candidate (possibly content blocked)")
        candidate = candidates[0]
        if candidate.get("finishReason", "STOP") != "STOP":
            raise GeminiAPIError("Gemini did not finish a complete response")
        output = "".join(part.get("text", "") for part in candidate.get("content", {}).get("parts", [])
                         if not part.get("thought"))
        if not output:
            raise GeminiAPIError("Gemini returned no response text")
        try:
            return response_schema.model_validate_json(output)
        except ValidationError as exc:
            fields = ", ".join(f"{'.'.join(map(str, error['loc']))} ({error['type']})"
                               for error in exc.errors(include_input=False, include_context=False)[:5])
            raise GeminiAPIError("Gemini response failed schema validation: " + fields) from None

    @staticmethod
    def _retry_delay(error: urllib.error.HTTPError) -> float:
        delay = 60.0
        try:
            if error.headers and error.headers.get("Retry-After"):
                delay = float(error.headers["Retry-After"])
            details = json.load(error).get("error", {}).get("details", [])
            for detail in details:
                if detail.get("@type", "").endswith("RetryInfo"):
                    delay = float(detail["retryDelay"].rstrip("s"))
        except (ValueError, KeyError, TypeError):
            pass
        finally:
            error.close()
        return max(1.0, min(delay, 3600.0))
