import os
import sys

# Add parent directory to sys.path to allow importing sibling modules like 'rag'
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from database import engine, Base
from routers import auth, calls
from routers import user as user_router
from routers import leads as leads_router
from routers import outreach as outreach_router
from routers.auth import get_current_user
from models import User
from fastapi import Depends
import os

# Initialize Database tables
Base.metadata.create_all(bind=engine)

# Load environment variables
load_dotenv()

# [DEBUG LOG] Check if deepgram key was found in .env
print("Deepgram key loaded:", bool(os.getenv("DEEPGRAM_API_KEY")))

app = FastAPI(title="hexagon.ai Backend", description="AI Sales Assistant API")

# Configure CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(calls.router)
app.include_router(user_router.router)
app.include_router(leads_router.router)
app.include_router(outreach_router.router)

# Serve uploaded avatars
os.makedirs("static/avatars", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

import json
from pydantic import BaseModel
from services.websocket_service import websocket_manager
from services.call_context_engine import call_context_engine

class CallStartRequest(BaseModel):
    client_name: str
    client_industry: str
    client_role: str
    product_name: str
    call_goal: str


@app.get("/")
async def root():
    return {"message": "hexagon.ai backend is running."}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.post("/call/start")
async def start_call(request: CallStartRequest, current_user: User = Depends(get_current_user)):
    context_id = call_context_engine.create_context(
        user_id=current_user.id,
        client_name=request.client_name,
        client_industry=request.client_industry,
        client_role=request.client_role,
        product_name=request.product_name,
        call_goal=request.call_goal
    )
    return {"context_id": context_id, "message": "Call session initialized"}

@app.get("/call/context/{context_id}")
async def get_call_context(context_id: str):
    context = call_context_engine.get_context(context_id)
    if not context:
        return {"error": "Context not found"}
    return {"context": context}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket_manager.connect(websocket)
    try:
        while True:
            # Legacy text-based endpoint fallback
            data = await websocket.receive_text()
            try:
                message_data = json.loads(data)
                if hasattr(websocket_manager, 'handle_live_message'):
                    await websocket_manager.handle_live_message(message_data, websocket)
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        websocket_manager.disconnect(websocket)

@app.websocket("/ws/audio")
async def websocket_audio_endpoint(websocket: WebSocket, context_id: str = None):
    print(f"🔌 WebSocket connection attempt to /ws/audio (context_id: {context_id})")
    await websocket_manager.connect(websocket, context_id=context_id)
    print("✅ WebSocket connected to /ws/audio")
    await websocket_manager.handle_audio_stream(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
