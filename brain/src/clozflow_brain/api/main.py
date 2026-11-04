"""FastAPI adapter for the public Brain API."""
# pyright: reportOptionalCall=false
# pyright: reportInvalidTypeForm=false

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from clozflow_brain.application.event_ingestion import EventIngestionService
from clozflow_brain.application.context_service import ContextService
from clozflow_brain.application.knowledge_service import KnowledgeService
from clozflow_brain.application.memory_service import MemoryService
from clozflow_brain.application.persistence_service import PersistenceService
from clozflow_brain.application.session_service import SessionService
from clozflow_brain.contracts.events import CognitiveEvent
from clozflow_brain.contracts.common import utc_now
from clozflow_brain.contracts.knowledge import DiscoveryIntent, KnowledgeArtifact
from clozflow_brain.contracts.memory import MemoryRecord
from clozflow_brain.contracts.sessions import SessionStatus

from dotenv import load_dotenv
load_dotenv()

from clozflow_brain.infrastructure.factory import (  # noqa: E402
    build_checkpoint_repository_from_env,
    build_context_repository_from_env,
    build_embedding_client_from_env,
    build_event_bus_from_env,
    build_knowledge_repository_from_env,
    build_memory_repository_from_env,
    build_persistence_repository_from_env,
    build_session_repository_from_env,
    build_vector_store_from_env,
    build_world_model_repository_from_env,
)
from clozflow_brain.kernel.kernel import CognitiveKernel  # noqa: E402
from clozflow_brain.kernel.observability import build_telemetry_from_env  # noqa: E402
from clozflow_brain.kernel.registry import EngineRegistry  # noqa: E402

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect  # noqa: E402
from starlette.requests import HTTPConnection  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402


class CreateSessionRequest(BaseModel):
    tenant_id: UUID
    salesperson_id: str = Field(min_length=1)
    crm_opportunity_id: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    session_id: UUID | None = None

    @field_validator("metadata")
    @classmethod
    def profile_supported(cls, metadata):
        if metadata.get("reasoning_profile") not in {None, "full", "compact"}:
            raise ValueError("reasoning_profile must be full or compact")
        return metadata


class PatchSessionRequest(BaseModel):
    tenant_id: UUID
    status: SessionStatus | None = None
    metadata: dict[str, Any] | None = None


def build_kernel() -> tuple[
    CognitiveKernel,
    SessionService,
    EventIngestionService,
    ContextService,
    MemoryService,
    KnowledgeService,
]:
    sessions = build_session_repository_from_env()
    world_models = build_world_model_repository_from_env()
    telemetry = build_telemetry_from_env()
    persistence = PersistenceService(build_persistence_repository_from_env())
    context_service = ContextService(
        repository=build_context_repository_from_env(),
        persistence=persistence,
    )
    memory_service = MemoryService(build_memory_repository_from_env())
    embedding_client = build_embedding_client_from_env()
    vector_store = build_vector_store_from_env()
    knowledge_service = KnowledgeService(
        build_knowledge_repository_from_env(),
        vector_store=vector_store,
        embedding_client=embedding_client,
    )
    import os
    engine_registry = EngineRegistry()
    engines_yaml = os.getenv("CEB_ENGINES_CONFIG", "configs/engines.yaml")
    # Resolve relative to root if needed
    if not os.path.isabs(engines_yaml):
        current_dir = os.path.dirname(os.path.abspath(__file__))
        root_dir = os.path.abspath(os.path.join(current_dir, "..", "..", ".."))
        resolved_yaml = os.path.join(root_dir, engines_yaml)
    else:
        resolved_yaml = engines_yaml

    engine_registry.load_from_yaml(resolved_yaml)

    kernel = CognitiveKernel(
        event_bus=build_event_bus_from_env(),
        engine_registry=engine_registry,
        session_repository=sessions,
        world_model_repository=world_models,
        context_service=context_service,
        memory_service=memory_service,
        knowledge_service=knowledge_service,
        telemetry=telemetry,
    )
    from clozflow_brain.infrastructure.runtime_store import RuntimeStore
    from clozflow_brain.infrastructure.sqlalchemy_repositories import create_repository_engine
    from clozflow_brain.application.runtime_service import RuntimeService
    runtime_url = os.getenv("CEB_RUNTIME_DATABASE_URL", os.getenv("CEB_DATABASE_URL", "sqlite:///data/runtime.sqlite")
                            if os.getenv("CEB_STORAGE_PROFILE") == "durable" else "sqlite:///:memory:")
    kernel.runtime = RuntimeService(RuntimeStore(create_repository_engine(runtime_url)))
    session_service = SessionService(
        sessions=sessions,
        world_models=world_models,
        telemetry=telemetry,
        kernel=kernel,
    )
    ingestion_service = EventIngestionService(kernel)
    return kernel, session_service, ingestion_service, context_service, memory_service, knowledge_service


def create_app() -> Any:

    (
        kernel,
        session_service,
        ingestion_service,
        context_service,
        memory_service,
        knowledge_service,
    ) = build_kernel()
    from clozflow_brain.api.auth import AccessControl
    access = AccessControl(kernel.session_repository)

    async def authorize_request(http: HTTPConnection) -> None:
        if not isinstance(http, Request):
            return
        if not http.url.path.startswith("/v1/"):
            return
        session_id = http.path_params.get("session_id")
        tenant_id = http.path_params.get("tenant_id") or http.query_params.get("tenant_id")
        scope = "brain:read" if http.method == "GET" else "brain:write"
        if http.method == "POST":
            access.check_rate(http)
        try:
            access.authorize(http, session_id=UUID(str(session_id)) if session_id else None,
                             tenant_id=UUID(str(tenant_id)) if tenant_id else None, scope=scope)
            if http.method in {"POST", "PATCH"}:
                body = await http.json() if await http.body() else {}
                for item in body if isinstance(body, list) else [body]:
                    if isinstance(item, dict) and item.get("tenant_id"):
                        access.authorize(http, tenant_id=UUID(item["tenant_id"]), scope=scope)
        except (ValueError, TypeError) as exc:
            raise HTTPException(422, "Invalid request identity or JSON") from exc

    from clozflow_brain.kernel.checkpointer import WorldModelCheckpointer
    checkpointer = WorldModelCheckpointer(
        kernel.session_repository, kernel.world_model_repository,
        build_checkpoint_repository_from_env(),
    )
    kernel.checkpoint_repository = checkpointer.checkpoint_repo

    async def maintenance():
        from clozflow_brain.application.data_lifecycle import run_retention
        while True:
            try:
                await asyncio.to_thread(run_retention, kernel)
            except Exception:
                import logging
                logging.getLogger(__name__).exception("Local retention maintenance failed")
            await asyncio.sleep(60)

    @asynccontextmanager
    async def lifespan(app):
        await asyncio.to_thread(kernel.recover_pending)
        await checkpointer.start()
        maintenance_task = asyncio.create_task(maintenance())
        try:
            yield
        finally:
            maintenance_task.cancel()
            try:
                await maintenance_task
            except asyncio.CancelledError:
                pass
            await checkpointer.checkpoint_active_sessions()
            await checkpointer.stop()
            kernel.close()
        close = getattr(kernel.event_bus, "close", None)
        if close:
            close()

    app = FastAPI(title="ClozFlow Enterprise Brain API", version="0.2.0",
                  lifespan=lifespan, dependencies=[Depends(authorize_request)])
    app.state.kernel = kernel
    app.state.access = access
    from clozflow_brain.api.transcripts import install_transcript_routes
    install_transcript_routes(app, kernel, ingestion_service)
    from clozflow_brain.api.runtime_features import install_runtime_routes
    install_runtime_routes(app, kernel, session_service, memory_service, knowledge_service)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "component": "brain-api"}

    @app.post("/v1/sessions", status_code=201)
    def create_session(request: CreateSessionRequest) -> dict[str, Any]:
        try:
            session = session_service.create_session(**request.model_dump())
        except (ValueError, PermissionError) as exc:
            raise HTTPException(409, str(exc)) from exc
        return session.model_dump(mode="json")

    @app.get("/v1/sessions/{session_id}")
    def get_session(session_id: UUID, tenant_id: UUID) -> dict[str, Any]:
        try:
            session = session_service.get_session(tenant_id=tenant_id, session_id=session_id)
        except (KeyError, PermissionError) as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return session.model_dump(mode="json")

    @app.patch("/v1/sessions/{session_id}")
    def patch_session(session_id: UUID, request: PatchSessionRequest) -> dict[str, Any]:
        try:
            session = session_service.update_session(
                tenant_id=request.tenant_id,
                session_id=session_id,
                status=request.status,
                metadata=request.metadata,
            )
        except (KeyError, PermissionError) as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        return session.model_dump(mode="json")

    @app.delete("/v1/sessions/{session_id}", status_code=204)
    def delete_session(session_id: UUID, tenant_id: UUID) -> None:
        try:
            session_service.terminate_session(tenant_id=tenant_id, session_id=session_id)
        except (KeyError, PermissionError) as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/v1/sessions/{session_id}/wm")
    def get_world_model(session_id: UUID) -> dict[str, Any]:
        try:
            world_model = kernel.world_model_repository.get(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return world_model.model_dump(mode="json")

    @app.get("/v1/sessions/{session_id}/recs")
    def get_recommendations(session_id: UUID) -> list[dict[str, Any]]:
        try:
            world_model = kernel.world_model_repository.get(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return [rec.model_dump(mode="json") for rec in world_model.pending_recommendations]

    @app.get("/v1/sessions/{session_id}/context/current")
    def get_current_context(session_id: UUID) -> dict[str, Any]:
        context = context_service.latest_for_session(session_id)
        if context is None:
            raise HTTPException(status_code=404, detail="context not found for session")
        return context.model_dump(mode="json")

    @app.post("/v1/tenants/{tenant_id}/memory", status_code=201)
    def store_memory(tenant_id: UUID, request: MemoryRecord) -> dict[str, Any]:
        if request.tenant_id != tenant_id:
            raise HTTPException(status_code=400, detail="memory tenant_id does not match route")
        return memory_service.store(request).model_dump(mode="json")

    @app.get("/v1/tenants/{tenant_id}/memory")
    def list_memory(tenant_id: UUID) -> list[dict[str, Any]]:
        return [memory.model_dump(mode="json") for memory in memory_service.list_for_tenant(tenant_id)]

    @app.post("/v1/tenants/{tenant_id}/knowledge", status_code=201)
    def store_knowledge(tenant_id: UUID, request: KnowledgeArtifact) -> dict[str, Any]:
        if request.tenant_id != tenant_id:
            raise HTTPException(status_code=400, detail="knowledge tenant_id does not match route")
        return knowledge_service.store(request).model_dump(mode="json")

    @app.get("/v1/tenants/{tenant_id}/knowledge")
    def list_knowledge(tenant_id: UUID) -> list[dict[str, Any]]:
        return [
            knowledge.model_dump(mode="json")
            for knowledge in knowledge_service.list_for_tenant(tenant_id)
        ]

    @app.post("/v1/sessions/{session_id}/knowledge/discover")
    def discover_knowledge(session_id: UUID, request: DiscoveryIntent) -> dict[str, Any]:
        if request.session_id != session_id:
            raise HTTPException(status_code=400, detail="intent session_id does not match route")
        return knowledge_service.discover(request).model_dump(mode="json")

    @app.post("/v1/sessions/{session_id}/events")
    def ingest_event(session_id: UUID, request: CognitiveEvent) -> dict[str, Any]:
        if request.session_id != session_id:
            raise HTTPException(status_code=400, detail="event session_id does not match route")
        try:
            result = ingestion_service.ingest(request)
        except Exception as exc:  # noqa: BLE001 - API returns structured error to protect internals.
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {
            "cycle_id": str(result.cycle_id),
            "accepted_event_ids": [str(event.event_id) for event in result.accepted_events],
            "engine_count": len(result.engine_outputs),
            "mutation_count": len(result.applied_mutations),
            "status": "complete" if all(o.status.value == "SUCCESS" for o in result.engine_outputs) else "degraded",
            "engines": [{"engine_id": o.engine_id, "status": o.status.value, "duration_ms": o.duration_ms}
                        for o in result.engine_outputs],
        }

    @app.post("/v1/sessions/{session_id}/events/batch")
    def ingest_batch(session_id: UUID, request: list[CognitiveEvent]) -> dict[str, Any]:
        if not request:
            raise HTTPException(status_code=400, detail="batch must contain at least one event")
        if any(event.session_id != session_id for event in request):
            raise HTTPException(status_code=400, detail="all events must match route session_id")
        try:
            result = ingestion_service.ingest_batch(request)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {
            "cycle_id": str(result.cycle_id),
            "accepted_event_ids": [str(event.event_id) for event in result.accepted_events],
            "engine_count": len(result.engine_outputs),
            "mutation_count": len(result.applied_mutations),
            "status": "complete" if all(o.status.value == "SUCCESS" for o in result.engine_outputs) else "degraded",
            "engines": [{"engine_id": o.engine_id, "status": o.status.value, "duration_ms": o.duration_ms}
                        for o in result.engine_outputs],
        }

    @app.websocket("/v1/sessions/{session_id}/recommendations/stream")
    async def stream_recommendations(websocket: WebSocket, session_id: UUID) -> None:
        import os
        try:
            access.authorize(websocket, session_id=session_id, scope="brain:read")
        except HTTPException:
            await websocket.close(code=1008)
            return
        await websocket.accept()

        # Broadcast frontend connection to global telemetry
        def _broadcast_telemetry_event(evt_type: str):
            msg = json.dumps({"event_type": evt_type, "session_id": str(session_id)})
            backend = os.getenv("CEB_WORLD_MODEL_REPOSITORY", "memory").lower()
            if backend in {"redis", "redis_json"}:
                import redis
                redis_url = os.getenv("CEB_REDIS_URL", "redis://:local-dev-only@localhost:6379/0")
                try:
                    r = redis.Redis.from_url(redis_url)
                    r.publish("clozflow:telemetry:updates:global", msg)
                    r.close()
                except Exception:
                    pass
            else:
                from clozflow_brain.infrastructure.pubsub import get_in_memory_pubsub
                get_in_memory_pubsub().publish("clozflow:telemetry:updates:global", msg)

        _broadcast_telemetry_event("FRONTEND_CONNECTED")

        expiry_tasks: set[asyncio.Task] = set()
        delivered: set[str] = set()
        delivered_bodies: list[str] = []
        last_heartbeat_ack = asyncio.Event()

        def _get_tokens(text: str) -> set[str]:
            import re
            return {token.lower() for token in re.findall(r"[a-zA-Z0-9_]+", text) if len(token) > 2}

        def _cosine_similarity(text1: str, text2: str) -> float:
            t1 = _get_tokens(text1)
            t2 = _get_tokens(text2)
            if not t1 or not t2:
                return 0.0
            intersection = t1.intersection(t2)
            return len(intersection) / (len(t1) ** 0.5 * len(t2) ** 0.5)

        def _is_duplicate(rec_body: str) -> bool:
            # Sliding window of last 10 recommendations
            for old_body in delivered_bodies[-10:]:
                if _cosine_similarity(rec_body, old_body) >= 0.8:
                    return True
            return False

        async def receiver() -> None:
            try:
                while True:
                    data = await websocket.receive_text()
                    try:
                        msg = json.loads(data)
                        if msg.get("msg_type") == "PONG":
                            last_heartbeat_ack.set()
                    except json.JSONDecodeError:
                        if data.strip().upper() == "PONG":
                            last_heartbeat_ack.set()
            except WebSocketDisconnect:
                raise
            except Exception:
                return

        async def schedule_expiry(r_id: str, ttl_ms: int) -> None:
            await asyncio.sleep(ttl_ms / 1000.0)
            try:
                await websocket.send_text(
                    json.dumps({
                        "msg_type": "RECOMMENDATION_EXPIRED",
                        "payload": {"rec_id": r_id},
                        "server_ts": utc_now().isoformat()
                    })
                )
            except Exception:
                pass

        async def send_updates() -> None:
            try:
                world_model = kernel.world_model_repository.get(session_id)
            except KeyError:
                return

            for rec in world_model.pending_recommendations:
                remaining_ms = rec.display_ttl_ms - int((utc_now() - rec.created_at_utc).total_seconds() * 1000)
                if remaining_ms <= 0:
                    continue
                rec_id = str(rec.rec_id)
                if rec_id in delivered:
                    continue

                body_text = getattr(getattr(rec, "content", None), "body", "")
                if _is_duplicate(body_text):
                    continue

                await websocket.send_text(
                    json.dumps({
                        "msg_type": "RECOMMENDATION",
                        "payload": rec.model_dump(mode="json"),
                        "server_ts": rec.created_at_utc.isoformat()
                    })
                )
                from clozflow_brain.kernel.observability import TelemetrySignal
                labels = {"rec_type": rec.rec_type.value, "urgency": rec.urgency.value, "tenant_id": str(world_model.tenant_id)}
                kernel.telemetry.increment(TelemetrySignal.BRAIN_RECOMMENDATIONS_DELIVERED, labels)
                kernel.telemetry.observe(TelemetrySignal.BRAIN_RECOMMENDATION_LATENCY_MS,
                    max(0, (utc_now() - rec.created_at_utc).total_seconds() * 1000), labels)
                delivered.add(rec_id)
                delivered_bodies.append(body_text)

                # Spawn task to signal client when visual TTL expires
                ttl_ms = remaining_ms
                expiry_task = asyncio.create_task(schedule_expiry(rec_id, ttl_ms))
                expiry_tasks.add(expiry_task)
                expiry_task.add_done_callback(expiry_tasks.discard)

        async def sender() -> None:
            # Send initial recommendations immediately
            await send_updates()

            backend = os.getenv("CEB_WORLD_MODEL_REPOSITORY", "memory").lower()
            if backend in {"redis", "redis_json"}:
                from clozflow_brain.infrastructure.pubsub import RedisPubSub
                redis_url = os.getenv("CEB_REDIS_URL", "redis://:local-dev-only@localhost:6379/0")
                pubsub_stream = RedisPubSub(redis_url).subscribe(f"clozflow:wm:updates:{session_id}")
            else:
                from clozflow_brain.infrastructure.pubsub import get_in_memory_pubsub
                pubsub_stream = get_in_memory_pubsub().subscribe(f"clozflow:wm:updates:{session_id}")

            try:
                async for _ in pubsub_stream:
                    await send_updates()
            except WebSocketDisconnect:
                raise
            except Exception:
                return

        async def heartbeat_loop() -> None:
            try:
                while True:
                    await asyncio.sleep(15)
                    last_heartbeat_ack.clear()
                    await websocket.send_text(
                        json.dumps({
                            "msg_type": "HEARTBEAT",
                            "payload": None,
                            "server_ts": utc_now().isoformat()
                        })
                    )
                    try:
                        await asyncio.wait_for(last_heartbeat_ack.wait(), timeout=5.0)
                    except TimeoutError:
                        await websocket.close(code=1000, reason="heartbeat timeout")
                        return
            except WebSocketDisconnect:
                raise
            except Exception:
                return

        try:
            tasks = [asyncio.create_task(coro()) for coro in (receiver, sender, heartbeat_loop)]
            try:
                await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass
        except Exception:
            pass
        finally:
            for expiry_task in expiry_tasks:
                expiry_task.cancel()
            _broadcast_telemetry_event("FRONTEND_DISCONNECTED")

    @app.websocket("/v1/sessions/{session_id}/telemetry/stream")
    async def stream_telemetry(websocket: WebSocket, session_id: UUID) -> None:
        import os
        import asyncio
        try:
            access.authorize(websocket, session_id=session_id, scope="brain:read")
        except HTTPException:
            await websocket.close(code=1008)
            return
        await websocket.accept()
        last_heartbeat_ack = asyncio.Event()

        async def sender() -> None:
            backend = os.getenv("CEB_WORLD_MODEL_REPOSITORY", "memory").lower()
            if backend in {"redis", "redis_json"}:
                from clozflow_brain.infrastructure.pubsub import RedisPubSub
                redis_url = os.getenv("CEB_REDIS_URL", "redis://:local-dev-only@localhost:6379/0")
                pubsub_stream = RedisPubSub(redis_url).subscribe(f"clozflow:telemetry:updates:{session_id}")
            else:
                from clozflow_brain.infrastructure.pubsub import get_in_memory_pubsub
                pubsub_stream = get_in_memory_pubsub().subscribe(f"clozflow:telemetry:updates:{session_id}")

            try:
                async for message in pubsub_stream:
                    await websocket.send_text(message)
            except WebSocketDisconnect:
                raise
            except Exception:
                return

        async def receiver() -> None:
            try:
                while True:
                    data = await websocket.receive_text()
                    try:
                        msg = json.loads(data)
                        if msg.get("msg_type") == "PONG":
                            last_heartbeat_ack.set()
                    except json.JSONDecodeError:
                        if data.strip().upper() == "PONG":
                            last_heartbeat_ack.set()
            except WebSocketDisconnect:
                raise
            except Exception:
                return

        async def heartbeat_loop() -> None:
            try:
                while True:
                    await asyncio.sleep(15)
                    last_heartbeat_ack.clear()
                    await websocket.send_text(json.dumps({"msg_type": "HEARTBEAT"}))
                    try:
                        await asyncio.wait_for(last_heartbeat_ack.wait(), timeout=5.0)
                    except TimeoutError:
                        await websocket.close(code=1000, reason="heartbeat timeout")
                        return
            except WebSocketDisconnect:
                raise
            except Exception:
                return

        try:
            tasks = [asyncio.create_task(coro()) for coro in (receiver, sender, heartbeat_loop)]
            try:
                await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass
        except Exception:
            pass

    @app.websocket("/v1/telemetry/stream")
    async def stream_telemetry_global(websocket: WebSocket) -> None:
        import os
        import asyncio
        try:
            access.authorize(websocket, scope="brain:telemetry:global")
        except HTTPException:
            await websocket.close(code=1008)
            return
        await websocket.accept()
        last_heartbeat_ack = asyncio.Event()

        async def sender() -> None:
            backend = os.getenv("CEB_WORLD_MODEL_REPOSITORY", "memory").lower()
            if backend in {"redis", "redis_json"}:
                from clozflow_brain.infrastructure.pubsub import RedisPubSub
                redis_url = os.getenv("CEB_REDIS_URL", "redis://:local-dev-only@localhost:6379/0")
                pubsub_stream = RedisPubSub(redis_url).subscribe("clozflow:telemetry:updates:global")
            else:
                from clozflow_brain.infrastructure.pubsub import get_in_memory_pubsub
                pubsub_stream = get_in_memory_pubsub().subscribe("clozflow:telemetry:updates:global")

            try:
                async for message in pubsub_stream:
                    await websocket.send_text(message)
            except WebSocketDisconnect:
                raise
            except Exception:
                return

        async def receiver() -> None:
            try:
                while True:
                    data = await websocket.receive_text()
                    try:
                        msg = json.loads(data)
                        if msg.get("msg_type") == "PONG":
                            last_heartbeat_ack.set()
                    except json.JSONDecodeError:
                        if data.strip().upper() == "PONG":
                            last_heartbeat_ack.set()
            except WebSocketDisconnect:
                raise
            except Exception:
                return

        async def heartbeat_loop() -> None:
            try:
                while True:
                    await asyncio.sleep(15)
                    last_heartbeat_ack.clear()
                    await websocket.send_text(json.dumps({"msg_type": "HEARTBEAT"}))
                    try:
                        await asyncio.wait_for(last_heartbeat_ack.wait(), timeout=5.0)
                    except TimeoutError:
                        await websocket.close(code=1000, reason="heartbeat timeout")
                        return
            except WebSocketDisconnect:
                raise
            except Exception:
                return

        try:
            tasks = [asyncio.create_task(coro()) for coro in (receiver, sender, heartbeat_loop)]
            try:
                await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass
        except Exception:
            pass

    import os
    static_dir = os.path.join(os.path.dirname(__file__), "static")
    os.makedirs(static_dir, exist_ok=True)
    app.mount("/ui", StaticFiles(directory=static_dir, html=True), name="static")

    return app
