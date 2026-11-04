# CCBS Engine Specification — Reflection Cognitive Subsystem

**Document ID:** CCBS-ENGINE-10
**Engine ID:** `reflection.concrete`
**Engine Type:** `REFLECTION`
**CCBS Authority:** Volume IV §1.14 (CDC Phase X)
**Classification:** Retrospective Analytics Subsystem
**Status:** Enterprise Architecture Specification v1.0

---

## 1. Purpose

The Reflection Engine is the retrospective cortex of the ClozFlow Cognitive Brain. Its cognitive mission is to answer the question **"Did our actions achieve the desired outcome?"** — analyzing the delta between what the Brain intended to happen (Plan/Decision) and what actually happened (subsequent Perception/Understanding).

**What intelligence it contributes:**
- Measures the actual impact of the Brain's recommendations on the conversation.
- Calculates objective success metrics (e.g., "Did we successfully transition from DEMO to CLOSING?").
- Identifies prediction errors (e.g., "We predicted a price objection, but they objected to implementation time").
- Feeds back calibration data to the World Model, allowing the Brain to adjust its future strategies within the current session.

**Why the Brain cannot function without it:**
Without the Reflection Engine, the Brain operates open-loop; it fires recommendations into the void and hopes for the best, unable to adapt if its strategies fail. CCBS Law VII dictates that the Brain must be a closed-loop system capable of intra-session adaptation. Reflection closes the loop, turning the linear CDC sequence into an iterative learning cycle.

---

## 2. Cognitive Objective

**Primary Objective:**
Calculate the delta between intended outcomes and actual conversational reality, outputting `ReflectionNode` mutations to update historical confidence and strategy momentum in the World Model.

**Secondary Objectives:**
- Score the Brier accuracy of past predictions.
- Evaluate the effectiveness of chosen strategies against the Cognitive Objective Hierarchy retrospectively.
- Detect "strategic drift" where the conversation has fundamentally moved away from the active multi-turn plan.

**Optimization Goals:**
- Accurate attribution (did the plan fail because it was a bad plan, or because the salesperson delivered it poorly?).
- Run asynchronously where possible (Reflection does not need to block the generation of the next recommendation unless a critical strategy failure occurred).

**Cognitive Guarantees:**
- Reflection only occurs after an action has been taken and the environment has responded (or a timeout has occurred).
- Reflection outputs are purely historical and analytical; it does not plan the next move (that is the job of the next cycle).

---

## 3. Internal Philosophy

**How this engine reasons:**
Reflection reasons through comparative analysis. It maintains a memory of "Past States" and compares them to the "Current State" looking specifically at the variables that the "Past Action" was supposed to influence.

**Its mental model:**
The engine acts as an internal post-mortem analyst. Every cognitive cycle is an experiment. Prediction forms the hypothesis. Planning designs the experiment. Decision commits to it. Recommendation executes it. Reflection analyzes the results of the experiment.

**What it optimizes:**
Systemic calibration. It wants to know exactly *why* something succeeded or failed so that the Brain's internal weights (in Evaluation and Prediction) can be adjusted to be more accurate on the next cycle.

**What uncertainty means inside this engine:**
In Reflection, uncertainty often comes from the "Salesperson Execution Gap". If the Brain recommended a brilliant strategy, but the salesperson ignored it or delivered it with terrible tone, the plan will likely fail. Reflection must manage the uncertainty of whether to blame the Brain's logic or the human's execution.

---

## 4. Internal Architecture

```
                    ┌───────────────────────────────────────────┐
                    │        REFLECTION SUBSYSTEM               │
                    │                                           │
                    │  ┌──────────────┐   ┌──────────────┐    │
    World Model ───►│  │ Target State │   │ Actual State │    │
    (Past Plans &   │  │ Extractor    │   │ Extractor    │    │
     New Percepts)  │  └──────┬───────┘   └──────┬───────┘    │
                    │         │                  │             │
                    │         ▼                  ▼             │
                    │  ┌─────────────────────────────────┐    │
                    │  │   Delta Analyzer                │    │
                    │  │  ┌────────┐ ┌────────┐ ┌──────┐ │    │
                    │  │  │Strategy│ │Predict.│ │Phase │ │    │
                    │  │  │Delta   │ │Error   │ │Delta │ │    │
                    │  │  └────────┘ └────────┘ └──────┘ │    │
                    │  └──────────────┬──────────────────┘    │
                    │                 │                        │
                    │                 ▼                        │
                    │  ┌─────────────────────────────────┐    │
                    │  │   Attribution Engine            │    │
                    │  └──────────────┬──────────────────┘    │
                    │                 │                        │
                    │                 ▼                        │
                    │  ┌─────────────────────────────────┐   │
                    │  │   Calibration Scorer            │   │
                    │  └──────────────┬──────────────────┘   │
                    │                 │                       │
                    │                 ▼                       │
                    │  ┌─────────────────────────────────┐   │
                    │  │   Mutation Composer             │   │
                    │  └─────────────────────────────────┘   │
                    └───────────────────────────────────────────┘
```

### Component Descriptions

1. **Target State Extractor** — Looks back in the World Model to find what the Brain *expected* to happen (e.g., the predictions made in cycle N-1, the intended goal of the plan chosen in cycle N-1).
2. **Actual State Extractor** — Looks at the current reality established by Perception and Understanding in cycle N.
3. **Delta Analyzer** — Compares Target vs. Actual across multiple dimensions:
   - **Strategy Delta:** Did the plan achieve its specific objective?
   - **Prediction Error:** Did predicted events happen? Did unpredicted events happen?
   - **Phase Delta:** Did the conversation advance closer to the final objective?
4. **Attribution Engine** — Attempts to determine *why* a delta exists. Did the salesperson ignore the recommendation? Did the buyer introduce a completely orthogonal topic?
5. **Calibration Scorer** — Calculates feedback scores. If a heuristic rule predicted an objection that didn't happen, its reliability score is temporarily lowered for this session.
6. **Mutation Composer** — Packages the insights into a `ReflectionNode` mutation, which often includes updates to the properties of older nodes (e.g., marking a past Prediction as `FAILED`).

---

## 5. Internal Managers

| Manager | Responsibility |
|---|---|
| **Memory Sync Manager** | Ensures that Reflection accurately pairs Action (N-1) with Reaction (N). Handles edge cases where the buyer doesn't respond immediately. |
| **Execution Gap Manager** | Compares the generated `RecommendationNode` with the actual transcript of what the salesperson said to calculate adherence. |
| **Calibration Feedback Loop** | Updates the active session's internal weighting parameters based on recent successes/failures. |

---

## 6. Internal Repositories

| Repository | Contents | Retention |
|---|---|---|
| **Expectation Ledger** | Pending predictions and plan objectives waiting for reality to validate them | Session-scoped |
| **Adherence History** | Record of how often the human salesperson follows the AI's recommendations | Session-scoped |

---

## 7. Internal Data Structures

| Structure | Description |
|---|---|
| `Expectation` | What we thought would happen: `{source_node_id, expected_outcome, horizon}` |
| `DeltaAnalysis` | The difference: `{metric, expected_val, actual_val, variance}` |
| `Attribution` | Why it happened: `{primary_cause (AI_ERROR|HUMAN_ERROR|EXTERNAL_NOISE), confidence}` |
| `CalibrationUpdate` | Adjustments: `{target_engine, parameter, adjustment_val}` |

---

## 8. Cognitive Pipeline

```
Stage 1: State Extraction
    │  Fetch Expectations from Ledger
    │  Fetch current World Model state
    ▼
Stage 2: Delta Analysis
    │  Calculate mathematical and semantic deltas between expected and actual
    ▼
Stage 3: Adherence Check
    │  Did the human actually execute the plan?
    ▼
Stage 4: Attribution
    │  Assign cause to the deltas
    ▼
Stage 5: Calibration Scoring
    │  Generate update values for Prediction/Evaluation weights
    ▼
Stage 6: Mutation Generation
    │  Produce UPSERT_REFLECTION mutation
    ▼
Output: EngineExecutionOutput
```

---

## 9. Internal State Machine

```
    ┌──────────┐
    │   IDLE   │◄────────────────┐
    └────┬─────┘                 │
         │ cycle N starts        │
         ▼                       │
    ┌──────────┐                 │
    │EXTRACTING│                 │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │ ANALYZING│ (Deltas)        │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │ATTRIBUTING│                │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │COMPLETED │─────────────────┘
    └──────────┘
```

---

## 10. Algorithms

### 10.1 Brier Score Update
Updates the rolling Brier score for the Prediction engine based on resolving pending predictions. `New_Score = (Old_Score * N + Current_Error^2) / (N + 1)`.

### 10.2 Adherence Matching (Execution Gap)
Uses a fast embedding similarity search to compare the text of the `RecommendationNode.script` with the transcript of what the salesperson actually said. If similarity < 0.4, adherence is marked as FALSE, and any negative outcomes are primarily attributed to `HUMAN_ERROR` rather than `AI_ERROR`.

---

## 11. Confidence Architecture

**Attribution Confidence:** How sure is the Reflection engine about *why* a plan failed? If the human followed the script perfectly and the buyer still got angry, Attribution Confidence in `AI_ERROR` is high. If the human mumbled something incomprehensible, Attribution Confidence in `AI_ERROR` is low.

---

## 12. Failure Handling

| Failure Mode | Recovery Strategy |
|---|---|
| Unmatched States | If the conversation jumps wildly (e.g., buyer was interrupted by a fire alarm), flush the Expectation Ledger rather than attributing failure. |
| LLM Timeout | Degrade to pure mathematical reflection (did the phase change? did sentiment score drop?) without deep semantic attribution. |

---

## 13. Optimization Layer

**Asynchronous Execution:** Because Reflection's output is not strictly required to generate the *immediate* next plan (it informs the *weights* of the next plan), it can run asynchronously in the background during the early phases (Perception/Understanding) of Cycle N.

---

## 14. Learning Hooks

**Meta Brain Telemetry:** This is the primary data source for the ClozFlow Meta Brain. The Reflection Engine aggregates session-level successes and failures and exports them post-call for global model training and playbook refinement.

---

## 15. Governance

**Compliance:** Ensures continuous improvement and accountability. It prevents the AI from becoming stubbornly attached to a failing strategy by explicitly flagging when expectations are not met.

---

## 16. Observability

| Metric | Type | Description |
|---|---|---|
| `reflection.prediction_accuracy` | Gauge | Rolling Brier score of predictions |
| `reflection.human_adherence` | Gauge | % of recommendations followed by the user |
| `reflection.strategy_success_rate` | Gauge | % of plans that achieved their immediate objective |

---

## 17. Extension Framework

**Plugin Interfaces:** `AttributionAnalyzer` allows custom logic for determining success/failure based on industry-specific goals (e.g., in a support context vs. a sales context).

---

## 18. Performance Targets

| Metric | Target |
|---|---|
| End-to-end cycle latency | < 200ms (Mostly backgrounded) |
| Adherence math latency | < 20ms |

---

## 19. Testing

**Unit Tests:** Delta math, Brier score calculation, Adherence similarity logic.
**Integration Tests:** End-to-end cycle: Plan generated -> Human ignores plan -> Reflection correctly identifies low adherence and attributes failure to the human.

---

## 20. Complete Cognitive Walkthrough

**Scenario:** Cycle N-1 Plan: "Acknowledge price concern, pivot to ROI." Prediction was that sentiment would improve.
**Stage 1 (Cycle N):** Extract Target: Plan=Acknowledge/Pivot, Expected Sentiment=Positive. Extract Actual: Transcript shows salesperson just said "We are expensive but worth it." Actual Sentiment=Negative.
**Stage 2:** Delta Analysis: Strategy Delta = Failed. Prediction Error = High (expected Positive, got Negative).
**Stage 3:** Adherence Check: Similarity between recommended script and actual transcript is 0.2. Adherence = FALSE.
**Stage 4:** Attribution: Strategy failed due to `HUMAN_ERROR` (Salesperson failed to execute the recommended pivot).
**Stage 5:** Calibration Scorer does NOT penalize the Evaluation Engine's choice of strategy, because the strategy wasn't actually tested.
**Stage 6:** Output `ReflectionNode` logging the execution gap.

*End of CCBS Engine Specification — Reflection Cognitive Subsystem*
