# ClozFlow Enterprise Brain

**Local main-app workspace:** run
`.\.venv\Scripts\python.exe scripts/run_local_stack.py start`, then open
http://127.0.0.1:5173/brain. Local sign-in, saved transcripts, compact/full
reasoning, knowledge, feedback, policies, reflection and tasks are connected to
the main project. See [the local guide](docs/local-integration.md).

ClozFlow is a Python cognitive runtime for sales conversations, based on the ten
CCBS volumes included in this repository. The full profile runs nine engines on
transcripts in dependency order; Reflection processes session closure. The local
profile combines reasoning into one Gemini request per final buyer turn. The kernel enriches
context with memory and knowledge, validates engine mutations, commits the World
Model, and delivers recommendations over WebSocket.

The Brain receives text transcripts. Speech recognition, audio capture, turn
detection and speech synthesis belong to the main ClozFlow project at
`C:\Users\ASUS\Desktop\clozflow main ui and interface`.
See [local integration](docs/local-integration.md) for the installed adapter and API contract.

The current delivery target is one Windows PC using Gemini. Full CCBS production
completion has **not** been established. See [implementation status](docs/implementation-status.md)
for verified behavior, blockers, and the remaining specification requirements.

## Run on this PC

Use the existing virtual environment from the repository root:

```powershell
.\.venv\Scripts\python.exe scripts/check_runtime.py
.\.venv\Scripts\python.exe scripts/check_runtime.py --live-model
.\.venv\Scripts\python.exe scripts/run_api.py
```

Open <http://127.0.0.1:8010/ui/>. The engine dashboard is at
<http://127.0.0.1:8010/ui/engines.html>; enter the session ID from the main UI.
Interactive API documentation is at <http://127.0.0.1:8010/docs>.

The desktop launcher is also available:

```powershell
.\.venv\Scripts\python.exe start_clozflow_gui.py
```

Both launchers default to durable local storage in `data/runtime.sqlite`.
The earlier canonical artifact database `data/brain.sqlite` is preserved.
Keep this runtime to one API process. `CEB_PORT` defaults to 8010 so the main app
can keep port 8000. The launcher does not terminate unrelated processes.

## Install and configure

For a fresh environment, use Python 3.12 or newer and install:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
```

Copy `.env.example` to `.env` only if you do not already have configuration.
Set `CEB_LLM_PROVIDER=gemini` and supply `GEMINI_API_KEY` in `.env`.
The supplied key passed live structured generation with `gemini-3.5-flash-lite`.
`GEMINI_MODEL` is configurable. The previous `gemini-2.5-flash` model returned 404
for this account. Do not commit credentials or paste them into logs/chat.

`CEB_ENGINES_CONFIG=configs/engines.local.yaml` selects the local profile: text
normalization, one structured reasoning request, confidence and grounding checks,
then reflection at closure. Use `configs/engines.yaml` for the full ten-engine
reference profile. The local profile is not a claim that every CCBS subsystem has
been implemented. On one synthetic check, the full profile took 45.54 seconds;
the successful local check took 4.58 seconds including application startup, with
1.619 seconds in reasoning. These are individual observations, not a latency SLA.
One earlier compact attempt failed; provider availability and quota still apply.

Optional providers/features:

- `.[local]`: llama-cpp-python and Hugging Face model downloads. Local inference
  serializes access to the shared model. Its quality is not benchmarked.
- `.[embeddings]`: Optional OpenAI embedding adapter. Local configuration uses
  durable lexical retrieval; mock embeddings only exercise test plumbing.
- `.[otel]`: OTLP export dependencies.

Adapter selection remains environment-controlled. `CEB_STORAGE_PROFILE=durable`
selects SQLAlchemy repositories unless overridden. `CEB_SCHEDULER_MODE=local`
executes within a bounded worker pool. `celery` is an explicit distributed option.
`CEB_TIMEOUT_<ENGINE_TYPE>_MS` overrides a stage's execution deadline.

## Verification

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check src/
.\.venv\Scripts\python.exe -m pyright src/
```

The tests use validated model fixtures and make no model API requests. They cover
the complete cognitive cycle, HTTP/WebSocket delivery, durable restart, reflection
memory, lifecycle transitions, replay suppression, mutation ownership, scoring,
deadline isolation, and adapter contracts. JWT tests require the declared PyJWT
dependency; a skip is a missing validation gate, not a security pass.

On this machine, sandboxed Python loopback socket creation can hang. Tests passed
outside that sandbox. `check_runtime.py --live-model` makes one synthetic provider
request and reports a sanitized result.

`scripts/check_transcript_pipeline.py` makes live requests for a synthetic turn
and session-end reflection using isolated in-memory storage. Its report is saved
under `logs/live-transcript-check.json`.

## Runtime boundaries

| Directory | Purpose |
|---|---|
| `src/clozflow_brain/contracts` | Canonical Pydantic schemas |
| `src/clozflow_brain/kernel` | Coordination, scheduling, registry, telemetry |
| `src/clozflow_brain/application` | Sessions, context, memory, knowledge, learning consolidation |
| `src/clozflow_brain/engines` | Ten cognitive engines |
| `src/clozflow_brain/infrastructure` | Database, bus, vector, and model adapters |
| `src/clozflow_brain/api` | HTTP/WebSocket API and development interfaces |
| `docs/ccbs` | Specification extracts and subsystem references |
| `data/simulation_corpus` | 130 synthetic conversations |

Local API mode accepts loopback clients and checks browser origins. It is intended
for this PC only. Production mode requires RS256 JWT configuration; see
`.env.example`. External CRM integrations, production release gates and measured
model quality remain outside the validated local scope. Tenant export, erasure,
retention and encrypted active Brain payloads are implemented locally.
Speech processing is owned by the main app and is outside the Brain's scope.
