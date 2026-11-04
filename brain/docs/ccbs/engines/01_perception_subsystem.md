# CCBS Engine Specification — Perception Cognitive Subsystem

**Document ID:** CCBS-ENGINE-01
**Engine ID:** `perception.concrete`
**Engine Type:** `PERCEPTION`
**CCBS Authority:** Volume I §4.4 (CPL-1), Volume IV §1.5 (CDC Phase I)
**Classification:** Foundational Sensory Subsystem
**Status:** Enterprise Architecture Specification v1.0

---

## 1. Purpose

The Perception Engine is the sensory cortex of the ClozFlow Cognitive Brain. Its cognitive mission is to transform raw, unstructured signals from the external world — live transcripts, audio features, CRM webhooks, calendar events, silence intervals — into structured, timestamped, confidence-scored observations that the rest of the cognitive pipeline can reason about.

**What intelligence it contributes:**
- Converts analog reality (speech, pauses, tone) into discrete cognitive events
- Assigns initial confidence and provenance to every observation
- Detects signal anomalies (e.g., sudden silence, speech rate spikes, speaker overlaps) that downstream engines cannot perceive
- Maintains temporal ordering and causal chains across all input modalities

**Why the Brain cannot function without it:**
Without Perception, no other engine has access to reality. The Understanding Engine cannot comprehend what was said. The Interpretation Engine cannot detect why it was said. The Prediction Engine cannot forecast what happens next. Perception is CCBS Law 269's prerequisite: every recommendation originates from a Cognitive Decision Cycle, and every cycle begins with Perception. Remove Perception, and the Brain is blind.

---

## 2. Cognitive Objective

**Primary Objective:**
Acquire, normalize, and structure all external observations into the Canonical Cognitive Reality (Volume III) with sub-100ms latency, preserving temporal fidelity and assigning initial confidence scores.

**Secondary Objectives:**
- Detect signal-level anomalies (silence, fast-talking, speaker overlap, audio degradation) before semantic processing
- Maintain a temporally ordered observation stream across heterogeneous input sources
- Enrich observations with audio-prosodic features when available (pitch, energy, pause duration)
- Provide early-warning signals to downstream engines through belief mutations (SPEAKER_TEMPO, CONVERSATION_FLOW)

**Optimization Goals:**
- Minimize observation-to-mutation latency (target: < 50ms for transcript segments)
- Maximize observation fidelity — never drop, duplicate, or reorder events
- Achieve zero-loss under burst conditions (multiple speakers, rapid-fire dialogue)

**Cognitive Guarantees:**
- Every external event entering the Brain passes through Perception exactly once
- Every observation receives a confidence score ≥ 0.0
- Temporal ordering is preserved within a session
- No semantic interpretation occurs — Perception captures facts without meaning (CCBS Volume IV §1.5)

---

## 3. Internal Philosophy

**How this engine reasons:**
Perception does not "reason" in the cognitive sense. It operates as a deterministic sensory transducer — faithfully converting external signals into internal representations without applying judgment, interpretation, or inference. This is a deliberate architectural choice mandated by CCBS Law 270: "Perception, interpretation and decision shall remain distinct cognitive activities."

**Its mental model:**
Perception models the external world as a stream of timestamped signal packets. Each packet has a type (transcript, silence, speaker change, CRM update), a payload, a source, and a confidence. The engine's internal world is purely temporal — it understands only "what happened" and "when," never "why" or "what it means."

**What it optimizes:**
Signal fidelity and temporal precision. The engine optimizes for the highest-fidelity capture of external reality, trading nothing for speed except where the signal itself is ambiguous (partial transcripts, noisy audio).

**What uncertainty means inside this engine:**
Uncertainty in Perception is signal-level: Was the transcript finalized? Is the audio quality sufficient? Was the speaker correctly identified? Perception represents this uncertainty through the `confidence` field on every observation. A partial transcript receives lower confidence than a finalized one. A speaker ID from a reliable diarization model receives higher confidence than an UNKNOWN speaker.

---

## 4. Internal Architecture

The Perception Engine internally decomposes into the following collaborating components:

```
                    ┌─────────────────────────────────────────┐
                    │         PERCEPTION SUBSYSTEM            │
                    │                                         │
                    │  ┌──────────────┐   ┌──────────────┐   │
    External ──────►│  │ Signal Gate  │──►│ Signal Router│   │
    Events          │  └──────────────┘   └──────┬───────┘   │
                    │                            │            │
                    │        ┌───────────────────┼────────┐  │
                    │        ▼                   ▼        ▼  │
                    │  ┌──────────┐  ┌──────────┐ ┌──────┐  │
                    │  │Transcript│  │  Audio   │ │ CRM  │  │
                    │  │Processor │  │ Feature  │ │Event │  │
                    │  │          │  │ Extractor│ │Parser│  │
                    │  └────┬─────┘  └────┬─────┘ └──┬───┘  │
                    │       │             │          │       │
                    │       ▼             ▼          ▼       │
                    │  ┌─────────────────────────────────┐   │
                    │  │     Observation Normalizer      │   │
                    │  └──────────────┬──────────────────┘   │
                    │                 │                       │
                    │                 ▼                       │
                    │  ┌─────────────────────────────────┐   │
                    │  │     Anomaly Detector            │   │
                    │  └──────────────┬──────────────────┘   │
                    │                 │                       │
                    │                 ▼                       │
                    │  ┌─────────────────────────────────┐   │
                    │  │  Confidence Initializer         │   │
                    │  └──────────────┬──────────────────┘   │
                    │                 │                       │
                    │                 ▼                       │
                    │  ┌─────────────────────────────────┐   │
                    │  │    Temporal Sequencer           │   │
                    │  └──────────────┬──────────────────┘   │
                    │                 │                       │
                    │                 ▼                       │
                    │  ┌─────────────────────────────────┐   │
                    │  │    Mutation Composer            │   │
                    │  └──────────────┬──────────────────┘   │
                    │                 │                       │
                    │                 ▼                       │
                    │  ┌─────────────────────────────────┐   │
                    │  │    Observation Repository       │   │
                    │  └─────────────────────────────────┘   │
                    └─────────────────────────────────────────┘
```

### Component Descriptions

1. **Signal Gate** — Entry validator. Rejects malformed events, enforces event type whitelisting, applies rate limiting under burst conditions.
2. **Signal Router** — Dispatches events to type-specific processors based on `EventType`. Routes TRANSCRIPT_SEGMENT, SILENCE_DETECTED, SPEAKER_CHANGE, CRM_FIELD_UPDATED, and CALENDAR_EVENT to their respective handlers.
3. **Transcript Processor** — Extracts `TranscriptPayload`, formats `SPEAKER_ROLE: text` context lines, handles partial vs. finalized transcripts.
4. **Audio Feature Extractor** — Extracts prosodic features (speech rate, pitch, energy, pause duration) from `AudioFeatures` when present. Generates SPEAKER_TEMPO beliefs for abnormal rates.
5. **CRM Event Parser** — Parses CRM field updates and calendar events into structured observation objects.
6. **Observation Normalizer** — Standardizes all observations into a uniform internal representation regardless of source type. Applies Unicode normalization, whitespace trimming, speaker label standardization.
7. **Anomaly Detector** — Detects signal-level anomalies: extended silence (>3s), rapid speech (>180 WPM), speaker overlap, abrupt topic discontinuity, audio quality degradation. Generates anomaly belief mutations.
8. **Confidence Initializer** — Assigns initial confidence scores based on signal quality. Finalized transcripts receive 0.95+, partial transcripts receive 0.6-0.8, CRM updates receive 1.0 (authoritative data), inferred speaker roles receive 0.7.
9. **Temporal Sequencer** — Orders all observations by `timestamp_utc` and `sequence_num`. Detects and corrects out-of-order events within a configurable reorder window (default: 500ms).
10. **Mutation Composer** — Translates processed observations into `WorldModelMutation` payloads (APPEND_CONTEXT, UPSERT_BELIEF). Packages all mutations for the Cognitive Kernel.
11. **Observation Repository** — In-memory sliding window of recent observations, keyed by session. Used for reorder detection, deduplication, and providing the `context_window` to downstream engines.

---

## 5. Internal Managers

| Manager | Responsibility |
|---|---|
| **Signal Intake Manager** | Controls the flow of external events into the engine. Implements backpressure when processing capacity is exceeded. Drops lowest-priority events first (CALENDAR_EVENT before TRANSCRIPT_SEGMENT). |
| **Modality Manager** | Tracks which input modalities are active for the current session (audio, text-only, CRM-enriched). Adapts processing pipelines accordingly — if no audio features are available, the Audio Feature Extractor is bypassed. |
| **Sequence Manager** | Maintains the global sequence counter per session. Detects gaps (missing sequence numbers), duplicates (same sequence number seen twice), and reorders (sequence N+1 arriving before N). |
| **Quality Manager** | Continuously assesses signal quality across all active modalities. Tracks metrics like transcript finalization rate, audio feature availability, speaker identification accuracy. Degrades confidence scores when quality drops. |
| **Anomaly Manager** | Owns the anomaly detection lifecycle. Maintains thresholds (silence > 3000ms, speech rate > 180 WPM), tracks anomaly history within a session, suppresses duplicate anomaly reports within a configurable cooldown window. |
| **Rate Limit Manager** | Prevents burst conditions from overwhelming downstream engines. Implements token-bucket rate limiting per session. When rate is exceeded, events are queued rather than dropped, with a configurable queue depth. |
| **Normalization Manager** | Ensures all text observations are normalized before leaving the engine. Handles encoding issues, Unicode normalization (NFC), whitespace standardization, and speaker label canonicalization. |
| **Lifecycle Manager** | Tracks the engine's internal state machine transitions. Manages initialization, warm-up, steady-state, cooldown, and shutdown phases. Ensures clean state between sessions. |
| **Deduplication Manager** | Maintains a sliding window of recent event fingerprints (hash of event_id + payload). Detects and silently drops duplicate events that may arrive from redundant input channels. |
| **Telemetry Manager** | Emits internal performance metrics: events processed per second, average processing latency, anomaly detection rate, deduplication hit rate, sequence gap count. |
| **Recovery Manager** | Handles partial failures (e.g., CRM parser exception) without failing the entire perception cycle. Isolates failed modality processors and continues with available data. |
| **Resource Manager** | Monitors memory usage of the Observation Repository sliding window. Evicts oldest observations when memory threshold is exceeded. |

---

## 6. Internal Repositories

| Repository | Contents | Retention |
|---|---|---|
| **Observation Repository** | All structured observations from the current session, keyed by sequence number | Session-scoped, sliding window of last 200 observations |
| **Anomaly Repository** | Detected signal anomalies with timestamps, types, and severity | Session-scoped, full session history |
| **Sequence Repository** | Global sequence counter, gap tracking, reorder log | Session-scoped |
| **Signal Quality Repository** | Per-modality quality metrics over time (rolling 30-second windows) | Session-scoped |
| **Deduplication Repository** | Bloom filter + LRU cache of recent event fingerprints | Session-scoped, 500-entry LRU |
| **Modality Registry** | Active modalities for current session and their configuration | Session-scoped |
| **Normalization Rules Repository** | Text normalization rules, speaker label mappings, encoding correction tables | Global, loaded at boot |
| **Anomaly Threshold Repository** | Configurable thresholds for all anomaly types | Global, hot-reloadable |
| **Rate Limit State Repository** | Token bucket state per session | Session-scoped |
| **Telemetry Buffer Repository** | Buffered metrics awaiting emission | Flushed every 5 seconds |
| **Recovery Log Repository** | Records of partial failures and recovery actions taken | Session-scoped |

---

## 7. Internal Data Structures

| Structure | Description |
|---|---|
| `RawSignalPacket` | Incoming event before any processing: `{event_id, event_type, payload, timestamp_utc, sequence_num, source, confidence}` |
| `StructuredObservation` | Post-normalization observation: `{observation_id, modality, speaker, text, audio_features, confidence, timestamp_utc, sequence_num, is_final}` |
| `AnomalyReport` | Detected anomaly: `{anomaly_id, anomaly_type, severity, evidence_event_ids, timestamp_utc, cooldown_until}` |
| `SequenceState` | Per-session sequence tracking: `{session_id, expected_next, gaps[], reorder_count, last_seen_timestamp}` |
| `ModalityProfile` | Active modality description: `{modality_type, is_active, quality_score, last_signal_timestamp, config}` |
| `QualitySnapshot` | Point-in-time quality assessment: `{timestamp, transcript_finalization_rate, audio_availability, speaker_id_accuracy, overall_quality}` |
| `NormalizedTextBlock` | Cleaned text with metadata: `{original_text, normalized_text, encoding_corrections[], speaker_label, language}` |
| `DeduplicationEntry` | Fingerprint entry: `{event_fingerprint, first_seen_timestamp, occurrence_count}` |
| `RateLimitBucket` | Token bucket: `{session_id, tokens_remaining, max_tokens, refill_rate_per_second, last_refill_timestamp}` |
| `ContextAppendPayload` | Ready-to-emit context mutation: `{text, caused_by_event_id}` |
| `BeliefMutationPayload` | Ready-to-emit belief mutation: `{belief_type, subject, value, confidence, evidence_ids}` |
| `PerceptionCycleResult` | Complete cycle output: `{mutations[], observations_processed, anomalies_detected, duration_ms, quality_snapshot}` |
| `SignalRouteDecision` | Router output: `{event_id, target_processor, priority, estimated_processing_ms}` |
| `RecoveryAction` | Recovery log entry: `{failed_component, error_type, action_taken, events_affected, timestamp}` |
| `TemporalWindow` | Reorder buffer: `{window_start_ms, window_end_ms, buffered_events[], flush_threshold}` |

---

## 8. Cognitive Pipeline

Perception executes a **seven-stage deterministic pipeline** for every incoming event batch:

```
Stage 1: Signal Ingestion
    │  Signal Gate validates, Rate Limit Manager checks capacity
    │  Deduplication Manager filters duplicates
    ▼
Stage 2: Signal Routing
    │  Signal Router dispatches to modality-specific processors
    │  Modality Manager confirms active modalities
    ▼
Stage 3: Modality Processing
    │  Transcript Processor extracts text + speaker
    │  Audio Feature Extractor extracts prosodic signals
    │  CRM Event Parser structures external data
    ▼
Stage 4: Observation Normalization
    │  Unicode normalization, whitespace standardization
    │  Speaker label canonicalization
    │  Encoding correction
    ▼
Stage 5: Anomaly Detection
    │  Silence detection (>3000ms gap)
    │  Speech rate anomaly (>180 WPM or <60 WPM)
    │  Speaker overlap detection
    │  Audio quality degradation
    │  Cooldown filtering (suppress duplicate anomalies)
    ▼
Stage 6: Confidence Initialization & Temporal Sequencing
    │  Assign initial confidence based on signal quality
    │  Verify temporal ordering via Sequence Manager
    │  Reorder within buffer window if necessary
    ▼
Stage 7: Mutation Composition
    │  Generate APPEND_CONTEXT mutations for transcript text
    │  Generate UPSERT_BELIEF mutations for anomalies
    │  Package into EngineExecutionOutput
    ▼
Output: EngineExecutionOutput
```

No stage applies semantic interpretation. The pipeline is purely structural.

---

## 9. Internal State Machine

```
                    ┌──────────┐
                    │   IDLE   │◄────────────────────┐
                    └────┬─────┘                     │
                         │ receive(events)           │
                         ▼                           │
                    ┌──────────┐                     │
                    │INGESTING │                     │
                    └────┬─────┘                     │
                         │ validated                 │
                         ▼                           │
                    ┌──────────┐                     │
                    │ ROUTING  │                     │
                    └────┬─────┘                     │
                         │ dispatched                │
                         ▼                           │
                    ┌──────────┐                     │
                    │PROCESSING│                     │
                    └────┬─────┘                     │
                         │ normalized                │
                         ▼                           │
                    ┌──────────┐                     │
                    │DETECTING │ (anomalies)         │
                    └────┬─────┘                     │
                         │ scored                    │
                         ▼                           │
                    ┌──────────┐                     │
                    │COMPOSING │ (mutations)         │
                    └────┬─────┘                     │
                         │ complete                  │
                         ▼                           │
                    ┌──────────┐                     │
                    │COMPLETED │─────────────────────┘
                    └──────────┘
                         │ error at any stage
                         ▼
                    ┌──────────┐
                    │RECOVERING│──► (retry or degrade)
                    └──────────┘
```

**State Definitions:**
- **IDLE**: No events pending. Engine awaits next execution cycle.
- **INGESTING**: Validating incoming events, checking rate limits, filtering duplicates.
- **ROUTING**: Dispatching events to modality-specific processors.
- **PROCESSING**: Active modality processing (transcript extraction, audio feature extraction, CRM parsing).
- **DETECTING**: Running anomaly detection algorithms across processed observations.
- **COMPOSING**: Building WorldModelMutation payloads from processed observations and detected anomalies.
- **COMPLETED**: Cycle finished successfully. Output ready for Kernel.
- **RECOVERING**: A partial failure occurred. Recovery Manager isolates the failure and continues with available data.

---

## 10. Algorithms

### 10.1 Temporal Reordering Algorithm
Events from different sources (transcript stream, CRM webhooks) may arrive out of temporal order. The Temporal Sequencer maintains a 500ms reorder buffer. Events are buffered until either: (a) the buffer window expires, or (b) all expected sequence numbers within the window are received. Events are then flushed in strict `sequence_num` order.

### 10.2 Anomaly Detection — Silence
The engine maintains a `last_observation_timestamp` per session. When a new observation arrives, the gap `(current_timestamp - last_timestamp)` is computed. If the gap exceeds the configurable silence threshold (default: 3000ms), a SILENCE_DETECTED anomaly is generated with confidence proportional to the gap duration (3s = 0.7, 5s = 0.85, 10s+ = 0.95).

### 10.3 Anomaly Detection — Speech Rate
When `AudioFeatures.speech_rate_wpm` is present, the engine classifies speech rate: < 60 WPM = VERY_SLOW (possible hesitation), 60-120 = NORMAL, 120-180 = ELEVATED, > 180 = FAST (possible excitement/urgency). Beliefs are generated only for non-NORMAL rates. Cooldown: one report per speaker per 30 seconds.

### 10.4 Deduplication — Fingerprint Hashing
Each event is fingerprinted using `SHA-256(event_type + speaker_id + text[:100] + start_ms)`. The fingerprint is checked against a 500-entry LRU cache. Collisions trigger silent event dropping with a telemetry counter increment.

### 10.5 Confidence Initialization Scoring
Confidence is assigned based on a decision tree:
- `is_final == True` AND `audio_features present` → 0.95
- `is_final == True` AND `no audio_features` → 0.90
- `is_final == False` (partial transcript) → 0.65
- CRM/Calendar events (authoritative data) → 1.0
- Unknown speaker role → confidence *= 0.85 penalty

### 10.6 Quality Assessment — Rolling Window
Signal quality is assessed over 30-second rolling windows. Quality dimensions: transcript finalization rate (what % of transcripts are `is_final=True`), audio feature availability rate, speaker identification rate. The composite quality score is a weighted average: `0.5 * finalization + 0.3 * audio + 0.2 * speaker_id`.

---

## 11. Confidence Architecture

**Confidence Creation:**
Perception is the birthplace of confidence in the entire Brain. Every observation receives an initial confidence score from the Confidence Initializer. This score represents signal-level certainty: "How confident are we that this observation accurately represents what happened in reality?"

**Confidence Propagation:**
Perception's confidence scores propagate downstream through the World Model's `context_window` and belief mutations. The Understanding Engine receives these initial scores and may adjust them based on semantic analysis. The chain is: Perception (signal confidence) → Understanding (semantic confidence) → Interpretation (causal confidence).

**Confidence Decay:**
Within the Perception subsystem, confidence does not decay. Observations are point-in-time facts. However, the Quality Manager tracks signal quality over time, and if quality degrades (e.g., audio dropout), new observations receive lower initial confidence.

**Confidence Fusion:**
When multiple modalities provide overlapping information (e.g., transcript text + audio features both suggest the speaker is excited), the Confidence Initializer applies a fusion formula: `fused_confidence = 1 - (1 - conf_text) * (1 - conf_audio)`. This yields higher confidence when multiple independent signals agree.

**Uncertainty Handling:**
Perception never fabricates certainty. If the speaker role is UNKNOWN, the confidence is penalized. If the transcript is partial, the confidence reflects that. This directly implements CCBS Law III: "Uncertainty Before Certainty."

---

## 12. Failure Handling

| Failure Mode | Detection | Recovery Strategy | Degradation |
|---|---|---|---|
| Malformed event payload | Signal Gate validation exception | Drop event, log error, increment telemetry counter | Zero — one bad event doesn't affect others |
| Transcript parser exception | try/except in Transcript Processor | Skip the specific event, continue processing remaining events | Minimal — one observation lost |
| Audio feature extraction failure | Missing or invalid AudioFeatures | Process transcript text normally, skip audio enrichment | Graceful — text-only mode |
| CRM parser exception | try/except in CRM Event Parser | Skip CRM event, log warning | Minimal — CRM context delayed |
| Sequence gap detected | Sequence Manager gap detection | Wait up to 500ms in reorder buffer, then proceed with gap | Note gap in telemetry, downstream engines operate with incomplete data |
| Rate limit exceeded | Token bucket empty | Queue events (up to 100), then drop lowest-priority events (CALENDAR_EVENT first) | Graceful — highest-priority events (TRANSCRIPT_SEGMENT) always pass |
| Out of memory (observation repository) | Resource Manager threshold check | Evict oldest 25% of observations from sliding window | Graceful — older context lost but current processing continues |
| Complete engine timeout | Deadline check from `EngineExecutionInput.timeout_ms` | Return `EngineStatus.TIMEOUT` with whatever mutations have been composed so far | Partial — some observations may be unprocessed |

---

## 13. Optimization Layer

**Caching:**
- Speaker label resolution is cached per session (first speaker identified as BUYER stays BUYER without re-evaluation)
- Normalization rules (Unicode tables, encoding corrections) are loaded once at engine initialization

**Incremental Computation:**
- Quality snapshots are computed incrementally (running averages) rather than recomputed over the full window each cycle
- Sequence tracking is O(1) — just compare against `expected_next`

**Memoization:**
- Deduplication fingerprints are memoized in the LRU cache to avoid recomputing hashes for recently-seen events

**Lazy Evaluation:**
- Audio Feature Extraction is only invoked when `AudioFeatures` is present in the event payload. No computation occurs for text-only sessions
- CRM Event Parser is only invoked when CRM event types are in the input batch

**Dependency Pruning:**
- If no SILENCE_DETECTED events are in the input and no temporal gap exceeds 1000ms, the Anomaly Detector's silence detection path is short-circuited

---

## 14. Learning Hooks

Perception itself does not learn (it is a stateless sensory transducer), but it provides critical learning hooks for other subsystems:

1. **Signal Quality Feedback Loop**: The Evaluation Engine can report back that certain observations led to poor downstream analysis. This feedback can be used to adjust anomaly detection thresholds over time.
2. **Speaker Identification Refinement**: The Reflection Engine's long-term memory can store verified speaker identities. On session start, the Memory Service provides known speaker labels, improving Perception's initial speaker role assignment.
3. **Anomaly Threshold Tuning**: Over many sessions, the Meta Brain can observe which anomaly thresholds produce actionable vs. noisy alerts and adjust them in the Anomaly Threshold Repository.
4. **Normalization Rule Updates**: New text normalization rules (e.g., handling new languages, accents, or domain-specific jargon) can be added to the Normalization Rules Repository without engine code changes.

---

## 15. Governance

**Validation:**
- Every incoming event is validated against the `EVENT_TYPE_REGISTRY` and `PAYLOAD_MODELS` before processing (enforced by `CognitiveEvent.validate_against_registry`)
- Every outgoing mutation is validated against `WorldModelMutation` schema

**Compliance:**
- CCBS Law 270 compliance: Perception never interprets, reasons, or decides — it only observes
- CCBS Law 274 compliance: All outputs flow through the Canonical Cognitive Reality (World Model mutations)
- No PII is logged at DEBUG level; transcript text is only written to context_window mutations

**Audit:**
- Every dropped event (deduplication, rate limiting, validation failure) is logged with event_id and reason
- Every anomaly detection is logged with evidence and threshold
- All telemetry is session-scoped and traceable

**Traceability:**
- Every mutation includes `caused_by_event_id` linking it back to the source event
- The Observation Repository preserves the full processing chain: raw event → structured observation → mutation

**Explainability:**
- The `reasoning_trace` output explains exactly what Perception did: how many events were processed, how many anomalies were detected, and what modalities were active

---

## 16. Observability

**Metrics:**
| Metric | Type | Description |
|---|---|---|
| `perception.events_processed_total` | Counter | Total events processed per session |
| `perception.events_dropped_total` | Counter | Events dropped (dedup, rate limit, validation) |
| `perception.processing_latency_ms` | Histogram | Per-event processing latency |
| `perception.cycle_duration_ms` | Histogram | End-to-end cycle duration |
| `perception.anomalies_detected_total` | Counter | Anomalies detected, labeled by type |
| `perception.signal_quality_score` | Gauge | Current composite signal quality |
| `perception.dedup_hit_rate` | Gauge | Deduplication cache hit rate |
| `perception.sequence_gaps_total` | Counter | Sequence gaps detected |
| `perception.reorder_count` | Counter | Events reordered within buffer window |
| `perception.observation_repository_size` | Gauge | Current observation repository size |

**Tracing:**
Each perception cycle generates a span with:
- `cycle_id`, `session_id`, `engine_id`
- Events received count
- Processing stages completed
- Anomalies detected
- Mutations emitted count

**Debugging:**
The `reasoning_trace` field in `EngineExecutionOutput` provides a human-readable summary: `"Processed 3 perception signals. 1 anomaly detected (FAST_SPEAKING). Signal quality: 0.91."`

---

## 17. Extension Framework

**Plugin Interfaces:**
- `ModalityProcessor` — New input modalities (e.g., video, screen sharing, chat) can be added by implementing this interface and registering with the Signal Router
- `AnomalyDetector` — New anomaly detection algorithms can be plugged in without modifying the core pipeline
- `ConfidenceStrategy` — Custom confidence initialization strategies for different deployment contexts

**Strategy Interfaces:**
- `NormalizationStrategy` — Alternative text normalization pipelines (e.g., for non-English languages)
- `DeduplicationStrategy` — Alternative fingerprinting algorithms

**Repository Interfaces:**
- All repositories implement a common `Repository[T]` interface with `store()`, `query()`, `evict()`, and `clear()` methods
- Repositories can be swapped between in-memory and persistent implementations

---

## 18. Performance Targets

| Metric | Target | Rationale |
|---|---|---|
| Per-event processing latency | < 10ms | CCBS §7.1: total pipeline must complete in < 700ms; Perception must be fastest |
| Cycle-to-cycle latency | < 50ms | Leave budget for 9 downstream engines |
| Memory per session | < 2MB | Observation repository sliding window + state |
| Burst handling | 100 events/second | Support rapid dialogue and multi-speaker scenarios |
| Recovery time | < 5ms | Partial failure isolation must not block pipeline |
| Deduplication lookup | < 0.1ms | LRU cache with O(1) hash lookup |
| Reorder buffer capacity | 50 events | Sufficient for 500ms reorder window at typical event rates |

---

## 19. Testing

### Unit Tests
- Signal Gate: malformed events rejected, valid events accepted
- Transcript Processor: text extraction, speaker role parsing, partial vs. final handling
- Audio Feature Extractor: speech rate classification, threshold boundaries
- Anomaly Detector: silence detection at various gap durations, cooldown enforcement
- Confidence Initializer: all scoring paths (final, partial, CRM, unknown speaker)
- Deduplication Manager: duplicate detection, LRU eviction, false positive rate

### Integration Tests
- Full pipeline: raw CognitiveEvent → EngineExecutionOutput with correct mutations
- Multi-modality: mixed TRANSCRIPT_SEGMENT + SILENCE_DETECTED + CRM events in single batch
- Temporal ordering: out-of-order events correctly resequenced

### Behavior Tests
- Given a fast-talking speaker (200 WPM), verify SPEAKER_TEMPO belief is generated
- Given a 5-second silence gap, verify CONVERSATION_FLOW belief is generated
- Given duplicate events, verify only one observation is produced

### Failure Tests
- Malformed payload → engine continues with remaining events
- Timeout → partial output returned with EngineStatus.TIMEOUT
- Rate limit exceeded → lowest-priority events dropped, transcripts preserved

### Performance Tests
- Process 100 events in < 500ms
- Memory usage stays under 2MB per session over 1000 events
- Deduplication lookup stays under 0.1ms at 500-entry cache capacity

### Cognitive Correctness Tests
- Perception never produces semantic beliefs (BUYER_INTENT, BUYER_SENTIMENT) — only signal-level beliefs
- Every mutation has `caused_by_event_id` set
- Temporal ordering is preserved in output mutations

### Edge Cases
- Empty event batch → empty output with 0ms duration
- All events are duplicates → empty mutations, telemetry counts duplicates
- Single event that is both partial and has audio features → correct confidence assignment

### Chaos Tests
- Random event payload corruption → engine recovers gracefully
- Burst of 500 events in 100ms → rate limiter engages, no crashes
- Sequence numbers with 50% random gaps → reorder buffer handles gracefully

---

## 20. Complete Cognitive Walkthrough

**Scenario:** A B2B sales call where the buyer says: *"We're evaluating three vendors right now, and honestly, your pricing seems a bit high compared to what we've seen."* The speech is delivered at 195 WPM (fast, indicating possible frustration).

### Step-by-Step Internal Execution

**Input:** `EngineExecutionInput` containing 1 event:
```
CognitiveEvent(
    event_type=TRANSCRIPT_SEGMENT,
    payload={
        text: "We're evaluating three vendors right now, and honestly, your pricing seems a bit high compared to what we've seen.",
        speaker_id: "buyer_01",
        speaker_role: BUYER,
        start_ms: 124500,
        end_ms: 128200,
        is_final: True,
        audio_features: { speech_rate_wpm: 195, energy_db: -18.5, pitch_hz: 220 }
    },
    sequence_num: 47,
    confidence: 0.92
)
```

**Stage 1 — Signal Ingestion:**
- Signal Gate validates event against EVENT_TYPE_REGISTRY ✓
- TranscriptPayload validated against schema ✓
- Rate Limit Manager: 12 tokens remaining in bucket ✓
- Deduplication Manager: fingerprint SHA-256("TRANSCRIPT_SEGMENT|buyer_01|We're evaluating...|124500") = `a7f3...` — not in LRU cache ✓
- Event admitted

**Stage 2 — Signal Routing:**
- Signal Router identifies EventType.TRANSCRIPT_SEGMENT
- Dispatches to Transcript Processor + Audio Feature Extractor

**Stage 3 — Modality Processing:**
- **Transcript Processor:**
  - Extracts: speaker_role=BUYER, text="We're evaluating three vendors..."
  - Formats context line: `"BUYER: We're evaluating three vendors right now, and honestly, your pricing seems a bit high compared to what we've seen."`
  - is_final=True → high confidence path

- **Audio Feature Extractor:**
  - speech_rate_wpm=195 → classified as FAST (>180 threshold)
  - energy_db=-18.5 → normal range
  - pitch_hz=220 → elevated (possible emotional engagement)
  - Generates anomaly candidate: FAST_SPEAKING

**Stage 4 — Observation Normalization:**
- Unicode NFC normalization applied (no changes needed)
- Whitespace standardized
- Speaker label confirmed: BUYER (canonical)
- Output: `StructuredObservation(speaker=BUYER, text="We're evaluating...", confidence=0.95, is_final=True)`

**Stage 5 — Anomaly Detection:**
- Silence check: gap from last observation (seq 46) = 1200ms → below 3000ms threshold → no silence anomaly
- Speech rate: 195 WPM → above 180 threshold → FAST_SPEAKING anomaly generated
- Cooldown check: no FAST_SPEAKING anomaly for buyer_01 in last 30 seconds → anomaly emitted
- Output: `AnomalyReport(type=FAST_SPEAKING, severity=MEDIUM, evidence=[event_47])`

**Stage 6 — Confidence Initialization & Sequencing:**
- Confidence: is_final=True + audio_features present → base 0.95
- Speaker role = BUYER (known) → no penalty
- Multi-modality fusion: text confidence (0.95) + audio confidence (0.90) → fused = 1 - (1-0.95)*(1-0.90) = 0.995 → capped at 0.95
- Sequence: expected_next=47, received=47 → in order ✓

**Stage 7 — Mutation Composition:**
- **Mutation 1:** `APPEND_CONTEXT` → `{text: "BUYER: We're evaluating three vendors right now, and honestly, your pricing seems a bit high compared to what we've seen."}`
- **Mutation 2:** `UPSERT_BELIEF` → `{belief_type: "SPEAKER_TEMPO", subject: "buyer_01", value: "FAST_SPEAKING", confidence: 0.85}`

**Output:**
```text
EngineExecutionOutput(
    engine_id="perception.concrete",
    cycle_id=<uuid>,
    output_events=[],
    wm_mutations=[mutation_1, mutation_2],
    confidence=0.95,
    reasoning_trace="Processed 1 perception signals. 1 anomaly detected (FAST_SPEAKING). Signal quality: 0.95.",
    duration_ms=4,
    status=EngineStatus.SUCCESS,
)
```

**Post-Cycle State:**
- Observation Repository: observation 47 stored
- Sequence Repository: expected_next → 48
- Anomaly Repository: FAST_SPEAKING cooldown active for buyer_01 until T+30s
- Deduplication Cache: fingerprint `a7f3...` stored in LRU
- Quality Snapshot: finalization_rate=1.0, audio_availability=1.0, speaker_id=1.0 → quality=1.0

The two mutations now enter the Cognitive Kernel, which applies them to the World Model before dispatching to the Understanding Engine (CDC Phase II).

---

*End of CCBS Engine Specification — Perception Cognitive Subsystem*
