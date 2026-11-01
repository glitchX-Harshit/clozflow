import os
import sys
import time
import asyncio
from pathlib import Path

# Setup paths
repo_root = Path(__file__).parent.parent.parent.resolve()
backend_dir = repo_root / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

# Ensure GROQ_API_KEY is available
if not os.getenv("GROQ_API_KEY"):
    env_file = backend_dir / ".env"
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("GROQ_API_KEY=") and not line.startswith("#"):
                    os.environ["GROQ_API_KEY"] = line.split("=", 1)[1].strip("'\"")
                    break

from services.pearl.conversation_engine import ConversationEngine

async def run_single_check():
    print(f"Loaded GROQ_API_KEY: {'YES' if os.getenv('GROQ_API_KEY') else 'NO'}")
    lead = {
        "business_name": "Sobha Developers",
        "prospect_name": "Vikram Malhotra",
        "capsule_context": "3BHK luxury apartments in Whitefield starting at 1.8 Cr. Handover in 6 months.",
        "product_name": "Skyline Residences"
    }
    engine = ConversationEngine(
        objective="Qualify prospect and invite to exclusive weekend site preview.",
        lead_context=lead
    )
    t0 = time.monotonic()
    ttft = None
    tokens = []
    async for tok in engine.generate_response_stream():
        if ttft is None:
            ttft = (time.monotonic() - t0) * 1000
        tokens.append(tok)
    total_time = (time.monotonic() - t0) * 1000
    opening = "".join(tokens).strip()
    print(f"TTFT: {ttft:.1f}ms | Total: {total_time:.1f}ms")
    print(f"Pearl Opening: {opening}")

if __name__ == "__main__":
    asyncio.run(run_single_check())
