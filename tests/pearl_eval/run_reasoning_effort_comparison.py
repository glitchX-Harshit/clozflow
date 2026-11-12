"""
Comparison Runner: Reasoning Effort = 'high' (Max) vs 'none' (None) for Qwen 3.8 27B
Runs 3 complete sales conversations per condition:
- S1: Fintech KYC Recovery (Rahul Sharma - CredPulse Financial)
- S2: D2C COD Verification (Pooja Gupta - Snitch / GlowVeda)
- S4: B2B Discovery (Amit Verma - Clozflow / CloudScale)

Measures:
- TTFT (ms)
- Turn Latency (ms)
- Tokens generated
- Hinglish Naturalness & Idiomatic flow
- Reframing Quality
- Closing Sharpness
"""
import os
import sys
import time
import json
import asyncio
from pathlib import Path

root_dir = Path(__file__).parent.parent.parent.resolve()
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))
backend_dir = root_dir / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import dotenv
dotenv.load_dotenv(backend_dir / ".env")

from services.pearl.conversation_engine import ConversationEngine
from tests.pearl_eval.scenarios import SCENARIOS

PROSPECT_TURNS = {
    "S1": [
        "Dekho Rahul bol raha hoon, mera OTP generate nahi ho raha tha aur mujhe laga koi scam na ho. Waise CredPulse ka interest rate kitna hai?",
        "Acha link direct mere WhatsApp par aayega kya? Aur usme mera koi data misuse toh nahi hoga na?"
    ],
    "S2": [
        "Haan Pooja bol rahi hoon. Main Snitch ki shirt ke liye COD hi rakhna chahti hoon, online payment mein fraud hone ka darr rehta hai.",
        "Agar prepaid kiya toh kitna discount milega, aur delivery Monday tak pakka ho jayegi South Extension mein?"
    ],
    "S4": [
        "Amit here. Main abhi ek production incident meeting mein hoon aur hum already Datadog use kar rahe hain, we don't need another tool right now.",
        "Datadog mein cost ka thoda issue toh hai. Agar 10 minute ka quick walk-through ho toh kal afternoon 3 baje slot mil sakta hai."
    ]
}

async def run_scenario_with_effort(scenario_id: str, effort: str) -> dict:
    scenario = SCENARIOS[scenario_id]
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
        model="qwen/qwen3.8-27b",
        reasoning_effort=effort,
    )

    turns = []
    
    # Turn 0: Opening
    t0 = time.perf_counter()
    tokens = []
    ttft_ms = None
    async for tok in engine.generate_response_stream():
        if ttft_ms is None:
            ttft_ms = (time.perf_counter() - t0) * 1000.0
        tokens.append(tok)
    total_ms = (time.perf_counter() - t0) * 1000.0
    agent_text = "".join(tokens).strip()
    engine.add_turn("agent", agent_text)

    turns.append({
        "turn": 0,
        "speaker": "agent",
        "text": agent_text,
        "ttft_ms": round(ttft_ms, 1) if ttft_ms else None,
        "total_ms": round(total_ms, 1),
        "word_count": len(agent_text.split())
    })

    # Dialogue Turns 1 to 4
    for script_idx, p_text in enumerate(PROSPECT_TURNS[scenario_id]):
        # Add pause to avoid Groq 429 rate limit
        await asyncio.sleep(2.0)
        
        turn_no = (script_idx * 2) + 1
        turns.append({
            "turn": turn_no,
            "speaker": "prospect",
            "text": p_text
        })
        engine.add_turn("prospect", p_text)

        t0 = time.perf_counter()
        tokens = []
        ttft_ms = None
        async for tok in engine.generate_response_stream():
            if ttft_ms is None:
                ttft_ms = (time.perf_counter() - t0) * 1000.0
            tokens.append(tok)
        total_ms = (time.perf_counter() - t0) * 1000.0
        agent_resp = "".join(tokens).strip()
        engine.add_turn("agent", agent_resp)

        turns.append({
            "turn": turn_no + 1,
            "speaker": "agent",
            "text": agent_resp,
            "ttft_ms": round(ttft_ms, 1) if ttft_ms else None,
            "total_ms": round(total_ms, 1),
            "word_count": len(agent_resp.split())
        })

    agent_turns = [t for t in turns if t["speaker"] == "agent"]
    avg_ttft = sum(t["ttft_ms"] for t in agent_turns if t["ttft_ms"]) / len(agent_turns)
    avg_tot = sum(t["total_ms"] for t in agent_turns) / len(agent_turns)
    avg_words = sum(t["word_count"] for t in agent_turns) / len(agent_turns)

    return {
        "scenario_id": scenario_id,
        "scenario_name": scenario.name,
        "reasoning_effort": effort,
        "avg_ttft_ms": round(avg_ttft, 1),
        "avg_total_ms": round(avg_tot, 1),
        "avg_words": round(avg_words, 1),
        "turns": turns
    }

async def main():
    results = {"high": [], "none": []}
    
    print("=" * 80)
    print("STARTING TEST: REASONING_EFFORT = 'high' (MAX) vs 'none' (NONE)")
    print("=" * 80)

    for effort in ["none", "high"]:
        print(f"\n>>> Running condition: reasoning_effort = '{effort}'...")
        for sc in ["S1", "S2", "S4"]:
            print(f"  Executing Scenario {sc}...")
            res = await run_scenario_with_effort(sc, effort)
            results[effort].append(res)
            # Sleep between calls to respect Groq rate limits
            await asyncio.sleep(2.5)

    out_file = root_dir / "tests" / "pearl_eval" / "reasoning_effort_comparison_results.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\n[DONE] Saved results to {out_file}")

if __name__ == "__main__":
    asyncio.run(main())
