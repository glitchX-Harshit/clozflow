# Run the local ClozFlow workspace

Main project: `C:\Users\ASUS\Desktop\clozflow main ui and interface`.
From `C:\Users\ASUS\Desktop\Clozflow Brain`:

```powershell
.\.venv\Scripts\python.exe scripts/run_local_stack.py start
.\.venv\Scripts\python.exe scripts/run_local_stack.py status
# When finished:
.\.venv\Scripts\python.exe scripts/run_local_stack.py stop
```

Open **http://127.0.0.1:5173/brain**. Create your own local account, enter a call
brief, choose Fast guidance or Detailed analysis, and start a session. Send final
buyer/salesperson turns, review guidance, record feedback, and end the session for
reflection and proposed follow-up tasks. Saved sessions survive refresh/restart.
Use **Retry reflection** if the provider fails during closure. Knowledge text,
response policies, feedback statistics and export are in the workspace.

| Service | Address |
|---|---|
| Main UI | http://127.0.0.1:5173/brain |
| Main API docs | http://127.0.0.1:8000/docs |
| Brain API docs | http://127.0.0.1:8010/docs |
| Brain inspector | http://127.0.0.1:8010/ui |

The launcher starts hidden background processes, checks readiness, and refuses
ports owned by other processes. Stop verifies both PID and OS creation time.
Main call briefs have a four-hour resume window; workspace sessions remain saved
until explicitly closed or subject to a configured data-retention policy.

## Configuration

The Brain's ignored `.env` contains the Gemini key and the working model
`gemini-3.5-flash-lite`. Do not copy secrets into frontend code. Fast guidance uses
one request per buyer turn; salesperson turns need none. Detailed analysis uses
the ordered full pipeline. Closing invokes reflection. There are no hidden
provider retries; quota failures establish a shared cooldown.

The main app uses `frontend/.env.local: VITE_AUTH_MODE=local` and a native JWT
signing secret in its ignored `.env`. Existing provider credentials are preserved.
Speech/telephony credentials are not required by the Brain. Main data uses the
existing `backend/hexagon.db`; Brain data uses `data/runtime.sqlite`. The Brain
payload key is protected by Windows DPAPI. Keep this key with the original Windows
account. Legacy/pre-migration backups remain separate.

For a fresh environment:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev,main-app]"
# Install the main frontend dependencies using its lockfile.
```

Reviewed integration source is in `integrations/main_app`. Installation checks
hashes and backs up replaced files under `logs/main-app-backups`:

```powershell
.\.venv\Scripts\python.exe scripts/install_main_adapter.py --project-dir "C:\Users\ASUS\Desktop\clozflow main ui and interface" --apply
```

If the main app changed independently, review and merge before updating the
manifest. Returning to cloud sign-in requires removing the local auth override
and configuring a verified cloud JWT path. The old unsigned-token fallback was
removed.

If replacing the main `.env`, retain `CLOZFLOW_COPILOT_ENGINE=brain`,
`CLOZFLOW_BRAIN_URL=http://127.0.0.1:8010`, `CLOZFLOW_LOCAL_MODE=1`, the Brain
timeout and the existing `JWT_SECRET_KEY`. The installer restores missing local
settings, but generating a replacement JWT secret requires users to sign in
again. Provider credentials are preserved.

After changing the main Gemini key, run `scripts/check_main_config.py` to verify
it and synchronize the verified key into the Brain's ignored `.env`; then stop
and start the local stack. This checker sends a small real Gemini request and
checks the Groq model catalog. It does not validate every configured service.

## Integration contract

The main `/api/brain/*` gateway derives the tenant from the authenticated user.
It exposes sessions, transcripts, worlds, audit, feedback, tasks, context updates,
reflection retry, knowledge, policy, learning statistics and export.

1. `POST /v1/sessions`: tenant UUID, salesperson ID, optional stable session UUID,
   and `metadata.call_context`; `metadata.reasoning_profile` is `compact` or `full`.
2. `POST /v1/sessions/{id}/transcripts`:

```json
{"event_id":"c3bf3be0-19e3-4220-9a76-f5c580140e37","sequence_num":1,
 "speaker_role":"BUYER","speaker_id":"prospect","is_final":true,
 "text":"What does the monthly plan cost?"}
```

Reuse an event ID only to retry identical content. Text is limited to 16,000
characters; roles are `BUYER`, `SALESPERSON` or `UNKNOWN`. No audio is accepted.

| Status | Meaning |
|---|---|
| complete | Fresh guidance supplied |
| recorded | Salesperson context stored, no model call |
| awaiting_final | Interim text acknowledged without analysis |
| duplicate | Already processed, no repeated suggestion |
| withheld | No reply passed checks, or silence was appropriate |
| degraded | Provider/stage failed; transcript retained |

3. `DELETE /v1/sessions/{id}?tenant_id=...` closes without erasing stored data.
   `POST /v1/sessions/{id}/reflect` retries a failed reflection after closure.

Existing call flows use authenticated `/call/start`, then `/ws?context_id=...`.
Browser sockets offer `clozflow` and `clozflow-auth.<JWT>` subprotocols; the server
selects `clozflow`. API clients
can use a Bearer header. The server verifies call ownership. Send
`transcriptUpdate` with final text and speaker; responses are `transcriptUpdate`
and `aiAnalysis`. Unexpected disconnect preserves the Brain session. Send
`{"type":"end_session"}` to close a text session; audio uses `close_stream`.
The main app owns STT/TTS and supplies completed text.

## Verification

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check src tests scripts
.\.venv\Scripts\python.exe -m pyright src
.\.venv\Scripts\python.exe scripts/check_main_integration.py
.\.venv\Scripts\python.exe scripts/check_main_socket.py
.\.venv\Scripts\python.exe scripts/check_main_audio.py
```

The first three checks are offline. The last two require the running stack,
create synthetic QA accounts/data and consume Gemini quota. Reports are
`logs/main-integration-check.json` and `logs/main-socket-check.json`; service logs
are `logs/*-stack.log`. Script QA credentials are test-only. Create a separate
account for business data.

The audio checker opens Gemini transcription and Sarvam speech connections and
checks local Silero VAD on silence. It does not access the microphone, place a
phone call, or measure recognition/speech quality. The Sarvam adapter uses the
current WebSocket header and connection-state API, following the
[websockets migration guide](https://websockets.readthedocs.io/en/stable/howto/upgrade.html).

See [transcript-comparison.md](transcript-comparison.md) for the measured original
analyzer versus Brain comparison and its limits. Pearl autonomous calling still
uses its separate conversation engine; the integrated Brain path is the live
copilot and Brain workspace.

See [implementation-status.md](implementation-status.md) for validation and
broader CCBS production requirements.
