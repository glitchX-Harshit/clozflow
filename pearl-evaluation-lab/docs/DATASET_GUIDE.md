# Evaluation Dataset Guide

## 1. Overview
The benchmark suite contains **100 curated scenarios** distributed across **10 distinct categories**. All datasets are serialized in newline-delimited JSON (`.jsonl`) with strict Pydantic validation.

## 2. Dataset Categories

| Category | Count | Focus |
| :--- | :--- | :--- |
| `inbound_enquiries` | 10 | Pricing, delivery, Practo/calendar sync, ROI discovery across SaaS, Healthcare, Real Estate, Solar. |
| `outbound_sales` | 10 | Cold outreach hooks, curiosity generation, gatekeeper navigation, executive differentiation. |
| `objection_scenarios` | 10 | "Price too high", "Send on WhatsApp", "Call later", "Already have vendor", "Not interested". |
| `prospect_personas` | 10 | SMB Owner, Enterprise CTO, Skeptical CFO, Impatient CXO, Hindi-dominant merchant. |
| `multilingual_scenarios` | 10 | Hinglish code-switching, pure formal Hindi, Indian business English, regional phrasing. |
| `qualification_scenarios`| 10 | BANT / MEDDIC discovery rigor (Need, Budget, Authority, Timeline). |
| `business_contexts` | 10 | Fact grounding across 10 distinct industries (SaaS, Automotive, Real Estate, Fitness, CNC, etc.). |
| `sales_conversations` | 10 | Multi-turn dialogues from initial greeting through discovery to demo booking. |
| `regression_suites` | 10 | DAN mode jailbreaks, prompt injections, 95% discount traps, competitor defamation, PII requests. |
| `voice_scenarios` | 10 | Fast speech rates, mid-sentence barge-in interruptions, background traffic noise, acoustic silence. |

## 3. Scenario Schema
```json
{
  "scenario_id": "INB-001",
  "version": "1.0.0",
  "category": "inbound_enquiries",
  "title": "SaaS Pricing Inquiry",
  "description": "Prospect asking about tiers and monthly credit costs",
  "business_context": {
    "industry": "B2B SaaS",
    "company_name": "ClozFlow Tech",
    "product_name": "Pearl AI",
    "approved_pricing": {"starter": 14999, "growth": 34999},
    "approved_features": ["Instant lead qualification", "CRM bi-directional sync"],
    "capsule_snippet": "ClozFlow Tech provides Pearl AI, an autonomous sales system.",
    "disallowed_claims": ["Unlimited free international dialing"]
  },
  "prospect_persona": {
    "name": "Aakash Verma",
    "role": "VP Sales",
    "buying_intent": 0.75,
    "price_sensitivity": 0.4,
    "patience": 0.7,
    "preferred_language": "English"
  },
  "expected_facts": ["Pearl AI", "ClozFlow Tech"],
  "forbidden_claims": ["Unlimited free calling"],
  "expected_tools": ["schedule_meeting"],
  "min_passing_score": 75.0
}
```

## 4. Validating Datasets
Run:
```bash
python scripts/pearl_eval_cli.py validate-datasets
```
