# Security & Isolation Policy

**Project:** Pearl Evaluation Lab  
**Policy Level:** Absolute Isolation

---

## 1. Zero Production Telephony Guarantee
Under no circumstances may any evaluation runner, synthetic simulator, or benchmark suite dial real telephone numbers or dispatch SMS/WhatsApp messages.
* `ALLOW_REAL_TELEPHONY` is hard-coded to `false` in `evaluation.yaml`.
* The adapter layer rejects any attempt to pass E.164 phone numbers to external carrier trunks.
* All voice evaluation relies exclusively on synthetic audio buffers, pre-recorded WAV fixtures, and mocked WebSocket streams.

## 2. Zero Database Contamination
The evaluation lab does not write, mutate, or delete records in `backend/hexagon.db` or any production database.
* All evaluations run in-memory or against isolated SQLite test databases (`./pearl-evaluation-lab/traces/eval_temp.db`).
* Production Knowledge Capsules and Lead records are read-only when accessed through staging adapters.

## 3. Untrusted Input Handling
All prospect personas, simulated responses, and benchmark prompts are treated as untrusted input.
* Evaluation runners do not execute dynamic code (`eval`, `exec`) embedded inside test datasets.
* Injections and adversarial prompts are sanitized before model submission.

## 4. Credential Protection
* API keys are loaded via isolated `.env` configurations inside `./pearl-evaluation-lab/`.
* No API keys, session tokens, or Authorization headers are ever written to benchmark reports, markdown files, or trace logs.
