# CCBS Engine Specification — Understanding Cognitive Subsystem

**Document ID:** CCBS-ENGINE-02
**Engine ID:** `understanding.concrete`
**Engine Type:** `UNDERSTANDING`
**CCBS Authority:** Volume I §4.5 (CPL-2), Volume IV §1.6 (CDC Phase II)
**Classification:** Semantic Comprehension Subsystem
**Status:** Enterprise Architecture Specification v1.0

---

## 1. Purpose

The Understanding Engine is the semantic cortex of the ClozFlow Cognitive Brain. Its cognitive mission is to transform raw observations produced by Perception into structured meaning — extracting intent, sentiment, urgency, topics, and the buyer's key concern from what was said.

**What intelligence it contributes:**
- Transforms literal speech into semantic meaning ("We'll think about it" → intent=DELAY_DECISION, sentiment=SKEPTICAL)
- Identifies the buyer's key concern — the single most important thing blocking the deal right now
- Tracks topic evolution across the conversation, detecting shifts in what is being discussed
- Generates the foundational CRM beliefs (BUYER_INTENT, BUYER_SENTIMENT, BUYER_KEY_CONCERN) that all downstream engines consume

**Why the Brain cannot function without it:**
Understanding bridges the gap between raw perception and cognitive reasoning. Without it, the Interpretation Engine has no semantics to analyze for hidden objections. The Prediction Engine has no buyer intent to base forecasts on. The Recommendation Engine has no sentiment awareness to calibrate its tone. Understanding is the first engine that touches the LLM, making it the point where statistical patterns become structured cognitive beliefs.

---

## 2. Cognitive Objective

**Primary Objective:**
Extract multi-dimensional semantic meaning from buyer and salesperson speech, producing structured, confidence-scored beliefs that update the World Model's CRM Beliefs layer.

**Secondary Objectives:**
- Detect conversation phase transitions (OPENING → DISCOVERY → DEMO → OBJECTION → NEGOTIATION → CLOSING → FOLLOW_UP)
- Track topic evolution and detect when new topics are introduced vs. old topics revisited
- Identify the speaker's emotional state beyond simple positive/negative classification (6-level sentiment model: VERY_POSITIVE, POSITIVE, NEUTRAL, SKEPTICAL, NEGATIVE, HOSTILE)
- Determine urgency level to help downstream engines prioritize responses

**Optimization Goals:**
- Maximize semantic extraction accuracy while staying within the LLM latency budget (< 300ms)
- Minimize LLM token usage through efficient prompt construction (context window limiting)
- Achieve high inter-cycle consistency — the same buyer statement should produce similar semantic output across runs

**Cognitive Guarantees:**
- Every execution cycle produces at least one belief mutation (even if only updating phase)
- Sentiment, intent, and urgency classifications use closed vocabularies (no free-text categories)
- The `key_concern` is always a specific, actionable statement (not a vague category)
- No recommendations or actions are produced — Understanding produces only meaning (CCBS Law 270)

---

## 3. Internal Philosophy

**How this engine reasons:**
Understanding reasons through semantic extraction — it takes unstructured natural language and maps it onto a structured cognitive ontology. It asks: "What is the speaker trying to accomplish?" (intent), "How does the speaker feel?" (sentiment), "How urgent is this?" (urgency), "What specific topic are they discussing?" (topics), and "What is the single biggest concern blocking progress?" (key_concern).

**Its mental model:**
Understanding models each utterance as a multi-dimensional signal carrying intent, emotion, urgency, and topical information simultaneously. A single sentence can carry a PRICE intent (they're discussing pricing), SKEPTICAL sentiment (they have doubts), HIGH urgency (they need to decide soon), and a key concern of "ROI hasn't been demonstrated for their specific use case."

**What it optimizes:**
Semantic precision. Understanding optimizes for extracting the most precise, actionable meaning from the conversation — not the most text, but the most useful structured knowledge. A vague understanding ("the buyer seems concerned") is worse than a precise one ("the buyer is concerned about data migration complexity from their legacy Oracle system").

**What uncertainty means inside this engine:**
Uncertainty means the LLM was unable to confidently extract a particular semantic dimension. This manifests as lower confidence scores on specific beliefs. For example, if the buyer says something ambiguous like "interesting," the intent confidence might be 0.4 while the sentiment confidence is 0.7. Understanding propagates this uncertainty faithfully rather than guessing.

---

## 4. Internal Architecture

```
                    ┌───────────────────────────────────────────┐
                    │        UNDERSTANDING SUBSYSTEM            │
                    │                                           │
                    │  ┌──────────────┐                        │
    Context ───────►│  │Context Window│                        │
    Window          │  │  Assembler   │                        │
                    │  └──────┬───────┘                        │
                    │         │                                 │
                    │         ▼                                 │
                    │  ┌──────────────┐   ┌──────────────┐    │
                    │  │   Prompt     │──►│   LLM Call   │    │
                    │  │ Constructor  │   │  Orchestrator│    │
                    │  └──────────────┘   └──────┬───────┘    │
                    │                            │             │
                    │                            ▼             │
                    │  ┌─────────────────────────────────┐    │
                    │  │   Schema Validator              │    │
                    │  │  (BuyerSemantics Pydantic)      │    │
                    │  └──────────────┬──────────────────┘    │
                    │                 │                        │
                    │       ┌─────────┼──────────┐           │
                    │       ▼         ▼          ▼           │
                    │  ┌────────┐ ┌────────┐ ┌────────┐     │
                    │  │ Intent │ │Sentim. │ │ Topic  │     │
                    │  │Analyzer│ │Analyzer│ │Tracker │     │
                    │  └───┬────┘ └───┬────┘ └───┬────┘     │
                    │      │          │          │           │
                    │      ▼          ▼          ▼           │
                    │  ┌─────────────────────────────────┐   │
                    │  │    Phase Transition Detector    │   │
                    │  └──────────────┬──────────────────┘   │
                    │                 │                       │
                    │                 ▼                       │
                    │  ┌─────────────────────────────────┐   │
                    │  │    Concern Prioritizer          │   │
                    │  └──────────────┬──────────────────┘   │
                    │                 │                       │
                    │                 ▼                       │
                    │  ┌─────────────────────────────────┐   │
                    │  │   Confidence Calibrator         │   │
                    │  └──────────────┬──────────────────┘   │
                    │                 │                       │
                    │                 ▼                       │
                    │  ┌─────────────────────────────────┐   │
                    │  │   Belief Mutation Builder       │   │
                    │  └──────────────┬──────────────────┘   │
                    │                 │                       │
                    │                 ▼                       │
                    │  ┌─────────────────────────────────┐   │
                    │  │   Understanding Repository     │   │
                    │  └─────────────────────────────────┘   │
                    └───────────────────────────────────────────┘
```

### Component Descriptions

1. **Context Window Assembler** — Extracts the last N utterances from `world_model.context_window` and `cognitive_context.fragments` to build the conversation history the LLM will analyze. Applies windowing (default: 8 utterances) to stay within token budgets.
2. **Prompt Constructor** — Builds the complete LLM prompt by combining: system prompt (engine identity), conversation context, current phase, and extraction instructions. Optimizes for token efficiency by truncating older context.
3. **LLM Call Orchestrator** — Manages the structured output LLM call via `generate_structured_output()`. Handles retries, timeout enforcement, and fallback to lower-temperature calls on parse failures.
4. **Schema Validator** — Validates the LLM's structured output against the `BuyerSemantics` Pydantic schema. Catches schema violations and applies defaults for missing fields.
5. **Intent Analyzer** — Post-processes the extracted `primary_intent` to ensure it belongs to the closed vocabulary (INFORMATION_SEEKING, PRICE_PROBING, OBJECTION_RAISING, etc.). Maps free-text intents to the nearest canonical intent.
6. **Sentiment Analyzer** — Validates and post-processes the 6-level sentiment classification. Applies temporal smoothing: sentiment shouldn't jump from VERY_POSITIVE to HOSTILE in one utterance without strong evidence.
7. **Topic Tracker** — Compares extracted topics against the session's topic history. Detects new topics (never seen before), returning topics (discussed earlier, now revisited), and abandoned topics (discussed but not revisited for N turns).
8. **Phase Transition Detector** — Analyzes the combination of intent, topics, and conversation turn count to detect phase transitions. Uses a state machine with transition rules (e.g., if intent=PRICE_PROBING and current_phase=DEMO → suggest transition to NEGOTIATION).
9. **Concern Prioritizer** — Takes the LLM's `key_concern` output and validates it is specific and actionable. Compares against previous cycle's key concern to detect concern shifts.
10. **Confidence Calibrator** — Adjusts raw LLM confidence scores based on contextual factors: conversation length (more context = higher confidence), signal quality from Perception, consistency with previous cycle's output.
11. **Belief Mutation Builder** — Translates all extracted semantics into `WorldModelMutation` payloads: UPSERT_BELIEF for BUYER_INTENT, BUYER_SENTIMENT, BUYER_KEY_CONCERN, BUYER_URGENCY; UPDATE_PHASE for phase transitions.
12. **Understanding Repository** — Stores the history of semantic extractions for the current session. Used by the Topic Tracker, Sentiment Analyzer (temporal smoothing), and Confidence Calibrator (consistency checking).

---

## 5. Internal Managers

| Manager | Responsibility |
|---|---|
| **Context Assembly Manager** | Controls how much conversation history is included in the LLM prompt. Dynamically adjusts window size based on available token budget and conversation complexity. |
| **Prompt Optimization Manager** | Tracks prompt token usage across cycles and optimizes prompt templates. Monitors which prompt sections produce the highest-quality outputs and adjusts emphasis. |
| **LLM Interaction Manager** | Manages all LLM communication: request construction, timeout enforcement, retry logic, error classification (rate limit vs. parse error vs. model error), and provider failover. |
| **Schema Enforcement Manager** | Ensures all LLM outputs conform to the `BuyerSemantics` schema. Applies corrections for common LLM failures (e.g., confidence outside 0-1 range, unknown intent categories). |
| **Semantic Consistency Manager** | Tracks semantic output across cycles to detect inconsistencies. Flags when intent flips dramatically between cycles without corresponding conversation evidence. |
| **Phase Transition Manager** | Owns the phase detection state machine. Maintains transition rules, prevents invalid transitions (e.g., jumping from OPENING to CLOSING), and requires minimum evidence for each transition. |
| **Topic Evolution Manager** | Maintains the topic history graph for the session. Tracks topic introduction, recurrence, and abandonment patterns. |
| **Temporal Smoothing Manager** | Applies exponential weighted moving average (EWMA) to sentiment scores to prevent jarring oscillations. Configurable smoothing factor (default: α=0.3). |
| **Confidence Propagation Manager** | Propagates confidence from the Understanding layer to downstream belief mutations. Applies calibration curves based on historical accuracy metrics. |
| **Fallback Manager** | When LLM calls fail, generates minimal semantic output from rule-based heuristics (keyword matching for intent, lexicon-based sentiment). Quality is lower but availability is maintained. |
| **Budget Manager** | Tracks LLM token consumption per session and per cycle. Alerts when approaching session token budgets and triggers context window reduction. |
| **Telemetry Manager** | Emits understanding-specific metrics: LLM latency, token usage, schema validation failures, phase transitions, sentiment stability. |

---

## 6. Internal Repositories

| Repository | Contents | Retention |
|---|---|---|
| **Semantic History Repository** | All `BuyerSemantics` extractions for the current session, indexed by cycle_id | Session-scoped |
| **Topic Graph Repository** | Directed graph of topics: nodes=topics, edges=transitions between topics | Session-scoped |
| **Phase History Repository** | Ordered list of phase transitions with timestamps and evidence | Session-scoped |
| **Sentiment Timeline Repository** | Time-series of sentiment scores, both raw and smoothed | Session-scoped |
| **Intent Pattern Repository** | History of buyer intents with frequency counts | Session-scoped |
| **Concern Stack Repository** | Prioritized stack of buyer concerns, most recent on top | Session-scoped |
| **Prompt Template Repository** | LLM prompt templates, system prompts, and optimization history | Global, hot-reloadable |
| **Vocabulary Registry** | Closed vocabularies for intent, sentiment, urgency, and phase | Global |
| **Calibration Model Repository** | Confidence calibration curves learned from historical accuracy | Global |
| **LLM Interaction Log Repository** | Recent LLM call logs: latency, tokens used, success/failure | Session-scoped, last 20 calls |
| **Fallback Rules Repository** | Keyword-to-intent and lexicon-to-sentiment rule tables for fallback mode | Global |

---

## 7. Internal Data Structures

| Structure | Description |
|---|---|
| `BuyerSemantics` | Primary LLM output schema: `{primary_intent, intent_confidence, topics[], sentiment, urgency_level, key_concern, concern_confidence, confidence}` |
| `SemanticExtraction` | Complete understanding cycle result: `{cycle_id, buyer_semantics, phase_transition, topic_delta, raw_llm_response, latency_ms}` |
| `TopicNode` | Topic graph node: `{topic_name, first_seen_cycle, last_seen_cycle, mention_count, status[ACTIVE|ABANDONED|REVISITED]}` |
| `TopicTransition` | Topic graph edge: `{from_topic, to_topic, transition_cycle, transition_type[NATURAL|ABRUPT|RETURN]}` |
| `PhaseTransition` | Phase change record: `{from_phase, to_phase, trigger_evidence, confidence, cycle_id, timestamp}` |
| `SentimentDataPoint` | Sentiment time-series entry: `{cycle_id, raw_sentiment, smoothed_sentiment, delta, timestamp}` |
| `IntentHistoryEntry` | Intent tracking: `{intent, cycle_id, confidence, consecutive_count}` |
| `ConcernEntry` | Concern stack entry: `{concern_text, first_detected_cycle, last_confirmed_cycle, confidence, addressed}` |
| `PromptContext` | Assembled LLM context: `{system_prompt, conversation_window, current_phase, instruction_text, estimated_tokens}` |
| `LLMCallRecord` | LLM interaction log: `{call_id, prompt_tokens, completion_tokens, latency_ms, success, error_type, retry_count}` |
| `FallbackResult` | Rule-based fallback output: `{intent, sentiment, confidence, source="RULE_BASED", coverage}` |
| `CalibrationPoint` | Confidence calibration: `{raw_confidence, calibrated_confidence, evidence_density, context_length}` |
| `ConsistencyCheck` | Cross-cycle consistency: `{dimension, previous_value, current_value, delta, flagged}` |
| `PhaseMachineState` | Phase state machine: `{current_phase, valid_transitions[], minimum_evidence_count, turns_in_phase}` |
| `SemanticDelta` | Difference between two consecutive semantic extractions: `{intent_changed, sentiment_changed, concern_changed, new_topics[], dropped_topics[]}` |

---

## 8. Cognitive Pipeline

Understanding executes a **nine-stage semantic extraction pipeline**:

```
Stage 1: Context Assembly
    │  Context Window Assembler reads world_model.context_window
    │  Budget Manager checks token budget
    │  Window size dynamically adjusted
    ▼
Stage 2: Prompt Construction
    │  System prompt loaded from Prompt Template Repository
    │  Conversation window + phase + instructions assembled
    │  Token count estimated
    ▼
Stage 3: LLM Extraction
    │  LLM Call Orchestrator sends structured output request
    │  Timeout enforced (max 300ms)
    │  On failure → Fallback Manager generates rule-based output
    ▼
Stage 4: Schema Validation
    │  LLM output validated against BuyerSemantics schema
    │  Out-of-vocabulary values mapped to nearest canonical value
    │  Confidence clamped to [0.0, 1.0]
    ▼
Stage 5: Semantic Post-Processing
    │  Intent Analyzer: validate against closed vocabulary
    │  Sentiment Analyzer: apply temporal smoothing (EWMA)
    │  Topic Tracker: detect new/returning/abandoned topics
    ▼
Stage 6: Phase Transition Detection
    │  Phase Transition Detector evaluates transition rules
    │  If transition detected: generate UPDATE_PHASE mutation
    │  Minimum evidence check enforced
    ▼
Stage 7: Concern Prioritization
    │  Concern Prioritizer validates key_concern specificity
    │  Compare against previous concern for shift detection
    │  Update Concern Stack Repository
    ▼
Stage 8: Confidence Calibration
    │  Raw LLM confidence adjusted by context length, signal quality
    │  Consistency check against previous cycle
    │  Calibrated confidence applied to all beliefs
    ▼
Stage 9: Belief Mutation Building
    │  Generate UPSERT_BELIEF mutations for:
    │    BUYER_INTENT, BUYER_SENTIMENT, BUYER_KEY_CONCERN, BUYER_URGENCY
    │  Generate UPDATE_PHASE if transition detected
    │  Package into EngineExecutionOutput
    ▼
Output: EngineExecutionOutput
```

---

## 9. Internal State Machine

```
    ┌──────────┐
    │   IDLE   │◄────────────────────┐
    └────┬─────┘                     │
         │ receive(events)           │
         ▼                           │
    ┌──────────┐                     │
    │ASSEMBLING│ (context)           │
    └────┬─────┘                     │
         │ context ready             │
         ▼                           │
    ┌──────────┐                     │
    │PROMPTING │                     │
    └────┬─────┘                     │
         │ prompt constructed        │
         ▼                           │
    ┌──────────┐                     │
    │EXTRACTING│ (LLM call)          │
    └────┬─────┘                     │
         │ response received         │
         ▼                           │
    ┌──────────┐                     │
    │VALIDATING│                     │
    └────┬─────┘                     │
         │ schema valid              │
         ▼                           │
    ┌──────────┐                     │
    │ANALYZING │ (post-processing)   │
    └────┬─────┘                     │
         │ analysis complete         │
         ▼                           │
    ┌──────────┐                     │
    │CALIBRATING│(confidence)        │
    └────┬─────┘                     │
         │ calibrated                │
         ▼                           │
    ┌──────────┐                     │
    │COMPOSING │ (mutations)         │
    └────┬─────┘                     │
         │ complete                  │
         ▼                           │
    ┌──────────┐                     │
    │COMPLETED │─────────────────────┘
    └──────────┘
         │ LLM failure
         ▼
    ┌──────────┐
    │FALLBACK  │──► (rule-based extraction)
    └──────────┘
```

---

## 10. Algorithms

### 10.1 Temporal Sentiment Smoothing (EWMA)
Raw sentiment scores oscillate due to utterance-level noise. The Temporal Smoothing Manager applies exponential weighted moving average:
`smoothed[t] = α * raw[t] + (1-α) * smoothed[t-1]`
Where α=0.3 (configurable). This prevents sentiment from jumping from POSITIVE to HOSTILE based on a single sarcastic remark, requiring sustained evidence for dramatic shifts.

### 10.2 Phase Transition Detection
The Phase Transition Detector uses a rule-based state machine with evidence thresholds:
- OPENING → DISCOVERY: buyer asks first substantive question OR salesperson asks first discovery question (min 2 turns)
- DISCOVERY → DEMO: salesperson begins showing product features (detected via topic shift to feature-specific language)
- Any → OBJECTION: interpretation engine detects active objection with confidence > 0.6
- OBJECTION → NEGOTIATION: buyer discusses pricing terms, contract conditions (detected via PRICE_PROBING intent)
- NEGOTIATION → CLOSING: buyer expresses positive commitment language (detected via COMMITMENT intent)

### 10.3 Topic Graph Construction
Topics are modeled as a directed graph. When new topics are extracted, the Topic Tracker:
1. Checks each topic against existing TopicNodes
2. If new: creates a new TopicNode with status=ACTIVE
3. If returning (seen before, gap > 3 cycles): updates status=REVISITED, creates TopicTransition edge
4. Topics not mentioned for > 10 cycles: status=ABANDONED

### 10.4 Concern Shift Detection
The Concern Prioritizer compares the current key_concern against the top of the Concern Stack:
- If semantically similar (>0.7 cosine similarity using embedding): confirm concern, increase confidence
- If different: push new concern to stack top, mark previous as "potentially addressed"
- Similarity is approximated using token overlap ratio when embedding service is unavailable

### 10.5 Confidence Calibration Curve
Raw LLM confidence is systematically over-confident. The Calibration Manager applies a logistic correction:
`calibrated = sigmoid(a * raw + b)` where a=2.5 and b=-1.5 (learned from historical accuracy data). This compresses the 0.7-1.0 raw range into a more discriminating 0.5-0.95 calibrated range.

### 10.6 Intent Vocabulary Mapping
When the LLM produces a free-text intent not in the closed vocabulary, the Intent Analyzer maps it to the nearest canonical intent using token overlap scoring against the vocabulary descriptions. Example: LLM output "BUDGET_CONCERN" → mapped to "PRICE_PROBING" (highest overlap with description).

---

## 11. Confidence Architecture

**Confidence Creation:**
Understanding generates confidence at two levels: (1) per-dimension confidence (intent_confidence, concern_confidence from the LLM), and (2) overall extraction confidence (the holistic confidence the LLM assigns to the entire extraction).

**Confidence Propagation:**
Per-dimension confidences are propagated directly to the corresponding beliefs. BUYER_INTENT belief gets intent_confidence. BUYER_KEY_CONCERN belief gets concern_confidence. The overall confidence is used for the reasoning_trace and the output's top-level confidence field.

**Confidence Decay:**
Understanding beliefs have a decay_rate of 0.05 per cycle. If no new evidence refreshes a belief, its confidence decreases over time. This implements "freshness" — old intent readings become less reliable.

**Confidence Fusion:**
When the LLM extraction agrees with the previous cycle's extraction (same intent, same sentiment), confidence is boosted: `fused = min(1.0, current * 1.1)`. Consistency increases confidence. When they disagree, the new confidence is penalized: `fused = current * 0.9`.

**Uncertainty Handling:**
When LLM confidence is below 0.4 on any dimension, that dimension is flagged as uncertain. The belief is still emitted but with the low confidence preserved. Downstream engines can choose to weight uncertain beliefs less. If ALL dimensions are below 0.4, the engine falls back to rule-based extraction.

---

## 12. Failure Handling

| Failure Mode | Detection | Recovery Strategy |
|---|---|---|
| LLM timeout | Response not received within 300ms | Fall back to rule-based extraction using keyword matching |
| LLM rate limit | HTTP 429 / rate limit error from provider | Queue request for next cycle, return previous cycle's beliefs with decayed confidence |
| Schema validation failure | Pydantic validation exception | Attempt partial extraction (whatever fields validated successfully), fill missing with defaults |
| Empty context window | No context in world_model or cognitive_context | Return EngineStatus.PARTIAL with minimal beliefs (phase=current, everything else=NEUTRAL/UNKNOWN) |
| Inconsistent LLM output | Semantic Consistency Manager flags dramatic unexplained shift | Apply temporal smoothing, reduce confidence on the shifted dimension |
| Token budget exceeded | Budget Manager detects token count > limit | Reduce context window size and retry with smaller prompt |

---

## 13. Optimization Layer

**Caching:** Previous cycle's BuyerSemantics output is cached. If the current context window is identical to the previous cycle's (no new utterances), the cached result is returned immediately with a slight confidence decay.

**Incremental Computation:** Sentiment smoothing is O(1) per cycle (single EWMA update). Topic tracking is O(k) where k is the number of new topics (typically 1-3). Phase detection is O(1) — state machine lookup.

**Prompt Optimization:** The Prompt Optimization Manager tracks which prompt sections correlate with higher extraction accuracy and allocates more token budget to effective sections.

**Lazy Evaluation:** Phase transition detection is only invoked when intent or topic changes are detected. If both are stable, the phase check is skipped.

---

## 14. Learning Hooks

1. **Accuracy Feedback Loop**: When the Interpretation Engine detects an objection that the Understanding Engine classified as NEUTRAL sentiment, this mismatch is logged. Over time, these mismatches can be used to retrain calibration curves.
2. **Vocabulary Expansion**: New intents frequently produced by the LLM but not in the closed vocabulary can be flagged for human review and potential vocabulary expansion.
3. **Prompt Template Evolution**: A/B testing of prompt templates can be conducted by the Meta Brain, comparing extraction quality across template variants.
4. **Phase Transition Rules**: Misclassified phase transitions (detected post-hoc by the Reflection Engine) can be used to refine transition rules and evidence thresholds.

---

## 15. Governance

**Validation:** All LLM outputs are validated against Pydantic schemas before producing mutations. Out-of-vocabulary values are mapped, not passed through.

**Compliance:** CCBS Law 270: Understanding produces meaning, never recommendations. CCBS Law II: Every belief is supported by traceable evidence (evidence_ids link to source events). CCBS Law III: Low-confidence extractions preserve uncertainty rather than fabricating certainty.

**Audit:** Every LLM call is logged with prompt hash, response hash, latency, and token count. Schema validation failures are logged with the raw LLM output for debugging.

**Explainability:** The reasoning_trace explains: what intent was detected, what sentiment was assessed, whether a phase transition occurred, and what the key concern is.

---

## 16. Observability

| Metric | Type | Description |
|---|---|---|
| `understanding.llm_latency_ms` | Histogram | LLM call latency per cycle |
| `understanding.llm_tokens_prompt` | Counter | Prompt tokens consumed |
| `understanding.llm_tokens_completion` | Counter | Completion tokens consumed |
| `understanding.schema_validation_failures` | Counter | LLM outputs that failed schema validation |
| `understanding.fallback_activations` | Counter | Times rule-based fallback was used |
| `understanding.phase_transitions` | Counter | Phase transitions detected |
| `understanding.sentiment_stability` | Gauge | Rolling sentiment stability score (lower = more volatile) |
| `understanding.intent_consistency` | Gauge | Percentage of cycles where intent matches previous cycle |
| `understanding.concern_shifts` | Counter | Key concern changes detected |
| `understanding.confidence_mean` | Gauge | Mean confidence across all belief dimensions |

---

## 17. Extension Framework

**Plugin Interfaces:**
- `SemanticExtractor` — Alternative extraction models (e.g., fine-tuned classifiers instead of LLM)
- `PhaseDetector` — Custom phase detection algorithms for industry-specific sales methodologies (MEDDIC, SPIN, Challenger)
- `SentimentModel` — Custom sentiment models (e.g., domain-specific fine-tuned models)

**Strategy Interfaces:**
- `ConfidenceCalibrationStrategy` — Alternative calibration curves for different LLM providers
- `FallbackStrategy` — Alternative fallback approaches (e.g., embedding-based instead of keyword-based)

---

## 18. Performance Targets

| Metric | Target | Rationale |
|---|---|---|
| End-to-end cycle latency | < 300ms | CCBS §7.2: Understanding budget |
| LLM call latency | < 250ms | Leaves 50ms for pre/post-processing |
| Token usage per cycle | < 800 tokens | Gemini free-tier conservation |
| Fallback latency | < 20ms | Rule-based extraction is near-instant |
| Memory per session | < 1MB | Semantic history + topic graph |
| Confidence calibration accuracy | > 80% | Calibrated confidence should match actual accuracy within 20% |

---

## 19. Testing

### Unit Tests
- Context Window Assembler: correct windowing, token budget enforcement
- Schema Validator: all BuyerSemantics fields validated, out-of-vocabulary mapping
- Sentiment Smoother: EWMA calculation correctness, smoothing factor impact
- Phase Transition Detector: all valid transitions tested, invalid transitions rejected
- Topic Tracker: new topic detection, returning topic detection, abandonment detection
- Confidence Calibrator: calibration curve application, consistency bonus/penalty

### Integration Tests
- Full pipeline with mock LLM: verify correct mutations generated for known inputs
- Fallback mode: LLM timeout → rule-based extraction → valid output
- Multi-cycle consistency: same conversation segment processed twice → consistent output

### Behavior Tests
- Given "That's too expensive" → intent=PRICE_PROBING, sentiment=NEGATIVE, key_concern contains "price" or "cost"
- Given 5 consecutive NEUTRAL utterances → sentiment smoothing maintains NEUTRAL (no oscillation)
- Given transition from feature discussion to price discussion → phase transition to NEGOTIATION

### Cognitive Correctness Tests
- Understanding never produces recommendations, goals, or objections — only beliefs
- Every belief has evidence_ids populated
- Confidence is always within [0.0, 1.0]

---

## 20. Complete Cognitive Walkthrough

**Scenario:** Buyer says: *"We're evaluating three vendors right now, and honestly, your pricing seems a bit high compared to what we've seen."* Current phase: DISCOVERY. Turn count: 12. Previous sentiment: NEUTRAL.

**Stage 1 — Context Assembly:**
Context Window Assembler reads last 8 utterances from `world_model.context_window`:
```
SALESPERSON: Let me show you how our platform handles data migration...
BUYER: That sounds interesting, but can you tell me about pricing?
SALESPERSON: Sure, our enterprise plan starts at $50,000 per year...
BUYER: We're evaluating three vendors right now, and honestly, your pricing seems a bit high compared to what we've seen.
```
Token estimate: ~180 tokens. Within budget.

**Stage 2 — Prompt Construction:**
System prompt: "You are the Understanding Engine of ClozFlow Cognitive Brain..."
User prompt includes phase (DISCOVERY), context window, and BuyerSemantics extraction instructions.

**Stage 3 — LLM Extraction:**
LLM returns structured output:
```json
{
  "primary_intent": "PRICE_PROBING",
  "intent_confidence": 0.92,
  "topics": ["pricing", "competitor evaluation", "vendor comparison"],
  "sentiment": "SKEPTICAL",
  "urgency_level": "MEDIUM",
  "key_concern": "Buyer perceives pricing as higher than competitors without seeing sufficient differentiation to justify the premium",
  "concern_confidence": 0.88,
  "confidence": 0.90
}
```
Latency: 187ms.

**Stage 4 — Schema Validation:**
All fields valid. PRICE_PROBING ∈ closed vocabulary ✓. SKEPTICAL ∈ sentiment vocabulary ✓. Confidence values within [0,1] ✓.

**Stage 5 — Semantic Post-Processing:**
- **Intent Analyzer:** PRICE_PROBING confirmed (canonical)
- **Sentiment Analyzer:** Previous=NEUTRAL, Raw=SKEPTICAL. EWMA: smoothed = 0.3*SKEPTICAL + 0.7*NEUTRAL → weighted toward SKEPTICAL (first strong signal). Output: SKEPTICAL.
- **Topic Tracker:** "pricing" — REVISITED (discussed in turn 10). "competitor evaluation" — NEW. "vendor comparison" — NEW.

**Stage 6 — Phase Transition Detection:**
Intent=PRICE_PROBING + topics include "competitor evaluation". Rule: DISCOVERY + PRICE_PROBING → candidate transition to NEGOTIATION. Evidence check: only 1 price-related utterance (minimum 2 required). **No transition yet.** Flagged as "pending transition — one more price utterance triggers NEGOTIATION."

**Stage 7 — Concern Prioritization:**
New key_concern: "pricing perceived as higher than competitors." Previous concern: "integration complexity" (from cycle 10). Concern shift detected. New concern pushed to stack top.

**Stage 8 — Confidence Calibration:**
Raw confidence: 0.90. Calibration: sigmoid(2.5*0.90 - 1.5) = sigmoid(0.75) ≈ 0.679. Context length factor: 12 turns → 1.05 boost. Calibrated: 0.71. Consistency penalty (intent changed from INFORMATION_SEEKING): *0.95. Final: 0.68.

**Stage 9 — Belief Mutation Building:**
4 mutations generated:
1. `UPSERT_BELIEF(BUYER_INTENT, value="PRICE_PROBING", confidence=0.68)`
2. `UPSERT_BELIEF(BUYER_SENTIMENT, value="SKEPTICAL", confidence=0.68)`
3. `UPSERT_BELIEF(BUYER_KEY_CONCERN, value="Buyer perceives pricing as higher than competitors...", confidence=0.68)`
4. `UPSERT_BELIEF(BUYER_URGENCY, value="MEDIUM", confidence=0.68)`

**Output:**
```
EngineExecutionOutput(
    engine_id="understanding.concrete",
    confidence=0.68,
    reasoning_trace="Buyer intent: PRICE_PROBING. Sentiment: SKEPTICAL (shifted from NEUTRAL). Key concern: pricing vs. competitors. Phase: DISCOVERY (pending transition to NEGOTIATION).",
    duration_ms=195,
    status=EngineStatus.SUCCESS
)
```

---

*End of CCBS Engine Specification — Understanding Cognitive Subsystem*
