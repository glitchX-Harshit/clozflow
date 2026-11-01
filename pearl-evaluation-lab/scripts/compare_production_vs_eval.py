import sys, os, asyncio
from pathlib import Path

backend_dir = Path("backend").resolve()
sys.path.insert(0, str(backend_dir))

with open(backend_dir / ".env") as f:
    for line in f:
        if line.startswith("GROQ_API_KEY="):
            os.environ["GROQ_API_KEY"] = line.split("=", 1)[1].strip("'\"\r\n")

from database import SessionLocal
import models
from models import Capsule
from models_pearl import PearlAgent
from utils.capsule_formatter import format_capsule_context
from services.pearl.conversation_engine import ConversationEngine

async def main():
    db = SessionLocal()
    c1 = db.query(Capsule).filter(Capsule.id == 1).first()
    c3 = db.query(Capsule).filter(Capsule.id == 3).first()
    agent = db.query(PearlAgent).first()
    
    ctx1 = format_capsule_context(c1, db=db)
    ctx3 = format_capsule_context(c3, db=db)
    db.close()
    
    print("=== TEST 1: Clean Production Call (Capsule 1, Simple Natural Goal) ===")
    e1 = ConversationEngine(
        objective="Qualify and check if they want to try a sample batch of barista oat milk for their cafe.",
        lead_context={"business_name": "Blue Tokai Indiranagar", "capsule_context": ctx1}
    )
    res1 = []
    async for tok in e1.generate_response_stream():
        res1.append(tok)
    print("".join(res1).strip())
    print()

    print("=== TEST 2: Browser Test Chat Mode (How pearl.py invokes it in production UI) ===")
    e2 = ConversationEngine(
        objective="Qualify and book a meeting",
        lead_context={"business_name": "Arjun from Blue Tokai", "capsule_context": ctx1}
    )
    res2 = []
    async for tok in e2.generate_response_stream():
        res2.append(tok)
    print("".join(res2).strip())
    print()

if __name__ == "__main__":
    asyncio.run(main())
