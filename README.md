# Clozflow brain integrated

Development branch: **`mahav/clozflow-brain-integrated`**. This checkout combines the ClozFlow main interface with its integrated Brain. It does not replace `main` or modify an existing Desktop installation.

## Layout

- `frontend/`: React interface, local sign-in, live copilot and Brain workspace.
- `backend/`: application API, speech/telephony providers and authenticated Brain gateway.
- `brain/`: reasoning service, persistence, knowledge, memory, policies, feedback, audit and tests.
- `mobile/`, `ml/`, `rag/`, `dataset/`, `models/`, `pearl-evaluation-lab/`: supporting projects.
- `scripts/`: configure and run this integrated development checkout.

The main app supplies finalized transcripts; the Brain returns guidance. Speech recognition and synthesis remain in the main app. Gemini inference needs internet access even though application services and databases run locally.

## Windows setup

Use Python 3.12+ and Node.js 22+. From the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-integrated.txt
npm.cmd --prefix frontend ci
.\.venv\Scripts\python.exe scripts/configure_local.py
```

Set `GEMINI_API_KEY` directly in the root `.env`, then run `scripts/configure_local.py` again to synchronize it into `brain/.env`. Add optional speech and telephony credentials for those features. Setup generates a separate local JWT secret. No API keys, user accounts, databases, recordings, or session history are included.

```powershell
.\.venv\Scripts\python.exe scripts/run_integrated.py start
.\.venv\Scripts\python.exe scripts/run_integrated.py status
# Stop only processes launched by this checkout:
.\.venv\Scripts\python.exe scripts/run_integrated.py stop
```

Open **http://127.0.0.1:5273/brain** and create a local account.

| Service | Address |
|---|---|
| Main interface | http://127.0.0.1:5273 |
| Main API | http://127.0.0.1:8100 |
| Brain API | http://127.0.0.1:8110 |

The integrated launcher uses separate ports, separate databases and its own process journal. It refuses occupied ports and never stops an unrelated process. To customize ports, pass `--ui-port`, `--main-port` and `--brain-port`; stop this checkout first before changing them.

Main data is created in `backend/hexagon.db`; Brain data and its protected key are created under `brain/data/`. Private settings and runtime files are ignored by Git. Preserve your own Windows account and DPAPI-protected Brain key to reopen encrypted data.

## Checks

```powershell
Push-Location brain
..\.venv\Scripts\python.exe -m pytest tests -q --timeout=30
..\.venv\Scripts\python.exe -m ruff check src tests scripts
..\.venv\Scripts\python.exe -m pyright src
Pop-Location
npm.cmd --prefix frontend run build
.\.venv\Scripts\python.exe pearl-evaluation-lab/tests/run_tests.py
```

With the stack running, run `brain/scripts/check_main_integration.py` and `brain/scripts/check_main_socket.py` for live synthetic checks. They consume API quota and create test accounts. `brain/scripts/check_main_audio.py` checks speech-provider readiness without placing a call.

Fast guidance is the working default. Detailed multi-engine reasoning had Gemini timeouts in the latest environment-refresh checks. This development branch is not a production-readiness claim. The targeted transcript comparison is in [brain/docs/transcript-comparison.md](brain/docs/transcript-comparison.md); it does not measure general accuracy or sales conversion. Pearl autonomous calling retains its separate conversation engine.

See [the original main-app README](README-main.md) and [Brain implementation status](brain/docs/implementation-status.md). Older component docs may refer to the standalone folder layout and ports; this root guide describes the integrated checkout.
