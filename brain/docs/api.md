> Historical implementation notes. For the current runtime and verified limitations, see [implementation-status.md](implementation-status.md) and the repository README.

# Brain API

The current main-app transcript contract and local port 8010 are documented in
[local integration](local-integration.md). Speech processing belongs to the main app.

The public API adapter follows CCBS Volume X Chapter 3. Future ClozFlow applications must use this API boundary rather than importing Brain internals.

## Running Locally

From the repository root:

```powershell
python -m pip install -e .
python .\scripts\run_api.py
```

Direct Uvicorn invocation also works when `src` is passed as the app directory:

```powershell
python -m uvicorn clozflow_brain.api.main:create_app --factory --host 127.0.0.1 --port 8000
```

From outside the repository root, pass the app directory explicitly:

```powershell
python -m uvicorn --app-dir src clozflow_brain.api.main:create_app --factory --host 127.0.0.1 --port 8000
```

## Session Endpoints

- `POST /v1/sessions`: create a Brain Session and initialize its World Model.
- `GET /v1/sessions/{session_id}`: retrieve session state. The Phase 1 adapter accepts `tenant_id` as a query parameter until JWT tenant extraction is implemented.
- `PATCH /v1/sessions/{session_id}`: update session metadata or lifecycle status.
- `DELETE /v1/sessions/{session_id}`: terminate a session and emit a session-end event.
- `GET /v1/sessions/{session_id}/wm`: read the current World Model snapshot.
- `GET /v1/sessions/{session_id}/recs`: read pending recommendations.
- `GET /v1/sessions/{session_id}/context/current`: read the latest Brain-owned runtime context.

## Memory And Knowledge

- `POST /v1/tenants/{tenant_id}/memory`: store a typed memory record.
- `GET /v1/tenants/{tenant_id}/memory`: list memory records for a tenant.
- `POST /v1/tenants/{tenant_id}/knowledge`: store a semantic knowledge artifact.
- `GET /v1/tenants/{tenant_id}/knowledge`: list semantic knowledge artifacts for a tenant.
- `POST /v1/sessions/{session_id}/knowledge/discover`: discover a provenance-preserving knowledge package for a cognitive intent.

## Event Endpoints

- `POST /v1/sessions/{session_id}/events`: ingest one canonical `CognitiveEvent`.
- `POST /v1/sessions/{session_id}/events/batch`: ingest a same-session event batch and execute one Cognitive Execution Cycle.

Every accepted event is validated against the CCBS event registry before it reaches kernel execution.

## Streaming

- `WSS /v1/sessions/{session_id}/recommendations/stream`: streams recommendation envelopes.
- The server emits heartbeat envelopes and expects a client acknowledgement within five seconds.

## Current Adapter Limits

- Production JWT verification, rate limiting, and tenant extraction are pending security-adapter work.
- The stream adapter polls the in-memory repository. A production adapter should subscribe to the recommendation topic.
