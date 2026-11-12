"""
Dancing Cow Oatish Oat Milk Live Sales Test Runner.
Capsule: Oatish Extra Creamy Plant-Based Oat Milk (Pack of 12)
Brand: Dancing Cow (https://dancingcow.in)
Engine: Qwen 3.8 27B on Groq (reasoning_effort='none')

Runs 3 authentic, complete sales calls with realistic customer objections:
1. Call 1: Hot Chai/Coffee splitting & watery texture objection.
2. Call 2: Price comparison against regular cow milk (60 Rs vs premium).
3. Call 3: Clean ingredients, hidden oils & artificial thickener skepticism.
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

OATISH_CAPSULE_TEXT = """
Company: Dancing Cow (dancingcow.in)
Product: Oatish Extra Creamy Plant-Based Oat Milk (Pack of 12)
Key Features:
- Unique proprietary blend of Oats, Millets, and Mung Beans (barista-grade extra creamy foam)
- Pea isolate for protein, fortified with Vitamin B12, Vitamin B1, and Calcium
- 100% Vegan, Dairy-free, Lactose-free, Gluten-free, and Cholesterol-free
- Zero added sugar (natural mild sweetness from enzymatic oat breakdown)
- Shelf-stable with 12-month shelf life (store at room temp until opened)
- Barista-friendly: Does NOT split or curdle in hot Indian chai or espresso coffee
- Free Mug and 2x Oatish Chocolates included with every Pack of 12
- Social Mission: For every 10,000 cartons sold, 1 animal is rescued via Animal Almighty Trust Sanctuary
STRICT RULES:
1. Speak in natural conversational Roman Hinglish (feminine grammar: "main batati hoon", "share kar rahi hoon").
2. Turns must be punchy (15-25 words). Never lecture or recite bullet points.
3. Address customer by first name, never append 'ji'.
4. Reframe objections through empathy and the unique millets+mung beans creamy blend.
5. Close by asking to send WhatsApp order link with the Free Mug & Chocolates offer.
"""

OAT_MILK_CALLS = [
    {
        "id": "OAT_CALL_1",
        "title": "Chai/Coffee Splitting & Watery Texture Objection",
        "prospect_name": "Karan Malhotra",
        "first_name": "Karan",
        "turns": [
            "Listen, maine pehle do brands ke oat milk try kiye the. Chai mein daalte hi curdle ho gaya aur bilkul watery paani jaisa taste tha. Main regular cow milk hi theek hoon.",
            "Acha yeh guarantee hai ki adrak wali kadak chai mein nahi phatega? Aur pack of 12 bohot bada commitment hai try karne ke liye."
        ]
    },
    {
        "id": "OAT_CALL_2",
        "title": "Price Objection vs Regular Dairy Milk",
        "prospect_name": "Rhea Sen",
        "first_name": "Rhea",
        "turns": [
            "Hi, dekhiye Amul cow milk toh 60-70 rupaye ka packet aata hai. Oat milk 3 guna mehenga lena mere monthly grocery budget ke liye sense nahi banata.",
            "Acha Pack of 12 mein koi discount ya introductory offer chal raha hai kya abhi?"
        ]
    },
    {
        "id": "OAT_CALL_3",
        "title": "Clean Label & Seed Oil Skepticism",
        "prospect_name": "Dr. Sameer Kapoor",
        "first_name": "Sameer",
        "turns": [
            "Dekhiye market mein jitne oat milk hain sabme refined palm oil ya canola oil aur synthetic gums daale hote hain to make it thick. Oatish mein aisa kuch toh nahi hai na? Sugar kitna hai?",
            "Calcium aur Vitamin B12 actual dairy milk jitna hai ya sirf marketing claim hai?"
        ]
    }
]

async def run_single_oat_call(call_def: dict) -> dict:
    lead_context = {
        "business_name": call_def["prospect_name"],
        "prospect_name": call_def["prospect_name"],
        "capsule_context": OATISH_CAPSULE_TEXT,
        "agent_name": "Pearl",
        "speaker": "pooja_hi_conversational",
        "gender": "Female",
        "company_name": "Dancing Cow",
        "phone": "+919876543210",
    }

    engine = ConversationEngine(
        objective="Qualify prospect, resolve oat milk skepticism, and send WhatsApp link for Oatish Pack of 12",
        lead_context=lead_context,
        system_prompt_override=OATISH_CAPSULE_TEXT,
        agent_name="Pearl",
        speaker="pooja_hi_conversational",
        gender="Female",
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
        "total_ms": round(total_ms, 1),
        "word_count": len(agent_text.split())
    })

    # Dialogue turns
    for idx, p_text in enumerate(call_def["turns"]):
        await asyncio.sleep(2.5)  # Avoid Groq rate limits

        turn_no = (idx * 2) + 1
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

    return {
        "call_id": call_def["id"],
        "title": call_def["title"],
        "prospect_name": call_def["prospect_name"],
        "turns": turns
    }

async def main():
    print("=" * 80)
    print("RUNNING LIVE OAT MILK (DANCING COW) SALES CALLS")
    print("=" * 80)

    results = []
    for call_def in OAT_MILK_CALLS:
        print(f"\nExecuting {call_def['title']} for {call_def['prospect_name']}...")
        res = await run_single_oat_call(call_def)
        results.append(res)
        await asyncio.sleep(2.5)

    out_file = root_dir / "tests" / "pearl_eval" / "oat_milk_test_results.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\n[DONE] Saved results to {out_file}")

if __name__ == "__main__":
    asyncio.run(main())
