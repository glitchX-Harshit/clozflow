# Pearl Evaluation Lab — System Architecture

## 1. Overview
The **Pearl Evaluation Lab** is a standalone, production-grade AI benchmarking and evaluation framework designed exclusively to test, diagnose, and benchmark **Pearl**—Clozflow's autonomous AI sales representative.

```mermaid
flowchart TD
    subgraph PearlEvalLab ["Pearl Evaluation Lab (Isolated Directory)"]
        CLI["CLI (pearl-eval)"] --> Runner["Evaluation Runner"]
        Runner --> Sim["Customer Simulator"]
        Sim --> Persona["Persona Engine"]
        Sim --> Dialogue["Dialogue Engine"]
        
        Runner --> Adapters["Pearl Adapter Layer"]
        Adapters --> MockAdapter["MockPearlAdapter (Offline CI)"]
        Adapters --> DirectAdapter["DirectModulePearlAdapter (In-Memory)"]
        Adapters --> APIAdapter["LocalApiPearlAdapter (HTTP Sandbox)"]
        
        Runner --> Engine["Evaluation Engine (10 Dimensions)"]
        Engine --> Metrics["Metrics & Scorer (PQI Index)"]
        Metrics --> Benchmarks["Benchmark Baseline Store"]
        Benchmarks --> Regression["Regression Comparator (CI Gate)"]
        Metrics --> Reports["Report Generator (MD, HTML, JSON, CSV)"]
        Runner --> Traces["Trace Storage (traces/)"]
    end

    subgraph ClozFlowApp ["ClozFlow Core (Untouched / Read-Only)"]
        ConvEngine["backend/services/pearl/conversation_engine.py"]
        VoiceSession["backend/services/pearl/voice_session.py"]
        FastAPIEndpoint["backend/routers/pearl.py (/api/pearl/test-sessions)"]
    end

    DirectAdapter -.->|In-Memory Call (No DB Write)| ConvEngine
    APIAdapter -.->|HTTP localhost (Opt-in)| FastAPIEndpoint
```

## 2. Core Architectural Principles
1. **Absolute Non-Invasiveness**:
   - Zero production files modified.
   - Zero production dependencies added.
   - Zero production database writes (`backend/hexagon.db` is never opened or written).
   - Zero telephony execution (`allow_real_telephony: false` unconditionally enforced).
2. **Total Removability**:
   - The lab can be permanently deleted with `rm -rf pearl-evaluation-lab` without impacting Clozflow application startup, tests, or deployment.
3. **Deterministic Replay & Reproducibility**:
   - Seeded random generation (`seed=42`) ensures deterministic customer conversations in CI.
   - Offline `MockPearlAdapter` enables 100% test execution in air-gapped CI environments without API keys or cloud spend.
4. **Multi-Faceted Evaluation**:
   - Combines deterministic reference fact matching, guardrail safety testing, BANT qualification checks, and voice latency profiling.

## 3. Directory Layout
```
pearl-evaluation-lab/
├── adapters/              # Adapter layer (Mock, Direct, API)
├── benchmarks/            # Golden baseline snapshots
├── configs/               # Evaluation profiles and environment configs
├── datasets/              # 10 categories, 100 benchmark scenarios
├── docs/                  # Architecture & operational guides
├── evaluators/            # 10 evaluation dimensions (Safety, Groundedness, Voice, etc.)
├── metrics/               # PQI calculation and dimension weights
├── pearl_eval/            # CLI engine
├── reports/               # Generated Markdown, HTML, JSON, CSV reports
├── runners/               # Batch orchestration and concurrency pools
├── scripts/               # Executable utility wrappers
├── simulators/            # Stateful prospect persona and dialogue engine
├── tests/                 # Unit, integration, and isolation tests
├── traces/                # Sanitized execution traces
├── evaluation.yaml        # Root configuration
├── pyproject.toml         # Standalone dependency manifest
└── README.md              # Getting started guide
```
