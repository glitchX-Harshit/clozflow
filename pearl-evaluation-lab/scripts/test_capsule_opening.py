import os
import sys
from pathlib import Path

repo_root = Path(__file__).parent.parent.parent.resolve()
backend_dir = repo_root / "backend"
sys.path.insert(0, str(backend_dir))

# Load GROQ_API_KEY
env_file = backend_dir / ".env"
if env_file.exists():
    with open(env_file, "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("GROQ_API_KEY=") and not line.startswith("#"):
                os.environ["GROQ_API_KEY"] = line.split("=", 1)[1].strip("'\"\r\n")
                break

from database import SessionLocal
from models import Capsule
from utils.capsule_formatter import format_capsule_context
from services.pearl.conversation_engine import ConversationEngine
import asyncio

async def main():
    db = SessionLocal()
    capsule = db.query(Capsule).filter(Capsule.id == 1).first()
    capsule_text = format_capsule_context(capsule, db=db)
    db.close()
    
    print("--- CAPSULE CONTEXT ---")
    print(capsule_text)
    print("-----------------------\n")
    
    lead_context = {
        "business_name": "Third Wave Coffee Indiranagar",
        "prospect_name": "Arjun Mehta (Head of Beverage)",
        "capsule_context": capsule_text,
        "product_name": "Oatish Oat Milk"
    }
    
    engine = ConversationEngine(
        objective="Deliver an engaging pattern interrupt about barista oat milk quality and discover if their milkshakes/iced lattes suffer from watery plant milk separation.",
        lead_context=lead_context
    )
    
    tokens = []
    async for tok in engine.generate_response_stream():
        tokens.append(tok)
    
    print("PEARL OPENING:")
    print("".join(tokens).strip())

if __name__ == "__main__":
    asyncio.run(main())
