"""LLM infrastructure client for structured extraction."""

import os
import time
import logging
from contextvars import ContextVar
from functools import lru_cache
from typing import TypeVar, Type

from pydantic import BaseModel
from opentelemetry import trace
from opentelemetry.metrics import get_meter

logger = logging.getLogger(__name__)
active_engine: ContextVar[str] = ContextVar("llm_engine", default="unknown")

T = TypeVar("T", bound=BaseModel)

class LLMClient:
    """Interface for Language Model Clients enforcing Pydantic schemas."""

    def generate_structured_output(
        self,
        prompt: str,
        response_schema: Type[T],
        system_prompt: str | None = None,
        temperature: float = 0.0,
    ) -> T:
        raise NotImplementedError


class _TelemetryObservingLLMClient(LLMClient):
    """Wraps an LLMClient to emit OpenTelemetry metrics and traces."""

    def __init__(self, inner: LLMClient, engine_id: str) -> None:
        self.inner = inner
        self.engine_id = engine_id
        self.tracer = trace.get_tracer("clozflow_brain.engines")
        meter = get_meter("clozflow_brain.engines")
        self.latency_histogram = meter.create_histogram(
            "llm.latency",
            description="Latency of LLM calls",
            unit="ms",
        )
        self.error_counter = meter.create_counter(
            "llm.errors",
            description="Count of LLM errors",
        )

    def generate_structured_output(
        self,
        prompt: str,
        response_schema: Type[T],
        system_prompt: str | None = None,
        temperature: float = 0.0,
    ) -> T:
        start_time = time.perf_counter()
        engine_token = active_engine.set(self.engine_id)
        with self.tracer.start_as_current_span(f"{self.engine_id}.llm_call") as span:
            try:
                result = self.inner.generate_structured_output(
                    prompt, response_schema, system_prompt, temperature
                )
                duration_ms = (time.perf_counter() - start_time) * 1000
                self.latency_histogram.record(duration_ms, {"engine_id": self.engine_id})
                span.set_attribute("llm.latency_ms", duration_ms)
                return result
            except Exception as exc:
                from clozflow_brain.kernel.observability import get_global_telemetry, TelemetrySignal
                get_global_telemetry().increment(TelemetrySignal.BRAIN_LLM_ERRORS_TOTAL, {"engine_id": self.engine_id, "error_type": type(exc).__name__})
                self.error_counter.add(1, {"engine_id": self.engine_id, "error_type": type(exc).__name__})
                span.record_exception(exc)
                span.set_status(trace.Status(trace.StatusCode.ERROR, str(exc)))
                raise
            finally:
                active_engine.reset(engine_token)


class FallbackLLMClient(LLMClient):
    """Wraps a primary LLM client and gracefully falls back to a secondary client on failure."""

    def __init__(self, primary: LLMClient, fallback: LLMClient) -> None:
        self.primary = primary
        self.fallback = fallback
        self.model_name = getattr(primary, "model_name", "unknown")
        self._circuit_broken_until = 0.0

    def generate_structured_output(
        self,
        prompt: str,
        response_schema: Type[T],
        system_prompt: str | None = None,
        temperature: float = 0.0,
    ) -> T:
        if time.time() < self._circuit_broken_until:
            return self.fallback.generate_structured_output(
                prompt=prompt,
                response_schema=response_schema,
                system_prompt=system_prompt,
                temperature=temperature,
            )

        try:
            return self.primary.generate_structured_output(
                prompt=prompt,
                response_schema=response_schema,
                system_prompt=system_prompt,
                temperature=temperature,
            )
        except Exception as exc:
            self._circuit_broken_until = time.time() + 300.0  # Open circuit for 5 minutes
            logger.warning(
                "Primary LLM (%s) failed with %s. Falling back to %s for 5 minutes.",
                self.model_name,
                type(exc).__name__,
                getattr(self.fallback, "model_name", "fallback"),
            )
            return self.fallback.generate_structured_output(
                prompt=prompt,
                response_schema=response_schema,
                system_prompt=system_prompt,
                temperature=temperature,
            )


@lru_cache(maxsize=8)
def _gemini_client(api_key: str, model: str) -> LLMClient:
    from clozflow_brain.infrastructure.llm_gemini import GeminiLLMClient
    return GeminiLLMClient(api_key, model)


def _build_real_client(provider: str) -> LLMClient | None:
    """Construct a provider LLM client from configuration, if requested."""
    if provider == "local":
        try:
            from clozflow_brain.infrastructure.llm_local import LocalLLMClient
            return LocalLLMClient()
        except Exception as exc:
            logger.warning("Local LLM unavailable (%s)", exc)
            return None

    if provider == "anthropic":
        try:
            from clozflow_brain.infrastructure.llm_anthropic import AnthropicLLMClient  # type: ignore
            return AnthropicLLMClient.from_env()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Anthropic LLM unavailable (%s)", exc)

    if provider == "gemini":
        try:
            from clozflow_brain.infrastructure.llm_gemini import GeminiLLMClient
            key = os.getenv("GEMINI_API_KEY", "").strip()
            if not key:
                raise ValueError("GEMINI_API_KEY is missing")
            return _gemini_client(key, os.getenv("GEMINI_MODEL", GeminiLLMClient.model_name))
        except Exception as exc:
            logger.warning("Gemini LLM unavailable (%s)", exc)

    return None


def get_llm_client(engine_id: str = "engine") -> LLMClient:
    """Return the active LLMClient, wrapped to emit token/error telemetry.

    Supports engine-specific overrides via ``CEB_LLM_PROVIDER_{ENGINE_ID}``.
    Fallback inference is opt-in through CEB_LLM_FALLBACK_PROVIDER; a provider
    failure must not silently switch to an uninstalled or unvalidated model.
    """
    default_provider = "local"
    # Use external LLM for "final result" engines.
    if engine_id.split(".")[0] in ("recommendation", "decision"):
        default_provider = "gemini"

    engine_env_var = f"CEB_LLM_PROVIDER_{engine_id.replace('.', '_').upper()}"
    provider = os.getenv(engine_env_var, os.getenv("CEB_LLM_PROVIDER", default_provider)).lower()

    inner = _build_real_client(provider)
    if inner is None:
        raise ValueError(f"LLM provider {provider!r} is unavailable or not configured")
    fallback_provider = os.getenv("CEB_LLM_FALLBACK_PROVIDER", "").lower()
    if fallback_provider and fallback_provider != provider:
        fallback = _build_real_client(fallback_provider)
        if fallback is None:
            raise ValueError("Configured fallback provider is unavailable")
        inner = FallbackLLMClient(primary=inner, fallback=fallback)

    return _TelemetryObservingLLMClient(inner, engine_id=engine_id)
