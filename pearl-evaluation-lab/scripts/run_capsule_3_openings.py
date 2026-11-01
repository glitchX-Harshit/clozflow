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
    lower = opening.lower()
    cliches = [
        "how are you doing today", "hope you are doing well", "is this a good time",
        "i am calling from", "myself pearl from", "sorry to bother you",
        "did i catch you at a bad time"
    ]
    has_cliche = any(c in lower for c in cliches)
    
    techniques = []
    if any(w in lower for w in ["soch", "noticed", "saw", "dekh", "figured", "wondering", "sun"]):
        techniques.append("Observational Hook / Curiosity Gap")
    if any(w in lower for w in ["quick", "30-second", "ek second", "20 seconds", "short", "minute"]):
        techniques.append("Micro-Time Commitment Reframe")
    if any(w in lower for w in ["honest", "actually", "sach", "straight", "anti-pitch", "direct"]):
        techniques.append("Disarming Anti-Sales Directness")
    if any(w in lower for w in ["manual", "delay", "lag", "fragmented", "overhead", "coordination", "tools", "waste"]):
        techniques.append("Operational Friction / Overhead Anchor")
    if any(w in lower for w in ["automated", "workflow", "integration", "scale", "reporting"]):
        techniques.append("Value Architecture Hook")
    if not techniques:
        techniques.append("Contextual Specificity Interruption")
        
    hindi_cues = ["haan", "achha", "dekhiye", "matlab", "bilkul", "sahi", "kaise", "aap", "hum", "rahi", "hoon", "nahi", "toh", "kya", "bol", "bataun"]
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


async def run_10_capsule_3_scenarios():
    db = SessionLocal()
    capsule = db.query(Capsule).filter(Capsule.id == 3).first()
    capsule_text = format_capsule_context(capsule, db=db)
    capsule_name = capsule.name.strip() if capsule else "Dancing Cow Platform"
    capsule_product = capsule.product_name.strip() if capsule else "Shop Oatish Oat Milk Platform"
    db.close()
    
    print("=" * 86)
    print(f"  CLOZFLOW / PEARL AI — DIRECT 10-SCENARIO OPENINGS FOR CAPSULE #3")
    print(f"  Capsule: {capsule_name} ({capsule_product})")
    print(f"  Focus: Enterprise Workflows, Integration & Operational Overhead Reduction")
    print("=" * 86)
    print()

    # 10 Mid-Market & Enterprise Target Scenarios
    scenarios = [
        {
            "scenario_id": "ENT-001",
            "title": "National QSR & Cafe Chain — Head of Supply Chain & Ops",
            "prospect_name": "Rohan Deshmukh",
            "role": "VP Supply Chain & Operations",
            "company": "Blue Tokai Coffee Roasters (80+ Outlets)",
            "context": "Managing supply coordination across 80+ cafes using manual WhatsApp groups and disparate spreadsheets, causing stockouts and communication lag.",
            "preferred_lang": "Hinglish",
            "prospect_turn_1": "Hello, Rohan here. In the middle of warehouse dispatch reviews. What is this regarding?"
        },
        {
            "scenario_id": "ENT-002",
            "title": "Cloud Kitchen Conglomerate — Chief Operating Officer",
            "prospect_name": "Siddharth Verma",
            "role": "Chief Operating Officer",
            "company": "KitchenCentric Multi-Brand Hubs (120 Hubs)",
            "context": "Fragmented supplier ordering tools resulting in 4-hour daily manual reconciliation by ops managers across regional distribution hubs.",
            "preferred_lang": "English",
            "prospect_turn_1": "Siddharth speaking. Make it quick, I have an investor standup in 5 minutes."
        },
        {
            "scenario_id": "ENT-003",
            "title": "Specialty Tea & Beverage Franchise — Head of Procurement",
            "prospect_name": "Meera Kapoor",
            "role": "Head of Strategic Procurement",
            "company": "Chai Junction Enterprise (250 Kiosks)",
            "context": "Manual tracking of dairy and plant milk ingredient replenishment across franchisee tiers creates frequent delays and reconciliation friction.",
            "preferred_lang": "Hinglish",
            "prospect_turn_1": "Haan ji Meera bol rahi hoon. Kya vendor portal onboarding ke baare mein hai?"
        },
        {
            "scenario_id": "ENT-004",
            "title": "Premium Bakery & Patisserie Group — VP Operations",
            "prospect_name": "Aditya Sengupta",
            "role": "VP Operations & Retail Experience",
            "company": "The French Loaf & Bistro Group",
            "context": "Lack of custom reporting and automated workflows across high-ticket store locations creates inventory over-ordering and ingredient spoilage.",
            "preferred_lang": "English",
            "prospect_turn_1": "Aditya here. I get pitched enterprise software 10 times a day. What makes you different?"
        },
        {
            "scenario_id": "ENT-005",
            "title": "Direct-to-Consumer Food & Beverage Brand — Operations Director",
            "prospect_name": "Neha Agarwal",
            "role": "Director of Supply Operations",
            "company": "Urban Sip Beverage Co.",
            "context": "Rapid D2C scaling with enterprise B2B partner accounts; experiencing extreme communication lag between central kitchen and field dispatch.",
            "preferred_lang": "Hinglish",
            "prospect_turn_1": "Hello, Neha here. Quick bolo, dispatch floor par hoon."
        },
        {
            "scenario_id": "ENT-006",
            "title": "Omnichannel Retail Supermarkets — Enterprise Sourcing Head",
            "prospect_name": "Girish Nair",
            "role": "Head of Enterprise Sourcing & Vendor Tech",
            "company": "Nature's Basket Retail",
            "context": "Integration with existing ERP systems is slow; looking for automated vendor integration workflows with dedicated support.",
            "preferred_lang": "English",
            "prospect_turn_1": "Girish Nair. What company are you representing and why are you calling my mobile?"
        },
        {
            "scenario_id": "ENT-007",
            "title": "Pan-India Airport F&B Concessions — VP Procurement",
            "prospect_name": "Alok Bhargava",
            "role": "VP Airport Concessions & Supply",
            "company": "AeroDine Hospitality Group",
            "context": "Strict compliance and zero-downtime requirements; high manual overhead in daily shift replenishment across 14 international airport terminals.",
            "preferred_lang": "Hinglish",
            "prospect_turn_1": "Alok here. Hamara procurement cycle locked hai. What is this call about?"
        },
        {
            "scenario_id": "ENT-008",
            "title": "Hospitality & Boutique Luxury Resort Chain — Corporate F&B Director",
            "prospect_name": "Kavita Rao",
            "role": "Corporate Director of F&B Operations",
            "company": "Serene Escapes Luxury Resorts",
            "context": "Centralized corporate governance struggling to enforce consistent execution and custom inventory reporting across 18 remote resort properties.",
            "preferred_lang": "English",
            "prospect_turn_1": "Hello, Kavita Rao. Please state the exact purpose of this call."
        },
        {
            "scenario_id": "ENT-009",
            "title": "Fast-Growing Specialty Dessert Bar Chain — Co-Founder & COO",
            "prospect_name": "Tanmay Khurana",
            "role": "Co-Founder & COO",
            "company": "Frosted Treats Labs (35 Outlets)",
            "context": "Store managers spend 90 mins every evening on fragmented ordering tools instead of focusing on customer experience and team training.",
            "preferred_lang": "Hinglish",
            "prospect_turn_1": "Haan Tanmay speaking. New store launch ho raha hai weekend pe, bolo jaldi."
        },
        {
            "scenario_id": "ENT-010",
            "title": "Contract Catering & Institutional Dining — Sourcing General Manager",
            "prospect_name": "Pradeep Chawla",
            "role": "General Manager, Corporate Dining",
            "company": "MetroFeast Enterprise Caterers",
            "context": "Managing food and beverage supply across 40 tech corporate cafeterias; high manual coordination causes billing discrepancies and delivery mismatch.",
            "preferred_lang": "Hinglish",
            "prospect_turn_1": "Pradeep Chawla here. If this is a cold call, send an email to our procurement desk."
        }
    ]

    all_results = []

    for idx, sc in enumerate(scenarios, 1):
        lead_ctx = {
            "business_name": sc["company"],
            "prospect_name": f"{sc['prospect_name']} ({sc['role']})",
            "capsule_context": capsule_text,
            "product_name": capsule_product
        }
        
        objective = (
            f"Deliver an authentic pattern interrupt tailored to {sc['company']}'s enterprise scale. "
            f"Earn 30 seconds of attention with {sc['prospect_name']} ({sc['role']}) by targeting "
            f"high manual operational overhead and fragmented communication lag with automated workflows "
            f"and enterprise integration."
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

        # TURN 0: PEARL OPENING
        opening_text, ttft_0, lat_0 = await generate_engine_turn(engine)
        analysis = analyze_pattern_interrupt(opening_text)

        print(f" [PEARL OPENING PATTERN INTERRUPT] (TTFT: {ttft_0:.1f}ms | Latency: {lat_0:.1f}ms):")
        print(f"   \"{opening_text}\"")
        print()
        print(f"   >> Pattern Analysis:")
        print(f"     - Psychological Hook: {', '.join(analysis['techniques'])}")
        print(f"     - Zero Sales Cliches: {'PASS' if analysis['cliche_free'] else 'FAIL'}")
        print(f"     - Tone & Language: {'Conversational Hinglish' if analysis['is_hinglish'] else 'Spoken English'}")
        print(f"     - Spoken Length: {analysis['word_count']} words ({'Punchy' if analysis['is_concise'] else 'Long'})")
        print()

        # TURN 1: PROSPECT REACTION
        engine.add_turn("agent", opening_text)
        prospect_reply = sc["prospect_turn_1"]
        print(f" [PROSPECT IMMEDIATE REACTION]:")
        print(f"   \"{prospect_reply}\"")
        engine.add_turn("prospect", prospect_reply)
        print()

        await asyncio.sleep(1.0)

        # TURN 2: PEARL LIVE PIVOT
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

        await asyncio.sleep(1.2)

    out_file = lab_dir / "reports" / "pearl_10_capsule_3_platform_openings.json"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False)

    print(f"\n>>> Capsule #3 10-Scenario Generation Complete!")
    print(f">>> Persisted to: {out_file}\n")


if __name__ == "__main__":
    asyncio.run(run_10_capsule_3_scenarios())
