import asyncio
import os
import sys
from dotenv import load_dotenv

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "backend")))
load_dotenv("backend/.env")

from backend.services.pearl.conversation_engine import ConversationEngine

async def test_conversation(language, prospect_message):
    print(f"\n--- Testing {language} ---")
    print(f"Prospect: {prospect_message}")
    
    capsule_mock = "Product Name: Clozflow Pearl\nPrice: $2,499\nSpecs: AI Outbound Agent\nTarget Audience: Sales Teams"
    
    engine = ConversationEngine(
        objective="identify the pain point and explain their problem better then themselves, qualify the lead",
        lead_context={"business_name": "TestCorp", "capsule_context": capsule_mock}
    )
    
    engine.add_turn("prospect", prospect_message)
    
    print("Pearl: ", end="", flush=True)
    async for token in engine.generate_response_stream():
        print(token, end="", flush=True)
    print("\n" + "-"*30)

async def main():
    await test_conversation("English", "Can you explain what your product actually does?")
    await test_conversation("Hindi", "Achha, ye product exactly karta kya hai?")
    await test_conversation("Hinglish", "Haan but I don't really see why my team needs this.")
    await test_conversation("Objection (Code-switch)", "₹2,499 is too expensive for us.")
    await test_conversation("Competitor Objection", "We are already using another dialer for our team.")
    await test_conversation("Trust/Security Objection (Hindi)", "Lekin kaise maan loon ki ye humara data leak nahi karega?")
    await test_conversation("Timing Objection (English)", "Listen, I'm about to step into a meeting. Can you just email me the pricing?")
    await test_conversation("Team Size Objection (Hinglish)", "Humari team bohot badi hai, we don't need AI. Hamare log obviously ek bot se better sell karte hain.")

if __name__ == "__main__":
    asyncio.run(main())
