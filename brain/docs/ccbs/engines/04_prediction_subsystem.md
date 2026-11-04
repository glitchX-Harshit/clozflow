# CCBS Engine Specification — Prediction Cognitive Subsystem

**Document ID:** CCBS-ENGINE-04
**Engine ID:** `prediction.concrete`
**Engine Type:** `PREDICTION`
**CCBS Authority:** Volume I §5.7 (Reasoning Domain), Volume IV §1.8 (CDC Phase IV)
**Classification:** Probabilistic Forecasting Subsystem
**Status:** Enterprise Architecture Specification v1.0

---

## 1. Purpose

The Prediction Engine is the foresight cortex of the ClozFlow Cognitive Brain. Its cognitive mission is to answer the question **"What is likely to happen next?"** — taking the current reality (Perception), semantics (Understanding), and causal drivers (Interpretation), and forecasting probable future states before they occur.

**What intelligence it contributes:**
- Forecasts probable buyer objections before they are spoken
- Predicts likely emotional shifts based on conversation trajectory
- Anticipates negotiation tactics the buyer may employ
- Estimates the probability of successful phase transitions (e.g., probability of moving from DEMO to CLOSING)
- Anticipates resource needs (e.g., predicting the buyer will ask for a case study)

**Why the Brain cannot function without it:**
CCBS Law IV explicitly states: "Prediction Before Reaction." The Brain must anticipate probable future developments before selecting an action. Without the Prediction Engine, the Brain is purely reactive — responding to objections only after they occur. With Prediction, the Brain becomes proactive, allowing the Planning Engine to preempt objections, adjust tone to prevent emotional degradation, and prepare evidence before it is requested.

---

## 2. Cognitive Objective

**Primary Objective:**
Generate probabilistic forecasts of future buyer actions, emotional states, and conversation trajectories, outputting confidence-scored `PredictionNode` mutations to the World Model.

**Secondary Objectives:**
- Score the likelihood of specific objections occurring in the next N turns
- Predict buyer sentiment trajectory (improving, degrading, stable)
- Anticipate specific questions the buyer is likely to ask
- Assess the risk of the buyer disengaging or stalling the process

**Optimization Goals:**
- Maximize predictive accuracy (calibration: events predicted at 80% confidence should occur 80% of the time)
- Minimize latency by utilizing pre-computed predictive models where possible
- Ensure predictions are actionable — predicting something the salesperson cannot influence is less valuable than predicting an avoidable risk

**Cognitive Guarantees:**
- All predictions are strictly probabilistic (0.0 to 1.0) and explicitly represent uncertainty
- Predictions have a defined temporal horizon (e.g., "next 3 turns", "end of meeting")
- Predictions are continuously updated or invalidated as new evidence emerges
- Predictions never trigger actions directly (CCBS Law 270)

---

## 3. Internal Philosophy

**How this engine reasons:**
Prediction reasons through probabilistic simulation. It extrapolates from the current state (current phase, active objections, sentiment) along established behavioral trajectories. If A and B happened, how often does C happen next?

**Its mental model:**
The conversation is a branching probability tree. The current node is the present state. Future nodes represent possible buyer actions. The Prediction Engine computes the transition probabilities to the most significant near-term nodes. It does not try to predict the exact next word, but rather the next strategic maneuver.

**What it optimizes:**
Foresight accuracy and actionability. A good prediction allows the Planning Engine to change the future. Therefore, predicting *risks* (e.g., risk of a price objection) is prioritized over predicting *inevitabilities*.

**What uncertainty means inside this engine:**
Uncertainty is the core business of this engine. It handles uncertainty by emitting a probability distribution over possible futures. A prediction is never "The buyer will object to price." It is "Probability of PRICE objection in next 5 turns: 75%."

---

## 4. Internal Architecture

```
                    ┌───────────────────────────────────────────┐
                    │        PREDICTION SUBSYSTEM               │
                    │                                           │
                    │  ┌──────────────┐                        │
    World Model ───►│  │ State Extrac-│                        │
    + Context       │  │ tor          │                        │
                    │  └──────┬───────┘                        │
                    │         │                                 │
                    │         ▼                                 │
                    │  ┌──────────────┐   ┌──────────────┐    │
                    │  │Trajectory    │──►│  Predictive  │    │
                    │  │Modeler       │   │  Heuristics  │    │
                    │  └──────┬───────┘   └──────┬───────┘    │
                    │         │                  │             │
                    │         ▼                  ▼             │
                    │  ┌─────────────────────────────────┐    │
                    │  │   LLM Forecast Orchestrator     │    │
                    │  └──────────────┬──────────────────┘    │
                    │                 │                        │
                    │       ┌─────────┼──────────┐           │
                    │       ▼         ▼          ▼           │
                    │  ┌────────┐ ┌────────┐ ┌────────┐     │
                    │  │Objection││Sentiment││Action  │     │
                    │  │Predictor││Predictor││Predictor│     │
                    │  └───┬────┘ └───┬────┘ └───┬────┘     │
                    │      │          │          │           │
                    │      ▼          ▼          ▼           │
                    │  ┌─────────────────────────────────┐   │
                    │  │   Prediction Synthesizer        │   │
                    │  └──────────────┬──────────────────┘   │
                    │                 │                       │
                    │                 ▼                       │
                    │  ┌─────────────────────────────────┐   │
                    │  │   Horizon Tracker               │   │
                    │  └──────────────┬──────────────────┘   │
                    │                 │                       │
                    │                 ▼                       │
                    │  ┌─────────────────────────────────┐   │
                    │  │   Probability Calibrator        │   │
                    │  └──────────────┬──────────────────┘   │
                    │                 │                       │
                    │                 ▼                       │
                    │  ┌─────────────────────────────────┐   │
                    │  │   Mutation Composer             │   │
                    │  └─────────────────────────────────┘   │
                    └───────────────────────────────────────────┘
```

### Component Descriptions

1. **State Extractor** — Pulls the current conversation state: phase, active objections, recent sentiment trend, buyer intent history, and current key concern.
2. **Trajectory Modeler** — Analyzes the sequence of states to determine the trajectory (e.g., sentiment is trending down over the last 3 turns, objections are piling up).
3. **Predictive Heuristics** — Fast, rule-based predictors. E.g., if phase transitions to NEGOTIATION, probability of PRICE objection jumps to 80% automatically. Bypasses LLM for known strong patterns.
4. **LLM Forecast Orchestrator** — Manages calls to the LLM for complex, nuanced predictions that heuristics cannot handle. Asks the LLM to forecast the most likely next objections or questions based on the specific dialogue context.
5. **Objection Predictor** — Focuses specifically on forecasting latent objections that haven't been voiced yet, based on subtle cues or missing information (e.g., ROI wasn't discussed in DEMO → high probability of ROI objection later).
6. **Sentiment Predictor** — Forecasts the emotional trajectory. Will the buyer become frustrated if the current topic continues?
7. **Action Predictor** — Forecasts specific buyer actions (e.g., asking for a discount, requesting a follow-up meeting, disengaging).
8. **Prediction Synthesizer** — Merges heuristic predictions with LLM predictions. Resolves conflicts by weighting the more confident source.
9. **Horizon Tracker** — Attaches a temporal horizon to each prediction (e.g., "immediate" = next turn, "near-term" = next 3-5 turns, "session" = by end of meeting). Expires predictions that outlive their horizon.
10. **Probability Calibrator** — Calibrates raw probabilities using historical accuracy data to ensure realistic confidence scores.
11. **Mutation Composer** — Generates `UPSERT_PREDICTION` mutations for the World Model.

---

## 5. Internal Managers

| Manager | Responsibility |
|---|---|
| **Heuristic Rules Manager** | Maintains the rule base of deterministic predictors (e.g., Phase X → 70% chance of Objection Y). |
| **Forecast Lifecycle Manager** | Tracks predictions over time. Evaluates if they came true, were averted, or expired. |
| **LLM Budget Manager** | Decides when to invoke the LLM for prediction vs. relying solely on heuristics, to save latency/tokens. |
| **Confidence Manager** | Ensures that predicted probabilities reflect reality. Prevents overconfident predictions (e.g., capping max probability at 90% unless certain). |
| **Synthesis Manager** | Merges overlapping predictions from different sub-predictors into a unified forecast. |
| **Validation Manager** | Post-cycle, checks previous predictions against current reality (Understanding/Interpretation outputs) to calculate accuracy. |

---

## 6. Internal Repositories

| Repository | Contents | Retention |
|---|---|---|
| **Active Prediction Repository** | Currently valid predictions awaiting outcome | Session-scoped |
| **Expired/Resolved Prediction Repository** | History of predictions and their actual outcomes | Session-scoped |
| **Heuristic Rulebase** | Static rules mapping states to probable futures | Global |
| **Calibration Model Repository** | Statistical models for adjusting raw probabilities | Global |
| **Trajectory History** | Vector of recent state changes used for trend analysis | Session-scoped |

---

## 7. Internal Data Structures

| Structure | Description |
|---|---|
| `ForecastRequest` | Input to LLM: `{context, active_objections, current_phase, sentiment_trend}` |
| `PredictedEvent` | Core prediction object: `{event_type (OBJECTION|SENTIMENT_SHIFT|ACTION), specific_target, probability, horizon, evidence_ids}` |
| `HeuristicMatch` | Output of rule engine: `{rule_id, predicted_event, base_probability}` |
| `TrajectoryState` | Current momentum: `{sentiment_velocity, objection_density, phase_momentum}` |
| `PredictionEvaluation` | Accuracy tracking: `{predicted_event, actual_outcome, brier_score}` |

---

## 8. Cognitive Pipeline

```
Stage 1: State Extraction & Trajectory Modeling
    │  Extract current World Model state
    │  Calculate momentum (sentiment up/down, objection count)
    ▼
Stage 2: Heuristic Prediction
    │  Match current state against Heuristic Rulebase
    │  Generate fast, rule-based predictions
    ▼
Stage 3: LLM Forecasting (Optional/Conditional)
    │  If situation is complex/ambiguous, invoke LLM
    │  Generate nuanced predictions (specific questions, hidden risks)
    ▼
Stage 4: Synthesis
    │  Merge heuristic and LLM predictions
    │  Deduplicate overlapping predictions
    ▼
Stage 5: Calibration & Horizon Attachment
    │  Adjust probabilities based on calibration curves
    │  Assign temporal horizons (Immediate, Near-term, Session)
    ▼
Stage 6: Mutation Generation
    │  Filter out low-probability predictions (< 20%)
    │  Generate UPSERT_PREDICTION mutations
    ▼
Output: EngineExecutionOutput
```

---

## 9. Internal State Machine

```
    ┌──────────┐
    │   IDLE   │◄────────────────┐
    └────┬─────┘                 │
         │ state changed         │
         ▼                       │
    ┌──────────┐                 │
    │EXTRACTING│                 │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │PREDICTING│ (Heuristics     │
    │          │  + LLM)         │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │SYNTHESIZE│                 │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │CALIBRATE │                 │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │COMPLETED │─────────────────┘
    └──────────┘
```

---

## 10. Algorithms

### 10.1 Trajectory Momentum Calculation
Sentiment momentum is calculated as the derivative of the smoothed sentiment over the last N turns. Positive momentum decreases the baseline probability of hostile actions/objections; negative momentum increases it.

### 10.2 Heuristic Rule Engine
A fast forward-chaining rule engine. Example Rule: `IF Phase==DEMO AND Topic!=SECURITY THEN Predict(SECURITY_OBJECTION, prob=0.6, horizon=SESSION)`.

### 10.3 Prediction Synthesis (Conflict Resolution)
If Heuristics predict P(PRICE_OBJECTION)=0.8 and LLM predicts P(PRICE_OBJECTION)=0.4, the Synthesis Manager applies a weighted average based on the historical reliability of the specific rule vs. the LLM in the current context.

---

## 11. Confidence Architecture

**Probability vs. Confidence:** In Prediction, the primary metric is probability (how likely the event is). Confidence here refers to *calibration confidence* — how sure the engine is about the probability it assigned. A prediction might be: "Event X has a 30% probability, and I am 90% confident in that 30% estimate."

**Probability Decay:** As the conversation progresses without the predicted event occurring, the probability of that event happening in the remaining horizon decays.

---

## 12. Failure Handling

| Failure Mode | Recovery Strategy |
|---|---|
| LLM timeout/failure | Rely entirely on Heuristic Predictions (graceful degradation) |
| Missing State Data | Use default baseline probabilities for the current phase |
| Rule Engine Error | Fallback to LLM-only prediction |

---

## 13. Optimization Layer

**Heuristic First:** The engine always runs heuristics first. If heuristics generate high-probability, high-confidence predictions that cover the immediate risk surface, the LLM call is bypassed entirely to save latency.

---

## 14. Learning Hooks

**Brier Score Tracking:** The Forecast Lifecycle Manager calculates the Brier score (accuracy of probabilistic predictions) after the fact. Over time, the Meta Brain can use this to adjust calibration curves and heuristic rule weights.

---

## 15. Governance

**Compliance:** Adheres to CCBS Law IV (Prediction Before Reaction). Does not generate plans or recommendations.

---

## 16. Observability

| Metric | Type | Description |
|---|---|---|
| `prediction.forecasts_generated` | Counter | Total predictions made |
| `prediction.llm_bypass_rate` | Gauge | % of cycles relying solely on heuristics |
| `prediction.average_probability` | Histogram | Distribution of forecasted probabilities |

---

## 17. Extension Framework

**Plugin Interfaces:** `Predictor` interface allows adding new specialized predictors (e.g., a ChurnPredictor for existing customer interactions).

---

## 18. Performance Targets

| Metric | Target |
|---|---|
| End-to-end cycle latency | < 200ms (LLM) / < 20ms (Heuristic only) |
| Brier Score | < 0.15 (strong calibration) |

---

## 19. Testing

**Unit Tests:** Heuristic rule firing, momentum calculation, synthesis weighting.
**Integration Tests:** Prediction lifecycle (prediction created → event happens → prediction marked resolved).

---

## 20. Complete Cognitive Walkthrough

**Scenario:** Interpretation Engine just flagged a hidden `AUTHORITY` objection in the DEMO phase.

**Stage 1:** State Extractor pulls Phase=DEMO, ActiveObjection=AUTHORITY.
**Stage 2:** Heuristic Predictor fires rule: `IF ActiveObjection==AUTHORITY THEN Predict(STALL_TACTIC, prob=0.75, horizon=NEAR_TERM)`.
**Stage 3:** LLM Predictor analyzes transcript and forecasts: `Predict(ASK_FOR_SLIDES, prob=0.85, horizon=IMMEDIATE)`.
**Stage 4:** Synthesis merges these. Both are kept as they don't conflict.
**Stage 5:** Calibration adjusts STALL_TACTIC to 0.70 based on historical base rates.
**Stage 6:** Mutations generated to update World Model with these two probabilistic forecasts.

*End of CCBS Engine Specification — Prediction Cognitive Subsystem*
