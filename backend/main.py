import os
import sys

# Many modules print emoji status lines. When stdout is a pipe or file in a
# non-UTF-8 encoding (e.g. Windows cp1252 with `python main.py > log.txt`),
# such a print raises UnicodeEncodeError and can abort startup or a request.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(errors="backslashreplace")
    except (AttributeError, ValueError):
        pass

import logging


class _RedactQueryStrings(logging.Filter):
    """uvicorn logs request paths with their query string (access log and the
    WebSocket "accepted" lines). Carrier webhooks carry a per-call secret in
    ?t= and clients may send ?token=<JWT>, so drop everything after "?"."""

    def filter(self, record):
        if isinstance(record.args, tuple):
            record.args = tuple(
                arg.split("?", 1)[0] if isinstance(arg, str) and arg.startswith("/") and "?" in arg else arg
                for arg in record.args
            )
        return True


for _logger_name in ("uvicorn.access", "uvicorn.error"):
    logging.getLogger(_logger_name).addFilter(_RedactQueryStrings())

from contextlib import asynccontextmanager
import asyncio
from datetime import datetime, timedelta

# Add parent directory to sys.path to allow importing sibling modules like 'rag'
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# Tune PyTorch thread pool for 2-vCPU KVM servers to prevent CPU thread thrashing
try:
    import torch
    torch.set_num_threads(1)
    if hasattr(torch, "set_num_interop_threads"):
        torch.set_num_interop_threads(1)
except Exception:
    pass

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
from database import engine, Base, add_missing_columns
from routers import auth, calls, brain_local
from routers import user as user_router
from routers import leads as leads_router
from routers import outreach as outreach_router
from routers import capsules as capsules_router
from routers import relay as relay_router
from routers import pearl as pearl_router
from routers import intelligence as intelligence_router
from routers import knowledge as knowledge_router
from routers import wallet as wallet_router
from routers import copilot_bridge as copilot_bridge_router  # before create_all: registers its table
import models_wizard  # noqa: F401  # before create_all: Meeting Wizard tables + call_logs columns
from routers import wizard as wizard_router
from admin.routes import router as admin_router
from routers.auth import get_current_user
from models import User
from fastapi import Depends
import os

# Initialize Database tables, then add any new nullable model columns that an
# existing database is missing (create_all never alters existing tables).
Base.metadata.create_all(bind=engine)
add_missing_columns(engine)

# Load environment variables
load_dotenv()

# Check optional provider keys for Pearl (names only; values are never printed).
from services.pearl.providers.elevenlabs_provider import elevenlabs_api_key  # noqa: E402

if not elevenlabs_api_key():
    print("WARNING: Pearl dependency ELEVENLABS_API_KEY (or ELEVEN_LABS_API_KEY) is missing from environment.")
for key in ("EXOTEL_API_KEY", "EXOTEL_ACCOUNT_SID"):
    if not os.getenv(key) and not os.getenv(key.replace("_", "")):
        print(f"WARNING: Pearl dependency {key} is missing from environment.")

# [DEBUG LOG] Check if Gemini key was found in .env
print("Gemini API key loaded:", bool(os.getenv("GEMINI_API_KEY")))

# ── Lifespan: runs once on startup / shutdown ──
@asynccontextmanager
async def lifespan(app):
    # Startup: pre-load Silero VAD model
    from services.vad_engine import SileroVADEngine
    await SileroVADEngine.warmup()
    # Meeting Wizard: seed the battlecard library when empty + transcript retention sweep.
    try:
        await asyncio.to_thread(wizard_router.startup_tasks)
    except Exception as exc:  # noqa: BLE001 - never block startup
        print(f"[wizard] startup tasks skipped: {type(exc).__name__}")

    try:
        yield
    finally:
        await websocket_manager.shutdown()

app = FastAPI(title="hexagon.ai Backend", description="AI Sales Assistant API", lifespan=lifespan)

# Configure CORS with strict allowed origins. Browsers send Origin without a
# trailing slash, so "https://clozflow.com/" in the env var must still match.
allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "")
allowed_origins = [o.strip().rstrip("/") for o in allowed_origins_env.split(",") if o.strip().rstrip("/")]
if not allowed_origins:
    allowed_origins = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        "https://clozflow.com",
        "https://www.clozflow.com",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    # Lead search flags sample (non-live) results with this response header;
    # cross-origin browser code can only read headers listed here.
    expose_headers=["X-Sample-Data"],
)

app.include_router(brain_local.router)
app.include_router(auth.router)
app.include_router(auth.router, prefix="/api")
app.include_router(calls.router)
app.include_router(user_router.router)
app.include_router(leads_router.router)
app.include_router(outreach_router.router)
app.include_router(pearl_router.router)
app.include_router(capsules_router.router)
app.include_router(relay_router.router)
app.include_router(intelligence_router.router)
app.include_router(knowledge_router.router)
app.include_router(wallet_router.router)
app.include_router(copilot_bridge_router.router)  # its lifespan (startup cleanup + watchdog) is merged in
app.include_router(wizard_router.router)
app.include_router(admin_router)

# Serve uploaded avatars (anchored to this folder so it works from any working directory)
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(os.path.join(STATIC_DIR, "avatars"), exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")



import json
from pydantic import BaseModel, Field
from typing import Optional
from services.websocket_service import websocket_manager
from services.call_context_engine import call_context_engine

# Generous limits: the brief is stored, cached in memory and sent to the model
# with every turn, so an unbounded field is a cost and memory problem.
class CallStartRequest(BaseModel):
    client_name: str = Field(max_length=500)
    client_industry: str = Field(max_length=500)
    client_role: str = Field(max_length=500)
    product_name: str = Field(max_length=500)
    product_price: Optional[str] = Field(default=None, max_length=1000)
    product_specification: Optional[str] = Field(default=None, max_length=8000)
    call_goal: str = Field(max_length=2000)
    # Meeting Wizard extension (all optional; old clients keep working). Stored under
    # payload["wizard"] as services.wizard.contracts.WizardContext.
    platform: Optional[str] = Field(default=None, max_length=20)
    deal_value: Optional[str] = Field(default=None, max_length=64)
    active_battlecard: Optional[str] = Field(default=None, max_length=120)
    meeting_id: Optional[str] = Field(default=None, max_length=36)
    methodology: Optional[str] = Field(default=None, max_length=20)
    coaching_intensity: Optional[str] = Field(default=None, max_length=16)
    battlecard_ids: Optional[list[str]] = Field(default=None, max_length=40)
    capsule_id: Optional[int] = None
    consent: Optional[dict] = None
    prospect_phone: Optional[str] = Field(default=None, max_length=32)


@app.get("/")
async def root():
    return {"message": "hexagon.ai backend is running."}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/api/copilot/sessions/active")
async def get_active_copilot_sessions_legacy():
    """Stub to gracefully handle legacy/uninstalled extension polling."""
    return []

@app.post("/call/start")
def start_call(request: CallStartRequest, current_user: User = Depends(get_current_user)):
    # Plain def: FastAPI runs it in the thread pool, so the DB write doesn't block the event loop.
    context_id = call_context_engine.create_context(
        user_id=current_user.id,
        client_name=request.client_name,
        client_industry=request.client_industry,
        client_role=request.client_role,
        product_name=request.product_name,
        product_price=request.product_price or "",
        product_specification=request.product_specification or "",
        call_goal=request.call_goal
    )
    # Meeting Wizard fields → payload["wizard"] (None when none of the optional fields were sent).
    try:
        wizard = wizard_router.wizard_context_for_call_start(current_user.id, request)
        if wizard:
            wizard_router.attach_wizard_context(context_id, wizard)
    except Exception as exc:  # noqa: BLE001 - the legacy brief must still work
        print(f"[wizard] could not attach wizard context: {type(exc).__name__}")
    return {"context_id": context_id, "message": "Call session initialized"}

@app.get("/call/context/{context_id}")
def get_call_context(context_id: str, current_user: User = Depends(get_current_user)):
    context = call_context_engine.get_context(context_id)
    if not context or context.get("user_id") != current_user.id:
        raise HTTPException(status_code=404, detail="Call context not found")
    return {"context": context}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, context_id: str = None, token: str = None):
    if not await authorize_call_socket(websocket, context_id, token):
        return
    await websocket_manager.connect(websocket, context_id=context_id)
    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            data = message.get("text")
            if not isinstance(data, str) or len(data) > 64_000:
                continue  # binary or oversized frames are ignored, never fatal
            try:
                message_data = json.loads(data)
            except ValueError:
                continue
            await websocket_manager.handle_live_message(message_data, websocket)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        await websocket_manager.disconnect_async(websocket)


def _call_socket_allowed(credential, context_id) -> bool:
    """The token is valid and the call brief belongs to its user (sync DB work)."""
    from database import SessionLocal
    from routers.auth import verify_token_string
    if not credential or not context_id:
        return False
    with SessionLocal() as db:
        user = verify_token_string(credential, db)
        if not user:
            return False
        context = call_context_engine.get_context(context_id)
        return bool(context) and context.get('user_id') == user.id


async def authorize_call_socket(websocket, context_id, token):
    origin = websocket.headers.get('origin')
    if origin and origin.rstrip('/') not in allowed_origins:
        await websocket.close(code=1008)
        return False
    scheme, _, bearer = websocket.headers.get('authorization', '').strip().partition(' ')
    credential = bearer.strip() if scheme.lower() == 'bearer' and bearer.strip() else (token or '').strip()
    if credential.lower().startswith('bearer '):
        credential = credential[7:].strip()
    if not credential:
        credential = next((item.strip()[14:] for item in websocket.headers.get('sec-websocket-protocol', '').split(',')
                           if item.strip().startswith('clozflow-auth.')), None)
    try:
        allowed = await asyncio.to_thread(_call_socket_allowed, credential, context_id)
    except Exception:
        allowed = False
    if not allowed:
        await websocket.close(code=1008)
        return False
    return True

@app.websocket("/ws/audio")
async def websocket_audio_endpoint(websocket: WebSocket, context_id: str = None, token: str = None):
    if not await authorize_call_socket(websocket, context_id, token):
        return

    await websocket_manager.connect(websocket, context_id=context_id)
    print("✅ WebSocket connected to /ws/audio")
    await websocket_manager.handle_audio_stream(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
