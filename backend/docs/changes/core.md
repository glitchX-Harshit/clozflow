# Core backend changes (auth, user, wallet, calls, Brain gateway, deploy)

What web and app clients (and other backend owners) must know. Response shapes
only gained fields; nothing was renamed.

## Timestamps

The backend stores naive UTC. These responses now end in `Z` (parse as UTC):
`GET /calls/` `timestamp`, `GET /calls/{id}` `timestamp`, the new transcript
endpoint, `GET /api/wallet/transactions` `created_at`, and the user profile
`created_at`.

## Auth (`/auth/*`, `/api/auth/*`, every authenticated route)

- **Emails** are trimmed and lower-cased on register; login, register and cloud
  sign-in match emails case-insensitively (`John@X.com` = `john@x.com`).
- **Suspended / deactivated accounts** (admin `PATCH /api/admin/users/{id}/status`):
  - any token-authenticated request → `401`, `detail`:
    `"This account has been suspended or deactivated. Contact support to restore access."`
  - `POST /auth/login` with the right password → `403`, same `detail`.
  - WebSockets authenticated via `verify_token_string` (copilot `/ws`, Pearl,
    leads SSE) refuse them.
- Tokens now carry `iat`; a token issued before its account was created is
  rejected (SQLite reuses deleted ids). Tokens without `iat` still work.
- `Authorization: bearer …` is accepted in any case. Malformed `sub` → `401`.
- **`JWT_SECRET_KEY` is required in production.** The hard-coded fallback key
  is gone; without the variable each process uses a random key, so users are
  signed out on every restart.

## User profile (`/api/user/*`)

`GET /me`, `PATCH /update` and `POST /avatar` return two new fields:

```json
{ "ai_override_prompt": "Always lead with ROI." , "auth_provider": "local" }
```

- `ai_override_prompt`: `string | null`. `PATCH /update` accepts it; the value
  is trimmed, empty/whitespace → `null`, more than 4000 characters → `422` with
  `detail[0].msg` = `"Value error, Prompt override must be 4000 characters or fewer."`.
  The live copilot reads `User.ai_override_prompt`.
- `auth_provider`: `"local"` (password account) or `"supabase"` (ClozFlow Cloud
  sign-in; no local password). Hide the change-password form for `"supabase"`.
- `PATCH /update`: `username` is trimmed and `""` means `null` (clearing no
  longer returns `409`); a taken username → `409 "Username already taken"`;
  `null` for a `notif_*` boolean is ignored (it used to return `500`).
- `credit_balance` is rounded to 2 decimals.
- `POST /change-password`
  - `"supabase"` accounts → `400`, `detail`: `"This account signs in through ClozFlow Cloud (Supabase), so its password is managed by that sign-in provider and can't be changed here. Use \"Forgot password\" on the sign-in screen, or your Google account if you sign in with Google."`
    (Deliberately not allowed: a local password would be a second credential
    that bypasses Supabase.)
  - new password over 72 bytes → `400 "New password is too long (maximum 72 bytes)"` (was `500`).
- `POST /avatar`: every upload gets a new URL
  `/static/avatars/user_<id>_<16 hex>.<png|jpg|webp>` and the previous file is
  deleted, so always use the returned `profile_image`. Too large (> 5 MB) →
  `413` (was `400`). Type is still sniffed from the bytes.
- `POST /clear-history` → `{"message", "deleted": int, "kept": int}`. Calls a
  Relay page was built from are kept (message then ends with
  `". N call(s) linked to Relay pages were kept"`).
- `DELETE /delete-account` (response unchanged): call history, Relay pages,
  copilot bridge calls (phone numbers) and the avatar are deleted, profile fields wiped, the row is kept as an
  anonymised, deactivated tombstone (hard `DELETE` failed on Postgres because of
  foreign keys). Old tokens get `401`; the email can register again.

## Calls history (`/calls/*`, owner-only; other users' calls are `404`)

New `GET /calls/{call_id}/transcript`:

```json
{
  "call_id": 12,
  "timestamp": "2026-11-11T10:00:00Z",
  "transcript": [{"speaker": "prospect", "text": "We use AT&T today", "timestamp": "2026-11-11T10:00:01.123456Z"}],
  "insights": [{"payload": {"confidence": 0.4, "strategy": "Probe"}, "timestamp": "2026-11-11T10:00:02Z", "turn_index": 0}],
  "message_count": 1,
  "insight_count": 1
}
```

`speaker` is whatever was stored (`prospect`, `rep`, …; `unknown` if missing);
`timestamp` is `null` when not stored. `payload` is the copilot analysis object
as saved by the live call. `turn_index` is the index **in the returned
`transcript` list** of the line the insight answered (`null` for rows saved
before the live call recorded it). `GET /calls/{id}` pairs insights with lines
the same way (position fallback for old rows). Legacy plain-text rows become one entry per line
(`"Speaker: text"` lines keep the speaker); plain-text insights become
`{"payload": {"text": "…"}}`. Empty transcript entries are skipped, so counts
in `GET /calls/` reflect real messages.

- `GET /calls/`, `/calls/{id}`, `/calls/stats` no longer `500` on odd or legacy
  payloads.
- `DELETE /calls/{id}` for a call a Relay page uses → `409`, `detail`:
  `"This call is linked to a Relay page. Delete the Relay first, then delete the call."`
- `GET /calls/{id}/report`: metrics now come from the stored insights (they
  were always 0% / 100), text containing `&`, `<`, `>` no longer fails, the
  date is labelled UTC.

## Wallet (`/api/wallet/*`)

- `POST /rent-phone-number` → always `501` and never charges:
  `{"detail": "Number rental isn't available yet. You have not been charged; calls use the shared ClozFlow caller ID for now."}`
- `GET /balance` gains `"phone_rental_available": false`; `credit_balance` is
  rounded to 2 decimals.
- `POST /topup` (superusers): `amount` above 1,000,000 → `422`.
- Credit deductions/top-ups (`services/credit_service.py`, also used by Pearl and
  the bridge) are single guarded `UPDATE`s: concurrent spends can't overdraw or
  lose updates, balances never go below 0, insufficient balance → `402` with no
  writes (the caller's pending changes are left alone). Signatures unchanged.
  `deduct_credits` stays the pre-use check (Pearl test sessions, call start).
- New `charge_post_call(db, user_id, amount, reason)` for usage that already
  happened: atomically takes `min(balance, amount)`, never negative, never
  raises for insufficient funds, returns `{"charged", "shortfall",
  "balance_after"}` and writes a `consumption` transaction even when nothing
  could be taken; a shortfall is appended to its `description`
  (`"… | Shortfall ₹4.50 not collected (insufficient balance)"`). Pearl
  post-call metering (`routers/pearl.py::_bill_finished_call`, previously free
  when the wallet was short) and bridge billing (`services/bridge/billing.py`)
  use it.

## Brain gateway (`/api/brain/*`)

| Brain result | Client gets |
| --- | --- |
| 4xx (not 401) | same status, Brain `detail` (string or validation list) |
| 401 | `502` "The local Brain rejected this server's request. Check the Brain configuration." |
| 5xx | `503` "The local Brain hit an internal error. Please retry; check the Brain logs if it keeps failing." (Brain body never relayed) |
| read/write timeout | `504` "The local Brain took too long to respond. Please retry." |
| unreachable / connect timeout | `503` "The local Brain is unavailable. Start the local stack and retry." |
| non-JSON success body | `502` "The local Brain returned an unreadable response." |
| invalid JSON request body | `422` "Request body must be valid JSON" |

## Schema migration (for every backend owner)

`database.add_missing_columns()` runs at startup right after `create_all()`.
It adds model columns missing from existing tables (SQLite and Postgres,
idempotent, safe with several workers), back-fills scalar Python defaults and
creates their indexes. Only nullable, non-unique columns are automatic; others
are logged and need a manual migration. This adds `users.ai_override_prompt`
the first time an existing database (e.g. `hexagon.db`) starts on this code.

## Deploy / infra

- `web/nginx.conf.template`: proxies `/api`, `/auth/{login,register,me}`,
  `/calls`, `/call`, `/leads`, `/outreach`, `/intelligence`, `/health`,
  `/static/`, `/ws`, `/ws/audio`. Prefixes are anchored, so SPA routes such as
  `/call-brief`, `/outreach-studio`, `/pearl/agent-editor` (previously sent to
  the API) and `/auth/callback` stay with the frontend; `/intelligence` (was
  missing) now reaches the API. `/ws*`, `/api/pearl/**`, `/api/copilot/**`
  (incl. `/api/copilot/bridge/...` WebSockets): upgrade headers, buffering off,
  3600 s timeouts. Other API paths: upgrade headers, buffering off (SSE),
  600 s timeouts. `client_max_body_size 100m` (knowledge uploads: 20 MB per
  file, up to 100 MB per request). `/static/` adds
  `X-Content-Type-Options: nosniff`.
- CORS now exposes the `X-Sample-Data` response header (lead search marks
  sample results with it), so cross-origin browser code can read it.
- Logs never contain query strings (carrier `?t=` secrets, `?token=` JWTs):
  nginx uses the `clozflow_redacted` access-log format (path and Referer cut at
  `?`), and `main.py` filters uvicorn's access and WebSocket lines the same
  way. nginx *error* log lines still quote the full request line.
- `CLOZFLOW_LEARNING_LOG` (default off): only when set to `true` does
  `ml/evaluation/learning_filter.py` write copilot exchanges (prospect speech)
  to `logs/*.jsonl`.
- `web/.env.example` lists every variable the backend reads (blank values).
  `backend/tests/test_core_infra.py` fails when code reads a variable missing
  from it or mounts a path nginx doesn't proxy — add new ones there.
- `docker-compose.yml`: `env_file: .env` (web/.env; `backend/.env` never existed).
- `Dockerfile`: `HEALTHCHECK` on `/health` through nginx, unbuffered logs.
  `.dockerignore` now excludes nested `.venv`, caches, `.env*`, SQLite files and
  uploaded avatars.
- `backend/requirements.txt` now includes `requirements_full.txt`; added
  `beautifulsoup4` (imported at startup by the knowledge router — the image
  failed to boot without it), `pypdf`, `python-docx`, `openpyxl`, `bcrypt`,
  `httpcore`, `miniaudio`, `audioop-lts` (Python ≥ 3.13).
- `ALLOWED_ORIGINS` entries may end in `/`. It must include the public site
  origin, or browser copilot WebSockets are refused.
- `start_all.bat` works from any folder; set `CLOZFLOW_PYTHON` to pick the
  interpreter (else `backend\.venv`, else `python`).
- `frontend/Dockerfile`: SPA deep links no longer 404; Supabase build args.
- Tests: `cd web/backend && python -m pytest -q` collects `tests/` and the root
  `test_*.py`, runs `async def` tests with anyio, and uses a throw-away SQLite
  DB and JWT key (never `hexagon.db`). Fixtures `core_client`, `core_make_user`
  are in `conftest.py`.
