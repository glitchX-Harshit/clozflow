# Pearl Evaluation Lab

> **Production-Grade Standalone AI Evaluation & Benchmarking Framework for Pearl AI**

Pearl Evaluation Lab is an independent, reproducible evaluation engineering system designed to benchmark, diagnose, and verify ClozFlow's autonomous sales agent (`Pearl`).

It measures Pearl's performance across **factual accuracy, groundedness, retrieval quality, sales reasoning, objection handling, lead qualification, tool execution, safety compliance, and real-time voice latency**.

---

## Key Highlights

- **100% Isolated:** Lives entirely inside `./pearl-evaluation-lab`. Can be deleted at any time without affecting ClozFlow.
- **Zero Production Risk:** Absolutely zero production telephone calls, message dispatching, or database writes.
- **Flexible Adapters:** Evaluate Pearl via **Mock Replay**, **Direct In-Memory Python Engine**, or **Local Test Session API**.
- **100 Realistic Sales Scenarios:** Versioned datasets covering B2B SaaS, real estate, healthcare, code-switching Hinglish, pricing pushback, and BANT qualification.
- **Dynamic Synthetic Customer Simulator:** Stateful personas with fluctuating buying intent, price sensitivity, and objections.
- **Regression Framework:** Compare candidate releases against baseline benchmarks with strict pass/fail quality gates.
- **Multi-Format Reporting:** Markdown, HTML visual dashboards, JSON, and CSV exports.

---

## Quickstart

### 1. Install & Setup
```bash
cd pearl-evaluation-lab
pip install -e .
cp .env.example .env
```

### 2. Inspect Available Adapters
```bash
pearl-eval inspect
```

### 3. Validate Benchmark Datasets
```bash
pearl-eval validate-datasets
```

### 4. Run Evaluation Suite
```bash
# Run with Mock Adapter (offline, zero API keys required)
pearl-eval run --adapter mock --dataset all

# Run specific category
pearl-eval run --adapter mock --category objection_scenarios

# Run with Local API Adapter (requires ClozFlow backend running locally)
pearl-eval run --adapter api --category sales_conversations
```

### 5. Compare Benchmark Runs (Regression Testing)
```bash
pearl-eval regression --baseline reports/baseline_v1.json --candidate reports/candidate_run.json
```

---

## Directory Structure

```text
pearl-evaluation-lab/
├── docs/                # Architecture discovery and evaluation methodology
├── configs/             # Independent evaluation profiles
├── adapters/            # Safe interfaces (Mock, Direct Module, Local API)
├── datasets/            # 100+ versioned sales evaluation scenarios
├── simulators/          # Dynamic synthetic customer simulator
├── runners/             # Scenario orchestrator & batch execution
├── evaluators/          # 10-dimension evaluation engine (deterministic + LLM judge)
├── metrics/             # Scoring rubrics and weighting logic
├── benchmarks/          # Immutable baselines and target scorecards
├── traces/              # Sanitized conversation logs and traces
├── reports/             # HTML, Markdown, and JSON evaluation reports
├── tests/               # Full test suite for the lab itself
└── scripts/             # Maintenance and execution utilities
```

---

## Deletion Instructions

The evaluation lab is completely self-contained. To remove it completely without touching ClozFlow:
```bash
rm -rf ./pearl-evaluation-lab
```
