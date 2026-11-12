# Pearl (AI voice agents) — client-visible changes

Scope: `routers/pearl.py`, `models_pearl.py`, `services/pearl/**`. Response shapes are unchanged
except where noted (only fields were added). Errors are FastAPI's `{"detail": "<message>"}`.
Call status vocabulary is unchanged: `queued, initiating, ringing, active, completed, failed, busy,
no_answer, cancelled` (clients map `active` to "Connected").

## 1. Login required (`Authorization: Bearer <token>`)

Missing/invalid token → **401** `{"detail": "Could not validate credentials"}`. Another user's
agent / tool / call / campaign / test session → **404** (same message as a missing one).

| Route | Before | Now |
|---|---|---|
| `GET /api/pearl/calls/{id}` | optional auth; returned **any** call | auth + owner (404) |
| `POST /api/pearl/calls/{id}/cancel` | optional auth; cancelled **any** call | auth + owner (404) |
| `POST /api/pearl/agents/{agent_id}/calls` (cold call) | optional auth; anonymous calls ran as user #1, any agent id | auth; agent must be yours (404); `draft` see §6 |
| `POST /api/pearl/sage/chat`, `POST /api/pearl/sage/feedback` | optional auth | auth |
| `GET/POST /api/pearl/agents/{id}/tools`, `GET/PUT/PATCH/DELETE /api/pearl/agents/{id}/tools/{tool_id}` | optional auth, no ownership | auth + agent owner (404) |
| `POST /api/pearl/tools/test`, `POST /api/pearl/agents/{id}/tools/test` | optional auth | auth; `{id}` must be yours unless it is `test_sandbox` / `draft`; `tool_id` only resolves to your own tools |
| `POST /api/pearl/tools/parse-curl`, `POST /api/pearl/agents/{id}/tools/parse-curl` | public | auth |

Already authenticated (unchanged): agent CRUD/deploy/pause/stop/events/calls/stream, campaigns,
test sessions, `/deploy`, `/preview_voice`. Still public: `GET /archetypes[/{id}]`,
`GET /voice-preview/{speaker}`.

## 2. WebSockets

- `WS /api/pearl/calls/{id}/stream?token=<JWT>` (an `Authorization: Bearer` header also works).
  No/invalid token or someone else's call → closed with **1008** before accept. **New:** after
  sending a terminal status (`completed/failed/busy/no_answer/cancelled`) the server closes the
  socket normally — don't treat that close as an error. *Web `Pearl.jsx` connects without
  `?token=` today and must append it.*
- `WS /api/pearl/test-sessions/{id}/voice?token=<JWT>`: owner only and the session must still be
  `active` (an ended session → 1008). Message protocol unchanged. Fixed: agent audio now continues
  on every turn after an interruption (it used to go silent after the first barge-in).

## 3. `POST /api/pearl/deploy` (dialpad console / "Deploy with code")

It used to fail with 500 on every request (`call_provider` wasn't in the request model) after
overwriting the voice/settings/tools of the user's first saved agent. Now:

| Field | Meaning |
|---|---|
| `lead_id` | optional; must be one of your leads (404 `Lead not found`) |
| `phone_number` | **new**, optional; the number dialled. With `lead_id` it is also saved on the lead, so redialing a lead with a corrected number dials the new one. Without `lead_id` your lead with that number is reused or created |
| `recipient_name` | **new**; name for a lead created from `phone_number` |
| `agent_id` | **new**; one of your agents, used as-is and **never modified** (`voice_*`/`capsule_id` are ignored then) |
| `call_provider` | **new**; `vobiz` (default) or `exotel` |
| `objective`, `capsule_id`, `voice_provider/language/speaker/pace` | as before; without `agent_id` they configure your implicit console agent (see §8), never a saved agent |

One of `lead_id` / `phone_number` is required. Response unchanged
`{ok, call_id, provider_call_id, status}` with `status: "initiating"` (was `dialing`).
Errors: 400 `Provide lead_id or phone_number` · 400 `Invalid phone number: …` · 400
`Lead has no phone number` · 400 `Unsupported call_provider '…'` · 404 Lead / Agent / Capsule ·
402 `Insufficient credits. An outbound call requires at least 3.00 Credits …` · **503**
`Telephony provider 'vobiz' is not configured on this server (missing …)` · **502**
`Telephony provider failed: <carrier error>` (was 500).

**Clients (web `Pearl.jsx`, app console):** send `phone_number` together with `lead_id`.
`POST /leads/save` still dedupes by business name + city and keeps the old phone number.

## 4. Call lifecycle

- `dialing` is no longer written: a dispatched call is `initiating` (old rows may still hold
  `dialing` / `in-progress`). Carrier ringing → `ringing`; carrier answer or the AI audio stream
  connecting → `active` (Vobiz calls now reach `active`; they used to stay `dialing`).
- Only a **final** carrier event (hangup / terminal status) ends a call: `completed`, `busy`,
  `no_answer`, `failed` or `cancelled`, mapped from the carrier status and hangup cause
  (e.g. `USER_BUSY` → busy, `NO_ANSWER` → no_answer, `ORIGINATOR_CANCEL` → cancelled).
  `outcome` = the final status; `error_code` e.g. `vobiz: USER_BUSY`; `duration_seconds` from
  the carrier. A user-cancelled call stays `cancelled`. Duplicate/retried carrier events are ignored.
- `POST /calls/{id}/cancel` (response unchanged) now also marks the campaign recipient
  `failed`/`outcome: cancelled`, stops the AI audio stream and asks Vobiz to hang up (best effort).
  An already finished call → 400 `Call is already finished` (unchanged).
- Calls stuck before answer (incl. `ringing`) for >180 s with no carrier news → `failed`
  (`Dialing timeout / Stale`); a later carrier event still records the real outcome. Campaign
  calls healed this way count in `failed_calls` and are retried per the campaign's policy (§14.5).

## 5. Billing

- Vobiz calls are now charged (they never were): once, on the final hangup event. Exotel status
  callbacks no longer charge again on repeats. Charge = `calculate_call_metering(duration)`; the
  call's `revenue_billed`, `pulses_30s`, `cogs_telephony` are filled in.
- `POST /test-sessions`: the 2-credit fee is charged only after validation — agent not yours →
  404, `mode` not `chat|voice` → **400** `mode must be 'chat' or 'voice'`; nothing charged then
  (it used to charge first).
- Cold call (`POST /agents/{id}/calls`) now checks the balance first → 402 (like `/deploy`).

## 6. Cold call `POST /api/pearl/agents/{agent_id}/calls`

Request/response shapes unchanged. `{agent_id}` = one of your agents (used unmodified) or `draft`
(unsaved editor state): `agent_snapshot` is applied to your implicit draft-dialer agent — your own
draft agents are no longer overwritten. `status` is `initiating` (was `dialing`). Without telephony
credentials or `PEARL_PUBLIC_URL` it still simulates (`provider_call_id` starts with `sim-`); the
response now says so: **`simulated: true`** (see §14.2).
400 for an unsupported `call_provider`, 502 `Telephony dispatch failed: …` when the carrier refuses.

## 7. Campaigns

- `PATCH /campaigns/{id}`: `agent_id` must be your agent (404). `status` may only be set to
  `draft|scheduled|paused|completed` (anything else → 400; start with `/launch` or `/resume`).
  While `running`, only `status: paused|completed` is accepted — any other field → 400
  `Cannot edit configuration of an actively running campaign. Pause it first.` (this check used
  to be skipped whenever `status` was omitted). `name`/`status: null` are ignored.
- `POST /launch`: the agent must be yours (400 `Selected Agent does not exist`); a concurrent
  second launch → **409** `Campaign is already running`. `POST /resume`: 400 when no agent is set.
- Dispatch: every recipient is dialled at most once per attempt (no double dials on
  pause/resume races); recipients enabled or imported while running are picked up.
- Recipient states: progress events never mark a recipient `failed` any more. Final outcome:
  `completed` → recipient `completed`; `busy/no_answer/failed/cancelled` → recipient `failed` with
  `outcome` = that status and `error_reason` = carrier cause.
- `metrics.completed_calls` now counts calls that ended `completed` and `failed_calls` counts
  dispatch failures plus unanswered/failed outcomes (before, `completed_calls` counted dialled calls).
  Since §14.5 also calls failed by the stale-call healer, each call exactly once.
- Calling window, time zone and retries are enforced since §14.5 (they were stored only).
- `POST /add-manual-recipient`: a phone already in the campaign is added as `excluded` with
  `validation_error: "Duplicate phone number detected (+91…)"` (same rule as the importers).
- `POST /import-leads`: files > 10 MB → 413; a missing filename → 400 (was 500).
- `GET /campaigns/{id}/recipients` `limit` is clamped to 1–1000; `GET /agents/{id}/events` to 1–200.

## 8. Agents

- Implicit agents created by endpoints (never by editing your saved agents) are listed by
  `GET /agents`: the console agent (`name` "Pearl Execution Engine",
  `provider_agent_id: "pearl-console"`) and the draft dialer (`provider_agent_id:
  "pearl-draft-dialer"`). Clients may hide them by `provider_agent_id`.
- `DELETE /agents/{id}`: **409** if a running campaign uses the agent; otherwise campaigns using it
  get `agent_id: null` and its test sessions are deleted (this used to fail with 500 on Postgres).

## 9. Tools (`api_tool`)

Requests to tool URLs (live calls and `/tools/test`) are SSRF-guarded (shared policy with the
knowledge crawler): http/https only, no credentials in the URL (use the tool's auth settings),
internal hosts/addresses refused (localhost, `*.internal`, private/loopback/link-local incl.
169.254.169.254, multicast, reserved; IPv4 and IPv6) — checked on every redirect hop and again at
connect time. Redirects are followed (max 5), responses are capped at 1 MiB, the whole request is
bounded by the tool timeout, environment proxies are ignored and cookies are never kept between
requests. The tool-test endpoint still answers 200 with the result: blocked →
`{success: false, status_code: 403, error: "Blocked outbound request: …"}`; unresolvable host → 503;
too large / too many redirects → 502. `PUT/PATCH` with an unknown `tool_type` → 400.

## 10. Voice preview

`GET /voice-preview/{speaker}` and `POST /preview_voice`: unknown/malformed voice ids → 404
`Unknown voice`; Sarvam not configured → 503; synthesis failure → 502 (was 500). A custom
`text` in `POST /preview_voice` is cached separately and no longer replaces the shared preview.

## 11. Sage

Capsule grounding and the "knowledge base" suggestion only use the caller's own capsules
(previously any user's first capsule could be attached).

## 12. Text-to-speech providers (server configuration; audio formats unchanged for clients)

- ElevenLabs settings come from one helper (`services/pearl/providers/elevenlabs_provider.py`):
  key `ELEVENLABS_API_KEY`, falling back to `ELEVEN_LABS_API_KEY`; voice `ELEVENLABS_VOICE_ID` /
  `ELEVEN_LABS_VOICE_ID`; model `ELEVENLABS_MODEL_ID` / `ELEVEN_LABS_MODEL_ID` (blank values ignored).
- ElevenLabs is asked for raw PCM (`output_format=pcm_8000`, 16-bit LE mono 8 kHz) instead of its
  MP3 default — the format every Pearl consumer plays: the voice-test `audio.data` downlink (now
  always whole samples / even-length chunks) and the carrier socket (Vobiz `playAudio`
  `audio/x-l16`, `sampleRate: 8000`; Exotel `media`). A compressed reply is decoded with
  `miniaudio` to the same format.
- `PEARL_TTS_PROVIDER` (`sarvam` default | `elevenlabs`) picks the primary; any other provider with
  a key is an automatic fallback for the rest of the session (connect/send failures or a provider
  error event), re-sending the turn in progress. ElevenLabs speaks with its configured voice; Sarvam
  persona ids don't apply to it. Voice previews stay Sarvam-only.

## 13. Carrier-facing endpoints (Vobiz / Exotel only — not called by web/app)

- Every URL handed to a carrier carries a per-call secret: answer `/api/pearl/vobiz/answer?call_id=…&token=…`,
  hangup `/api/pearl/vobiz/events?call_id=…&token=…`, Exotel `StatusCallback`
  `/api/pearl/webhooks/exotel?call_id=…&token=…` (now sent on the connect request), audio socket
  `wss://…/api/pearl/calls/{id}/audio?token=…`. Webhooks also accept the carrier's call id equal
  to the one stored at dispatch (Vobiz `RequestUUID`/`CallUUID`, Exotel `CallSid`).
  Unknown call → 404, bad credentials → 403 (answer webhook: 403 + `<Hangup/>` XML), no call id → 400.
  Audio socket without a valid token, or for a finished call → closed with 1008.
- `PEARL_PUBLIC_URL` is required to dispatch (the hard-coded ngrok fallback is gone).
  Optional `PEARL_WEBHOOK_SECRET` (defaults to the JWT secret) signs the tokens.
- Other backend code that hands Pearl URLs to a carrier must use
  `services/pearl/carrier_auth.py` (`carrier_token`, `carrier_query`, `carrier_audio_stream_url`).

## 14. Second pass (gaps found by the web Pearl work)

All additive: no field was removed or renamed; old request keys keep working.

### 14.1 Agents
- `PATCH /agents/{id}` accepts **`role`** (it was silently dropped). Same rule as `POST /agents`:
  a string, trimmed, at most 64 characters. On PATCH a blank role → **422**, `null` = unchanged;
  on create a blank/`null` role means `outbound_qualification`; longer than 64 → 422 (create too).
- `PATCH /agents/{id}` with `name: null` is ignored (it failed with 500).

### 14.2 Calls
- **New `GET /api/pearl/calls`** — the caller's calls across all their agents (implicit console /
  draft-dialer agents included), **newest first** (`created_at` desc). Query: `limit` 1–100
  (default 20; `0`/missing = 20), `offset` ≥ 0, optional `agent_id` (must be yours, else 404) and
  `status` (comma-separated, e.g. `failed,no_answer`). Response
  `{calls: [...], total, limit, offset, has_more}`; each item is the per-agent call object plus
  `agent_name` and `lead_name`. Another user's calls never appear. 401 without a token.
- Call objects (`GET /agents/{id}/calls` and the list above) gain `error_code`.
- Cold call `POST /agents/{id}/calls`: response gains **`simulated`** (bool). `true` = this server
  has no telephony credentials / `PEARL_PUBLIC_URL`, nothing was dialled (`provider_call_id`
  `sim-…`, `message`: "Simulated cold call: … no real call was placed."). The call row stays
  `initiating`, so clients should stop polling it when `simulated` is true.

### 14.3 Test sessions
- **Voice** sessions are now seeded with the agent's opening line, like chat sessions:
  `POST /test-sessions` (`mode: "voice"`) and `POST /test-sessions/{id}/clear` return
  `messages: [{role: "assistant", text: <opening>, meta: {is_opening: true}}]`. The opening is the
  fixed greeting rendered with the test variables (the old built-in "How are you doing today …
  calling from …" greeting is ignored in voice, as before), else the engine's generated opener.
  Creating a voice session therefore takes as long as a chat one (one LLM call without a greeting).
- `WS /test-sessions/{id}/voice` speaks **that exact stored line** on connect (no new LLM call; it
  is not stored a second time — every reconnect starts from the same opening). Sessions created
  before this change keep the old behaviour (opening generated on connect). Protocol unchanged.

### 14.4 Agent settings applied by the live call pipeline
- **`voice_config.settings.maxCallLength`** (minutes, as both editors store it) is enforced on live
  carrier calls: clamped to 1–240 min; missing / 0 / not a number = no limit (as before; Vobiz's
  own stream timeout is 2 h). At the limit the agent stops talking, says
  `settings.disconnectPhrase` (fallback "Thank you so much for your time today. I'll let you go now.
  Have a great day!"), and the server hangs up (closes the carrier stream + Vobiz REST hangup).
  New turns and barge-in are ignored during that goodbye. The agent timeline gets an event
  `call_max_length_reached` (`payload.max_call_minutes`), the goodbye is stored in the call
  transcript; the call's final status still comes from the carrier hangup (`completed`).
  Not applied to browser voice tests.
- Already applied before: `temperature`, `callCutRule`, `disconnectPhrase`; `voice_config.speaker`,
  `language`, `pace`, `gender`; `greeting`, `system_prompt`, `mission`, capsule.
- **Still stored but ignored by the call pipeline** (the editors show them): `bargeIn` (barge-in is
  always on), `eagerness`, `volumeThreshold`, `backgroundSound`, `backgroundVolume`,
  `switchLanguageDuringCall`, `languagesAllowed`, `autoLanguageSwitch`, `switchAfter`,
  `startingLanguage`, `outputNumbersInIndic`, `nudgeQuietCallers`, `nudges`, `hangUpAfterNudges`,
  `voicemailDetection`, `voicemailMessage`, `callForwarding`; `voice_config.tone` and the system
  tool switches in `tools_config`; the agent's own `call_provider` (dispatch uses the request /
  campaign provider); `qualification_rules`, `autonomy_policy`, `target_market`,
  `lead_source_config`. Agent tools (`/agents/{id}/tools`) run in `/tools/test` only — the live
  carrier call and the voice test don't load them.

### 14.5 Campaigns: calling window, retries, pacing
`call_settings` keys the dialer reads (`services/pearl/campaign_schedule.py`); both client
spellings are accepted:

| Setting | Keys (first present wins) | Default | Notes |
|---|---|---|---|
| carrier | `call_provider` | `vobiz` | `vobiz` \| `exotel`, case-insensitive |
| calling window | `window_start` + `window_end` (`"HH:MM"`, `"HH:MM:SS"`, `"24:00"`), else `calling_hours` (`"09:00 - 18:00"`, `–` or `to` also work) | none = no restriction | local time of `timezone`; may cross midnight (`22:00`–`06:00`); start = end = no restriction |
| time zone | `timezone` | `Asia/Kolkata` | IANA name; `"Asia/Kolkata (IST)"` (the backend default) and `IST` understood |
| attempts per recipient (first call included) | `max_retries` (app; its picker offers 1/2/3 *attempts*), `max_attempts` | **1** = no retries | clamped 1–10 |
| minutes between attempts | `retry_interval_minutes` (app), `retry_interval` | 30 | clamped 0–1440 |
| pause between dispatches | **`pacing_seconds`** | 2 | 0–5. **`retry_interval` is no longer read as pacing** (the old code misused it: the default 30 gave 5 s) |
| parallel calls | `concurrency_limit` | 1 | server cap `MAX_SERVER_CONCURRENCY` unchanged |

The app's spelling wins when both are present (the app keeps unknown keys, so a stale
`max_attempts`/`retry_interval` from the backend default must not override the user's pick).
Empty / `null` `call_settings` = the backend default shown by the API (`calling_hours 09:00-18:00`,
IST, 2 attempts, 30 min). The web UI drops both retry spellings on save → its campaigns keep
dialling each recipient once.

**Dialer behaviour** (concurrency governor unchanged; it now also re-checks the window):
- No call starts outside the window. The campaign stays **`running`** and dialling resumes by
  itself when the window opens; calls already connected are never cut. `/launch` outside the
  window is accepted: its `message` adds "Calls start when the calling window opens (09:00–18:00
  Asia/Kolkata)." and the response gains `calling_window`.
- A recipient whose call ended `failed` / `busy` / `no_answer` (carrier event, refused dispatch or
  the stale-call healer) stays **`failed`** with **`next_attempt_at`** set to now + interval while
  it has attempts left; when due it goes `failed → calling` again (`attempts` + 1, a new call row,
  `outcome`/`error_reason` cleared). A `cancelled` call is never retried; toggling a recipient
  (`PATCH …/recipients/{id}`) or setting the campaign `completed` clears scheduled retries (a
  paused campaign keeps them for `/resume`).
- Completion: without retries the campaign completes once every recipient has been dialled (as
  before). With retries it completes once nothing is due, nothing is scheduled and no call that
  could still need a retry is in flight (in-flight calls older than 3 h are not waited for).
- Settings are re-read every round: pause → edit → resume always takes effect.
- Counters: every call counts once. A healed call adds 1 to `failed_calls`; if its real carrier
  event arrives later, `completed` moves the count to `completed_calls` and a failure is not
  counted again (this also fixes `failed_calls` never including healed calls).
- The dialer runs inside the server process: a restart stops it (pre-existing). The campaign then
  shows `status: "running"`, `dialer_active: false`; **`POST /resume` on such a campaign restarts
  its dialer** → `{ok: true, status: "running", reattached: true}` (400 as before when a dialer is
  active). Nothing is re-dialled twice (atomic claims). Not done automatically at startup, so a
  restart never starts calling people on its own.

**Validation** — `POST /launch` and `POST /resume` → **400** when the settings can't be dialled
(stored settings are not validated on create/PATCH, so drafts always save):
`Unsupported call_provider 'twilio' in call_settings. Use one of: vobiz, exotel.` ·
`Unknown timezone '…'. Use an IANA time zone such as 'Asia/Kolkata'.` ·
`Invalid calling window: window_start '9am' is not a HH:MM time.` ·
`Invalid calling window: set both window_start and window_end (HH:MM).` ·
`Invalid calling_hours '…'. Use 'HH:MM - HH:MM', e.g. '09:00 - 18:00'.` ·
`max_retries must be a whole number of attempts (1-10).` (likewise `max_attempts`,
`retry_interval[_minutes]`, `pacing_seconds`, `concurrency_limit`). Missing carrier credentials:
messages unchanged.

**Response additions**
- Campaign objects: `effective_call_settings` = what the dialer will do:
  `{call_provider, timezone, calling_window: {start, end, timezone, open, next_open_at} | null,
  max_attempts, retry_interval_minutes, pacing_seconds, concurrency_limit}` (times `"HH:MM"`,
  `next_open_at` ISO UTC with `Z`, null while open). `call_settings` is returned as stored.
- **`metrics.qualified_calls` is now `null`**: no call outcome is qualified by the pipeline (the
  stored counter was never incremented, so the old `0` was misleading). The key stays; show "—".
- Recipient objects: `next_attempt_at` (ISO UTC `Z` or null) and `retry_scheduled` (bool). A
  refused dispatch now also sets `outcome: "failed"`.
- `GET /campaigns/{id}/recipients`: **`counts`** `{valid, invalid, excluded, queued, calling,
  completed, failed}` for the whole campaign (all keys present, 0 when unused), `retry_scheduled`
  (failed recipients waiting for another attempt), optional `status` filter (comma-separated;
  `total` = rows matching it, i.e. all recipients without a filter — unchanged).
- `GET /campaigns/{id}/status`: `retry_scheduled`, `next_retry_at`, `calling_window` (as above),
  `dialing_state` while running (`dialing` | `waiting_for_window` | `waiting_for_retry` |
  `waiting_for_calls`; null otherwise) and `dialer_active` (bool).
- Schema: new nullable column `pearl_campaign_recipients.next_attempt_at` (indexed), added to
  existing databases by `add_missing_columns()` at startup. New dependency `tzdata` (time zones on
  Windows / slim images; Asia/Kolkata and Asia/Dubai also work without it).

### 14.6 Archetypes
`GET /archetypes` voice labels match the web data again: Ritu (`ritu_hi_sales`) and Aayan
(`aayan_hi_conversational`) read `Hindi` (were `Hindi · Hindi`), Shubh `shubh_enhi_banking`
`Hinglish` and `shubh_enhi_ads` `Hinglish · Consultative` (were `Hindi…`). Display only: no
backend logic reads these labels (calls use the voice `id` and `defaultLanguage`, unchanged).

### 14.7 To adopt in the clients (web `pages/pearl/*`, app `features/pearl/*`)
1. Campaign wizard: offer only `vobiz` / `exotel` (the app's `smartflo`, `twilio`, `pulse`,
   `intalk` now get 400 at launch); remove the "not enforced by the dialer" banners/comments
   (window, time zone and retries are enforced); show `/launch`/`/resume` 400 `detail`.
2. Web `campaignSettings.js`: `retry_interval` is the retry interval in minutes now, not pacing;
   send `pacing_seconds` if pacing is ever exposed; to offer retries send `max_attempts` +
   `retry_interval` (and stop dropping them). App: `max_retries` / `retry_interval_minutes` work as-is.
3. Monitor: `dialing_state` / `calling_window.next_open_at` ("waiting for the calling window"),
   `retry_scheduled` / `next_retry_at`, `dialer_active: false` → offer Resume (re-attaches).
4. `qualified_calls: null` → "—" (the app's `asInt` already maps it to 0).
5. Call history: `GET /api/pearl/calls` (paginated) instead of per-agent lists.
6. Cold call: handle `simulated: true` (show "simulated", stop polling the call).
7. Voice test: the session's `messages` now hold the opening (the chat tab's "started in voice
   mode, so there is no scripted opening" text no longer applies).
8. Agent editor: `role` now saves on existing agents.
