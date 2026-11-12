"""
Hard Objection Live Benchmark for Pearl Voice Sales Agent
Testing Qwen 3.8 27B with reasoning_effort='none' under hostile, difficult objections:
- Call 1 (Fintech S1): Fraud accusation, Aadhaar theft threat, demand for Employee ID & RBI claim.
- Call 2 (D2C S2): Angry product complaint (fabric shrank), aggressive order cancellation demand.
- Call 3 (B2B S4): Privacy invasion accusation, TRAI reporting threat, immediate DNC demand.
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

HARD_OBJECTIONS = {
    "S1": [
        "Listen, mera bank account se kal 5000 kata tha! Mujhe lagta hai CredPulse ek fraud company hai. Tum log mera Aadhaar data chura rahe ho, employee ID batao apna pehle!",
        "Aapki company RBI se approved hai kya? Aur agar maine WhatsApp link click kiya aur mera phone hack ho gaya toh kaun responsible hoga?"
    ],
    "S2": [
        "Arey baar baar call karke dimaag mat kharab karo! Snitch ki shirt last time washing machine mein shrink ho gayi thi, quality bekar hai. Cancel karo yeh order, mujhe koi shirt nahi chahiye!",
        "Agar free delivery aur flat 200 discount doge toh hi main sochungi, warna abhi cancel karo."
    ],
    "S4": [
        "Where did you get my direct mobile number from? This is illegal cold calling and harassment. I'm reporting this number to TRAI right now!",
        "I told you I don't want telemarketing calls. Do you understand what Do Not Call means? Never call me again!"
    ]
}

async def run_hard_call(scenario_id: str) -> dict:
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
        reasoning_effort="none",
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
        "total_ms": round(total_ms, 1)
    })

    # Hard Objection Turns
    for script_idx, p_text in enumerate(HARD_OBJECTIONS[scenario_id]):
        await asyncio.sleep(2.5)  # Pace calls to respect Groq rate limits
        
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
            "total_ms": round(total_ms, 1)
        })

    return {
        "scenario_id": scenario_id,
        "scenario_name": scenario.name,
        "turns": turns
    }

async def main():
    results = []
    print("=" * 80)
    print("RUNNING LIVE HARD OBJECTIONS TEST (QWEN 3.8 27B | REASONING=NONE)")
    print("=" * 80)

    for sc in ["S1", "S2", "S4"]:
        print(f"\n>>> Executing Hard Objection Call: {sc}...")
        res = await run_hard_call(sc)
        results.append(res)
        await asyncio.sleep(2.5)

    out_file = root_dir / "tests" / "pearl_eval" / "hard_objections_results.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\n[DONE] Saved hard objection benchmark to {out_file}")

if __name__ == "__main__":
    asyncio.run(main())
