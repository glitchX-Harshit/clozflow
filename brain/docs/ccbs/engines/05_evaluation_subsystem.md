# CCBS Engine Specification — Evaluation Cognitive Subsystem

**Document ID:** CCBS-ENGINE-05
**Engine ID:** `evaluation.concrete`
**Engine Type:** `EVALUATION`
**CCBS Authority:** Volume IV §1.9 (CDC Phase V), Volume IV Chapter 3 (Cognitive Objective Hierarchy)
**Classification:** Strategic Assessment Subsystem
**Status:** Enterprise Architecture Specification v1.0

---

## 1. Purpose

The Evaluation Engine is the strategic conscience of the ClozFlow Cognitive Brain. Its cognitive mission is to answer the question **"Which possibilities are best?"** — taking the current reality and predicted futures, generating candidate strategies, and scoring them against the Cognitive Objective Hierarchy (COH).

**What intelligence it contributes:**
- Generates multiple candidate approaches to the current conversational situation (e.g., "Address objection directly", "Ask a clarifying question", "Pivot to value")
- Scores each candidate against the 6 levels of the COH (Cognitive Integrity, Buyer Trust, Salesperson Success, Commercial Progress, Communication Excellence, Operational Efficiency)
- Identifies the trade-offs between different strategies (e.g., Strategy A maximizes Commercial Progress but risks Buyer Trust; Strategy B maximizes Buyer Trust but slows Commercial Progress)

**Why the Brain cannot function without it:**
CCBS Law V states: "Evaluation Before Decision. No significant decision shall be made without evaluating multiple plausible alternatives." Without the Evaluation Engine, the Brain would simply pick the first or most obvious response, acting impulsively. Evaluation ensures that the Brain considers alternatives and selects the path that aligns with the system's core values and strategic goals, maintaining long-term buyer trust over short-term commercial gains.

---

## 2. Cognitive Objective

**Primary Objective:**
Assess possible cognitive actions and strategies against the Cognitive Objective Hierarchy, producing scored candidate strategies for the Planning Engine.

**Secondary Objectives:**
- Resolve conflicts between competing objectives according to the strict COH ordering (Level 1 trumps Level 2, etc.)
- Prune candidate strategies that violate Level 1 (Cognitive Integrity) or Level 2 (Buyer Trust) before they reach the Planning Engine
- Provide explicit reasoning for *why* a strategy scored highly or poorly on specific objectives

**Optimization Goals:**
- Rapidly generate and score candidate strategies (parallel evaluation)
- Ensure consistent scoring logic (the same strategy in the same context should receive the same scores)

**Cognitive Guarantees:**
- Multiple alternatives are evaluated (never just one)
- The Cognitive Objective Hierarchy is strictly enforced
- Strategies that violate Cognitive Integrity are immediately discarded (CCBS Vol 4 §3.5)
- Evaluation does not construct the final execution plan; it merely scores strategic directions (CCBS Law 270)

---

## 3. Internal Philosophy

**How this engine reasons:**
Evaluation reasons through multi-criteria decision analysis. It takes a set of candidate strategies and maps their projected outcomes against a strict hierarchy of values.

**Its mental model:**
Every strategic choice is a trade-off. The engine models these trade-offs explicitly. It views the conversation not just as a path to a sale, but as an exercise in maintaining integrity, trust, and communication quality.

**What it optimizes:**
Alignment with the Cognitive Objective Hierarchy. The "best" strategy is not the one most likely to close the deal immediately, but the one that best satisfies the highest levels of the hierarchy.

**What uncertainty means inside this engine:**
Uncertainty in Evaluation relates to outcome variance. If a strategy's impact on Buyer Trust is highly uncertain (it might build great trust, or it might offend them), the Evaluation Engine heavily discounts that strategy, preferring paths with more predictable outcomes regarding the top tier objectives.

---

## 4. Internal Architecture

```
                    ┌───────────────────────────────────────────┐
                    │        EVALUATION SUBSYSTEM               │
                    │                                           │
                    │  ┌──────────────┐                        │
    World Model ───►│  │ Candidate    │                        │
    + Predictions   │  │ Generator    │                        │
                    │  └──────┬───────┘                        │
                    │         │                                 │
                    │         ▼                                 │
                    │  ┌──────────────┐                        │
                    │  │ Strategy     │                        │
                    │  │ Simulator    │                        │
                    │  └──────┬───────┘                        │
                    │         │                                 │
                    │         ▼                                 │
                    │  ┌─────────────────────────────────┐    │
                    │  │    COH Scoring Matrix           │    │
                    │  │  ┌────────┐ ┌────────┐ ┌──────┐ │    │
                    │  │  │ L1 Int │ │ L2 Tru │ │L3 Suc│ │    │
                    │  │  └────────┘ └────────┘ └──────┘ │    │
                    │  │  ┌────────┐ ┌────────┐ ┌──────┐ │    │
                    │  │  │ L4 Com │ │ L5 Comm│ │L6 Ops│ │    │
                    │  │  └────────┘ └────────┘ └──────┘ │    │
                    │  └──────────────┬──────────────────┘    │
                    │                 │                        │
                    │                 ▼                        │
                    │  ┌─────────────────────────────────┐   │
                    │  │   Hierarchy Enforcer            │   │
                    │  └──────────────┬──────────────────┘   │
                    │                 │                       │
                    │                 ▼                       │
                    │  ┌─────────────────────────────────┐   │
                    │  │   Trade-off Analyzer            │   │
                    │  └──────────────┬──────────────────┘   │
                    │                 │                       │
                    │                 ▼                       │
                    │  ┌─────────────────────────────────┐   │
                    │  │   Mutation Composer             │   │
                    │  └─────────────────────────────────┘   │
                    └───────────────────────────────────────────┘
```

### Component Descriptions

1. **Candidate Generator** — Uses heuristics and LLM prompting to generate 3-5 high-level strategic approaches to the current situation (e.g., Strategy A: "Challenge the premise", Strategy B: "Empathize and probe", Strategy C: "Delay and gather info").
2. **Strategy Simulator** — Projects the likely outcomes of each candidate strategy, utilizing forecasts from the Prediction Engine. "If we do A, what is the likely outcome on trust and deal progress?"
3. **COH Scoring Matrix** — Evaluates each simulated strategy against the 6 levels of the Cognitive Objective Hierarchy, assigning a score (0.0 to 1.0) for each level.
4. **Hierarchy Enforcer** — Applies the strict ordering rules of the COH. If a strategy scores < 0.5 on Cognitive Integrity (Level 1), it is hard-pruned. If two strategies tie on Level 1, Level 2 (Buyer Trust) breaks the tie, and so on.
5. **Trade-off Analyzer** — Generates explainable trade-off summaries for the top surviving strategies (e.g., "Strategy A is safer for Trust, Strategy B advances Commercial Progress faster").
6. **Mutation Composer** — Packages the evaluated, ranked strategies into `StrategyNode` mutations for the World Model.

---

## 5. Internal Managers

| Manager | Responsibility |
|---|---|
| **Strategy Generation Manager** | Ensures a diverse set of candidate strategies are generated, avoiding variations of the same idea. |
| **COH Weighting Manager** | Maintains the internal weights/thresholds for the COH levels, ensuring strict subordination of lower levels to higher levels. |
| **Simulation Manager** | Orchestrates the projection of outcomes for each strategy, integrating heavily with Prediction Engine outputs. |
| **Pruning Manager** | Identifies and removes non-viable or unsafe strategies before deep scoring to save compute. |
| **Explainability Manager** | Formulates the natural language rationale for why a strategy scored the way it did against the COH. |

---

## 6. Internal Repositories

| Repository | Contents | Retention |
|---|---|---|
| **Candidate Strategy Repository** | The set of generated strategies for the current cycle | Cycle-scoped |
| **COH Policy Repository** | The definitions and rules for the 6 COH levels | Global |
| **Evaluation History Repository** | Past evaluations and the selected strategies to avoid repeating rejected approaches | Session-scoped |

---

## 7. Internal Data Structures

| Structure | Description |
|---|---|
| `CandidateStrategy` | Proposed approach: `{strategy_id, description, intent_target}` |
| `COHScores` | The 6-level score profile: `{integrity, trust, success, commercial, communication, efficiency}` |
| `EvaluatedStrategy` | Complete evaluation: `{strategy, scores, rank, trade_off_summary, viability_status}` |

---

## 8. Cognitive Pipeline

```
Stage 1: Candidate Generation
    │  Review current state, objections, and predictions
    │  Generate 3-5 distinct strategic directions
    ▼
Stage 2: Strategy Simulation
    │  For each strategy, project likely outcomes
    ▼
Stage 3: COH Matrix Scoring
    │  Score projected outcomes against the 6 COH levels
    ▼
Stage 4: Hierarchy Enforcement & Pruning
    │  Prune strategies violating Levels 1 or 2
    │  Sort remaining strategies strictly by COH level precedence
    ▼
Stage 5: Trade-off Analysis
    │  Generate rationale and trade-off summaries for top candidates
    ▼
Stage 6: Mutation Generation
    │  Produce UPSERT_STRATEGY mutations for top ranked strategies
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
    │GENERATING│ (Candidates)    │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │SIMULATING│                 │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │ SCORING  │ (COH)           │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │ RANKING  │                 │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │COMPLETED │─────────────────┘
    └──────────┘
```

---

## 10. Algorithms

### 10.1 Lexicographic Ranking Algorithm
Since the COH is a strict hierarchy, strategies are ranked lexicographically. A strategy with scores (L1=0.9, L2=0.8, L3=0.5) strictly defeats a strategy with (L1=0.9, L2=0.7, L3=0.99). Lower levels only matter as tie-breakers for higher levels.

### 10.2 Diversity Maximization (Candidate Generation)
When generating candidates, semantic distance is measured between them. The engine actively filters out candidates that are too semantically similar to ensure a true breadth of alternatives is evaluated.

---

## 11. Confidence Architecture

**Evaluation Confidence:** In this engine, confidence refers to the certainty of the projected outcome scores. If the Strategy Simulator is highly uncertain about how a strategy will impact Buyer Trust, the trust score is discounted (penalized for risk).

---

## 12. Failure Handling

| Failure Mode | Recovery Strategy |
|---|---|
| LLM timeout during scoring | Fallback to heuristic scoring based on historical strategy archetypes |
| All strategies pruned | Fallback to a universally safe default strategy (e.g., "Ask a clarifying question to gather more information") |

---

## 13. Optimization Layer

**Parallel Scoring:** The COH Scoring Matrix scores all candidate strategies concurrently to minimize latency.
**Heuristic Generation:** Common conversation states trigger pre-compiled candidate strategies, bypassing the LLM generation step.

---

## 14. Learning Hooks

**Evaluation Calibration:** If the Reflection Engine determines that a selected strategy actually degraded Buyer Trust (despite Evaluation predicting it wouldn't), the COH Scoring models are penalized and adjusted for similar future contexts.

---

## 15. Governance

**Compliance:** Strictly enforces CCBS Volume IV Chapter 3 (Cognitive Objective Hierarchy). Acts as the primary safeguard against unethical, manipulative, or overly aggressive sales tactics.

---

## 16. Observability

| Metric | Type | Description |
|---|---|---|
| `evaluation.candidates_generated` | Histogram | Number of strategies evaluated per cycle |
| `evaluation.pruned_integrity` | Counter | Strategies rejected for L1 violations |
| `evaluation.pruned_trust` | Counter | Strategies rejected for L2 violations |
| `evaluation.avg_coh_scores` | Gauge | Average scores across the 6 levels |

---

## 17. Extension Framework

**Plugin Interfaces:** `StrategyGenerator` to supply domain-specific candidate strategies. `ObjectiveScorer` allows fine-tuning how specific COH levels are calculated for specific industries.

---

## 18. Performance Targets

| Metric | Target |
|---|---|
| End-to-end cycle latency | < 350ms |
| Minimum candidates evaluated | ≥ 3 |

---

## 19. Testing

**Unit Tests:** Lexicographic ranking logic (ensuring L1 strictly beats L2).
**Behavior Tests:** Feed a highly manipulative strategy into the matrix → verify it is pruned at Level 1 (Integrity) or Level 2 (Trust).

---

## 20. Complete Cognitive Walkthrough

**Scenario:** Buyer raised a PRICE objection.
**Stage 1:** Candidate Generator produces: A) Defend the price with ROI data. B) Offer a discount immediately. C) Acknowledge the concern and ask what budget they had in mind.
**Stage 3:** Scoring Matrix:
- Strategy A: L1=0.9, L2=0.8, L3=0.8, L4=0.7
- Strategy B: L1=0.9, L2=0.6, L3=0.4, L4=0.9 (Good for commercial, bad for trust/success)
- Strategy C: L1=0.9, L2=0.9, L3=0.8, L4=0.6
**Stage 4:** Ranking: Strategy C wins (Tie on L1, C beats A and B on L2 Trust). Strategy B is heavily penalized for offering unapproved discounts (L3 Salesperson Success hit).
**Stage 6:** Output `StrategyNode` mutations for C (Rank 1) and A (Rank 2).

*End of CCBS Engine Specification — Evaluation Cognitive Subsystem*
