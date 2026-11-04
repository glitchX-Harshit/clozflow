"""Observability contracts for CCBS-required telemetry signals.

The CCBS (Volume X §9.1) names ten required telemetry signals. Every signal is
declared in :class:`TelemetrySignal`. Infrastructure modules that do not receive a
``Telemetry`` instance through dependency injection (the LLM client, the shared
World Model mutation applier, and the WebSocket delivery layer) publish through a
process-global sink exposed by :func:`get_global_telemetry` /
:func:`set_global_telemetry`. The Kernel still owns and installs the active sink,
so there is exactly one source of truth per process.
"""

from __future__ import annotations

import os
from collections import Counter, deque
from dataclasses import dataclass, field
from enum import StrEnum
from threading import RLock
from typing import Protocol
from uuid import UUID


class TelemetrySignal(StrEnum):
    BRAIN_EVENTS_TOTAL = "brain_events_total"
    BRAIN_ENGINE_DURATION_MS = "brain_engine_duration_ms"
    BRAIN_RECOMMENDATION_LATENCY_MS = "brain_recommendation_latency_ms"
    BRAIN_WORLD_MODEL_BELIEF_COUNT = "brain_world_model_belief_count"
    BRAIN_ACTIVE_SESSIONS = "brain_active_sessions"
    BRAIN_LLM_TOKENS_TOTAL = "brain_llm_tokens_total"
    BRAIN_LLM_ERRORS_TOTAL = "brain_llm_errors_total"
    BRAIN_WM_MUTATION_APPLY_MS = "brain_wm_mutation_apply_ms"
    BRAIN_RECOMMENDATIONS_DELIVERED = "brain_recommendations_delivered"
    BRAIN_RECOMMENDATIONS_ACKNOWLEDGED = "brain_recommendations_acknowledged"


#: The full set of signal names that §9.2 requires to be emitting in staging.
REQUIRED_SIGNALS: tuple[TelemetrySignal, ...] = tuple(TelemetrySignal)


class Telemetry(Protocol):
    def increment(self, signal: TelemetrySignal, labels: dict[str, str] | None = None, value: int = 1) -> None:
        """Increment a counter signal."""

    def observe(self, signal: TelemetrySignal, value: float, labels: dict[str, str] | None = None) -> None:
        """Observe a gauge or histogram value."""


def _label_key(labels: dict[str, str] | None) -> tuple[tuple[str, str], ...]:
    return tuple(sorted((labels or {}).items()))


class InMemoryTelemetry:
    """Local telemetry collector used until OpenTelemetry adapters are provisioned."""

    def __init__(self) -> None:
        self._counters: Counter[tuple[str, tuple[tuple[str, str], ...]]] = Counter()
        self._observations: deque[tuple[str, float, tuple[tuple[str, str], ...]]] = deque(maxlen=10000)
        self._lock = RLock()

    def increment(self, signal: TelemetrySignal, labels: dict[str, str] | None = None, value: int = 1) -> None:
        with self._lock:
            self._counters[(signal.value, _label_key(labels))] += value

    def observe(
        self, signal: TelemetrySignal, value: float, labels: dict[str, str] | None = None
    ) -> None:
        with self._lock:
            self._observations.append((signal.value, value, _label_key(labels)))

    def counter_value(self, signal: TelemetrySignal) -> int:
        with self._lock:
            return sum(count for (name, _labels), count in self._counters.items() if name == signal.value)

    def observations(self, signal: TelemetrySignal) -> list[float]:
        with self._lock:
            return [value for name, value, _labels in self._observations if name == signal.value]

    def emitted_signals(self) -> set[str]:
        """Return the set of signal names that have observed at least one event."""
        with self._lock:
            names = {name for (name, _labels) in self._counters}
            names.update(name for name, _value, _labels in self._observations)
            return names


# ---------------------------------------------------------------------------
# Process-global telemetry registry
#
# Infrastructure adapters (LLM client, World Model mutation applier, WebSocket
# delivery layer) cannot always receive a Telemetry instance via construction.
# They resolve the active sink here instead. The Kernel installs its own
# telemetry instance into this registry on construction so that the whole
# process shares one sink. Tests may reset the global sink to a fresh
# InMemoryTelemetry via :func:`reset_global_telemetry`.
# ---------------------------------------------------------------------------

_GLOBAL_LOCK = RLock()
_global_telemetry: Telemetry | None = None


def get_global_telemetry() -> Telemetry:
    """Return the process-wide active telemetry sink."""
    global _global_telemetry
    with _GLOBAL_LOCK:
        if _global_telemetry is None:  # type: ignore[has-type]
            _global_telemetry = InMemoryTelemetry()
        return _global_telemetry


def set_global_telemetry(telemetry: Telemetry | None) -> None:
    """Install (or clear) the process-wide telemetry sink."""
    global _global_telemetry
    with _GLOBAL_LOCK:
        _global_telemetry = telemetry if telemetry is not None else InMemoryTelemetry()


def reset_global_telemetry() -> InMemoryTelemetry:
    """Replace the global sink with a fresh in-memory collector and return it."""
    fresh = InMemoryTelemetry()
    set_global_telemetry(fresh)
    return fresh


class OpenTelemetryTelemetry:
    """Telemetry adapter that forwards every signal to an OpenTelemetry meter.

    Selected when ``CEB_TELEMETRY=otel``. The adapter is intentionally tolerant:
    if the OpenTelemetry SDK is not installed, it degrades to a no-op so the
    Brain never fails a request purely because observability export is down.
    """

    def __init__(self, service_name: str = "clozflow-brain") -> None:
        self._enabled = False
        self._counters: dict[str, object] = {}
        self._histograms: dict[str, object] = {}
        try:  # pragma: no cover - exercised only when OTel SDK is present
            from opentelemetry import metrics as _metrics  # type: ignore
            from opentelemetry.sdk.metrics import MeterProvider  # type: ignore
            from opentelemetry.sdk.resources import Resource  # type: ignore

            resource = Resource.create({"service.name": service_name})
            provider = MeterProvider(resource=resource)

            exporter_kind = os.getenv("CEB_OTEL_EXPORTER", "console").lower()
            if exporter_kind == "otlp":  # pragma: no cover - requires collector
                from opentelemetry.exporter.otlp.proto.http.metric_exporter import (  # type: ignore
                    OTLPMetricExporter,
                )
                from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader  # type: ignore

                reader = PeriodicExportingMetricReader(OTLPMetricExporter(), export_interval_millis=10000)
                provider = MeterProvider(resource=resource, metric_readers=[reader])
            _metrics.set_meter_provider(provider)
            self._meter = _metrics.get_meter(service_name)
            self._enabled = True
        except Exception:  # noqa: BLE001 - observability must never break cognition
            self._enabled = False

    def _counter(self, name: str) -> object | None:
        if not self._enabled:
            return None
        if name not in self._counters:
            self._counters[name] = self._meter.create_counter(name=name)  # type: ignore[union-attr]
        return self._counters[name]

    def _histogram(self, name: str) -> object | None:
        if not self._enabled:
            return None
        if name not in self._histograms:
            self._histograms[name] = self._meter.create_histogram(  # type: ignore[union-attr]
                name=name, unit="ms" if name.endswith("_ms") else "1"
            )
        return self._histograms[name]

    def increment(self, signal: TelemetrySignal, labels: dict[str, str] | None = None, value: int = 1) -> None:
        counter = self._counter(signal.value)
        if counter is not None:  # pragma: no cover - requires OTel SDK
            counter.add(value, attributes=dict(labels or {}))  # type: ignore[union-attr]

    def observe(self, signal: TelemetrySignal, value: float, labels: dict[str, str] | None = None) -> None:
        histogram = self._histogram(signal.value)
        if histogram is not None:  # pragma: no cover - requires OTel SDK
            histogram.record(value, attributes=dict(labels or {}))  # type: ignore[union-attr]


def build_telemetry_from_env() -> Telemetry:
    """Construct the telemetry backend selected by ``CEB_TELEMETRY``."""
    backend = os.getenv("CEB_TELEMETRY", "memory").lower()
    if backend == "otel":
        return OpenTelemetryTelemetry()
    return InMemoryTelemetry()


@dataclass(frozen=True)
class ExecutionTrace:
    cycle_id: UUID
    triggering_event_ids: list[UUID]
    engine_ids: list[str] = field(default_factory=list)
    cdc_phases: list[str] = field(default_factory=list)
    error_count: int = 0
    mutation_count: int = 0

