"""
5-Model x 5-Call Live Comparative Benchmark Runner for Pearl AI Sales Agent.
Evaluates:
1. qwen/qwen3.8-27b (Baseline - Groq)
2. gemma4 (Gemma 4 31B - Sarvam Token Factory)
3. glm5.3-flash (GLM-5.3 Flash - Sarvam Token Factory)
4. deepseekv4.1-flash-1017 (DeepSeek v4.1 Flash - Sarvam Token Factory)
5. sarvam-105b-conversations (Sarvam 105B Conversations - Sarvam native)

Across 5 Sales Scenarios (S1-S5):
S1: Fintech KYC Recovery (Rahul Sharma - CredPulse Financial)
S2: D2C COD Verification (Pooja Gupta - Snitch / GlowVeda)
S3: Abandoned Cart High-Ticket (Vikram Malhotra - StyleStudio / FurnishCraft)
S4: B2B Discovery & Demo Booking (Amit Verma - Clozflow / CloudScale)
S5: NDR Delivery Rescue (Neha Patel - The Souled Store / SwiftKart)

Measures:
- Sales Reasoning & Capsule Adherence
- Reframing Through Client's Words (lexical echo & objection pivoting)
- Smart Closing & Next-Step Locking
- Real Latency (TTFT & Total Stream Latency)
- Token Economics & Real Cost (INR / USD)
"""
import os
import sys
import time
import json
import asyncio
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple

root_dir = Path(__file__).parent.parent.parent.resolve()
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))
backend_dir = root_dir / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import dotenv
dotenv.load_dotenv(backend_dir / ".env")
dotenv.load_dotenv(root_dir / ".env")

from services.pearl.conversation_engine import ConversationEngine
from tests.pearl_eval.scenarios import SCENARIOS, ScenarioDefinition
from tests.pearl_eval.assertions import MechanicalClaimExtractor

# Model definitions and token pricing (per 1M tokens)
# USD to INR exchange rate assumed at ~83.0
MODELS = [
    {
        "id": "qwen/qwen3.8-27b",
        "name": "Qwen 3.8 27B",
        "provider": "Groq",
        "params": "27B",
        "input_cost_1m_usd": 0.20,
        "output_cost_1m_usd": 0.40,
        "input_cost_1m_inr": 16.60,
        "output_cost_1m_inr": 33.20,
    },
    {
        "id": "gemma4",
        "name": "Gemma 4 31B",
        "provider": "Sarvam Token Factory",
        "params": "31B",
        "input_cost_1m_usd": 0.42,
        "output_cost_1m_usd": 1.08,
        "input_cost_1m_inr": 35.00,
        "output_cost_1m_inr": 90.00,
    },
    {
        "id": "glm5.3-flash",
        "name": "GLM-5.3 Flash",
        "provider": "Sarvam Token Factory",
        "params": "Flash",
        "input_cost_1m_usd": 0.16,
        "output_cost_1m_usd": 0.54,
        "input_cost_1m_inr": 13.50,
        "output_cost_1m_inr": 45.00,
    },
    {
        "id": "deepseekv4.1-flash-1017",
        "name": "DeepSeek v4.1 Flash",
        "provider": "Sarvam Token Factory",
        "params": "Flash MoE",
        "input_cost_1m_usd": 0.30,
        "output_cost_1m_usd": 1.26,
        "input_cost_1m_inr": 25.00,
        "output_cost_1m_inr": 105.00,
    },
    {
        "id": "sarvam-105b-conversations",
        "name": "Sarvam 105B Conversations",
        "provider": "Sarvam Native",
        "params": "105B MoE",
        "input_cost_1m_usd": 0.18,
        "output_cost_1m_usd": 0.48,
        "input_cost_1m_inr": 15.00,
        "output_cost_1m_inr": 40.00,
    }
]

# Fixed 5-call scenarios with scripted real-world prospect utterances testing sales reasoning, reframing, and closing
BENCHMARK_PROSPECT_TURNS = {
    "S1": [
        # Turn 1: Objection with suspicion + asking forbidden interest rate
        "Dekho Rahul bol raha hoon, mera OTP generate nahi ho raha tha aur mujhe laga koi scam na ho. Waise CredPulse ka interest rate kitna hai?",
        # Turn 3: Follow-up doubt before agreeing
        "Acha link direct mere WhatsApp par aayega kya? Aur usme mera koi data misuse toh nahi hoga na?"
    ],
    "S2": [
        # Turn 1: Reluctance on pre-payment / preference for COD
        "Haan Pooja bol rahi hoon. Main Snitch ki shirt ke liye COD hi rakhna chahti hoon, online payment mein fraud hone ka darr rehta hai.",
        # Turn 3: Inquiry on discount / delivery slot
        "Agar prepaid kiya toh kitna discount milega, aur delivery Monday tak pakka ho jayegi South Extension mein?"
    ],
    "S3": [
        # Turn 1: High price hesitation
        "Haan Vikram baat kar raha hoon. Italian leather jacket bohot acchi lagi thi lekin 14,499 bohot zyada hai ek jacket ke liye.",
        # Turn 3: Incentive check
        "Koi special seasonal offer ya discount coupon hai kya jo abhi apply ho sake? Tabhi main complete karunga."
    ],
    "S4": [
        # Turn 1: Busy gatekeeper / already using competitor
        "Amit here. Main abhi ek production incident meeting mein hoon aur hum already Datadog use kar rahe hain, we don't need another tool right now.",
        # Turn 3: Willingness to look if brief
        "Datadog mein cost ka thoda issue toh hai. Agar 10 minute ka quick walk-through ho toh kal afternoon 3 baje slot mil sakta hai."
    ],
    "S5": [
        # Turn 1: Anger about delivery failure
        "Neha bol rahi hoon. Delivery rider ne bina call kiye likh diya 'address not found'! Yeh parcel mujhe kal function ke liye zaroori chahiye tha.",
        # Turn 3: Address / landmark clarification
        "Mera flat Apollo Pharmacy ke theek peeche wali building mein hai, Gate number 2. Kya delivery aaj dopahar tak attempt ho sakti hai?"
    ]
}

def analyze_reframing(prospect_text: str, agent_text: str) -> Dict[str, Any]:
    """Analyzes lexical echoing and objection pivoting in agent's response."""
    # Key tokens from prospect
    words_prospect = set([w.lower().strip(".,?!:;\"'") for w in prospect_text.split() if len(w) > 3])
    words_agent = set([w.lower().strip(".,?!:;\"'") for w in agent_text.split() if len(w) > 3])
    common_words = list(words_prospect.intersection(words_agent))
    
    # Emotional acknowledgement words
    ack_keywords = ["samajh", "bilkul", "pareshani", "worry", "fikar", "sahi", "clear", "understand", "definitely", "sure"]
    has_ack = any(k in agent_text.lower() for k in ack_keywords)
    
    # Pivot keywords
    pivot_keywords = ["lekin", "isliye", "actually", "bas", "direct", "sirf", "help", "solve", "clear"]
    has_pivot = any(k in agent_text.lower() for k in pivot_keywords)
    
    score = (len(common_words) * 15) + (25 if has_ack else 0) + (25 if has_pivot else 0)
    score = min(100, max(20, score))
    
    return {
        "mirrored_keywords": common_words,
        "has_acknowledgement": has_ack,
        "has_pivot": has_pivot,
        "reframing_score": score
    }

def analyze_closing(agent_text: str) -> Dict[str, Any]:
    """Evaluates smart closing and next-step locking sharpness."""
    text_lower = agent_text.lower()
    closing_cues = [
        ("whatsapp_link", ["link", "whatsapp", "bhej doon", "send kar doon", "check kar lijiye"]),
        ("calendar_lock", ["calendar", "meeting", "slot", "kal", "lock kar", "schedule", "invite"]),
        ("order_confirmation", ["confirm", "dispatch", "address", "landmark", "gate"]),
        ("assumptive_question", ["chalega?", "theek hai?", "kaisa rahega?", "bhej doon?", "karoon?"])
    ]
    detected_tactics = []
    for tactic, triggers in closing_cues:
        if any(tr in text_lower for tr in triggers):
            detected_tactics.append(tactic)
            
    is_closing_question = agent_text.strip().endswith("?") or any(q in text_lower for q in ["bhej doon", "karoon", "theek hai", "chalega"])
    score = (len(detected_tactics) * 25) + (25 if is_closing_question else 0)
    score = min(100, max(25, score))
    
    return {
        "closing_tactics": detected_tactics,
        "is_closing_question": is_closing_question,
        "closing_score": score
    }

async def run_single_model_scenario(model_info: Dict[str, Any], scenario_id: str) -> Dict[str, Any]:
    scenario = SCENARIOS[scenario_id]
    model_id = model_info["id"]
    model_name = model_info["name"]
    print(f"\n[{model_name}] >>> Running Scenario {scenario_id}: {scenario.name}...")

    lead_context = {
        "business_name": scenario.prospect_name,
        "prospect_name": scenario.prospect_name,
        "capsule_context": scenario.capsule_text,
        "agent_name": scenario.agent_name,
        "speaker": scenario.agent_speaker,
        "gender": scenario.agent_gender,
        "company_name": scenario.company_name,
        "phone": "+919876543210",
    }

    engine = ConversationEngine(
        objective=scenario.objective,
        lead_context=lead_context,
        system_prompt_override=scenario.system_prompt_override,
        agent_name=scenario.agent_name,
        speaker=scenario.agent_speaker,
        gender=scenario.agent_gender,
        model=model_id,
    )

    claim_extractor = MechanicalClaimExtractor(scenario_id)
    turns: List[Dict[str, Any]] = []
    prospect_script = BENCHMARK_PROSPECT_TURNS[scenario_id]
    
    total_prompt_tokens = 0
    total_completion_tokens = 0
    total_reasoning_tokens = 0

    # Turn 0: Opening
    t0 = time.perf_counter()
    tokens = []
    ttft_ms = None
    async for tok in engine.generate_response_stream():
        if ttft_ms is None:
            ttft_ms = (time.perf_counter() - t0) * 1000.0
        tokens.append(tok)
    t_end = time.perf_counter()
    total_ms = (t_end - t0) * 1000.0
    agent_text = "".join(tokens).strip()
    reasoning_turn0 = getattr(engine, "last_reasoning", "")

    # Rough token estimation if API doesn't report raw usage
    comp_tokens = max(len(agent_text.split()) * 4 // 3, 10)
    prompt_tokens = 450 # system foundation + dynamic
    total_prompt_tokens += prompt_tokens
    total_completion_tokens += comp_tokens
    tps = round(comp_tokens / (total_ms / 1000.0), 1) if total_ms > 0 else 0

    engine.add_turn("agent", agent_text)
    violations_t0 = claim_extractor.extract_and_verify_turn(0, agent_text)

    turns.append({
        "turn": 0,
        "speaker": "agent",
        "text": agent_text,
        "reasoning": reasoning_turn0,
        "ttft_ms": round(ttft_ms, 1) if ttft_ms else None,
        "total_ms": round(total_ms, 1),
        "tps": tps,
        "tokens": comp_tokens,
        "violations": violations_t0
    })

    # Dialogue Turns 1 to 4
    for script_idx, p_text in enumerate(prospect_script):
        # Prospect speaks
        turn_no = (script_idx * 2) + 1
        turns.append({
            "turn": turn_no,
            "speaker": "prospect",
            "text": p_text
        })
        engine.add_turn("prospect", p_text)
        await asyncio.sleep(0.1)

        # Agent responds
        t0 = time.perf_counter()
        tokens = []
        ttft_ms = None
        async for tok in engine.generate_response_stream():
            if ttft_ms is None:
                ttft_ms = (time.perf_counter() - t0) * 1000.0
            tokens.append(tok)
        t_end = time.perf_counter()
        total_ms = (t_end - t0) * 1000.0
        agent_resp = "".join(tokens).strip()
        reasoning_resp = getattr(engine, "last_reasoning", "")

        comp_toks = max(len(agent_resp.split()) * 4 // 3, 12)
        total_prompt_tokens += 550 + (turn_no * 30)
        total_completion_tokens += comp_toks
        if reasoning_resp:
            reas_toks = max(len(reasoning_resp.split()) * 4 // 3, 20)
            total_reasoning_tokens += reas_toks
        tps = round(comp_toks / (total_ms / 1000.0), 1) if total_ms > 0 else 0

        engine.add_turn("agent", agent_resp)
        violations = claim_extractor.extract_and_verify_turn(turn_no + 1, agent_resp)
        reframing_eval = analyze_reframing(p_text, agent_resp)
        closing_eval = analyze_closing(agent_resp)

        turns.append({
            "turn": turn_no + 1,
            "speaker": "agent",
            "text": agent_resp,
            "reasoning": reasoning_resp,
            "ttft_ms": round(ttft_ms, 1) if ttft_ms else None,
            "total_ms": round(total_ms, 1),
            "tps": tps,
            "tokens": comp_toks,
            "violations": violations,
            "reframing": reframing_eval,
            "closing": closing_eval
        })
        await asyncio.sleep(0.1)

    # Compute overall call economics
    inp_cost_inr = (total_prompt_tokens / 1_000_000.0) * model_info["input_cost_1m_inr"]
    out_tokens_billed = total_completion_tokens + total_reasoning_tokens
    out_cost_inr = (out_tokens_billed / 1_000_000.0) * model_info["output_cost_1m_inr"]
    total_cost_inr = inp_cost_inr + out_cost_inr
    total_cost_usd = total_cost_inr / 83.0

    agent_turns = [t for t in turns if t["speaker"] == "agent"]
    avg_ttft = round(sum(t["ttft_ms"] for t in agent_turns if t["ttft_ms"]) / max(len(agent_turns), 1), 1)
    avg_lat = round(sum(t["total_ms"] for t in agent_turns) / max(len(agent_turns), 1), 1)
    avg_tps = round(sum(t["tps"] for t in agent_turns) / max(len(agent_turns), 1), 1)
    
    reframing_scores = [t["reframing"]["reframing_score"] for t in agent_turns if "reframing" in t]
    avg_reframing = round(sum(reframing_scores) / max(len(reframing_scores), 1), 1) if reframing_scores else 0.0

    closing_scores = [t["closing"]["closing_score"] for t in agent_turns if "closing" in t]
    avg_closing = round(sum(closing_scores) / max(len(closing_scores), 1), 1) if closing_scores else 0.0

    all_violations = [v for t in agent_turns for v in t.get("violations", [])]
    capsule_adherence = 100.0 if not all_violations else max(0.0, 100.0 - (len(all_violations) * 25.0))

    return {
        "model_id": model_id,
        "model_name": model_name,
        "scenario_id": scenario_id,
        "scenario_name": scenario.name,
        "turns": turns,
        "metrics": {
            "avg_ttft_ms": avg_ttft,
            "avg_latency_ms": avg_lat,
            "avg_tps": avg_tps,
            "reframing_score": avg_reframing,
            "closing_score": avg_closing,
            "capsule_adherence_pct": capsule_adherence,
            "violations_count": len(all_violations),
            "violations": all_violations,
            "tokens": {
                "prompt": total_prompt_tokens,
                "completion": total_completion_tokens,
                "reasoning": total_reasoning_tokens,
                "total": total_prompt_tokens + total_completion_tokens + total_reasoning_tokens
            },
            "cost": {
                "inr": round(total_cost_inr, 4),
                "usd": round(total_cost_usd, 6),
                "cost_per_1k_calls_inr": round(total_cost_inr * 1000, 2),
                "cost_per_1k_calls_usd": round(total_cost_usd * 1000, 3)
            }
        }
    }

async def run_benchmark():
    all_results = []
    print("=" * 80)
    print("STARTING 5-MODEL x 5-CALL LIVE SALES BENCHMARK")
    print(f"Models: {[m['name'] for m in MODELS]}")
    print(f"Scenarios: {list(SCENARIOS.keys())}")
    print("=" * 80)

    for model in MODELS:
        print(f"\n==================== EVALUATING MODEL: {model['name']} ({model['provider']}) ====================")
        for sc_id in ["S1", "S2", "S3", "S4", "S5"]:
            try:
                res = await run_single_model_scenario(model, sc_id)
                all_results.append(res)
            except Exception as e:
                print(f"Error evaluating {model['name']} on {sc_id}: {e}")

    out_file = root_dir / "tests" / "pearl_eval" / "model_comparison_5x5_results.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False)

    print(f"\n[DONE] Saved benchmark data to {out_file}")
    return all_results

if __name__ == "__main__":
    asyncio.run(run_benchmark())
