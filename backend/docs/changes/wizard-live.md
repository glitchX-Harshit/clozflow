# Meeting Wizard live pipeline: `/ws/audio` protocol v2, coach cards, STT router

What the web and app clients (and the REST/debrief side) must know. Protocol v1 is unchanged:
a client that never sends `hello` and streams raw PCM gets exactly today's messages
(`transcriptUpdate` `{type,speaker,text}`, `aiAnalysis`, `error`, `session_saved`).

Files: `services/websocket_service.py` (endpoints, sessions, tracks), `services/wizard/coach_engine.py`
(Tier 0/1/2 coach), `card_policy.py` (pure cadence rules), `prompts.py`, `metrics.py`, `deal_record.py`,
`stt_router.py` + `stt_deepgram.py` + `stt_sarvam.py` (streaming STT), `services/latency_tracker.py`,
`services/bridge/{service,hub,xml_builder,config}.py` (phone calls).

## 1. Handshake

Open `wss://…/ws/audio?context_id=<brief>` with the same auth as before (bearer header, `?token=`, or the
`clozflow-auth.<jwt>` subprotocol). Send **one text frame first**:

```json
{"type":"hello","protocol":2,"channels":["rep","prospect"],"sample_rate":16000,"client":"web","meeting_id":null,"intensity":"guided"}
```

- `channels`: `["rep","prospect"]` (web: mic + tab audio) or `["mixed"]` (Android mic, in-person).
- `intensity`: `full | guided | light | on_demand | off` (default `guided`). `meeting_id` optional (also read from the brief's `wizard` sub-dict).
- If the first frame isn't a hello (or nothing arrives for 1.5 s) the socket runs protocol v1.

The server answers **immediately** (well inside the client's 2.5 s fallback window); the STT streams connect
concurrently and audio sent meanwhile is queued:

```json
{"type":"ready","protocol":2,"session_id":"<context_id>","engine":"coach",
 "stt":{"vendor":"deepgram","model":"flux-general-en / flux-general-multi","ready":true,"configured":"auto"},
 "features":["coach","strip","moment","metrics","deal_record","deal_health","ask","what_to_say","set_intensity","snooze","pin","feedback","consent","marker","notice","ping"],
 "intensity":"guided","meeting_id":"m-1","warmup_ms":null,"channels":{"1":"connecting","2":"connecting"},
 "slo":{"first_line_ms":1200,"first_line_p95_ms":2500}}
```

Then one of:
- `{"type":"notice","code":"warm","text":"Listening.","warmup_ms":412,"channels":{"1":"ready","2":"ready"}}` (plus
  `{"type":"notice","code":"rep_stt_unavailable","text":"…"}` when only the rep channel failed), or
- `{"type":"error","code":"stt_unavailable"}` then close 1011 when the prospect/mixed channel can't be transcribed (as in v1).

## 2. Audio frames (binary)

Byte 0 = channel (`0` mixed, `1` rep, `2` prospect), then PCM16LE 16 kHz mono. A 2048-byte PCM frame is sent as
2049 bytes. Unknown channel bytes are dropped; channel 0 on a rep+prospect session is routed to the prospect track.
`/ws` (text transcripts) also accepts `hello` and every client message below; `transcriptUpdate` sent by a client may
carry `channel`.

## 3. Client → server (text JSON)

| Message | Effect |
|---|---|
| `{"type":"close_stream"}` | End: last turns drained, CallLog saved, `session_saved`, close 1000 (as before). |
| `{"type":"what_to_say","length":"long"}` | On-demand card (`trigger:"on_demand"`; `say` ≤ 60 words, ≤ 120 with `length:"long"`), bypasses every gate incl. snooze/off. |
| `{"type":"ask","question":"How do I handle the price question?"}` | Private question → card with `trigger:"ask"`. ≤ 500 chars. |
| `{"type":"set_intensity","value":"light"}` | Replies `{"type":"notice","code":"intensity","text":"Coaching intensity: light.","intensity":"light"}`. |
| `{"type":"snooze","moment":"pricing","ms":300000}` | No proactive card for that moment for `ms` (≤ 1 h). No reply. |
| `{"type":"pin","id":"<card id>"}` | Marks the stored card `pinned: true`. No reply. |
| `{"type":"feedback","id":"<card id>","value":"up|down|used"}` | Stored on the card (`used` on an objection card marks the objection handled). No reply. |
| `{"type":"consent","mode":"announced|in_invite|bridge_disclosure|skipped","script":"…"}` | Transcript line `{speaker:"system", text:"Consent: announced"}` and `wizard.consent` in the brief payload. |
| `{"type":"marker","label":"Follow up on GST"}` | Transcript line `{speaker:"system", text:"Marker: …"}`; saved in `metrics.markers`. |
| `{"type":"ping","t":1731400000000}` | `{"type":"pong","t":1731400000000,"server_t":<ms>}` for the pre-flight round trip. |

## 4. Server → client

### `transcriptUpdate` (v2 shape)
```json
{"type":"transcriptUpdate","speaker":"prospect","text":"That sounds expensive.","channel":2,"t_start":12.4,"t_end":14.1,"is_final":true,"turn_index":7}
```
`speaker ∈ salesperson | prospect | system` (`unknown` only from `/ws` text clients). Times are seconds since the
session started. Mixed audio (channel 0) is labelled `prospect` (coaching needs a prospect) with `channel: 0`.

### `strip` (Tier 1, every prospect final segment, ≤ 400 ms)
```json
{"type":"strip","intent":"objection_price","label":"Price pushback","ask_next":"Expensive compared to what you had budgeted, or compared to another option?","stage":"objection","turn_index":7,"latency_ms":38}
```
Intents: `pricing_question, objection_price, objection_timing, objection_authority, objection_need, objection_trust,
objection_competitor, objection_status_quo, objection_integration, objection_security, brush_off, competitor_mention,
buying_signal, direct_question, next_step, small_talk, statement`. Deterministic (no LLM), so it moves every turn.

### `coach` (the one visible card; update in place by `id`)
```json
{"type":"coach","card":{
  "id":"3f9c2a1b7d10","moment":"objection","priority":"high","headline":"Price objection",
  "say":"Expensive compared to what you had budgeted, or compared to another option you looked at? Let's first see what the current process costs you every week.",
  "then_ask":"What would make this an easy yes for you?","detail":"Explore before you defend the number.",
  "say_lang":"en-IN","say_words":28,"battlecard_id":"obj-price-expensive",
  "sources":[{"kind":"battlecard","label":"Too expensive","ref":"obj-price-expensive"}],
  "confidence":0.82,"ttl_ms":15000,"turn_index":7,"trigger":"auto","latency_ms":640,
  "created_at":"2026-11-12T10:05:31Z","tier":2,"provisional":false,"revision":2,"late":false,"cue":"pause","stripped_claims":0,
  "entity":"Too expensive","objection":{"type":"price","quote":"That sounds expensive for a small bakery."}}}
```
`entity` is the battlecard title / competitor name / objection type behind the card (null otherwise); `objection`
is set on objection cards.
- `say` is the primary content: complete spoken text (15–60 words, ≤ 120 on demand) in the prospect's language.
  `headline` ≤ 6 words, `detail` ≤ 15 words, `then_ask` one full question.
- `tier 0` = instant keyword match on a partial (`provisional: true`, pre-rendered battlecard text); `tier 2` = LLM.
  Revisions share the `id`: replace the card in place (`revision` increases). A Tier 0 card is refined by the
  Tier 2 card of the same turn when it is still visible.
- `trigger`: `auto | on_demand | ask`. `cue: "pause"` on objection cards (show a pause hint before the rep speaks).
- `ttl_ms`: 12 000 (high priority 15 000). Pause the timer on hover/touch; pinned cards stay.
- `late: true` when `latency_ms` > 5000: render as a passive note, not "say this now".
- `stripped_claims` > 0: a price/feature sentence was removed because no capsule fact backed it.
- Proactive cards only for `PROACTIVE_MOMENTS[intensity]` (`guided`: objection, pricing, competitor,
  next_step_missing, buying_signal, question, stall; `light`: the first four); a visible card is replaced no sooner
  than 5 s (`light`: 15 s) unless the new one has a higher priority; same (moment, battlecard) deduped for 60 s
  (`light`: 120 s); while the rep speaks (VAD on channel 1) cards wait for a ≥ 600 ms pause (high priority interrupts);
  cards queued longer than 8 s are dropped and surface as a `moment` chip.
- Legacy `aiAnalysis` (`payload.suggested_response = say`, `coaching_tip = detail/then_ask`, `engine:"coach"`,
  `card_id`, `objection_type`, `deal_signal` when health is known) is still sent for every completed (non-provisional)
  card, with `latency: {"card_ms": n, "tier": 2}`.

### `moment` (chip without a card)
```json
{"type":"moment","moment":"competitor","entity":"Zoho","turn_index":7}
```
`moment ∈ objection | pricing | competitor | buying_signal | next_step_missing | stall | question`. `entity` is the
competitor name, the objection type, `"brush_off"`, or `"escalation"` (`stall` + `escalation` = the rep offered a
discount or used fear/FOMO pressure right after an objection). `next_step_missing` is also raised at 25 min and
every 10 min after while no dated next step exists.

### `metrics` (every 10 s, and `final: true` at the end)
```json
{"type":"metrics","metrics":{"elapsed_s":612.0,"rep_talk_s":300.5,"prospect_talk_s":210.0,"talk_ratio_rep":0.589,
 "longest_monologue_rep_s":95.0,"longest_monologue_prospect_s":40.2,"questions_rep":9,"questions_prospect":4,
 "interruptions_rep":1,"interruptions_prospect":0,"avg_rep_response_latency_s":0.9,"silence_gaps_over_10s":0,
 "since_last_prospect_turn_s":3.1,"estimated":false},
 "nudges":[{"kind":"monologue","text":"You've been talking for 2:31. Hand it back with a question."}]}
```
Hide the numbers live; show only `nudges` (kinds `monologue`, `talk_ratio`, `no_questions`, `silence`; each at most
once per 2 min). `estimated: true` for mixed audio (speaker inference).

### `deal_record` (on change; live checklist) and `deal_health` (on change; debrief / developer view)
```json
{"type":"deal_record","record":{"methodology":"meddpicc","fields":[{"field":"metrics","label":"Metrics","value":"saves ~6 hours a week","evidence_quote":"…","speaker":"prospect","confidence":0.7,"confirmed":null,"turn_index":5}],
 "objections":[{"type":"price","quote":"…","handled":false,"how":null,"battlecard_id":"obj-price-expensive","turn_index":7}],
 "buying_signals":[{"quote":"when can we start?","why":"Buying signal","turn_index":9}],"risks":[],"next_step":{"text":"Demo","date":"2026-11-20"},"stage":"pricing"}}
{"type":"deal_health","score":46,"rationale":["2 of 8 MEDDPICC fields covered.","A dated next step is agreed.","1 objection(s) still open."],"coverage":{"metrics":true,"economic_buyer":false}}
```

### `notice`
`{"type":"notice","code":"degraded"|"slow"|"intensity"|"coach_unavailable"|"rep_stt_unavailable","text":"…","intensity":"light"}`.
`degraded`: more than `CLOZFLOW_COACH_MAX_CARDS_PER_MIN` cards a minute (intensity lowered one step), the
`CLOZFLOW_SESSION_MAX_MINUTES` cap (→ on-demand), or the model too slow six cards in a row (Tier 0/1 only).
`slow`: three slow cards in a row (cards shortened to one sentence).

### `session_saved` (extended) and `pong`
```json
{"type":"session_saved","call_id":123,"meeting_id":"m-1","debrief":"scheduled"}
```
`debrief` is `scheduled` when the session belongs to a Wizard meeting (the `session_saved` hook ran), else `none`.
Navigate to the debrief when `meeting_id` is set.

### Bridge events socket (`/api/copilot/bridge/calls/{id}/events`)
Same `strip`, `moment`, `coach`, `aiAnalysis`, `metrics`, `deal_record`, `deal_health`, `notice` messages; `transcriptUpdate`
keeps the v1 shape (`salesperson` = inbound track = channel 1, `prospect` = outbound = channel 2 in the stored
transcript). Reconnect replay: `callStatus`, last 200 transcript lines, latest `aiAnalysis`, then the latest `coach`,
`deal_record`, `deal_health`, `metrics`, `strip`.

## 5. What is stored

`call_logs.transcript` entries: `{speaker, text, timestamp, channel, t_start, t_end}` (system lines for consent and
markers). `call_logs.ai_suggestions` entries: `{"payload": <legacy aiAnalysis>, "card": CoachCard, "feedback": "up|down|used|null",
"pinned": true?, "timestamp", "turn_index"}`. When `models_wizard.py` adds the columns they are filled at save time:
`meeting_id, title, prospect_name, platform, channel (tab_audio|mic|phone_bridge), engine (coach|legacy|brain),
duration_seconds, started_at, ended_at, metrics (Metrics + cost, latency, moments, nudges, markers, consent), deal_record`.
After every save `hooks.session_saved(meeting_id, call_log_id, user_id)` runs.

## 6. Engines, STT and environment

- `CLOZFLOW_COPILOT_ENGINE=coach` (default) | `legacy` | `brain`. The coach LLM is Gemini (`GEMINI_API_KEY`,
  `CLOZFLOW_COACH_MODEL`, default `gemini-2.5-flash-lite`, thinking off, JSON schema, streamed) else Groq
  (`GROQ_API_KEY`, `CLOZFLOW_COACH_GROQ_MODEL`, default `openai/gpt-oss-120b`, JSON mode). No key: transcript,
  strip, chips and Tier 0 cards still work; `what_to_say`/`ask` answer with `notice{code:"coach_unavailable"}`.
  LLM timeout 6 s; on any failure nothing is emitted (never a fallback card).
- `CLOZFLOW_STT=auto|deepgram|gemini|sarvam` (`auto`: Deepgram → Gemini → Sarvam by key). Deepgram: Flux
  `flux-general-en` (rep) / `flux-general-multi` (prospect, mixed) with `eot_threshold`, `eager_eot_threshold`,
  `eot_timeout_ms`, keyterms (brief `keyterms` or product/prospect/company/competitor names, ≤ 50), KeepAlive every
  5 s, backoff reconnect; falls back to `nova-3` (`interim_results`, `endpointing=300`, `utterance_end_ms=1000`) when
  Flux isn't enabled for the key. Sarvam: `saaras:v3-realtime`, `codemix`. Gemini: today's live-transcribe adapter.
  `stt_router.describe()` feeds `/api/wizard/preflight`.
- Grounding: capsule facts (verbatim) + top-3 chunks from the repo's FAISS corpus when retrievable within 300 ms.
  Numbers, prices and absolute feature claims that no fact row backs are removed from the card.
- Bridged calls: `COPILOT_BRIDGE_DISCLOSURE=off|on|gate` plays a spoken disclosure to the prospect after they answer
  (Vobiz `Dial confirmSound` → `GET/POST /api/copilot/bridge/vobiz/confirm?bid&t` returns `<Speak>` lines;
  `gate` adds `confirmKey="1"`, whose enforcement Vobiz documents as unverified). When it plays, the consent record
  becomes `bridge_disclosure` automatically (system transcript line) and audio is opened on `DialConnected` or after
  6 s so the prompt isn't transcribed. `COPILOT_BRIDGE_DISCLOSURE_TEXT` overrides the English + Hinglish default.
  Default `off`: the rep announces (consent `announced`). A meeting can opt out with `wizard.bridge_disclosure=false`.
- Latency: `card.latency_ms` is trigger → emitted (Tier 0 from the partial, Tier 2 from end of turn, on-demand from
  the request). `aiAnalysis.latency` on the legacy engine now carries real values (`total_response_latency`, `llm_ms`,
  `stt_ms`, `turn_to_result_ms`, …). Per-session P50/P95 are logged at the end (numbers only) and stored in
  `metrics.latency`.
