"""Dependency-ordered execution with isolated snapshots and bounded deadlines."""
from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from time import perf_counter
from uuid import UUID

from clozflow_brain.contracts.context import CognitiveContext
from clozflow_brain.contracts.engines import (
    CognitiveEngine, EngineExecutionInput, EngineExecutionOutput, EngineStatus, EngineType,
)
from clozflow_brain.contracts.events import CognitiveEvent, EventType
from clozflow_brain.contracts.world_model import WorldModel
from clozflow_brain.infrastructure.world_model_mutations import apply_world_model_mutations
from clozflow_brain.kernel.observability import Telemetry, TelemetrySignal
from clozflow_brain.kernel.registry import EngineRegistry


class CognitiveScheduler:
    """Dependencies take precedence over priorities. Late results are discarded.

    Local calls can finish in their worker after timeout; provider deadlines bound
    those calls. Engines must not perform external writes. Celery mode additionally
    uses worker task limits and revocation.
    """

    def __init__(self, registry: EngineRegistry, telemetry: Telemetry) -> None:
        self._registry = registry
        self._telemetry = telemetry
        self._pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="cognition")

    def close(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)

    def _run_engine(self, engine: CognitiveEngine, request: EngineExecutionInput) -> EngineExecutionOutput:
        started = perf_counter()
        registration = engine.registration
        try:
            class_path = self._registry.get_class_path(registration.engine_id)
            if os.getenv("CEB_SCHEDULER_MODE", "local") == "celery" and class_path:
                from clozflow_brain.kernel.celery_app import execute_engine_task
                from typing import Any
                task: Any = execute_engine_task
                result = task.apply_async(
                    args=[class_path, request.model_dump(mode="json")],
                    queue=f"priority.{min(registration.priority, 5)}",
                    soft_time_limit=max(1, request.timeout_ms / 1000),
                    time_limit=max(2, request.timeout_ms / 1000 + 1),
                    retry=False,
                )
                try:
                    output = EngineExecutionOutput.model_validate(
                        result.get(timeout=request.timeout_ms / 1000)
                    )
                except Exception:
                    result.revoke(terminate=True)
                    raise
            else:
                future = self._pool.submit(engine.execute, request)
                try:
                    output = future.result(timeout=request.timeout_ms / 1000)
                except FutureTimeout:
                    future.cancel()
                    raise
            if output.engine_id != registration.engine_id or output.cycle_id != request.cycle_id:
                raise ValueError("engine output identity mismatch")
            if output.status not in (EngineStatus.SUCCESS, EngineStatus.PARTIAL):
                output.wm_mutations = []
                output.output_events = []
            output.duration_ms = int((perf_counter() - started) * 1000)
            output.reasoning_trace = (output.reasoning_trace or "")[:2000]
            return output
        except Exception as exc:
            timeout = isinstance(exc, TimeoutError) or "timeout" in type(exc).__name__.lower()
            return EngineExecutionOutput(
                engine_id=registration.engine_id, cycle_id=request.cycle_id,
                confidence=0, duration_ms=int((perf_counter() - started) * 1000),
                status=EngineStatus.TIMEOUT if timeout else EngineStatus.ERROR,
                reasoning_trace=f"Execution failed: {type(exc).__name__}",
            )

    def execute(self, *, cycle_id: UUID, events: list[CognitiveEvent],
                world_model: WorldModel, cognitive_context: CognitiveContext | None = None,
                policy=None,
                ) -> list[EngineExecutionOutput]:
        cycle_started = perf_counter()
        calls = 0
        order = {kind: index for index, kind in enumerate(EngineType)}
        engines = sorted(
            self._registry.match_event_types({event.event_type for event in events}),
            key=lambda e: (order[e.registration.engine_type], e.registration.priority),
        )
        if events and all(event.event_type == EventType.TRANSCRIPT_SEGMENT and
                          event.payload.get("speaker_role") == "SALESPERSON" for event in events):
            engines = [engine for engine in engines if engine.registration.engine_type == EngineType.PERCEPTION]
        running = world_model.model_copy(deep=True)
        outputs: list[EngineExecutionOutput] = []
        failed_upstream: EngineExecutionOutput | None = None
        for engine in engines:
            budget = int(os.getenv(
                f"CEB_TIMEOUT_{engine.registration.engine_type.value}_MS",
                str(max(engine.registration.latency_budget_ms, int(float(os.getenv("CEB_LLM_TIMEOUT_SECONDS", "30")) * 1000) + 1000) if hasattr(engine, "llm_client") else engine.registration.latency_budget_ms),
            ))
            needs_model = hasattr(engine, "llm_client") and getattr(engine, "extract_mood", True)
            if policy:
                remaining = policy.cycle_budget_ms - int((perf_counter() - cycle_started) * 1000)
                if remaining <= 0 or (needs_model and calls >= policy.max_model_calls):
                    failed_upstream = EngineExecutionOutput(
                        engine_id="attention-budget", cycle_id=cycle_id, status=EngineStatus.TIMEOUT,
                        confidence=0, duration_ms=0, reasoning_trace="Cycle attention budget exhausted")
                budget = max(1, min(budget, remaining))
            if needs_model:
                calls += 1
            request = EngineExecutionInput(
                cycle_id=cycle_id, events=events, world_model=running.model_copy(deep=True),
                cognitive_context=cognitive_context.model_copy(deep=True) if cognitive_context else None,
                timeout_ms=budget,
            )
            if failed_upstream is not None:
                output = EngineExecutionOutput(
                    engine_id=engine.registration.engine_id, cycle_id=cycle_id,
                    confidence=0, duration_ms=0, status=failed_upstream.status,
                    reasoning_trace=f"Blocked by {failed_upstream.engine_id}: {failed_upstream.reasoning_trace}",
                )
            else:
                output = self._run_engine(engine, request)
            try:
                running = apply_world_model_mutations(running, output.wm_mutations)
            except (ValueError, KeyError, PermissionError, TypeError):
                output.status = EngineStatus.ERROR
                output.confidence = 0
                output.wm_mutations = []
                output.output_events = []
                output.reasoning_trace = "Invalid mutation batch rejected"
            if output.status in (EngineStatus.ERROR, EngineStatus.TIMEOUT) and failed_upstream is None:
                failed_upstream = output
            outputs.append(output)
            self._telemetry.observe(TelemetrySignal.BRAIN_ENGINE_DURATION_MS, output.duration_ms, {
                "engine_id": output.engine_id, "engine_type": engine.registration.engine_type.value,
                "status": output.status.value, "cycle_id": str(cycle_id),
            })
        return outputs
