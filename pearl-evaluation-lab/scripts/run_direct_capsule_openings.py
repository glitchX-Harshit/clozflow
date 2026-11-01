import os
import sys
import json
import time
import asyncio
from pathlib import Path

# Ensure UTF-8 output on Windows
sys.stdout.reconfigure(encoding='utf-8')

# Setup paths
repo_root = Path(__file__).parent.parent.parent.resolve()
backend_dir = repo_root / "backend"
lab_dir = repo_root / "pearl-evaluation-lab"

if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))
if str(lab_dir) not in sys.path:
    sys.path.insert(0, str(lab_dir))

# Ensure GROQ_API_KEY is loaded
for ep in [backend_dir / ".env", repo_root / ".env", lab_dir / ".env"]:
    if ep.exists():
        with open(ep, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("GROQ_API_KEY=") and not line.startswith("#"):
                    os.environ["GROQ_API_KEY"] = line.split("=", 1)[1].strip("'\"\r\n")
                    break
    if os.getenv("GROQ_API_KEY"):
        break

from database import SessionLocal
from models import Capsule
from utils.capsule_formatter import format_capsule_context
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


def analyze_pattern_interrupt(opening: str) -> dict:
    """Analyze the qualitative properties of Pearl's pattern interrupt."""
    lower = opening.lower()
    
    # Generic cliches check
    cliches = [
        "how are you doing today", "hope you are doing well", "is this a good time",
        "i am calling from", "myself pearl from", "sorry to bother you",
        "did i catch you at a bad time"
    ]
    has_cliche = any(c in lower for c in cliches)
    
    # Identify psychological pattern interrupt technique
    techniques = []
    if any(w in lower for w in ["soch", "noticed", "saw", "dekh", "figured", "photo", "menu", "instagram", "wondering"]):
        techniques.append("Observational Hook / Curiosity Gap")
    if any(w in lower for w in ["quick", "30-second", "ek second", "20 seconds", "short", "minute"]):
        techniques.append("Micro-Time Commitment Reframe")
    if any(w in lower for w in ["honest", "actually", "sach", "straight", "anti-pitch", "direct"]):
        techniques.append("Disarming Anti-Sales Directness")
    if any(w in lower for w in ["thin", "paani", "curdle", "separate", "split", "watery", "dairy", "waste", "creamy"]):
        techniques.append("Product Friction / Operational Pain Anchor")
    if any(w in lower for w in ["239", "cost", "margin", "mehnga", "price", "budget"]):
        techniques.append("Commercial Contrast / Price Reframe")
    if not techniques:
        techniques.append("Contextual Specificity Interruption")
        
    # Language markers
    hindi_cues = ["haan", "achha", "dekhiye", "matlab", "bilkul", "sahi", "kaise", "aap", "hum", "rahi", "hoon", "nahi", "toh", "kya", "paani", "bol", "bataun"]
    is_hinglish = any(cue in lower.split() for cue in hindi_cues)
    
    words = opening.split()
    word_count = len(words)
    is_concise = word_count <= 45
    
    return {
        "techniques": techniques,
        "cliche_free": not has_cliche,
        "is_hinglish": is_hinglish,
        "word_count": word_count,
        "is_concise": is_concise
    }


async def run_10_direct_scenarios():
    # 1. Fetch Existing Capsule from DB
    db = SessionLocal()
    capsule = db.query(Capsule).filter(Capsule.id == 1).first()
    if not capsule:
        capsule = db.query(Capsule).first()
    capsule_text = format_capsule_context(capsule, db=db)
    capsule_name = capsule.name if capsule else "oat milk"
    capsule_product = capsule.product_name if capsule else "oatish"
    db.close()
    
    print("=" * 86)
    print(f"  CLOZFLOW / PEARL AI — DIRECT 10-SCENARIO OPENINGS & PATTERN INTERRUPTS")
    print(f"  Existing Database Capsule: {capsule_name.strip()} ({capsule_product.strip()}) | Price: 239 Rs")
    print(f"  Mode: DIRECT RUN (Opening Hooks & Pattern Interrupt Generation)")
    print("=" * 86)
    print()

    # 10 Real Outbound Scenarios mapped to Oatish target buyer personas
    scenarios = [
        {
            "scenario_id": "OUT-001",
            "title": "Third-Wave Specialty Roastery — Indie Brand Founder",
            "prospect_name": "Arjun Mehta",
            "role": "Founder & Master Roaster",
            "company": "Blue Peak Roastery & Brew Bar (Bangalore)",
            "context": "Specialty cafe serving single-origin espresso. Regular plant milks curdle and split under steam wand, ruining flat whites.",
            "preferred_lang": "Hinglish",
            "prospect_turn_1": "Hello, who is this? We are in the middle of our morning roast batch."
        },
        {
            "scenario_id": "OUT-002",
            "title": "High-Volume Milkshake & Smoothie Chain — Operations Lead",
            "prospect_name": "Karan Malhotra",
            "role": "VP Operations",
            "company": "ThickShake Republic (Mumbai — 22 Outlets)",
            "context": "Customer complaints regarding watery/thin smoothies when using generic almond or soy milk; needs extra oatish creamy body.",
            "preferred_lang": "English",
            "prospect_turn_1": "Yes, Karan here. Quick, I am stepping into a vendor review meeting."
        },
        {
            "scenario_id": "OUT-003",
            "title": "Fast-Casual Vegan Cafe Chain — Growth & Menu Expansion",
            "prospect_name": "Ananya Sharma",
            "role": "Head of Growth & Menu Innovation",
            "company": "GreenRoots Organics (Delhi NCR)",
            "context": "Launching new summer plant-based cold coffee menu; needs rich barista mouthfeel without artificial stabilizers.",
            "preferred_lang": "Hinglish",
            "prospect_turn_1": "Haan ji Ananya speaking. Is this regarding our franchise expansion?"
        },
        {
            "scenario_id": "OUT-004",
            "title": "Artisan Bakery & Patisserie — Brand & Experience Director",
            "prospect_name": "Pooja Deshmukh",
            "role": "Brand Director",
            "company": "La Brioche Cafe & Bakehouse (Pune)",
            "context": "High-footfall aesthetic brunch bistro; customers demand silky micro-foam latte art on dairy-free flat whites.",
            "preferred_lang": "English",
            "prospect_turn_1": "Hello, please be brief. I get 20 vendor pitches a day."
        },
        {
            "scenario_id": "OUT-005",
            "title": "Multi-Brand Cloud Kitchen — Kitchen Operations & Quality Head",
            "prospect_name": "Vikram Reddy",
            "role": "Head of Central Kitchen & Quality",
            "company": "CloudBite Kitchens (Hyderabad)",
            "context": "Delivery shakes arrive separated and watery at customers' doorsteps after 30-min bike rides. Needs a stable formulation.",
            "preferred_lang": "Hinglish",
            "prospect_turn_1": "Bolo bhai, kitchen operations mein hoon. Kya issue hai?"
        },
        {
            "scenario_id": "OUT-006",
            "title": "Traditional Heritage Coffee Bar — Owner & Operator",
            "prospect_name": "Sundaram Iyer",
            "role": "Managing Director & Owner",
            "company": "Mylapore Heritage Coffee House (Chennai)",
            "context": "Deep skepticism that any plant milk can ever match the body and texture of fresh buffalo milk for authentic filter coffee.",
            "preferred_lang": "English",
            "prospect_turn_1": "Yes, Mr. Iyer speaking. What is this call regarding?"
        },
        {
            "scenario_id": "OUT-007",
            "title": "Pan-India Cafe Franchise — VP of Procurement & Sourcing",
            "prospect_name": "Rajesh Singhania",
            "role": "VP Procurement",
            "company": "Urban Bean Cafes (45 Locations Across India)",
            "context": "Currently importing European oat milk at Rs 360/L; looking for a reliable domestic barista oat milk at Rs 239 to improve margins.",
            "preferred_lang": "Hinglish",
            "prospect_turn_1": "Singhania here. Dairy supplies toh locked hain hamari. What are you offering?"
        },
        {
            "scenario_id": "OUT-008",
            "title": "High-Speed Transit Kiosk Chain — Franchise Operations Lead",
            "prospect_name": "Sameer Joshi",
            "role": "Head of Franchise Operations",
            "company": "MetroCoffee Express (Delhi Metro Network)",
            "context": "Speed-of-service is paramount (under 60s per order); cannot afford slow-frothing oat milk that clumps on high-pressure steam wands.",
            "preferred_lang": "English",
            "prospect_turn_1": "Sameer speaking. If this is cold outreach, send an email to ops@metrocoffee."
        },
        {
            "scenario_id": "OUT-009",
            "title": "Specialty Espresso Bar — Head Barista & Beverage Champion",
            "prospect_name": "Devika Nambiar",
            "role": "Head Barista & Quality Lead",
            "company": "Coastal Bloom Specialty Coffee (Goa)",
            "context": "Serving light-roast washed Ethiopian beans; frustrated by plant milks that mask coffee flavor or curdle with acidic single origins.",
            "preferred_lang": "Hinglish",
            "prospect_turn_1": "Hey, Devika here. Dialing in our grinders right now, bolo quickly."
        },
        {
            "scenario_id": "OUT-010",
            "title": "5-Star Luxury Heritage Hotel — Director of Food & Beverage",
            "prospect_name": "Farhan Qureshi",
            "role": "Director of Food & Beverage",
            "company": "The Royal Haveli Palace & Resorts (Jaipur)",
            "context": "High-net-worth foreign tourists demanding premium vegan options; seeking a consistent barista oat milk for 5-star breakfast buffets and signature cocktails.",
            "preferred_lang": "English",
            "prospect_turn_1": "Farhan Qureshi, F&B office. How may I help you?"
        }
    ]

    all_results = []

    for idx, sc in enumerate(scenarios, 1):
        lead_ctx = {
            "business_name": sc["company"],
            "prospect_name": f"{sc['prospect_name']} ({sc['role']})",
            "capsule_context": capsule_text,
            "product_name": capsule_product.strip()
        }
        
        # Define objective focused on pattern interrupt and conversation initiation
        objective = (
            f"Deliver an authentic pattern interrupt tailored to {sc['company']}'s situation. "
            f"Earn 30 seconds of attention with {sc['prospect_name']} ({sc['role']}) by highlighting "
            f"how Oatish barista oat milk solves watery, thin texture in milkshakes/smoothies/coffee "
            f"at Rs 239 with an extra creamy mouthfeel."
        )

        engine = ConversationEngine(
            objective=objective,
            lead_context=lead_ctx
        )

        print(f"--------------------------------------------------------------------------------")
        print(f" SCENARIO #{idx:02d} [{sc['scenario_id']}] | {sc['title']}")
        print(f" Prospect: {sc['prospect_name']} ({sc['role']}) @ {sc['company']}")
        print(f" Context: {sc['context']}")
        print(f" Language Style: {sc['preferred_lang']}")
        print(f"--------------------------------------------------------------------------------")

        # ── TURN 0: PEARL OPENING (Pattern Interrupt) ──
        opening_text, ttft_0, lat_0 = await generate_engine_turn(engine)
        analysis = analyze_pattern_interrupt(opening_text)

        print(f" [PEARL OPENING PATTERN INTERRUPT] (TTFT: {ttft_0:.1f}ms | Latency: {lat_0:.1f}ms):")
        print(f"   \"{opening_text}\"")
        print()
        print(f"   >> Pattern Analysis:")
        print(f"     - Psychological Hook: {', '.join(analysis['techniques'])}")
        print(f"     - Zero Sales Cliches: {'PASS (No corporate sales pitch)' if analysis['cliche_free'] else 'FAIL'}")
        print(f"     - Tone & Language: {'Conversational Hinglish' if analysis['is_hinglish'] else 'Spoken English'}")
        print(f"     - Spoken Length: {analysis['word_count']} words ({'Punchy' if analysis['is_concise'] else 'Long'})")
        print()

        # ── TURN 1: PROSPECT REALISTIC REACTION ──
        engine.add_turn("agent", opening_text)
        prospect_reply = sc["prospect_turn_1"]
        print(f" [PROSPECT IMMEDIATE REACTION]:")
        print(f"   \"{prospect_reply}\"")
        engine.add_turn("prospect", prospect_reply)
        print()

        # Pacing pause
        await asyncio.sleep(1.0)

        # ── TURN 2: PEARL LIVE PIVOT / CONVERSATIONAL RESPONSE ──
        pivot_text, ttft_1, lat_1 = await generate_engine_turn(engine)
        print(f" [PEARL DYNAMIC PIVOT] (TTFT: {ttft_1:.1f}ms | Latency: {lat_1:.1f}ms):")
        print(f"   \"{pivot_text}\"")
        print("=" * 86)
        print()

        all_results.append({
            "test_num": idx,
            "scenario_id": sc["scenario_id"],
            "title": sc["title"],
            "prospect_name": sc["prospect_name"],
            "role": sc["role"],
            "company": sc["company"],
            "situation": sc["context"],
            "language_style": sc["preferred_lang"],
            "opening_pattern_interrupt": opening_text,
            "opening_ttft_ms": round(ttft_0, 1),
            "opening_total_latency_ms": round(lat_0, 1),
            "analysis": analysis,
            "prospect_reaction": prospect_reply,
            "pearl_pivot": pivot_text,
            "pivot_ttft_ms": round(ttft_1, 1),
            "pivot_total_latency_ms": round(lat_1, 1)
        })

        # Pacing delay between scenarios
        await asyncio.sleep(1.0)

    # Persist the output run
    out_file = lab_dir / "reports" / "pearl_10_existing_capsule_openings.json"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False)

    print(f"\n>>> Direct Execution of 10 Scenarios Complete!")
    print(f">>> Results persisted to: {out_file}\n")


if __name__ == "__main__":
    asyncio.run(run_10_direct_scenarios())
