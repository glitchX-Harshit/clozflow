"""Exercise one synthetic transcript through the configured live model and API."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import time
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))


def main() -> int:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
    # Isolate synthetic checks from the user's durable session data.
    os.environ["CEB_STORAGE_PROFILE"] = "memory"
    for name in ("SESSION", "WORLD_MODEL", "MEMORY", "CONTEXT", "KNOWLEDGE", "PERSISTENCE", "CHECKPOINT"):
        os.environ[f"CEB_{name}_REPOSITORY"] = "memory"
    os.environ["CEB_AUTH_MODE"] = "local"
    os.environ["CEB_EVENT_BUS"] = "memory"
    os.environ["CEB_QDRANT_MODE"] = "memory"
    os.environ["CEB_EMBEDDING_CLIENT"] = "mock"
    os.environ["CEB_SCHEDULER_MODE"] = "local"
    from fastapi.testclient import TestClient
    from clozflow_brain.api.main import create_app
    tenant = str(uuid4())
    started = time.perf_counter()
    with TestClient(create_app()) as client:
        response = client.post("/v1/sessions", json={"tenant_id": tenant, "salesperson_id": "synthetic-check",
            "metadata": {"call_context": {
                "product_name": "Example CRM", "product_price": "1000 INR per user per month",
                "product_specification": "Contact records and sales pipeline tracking. No discount or trial has been authorized.",
                "call_goal": "Understand the buyer's needs and agree a product demonstration.",
            }}})
        response.raise_for_status()
        sid = response.json()["session_id"]
        response = client.post(f"/v1/sessions/{sid}/transcripts", json={
            "sequence_num": 1, "speaker_id": "buyer", "speaker_role": "BUYER",
            "text": "We are losing track of follow-ups in spreadsheets. What does your product cost?",
        })
        response.raise_for_status()
        report = response.json()
        report["elapsed_seconds"] = round(time.perf_counter() - started, 2)
        from clozflow_brain.contracts.events import EventType
        report["errors"] = [event.payload.get("reasoning_trace") for event in
                            client.app.state.kernel.event_bus.list_events(EventType.ENGINE_TELEMETRY)
                            if event.payload.get("status") in {"ERROR", "TIMEOUT"}]
        print(json.dumps(report, indent=2), flush=True)
        client.delete(f"/v1/sessions/{sid}", params={"tenant_id": tenant}).raise_for_status()
        memories = client.get(f"/v1/tenants/{tenant}/memory").json()
        report["reflection_memory_count"] = len(memories)
        print("Reflection memories:", len(memories), flush=True)
    (ROOT / "logs").mkdir(exist_ok=True)
    (ROOT / "logs" / "live-transcript-check.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return 0 if report["status"] == "complete" and report["recommendations"] and memories else 1


if __name__ == "__main__":
    raise SystemExit(main())
