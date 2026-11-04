"""Local transcript adapter for the ClozFlow UI backend; owns no speech pipeline."""
from __future__ import annotations

import asyncio
import os
from urllib.parse import urlsplit
from uuid import NAMESPACE_URL, uuid4, uuid5

import httpx


class BrainClient:
    is_brain_client = True

    def __init__(self, call_context: dict | None = None, *, transport=None):
        context = call_context or {}
        base_url = os.getenv("CLOZFLOW_BRAIN_URL", "http://127.0.0.1:8010").rstrip("/")
        parsed = urlsplit(base_url)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("The local Brain adapter requires a loopback HTTP URL")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Brain URL must not contain credentials or query parameters")
        self.tenant_id = str(uuid5(NAMESPACE_URL, f"clozflow-local:user:{context.get('user_id', 'local')}"))
        self.salesperson_id = str(context.get("user_id", "local"))
        context_id = context.get('_context_id')
        self._resume_id = str(uuid5(NAMESPACE_URL, f"{self.tenant_id}:call:{context_id}")) if context_id else None
        self.call_context = {key: str(context[key])[:8000] for key in (
            "client_name", "client_industry", "client_role", "product_name",
            "product_price", "product_specification", "call_goal") if context.get(key) is not None}
        self._client = httpx.AsyncClient(base_url=base_url, timeout=httpx.Timeout(
            float(os.getenv("CLOZFLOW_BRAIN_TIMEOUT_SECONDS", "300")), connect=3), transport=transport,
            trust_env=False)
        self._lock = asyncio.Lock()
        self.session_id: str | None = None
        self._sequence = 0
        self._closed = False

    async def analyze(self, speaker: str, text: str) -> dict | None:
        if not text.strip():
            return None
        async with self._lock:
            if self._closed:
                return None
            try:
                if self.session_id is None:
                    response = await self._client.post("/v1/sessions", json={
                        "tenant_id": self.tenant_id, "salesperson_id": self.salesperson_id, "session_id": self._resume_id,
                        "metadata": {"source": "clozflow-main", "call_context": self.call_context},
                    })
                    response.raise_for_status()
                    self.session_id = response.json()["session_id"]
                    state = await self._client.get(f'/v1/sessions/{self.session_id}/wm')
                    state.raise_for_status()
                    self._sequence = state.json()['conversation_state']['turn_count']
                self._sequence += 1
                role = {"prospect": "BUYER", "buyer": "BUYER", "rep": "SALESPERSON",
                        "salesperson": "SALESPERSON"}.get(speaker.lower(), "UNKNOWN")
                response = await self._client.post(f"/v1/sessions/{self.session_id}/transcripts", json={
                    "event_id": str(uuid4()), "sequence_num": self._sequence,
                    "text": text.strip(), "speaker_id": speaker, "speaker_role": role, "is_final": True,
                })
                response.raise_for_status()
                return self._analysis(response.json())
            except (httpx.HTTPError, KeyError, ValueError):
                return self._status("unavailable", "Brain unavailable. Transcript retained by the main app; no new suggestion is available.")

    def _status(self, status: str, message: str) -> dict:
        return {"brain_status": status, "brain_session_id": self.session_id,
                "suggested_response": "", "response": "", "next_best_question": "",
                "coaching_tip": message, "confidence": 0.0}

    def _analysis(self, result: dict) -> dict:
        status = result["status"]
        recommendations = result.get("recommendations", [])
        if not recommendations:
            message = {
                "degraded": "Brain could not complete this turn. No new suggestion is available.",
                "withheld": "Brain withheld a suggestion because it did not pass its confidence or verification checks.",
                "recorded": "Rep transcript recorded as context.",
                "duplicate": "Transcript already processed.",
            }.get(status, "Waiting for a complete transcript.")
            return self._status(status, message)
        rec = recommendations[-1]
        content = rec["content"]
        state = result.get("state", {})
        objections = [item for item in state.get("objections", []) if item.get("status") == "ACTIVE"]
        return {
            "brain_status": status, "brain_session_id": self.session_id,
            "brain_recommendation_id": rec["rec_id"], "confidence": rec["confidence"],
            "suggested_response": content["body"], "response": content["body"],
            "coaching_tip": content["rationale"], "strategy_used": content["headline"],
            "next_best_question": "", "deal_stage": state.get("phase", "").lower(),
            "objection_type": objections[-1]["objection_type"] if objections else "none",
            "alternatives": content.get("alternatives", []),
            "brain_engines": result.get("engines", []),
        }

    async def close(self, *, finalize: bool = True) -> None:
        async with self._lock:
            if self._closed:
                return
            self._closed = True
            try:
                if self.session_id and finalize:
                    response = await self._client.delete(f"/v1/sessions/{self.session_id}",
                                                         params={"tenant_id": self.tenant_id})
                    response.raise_for_status()
            finally:
                await self._client.aclose()
