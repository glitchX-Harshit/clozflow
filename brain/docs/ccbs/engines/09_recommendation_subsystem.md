# CCBS Engine Specification — Recommendation Cognitive Subsystem

**Document ID:** CCBS-ENGINE-09
**Engine ID:** `recommendation.concrete`
**Engine Type:** `RECOMMENDATION`
**CCBS Authority:** Volume IV §1.13 (CDC Phase IX)
**Classification:** Articulation & Output Subsystem
**Status:** Enterprise Architecture Specification v1.0

---

## 1. Purpose

The Recommendation Engine is the articulation cortex of the ClozFlow Cognitive Brain. Its cognitive mission is to answer the question **"How exactly should this be said?"** — taking the verified, structured plan from the Verification Engine and translating it into natural, persuasive, human-readable language (or structured commands for downstream systems).

**What intelligence it contributes:**
- Generates the actual conversational payload (the script or suggested text).
- Applies stylistic constraints (tone, brand voice, buyer persona mirroring).
- Integrates retrieved knowledge (battlecards, ROI data) naturally into the dialogue without sounding robotic.
- Formats the output according to the UI/UX requirements of the ClozFlow platform.

**Why the Brain cannot function without it:**
Up to this point, the Brain's thoughts are entirely internal — abstract nodes, vectors, and plans (e.g., `Step 1: ACKNOWLEDGE_CONCERN`). A human salesperson cannot read an abstract plan in real-time while talking to a prospect. The Recommendation Engine bridges the gap between the Brain's internal architecture and human communication, rendering abstract strategy into usable words.

---

## 2. Cognitive Objective

**Primary Objective:**
Translate verified execution plans into concrete, stylized, natural-language recommendations, outputting a `RecommendationNode` mutation to the World Model.

**Secondary Objectives:**
- Mirror the buyer's communication style (e.g., using succinct language for a fast-paced buyer, or detailed explanations for an analytical buyer).
- Maintain consistent brand voice and persona for the salesperson.
- Ensure the generated language strictly adheres to the structure mandated by the Planning Engine.

**Optimization Goals:**
- High linguistic quality (persuasive, natural, grammatically flawless).
- Low latency (this is the final heavy LLM step before the user sees the output).

**Cognitive Guarantees:**
- The engine ONLY generates language for the steps provided in the verified plan. It does not invent new strategy.
- The engine incorporates all required knowledge references specified by the plan.
- Output always maps cleanly to the required UI schema (e.g., separating "What to say" from "Why you are saying it").

---

## 3. Internal Philosophy

**How this engine reasons:**
Recommendation reasons through stylistic synthesis. It treats language generation as a constrained optimization problem: Generate text that satisfies the structural constraints of the Plan, includes the data constraints of the Knowledge Refs, and matches the stylistic constraints of the Tone/Persona.

**Its mental model:**
The engine acts as a master copywriter receiving a strict outline from a strategist. The outline is non-negotiable. The copywriter's job is to make the outline sound brilliant, natural, and persuasive.

**What it optimizes:**
Fluency and Persuasion. While earlier engines optimized for accuracy, safety, and strategy, Recommendation optimizes for human impact.

**What uncertainty means inside this engine:**
Uncertainty here relates to linguistic ambiguity. If the LLM generates a phrase that is ambiguous or could be misinterpreted, internal self-correction loops attempt to rewrite it for maximum clarity before final output.

---

## 4. Internal Architecture

```
                    ┌───────────────────────────────────────────┐
                    │        RECOMMENDATION SUBSYSTEM           │
                    │                                           │
                    │  ┌──────────────┐                        │
    World Model ───►│  │ Plan & Context│                        │
    (Verified Plan) │  │ Ingestor      │                        │
                    │  └──────┬───────┘                        │
                    │         │                                 │
                    │         ▼                                 │
                    │  ┌─────────────────────────────────┐    │
                    │  │   Style & Tone Matcher          │    │
                    │  └──────────────┬──────────────────┘    │
                    │                 │                        │
                    │                 ▼                        │
                    │  ┌─────────────────────────────────┐    │
                    │  │   Language Generation Core      │    │
                    │  │   (LLM Orchestrator)            │    │
                    │  └──────────────┬──────────────────┘    │
                    │                 │                        │
                    │       ┌─────────┼──────────┐           │
                    │       ▼         ▼          ▼           │
                    │  ┌────────┐ ┌────────┐ ┌────────┐     │
                    │  │ Script │ │ Hint   │ │ UI     │     │
                    │  │ Builder│ │ Builder│ │ Formatt│     │
                    │  └───┬────┘ └───┬────┘ └───┬────┘     │
                    │      │          │          │           │
                    │      ▼          ▼          ▼           │
                    │  ┌─────────────────────────────────┐   │
                    │  │   Linguistic Polish & QA        │   │
                    │  └──────────────┬──────────────────┘   │
                    │                 │                       │
                    │                 ▼                       │
                    │  ┌─────────────────────────────────┐   │
                    │  │   Mutation Composer             │   │
                    │  └─────────────────────────────────┘   │
                    └───────────────────────────────────────────┘
```

### Component Descriptions

1. **Plan & Context Ingestor** — Pulls the verified `DecisionNode`/`PlanNode` and the contextual history (to ensure the generated text flows naturally from the previous turn).
2. **Style & Tone Matcher** — Determines the required tone (e.g., Empathetic, Authoritative, Succinct) based on the buyer's detected persona and the salesperson's profile.
3. **Language Generation Core** — The primary LLM orchestrator. It receives a heavily structured prompt containing the Plan, Knowledge, and Style guidelines, and generates the raw text.
4. **Script Builder** — Formats the output as a direct script ("Say this: ...").
5. **Hint Builder** — Generates behavioral hints alongside the script (e.g., "Pause here", "Speak slowly").
6. **UI Formatter** — Structures the output into JSON or specific markdown formats required by the frontend application.
7. **Linguistic Polish & QA** — A fast heuristic or small-LLM pass to check for repetition, grammatical errors, or robotic phrasing ("AI-isms").
8. **Mutation Composer** — Packages the final generated content into a `RecommendationNode`.

---

## 5. Internal Managers

| Manager | Responsibility |
|---|---|
| **Prompt Engineering Manager** | Dynamically constructs the generation prompt based on the specific plan steps and available context length. |
| **Persona Manager** | Maintains the database of stylistic constraints for both the buyer and seller to ensure conversational alignment. |
| **Output Schema Manager** | Validates that the generated text conforms to the required data structures before saving to the World Model. |

---

## 6. Internal Repositories

| Repository | Contents | Retention |
|---|---|---|
| **Persona & Style Guidelines** | Linguistic rules for different buyer types | Global |
| **Anti-Pattern Dictionary** | List of phrases to avoid (e.g., overly salesy jargon, common AI phrases like "In conclusion") | Global |
| **Generation History** | Recently generated recommendations to prevent repeating the exact same phrasing in a single session | Session-scoped |

---

## 7. Internal Data Structures

| Structure | Description |
|---|---|
| `GenerationPrompt` | The constructed LLM payload: `{system_instructions, plan_steps[], context[], tone_directives}` |
| `RawUtterance` | The initial LLM output |
| `FormattedRecommendation` | The final structured output: `{script, behavioral_hints, rationale_summary, UI_components}` |

---

## 8. Cognitive Pipeline

```
Stage 1: Ingestion & Style Matching
    │  Receive Plan
    │  Determine required tone (e.g., Direct, Analytical)
    ▼
Stage 2: Prompt Construction
    │  Build the GenerationPrompt combining all constraints
    ▼
Stage 3: LLM Generation
    │  Generate the raw text
    ▼
Stage 4: Structuring & Formatting
    │  Separate text into Script, Hints, and Rationale
    ▼
Stage 5: QA & Polish
    │  Check against Anti-Pattern Dictionary
    │  Ensure all required knowledge was included
    ▼
Stage 6: Mutation Generation
    │  Produce UPSERT_RECOMMENDATION mutation
    ▼
Output: EngineExecutionOutput
```

---

## 9. Internal State Machine

```
    ┌──────────┐
    │   IDLE   │◄────────────────┐
    └────┬─────┘                 │
         │ verified plan rec'd   │
         ▼                       │
    ┌──────────┐                 │
    │PREPARING │ (Style/Prompt)  │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │GENERATING│ (LLM)           │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │FORMATTING│                 │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │ POLISHING│                 │
    └────┬─────┘                 │
         ▼                       │
    ┌──────────┐                 │
    │COMPLETED │─────────────────┘
    └──────────┘
```

---

## 10. Algorithms

### 10.1 Repetition Penalty Algorithm
Before generation, the Prompt Manager analyzes the `GenerationHistory`. It injects explicit negative constraints into the prompt to prevent the LLM from using the same transitional phrases (e.g., "I understand your concern") that were used in the previous 3 turns.

### 10.2 Constraint Satisfaction Check
Post-generation, a deterministic checker verifies that if the Plan required presenting "Data Point X", the string representing Data Point X actually exists in the generated output. If it fails, a fast regeneration is triggered.

---

## 11. Confidence Architecture

**Linguistic Confidence:** Reflects how well the generated text satisfied the structural and stylistic constraints. High confidence means the text perfectly integrated the required knowledge in the required tone.

---

## 12. Failure Handling

| Failure Mode | Recovery Strategy |
|---|---|
| LLM Timeout | Return the raw structural Plan as a "Hint" to the user, bypassing script generation entirely. |
| Constraint Check Failure | If regeneration fails, output the text but append a warning that a specific data point may be missing. |

---

## 13. Optimization Layer

**Streaming Output:** For lower latency perception on the UI side, the Language Generation Core supports streaming tokens directly to the World Model/Event Bus as they are generated, rather than waiting for the entire block to complete.

---

## 14. Learning Hooks

**User Acceptance Rate:** If the salesperson consistently ignores or manually rewrites the generated scripts, the Meta Brain flags the Persona/Style Manager to adjust the prompt tone, indicating a mismatch between the generated style and the user's actual voice.

---

## 15. Governance

**Compliance:** Adheres to CCBS Law V (separation of generation from planning). Ensures it does not "go rogue" and invent new strategies not authorized by the Planning/Decision engines.

---

## 16. Observability

| Metric | Type | Description |
|---|---|---|
| `recommendation.generations` | Counter | Number of recommendations produced |
| `recommendation.llm_latency` | Histogram | Time taken by the generation LLM |
| `recommendation.constraint_failures` | Counter | Number of times regeneration was required due to missing data |

---

## 17. Extension Framework

**Plugin Interfaces:** `OutputFormatter` allows writing custom adapters for different UIs (e.g., formatting output for a web dashboard vs. a mobile push notification vs. AR glasses).

---

## 18. Performance Targets

| Metric | Target |
|---|---|
| End-to-end cycle latency | < 600ms (LLM heavy) |
| Constraint satisfaction rate | > 99% |

---

## 19. Testing

**Unit Tests:** Prompt assembly, anti-pattern detection, UI formatting.
**Integration Tests:** Feed a strict plan requiring specific data points → verify the final text includes those data points and matches the requested persona.

---

## 20. Complete Cognitive Walkthrough

**Scenario:** Verified Plan: [Step 1: Acknowledge (Target: Price), Step 2: Present Evidence (Target: Battlecard_ROI)]. Tone: Succinct.
**Stage 1:** Ingest Plan. Set Tone to Succinct.
**Stage 2:** Prompt built: "Write a 2-sentence response. Acknowledge price concern. Cite that customers see 3x ROI in 6 months."
**Stage 3:** LLM generates: "I hear you on the upfront cost. However, our data shows most clients see a 3x return on that investment within the first six months."
**Stage 4:** Structured into `{ script: "...", hints: ["Speak confidently"] }`.
**Stage 5:** Polish checks pass (no AI-isms, data included).
**Stage 6:** Output `RecommendationNode` mutation.

*End of CCBS Engine Specification — Recommendation Cognitive Subsystem*
