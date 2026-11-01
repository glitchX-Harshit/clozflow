# Pearl Adapter Guide

## 1. Purpose
The adapter layer isolates the evaluation lab from Clozflow's internal codebase. It provides a standardized async interface:
```python
class BasePearlAdapter(ABC):
    async def is_available(self) -> tuple[bool, str]: ...
    async def start_session(self, config: AgentConfig, scenario_id: str) -> str: ...
    async def send_message(self, session_id: str, message: str) -> TurnRecord: ...
    async def end_session(self, session_id: str) -> RunRecord: ...
```

## 2. Available Adapters

### `MockPearlAdapter` (`--adapter mock`)
- **Default for CI/CD and offline tests.**
- Simulates Pearl's responses deterministically with realistic simulated latencies (e.g., 350ms).
- Handles safety traps (DAN attacks, prompt injections) and objection pivots.
- Requires **zero API keys** and **zero network connectivity**.

### `DirectModulePearlAdapter` (`--adapter direct`)
- **Direct in-memory instantiation of Clozflow's `ConversationEngine`.**
- Passes dummy customer profiles into `ConversationEngine(objective, lead_context)` in memory.
- Streams Groq tokens directly into TTFT and turn latency profilers.
- **Strict Guardrails**:
  - `allow_real_telephony: false` unconditionally enforced.
  - Zero SQL writes to `backend/hexagon.db`.

### `LocalApiPearlAdapter` (`--adapter api`)
- **HTTP REST client connecting to Clozflow's sandbox endpoint.**
- Targets `http://127.0.0.1:8000/api/pearl/test-sessions`.
- Tests full application middleware, routing, and response serialization without real phone calls.

## 3. Factory Usage
```python
from adapters import get_adapter

# Initialize mock adapter
mock_adapter = get_adapter("mock", simulated_latency_ms=10.0)

# Initialize direct module adapter
direct_adapter = get_adapter("direct")

# Initialize API adapter
api_adapter = get_adapter("api", base_url="http://127.0.0.1:8000")
```
