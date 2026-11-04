# Local implementation and validation

Updated 2026-11-04 after the main-interface environment refresh. Target: this Windows PC, finalized transcripts from the main
ClozFlow app, and Gemini text reasoning. Application services and storage are
local; Gemini requests require internet access. Speech belongs to the main app.

## Implemented local features

| Area | Behavior |
|---|---|
| Reasoning | Compact single-request guidance or all nine ordered turn engines; reflection on closure |
| Context | Product, buyer, call goal, CRM and organization context; active-session updates |
| Knowledge | Tenant-specific persistent imports, chunks, provenance, lexical retrieval and retirement of replaced chunks |
| Memory | Typed persistent records, tenant/session scoping, decay, reflection and feedback consolidation |
| Governance | Confidence, verbatim supporting quotes, numeric claims, blocked phrases, length and model-call/time budgets |
| Understanding | Seven world views with available evidence references and explicit unknowns |
| Audit/recovery | Journal before processing, engine graph/outcomes, pending-event recovery, replay protection and stale-event rejection |
| Learning | Human-reported helpfulness/use, feedback Brier score, versioned policy proposals and approval/rejection |
| Workflow | Proposed → approved → done/dismissed follow-up checklist |
| Sessions | Persistent state, session picker, serialized idempotent resume, explicit closure and failed-reflection retry |
| Main app | Local sign-in, authenticated HTTP gateway and transcript sockets, ownership checks and reconnect continuity |
| Data | Encrypted Brain payloads, Windows DPAPI-protected key, export, tenant erasure and closed-session retention |
| Operations | Hidden local stack, readiness checks, process ownership verification and backed-up installation |

## Validation evidence

- Final offline result: **93 tests passed**. Ruff passed, Pyright reported zero
  errors, and the final frontend production build passed.

- The regression suite covers the pipeline, JWT authorization, provider failures,
  deadlines, encryption/tampering, feedback merge, policies, retention isolation,
  concurrent resume and reflection retry. JWT dependencies are installed.
- The real main backend and frontend start together. Browser checks exercised
  local sign-in, session creation/resume, restored transcripts, generated guidance
  and feedback.
- Seven real socket checks passed: unauthenticated rejection, cross-user context
  rejection, cross-user socket rejection, salesperson recording, same-session
  reconnect, retained turn count and explicit closure. Buyer reasoning and
  reflection completed using Gemini.
- Earlier HTTP integration: all four turns completed. Compact price, knowledge
  lookup and unapproved-discount refusal took 2.85, 4.09 and 3.67 seconds. Full
  nine-engine analysis took 22.53 seconds. Main frontend production build passed.
- After the user's main `.env` replacement, restored local Brain routing and a
  missing local sign-in secret while preserving provider credentials. Verified
  the new Gemini credential and synchronized it into the Brain configuration.
  Groq credentials/model availability passed; actual legacy inference also ran.
- Latest live HTTP check: **3/4 turns completed**. Compact price, knowledge and
  discount answers completed in 7.44, 2.57 and 2.80 seconds. Full analysis degraded
  after a Gemini prediction-stage timeout (40.27 seconds total). One explicit
  recheck also degraded, this time at understanding (59.65 seconds total).
  These failures remain recorded; detailed mode is not currently reliable.
  Fast guidance is the working default, and transcripts remain saved on failure.
- Latest socket check: **7/7 passed**, buyer reasoning and reflection complete.
  Offline regression: **93/93 passed**, Ruff clean, Pyright zero errors. Main
  isolated evaluation tests: **16/16 passed**. Frontend build and `pip check` passed.
- Installed missing original-RAG and local VAD dependencies, and corrected
  Sarvam's WebSocket header/state compatibility. Gemini Live and Sarvam
  connections succeeded; Silero VAD initialized and produced no speech events
  for silence. These are readiness checks, not end-to-end voice-call tests.
- Paired transcript check: original **7/12 (58.3%)**, Brain **12/12 (100%)** on
  predeclared targeted criteria. One original answer is borderline (a looser
  score is 8/12). This does not establish general accuracy or sales lift; see
  [transcript-comparison.md](transcript-comparison.md) for outputs and limits.
- These are synthetic functional smoke checks, not a measured reliability,
accuracy or sales-performance benchmark. Earlier failed/withheld turns helped
  identify stricter schema prompting and diagnostics requirements.

## Operating limits and broader specification

The local functional implementation does not constitute the entire aspirational
ten-volume CCBS production specification. External CRM/calendar/catalog
subscriptions, distributed deployment, model-weight training, human-labelled
sales accuracy, sub-1.5-second P95, load/chaos/long-duration trials and production
release signoff remain separate work. The seven views project observed state;
they are not independently trained domain models. Feedback metrics measure user
reports, not causal sales lift or factual accuracy. Task approval updates a local
checklist and does not send messages or change external CRM records.

Use one Brain process with SQLite. Local loopback mode trusts local processes and
must not be publicly proxied; the main gateway authenticates browser users.
Thread deadlines discard late results but cannot kill Python threads. Provider
timeouts bound network waits. Replay protection covers the latest 4,096 events
per World Model; journal and state commits are separate, so this is not an
unlimited distributed exactly-once guarantee. Expired journal entries are retained
without replaying stale recommendations.

Gemini may fail or exhaust free-tier quota. The transcript remains saved and the
response is `degraded` or `withheld`; the system does not fabricate a substitute.
Failed reflection is visible and retryable. Generated guidance still needs human
review.

Encryption covers active Brain JSON payloads. Identifiers/index columns, the
main app's database, legacy archives and pre-migration backups are outside that
claim. Preserve `data/keys/runtime.key` and the Windows account that can decrypt
it. Retention defaults to disabled; existing user data was not purged.

See [local-integration.md](local-integration.md) for commands and report locations.
