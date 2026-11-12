# Meeting Wizard backend (REST, data model, brief/debrief, battlecards, calendar, integrations)

What the web and app clients, and the live-pipeline owner, must know. Everything lives under
`/api/wizard` (Bearer auth on every route; rows that belong to another user answer `404`).
Dates are ISO-8601 UTC with a `Z`. Money is INR: `deal_value_text` keeps what the user typed
(`"₹4.5L"`, `"12 lakh"`, `"4,50,000"`), `deal_value_inr` is the parsed float.

Files: `models_wizard.py`, `routers/wizard.py`, `services/wizard/{llm,brief,debrief,battlecards,calendar,
integrations,enrich,retention}.py`, `services/wizard/battlecards_seed.json`, tests `tests/test_wizard_*.py`.
Shared with the live pipeline: `services/wizard/contracts.py` (`WizardContext`, `PreRenderedCard`, `CoachCard`,
metrics/deal-health helpers) and `services/wizard/hooks.py`.

## Lifecycle

```
POST /meetings  →  planned  →  POST /meetings/{id}/brief  →  ready
   →  POST /meetings/{id}/start  →  live  (call context created; payload["wizard"] = WizardContext)
   →  live session saves a CallLog  →  hooks.session_saved(meeting_id, call_log_id, user_id)
      (or the client calls POST /meetings/{id}/end {call_log_id})  →  ended  →  debrief job  →  debriefed
```

`cancelled` and `no_show` are set with `PATCH /meetings/{id} {"status": ...}` or `POST /end {"outcome":"no_show"}`.

## Data model (`models_wizard.py`)

| Table | Purpose |
|---|---|
| `wizard_meetings` | one row per planned/live/finished meeting (spec §3; all columns are returned by the Meeting JSON below) |
| `wizard_battlecards` | seed (`user_id NULL`, `source="seed"`) + user cards; Fact → Impact → Act, plus `act_hinglish`, `question_to_ask`, `proof_point`, `do_not`, `psychology`, `trigger_keywords` (EN + Hinglish) |
| `wizard_debriefs` | one per meeting (`meeting_id` unique); `status generating|ready|failed` |
| `wizard_calendar_sources` / `wizard_calendar_events` | ICS / Google / Microsoft sources and a ±14-day event cache (unique `(source_id, external_id)`) |
| `wizard_integrations` | one row per user: webhook URL + HMAC secret (write-only), CRM BCC email, `default_country`, `notetaker_name`, `consent_script`, `bridge_disclosure`, retention days, Zoho tokens (write-only) |

`call_logs` gains nullable columns (added at startup by `add_missing_columns`): `meeting_id`, `title`,
`prospect_name`, `platform`, `channel`, `engine`, `duration_seconds`, `started_at`, `ended_at`, `metrics` (JSON),
`deal_record` (JSON). The live pipeline writes them at save time; the debrief reads them (and computes metrics
from transcript timing when `metrics` is absent).

Startup (`main.py` lifespan → `routers.wizard.startup_tasks()`): seeds missing battlecards (idempotent by id) and
runs the retention sweep unless `CLOZFLOW_WIZARD_RETENTION_SWEEP=0`.

## Meeting JSON

```json
{"id":"8c3e…","user_id":7,"title":"Discovery with Acme Bakery","status":"ready",
 "prospect_name":"Ravi Kumar","company":"Acme Bakery","industry":"Retail bakery chain","role":"Operations Manager",
 "prospect_phone_e164":"+919876543210","prospect_email":"ravi@acmebakery.in","lead_id":null,
 "deal_value_inr":450000.0,"deal_value_text":"₹4.5L","objective":"…","methodology":"meddpicc",
 "capsule_id":3,"product_name":"ClozFlow Pro","product_price":"₹2,400 per user per month plus GST","product_specification":"…",
 "platform":"meet","channel":"tab_audio","scheduled_start":"2026-11-14T05:00:00Z","scheduled_end":null,
 "meeting_link":"https://meet.google.com/abc-defg-hij","calendar_event_id":"meet-1@example.com","calendar_source":"ics",
 "brief":{…},"has_brief":true,"brief_generated_at":"2026-11-12T10:00:00Z","battlecard_ids":["pricing","in-promoter-signoff"],
 "coaching_intensity":"guided","consent":{"mode":"announced","announced_at":"…","script":"…","participants_notified":true},
 "context_id":null,"call_log_id":null,"bridge_call_id":null,"started_at":null,"ended_at":null,
 "created_at":"…","updated_at":"…","debrief":null}
```

`debrief` is a summary line when one exists: `{status, summary, outcome, deal_health_score, next_step, generated_at}`;
the same values are also flat on the meeting as `debrief_summary`, `outcome`, `deal_health_score` (for list/home cards).
List endpoints omit `brief` (`has_brief` tells you it exists). Request bodies accept the aliases `prospect_phone_e164`
(= `prospect_phone`), `deal_value_text` (= `deal_value`) and the product snapshot fields `product_name`,
`product_price`, `product_specification`; unknown keys are ignored.

## Routes

| Method & path | Semantics |
|---|---|
| `GET /home` | `{today:[event + linked meeting, starting_now], live: Meeting\|null, upcoming:[Meeting], recent:[Meeting+debrief], stats:{meetings_30d,next_step_rate,avg_talk_ratio,debriefs_30d}, server_time}`; `today` = cached calendar events starting in (now−1 h, now+24 h) |
| `GET /meetings?status=a,b&limit=` | the user's meetings, newest first |
| `POST /meetings` | body: any Meeting fields in snake_case (`prospect_phone`, `deal_value`, `capsule_id`, `lead_id`, `calendar_event_id`, `battlecard_ids`, `consent`, …). Needs `prospect_name`, `company`, `lead_id` or `calendar_event_id`. `lead_id` prefills from Lead Finder; `calendar_event_id` prefills title/time/link/platform and guesses the attendee (first external email). The default capsule is snapshotted when none is given. `201` |
| `GET /meetings/{id}` | Meeting + `battlecards:[Battlecard]` for its `battlecard_ids` |
| `PATCH /meetings/{id}` | partial update; `status` may be set to `planned|ready|cancelled|no_show` (use start/end for live/ended); `409` while live for methodology/capsule/channel changes |
| `DELETE /meetings/{id}` | deletes meeting + debrief, unlinks calendar events; `409` while live |
| `POST /meetings/{id}/brief?force=1` | `{brief, battlecards, generated_at, degraded, model, cached, meeting}`; sync, ≤ 25 s; `degraded:true` = template brief (no LLM key / vendor failure). Sets `status=ready`, merges the auto-picked battlecards into `battlecard_ids` |
| `POST /meetings/{id}/start` `{channel?, consent?, prospect_phone?, coaching_intensity?}` | creates the call context (`local_call_contexts`) with the 7 legacy brief fields + `payload["wizard"]` (below); sets `live`. Returns `{context_id, meeting, consent_script, consent_script_hi, notetaker_name, ws:{audio:"/ws/audio",text:"/ws"}, bridge:{enabled,rate_per_minute,reason,create_url}, wizard:{prospect_language_hint,intensity,battlecard_ids,bridge_disclosure}}`. `channel=phone_bridge` requires a phone; the client then calls `POST /api/copilot/bridge/calls` with this `context_id` |
| `POST /meetings/{id}/end` `{call_log_id?, outcome?}` | idempotent; links the CallLog (or finds it via the context's `call_log_id`), sets `ended`, runs the debrief job as a background task when a CallLog exists; returns Meeting + `debrief_scheduled` |
| `GET /meetings/{id}/debrief` | `202 {status:"generating"}` until ready (also kicks the job if nothing was scheduled), `404` while the meeting hasn't ended ("not yet", safe to poll), else the Debrief JSON |
| `POST /meetings/{id}/debrief?force=1` | synchronous (re)generation, ≤ 40 s |
| `PATCH /meetings/{id}/debrief` | partial edit: any debrief field (`summary`, `outcome`, `next_step{text,date}`, `follow_up_email{subject,body}`, `follow_up_whatsapp`, …); `action_items` is sent as the whole array (items matched by `id` and merged, items without an id get one, unlisted items are removed); `methodology_fields` merge by `field` (`value`, `evidence_quote`, `confirmed`) |
| `POST /meetings/{id}/debrief/send` `{channel, to?}` | `email` → `{mailto}` (RFC 6068, BCC = `crm_bcc_email`); `whatsapp` → `{wa_me_url}` (`https://wa.me/<digits>?text=…`); `relay` → `{relay_id, slug, url:"/relay/<slug>", existing}` via the existing relay engine; `crm` → pushes every preview change (Zoho when connected, else the HMAC webhook, else `409`) and answers `{crm_status, written, …}`. Each marks `sent.{email_at,whatsapp_at,relay_id,crm_at,crm_status}` |
| `GET /meetings/{id}/crm/preview` | approve-before-write diff `{changes:[{id,object,field,label,current,proposed,evidence_quote,approved}], rows (same), target:"zoho"\|"webhook"\|null, record_url (Zoho deal link after a push, else null), debrief_ready, previous_push, crm_bcc_email}` for contact, deal (stage/amount/next step/closing date), note (summary + actions + objections) and task (next step). `current` = the previous push |
| `POST /meetings/{id}/crm/push` `{approved:["deal.Amount", …]}` | change ids from the preview (row objects also accepted); writes only those: Zoho (`Contacts/upsert` by Email, `Deals` search→update/insert, `Notes`, `Tasks`) or the webhook. Answers `{crm_status:"ok"\|"partial"\|"failed", written:<n>, target, …}`; `502` with the provider's message on failure, `409` when nothing is connected |
| `POST /meetings/{id}/rehearse` `{messages:[{role:"rep"\|"prospect",text}]}` | stateless AI prospect: `{reply, hint: CoachCard\|null, degraded}`; the hint is a full `say` card (Tier 0 from a trigger match without an LLM) |
| `GET /battlecards?kind=&q=&meeting_id=&include_inactive=` | seed + own cards; with `meeting_id` each card carries `score`, `why`, `selected` |
| `POST /battlecards` | own card (`title` + `act` required) or `{copy_of:"<seed id>", ...overrides}` to copy a seed card; `201` |
| `PATCH /battlecards/{id}` / `DELETE /battlecards/{id}` | own cards only; seed cards → `403` |
| `POST /battlecards/suggest` `{meeting_id, limit}` | ranked `[{battlecard, score, why}]` (keyword + methodology + industry + role/deal-size heuristics) |
| `GET /calendar/sources` | `{sources:[{id,kind,label,ics_url_masked,connected,last_synced_at,status,error}], providers:{google:bool,microsoft:bool}}` |
| `POST /calendar/sources` | `{kind:"ics", url, label}` → validates (https only, no private hosts), fetches (≤ 2 MB, 10 s), parses, caches ±14 days, returns the source + `sync` result (`201`). `{kind:"google"\|"microsoft"}` → `{auth_url}` when `GOOGLE_CALENDAR_*` / `MS_GRAPH_*` are set, else `501 {detail:"Google Calendar isn't configured on this server. Paste your calendar's private ICS link instead."}` |
| `GET /calendar/oauth/{provider}/callback` | browser redirect target; stores tokens, syncs, shows a "connected, close this tab" page |
| `DELETE /calendar/sources/{id}` / `POST /calendar/sync` / `GET /calendar/events?from=&to=&limit=` | as named; events: `{id,source_id,external_id,title,start,end,attendees:[{name,email}],meeting_link,platform,location,meeting_id,meeting}` |
| `POST /calendar/events/{id}/link` | creates (or returns) the Meeting prefilled from the event (`201`) |
| `GET /preflight` | `{stt:{vendor,ready,model}, coach:{vendor,model,ready}, bridge:{enabled,reason,rate_per_minute,min_balance,country_default}, bot:{enabled:false}, consent_script, consent_script_hi, notetaker_name, bridge_disclosure, slo:{first_line_ms:1200}, zoho:{configured,connected}, calendar_providers}`; `stt` comes from Backend B's `stt_router.describe()` when present |
| `GET /integrations` / `PUT /integrations` | the row; secrets are write-only (`has_webhook_secret`, `zoho:{connected, org_name, configured, connected_at}` + flat `zoho_connected`); `PUT` takes only the changed keys; `crm_webhook_url` must be https |
| `GET /integrations/zoho/connect` → `{auth_url}` · `GET /integrations/zoho/callback` · `DELETE /integrations/zoho` | env-gated (`501` with a helpful message when `ZOHO_CLIENT_ID/SECRET` are missing) |
| `POST /admin/retention/run` | superusers only: runs the transcript retention sweep now; returns counts |

`/call/start` (legacy) additionally accepts `platform`, `deal_value`, `active_battlecard`, `meeting_id`, `methodology`,
`coaching_intensity`, `battlecard_ids`, `capsule_id`, `consent`, `prospect_phone`; when any is present the same
`wizard` sub-dict is attached to the context. Old payloads are unchanged.

## `payload["wizard"]` (= `contracts.WizardContext`) stored on the call context

```json
{"meeting_id":"8c3e…","platform":"meet","channel":"tab_audio","deal_value":"₹4.5L","deal_value_inr":450000.0,
 "methodology":"meddpicc","coaching_intensity":"guided","intensity":"guided",
 "battlecard_ids":["in-promoter-signoff","pricing","obj-authority-boss"],
 "battlecards":[{"id":"pricing","title":"Pricing Resistance","kind":"objection","moment":"pricing","act":"…","act_hinglish":"…","do_not":"…","question_to_ask":"…","trigger_keywords":["expensive","mehenga",…]}],
 "pre_rendered_cards":[{"battlecard_id":"pricing","id":"pricing","headline":"Pricing Resistance","say":"<25–60 spoken words, deal-tailored>","say_lang":"hinglish","say_words":41,
                        "then_ask":"When you say expensive, …?","trigger_keywords":["expensive","mehenga",…≤12],"moment":"pricing","why":"comes up in most first calls","do_not":"…"}],
 "capsule_id":3,"capsule_facts":[{"label":"Price","value":"₹2,400 per user per month plus GST","source":"capsule:3"}],
 "brief":{…full brief…},"consent":{"mode":"announced","announced_at":"…","script":"…","participants_notified":true},
 "keyterms":["Ravi Kumar","Acme Bakery","ClozFlow Pro",…≤50],"prospect_language_hint":"hinglish",
 "bridge_disclosure":true,"notetaker_name":"ClozFlow Notetaker","prospect_name":"Ravi Kumar","company":"Acme Bakery"}
```

`prospect_language_hint` is `"hinglish"` by default for India, `"en-IN"` for tech/CXO buyers or non-+91 numbers.
`pre_rendered_cards` are the Tier 0 cards: show one instantly on a `trigger_keywords` match; `say` is complete spoken
text (the LLM tailors it at brief time; without an LLM it is the card's own `act` / `act_hinglish`).

## Brief JSON (`meeting.brief`)

Spec §5.2 keys (`objective, home_run, backup_next_step, attendee, recap, hypotheses, agenda, likely_objections,
pricing_posture, proof_points, risks, opener, methodology{name,fields[{field,label,status,value}]}, sources`) plus:
`pre_rendered_cards` (above), `consent {script, script_en, script_hi, mode_hint}` (`bridge_disclosure` for the phone
bridge, else `announced`/`in_invite`), `prospect_language_hint`, `product {name, price}`, `degraded`, `model`,
`generated_at`, `generated_by: "template"|"llm"`. Inputs: capsule facts (the only numbers the model may use), Lead
Finder row, previous conversations with the same prospect/company (wizard meetings, bridge calls, `call_logs.prospect_name`),
approved knowledge facts, suggested battlecards, optional homepage title/description (`CLOZFLOW_WIZARD_ENRICH`).

## Debrief JSON

```json
{"id":"…","meeting_id":"…","status":"ready","error":null,
 "summary":"<BLUF ≤ 80 words>","outcome":"next_step_set","stage_reached":"next_steps",
 "methodology_fields":[{"field":"metrics","label":"Metrics","value":"Forty enquiries a week","evidence_quote":"Around forty a week.","speaker":"prospect","confidence":0.9,"confirmed":null}],
 "objections":[{"type":"cost_&_budget","quote":"…verbatim…","handled":true,"how":"<rep's reply>","battlecard_id":"pricing","turn_index":5}],
 "buying_signals":[{"quote":"How long does implementation take if we start?","why":"asked about implementation time","turn_index":7}],
 "risks":[{"text":"…","severity":"low|medium|high"}],
 "action_items":[{"id":"a1b2c3d4","text":"Send calendar invite: …","owner":"rep","due":"2026-11-17","done":false}],
 "next_step":{"text":"Shall we do a walkthrough with your MD on Tuesday at 11?","date":"2026-11-17","evidence_quote":"…"},
 "metrics":{"elapsed_s":52,"rep_talk_s":…,"talk_ratio_rep":0.51,"longest_monologue_rep_s":…,"questions_rep":…,"estimated":false,
            "cards_shown":3,"cards_used":1,"cards_dismissed":1,"cards_up":0,"cards_down":1},
 "deal_health":{"score":62,"rationale":["3 of 8 MEDDPICC fields covered.","A dated next step is agreed."],"coverage":{"metrics":true,…}},
 "follow_up_email":{"subject":"…","body":"<≤ 180 words>"},"follow_up_whatsapp":"<≤ 90 words, Hinglish if the prospect used it>",
 "coaching":[{"tip":"…","metric":"talk_ratio_rep","value":0.51,"benchmark":"seller talk share 55–60%","evidence_quote":null},
             {"tip":"…","metric":"longest_monologue_rep_s",…},{"tip":"…","metric":"questions_per_hour",…},{"tip":"…","metric":"pause_after_objection_s",…}],
 "crm_payload":{"meeting_id":"…","prospect_name":"…","outcome":"…","next_step":"…","next_step_date":"…","deal_health_score":62,"field_metrics":"…",…},
 "sent":{"email_at":null,"whatsapp_at":null,"relay_id":null,"crm_at":null,"crm_status":null},
 "degraded":true,"model":null,"generated_at":"…","edited_at":null,"created_at":"…"}
```

Rules enforced server-side: every `methodology_fields[].value` carries an `evidence_quote` found verbatim (case /
whitespace / quote-mark insensitive) in the transcript or the value is dropped; objections, buying signals and coaching
quotes are verified the same way; `outcome=next_step_set` iff `next_step.date`; `no_show` when there is no transcript;
email ≤ 180 words, WhatsApp ≤ 90, summary ≤ 80. Coaching always includes the four Gong comparisons (talk ratio
55–60 %, longest monologue ≤ 2.5 min, 15–18 questions/hour, pause ≥ 2 s after objections) plus card-feedback counts.
Deal health uses Backend B's `services/wizard/deal_record.compute_deal_health` when importable, else
`contracts.compute_deal_health` (coverage 60 % + dated next step 20 % + risk/momentum 20 %).

## Battlecard JSON

```json
{"id":"pricing","kind":"objection","category":"Cost & Budget","title":"Pricing Resistance","tag":"High Impact","accent":"#ef4444",
 "trigger_keywords":["expensive","too costly","mehenga",…],"trigger_description":"…","fact":"…","impact":"…",
 "act":"<2–3 complete spoken sentences, 25–60 words>","act_hinglish":"<same meaning, Latin-script Hinglish>",
 "question_to_ask":"<one complete question?>","proof_point":"…","do_not":"…","psychology":"…","methodology_field":null,
 "tags":["price","budget"],"is_active":true,"usage_count":0,"source":"seed","is_seed":true,"moment":"pricing",
 "created_at":"…","updated_at":"…","reframe":"<alias of act>","trap":"<alias of do_not>"}
```

Kinds: `objection|competitive|methodology|india_context|stage|closing|persona|custom` (`ego` is the one `persona` card).
60 seed cards: the five legacy ids (`pricing`, `skepticism`, `delay`, `ego`, `competitive`), the HubSpot-style objection
taxonomy, Gong-evidenced behaviours (pause, isolate, risk reversal), competitive templates (why we win / lose,
landmines), India context (promoter sign-off, CA gate, working capital, negotiation ritual, payment terms, PoC fatigue,
trust deficit, FY-end/festive timing, Hinglish mirroring, GST framing, WhatsApp follow-up), MEDDPICC/BANT/SPIN
methodology cards and stage/closing cards.

## Calendar notes

ICS parsing (`services/wizard/calendar.py`): folded lines, `TZID`/UTC/floating/all-day, `DURATION`, `EXDATE`,
`RECURRENCE-ID` overrides, `RRULE FREQ=DAILY|WEEKLY` (INTERVAL, COUNT, UNTIL, BYDAY) expanded for ±14 days; other
frequencies keep the first instance and add a warning. Conferencing links are detected in `X-GOOGLE-CONFERENCE`,
`LOCATION`, `DESCRIPTION`, `URL` (meet.google.com → `meet`, zoom.us → `zoom`, teams.microsoft.com/teams.live.com →
`teams`, webex/whereby/goto → `other`; a plain `LOCATION` → `in_person`). Google uses `calendar.events.readonly`,
Microsoft `Calendars.ReadBasic`; OAuth state is a 15-minute signed token; redirect URIs are built from
`CLOZFLOW_WIZARD_OAUTH_REDIRECT_BASE`.

## Integrations notes

- Webhook: `POST <crm_webhook_url>` JSON `{event:"meeting.debrief", sent_at, meeting, debrief:{summary,outcome,next_step,deal_health,crm_payload}, fields:{"deal.Amount":…}, rows:[…]}`
  with headers `X-ClozFlow-Timestamp: <unix seconds>` and `X-ClozFlow-Signature: sha256=HMAC_SHA256(secret, f"{timestamp}.{body}")`; 10 s timeout; SSRF-checked; `502` surfaces the failure.
- Zoho CRM: scopes `ZohoCRM.modules.contacts.ALL,…deals.ALL,…notes.ALL,…tasks.ALL`; `accounts.zoho.in` / `www.zohoapis.in` by default; one refresh-on-401; the preview is the only thing written, row by row (contact → deal → note → task). The webhook + BCC path keeps working when Zoho isn't connected.
- Relay: reuses `services.relay_engine.generate_relay_content`; when the LLM isn't available the page is pre-filled from the debrief (pain, next step, summary).
- Consent: default script "Hi, quick note before we start: I'm using ClozFlow to take notes on this call so I can focus on our conversation. Is that okay with you?" plus a Hindi variant; editable per user (`consent_script`); `bridge_disclosure` (default true) is passed to the live pipeline in `wizard.bridge_disclosure`.
- Retention (`services/wizard/retention.py`): transcripts and `ai_suggestions` of `call_logs` older than the user's `retention_days_transcript` (default 180, `0` = keep) are replaced with `[]` and `metrics.transcript_purged_at` is stamped; rows linked by a Relay page are skipped; debriefs are kept; audio is never stored.

## Environment variables (all optional; see `web/.env.example`)

`CLOZFLOW_WIZARD_MODEL` (Gemini model, default `gemini-2.5-flash`; Groq `openai/gpt-oss-120b` is the fallback when only
`GROQ_API_KEY` is set), `CLOZFLOW_WIZARD_ENRICH` (`0` disables homepage enrichment), `CLOZFLOW_WIZARD_RETENTION_SWEEP`
(`0` skips the startup sweep), `CLOZFLOW_WIZARD_OAUTH_REDIRECT_BASE`, `GOOGLE_CALENDAR_CLIENT_ID/SECRET`,
`MS_GRAPH_CLIENT_ID/SECRET`, `ZOHO_CLIENT_ID/SECRET`, `ZOHO_ACCOUNTS_DOMAIN`, `ZOHO_API_DOMAIN`. Without any LLM key
every route still works: briefs and debriefs are built from templates and heuristics with `degraded: true`.

## For the live pipeline (Backend B)

- Read `payload["wizard"]` as above; `intensity` and `coaching_intensity` carry the same value.
- After saving a CallLog call `await hooks.session_saved(meeting_id, call_log_id, user_id)`; the registered hook
  (`services.wizard.debrief.on_session_saved`) returns immediately and runs the debrief in a background task with its
  own DB session (it also links `call_logs.meeting_id` and moves the meeting to `ended` → `debriefed`).
- Store coach cards in `ai_suggestions[]` as `{"payload":…, "card": CoachCard, "feedback": "up|down|used|dismissed", "timestamp", "turn_index"}`; the debrief counts them into `metrics.cards_shown/used/dismissed`.
- `call_logs.metrics` / `deal_record` are used when present (every `deal_record.fields[].evidence_quote` is re-verified against the transcript).
