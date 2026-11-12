# Leads, Outreach, Intelligence, Knowledge, Capsules & Relay — client-visible changes

Scope: `routers/leads.py`, `outreach.py`, `intelligence.py`, `knowledge.py`, `capsules.py`, `relay.py`
and their services. All response shapes are unchanged except where a field is **added**.
Error bodies are FastAPI's `{"detail": "<readable message>"}` (422 validation errors keep FastAPI's list form).

## 1. Login now required (send `Authorization: Bearer <token>`)

Missing/invalid token → **401** `{"detail": "Could not validate credentials"}` (+ `WWW-Authenticate: Bearer`).
The project-wide `routers.auth.get_current_user` is used (it also accepts `?token=` — used by `EventSource`).

| Routes | Before | Now |
|---|---|---|
| `POST /leads/search`, `POST /leads/deep-search` (SSE) | public, per-IP limit | **auth**, per-user limits |
| `POST /outreach/generate`, `POST /outreach/channels` | public | **auth** |
| `POST /intelligence/derive-icp`, `/chat`, `/why-this-lead`, `/suggestions` | public | **auth** |
| `POST /leads/save`, `GET /leads/saved`, `DELETE /leads/saved/{id}` | auth (custom header check) | auth (standard dependency) |
| `/api/knowledge/*`, `/api/capsules*`, `/api/relay/*` seller routes | auth | auth (unchanged) |

**Still public** (buyer page, addressed by the unguessable slug): `GET /api/relay/public/{slug}`,
`POST .../book`, `POST .../question` **and** `POST .../questions`, `POST|PATCH .../confirm` (new),
`POST .../not-interested`, `POST .../contact-later`. Per-IP rate limited, strict validation, drafts → 404,
malformed slugs → 404.

Ownership: every lookup is filtered by the caller's `user_id`; another user's id → **404**.
Newly enforced: `GET /api/knowledge/jobs/{id}` and `GET /api/knowledge/jobs/{id}/stream` (were readable by
any logged-in user), `POST /api/knowledge/facts` (capsule must be yours), and
`POST /sources/{id}/resync` / `DELETE /sources/{id}` now check ownership **before** cancelling the job.

## 2. Rate limits (429 + `Retry-After` seconds)

| Key | Limit | `detail` |
|---|---|---|
| user — `/leads/search` + `/leads/deep-search` | 40 / min | "Lead search rate limit exceeded. Please wait a moment before searching again." |
| user — `/leads/deep-search` | 6 / min, **max 2 concurrent streams** | "Deep search rate limit exceeded…" / "You already have 2 deep searches running…" |
| user — `/outreach/*` | 25 / min | "Outreach generation rate limit exceeded. Please wait a moment." |
| user — `/intelligence/*` | 35 / min | "Intelligence API rate limit exceeded. Please wait a moment." |
| user — `/api/knowledge/crawl`, `/upload` (+ `/sources/{id}/resync`: window limit only) | 10 / 10 min, max 2 running imports | "Too many knowledge imports…" / "You already have 2 knowledge imports running…" |
| user — `POST /api/relay/create` (LLM) | 10 / min | "Relay generation rate limit exceeded. Please wait a moment." |
| IP — `GET /api/relay/public/{slug}` | 60 / min | "Too many requests. Please wait a moment." |
| IP — public relay writes (book/question/confirm/not-interested/contact-later) | 10 / min | "Too many requests. Please wait a moment and try again." |
| page — questions on one relay | 30 / hour | "This page has received too many questions. Please try again later." |

## 3. Lead Finder

### `POST /leads/search` (body unchanged: `query`, `filters`, `user_offer`, `search_mode`)
* Still returns a JSON **array** of leads. Added per-lead fields: `is_sample` (bool), `ai_enriched` (bool),
  `reviews_count` (int; was silently dropped by the response model).
* **Sample data**: only when the server has no `GOOGLE_PLACES_API_KEY`. Every lead then has
  `"is_sample": true` and the response has header **`X-Sample-Data: true`** (the "top-level" flag, since the
  body must stay an array). Clients should show a "sample data" banner and must not dial/save these.
  (Cross-origin web clients can only read the header if CORS exposes it — see "Other owners".)
* With a key configured the server **never** substitutes fake businesses: no matches → `200 []`;
  Places quota → **503** "Lead search quota is exhausted right now. Please try again later." (`Retry-After: 60`);
  other provider failure/timeout → **502** "The lead search provider failed to respond. Please try again."
* `ai_enriched: false` = the AI provider was unavailable and rule-based text was used for
  `ai_summary` / `likely_pain_point` / `outreach_angle` / `opportunity_summary` / `service_fit_reason`.
* Validation (400): query < 2 or > 300 chars (messages unchanged); `user_offer` > 1000 chars;
  `filters.rating` not a number in 0–5; `filters.city` / `filters.business_category` not text ≤ 120 chars.
* Filters are applied **before** AI enrichment (same results, far fewer paid LLM calls); enrichment runs
  with bounded concurrency on the async client (no event-loop blocking).

### `POST /leads/deep-search` (SSE)
* First bytes: comment `: stream-open`. Idle heartbeat comment `: keep-alive` every 15 s. Comments are
  ignored by both current parsers.
* Events (unchanged names/fields): `searching`, `lead_found` (lead object incl. `is_sample`, `ai_enriched`),
  `area_done`. Added fields: `searching.sample` (bool); `area_done.error` (`"provider_error"` |
  `"provider_quota"`) when one area's lookup failed.
* **Exactly one terminal event**, then the stream closes:
  * `complete` — `{total_leads, areas_searched, leads, sample, stopped_reason}`; new fields `sample` (bool) and
    `stopped_reason`: `"target_reached" | "areas_exhausted" | "area_limit" | "time_limit"`.
  * `error` (**new**) — `{detail, code, total_leads, areas_searched, sample?}` with `code` one of
    `provider_quota`, `provider_error` (3 consecutive area failures), `internal_error`, `incomplete`.
    Leads already streamed via `lead_found` remain valid.
* Work stops as soon as the client disconnects (in-flight Places/LLM calls are cancelled; no leaked tasks).
* Caps per stream: 40 paid area lookups (`DEEP_SEARCH_MAX_AREAS`) and 300 s (`DEEP_SEARCH_TIME_BUDGET_SECONDS`).
* Headers: `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`.

### Saved leads
`POST /leads/save` now rejects oversized fields with 422 (`business_name` ≤ 300, `website` ≤ 2048,
`phone_number` ≤ 64, text fields ≤ 10 000 chars). Responses unchanged.

## 4. Outreach — `POST /outreach/generate`
* No more fake drafts: previously a failure returned 200 with `opening_message: "ClozFlow quota limit exceeded."`.
  Now:
  * **503** "Outreach generation is not available: no AI provider is configured on the server."
  * **503** + `Retry-After: 60` "The AI provider's quota is exhausted right now. Please try again in a minute."
  * **502** "Message generation failed at the AI provider. Please try again."
* Success body unchanged. Duplicate-avoidance history is now per user (was shared across tenants) and bounded.
* `language` ≤ 40 chars; `lead_data` larger than ~20 KB → 400 "lead_data is too large".

## 5. Lead Intelligence — `/intelligence/*`
* `conversation_history[].role`: send **`"user"` / `"assistant"`**. Legacy `"ai"` (also `bot`, `model`, `human`) is
  accepted and normalised; client-supplied `"system"` turns and malformed items are dropped; last 6 turns,
  2000 chars each. (Before, any `"ai"` turn made the LLM call fail and the reply silently fell back to rules.)
* Unchanged contract: invalid input still returns `200 {"success": false, "error": "..."}`. New such cases:
  `offer` > 1000 chars, `message` > 2000 chars.
* `why-this-lead` no longer 500s on non-list `opportunity_signals` / null scores.

## 6. Knowledge base — `/api/knowledge/*`

### `POST /upload` (multipart, field `files` repeated)
| Case | Status | `detail` example |
|---|---|---|
| no files / more than 10 files | 400 | "Too many files: upload at most 10 documents at a time." |
| empty file | 400 | "File notes.txt is empty." |
| file > 20 MB | **413** (was 400) | "File big.pdf exceeds the 20 MB size limit." |
| request > 100 MB in total | **413** | "The upload exceeds the 100 MB total size limit. Upload fewer files at a time." |
| unsupported extension | **415** (was 400) | "Unsupported format 'exe' in file tool.exe. Allowed formats: PDF, DOCX, XLSX, CSV, JSON, TXT, MD, HTML." |
| legacy `.doc` / `.xls` (were accepted, then the job always failed) | **415** | "Legacy .doc files are not supported (old.doc). Save it as .docx and upload it again." |
| content does not match extension (magic bytes / zip structure / UTF-8 text / valid JSON / zip-bomb guard) | **415** | "File fake.pdf does not look like a valid PDF file." |
* Filenames are reduced to a safe basename (`../../x.txt` → `x.txt`, `C:\a\b.pdf` → `b.pdf`, control chars
  stripped, ≤ 150 chars). Temp files are closed right after reading. Response unchanged
  (`{job_id, files_count, status, stages}`).
* In a multi-file job an unreadable file no longer fails the whole job; the completion event lists it in
  `skipped_files` (the job fails only if no file had readable text).

### `POST /crawl` and every server-side fetch (SSRF)
* Allowed: `http`/`https` only, no `user:pass@`, no internal hostnames (`localhost`, `*.local`, `*.internal`,
  metadata hosts), and every DNS answer must be a public address. Blocked (IPv4 + IPv6 incl. IPv4-mapped /
  NAT64 / 6to4): private, loopback, link-local (incl. `169.254.169.254`), CGNAT, multicast, reserved,
  unspecified, documentation ranges. Rejections: **400** `"Security check failed: <reason>"` (unchanged shape).
* Enforced again **at connect time for every connection and every redirect hop** (the IP actually dialed is the
  validated one — defeats redirects to internal hosts and DNS rebinding). Caps: ≤ 5 redirects, 3 MB per
  response, 20 s per page fetch, 150 s per crawl, 18 pages (hard cap 50), bounded link frontier.
* `ALLOW_LOCALHOST_CRAWL=true` (dev only) still allows loopback/private targets; link-local/metadata stay blocked.

### Saving knowledge again (merge-by-source — was "replace by company name")
Before: every new import deleted **all** capsules whose company name matched — including published capsules,
capsules from other sources, manual capsules starting with that name, and user-confirmed facts.
Now (backwards compatible — same capsule shapes, same endpoints):
* A new import **adds** its capsules; nothing from other sources or manual capsules is touched.
* Only **unreviewed drafts from the same source** (same source id — e.g. re-sync — or same source URL /
  document name) are superseded, and only if they have no user-confirmed facts and no Pearl agent uses them.
  Published/edited/in-use capsules are kept (the user may see an older and a newer version side by side).
* New capsules record `intelligence_data.source_id`.
* The completion SSE/status event (`status: "completed"`) gains
  `"knowledge_merge": {"strategy": "merge_by_source", "superseded_capsule_ids": [...], "preserved_capsule_ids": [...]}`.
* `DELETE /sources/{id}` now removes only that source's capsules (by source id, or exact source URL for older
  capsules) and their facts/chunks/versions, and unbinds Pearl agents from them — it no longer deletes
  knowledge of other sources that share the domain/company name.

### Jobs & streams
* `GET /jobs/{id}` and `/jobs/{id}/stream`: other users' jobs → 404.
* The stream now always ends: if the job already finished it sends the final snapshot and closes; a
  cancelled job (source deleted / reset) emits `{"status": "failed", "cancelled": true, "error": "Ingestion was cancelled."}`;
  a job that is no longer running ends with a terminal snapshot instead of pinging forever.
* `POST /sources/{id}/resync`: unknown/foreign id → **404** (was 400); non-website source → 400 (unchanged).
  A re-sync now starts with `status: "connecting"` and clears the previous `error_message`.
* `GET /overview`: `stats.total_facts` is now the real count (was capped at 150).
* `GET /overview` **`sources[]` gain `error_message`** (null unless the import failed / was cancelled).

### Imports interrupted by a restart (were "running" forever)
Imports run inside the server process. A source still `connecting` / `crawling` / `extracting` that no
task of this process runs is marked **`status: "failed"`** with a readable `error_message`:
* at **startup** (knowledge router lifespan) and **when read** (`GET /overview`, `GET /jobs/{id}`,
  `GET /jobs/{id}/stream`) if its last update predates the current server process →
  `"Import interrupted: the server restarted before it finished. Start the import again."`
* when read, if it made no progress for 30 minutes →
  `"Import stopped making progress and was marked as failed. Start the import again."`

The change is stored (not only reported). Assumes one backend process, as deployed
(`supervisord`: `--workers 1`); with several processes an import running in another one could look
abandoned after 30 idle minutes.

### Cancel an import without deleting its source (new)
`POST /api/knowledge/jobs/{job_id}/cancel` — alias `POST /api/knowledge/sources/{source_id}/cancel`
(the job id is the source id). Stops the running upload / crawl / re-sync task; the source stays,
with `status: "failed"`, `error_message: "Import cancelled."`; pages already stored are kept, no
capsules are created. Open job streams end with `{"status": "failed", "cancelled": true, ...}` and
`GET /jobs/{id}` returns that snapshot. Response:
`{"ok": true, "job_id": "...", "status": "failed", "cancelled": true, "was_running": true|false, "error_message": "Import cancelled."}`
(`was_running: false` = it was left "running" by a task that is gone). Errors: **404**
`Import not found` (unknown or another user's), **409** `This import already completed|failed; there is
nothing to cancel.`, 401 without a token. A cancelled import frees its slot in the 2-running-imports limit.
* `POST /facts`: capsule must belong to you (404), `category` ∈ business|product|customer|sales (400),
  `field_name` ≤ 200 / `value` ≤ 3000 chars (422).

## 7. Capsules — `/api/capsules`
Explicit `null` for `name` / `product_name` / `is_default` in PATCH/POST is ignored instead of producing a 500.

## 8. Relay

### Buyer page (public)
* **Questions** — both `POST /api/relay/public/{slug}/question` and `POST /api/relay/public/{slug}/questions`
  work. Body `{"question_text": "..."}` (trimmed, 1–2000 chars; else 422). Response unchanged
  `{"message": "Question submitted", "question_id": n}`.
* **Confirm accuracy (new)** — `POST` or `PATCH /api/relay/public/{slug}/confirm`
  * "Yes, that's accurate": `{"buyer_confirmed": true}` (body optional; defaults to true)
  * "Suggest changes": `{"buyer_confirmed": false, "buyer_corrections": "Team is 12, not 8"}` (≤ 4000 chars;
    corrections required when false → 422 "Please describe what should be corrected.")
  * Response: `{"message": "Confirmation recorded" | "Correction recorded", "buyer_confirmed": bool, "buyer_corrections": str|null}`
  * The seller-only `PATCH /api/relay/{id}` stays authenticated (the web page currently calls it and fakes success —
    see frontend change below).
* **Seller replies** — `GET /api/relay/public/{slug}` adds:
  * `relay.seller_replies`: `[{question_id, question_text, answer_text, asked_at, answered_at}]` — only answered
    questions of this page, oldest answer first. No seller data beyond `seller_name`/`seller_company` already shown.
  * `relay.questions[].answered` (bool); `questions` are now ordered oldest first.
* **Booking** — `POST /api/relay/public/{slug}/book`: validated `buyer_name` (1–120), optional `buyer_email`
  (valid address, ≤ 254), optional `buyer_phone` (`[0-9+()-. ]`, 4–32) → 422 otherwise. Slot claim is atomic:
  concurrent/double booking → **409** "This slot is no longer available…" (unknown slot → 404). Response unchanged.
* `not-interested` / `contact-later` on a draft relay → 404 (were accepted).

### Seller
* `POST /api/relay/{id}/publish` is idempotent: re-publishing no longer resets `opened` / `booked` / … back to
  `published`. Response unchanged (`status` reports the current status).
* `POST /api/relay/create` response adds `ai_fallback` (bool): true when the AI provider failed (or no
  `GROQ_API_KEY`) and generic placeholder copy was used — review before publishing. Malformed stored call JSON
  no longer causes a 500.
* `POST /api/relay/{id}/questions/{qid}/reply`: empty reply → 422; ≤ 5000 chars.

## Frontend / app changes needed (owners: web frontend, app)
1. Send `Authorization: Bearer <token>` on `/leads/search`, `/leads/deep-search`, `/outreach/*`, `/intelligence/*`.
2. `RelayPublic.jsx` `handleVerify`: replace `PATCH /api/relay/${relay?.id || slug}` with
   `POST /api/relay/public/${slug}/confirm` and body `{buyer_confirmed, buyer_corrections}`; check `res.ok`
   (it currently shows a success toast on failure).
3. `RelayPublic.jsx`: render `relay.seller_replies` (and/or `relay.questions` with `answered`).
4. `LeadIntelligencePanel.jsx`: send `role: 'assistant'` (backend accepts `'ai'` for now).
5. Lead Finder (web + app): show a "Sample data" banner when `X-Sample-Data: true` / `is_sample` / `complete.sample`;
   handle the deep-search `error` event and 502/503 from `/leads/search`; don't save/dial `is_sample` leads.
6. Outreach Studio: show `detail` for 502/503 (was a fake draft).
7. Web deep-search SSE parser resets `eventType`/`eventData` per network chunk, so an event split across chunks
   is dropped — keep that state outside the read loop.
8. Knowledge base (web + app): show `sources[].error_message` for failed imports; add a "Cancel" action for
   running imports (`POST /api/knowledge/jobs/{id}/cancel`) instead of deleting the source.
