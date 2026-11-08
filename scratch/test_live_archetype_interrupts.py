import asyncio
import os
import re
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
                "sanction_validity_hours": "24 hours",
                "agent_name": "Ritu"
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
                "discount_amount": "₹100",
                "agent_name": "Priya"
            },
            "objection": "Hello, kaun bol raha hai aur kyu call kiya?"
        },
        {
            "id": "cart_recovery_closer",
            "name": "Vikram Mehta",
            "vars": {
                "shopper_name": "Vikram ji",
                "brand_name": "StyleStudio",
                "cart_items": "Nordic Ceramic Dinner Set",
                "cart_total": "₹3,499",
                "coupon_code": "VIP10",
                "checkout_link": "https://stylestudio.in/cart/resume",
                "agent_name": "Shubh"
            },
            "objection": "Payment nahi hui toh chod diya maine, baar baar call kyu karte ho?"
        },
        {
            "id": "b2b_discovery_qualifier",
            "name": "Siddharth Roy",
            "vars": {
                "lead_name": "Siddharth ji",
                "prospect_company": "FinEdge Logistics",
                "product_name": "Clozflow",
                "calendar_link": "https://cal.com/clozflow/demo",
                "rep_name": "Aditya"
            },
            "objection": "Abhi time nahi hai mere paas, direct mail pe details bhej do na."
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

    devanagari_pattern = re.compile(r'[\u0900-\u097F]')

    for tc in test_cases:
        arch = get_archetype_by_id(tc["id"])
        print(f"\n=======================================================", flush=True)
        print(f"TESTING: {arch['name']} ({tc['id']})", flush=True)
        print(f"=======================================================", flush=True)

        sys_prompt = arch.get("systemPrompt") or arch.get("system_prompt")
        for k, v in tc["vars"].items():
            sys_prompt = re.sub(rf"\{{\{{\s*{k}\s*\|\s*[^}}]+\}}\}}", str(v), sys_prompt)
            sys_prompt = sys_prompt.replace(f"{{{{{k}}}}}", str(v))

        agent_name = tc["vars"].get("agent_name") or tc["vars"].get("rep_name") or arch.get("recommendedVoices", [{}])[0].get("name", "Pearl")
        default_voice = arch.get("defaultVoiceId", "ritu_hi_sales")

        engine = ConversationEngine(
            objective=arch.get("mission", "Qualify intent"),
            lead_context={
                "business_name": tc["name"],
                "prospect_name": tc["name"],
                "capsule_context": f"Archetype Blueprint: {arch['name']}. Details: {tc['vars']}",
                "agent_name": agent_name,
                "speaker": default_voice,
                "voice_config": {"speaker": default_voice}
            },
            system_prompt_override=sys_prompt,
            agent_name=agent_name
        )

        print(f"[ENGINE CONFIG] Agent: {engine.agent_name} | Gender: {engine.gender} | Speaker: {engine.speaker}", flush=True)

        # 1. Spoken Turn 0 (Dynamic Pattern Interrupt Opening)
        tokens = []
        async for tok in engine.generate_response_stream():
            tokens.append(tok)
        opening = "".join(tokens).strip()
        print(f"\n[AGENT (Turn 0 - Dynamic Opening)]:\n  \"{opening}\"", flush=True)
        
        # Script purity check
        dev_in_opening = devanagari_pattern.findall(opening)
        assert len(dev_in_opening) == 0, f"Devanagari detected in opening: {dev_in_opening}"
        assert len(opening.split()) >= 4, f"Opening too short: {opening}"
        engine.add_turn("agent", opening)

        await asyncio.sleep(2.5) # Avoid Groq rate limit spikes

        # 2. Prospect Objection
        print(f"\n[PROSPECT (Turn 1 - Objection)]:\n  \"{tc['objection']}\"", flush=True)
        engine.add_turn("prospect", tc["objection"])

        # 3. Agent Response
        resp_toks = []
        async for tok in engine.generate_response_stream():
            resp_toks.append(tok)
        resp = "".join(resp_toks).strip()
        print(f"[AGENT (Turn 1 - Reframe & Response)]:\n  \"{resp}\"", flush=True)

        # Script purity check
        dev_in_resp = devanagari_pattern.findall(resp)
        assert len(dev_in_resp) == 0, f"Devanagari detected in response: {dev_in_resp}"
        assert len(resp.split()) >= 4, f"Response too short: {resp}"

        await asyncio.sleep(2.5) # Graceful pause for Groq rate limits

    print("\n[SUCCESS] ALL 5 ARCHETYPES TESTED LIVE AND VERIFIED SUCCESSFULLY!")

if __name__ == "__main__":
    asyncio.run(test_archetype_openings())
