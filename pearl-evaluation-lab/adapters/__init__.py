"""
Pearl Adapter Package.
Provides unified factory access to BasePearlAdapter, MockPearlAdapter,
DirectModulePearlAdapter, and LocalApiPearlAdapter.
"""
from typing import Optional
from .base import (
    BasePearlAdapter,
    AgentConfig,
    TurnRecord,
    RunRecord,
    LatencyMetrics,
    ToolEvent,
    RetrievalEvent
)
from .mock_adapter import MockPearlAdapter
from .direct_adapter import DirectModulePearlAdapter
from .api_adapter import LocalApiPearlAdapter


def get_adapter(adapter_type: str = "mock", **kwargs) -> BasePearlAdapter:
    """
    Factory function to retrieve the requested Pearl adapter.
    Options: 'mock', 'direct', 'api'.
    """
    adapter_type = adapter_type.lower().strip()
    if adapter_type == "mock":
        latency = kwargs.get("simulated_latency_ms", 350.0)
        return MockPearlAdapter(simulated_latency_ms=latency)
    elif adapter_type in ("direct", "direct_module"):
        backend_path = kwargs.get("backend_path")
        return DirectModulePearlAdapter(backend_path=backend_path)
    elif adapter_type in ("api", "local_api"):
        base_url = kwargs.get("base_url", "http://127.0.0.1:8000")
        auth_token = kwargs.get("auth_token")
        return LocalApiPearlAdapter(base_url=base_url, auth_token=auth_token)
    else:
        raise ValueError(f"Unknown adapter type: '{adapter_type}'. Available: 'mock', 'direct', 'api'.")


__all__ = [
    "BasePearlAdapter",
    "AgentConfig",
    "TurnRecord",
    "RunRecord",
    "LatencyMetrics",
    "ToolEvent",
    "RetrievalEvent",
    "MockPearlAdapter",
    "DirectModulePearlAdapter",
    "LocalApiPearlAdapter",
    "get_adapter",
]
