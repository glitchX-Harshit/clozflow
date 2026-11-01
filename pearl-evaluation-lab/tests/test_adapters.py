"""
Unit Tests for Pearl Adapters.
Tests Mock, Direct, and API adapter interfaces.
"""
try:
    import pytest
except ImportError:
    class DummyMark:
        def asyncio(self, f): return f
    class DummyPytest:
        mark = DummyMark()
    pytest = DummyPytest()
import asyncio
from adapters import get_adapter, AgentConfig


@pytest.mark.asyncio
async def test_mock_adapter_lifecycle():
    adapter = get_adapter("mock", simulated_latency_ms=10.0)
    ready, msg = await adapter.is_available()
    assert ready is True

    config = AgentConfig(
        objective="Test qualification",
        business_name="TestCorp",
        product_name="TestBot",
        capsule_context="Automated sales testing"
    )

    session_id = await adapter.start_session(config, "TEST-001")
    assert session_id.startswith("mock-sess-")

    # Send message turn
    turn1 = await adapter.send_message(session_id, "Hello, tell me about your pricing")
    assert turn1.speaker == "pearl"
    assert len(turn1.text) > 0
    assert turn1.latency.total_turn_ms > 0

    # End session
    run_record = await adapter.end_session(session_id)
    assert run_record.total_turns == 2  # 1 prospect + 1 pearl
    assert run_record.scenario_id == "TEST-001"
    assert run_record.status == "completed"


@pytest.mark.asyncio
async def test_direct_adapter_graceful_missing_credentials():
    adapter = get_adapter("direct")
    ready, msg = await adapter.is_available()
    # In CI without GROQ_API_KEY, should report unavailable gracefully
    if not ready:
        assert "GROQ_API_KEY" in msg or "unavailable" in msg.lower()


@pytest.mark.asyncio
async def test_api_adapter_graceful_offline():
    adapter = get_adapter("api", base_url="http://127.0.0.1:9999")
    ready, msg = await adapter.is_available()
    assert ready is False
    assert "unreachable" in msg.lower() or "connection" in msg.lower()
