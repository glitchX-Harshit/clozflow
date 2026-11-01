"""
Local API Pearl Adapter.
Connects to Clozflow's local FastAPI sandbox endpoints (/api/pearl/test-sessions) via HTTP.
Allows end-to-end testing against the running backend server without modifying any routes.
"""
import time
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional
import httpx

from .base import BasePearlAdapter, AgentConfig, TurnRecord, RunRecord, LatencyMetrics, ToolEvent


class LocalApiPearlAdapter(BasePearlAdapter):
    """
    Adapter communicating with ClozFlow's existing local test-session REST API.
    Points to http://localhost:8000/api/pearl/test-sessions by default.
    """

    def __init__(self, base_url: str = "http://127.0.0.1:8000", auth_token: Optional[str] = None):
        super().__init__(name="local_api_adapter")
        self.base_url = base_url.rstrip("/")
        self.auth_token = auth_token
        self.sessions: Dict[str, Dict[str, Any]] = {}

    def _headers(self) -> Dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.auth_token:
            h["Authorization"] = f"Bearer {self.auth_token}"
        return h

    async def is_available(self) -> tuple[bool, str]:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                res = await client.get(f"{self.base_url}/api/pearl/test-sessions", headers=self._headers())
                # If endpoint responds (even 401/403 or 200), server is reachable
                if res.status_code in [200, 401, 403, 404]:
                    return True, f"Local API server reachable at {self.base_url} (HTTP {res.status_code})"
                return False, f"Unexpected response from {self.base_url}: HTTP {res.status_code}"
        except Exception as e:
            return False, f"Local API server unreachable at {self.base_url}: {str(e)}"

    async def start_session(self, config: AgentConfig, scenario_id: str) -> str:
        url = f"{self.base_url}/api/pearl/test-sessions"
        payload = {
            "name": f"Eval-{scenario_id}",
            "mission": config.objective,
            "system_prompt": config.system_prompt_override,
            "test_variables": {
                "business_name": config.business_name,
                "product_name": config.product_name,
                "capsule_context": config.capsule_context
            }
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(url, json=payload, headers=self._headers())
            if res.status_code not in (200, 201):
                # Fallback to local session emulation if backend test-sessions endpoint requires specific auth
                session_id = f"api-sess-{uuid.uuid4().hex[:12]}"
            else:
                data = res.json()
                session_id = str(data.get("id") or f"api-sess-{uuid.uuid4().hex[:12]}")

        self.sessions[session_id] = {
            "session_id": session_id,
            "scenario_id": scenario_id,
            "config": config,
            "started_at": datetime.utcnow(),
            "turns": [],
            "turn_count": 0
        }
        return session_id

    async def send_message(self, session_id: str, message: str) -> TurnRecord:
        if session_id not in self.sessions:
            raise ValueError(f"Session {session_id} not found.")

        sess = self.sessions[session_id]
        sess["turn_count"] += 1

        prospect_turn = TurnRecord(
            speaker="prospect",
            text=message,
            timestamp=datetime.utcnow().timestamp()
        )
        sess["turns"].append(prospect_turn)

        url = f"{self.base_url}/api/pearl/test-sessions/{session_id}/chat"
        payload = {"message": message, "stream": False}

        t0 = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=25.0) as client:
                res = await client.post(url, json=payload, headers=self._headers())
                elapsed_ms = (time.monotonic() - t0) * 1000.0

                if res.status_code == 200:
                    data = res.json()
                    reply_text = data.get("reply") or data.get("response") or data.get("text") or ""
                    model_meta = data.get("metadata", {"provider": "api", "model": "pearl"})
                else:
                    reply_text = f"[API Error {res.status_code}: {res.text[:100]}]"
                    model_meta = {"error": res.status_code}

                pearl_turn = TurnRecord(
                    speaker="pearl",
                    text=reply_text,
                    timestamp=datetime.utcnow().timestamp(),
                    latency=LatencyMetrics(total_turn_ms=elapsed_ms),
                    model_metadata=model_meta
                )
                sess["turns"].append(pearl_turn)
                return pearl_turn

        except Exception as e:
            elapsed_ms = (time.monotonic() - t0) * 1000.0
            error_turn = TurnRecord(
                speaker="pearl",
                text=f"[API Connection Error: {str(e)}]",
                timestamp=datetime.utcnow().timestamp(),
                latency=LatencyMetrics(total_turn_ms=elapsed_ms),
                model_metadata={"error": str(e)}
            )
            sess["turns"].append(error_turn)
            return error_turn

    async def end_session(self, session_id: str) -> RunRecord:
        if session_id not in self.sessions:
            raise ValueError(f"Session {session_id} not found.")

        sess = self.sessions.pop(session_id)
        url = f"{self.base_url}/api/pearl/test-sessions/{session_id}/end"
        
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(url, headers=self._headers())
        except Exception:
            pass

        now = datetime.utcnow()
        duration = (now - sess["started_at"]).total_seconds()

        return RunRecord(
            run_id=f"run-{uuid.uuid4().hex[:8]}",
            scenario_id=sess["scenario_id"],
            adapter_name=self.name,
            session_id=session_id,
            started_at=sess["started_at"],
            completed_at=now,
            turns=sess["turns"],
            total_turns=len(sess["turns"]),
            total_duration_seconds=duration,
            status="completed",
            metadata={"config": sess["config"].dict()}
        )
