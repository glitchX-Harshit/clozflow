import asyncio
import importlib.util
from pathlib import Path

import httpx

from clozflow_brain.api.main import create_app

spec = importlib.util.spec_from_file_location("brain_adapter", Path(__file__).resolve().parents[1] / "integrations/main_app/brain_client.py")
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
BrainClient = module.BrainClient


def test_main_adapter_contract_and_session_closure(local_env):
    async def run():
        app = create_app()
        async with app.router.lifespan_context(app):
            adapter = BrainClient({"user_id": 41, "product_name": "Test product"},
                                  transport=httpx.ASGITransport(app=app))
            result = await adapter.analyze("prospect", "We need help planning implementation.")
            assert result["brain_status"] == "complete"
            assert result["suggested_response"]
            assert result["brain_recommendation_id"]
            rep = await adapter.analyze("rep", "Let me explain the implementation steps.")
            assert rep["brain_status"] == "recorded"
            assert rep["suggested_response"] == ""
            await adapter.close()
            from uuid import UUID
            assert app.state.kernel.session_repository.get(UUID(adapter.session_id)).status.value == "TERMINATED"
    asyncio.run(run())


def test_adapter_failure_does_not_invent_suggestion():
    async def run():
        def failed(request):
            return httpx.Response(503)
        adapter = BrainClient(transport=httpx.MockTransport(failed))
        result = await adapter.analyze("buyer", "What is the price?")
        assert result["brain_status"] == "unavailable"
        assert result["suggested_response"] == ""
        await adapter.close()
    asyncio.run(run())


def test_adapter_reconnect_preserves_session_and_sequence(local_env):
    from uuid import UUID
    async def run():
        app = create_app()
        async with app.router.lifespan_context(app):
            context = {'user_id': 51, '_context_id': 'stable-call'}
            first = BrainClient(context, transport=httpx.ASGITransport(app=app))
            await first.analyze('rep', 'We provide reporting.')
            sid = first.session_id
            await first.close(finalize=False)
            second = BrainClient(context, transport=httpx.ASGITransport(app=app))
            await second.analyze('buyer', 'Please explain reporting.')
            assert second.session_id == sid and second._sequence == 2
            assert app.state.kernel.world_model_repository.get(UUID(sid)).conversation_state.turn_count == 2
            await second.close()
    asyncio.run(run())


def test_main_websocket_handoff(local_env, monkeypatch):
    """Run the installed main-app transcript handler with speech/DB adapters stubbed."""
    import json
    import sys
    from types import ModuleType, SimpleNamespace

    services = ModuleType("services")
    services.__path__ = []
    monkeypatch.setitem(sys.modules, "services", services)
    dependencies = {
        "services.transcript_manager": {"TranscriptManager": object},
        "services.brain_client": {"BrainClient": BrainClient},
        "services.gemini_stream": {"GeminiStream": object},
        "services.vad_engine": {"SileroVADEngine": object, "VADEvent": object, "SILERO_AVAILABLE": False},
        "services.turn_detector": {"TurnDetector": object},
        "services.latency_tracker": {"LatencyTracker": object},
        "services.call_context_engine": {"call_context_engine": SimpleNamespace(get_context=lambda _: None)},
        "database": {"SessionLocal": object}, "models": {"CallLog": object},
    }
    for name, attributes in dependencies.items():
        dependency = ModuleType(name)
        dependency.__dict__.update(attributes)
        monkeypatch.setitem(sys.modules, name, dependency)
    source = Path(__file__).resolve().parents[1] / "integrations/main_app/backend/services/websocket_service.py"
    handler_spec = importlib.util.spec_from_file_location("main_websocket_adapter", source)
    handler = importlib.util.module_from_spec(handler_spec)
    handler_spec.loader.exec_module(handler)
    monkeypatch.setenv("CLOZFLOW_COPILOT_ENGINE", "brain")

    class Socket:
        def __init__(self):
            self.messages = []
        async def accept(self):
            pass
        async def send_text(self, value):
            self.messages.append(json.loads(value))

    async def run():
        app = create_app()
        async with app.router.lifespan_context(app):
            monkeypatch.setattr(handler, "BrainClient", lambda call_context: BrainClient(
                call_context, transport=httpx.ASGITransport(app=app)))
            manager = handler.ConnectionManager()
            socket = Socket()
            await manager.connect(socket)
            await manager.handle_live_message([], socket)
            await manager.handle_live_message({"type": "transcriptUpdate", "text": "Partial", "is_final": False}, socket)
            assert socket.messages == []
            await manager.handle_live_message({"type": "transcriptUpdate", "text": "We need a clear plan", "speaker": "prospect"}, socket)
            assert [message["type"] for message in socket.messages] == ["transcriptUpdate", "aiAnalysis"]
            assert socket.messages[-1]["payload"]["suggested_response"]
            await manager.shutdown()
            assert not manager.active_connections
    asyncio.run(run())
