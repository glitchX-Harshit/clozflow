# CCBS Engine Specification — Decision Cognitive Subsystem

**Document ID:** CCBS-ENGINE-07
**Engine ID:** `decision.concrete`
**Engine Type:** `DECISION`
**CCBS Authority:** Volume IV §1.11 (CDC Phase VII)
**Classification:** Executive Selection Subsystem
**Status:** Enterprise Architecture Specification v1.0

---

## 1. Purpose

The Decision Engine is the executive cortex of the ClozFlow Cognitive Brain. Its cognitive mission is to answer the question **"Which action should be chosen?"** — taking the constructed, viable plans from the Planning Engine and selecting the single optimal plan to pass forward to Verification and Recommendation.

**What intelligence it contributes:**
- Selects the final strategic path from the available options.
- Resolves any remaining ambiguity between competing hypotheses (from Interpretation) by committing to a course of action based on the chosen plan.
- Integrates organizational policies and hard constraints (e.g., "Never discount below 15% without VP approval") to veto plans that may have scored well theoretically but are practically prohibited.
- Manages the commitment to multi-turn plans across cycles.

**Why the Brain cannot function without it:**
Up to this point, the Brain maintains multiple possibilities (hypotheses, candidate strategies, alternate plans). The Recommendation Engine cannot communicate effectively if it is uncertain or holds multiple conflicting intents. The Decision Engine collapses this superposition of possibilities into a singular, committed choice. It represents the point of no return in the cognitive cycle where contemplation ends and commitment begins.

---

## 2. Cognitive Objective

**Primary Objective:**
Select the single best executable plan for the current turn, applying organizational policies and final executive judgment, outputting a `DecisionNode` mutation to the World Model.

**Secondary Objectives:**
- Maintain commitment to active multi-turn plans unless compelling new evidence forces an abort.
- Apply hard policy constraints to veto plans.
- Document the exact rationale for why the final plan was chosen over the alternatives.

**Optimization Goals:**
- Minimize latency (this should be a fast, deterministic selection process in most cases).
- Maximize consistency (avoid oscillating between vastly different strategies across consecutive cycles).

**Cognitive Guarantees:**
- Exactly ONE plan is selected.
- The selected plan does not violate any active organizational policy.
- The decision rationale is explicitly recorded.
- Decision does not generate language (CCBS Law 270).

---

## 3. Internal Philosophy

**How this engine reasons:**
Decision reasons through elimination and commitment. It first applies hard constraints (policies) to eliminate invalid options. Then it looks at the remaining plans, weighing their Evaluation scores, Planning robustness, and historical consistency, and commits to the highest-scoring survivor.

**Its mental model:**
The engine acts like an executive reviewer. It assumes the teams below it (Evaluation, Planning) have done good work, but it holds the final veto power based on the broader organizational rulebook and the need for conversational stability.

**What it optimizes:**
Stability and Compliance. A conversation that wildly shifts strategy every 10 seconds feels erratic. The Decision Engine optimizes for sticking to a chosen path (stability) while ensuring no organizational rules are broken (compliance).

**What uncertainty means inside this engine:**
In Decision, uncertainty is resolved. If the engine is uncertain, it chooses the safest path (the plan with the lowest variance in projected outcomes). It does not pass uncertainty down to the Recommendation Engine.

---

## 4. Internal Architecture

```
                    ┌───────────────────────────────────────────┐
                    │        DECISION SUBSYSTEM                 │
                    │                                           │
                    │  ┌──────────────┐                        │
    World Model ───►│  │ Plan         │                        │
    (Constructed    │  │ Ingestor     │                        │
     Plans)         │  └──────┬───────┘                        │
                    │         │                                 │
                    │         ▼                                 │
                    │  ┌──────────────┐   ┌──────────────┐    │
                    │  │ Policy       │──►│ Org Policy   │    │
                    │  │ Enforcer     │◄──│ Registry     │    │
                    │  └──────┬───────┘   │ (External/DB)│    │
                    │         │           └──────────────┘    │
                    │         ▼                                 │
                    │  ┌─────────────────────────────────┐    │
                    │  │   Continuity Manager            │    │
                    │  └──────────────┬──────────────────┘    │
                    │                 │                        │
                    │                 ▼                        │
                    │  ┌─────────────────────────────────┐    │
                    │  │   Executive Selector            │    │
                    │  └──────────────┬──────────────────┘    │
                    │                 │                        │
                    │                 ▼                        │
                    │  ┌─────────────────────────────────┐   │
                    │  │   Commitment Recorder           │   │
                    │  └──────────────┬──────────────────┘   │
                    │                 │                       │
                    │                 ▼                       │
                    │  ┌─────────────────────────────────┐   │
                    │  │   Mutation Composer             │   │
                    │  └─────────────────────────────────┘   │
                    └───────────────────────────────────────────┘
```

### Component Descriptions

1. **Plan Ingestor** — Collects the candidate plans generated by the Planning Engine.
2. **Policy Enforcer** — Checks each plan against the Organizational Policy Registry. E.g., if a plan suggests discussing discounts, and the user is a junior rep without discount authority, the plan is vetoed.
3. **Continuity Manager** — Checks if the Brain is currently executing a multi-turn plan. If so, it heavily weights the continuation of that plan over new plans, providing "momentum" to strategic choices unless new evidence (like a sudden hostile objection) crosses the abort threshold.
4. **Executive Selector** — The final arbiter. Compares the surviving plans based on their inherited Evaluation COH scores, Planning robustness, and Continuity momentum. Selects the single winner.
5. **Commitment Recorder** — Generates the explicit rationale for the decision (e.g., "Selected Plan A because it continues the ongoing value-demonstration strategy and complies with discount policies").
6. **Mutation Composer** — Packages the selected plan into a `DecisionNode` mutation.

---

## 5. Internal Managers

| Manager | Responsibility |
|---|---|
| **Policy Update Manager** | Syncs organizational policies from external stores to ensure the Decision Engine has the latest constraints. |
| **Momentum Tracker** | Calculates the "inertia" of current strategies to prevent erratic switching. |
| **Veto Manager** | Handles the logic for when and why a plan is vetoed, ensuring detailed logging for why a seemingly good strategy was killed. |

---

## 6. Internal Repositories

| Repository | Contents | Retention |
|---|---|---|
| **Policy Cache** | Hard constraints and rules specific to the organization or salesperson | Session-scoped (synced at start) |
| **Decision History** | Record of past decisions in the current session to aid in continuity | Session-scoped |
| **Veto Log** | Record of plans that were rejected and the specific policy they violated | Session-scoped |

---

## 7. Internal Data Structures

| Structure | Description |
|---|---|
| `PolicyRule` | A hard constraint: `{rule_id, condition, description, severity}` |
| `ScoredPlan` | Plan with final executive score: `{plan, base_score, continuity_modifier, policy_status, final_score}` |
| `DecisionRationale` | The "why": `{selected_plan_id, rejected_plan_ids[], veto_reasons[], primary_justification}` |

---

## 8. Cognitive Pipeline

```
Stage 1: Ingestion
    │  Receive candidate plans from Planning
    ▼
Stage 2: Policy Enforcement
    │  Check plans against organizational rules
    │  Veto non-compliant plans
    ▼
Stage 3: Continuity Weighting
    │  Apply bonus to plans that continue current strategies
    │  Apply penalty to plans that abruptly shift topics (unless urgent)
    ▼
Stage 4: Selection
    │  Select the plan with the highest final adjusted score
    ▼
Stage 5: Commitment Recording
    │  Document rationale
    │  Generate UPSERT_DECISION mutation
    ▼
Output: EngineExecutionOutput
```

---

## 9. Internal State Machine

```
    ┌──────────┐
    │   IDLE   │◄────────────────┐
    └────┬─────┘                 │
         │ plans received        │
         ▼                       │
    ┌──────────┐                 │
    │ FILTERING│ (Policy Veto)   │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │WEIGHTING │ (Continuity)    │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │SELECTING │                 │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │COMPLETED │─────────────────┘
    └──────────┘
```

---

## 10. Algorithms

### 10.1 Continuity Momentum Scoring
`Adjusted_Score = Base_Score * (1 + (Is_Continuation ? Momentum_Factor : 0))`.
Momentum Factor starts at 0.2 and grows the longer a strategy has been active, capping at 0.5. However, if Interpretation flags a HIGH or CRITICAL severity new objection, the Momentum Factor is reset to 0, allowing an immediate pivot.

### 10.2 Policy Rule Engine
A deterministic rule engine that evaluates boolean expressions against the plan's metadata (e.g., `IF plan.objective == 'OFFER_DISCOUNT' AND salesperson.role == 'SDR' THEN VETO`).

---

## 11. Confidence Architecture

**Decision Certainty:** The confidence of the Decision is derived from the margin of victory between the selected plan and the runner-up. A wide margin implies high certainty in the choice; a narrow margin (e.g., selecting between two equally good approaches) implies lower certainty, though the commitment is still absolute.

---

## 12. Failure Handling

| Failure Mode | Recovery Strategy |
|---|---|
| All plans vetoed by policy | Generate a safe "Fallback Decision" (e.g., "Acknowledge and ask a clarifying question"). |
| Policy DB Unreachable | Fail-closed on high-risk actions (assume no permission for discounts/legal commitments), fail-open on low-risk conversational moves. |

---

## 13. Optimization Layer

**Fast-Path Selection:** If only one plan survives the Planning engine and it passes Policy Enforcement, weighting and selection are bypassed (O(1) selection).

---

## 14. Learning Hooks

**Policy Effectiveness:** If a policy frequently vetoes the highest-scoring plans, resulting in degraded conversation quality (as measured by Reflection), this data is flagged to human administrators indicating a potentially overly-restrictive organizational policy.

---

## 15. Governance

**Compliance:** Directly enforces organizational governance. It is the gatekeeper that prevents rogue AI behavior by applying hard-coded human constraints before any recommendation is generated.

---

## 16. Observability

| Metric | Type | Description |
|---|---|---|
| `decision.vetoes_applied` | Counter | Number of plans killed by policy |
| `decision.continuity_overrides` | Counter | Number of times a lower-base-score plan won due to continuity momentum |
| `decision.margin_of_victory` | Histogram | Difference in score between rank 1 and rank 2 plans |

---

## 17. Extension Framework

**Plugin Interfaces:** `PolicyAdapter` allows integrating with external corporate systems (like Salesforce CPQ) to pull dynamic rules regarding what can be offered in real-time.

---

## 18. Performance Targets

| Metric | Target |
|---|---|
| End-to-end cycle latency | < 50ms (Heavily deterministic) |
| Policy evaluation latency | < 10ms |

---

## 19. Testing

**Unit Tests:** Policy rule engine evaluation, Momentum calculation.
**Integration Tests:** Feed a high-scoring but policy-violating plan → verify it is vetoed and the lower-scoring compliant plan is selected.

---

## 20. Complete Cognitive Walkthrough

**Scenario:** Two plans arrive. Plan A: Offer 10% discount (Base Score: 0.85). Plan B: Defend Value (Base Score: 0.75).
**Stage 1:** Ingest both plans.
**Stage 2:** Policy Enforcer checks rules. Rule 42: "No discounts before Demo phase is complete." Current phase is DEMO. Plan A violates Rule 42. Plan A is VETOED.
**Stage 3:** Plan B is the only survivor. Continuity weighting applied (no effect as it's the only one).
**Stage 4:** Select Plan B.
**Stage 5:** Record Rationale: "Plan A vetoed due to Rule 42 (Premature Discount). Defaulted to Plan B (Defend Value)." Output `DecisionNode`.

*End of CCBS Engine Specification — Decision Cognitive Subsystem*
