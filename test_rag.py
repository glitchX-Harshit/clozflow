import asyncio
import time
from backend.services.sales_ai_engine import SalesAIEngine

async def run_tests():
    engine = SalesAIEngine()
    
    test_cases = [
        "too expensive",
        "need to talk to partner",
        "not sure this works"
    ]
    
    print("Testing RAG latency and retrieval...")
    
    for case in test_cases:
        print(f"\n--- Test Case: '{case}' ---")
        start_time = time.time()
        
        # Test RAG retrieval directly first
        rag_results = engine.rag.retrieve(case)
        rag_latency = time.time() - start_time
        print(f"RAG Retrieval Latency: {rag_latency*1000:.2f}ms")
        
        if rag_results:
            print(f"Top Strategy Influenced: {rag_results[0].get('strategy')}")
            print(f"Insight: {rag_results[0].get('insight')}")
        else:
            print("No RAG results found.")
            
        # Test full engine
        print("Testing full engine analyze...")
        full_start = time.time()
        
        # Using a dummy speaker and text
        result = await engine.analyze("prospect", case)
        
        full_latency = time.time() - full_start
        print(f"Full Analyze Latency: {full_latency*1000:.2f}ms")
        
        if result:
            print(f"Engine Selected Strategy: {result.get('persuasion_pattern', result.get('strategy'))}")
        
if __name__ == "__main__":
    asyncio.run(run_tests())
