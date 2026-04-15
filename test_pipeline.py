import asyncio
import sys
import os

# Ensure backend modules can be imported
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), 'backend')))

from services.sales_ai_engine import SalesAIEngine

async def run_test():
    engine = SalesAIEngine(call_context={"client_name": "TestCorp", "product_name": "hexagon.ai", "call_goal": "Discovery"})
    engine.min_messages = 1 # Override for testing to trigger immediately
    
    # Pre-seed buffer with a rep message so it feels natural
    engine.add_message("rep", "Let me know if you have any questions before we proceed.")

    print("=== TEST 1: Initial Pricing Objection ===")
    res1 = await engine.analyze("prospect", "That seems way too expensive for our budget.")
    print(f"Result 1: {res1}\n")
    
    print("=== TEST 2: Repeated Pricing Objection ===")
    res2 = await engine.analyze("prospect", "I still don't know if we can afford the cost.")
    print(f"Result 2: {res2}\n")
    
    print("=== TEST 3: Third Repeated Pricing Objection ===")
    res3 = await engine.analyze("prospect", "Honestly the price is just the main blocker here.")
    print(f"Result 3: {res3}\n")
    
    print("=== TEST 4: Pivot to Timeline ===")
    res4 = await engine.analyze("prospect", "When can you guys actually deliver this if we sign?")
    print(f"Result 4: {res4}\n")

if __name__ == "__main__":
    asyncio.run(run_test())
