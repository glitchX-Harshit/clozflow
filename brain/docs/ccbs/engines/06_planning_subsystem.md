# CCBS Engine Specification — Planning Cognitive Subsystem

**Document ID:** CCBS-ENGINE-06
**Engine ID:** `planning.concrete`
**Engine Type:** `PLANNING`
**CCBS Authority:** Volume IV §1.10 (CDC Phase VI)
**Classification:** Strategic Orchestration Subsystem
**Status:** Enterprise Architecture Specification v1.0

---

## 1. Purpose

The Planning Engine is the strategic architect of the ClozFlow Cognitive Brain. Its cognitive mission is to answer the question **"What should be done?"** — taking the top-ranked strategies from the Evaluation Engine and constructing concrete, executable, multi-step response plans.

**What intelligence it contributes:**
- Translates high-level strategies ("Build trust", "Probe for budget") into specific conversational steps.
- Retrieves and sequences the necessary playbooks, battlecards, and organizational knowledge required to execute the strategy.
- Structures the flow of the upcoming response (e.g., Step 1: Acknowledge objection, Step 2: Provide data point, Step 3: Ask open-ended question).
- Manages conversational pacing, knowing when a plan should span multiple turns rather than being compressed into a single monologue.

**Why the Brain cannot function without it:**
Evaluation tells the Brain *which path is best*, but not *how to walk it*. Without Planning, the Recommendation Engine would have to jump directly from a high-level strategy to generating words, resulting in unstructured, rambling, or ungrounded responses. Planning provides the architectural blueprint that the Recommendation Engine will later fill with specific language, ensuring responses are methodical, evidence-based, and strategically sequenced.

---

## 2. Cognitive Objective

**Primary Objective:**
Construct executable response strategies (Plans) consisting of sequenced cognitive steps and retrieved knowledge, outputting `PlanNode` mutations to the World Model.

**Secondary Objectives:**
- Identify missing information required to execute a strategy and insert information-gathering steps.
- Select the most appropriate organizational playbooks or battlecards from the Knowledge Service.
- Break complex strategies into multi-turn plans if attempting them in a single turn would overwhelm the buyer.
- Maintain continuity with active, multi-turn plans from previous cycles.

**Optimization Goals:**
- Maximize plan coherence (steps must logically follow one another).
- Minimize retrieval latency when accessing the Knowledge Service.
- Ensure plans are appropriately sized for the current conversational tempo (e.g., shorter plans during rapid back-and-forth).

**Cognitive Guarantees:**
- Every plan step has a specific, testable objective (e.g., `VALIDATE_CONCERN`, `PRESENT_EVIDENCE`).
- Plans never include actual generated language (that violates CCBS Law 270; Planning is distinct from Recommendation).
- If a strategy requires organizational knowledge, that knowledge is retrieved and explicitly linked to the plan step.

---

## 3. Internal Philosophy

**How this engine reasons:**
Planning reasons through decomposition and sequencing. It takes a complex goal and breaks it down into a logical progression of smaller, manageable actions. It uses backward chaining: "To achieve X, the buyer must first accept Y. To prove Y, I need data Z. Therefore, Step 1: Present Z, Step 2: Establish Y, Step 3: Propose X."

**Its mental model:**
The engine views a conversation as a series of structured maneuvers. A maneuver (Plan) consists of tactical steps. A successful response is not just the right words, but the right structure: typically consisting of an Anchor (acknowledging reality), a Payload (delivering the core message/evidence), and a Pivot (directing the conversation forward).

**What it optimizes:**
Structural effectiveness and cognitive load management. It optimizes for plans that the buyer can easily digest and that guide the conversation toward the strategic objective without causing friction.

**What uncertainty means inside this engine:**
Uncertainty in Planning manifests as branch points. If a plan step's success is highly uncertain (e.g., "Ask if they have budget" — they might say yes or no), the engine may generate a contingent plan or keep the plan intentionally short so the Brain can observe the outcome before planning further.

---

## 4. Internal Architecture

```
                    ┌───────────────────────────────────────────┐
                    │        PLANNING SUBSYSTEM                 │
                    │                                           │
                    │  ┌──────────────┐                        │
    World Model ───►│  │ Strategy     │                        │
    (Evaluated      │  │ Ingestor     │                        │
     Strategies)    │  └──────┬───────┘                        │
                    │         │                                 │
                    │         ▼                                 │
                    │  ┌──────────────┐   ┌──────────────┐    │
                    │  │ Playbook     │──►│ Knowledge    │    │
                    │  │ Retriever    │◄──│ Service      │    │
                    │  └──────┬───────┘   │ (External)   │    │
                    │         │           └──────────────┘    │
                    │         ▼                                 │
                    │  ┌─────────────────────────────────┐    │
                    │  │   Plan Structurer               │    │
                    │  │  (LLM Orchestrator)             │    │
                    │  └──────────────┬──────────────────┘    │
                    │                 │                        │
                    │                 ▼                        │
                    │  ┌─────────────────────────────────┐    │
                    │  │   Step Sequencer                │    │
                    │  └──────────────┬──────────────────┘    │
                    │                 │                        │
                    │       ┌─────────┼──────────┐           │
                    │       ▼         ▼          ▼           │
                    │  ┌────────┐ ┌────────┐ ┌────────┐     │
                    │  │ Tempo  │ │ Multi- │ │ Contig.│     │
                    │  │ Pacer  │ │ Turn   │ │ Planner│     │
                    │  │        │ │ Manager│ │        │     │
                    │  └───┬────┘ └───┬────┘ └───┬────┘     │
                    │      │          │          │           │
                    │      ▼          ▼          ▼           │
                    │  ┌─────────────────────────────────┐   │
                    │  │   Plan Validator                │   │
                    │  └──────────────┬──────────────────┘   │
                    │                 │                       │
                    │                 ▼                       │
                    │  ┌─────────────────────────────────┐   │
                    │  │   Mutation Composer             │   │
                    │  └─────────────────────────────────┘   │
                    └───────────────────────────────────────────┘
```

### Component Descriptions

1. **Strategy Ingestor** — Receives the top-ranked evaluated strategies. Selects the primary strategy to flesh out, but may keep secondary strategies for contingency planning.
2. **Playbook Retriever** — Interfaces with the Knowledge Service. If the strategy involves handling a specific competitor or objection, it fetches the relevant organizational battlecard or playbook.
3. **Plan Structurer (LLM Orchestrator)** — The core generative component. Takes the strategy, context, and retrieved knowledge, and generates a structured sequence of cognitive steps (e.g., `ACKNOWLEDGE`, `REFRAME`, `CITE_EVIDENCE`, `PROBE`).
4. **Step Sequencer** — Organizes the steps logically. Ensures standard persuasive structures (like Feel-Felt-Found, or Anchor-Payload-Pivot) are respected.
5. **Tempo Pacer** — Adjusts plan length based on conversation dynamics (detected in Perception/Understanding). If the conversation is fast-paced (short utterances), it compresses the plan to 1-2 steps. If slow-paced, it allows deeper, multi-step plans.
6. **Multi-Turn Manager** — Identifies if a plan is too complex for a single turn and breaks it into chunks, saving the remaining steps as an active multi-turn plan for future cycles.
7. **Contingency Planner** — Adds conditional logic to steps (e.g., "If buyer responds positively to Step 1, proceed to Step 2. Else, abort plan").
8. **Plan Validator** — Ensures the plan is structurally sound, contains no generated dialogue (enforcing separation of concerns), and correctly references retrieved knowledge.
9. **Mutation Composer** — Packages the constructed plan into a `PlanNode` mutation for the World Model.

---

## 5. Internal Managers

| Manager | Responsibility |
|---|---|
| **Knowledge Integration Manager** | Ensures retrieved battlecards and playbooks are correctly mapped to specific plan steps. |
| **Continuity Manager** | Checks if an existing multi-turn plan is currently active and determines if the current cycle should continue it, modify it, or abandon it based on new evidence. |
| **Pacing & Tempo Manager** | Analyzes the conversational speed and regulates the density of the generated plans. |
| **Validation & Compliance Manager** | Hard-enforces CCBS Law 270 (no language generation in Planning). Rejects plans that contain specific scripts. |

---

## 6. Internal Repositories

| Repository | Contents | Retention |
|---|---|---|
| **Active Plan Repository** | Currently executing or queued plans (multi-turn) | Session-scoped |
| **Retrieved Knowledge Cache** | Recently fetched battlecards/playbooks to reduce latency | Session-scoped |
| **Structural Templates** | Standardized persuasive sequences (e.g., Anchor-Payload-Pivot) | Global |

---

## 7. Internal Data Structures

| Structure | Description |
|---|---|
| `PlanStep` | A single maneuver: `{step_type, objective, knowledge_refs[], dependencies}` |
| `ExecutionPlan` | The complete sequence: `{plan_id, parent_strategy_id, steps[], is_multi_turn, current_step_index}` |
| `KnowledgeRequest` | Query to Knowledge Service: `{topic, objection_type, competitor, context_summary}` |

---

## 8. Cognitive Pipeline

```
Stage 1: Strategy Ingestion
    │  Take top strategy from Evaluation Engine
    ▼
Stage 2: Knowledge Retrieval
    │  Query Knowledge Service for relevant data/playbooks
    ▼
Stage 3: Plan Structuring (LLM)
    │  Generate logical sequence of cognitive steps
    ▼
Stage 4: Pacing & Sequencing
    │  Adjust step density based on conversational tempo
    │  Split into multi-turn plan if necessary
    ▼
Stage 5: Validation
    │  Ensure steps are structural, not scripted
    │  Verify knowledge links
    ▼
Stage 6: Mutation Generation
    │  Produce UPSERT_PLAN mutation
    ▼
Output: EngineExecutionOutput
```

---

## 9. Internal State Machine

```
    ┌──────────┐
    │   IDLE   │◄────────────────┐
    └────┬─────┘                 │
         │ strategy received     │
         ▼                       │
    ┌──────────┐                 │
    │RETRIEVING│ (Knowledge)     │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │STRUCTURING│(LLM)           │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │REFINING  │ (Pacing, Split) │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │VALIDATING│                 │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │COMPLETED │─────────────────┘
    └──────────┘
```

---

## 10. Algorithms

### 10.1 Multi-Turn Chunking Algorithm
Calculates the "cognitive weight" of a proposed plan based on the number of steps and complexity of evidence. If weight > Threshold(Tempo), the plan is split at the most logical boundary (usually after a `PROBE` or `CLARIFY` step), storing the remainder in the Active Plan Repository.

### 10.2 Knowledge Relevance Scoring
When the Knowledge Service returns multiple playbooks, the Retriever uses vector similarity between the playbook metadata and the current conversational context (active objections, industry, phase) to select the single most relevant artifact.

---

## 11. Confidence Architecture

**Plan Robustness:** Confidence in Planning reflects the robustness of the plan. A plan relying on highly relevant, confirmed organizational knowledge has high confidence. A plan built on a speculative strategy with weak knowledge retrieval has lower confidence.

---

## 12. Failure Handling

| Failure Mode | Recovery Strategy |
|---|---|
| Knowledge Service Timeout | Proceed with a "knowledge-light" plan relying on general sales best practices |
| LLM Structurer Failure | Fallback to a static structural template (e.g., standard Acknowledge -> Clarify sequence) |
| Validation Failure (Scripting detected) | Strip offending steps, replace with generic structural steps |

---

## 13. Optimization Layer

**Template Matching:** If the strategy is a standard response to a common objection (e.g., "Standard Price Objection"), the engine bypasses the LLM and instantiates a pre-defined plan template, filling in the retrieved knowledge links directly.

---

## 14. Learning Hooks

**Plan Success Rate:** The Evaluation and Reflection engines track which plan structures lead to positive phase transitions or resolved objections. The Planning Engine can learn to favor highly successful structural templates over time.

---

## 15. Governance

**Compliance:** Adheres to CCBS Law 270 (Perception, interpretation and decision shall remain distinct). Ensures Planning does not bleed into Recommendation (language generation).

---

## 16. Observability

| Metric | Type | Description |
|---|---|---|
| `planning.plans_generated` | Counter | Total plans built |
| `planning.knowledge_cache_hit_rate` | Gauge | % of knowledge retrievals served from cache |
| `planning.multi_turn_splits` | Counter | Number of plans broken across multiple turns |
| `planning.validation_failures` | Counter | Plans rejected for containing scripted language |

---

## 17. Extension Framework

**Plugin Interfaces:** `KnowledgeAdapter` to interface with different organizational knowledge bases (e.g., SharePoint, Notion, specific CRM attachments).

---

## 18. Performance Targets

| Metric | Target |
|---|---|
| End-to-end cycle latency | < 400ms (includes retrieval) |
| Knowledge retrieval latency | < 150ms |
| LLM structurer latency | < 200ms |

---

## 19. Testing

**Unit Tests:** Multi-turn chunking logic, validation regexes to catch scripted language.
**Integration Tests:** End-to-end flow from Strategy in to Plan out, verifying knowledge retrieval occurred correctly.

---

## 20. Complete Cognitive Walkthrough

**Scenario:** Evaluation engine output top strategy: "Defend Price using ROI Data." Active Objection: PRICE.
**Stage 1:** Strategy Ingestor receives "Defend Price using ROI Data."
**Stage 2:** Playbook Retriever queries Knowledge Service for "Price Objection + ROI Proof." Returns `Battlecard: Enterprise ROI Metrics`.
**Stage 3:** LLM Structurer builds plan:
  - Step 1: `ACKNOWLEDGE_CONCERN` (Target: Price)
  - Step 2: `PRESENT_EVIDENCE` (Target: Battlecard_ROI_Metrics)
  - Step 3: `PROBE_RESONANCE` (Target: Value perception)
**Stage 4:** Pacing Manager checks tempo. Tempo is normal. Plan kept as single-turn.
**Stage 5:** Validator confirms steps are structural, no dialogue generated.
**Stage 6:** Output `PlanNode` mutation.

*End of CCBS Engine Specification — Planning Cognitive Subsystem*
