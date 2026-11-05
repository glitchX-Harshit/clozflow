import asyncio
import os
import sys

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

sys.path.insert(0, os.path.abspath("backend"))

from dotenv import load_dotenv
load_dotenv(dotenv_path="backend/.env")

from services.pearl.conversation_engine import ConversationEngine
from data.sales_archetypes import get_archetype_by_id

async def test_archetype_openings():
    test_cases = [
        {
            "id": "fintech_kyc_recovery",
            "name": "Rahul Sharma",
            "vars": {
                "borrower_name": "Rahul ji",
                "company_name": "CredPulse Financial",
                "loan_amount": "₹3.5 Lakh",
                "interest_rate": "1.05% per month",
                "application_link": "https://credpulse.in/app/kyc",
                "sanction_validity_hours": "24 hours"
            },
            "objection": "Dekho mujhe koi loan nahi chahiye, kyu faltu spam call kar rahe ho?"
        },
        {
            "id": "d2c_cod_confirmation",
            "name": "Aakash Verma",
            "vars": {
                "customer_name": "Aakash ji",
                "brand_name": "Snitch",
                "item_name": "Oversized Linen Shirt",
                "order_value": "₹1,899",
                "delivery_city": "Pune",
                "discount_amount": "₹100"
            },
            "objection": "Hello, kaun bol raha hai aur kyu call kiya?"
        },
        {
            "id": "cart_recovery_closer",
            "name": "Vikram Mehta",
            "vars": {
                "shopper_name": "Vikram",
                "brand_name": "StyleStudio",
                "cart_items": "Nordic Ceramic Dinner Set",
                "cart_total": "₹3,499",
                "coupon_code": "VIP10",
                "checkout_link": "https://stylestudio.in/cart/resume"
            },
            "objection": "Payment nahi hui toh chod diya maine, baar baar call kyu karte ho?"
        },
        {
            "id": "ndr_delivery_rescuer",
            "name": "Deepak Patel",
            "vars": {
                "customer_name": "Deepak ji",
                "brand_name": "The Souled Store",
                "tracking_number": "DEL-88391024",
                "courier_partner": "Delhivery",
                "agent_name": "Aayan",
                "reschedule_link": "https://clozflow.ai/ndr"
            },
            "objection": "Arey bhai kisi ne doorbell nahi bajai! Ghar par tha main, delivery wale jhooth bolte hain bilkul!"
        }
    ]

    for tc in test_cases:
        arch = get_archetype_by_id(tc["id"])
        print(f"\n=======================================================", flush=True)
        print(f"TESTING: {arch['name']} ({tc['id']})", flush=True)
        print(f"=======================================================", flush=True)

        sys_prompt = arch.get("systemPrompt") or arch.get("system_prompt")
        import re
        for k, v in tc["vars"].items():
            sys_prompt = re.sub(rf"\{{\{{\s*{k}\s*\|\s*[^}}]+\}}\}}", str(v), sys_prompt)
            sys_prompt = sys_prompt.replace(f"{{{{{k}}}}}", str(v))

        agent_name = arch.get("recommendedVoices", [{}])[0].get("name", "Pearl")
        engine = ConversationEngine(
            objective=arch.get("mission", "Qualify intent"),
            lead_context={
                "business_name": tc["name"],
                "prospect_name": tc["name"],
                "capsule_context": f"Archetype: {arch['name']}. Details: {tc['vars']}",
                "agent_name": agent_name,
                "voice_config": {"speaker": arch.get("defaultVoiceId", "ritu_hi_sales")}
            },
            system_prompt_override=sys_prompt,
            agent_name=agent_name
        )

        # 1. Spoken Turn 0 (Dynamic Pattern Interrupt Opening)
        tokens = []
        async for tok in engine.generate_response_stream():
            tokens.append(tok)
        opening = "".join(tokens).strip()
        print(f"\n[AGENT (Turn 0 - Dynamic Opening)]:\n  \"{opening}\"", flush=True)
        engine.add_turn("agent", opening)

        # 2. Prospect Objection
        print(f"\n[PROSPECT (Turn 1 - Objection)]:\n  \"{tc['objection']}\"", flush=True)
        engine.add_turn("prospect", tc["objection"])

        # 3. Agent Response
        resp_toks = []
        async for tok in engine.generate_response_stream():
            resp_toks.append(tok)
        resp = "".join(resp_toks).strip()
        print(f"[AGENT (Turn 1 - Reframe & Response)]:\n  \"{resp}\"", flush=True)

        await asyncio.sleep(1.0) # Graceful pause for Groq rate limits

if __name__ == "__main__":
    asyncio.run(test_archetype_openings())
