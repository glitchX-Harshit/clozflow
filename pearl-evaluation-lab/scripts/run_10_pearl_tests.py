import os
import sys
import json
import time
import asyncio
from pathlib import Path

# Setup paths
repo_root = Path(__file__).parent.parent.parent.resolve()
backend_dir = repo_root / "backend"
lab_dir = repo_root / "pearl-evaluation-lab"

if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))
if str(lab_dir) not in sys.path:
    sys.path.insert(0, str(lab_dir))

# Ensure GROQ_API_KEY is loaded
if not os.getenv("GROQ_API_KEY"):
    for ep in [backend_dir / ".env", repo_root / ".env"]:
        if ep.exists():
            with open(ep, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("GROQ_API_KEY=") and not line.startswith("#"):
                        os.environ["GROQ_API_KEY"] = line.split("=", 1)[1].strip("'\"")
                        break
        if os.getenv("GROQ_API_KEY"):
            break

from services.pearl.conversation_engine import ConversationEngine


async def generate_engine_turn(engine: ConversationEngine) -> tuple[str, float, float]:
    """Stream from engine, measuring TTFT and total latency."""
    t0 = time.monotonic()
    ttft = None
    tokens = []
    async for tok in engine.generate_response_stream():
        if ttft is None:
            ttft = (time.monotonic() - t0) * 1000.0
        tokens.append(tok)
    total_time = (time.monotonic() - t0) * 1000.0
    text = "".join(tokens).strip()
    return text, (ttft or total_time), total_time


def analyze_pattern_interrupt(opening: str, prospect_info: dict) -> dict:
    """Analyze the qualitative properties of the pattern interrupt."""
    lower = opening.lower()
    
    # Check for generic sales breath / cliches
    cliches = [
        "how are you doing today", "hope you are doing well", "is this a good time",
        "i am calling from", "myself pearl from", "sorry to bother you",
        "did i catch you at a bad time"
    ]
    has_cliche = any(c in lower for c in cliches)
    
    # Identify psychological pattern interrupt technique
    techniques = []
    if any(w in lower for w in ["soch", "noticed", "saw", "dekh", "figured", "trying to figure", "wondering"]):
        techniques.append("Observational Hook / Curiosity Gap")
    if any(w in lower for w in ["quick", "30-second", "ek second", "20 seconds", "short"]):
        techniques.append("Micro-Time Commitment Reframe")
    if any(w in lower for w in ["honest", "actually", "sach", "straight", "anti-pitch"]):
        techniques.append("Disarming Anti-Sales Directness")
    if any(w in lower for w in ["leads", "revenue", "pipeline", "sdr", "capacity", "miss", "waste", "conversion"]):
        techniques.append("Tension / Operational Friction Anchor")
    if not techniques:
        techniques.append("Contextual Specificity Interruption")
        
    # Code-switching check (Hinglish / Hindi markers)
    hindi_cues = ["haan", "achha", "dekhiye", "matlab", "bilkul", "sahi", "kaise", "aap", "hum", "rahi", "hoon", "nahi"]
    is_hinglish = any(cue in lower.split() for cue in hindi_cues)
    
    word_count = len(opening.split())
    is_concise = word_count <= 45  # 1-3 spoken sentences
    
    return {
        "techniques": techniques,
        "cliche_free": not has_cliche,
        "is_hinglish": is_hinglish,
        "word_count": word_count,
        "is_concise": is_concise
    }


async def run_10_tests():
    # Load 10 outbound sales scenarios
    outbound_file = lab_dir / "datasets" / "outbound_sales" / "outbound_sales.jsonl"
    scenarios = []
    with open(outbound_file, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                scenarios.append(json.loads(line))
    
    scenarios = scenarios[:10]
    print(f"Loaded {len(scenarios)} Outbound Benchmark Scenarios for Pearl Pattern Interrupt Evaluation.\n")
    
    results = []

    for idx, sc in enumerate(scenarios, 1):
        sc_id = sc["scenario_id"]
        persona = sc["prospect_persona"]
        b_ctx = sc["business_context"]
        role = persona.get("role", "Executive")
        preferred_lang = persona.get("preferred_language", "Hinglish")
        comm_style = persona.get("communication_style", "Executive")
        company = b_ctx.get("company_name", "ClozFlow Systems")
        product = b_ctx.get("product_name", "Pearl Sales AI")
        capsule = b_ctx.get("capsule_snippet", "")
        
        # Give a realistic target business context for each scenario so Pearl has sharp context to anchor into
        target_contexts = [
            ("Razorpay Lead / Fintech Scaleup", "Fintech SaaS startup scaling sales team from 5 to 50 SDRs, high lead leakage"),
            ("Zenith Logistics Hub", "Pan-India freight broker dealing with 200+ missed inquiries daily over WhatsApp and phone"),
            ("EduBridge Online Academy", "Edtech platform with 1,500 inbound demo inquiries weekly, low contact rate"),
            ("UrbanNest Realty Group", "Luxury real estate brokerage struggling with slow response times to property portal leads"),
            ("CareFirst Health Network", "Chain of diagnostic clinics missing after-hours diagnostic package bookings"),
            ("CloudStack Dev Labs", "B2B Cloud Migration agency with high-ticket enterprise buyer inquiries"),
            ("FleetTrack IoT Systems", "Fleet telematics provider whose sales reps spend 70% time qualifying cold leads"),
            ("GrowEasy Retail POS", "Retail billing software provider losing inbound merchant trials before setup"),
            ("Apex Solar Solutions", "Commercial solar installer needing rapid qualification of commercial rooftop leads"),
            ("AutoDrive Pre-Owned", "Used car franchise network qualifying high-intent buyers versus casual browsers")
        ]
        
        target_name, target_desc = target_contexts[idx - 1]
        
        full_capsule = (
            f"You are Pearl from {company}, representing {product}. "
            f"Your product capability: {capsule}. "
            f"The company you are calling is {target_name}. "
            f"Their background: {target_desc}. "
            f"You are calling {persona.get('name', 'Prospect')}, who is the {role}. "
            f"Prospect profile: {comm_style}. Preferred language: {preferred_lang}."
        )
        
        lead_context = {
            "business_name": target_name,
            "prospect_name": f"{persona.get('name', 'Prospect')} ({role})",
            "capsule_context": full_capsule,
            "product_name": product
        }
        
        engine = ConversationEngine(
            objective=f"Execute pattern interrupt, earn 30 seconds of attention with the {role}, and secure interest in a brief walkthrough.",
            lead_context=lead_context
        )
        
        print(f"================================================================================")
        print(f" TEST #{idx:02d} | Scenario: {sc_id} | Target: {target_name} ({role})")
        print(f" Context: {target_desc}")
        print(f" Language Preference: {preferred_lang} | Tone: {comm_style}")
        print(f"--------------------------------------------------------------------------------")
        
        # Turn 0: Pearl's Dynamic Outbound Opening (Pattern Interrupt Hook)
        opening_text, ttft_0, lat_0 = await generate_engine_turn(engine)
        analysis = analyze_pattern_interrupt(opening_text, persona)
        
        print(f"[PEARL OPENING PATTERN INTERRUPT] (TTFT: {ttft_0:.1f}ms | Latency: {lat_0:.1f}ms):")
        print(f"  \"{opening_text}\"")
        print(f"\n  >> Pattern Analysis:")
        print(f"     - Techniques: {', '.join(analysis['techniques'])}")
        print(f"     - Zero Generic Sales Cliches: {'PASS' if analysis['cliche_free'] else 'FAIL'}")
        print(f"     - Conversational Hinglish: {'YES' if analysis['is_hinglish'] else 'NO (English dominant)'}")
        print(f"     - Spoken Conciseness: {analysis['word_count']} words ({'OPTIMAL' if analysis['is_concise'] else 'LONG'})")
        
        # Turn 1: Prospect cold response
        engine.add_turn("agent", opening_text)
        
        # Simulate prospect typical realistic cold call reaction based on role
        if idx % 2 == 1:
            prospect_reply = "Hello, who is this and why are you calling my direct number?"
        else:
            prospect_reply = "Haan bolo, main meeting me ja raha hoon. What is this regarding?"
            
        print(f"\n[PROSPECT REACTION]:")
        print(f"  \"{prospect_reply}\"")
        engine.add_turn("prospect", prospect_reply)
        
        # Turn 2: Pearl's follow-up handling / secondary pattern interrupt
        followup_text, ttft_1, lat_1 = await generate_engine_turn(engine)
        print(f"\n[PEARL PIVOT / REFLECTION] (TTFT: {ttft_1:.1f}ms | Latency: {lat_1:.1f}ms):")
        print(f"  \"{followup_text}\"")
        print(f"================================================================================\n")
        
        results.append({
            "test_num": idx,
            "scenario_id": sc_id,
            "target": target_name,
            "role": role,
            "preferred_lang": preferred_lang,
            "opening": opening_text,
            "ttft_ms": round(ttft_0, 1),
            "total_latency_ms": round(lat_0, 1),
            "analysis": analysis,
            "prospect_reaction": prospect_reply,
            "followup": followup_text
        })
        
        # Brief pause between calls to respect rate limits
        await asyncio.sleep(0.5)

    # Save results to a json file in lab directory
    out_path = lab_dir / "reports" / "pearl_10_openings_test_results.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    print(f"\n>>> All 10 Tests Completed Successfully! Saved results to {out_path}")

if __name__ == "__main__":
    asyncio.run(run_10_tests())
