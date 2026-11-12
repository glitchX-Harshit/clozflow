# Copilot bridge call: contract as implemented, and setup

The app starts a real phone call through the backend. Vobiz calls the **rep's own phone**. When the rep
answers, Vobiz plays "Connecting you now.", forks **both sides** of the call to our media WebSocket, and dials
the **prospect** and bridges the two calls. The copilot hears each side on its own track and labels it:
`inbound` is the rep (`salesperson`) and `outbound` is the prospect (`prospect`). Only prospect turns get guidance.

The design contract is v1 (`bridge-contract.md`). This file records what was built, and every place it differs.

Code locations:

- `routers/copilot_bridge.py`: endpoints, plus a startup hook through the router's lifespan
- `services/bridge/`: the state machine, Vobiz REST calls, XML, audio, the event hub and billing
- `models_bridge.py`: the database table
- `services/websocket_service.py`: the shared live pipeline
- Tests: `tests/test_bridge_*.py` and `tests/test_live_*.py`

## Setup

| Env var | Required | Meaning |
|---|---|---|
| `VOBIZ_AUTH_ID`, `VOBIZ_AUTH_SECRET` | yes | Vobiz account. The same variables the Pearl integration uses. |
| `VOBIZ_CALLER_ID` | yes | A Vobiz number you own, in E.164 (e.g. `+9180XXXXXXXX`). It is shown to both the rep and the prospect. |
| `PEARL_PUBLIC_URL` | yes | Public **https** base URL of this backend, e.g. `https://app.example.com`. Vobiz must be able to reach it. The `wss://` media URL comes from it (same host and path prefix). The old hard-coded ngrok URL, `http://`, localhost and private IPs all count as "not set". |
| `VOBIZ_BASE_URL` | no | Default `https://api.vobiz.ai`. |
| `COPILOT_BRIDGE_RATE_PER_MINUTE` | no | Default `3.0` credits a minute, both legs included. The minimum balance is 1 minute. |
| `COPILOT_BRIDGE_MAX_MINUTES` | no | Default `60`, range 1–240. The hard cap on connected time. |
| `COPILOT_BRIDGE_L16_BYTE_ORDER` | no | Default `little`. Set it to `big` only if transcripts are garbage and Vobiz turns out to send network-order L16. |
| `CLOZFLOW_COPILOT_ENGINE` | no | `legacy` (Groq, `GROQ_API_KEY`) or `brain` (local Brain, `CLOZFLOW_BRAIN_URL`). |
| `GEMINI_API_KEY` | yes for transcripts | Speech-to-text. Each bridge call opens **two** Gemini Live sessions, one per side, so check your concurrency quota. |

Deployment requirements:

- **One backend process.** The call's in-memory state (the app sockets, the audio pipeline, the media socket) lives in one process. This matches the current `uvicorn --workers 1`. More workers would need sticky routing per call.
- **Proxying.** nginx already sends `/api/...` to the backend with WebSocket upgrade headers and 3600 s timeouts. That covers `…/calls/{id}/events` and `…/vobiz/media`.
- **Startup.** The router's lifespan, merged into the app by `include_router`, creates the table if it is missing. It also marks rows that are not ended and older than 10 minutes as `ended/server_restart`, and starts a 5 s watchdog. Nothing else needs calling.
- **Local testing.** Use a tunnel such as ngrok as `PEARL_PUBLIC_URL`. `GET /api/copilot/bridge/config` tells you whether calling is enabled, and if not, why.

**India: DND and consent (not legal advice).**

- Use a caller ID registered for the kind of calls you make. Under TRAI's commercial-communication rules, promotional calls must not go to numbers on the NCPR/DND list without consent, and must use the designated number series.
- Tell the prospect at the start that the call is assisted by AI and may be transcribed. The app shows this reminder.
- Transcripts are personal data under the DPDP Act 2023. They are stored as a `CallLog` (Session History), and deleting history deletes them. The backend never logs phone numbers, transcripts or tokens. Bridge calls never write the prospect's words to the ML learning log.

## App ↔ backend API

Every endpoint requires `Authorization: Bearer <jwt>` and returns JSON. A user can only see their own calls.

### `GET /api/copilot/bridge/config`

Returns `{"enabled", "reason", "rate_per_minute", "min_balance", "max_minutes", "country_default": "+91"}`.

- `reason` is null when calling is enabled. Otherwise it is one of:
  - "Phone calls aren't set up on this server yet (no phone provider account)."
  - "… (no caller ID number)."
  - "… (no public HTTPS address)."
- `max_minutes` is the server cap. A single call is also limited by the wallet (see Billing).

### `POST /api/copilot/bridge/calls`

Body: `{"context_id", "prospect_phone", "rep_phone", "prospect_name"?}`. Success returns **201** with a `BridgeCall`.

**Phone numbers.**

- Accepted characters: digits, spaces, `-`, `(`, `)`, and a leading `+`.
- A bare 10-digit number gets `+91`.
- The result must have 8–15 digits and must not start with 0.
- Rep and prospect must be different numbers.
- *Extension:* a national `0` prefix (`09876543210`) and a `00` international prefix are accepted too.

**Checks, in order:**

| Status | `detail` | When |
|---|---|---|
| 503 | "Calling isn't set up on this server yet." | Calling isn't configured. |
| 400 | "Enter a valid phone number for the prospect." | Bad prospect number. |
| 400 | "…for your phone." | Bad rep number. |
| 400 | "Your number and the prospect's number must be different." | The numbers match. |
| 404 | "Call brief not found or expired. Start the briefing again." | The brief is missing, expired, or not the user's. |
| 409 | "You already have a call in progress." | The user has another call that isn't ended. The body also has `"call_id"`. |
| 402 | "Not enough wallet credits to place a call. You need at least ₹3." | Balance below one minute (₹3 at the default rate). |
| 502 | "The phone provider couldn't place the call. Try again in a moment." | Vobiz rejected the call. The row is ended with `telephony_error`. |

### Reading and ending a call

- `GET /api/copilot/bridge/calls/{call_id}` returns the `BridgeCall`. It returns 404 `{"detail":"Call not found."}` if the call isn't the user's.
- `POST /api/copilot/bridge/calls/{call_id}/hangup` returns the `BridgeCall`. It is idempotent: a call that has already ended is returned unchanged. Otherwise the backend hangs up the rep leg through Vobiz REST (`DELETE …/Call/{uuid}/`, where 404 means already gone) and ends the call:
  - `completed` if it was connected,
  - `cancelled` if it wasn't.
  - If Vobiz fails, the call stays up and is returned as it is; the rep can still hang up on their phone.

### `BridgeCall`

Same fields as the contract:

```json
{"call_id": "uuid", "context_id": "…", "status": "ringing_rep", "reason": null, "detail": "Calling your phone…",
 "prospect_name": "Acme Bakery", "prospect_phone_masked": "+91•••••43210", "rep_phone_masked": "+91•••••12345",
 "created_at": "2026-11-12T10:00:00Z", "connected_at": null, "ended_at": null, "duration_seconds": 0,
 "charged_credits": 0.0, "call_log_id": null}
```

- `duration_seconds` is the connected (billable) time, rounded up to whole seconds. It counts up while the call is `connected`.
- `reason` is set only when the call is `ended`.
- `detail` texts:
  - `ringing_rep`: "Calling your phone…"
  - `rep_answered`: "You answered. Connecting…"
  - `ringing_prospect`: "Calling {prospect_name}…"
  - `connected`: "Live", or "Live · ends after N min (wallet balance)" when the wallet sets the limit
  - `ended`: a sentence per reason (see `END_DETAILS` in `services/bridge/service.py`)

### App WebSocket `GET /api/copilot/bridge/calls/{call_id}/events`

**Auth.** Any of these is accepted:

- an `Authorization: Bearer` header
- a `?token=` query parameter
- the browser subprotocol `clozflow-auth.<jwt>` (an extension; the server answers with `clozflow` if it was offered)

The server accepts the socket first, then closes with **4401** for bad auth or **4404** if the call isn't the user's.

**Server → app messages:**

- `{"type":"callStatus","call":<BridgeCall>}`: sent on connect and on every change.
- `{"type":"transcriptUpdate","speaker":"salesperson"|"prospect","text":"…"}`
- `{"type":"aiAnalysis","payload":{…},"latency":{…}?}`: only after prospect turns. The payload is the same as on `/ws/audio`, for both engines.
- `{"type":"session_ended","brain_session_id":"…"}`: Brain engine only, after the session is finalized at hangup.
- *Extension:* `{"type":"error","code":"stt_unavailable","speaker":"…"}`: one side's live transcription was given up after retries (2 s, 5 s, 10 s). The call itself carries on.

**On reconnect** the server re-sends the current `callStatus`, then the transcript so far (the last 200 lines, in order), then the latest `aiAnalysis`.

**When the call ends**, the server sends `callStatus` with `ended` at once. Then it may send:

- the final turn's `transcriptUpdate`/`aiAnalysis`
- more `callStatus` messages, as `charged_credits` and then `call_log_id` are filled in
- `session_ended`

After that it closes with **1000**.

The app may send `{"type":"ping"}`; it and anything else from the app is ignored. A socket that falls more than 1000 messages behind is closed with 1013. It should reconnect, and it gets the replay.

## Carrier endpoints (Vobiz, no JWT)

The carrier endpoints are:

- `/api/copilot/bridge/vobiz/answer`
- `/api/copilot/bridge/vobiz/hangup`
- `/api/copilot/bridge/vobiz/dial-events`
- `/api/copilot/bridge/vobiz/dial-result`
- `/api/copilot/bridge/vobiz/stream-status`
- WebSocket `/api/copilot/bridge/vobiz/media`

The HTTP endpoints accept GET and POST, with form or JSON bodies.

**Secrets.**

- Every URL carries `bid` (the call id) and `t`, a 32-byte URL-safe secret generated per call.
- Only the sha256 of the secret is stored. It is compared with `hmac.compare_digest`.
- An invalid secret, or an unknown `bid`, gets **403** on HTTP and is accepted-then-closed with **1008** on the WebSocket.
- `t=` and `token=` are redacted from uvicorn's access and error logs.

**Duplicates.** Every webhook is idempotent: transitions are conditional UPDATEs under a per-call lock. Billing claims `billed_at` before charging, so it can only happen once.

**Media socket.** It is accepted only while the call is not ended, and only one per call at a time.

Answer XML. `Speak` comes first, so the prompt isn't transcribed:

```xml
<Response>
  <Speak>Connecting you now.</Speak>
  <Stream bidirectional="false" audioTrack="both" contentType="audio/x-l16;rate=16000" streamTimeout="7200"
          statusCallbackUrl="{PUBLIC}/api/copilot/bridge/vobiz/stream-status?bid=…&amp;t=…" statusCallbackMethod="POST"
          maxRetries="2">wss://{HOST}/api/copilot/bridge/vobiz/media?bid=…&amp;t=…</Stream>
  <Dial callerId="{VOBIZ_CALLER_ID}" timeout="40" timeLimit="{max_seconds}" redirect="false"
        callbackUrl="…/dial-events?…" callbackMethod="POST" action="…/dial-result?…" method="POST">
    <Number>{prospect_e164}</Number>
  </Dial>
  <Hangup/>
</Response>
```

If the call is already ended or cancelled when the answer URL is fetched, the reply is `<Response><Hangup/></Response>`.

**The rep leg (make-call).** It is placed with `ring_timeout=45` and `time_limit = max_seconds + 300`.

**Audio.**

- Media frames are base64 L16 at 16 kHz: 20 ms, 640 bytes per track.
- They are decoded to PCM16LE and re-chunked to the 2048-byte frames that `/ws/audio` uses. μ-law and 8 kHz are converted too, if Vobiz reports them in `start.mediaFormat`.
- Before the prospect answers, audio is held back, so ringback is never transcribed. The last 1 s is kept, so a quick "Hello?" isn't lost while `DialAnswer` is still in flight.
- Malformed frames are counted and ignored.

### Status machine and reasons

The status runs `created` → `ringing_rep` → `rep_answered` → `ringing_prospect` → `connected` → `ended`.

| Event | Effect |
|---|---|
| Answer URL fetched | `rep_answered`, then `ringing_prospect`, published back to back. Vobiz has no "dial started" event. |
| `DialAnswer` / `DialConnected` | `connected`, and audio opens. |
| `DialHangup` | Records when the bridge ended, or a provisional DialStatus from the cause. |
| `dial-result` (`DialStatus`) | Ends the call at once (`<Hangup/>` follows anyway), so the app updates immediately: connected → `completed`; `busy` → `prospect_busy`; `no-answer`/`timeout` → `prospect_no_answer`; `failed` → `prospect_failed`; `cancel` → `cancelled`. |
| `hangup` webhook (rep leg, `Event=Hangup`) | Authoritative end: connected → `completed`; app asked to cancel → `cancelled`; rep answered but prospect not connected → the dial outcome, else `cancelled`; rep never answered → from `CallStatus`/`HangupCause*`: busy/rejected → `rep_busy`, no-answer/timeout → `rep_no_answer`, failure causes → `rep_failed`, unknown → `rep_no_answer`. |
| Watchdog: ringing state with no carrier callback for 90 s | `timeout`, and the leg is cancelled over REST. |
| Watchdog: connected past `max_seconds + 60` s | Hung up over REST → `completed`. |
| Watchdog: bridge over but no final callback after 60 s | `completed`. |
| Startup | Rows not ended and created more than 10 minutes ago → `server_restart`. They aren't charged then. If the rep leg's hangup webhook arrives later, the connected time is billed once at that point. |

A call ended at the wallet limit gets `insufficient_credits` instead of `completed`.

## Billing

- The charge is `ceil(connected_seconds / 60) × rate`. It is taken once, when the call ends, through `services/credit_service.deduct_credits`. The CreditTransaction reads "Copilot phone call, N min (ref xxxxxxxx)".
- The rate is fixed when the call is created.
- Superusers (unlimited accounts) are not charged.
- If the prospect never connects, the charge is 0.
- The Dial `timeLimit` is the smaller of `COPILOT_BRIDGE_MAX_MINUTES` and the whole minutes the wallet covers at creation, so a charge always fits. If the balance was spent elsewhere in the meantime, what is left is charged. The balance never goes negative.
- `charged_credits` is stored on the row.

## Persistence

The table is `copilot_bridge_calls`. It has the contract's columns plus some bookkeeping:

- Contract columns: `id`, `user_id`, `context_id`, `status`, `reason`, `prospect_name`, `prospect_phone_e164`, `rep_phone_e164`, `vobiz_a_leg_uuid`, `vobiz_b_leg_uuid`, `token_hash`, `created_at`, `rep_answered_at`, `connected_at`, `ended_at`, `duration_seconds`, `charged_credits`, `call_log_id`.
- Bookkeeping columns: `vobiz_request_uuid`, `rate_per_minute`, `max_seconds`, `balance_capped`, `cancel_requested`, `dial_status`, `status_changed_at`, `last_carrier_event_at`, `bridge_ended_at`, `billed_at`.
- Foreign keys: `user_id` cascades when the user is deleted, and `call_log_id` is set to null when the CallLog is deleted. Postgres enforces this; SQLite doesn't.

A `CallLog` is saved for every call that connected, even if no audio arrived, and for any call that has a transcript:

- Transcript entries are `{"speaker","text","timestamp"}`.
- Insights are `{"payload","timestamp","turn_index"}`, where `turn_index` points at the prospect turn the insight answers.
- `call_log_id` is set on the row and sent in `callStatus`.

## Live pipeline changes (shared with `/ws/audio` and `/ws`)

**Structure.**

- `LiveCopilotSession` holds one conversation: the engine, the transcript, the CallLog, and an output sink.
- `TrackPipeline` handles one track with a fixed speaker: STT, Silero VAD and `TurnDetector`. Audio goes through a bounded queue, and VAD runs in a thread.
- `/ws/audio` is one prospect track. The bridge has two tracks. Salesperson turns are stored and sent, and they reach the engine as context. On the Brain engine they are SALESPERSON turns; on the legacy engine they become `REP:` history. They never produce `aiAnalysis`.

**Prompt Override (`User.ai_override_prompt`).**

- It is read with `getattr`, cleaned (no control characters, at most 1500 characters), and applied to both engines.
- Legacy engine: it becomes a fenced "SALESPERSON'S STANDING INSTRUCTIONS" section placed *before* the OUTPUT block, with explicit precedence. It may shape language, tone and angle. It can never change the JSON keys or format, add claims that aren't in the brief, or allow pressure or deception.
- The legacy engine now keeps only `response`/`next_question`/`coaching_tip` from the model's output, so nothing the model is talked into can add payload keys such as `deal_signal`.
- Brain engine: it is sent as labelled `call_context.salesperson_instructions` session context. The Brain treats session context as data, so the override shapes tone and strategy but not the Brain's rules or its structured output.

**`deal_signal` (0–100 integer, honest).**

- The Brain engine sends it from the Brain's own forecast: `progression_probability` of the latest non-retracted `DEAL_PREDICTION` belief, read from `/v1/sessions/{id}/wm`. Only the full reasoning profile produces that forecast.
- It is **absent** whenever there is no real estimate. That covers the whole legacy engine: its `quality_scores` are constants and its `confidence` is the intent classifier's confidence, not deal health.
- Anything that isn't a number from 0 to 100 is dropped.
- **Clients:** today's web (`LiveCall.jsx`) and Android code read `deal_signal` as `positive`/`neutral`/`negative`. They should show the integer directly, and show "--" when it is absent.

**Changes visible on `/ws/audio` and `/ws`:**

- One CallLog per brief: Pause, resume and reconnect append to the same History entry (`call_log_id` is stored in the brief).
- `{"type":"session_saved","call_id":<CallLog id>}` is sent once the CallLog is written. After `close_stream` this comes before the server closes with **1000**; previously the TCP connection was simply dropped.
- STT failure: the server sends `{"type":"error","code":"stt_unavailable"}`, closes with **1011**, and saves no empty History entry. Android currently classifies a quick drop as "transcription unavailable" only when no message arrived, so it should also look at this message or the 1011 code.
- After a Pause, End Call finalizes the Brain session by its resume id. `session_ended.brain_session_id` is that id.
- The legacy fallback payload now also has `is_fallback: true` and `error_code`, one of `llm_not_configured`, `llm_timeout`, `llm_rate_limited`, `llm_invalid_output` or `llm_error`. The old fields are unchanged.
- `/ws` ignores binary and invalid frames (before, binary frames crashed it). Rep turns are recorded as context; on the Brain engine they no longer emit a "recorded" `aiAnalysis` status line.
- `/call/start` limits field lengths (most fields 500 characters; `product_specification` 8000, `call_goal` 2000), and over-long fields get 422.
