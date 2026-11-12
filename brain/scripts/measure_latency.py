"""Performance & Latency Measurement Script for ClozFlow Brain WebSocket Delivery."""

from __future__ import annotations

import asyncio
import json
import multiprocessing
import sys
import time
import urllib.request
import uuid
import websockets


def http_post(url: str, data: dict) -> str:
    """Helper to send a JSON POST request using standard library urllib."""
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req) as res:
        return res.read().decode("utf-8")


def http_get(url: str) -> str:
    """Helper to send a GET request using standard library urllib."""
    with urllib.request.urlopen(url) as res:
        return res.read().decode("utf-8")


def run_server():
    """Run the FastAPI application on a dedicated test port."""
    import os
    os.environ["CEB_CELERY_ALWAYS_EAGER"] = "true"
    import uvicorn
    from clozflow_brain.api.main import create_app
    app = create_app()
    uvicorn.run(app, host="127.0.0.1", port=8005, log_level="warning")


async def measure_single_latency(session_id: str) -> float:
    """Connect to WebSocket, send transcript, and measure roundtrip delivery latency."""
    ws_url = f"ws://127.0.0.1:8005/v1/sessions/{session_id}/recommendations/stream"
    post_url = f"http://127.0.0.1:8005/v1/sessions/{session_id}/events"

    async with websockets.connect(ws_url) as websocket:
        event_payload = {
            "event_id": str(uuid.uuid4()),
            "event_type": "TRANSCRIPT_SEGMENT",
            "session_id": session_id,
            "tenant_id": "00000000-0000-0000-0000-000000000000",
            "timestamp_utc": "2026-06-28T23:00:00Z",
            "sequence_num": 1,
            "source": "latency_test",
            "priority": 1,
            "ttl_ms": 200,
            "confidence": 1.0,
            "payload": {
                "text": "The budget is extremely tight, is there any possibility of a discount?",
                "speaker_id": "spk-1",
                "speaker_role": "BUYER",
                "start_ms": 0,
                "end_ms": 1000,
                "is_final": True,
                "language": "en-US"
            }
        }

        # Start precision timer
        start_time = time.perf_counter()
        
        # Send post request
        try:
            http_post(post_url, event_payload)
        except Exception as e:
            raise RuntimeError(f"Event ingestion failed: {e}")

        # Wait for recommendation over WebSocket
        while True:
            frame_data = await websocket.recv()
            frame = json.loads(frame_data)
            
            # Respond to heartbeats if received
            if frame.get("msg_type") == "HEARTBEAT":
                await websocket.send(json.dumps({"msg_type": "PONG"}))
                continue
                
            if frame.get("msg_type") == "RECOMMENDATION":
                end_time = time.perf_counter()
                latency_ms = (end_time - start_time) * 1000.0
                return latency_ms


def main():
    print("=== CLOZFLOW BRAIN E2E LATENCY MEASUREMENT ===")
    
    # 1. Spawn FastAPI server in a background process
    multiprocessing.set_start_method("spawn", force=True)
    server_process = multiprocessing.Process(target=run_server)
    server_process.start()
    
    # Wait for server to boot
    print("Starting test server on port 8005...")
    time.sleep(3.0)

    try:
        # Verify server is up
        try:
            http_get("http://127.0.0.1:8005/ui")
        except Exception as e:
            print(f"Error connecting to test server: {e}")
            sys.exit(1)

        print("Server is active. Initiating latency runs...")
        
        latencies = []
        runs = 10
        for i in range(runs):
            # Create session using correct CreateSessionRequest format
            session_payload = {
                "tenant_id": "00000000-0000-0000-0000-000000000000",
                "salesperson_id": "sp-test-runner",
                "crm_opportunity_id": "opt-test-runner",
                "metadata": {}
            }
            try:
                res_data = http_post("http://127.0.0.1:8005/v1/sessions", session_payload)
                session_info = json.loads(res_data)
                session_id = session_info["session_id"]
            except Exception as e:
                print(f"Failed to create session on run {i}: {e}")
                continue

            try:
                latency = asyncio.run(measure_single_latency(session_id))
                latencies.append(latency)
                print(f"Run {i+1}/{runs}: {latency:.2f} ms")
            except Exception as ex:
                print(f"Run {i+1}/{runs} failed: {ex}")
            
            time.sleep(0.5)

        if not latencies:
            print("All latency measurement runs failed.")
            sys.exit(1)

        # 2. Analyze statistics
        latencies.sort()
        p50 = latencies[int(len(latencies) * 0.50)]
        p90 = latencies[int(len(latencies) * 0.90)]
        p95 = latencies[int(len(latencies) * 0.95)]
        p99 = latencies[-1]

        print("\n--- LATENCY METRICS ---")
        print(f"P50 (Median):  {p50:.2f} ms")
        print(f"P90:           {p90:.2f} ms")
        print(f"P95:           {p95:.2f} ms")
        print(f"P99:           {p99:.2f} ms")
        print("-----------------------")

        # 3. Assert latency SLA threshold
        if p95 < 1500.0:
            print("SUCCESS: P95 latency is under the 1,500 ms SLA!")
            sys.exit(0)
        else:
            print("FAILURE: P95 latency exceeded the 1,500 ms SLA.")
            sys.exit(1)

    finally:
        print("Stopping test server...")
        server_process.terminate()
        server_process.join()


if __name__ == "__main__":
    main()
