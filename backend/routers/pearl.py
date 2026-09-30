"""
Pearl API Router
All Pearl endpoints live under /api/pearl.
Reuses existing auth (get_current_user), database (get_db), and models.
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import asyncio
import json

from database import get_db
from routers.auth import get_current_user
from models import User, Capsule, Lead
from models_pearl import PearlAgent, PearlCall, PearlEvent, PearlConversation, PearlMessage

from services.pearl.state_machine import AgentStateMachine, InvalidTransition
from services.pearl.policy_engine import PolicyEngine, DEFAULT_AUTONOMY, DEFAULT_QUALIFICATION
from services.pearl.event_logger import EventLogger


router = APIRouter(prefix="/api/pearl", tags=["pearl"])


# â”€â”€ Request/Response Schemas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class CreateAgentRequest(BaseModel):
    name: str
    role: str = "outbound_qualification"
    capsule_id: Optional[int] = None
    mission: Optional[str] = None
    target_market: Optional[dict] = None
    qualification_rules: Optional[dict] = None
    autonomy_policy: Optional[dict] = None
    voice_config: Optional[dict] = None
    lead_source_config: Optional[dict] = None
    call_provider: str = "exotel"


class UpdateAgentRequest(BaseModel):
    name: Optional[str] = None
    capsule_id: Optional[int] = None
    mission: Optional[str] = None
    target_market: Optional[dict] = None
    qualification_rules: Optional[dict] = None
    autonomy_policy: Optional[dict] = None
    voice_config: Optional[dict] = None
    lead_source_config: Optional[dict] = None
    call_provider: Optional[str] = None


def agent_to_dict(agent: PearlAgent, include_events: bool = False) -> dict:
    """Serialize a PearlAgent to dict for API response."""
    result = {
        "id": agent.id,
        "user_id": agent.user_id,
        "name": agent.name,
        "role": agent.role,
        "status": agent.status,
        "capsule_id": agent.capsule_id,
        "capsule_name": agent.capsule.name if agent.capsule else None,
        "mission": agent.mission,
        "target_market": agent.target_market,
        "qualification_rules": agent.qualification_rules,
        "autonomy_policy": agent.autonomy_policy,
        "voice_config": agent.voice_config,
        "lead_source_config": agent.lead_source_config,
        "call_provider": agent.call_provider,
        "provider_agent_id": agent.provider_agent_id,
        "current_state": agent.current_state,
        "current_lead_id": agent.current_lead_id,
        "metrics": {
            "prospects": agent.prospects_count,
            "contacted": agent.contacted_count,
            "conversations": agent.conversations_count,
            "qualified": agent.qualified_count,
            "meetings": agent.meetings_count,
            "relays": agent.relay_count,
        },
        "created_at": agent.created_at.isoformat() if agent.created_at else None,
        "updated_at": agent.updated_at.isoformat() if agent.updated_at else None,
        "deployed_at": agent.deployed_at.isoformat() if agent.deployed_at else None,
        "completed_at": agent.completed_at.isoformat() if agent.completed_at else None,
    }
    if include_events:
        result["recent_events"] = [event_to_dict(e) for e in (agent.events or [])[:20]]
    return result


def event_to_dict(event: PearlEvent) -> dict:
    """Serialize a PearlEvent to dict."""
    return {
        "id": event.id,
        "agent_id": event.agent_id,
        "call_id": event.call_id,
        "lead_id": event.lead_id,
        "event_type": event.event_type,
        "summary": event.summary,
        "payload": event.payload,
        "timestamp": event.timestamp.isoformat() if event.timestamp else None,
    }


def call_to_dict(call: PearlCall) -> dict:
    """Serialize a PearlCall to dict."""
    return {
        "id": call.id,
        "agent_id": call.agent_id,
        "lead_id": call.lead_id,
        "provider": call.provider,
        "provider_call_id": call.provider_call_id,
        "status": call.status,
        "duration_seconds": call.duration_seconds,
        "outcome": call.outcome,
        "qualification_result": call.qualification_result,
        "transcript_reference": call.transcript_reference,
        "created_at": call.created_at.isoformat() if call.created_at else None,
        "completed_at": call.completed_at.isoformat() if call.completed_at else None,
    }


# â”€â”€ Agent CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.post("/agents")
def create_agent(
    req: CreateAgentRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Create a new Pearl agent."""
    # Validate capsule if provided
    if req.capsule_id:
        capsule = db.query(Capsule).filter(
            Capsule.id == req.capsule_id,
            Capsule.user_id == user.id
        ).first()
        if not capsule:
            raise HTTPException(404, "Capsule not found or does not belong to you")

    agent = PearlAgent(
        user_id=user.id,
        name=req.name,
        role=req.role,
        capsule_id=req.capsule_id,
        mission=req.mission,
        target_market=req.target_market,
        qualification_rules=req.qualification_rules or DEFAULT_QUALIFICATION,
        autonomy_policy=req.autonomy_policy or DEFAULT_AUTONOMY,
        voice_config=req.voice_config,
        lead_source_config=req.lead_source_config,
        call_provider=req.call_provider,
        status="draft",
        current_state="idle",
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)

    # Log creation event
    logger = EventLogger(db, agent.id)
    logger.agent_created(agent.name)

    return agent_to_dict(agent)


@router.get("/agents")
def list_agents(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """List all Pearl agents for the current user."""
    agents = db.query(PearlAgent).filter(
        PearlAgent.user_id == user.id
    ).order_by(PearlAgent.created_at.desc()).all()

    return [agent_to_dict(a) for a in agents]


@router.get("/agents/{agent_id}")
def get_agent(
    agent_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Get a single agent with recent events."""
    agent = db.query(PearlAgent).filter(
        PearlAgent.id == agent_id,
        PearlAgent.user_id == user.id
    ).first()
    if not agent:
        raise HTTPException(404, "Agent not found")
    return agent_to_dict(agent, include_events=True)


@router.patch("/agents/{agent_id}")
def update_agent(
    agent_id: str,
    req: UpdateAgentRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Update agent configuration. Only allowed when agent is draft or paused."""
    agent = db.query(PearlAgent).filter(
        PearlAgent.id == agent_id,
        PearlAgent.user_id == user.id
    ).first()
    if not agent:
        raise HTTPException(404, "Agent not found")

    if agent.status not in ("draft", "paused", "ready"):
        raise HTTPException(400, "Cannot update agent while it is active. Pause it first.")

    # Validate capsule if changing
    if req.capsule_id is not None:
        capsule = db.query(Capsule).filter(
            Capsule.id == req.capsule_id,
            Capsule.user_id == user.id
        ).first()
        if not capsule:
            raise HTTPException(404, "Capsule not found")

    update_fields = req.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        setattr(agent, field, value)

    db.commit()
    db.refresh(agent)
    return agent_to_dict(agent)


@router.delete("/agents/{agent_id}")
def delete_agent(
    agent_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Delete an agent and associated records."""
    agent = db.query(PearlAgent).filter(
        PearlAgent.id == agent_id,
        PearlAgent.user_id == user.id
    ).first()
    if not agent:
        raise HTTPException(404, "Agent not found")

    db.delete(agent)
    db.commit()
    return {"ok": True, "message": f"Agent '{agent.name}' deleted"}


# â”€â”€ Real Deployment V0.1 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class DeployPearlRequest(BaseModel):
    lead_id: int
    objective: Optional[str] = None
    playbook_id: Optional[int] = None
    capsule_id: Optional[int] = None
    voice_provider: Optional[str] = None
    voice_language: Optional[str] = None
    voice_speaker: Optional[str] = None
    voice_pace: Optional[float] = None

@router.post("/deploy")
async def deploy_pearl_call(
    req: DeployPearlRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Real deployment endpoint for Pearl V0.1."""
    # 1. Validate Lead
    lead = db.query(Lead).filter(Lead.id == req.lead_id).first()
    if not lead:
        raise HTTPException(404, "Lead not found")
    if not lead.phone_number:
        raise HTTPException(400, "Lead has no phone number")
        
    import sys
    import os
    sys.path.append(os.path.dirname(os.path.dirname(__file__)))
    from utils.telephony import normalize_indian_phone_number
    
    try:
        normalized_number = normalize_indian_phone_number(lead.phone_number)
    except ValueError as e:
        raise HTTPException(400, str(e))

    # 2. Get or Create PearlAgent (for V0.1 we use a single implicit agent per user or just use the first)
    agent = db.query(PearlAgent).filter(PearlAgent.user_id == user.id).first()
    if not agent:
        agent = PearlAgent(user_id=user.id, name="Pearl Execution Engine", role="outbound_qualification")
        db.add(agent)
    
    # Update Agent context for this deployment
    if req.capsule_id:
        agent.capsule_id = req.capsule_id
        
    agent.voice_config = {
        "provider": req.voice_provider or "Sarvam Bulbul v3",
        "language": req.voice_language or "Auto",
        "speaker": req.voice_speaker or "ritu",
        "pace": req.voice_pace or 1.0
    }
    
    db.commit()
    db.refresh(agent)

    # 3. Create PearlCall
    call = PearlCall(
        agent_id=agent.id,
        lead_id=lead.id,
        provider="exotel",
        status="queued"
    )
    db.add(call)
    db.commit()
    db.refresh(call)

    # 4. Create PearlConversation
    conversation = PearlConversation(
        call_id=call.id,
        lead_id=lead.id,
        objective=req.objective,
        status="active"
    )
    db.add(conversation)
    db.commit()

    # 5. Request Exotel Call
    from services.pearl.providers.exotel_provider import ExotelTelephonyProvider
    provider = ExotelTelephonyProvider()
    
    # from_number should ideally come from user config, falling back to a default Exotel virtual number
    # For now we assume EXOTEL_CALLER_ID is in env
    import os
    caller_id = os.getenv("EXOTEL_CALLER_ID", "0000000000") 
    
    res = await provider.create_outbound_call(normalized_number, caller_id, custom_field=call.id)
    
    if res.get("success"):
        call.provider_call_id = res.get("provider_call_id")
        call.status = "dialing"
        db.commit()
    else:
        call.status = "failed"
        call.error_code = res.get("error", "Unknown Exotel Error")
        db.commit()
        raise HTTPException(500, f"Telephony provider failed: {call.error_code}")

    return {
        "ok": True,
        "call_id": call.id,
        "provider_call_id": call.provider_call_id,
        "status": call.status
    }

@router.get("/calls/{call_id}")
def get_call_status(
    call_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    call = db.query(PearlCall).filter(PearlCall.id == call_id).first()
    if not call:
        raise HTTPException(404, "Call not found")
        
    return {
        "id": call.id,
        "status": call.status,
        "duration_seconds": call.duration_seconds,
        "outcome": call.outcome,
        "provider_call_id": call.provider_call_id,
        "error_code": call.error_code
    }

@router.post("/calls/{call_id}/cancel")
def cancel_call(
    call_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    call = db.query(PearlCall).filter(PearlCall.id == call_id).first()
    if not call:
        raise HTTPException(404, "Call not found")
        
    if call.status in ["completed", "failed", "cancelled", "rejected"]:
        raise HTTPException(400, "Call is already finished")
        
    call.status = "cancelled"
    db.commit()
    
    # Ideally hit Exotel to cancel the call via API
    return {"ok": True, "status": call.status}

@router.post("/agents/{agent_id}/deploy")
def deploy_agent(
    agent_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Deploy an agent â€” transitions from draft/ready to active."""
    agent = db.query(PearlAgent).filter(
        PearlAgent.id == agent_id,
        PearlAgent.user_id == user.id
    ).first()
    if not agent:
        raise HTTPException(404, "Agent not found")

    if agent.status not in ("draft", "ready", "paused"):
        raise HTTPException(400, f"Cannot deploy agent in '{agent.status}' status")

    # Validate minimum configuration
    if not agent.capsule_id:
        raise HTTPException(400, "Agent requires a Capsule before deployment")
    if not agent.mission:
        raise HTTPException(400, "Agent requires a mission before deployment")

    # Update status
    agent.status = "active"
    agent.current_state = "idle"
    agent.deployed_at = datetime.utcnow()
    db.commit()

    # Log deployment
    logger = EventLogger(db, agent.id)
    logger.agent_deployed()

    db.refresh(agent)
    return agent_to_dict(agent)


@router.post("/agents/{agent_id}/pause")
def pause_agent(
    agent_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Pause a running agent."""
    agent = db.query(PearlAgent).filter(
        PearlAgent.id == agent_id,
        PearlAgent.user_id == user.id
    ).first()
    if not agent:
        raise HTTPException(404, "Agent not found")

    if agent.status != "active":
        raise HTTPException(400, "Can only pause an active agent")

    sm = AgentStateMachine(agent.current_state)
    try:
        sm.pause()
    except InvalidTransition as e:
        raise HTTPException(400, str(e))

    agent.status = "paused"
    agent.current_state = "paused"
    db.commit()

    logger = EventLogger(db, agent.id)
    logger.agent_paused("User requested pause")

    db.refresh(agent)
    return agent_to_dict(agent)


@router.post("/agents/{agent_id}/stop")
def stop_agent(
    agent_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Stop an agent permanently."""
    agent = db.query(PearlAgent).filter(
        PearlAgent.id == agent_id,
        PearlAgent.user_id == user.id
    ).first()
    if not agent:
        raise HTTPException(404, "Agent not found")

    if agent.status in ("completed", "error"):
        raise HTTPException(400, "Agent is already stopped")

    agent.status = "completed"
    agent.current_state = "completed"
    agent.completed_at = datetime.utcnow()
    db.commit()

    logger = EventLogger(db, agent.id)
    logger.log("agent_stopped", "Agent stopped by user")

    db.refresh(agent)
    return agent_to_dict(agent)


# â”€â”€ Events & Activity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get("/agents/{agent_id}/events")
def get_agent_events(
    agent_id: str,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Get agent activity timeline (paginated)."""
    agent = db.query(PearlAgent).filter(
        PearlAgent.id == agent_id,
        PearlAgent.user_id == user.id
    ).first()
    if not agent:
        raise HTTPException(404, "Agent not found")

    events = db.query(PearlEvent).filter(
        PearlEvent.agent_id == agent_id
    ).order_by(PearlEvent.timestamp.desc()).offset(offset).limit(limit).all()

    total = db.query(PearlEvent).filter(PearlEvent.agent_id == agent_id).count()

    return {
        "events": [event_to_dict(e) for e in events],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/agents/{agent_id}/calls")
def get_agent_calls(
    agent_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Get call history for an agent."""
    agent = db.query(PearlAgent).filter(
        PearlAgent.id == agent_id,
        PearlAgent.user_id == user.id
    ).first()
    if not agent:
        raise HTTPException(404, "Agent not found")

    calls = db.query(PearlCall).filter(
        PearlCall.agent_id == agent_id
    ).order_by(PearlCall.created_at.desc()).all()

    return [call_to_dict(c) for c in calls]


# â”€â”€ SSE Live Activity Stream â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@router.get("/agents/{agent_id}/stream")
async def stream_agent_activity(
    agent_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """
    Server-Sent Events stream for live agent activity.
    Frontend connects to this for real-time updates.
    """
    # Verify ownership
    agent = db.query(PearlAgent).filter(
        PearlAgent.id == agent_id,
        PearlAgent.user_id == user.id
    ).first()
    if not agent:
        raise HTTPException(404, "Agent not found")

    async def event_generator():
        last_event_id = None
        while True:
            # Poll for new events (in production, use pub/sub)
            query = db.query(PearlEvent).filter(
                PearlEvent.agent_id == agent_id
            ).order_by(PearlEvent.timestamp.desc()).limit(1)

            latest = query.first()
            if latest and latest.id != last_event_id:
                last_event_id = latest.id
                data = json.dumps(event_to_dict(latest))
                yield f"data: {data}\n\n"

            await asyncio.sleep(2)  # Poll every 2 seconds

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


# â”€â”€ Call WebSockets & Webhooks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

from fastapi import WebSocket, WebSocketDisconnect

_ui_connections: dict[str, list[WebSocket]] = {}

def _broadcast_to_ui(call_id: str, msg: dict):
    if call_id in _ui_connections:
        for ws in _ui_connections[call_id]:
            try:
                # Use synchronous send if event loop is running, or push to loop
                asyncio.create_task(ws.send_json(msg))
            except Exception:
                pass

@router.websocket("/calls/{call_id}/stream")
async def call_websocket_endpoint(websocket: WebSocket, call_id: str, db: Session = Depends(get_db)):
    await websocket.accept()
    
    # Ideally, we verify user token here, but for simplicity in MVP we accept
    call = db.query(PearlCall).filter(PearlCall.id == call_id).first()
    if not call:
        await websocket.close(code=1008)
        return
        
    if call_id not in _ui_connections:
        _ui_connections[call_id] = []
    _ui_connections[call_id].append(websocket)
        
    try:
        while True:
            # Poll DB or listen to pubsub
            # We just send a ping and wait
            db.refresh(call)
            data = {
                "status": call.status,
                "outcome": call.outcome,
                "duration": call.duration_seconds
            }
            await websocket.send_json({"type": "call.status", "data": data})
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WebSocket error: {e}")
        await websocket.close()
    finally:
        if call_id in _ui_connections and websocket in _ui_connections[call_id]:
            _ui_connections[call_id].remove(websocket)

import base64
import time
import re
from services.pearl.conversation_engine import ConversationEngine
from services.pearl.providers.elevenlabs_provider import ElevenLabsTTSProvider
from services.gemini_stream import GeminiStream
from services.vad_engine import SileroVADEngine, VADEvent
from services.turn_detector import TurnDetector
from services.latency_tracker import LatencyTracker

from services.pearl.providers.tts import get_tts_provider

# Sentence boundary regex for TTS chunking (primary: .!?।, secondary: ,—;)
_SENTENCE_END_RE = re.compile(r'[.!?\u0964,—;]\s*$')

@router.websocket("/calls/{call_id}/audio")
async def call_audio_stream(websocket: WebSocket, call_id: str, db: Session = Depends(get_db)):
    """
    Exotel Media Stream WebSocket — Optimized realtime pipeline.
    """
    print(f"[Pearl WebSocket] Connection opened for call_id: {call_id}")
    await websocket.accept()

    call = db.query(PearlCall).filter(PearlCall.id == call_id).first()
    if not call:
        print(f"[Pearl WebSocket] Call ID {call_id} not found in DB. Closing.")
        await websocket.close()
        return

    packets_received = 0
    packets_sent = 0

    # ── Pre-call warmup: initialize everything BEFORE prospect audio arrives ──
    conversation_id = call.conversation.id if call.conversation else None
    
    agent = db.query(PearlAgent).filter(PearlAgent.id == call.agent_id).first()
    capsule_text = "No specific product context provided."
    if agent and agent.capsule:
        c = agent.capsule
        capsule_text = (
            f"Product Name: {c.product_name}\n"
            f"Price: {c.product_price}\n"
            f"Specs: {c.product_specification}\n"
            f"Target Audience: {c.target_audience}\n"
            f"Key Differentiators: {c.key_differentiators}\n"
            f"Pain Points Solved: {c.pain_points_solved}"
        )

    prospect_name = "there"
    if call.lead and call.lead.business_name:
        prospect_name = call.lead.business_name

    engine = ConversationEngine(
        objective=call.conversation.objective if call.conversation else "Qualify and book a meeting",
        lead_context={"business_name": prospect_name, "capsule_context": capsule_text}
    )
    
    # Initialize stateful TTS Provider (Sarvam default, ElevenLabs fallback)
    tts = get_tts_provider()
    
    tracker = LatencyTracker()
    _bg_tasks: list[asyncio.Task] = []
    
    # Connect and configure TTS before audio arrives
    try:
        connect_start = time.monotonic()
        await tts.connect()
        
        # Retrieve TTS settings from Agent config or fallback
        voice_cfg = agent.voice_config or {} if agent else {}
        speaker = voice_cfg.get("speaker", "ritu")
        lang = voice_cfg.get("language", "Auto")
        pace = float(voice_cfg.get("pace", 1.0))
        temperature = 0.6
        
        # Map frontend "Auto" or language selections to Sarvam codes
        lang_code = "en-IN"
        if lang == "Hindi": lang_code = "hi-IN"
        elif lang == "English": lang_code = "en-IN"
        
        await tts.configure(language_code=lang_code, speaker=speaker, pace=pace, temperature=temperature)
        print(f"  [METRIC] TTS connection ready: {(time.monotonic() - connect_start)*1000:.0f}ms")
    except Exception as e:
        print(f"[Pearl] TTS Provider init failed, falling back to ElevenLabs. Error: {e}")
        from services.pearl.providers.tts import ElevenLabsTTSProvider as FBProvider
        tts = FBProvider()
        await tts.connect()
        await tts.configure(language_code="en", speaker="default", pace=1.0, temperature=0.6)

    # State tracking for clean orchestration
    pearl_state = "CALL_CONNECTED"
    def set_state(new_state):
        nonlocal pearl_state
        pearl_state = new_state
        print(f"[PEARL STATE] {pearl_state}")

    # Barge-in control
    _speaking = False
    _tts_cancel = asyncio.Event()
    stream_sid = None

    # Continuous background task to receive TTS audio and send to Exotel
    async def _tts_receive_loop():
        nonlocal packets_sent, _speaking
        first_chunk_received = False
        while True:
            try:
                # We use manual async iteration to apply a timeout when waiting for chunks.
                # If LLM is finished generating and we don't get a TTS chunk for 1.5s,
                # we assume the turn has completely finished playing.
                audio_iter = tts.receive_audio().__aiter__()
                while True:
                    try:
                        timeout = 1.5 if (_speaking and getattr(tts, '_llm_finished', False)) else None
                        if timeout:
                            audio_chunk = await asyncio.wait_for(audio_iter.__anext__(), timeout=timeout)
                        else:
                            audio_chunk = await audio_iter.__anext__()
                    except asyncio.TimeoutError:
                        if _speaking:
                            print("[TTS] Idle timeout reached. Assuming turn is complete.")
                            _speaking = False
                            first_chunk_received = False
                            set_state("LISTENING")
                        continue
                    except StopAsyncIteration:
                        if _speaking:
                            print("[TTS] Stream iter ended while speaking. Waiting for reconnect...")
                        await asyncio.sleep(0.5)
                        break # Go to outer loop to restart audio_iter

                    if audio_chunk == b"__FLUSH_COMPLETE__":
                        _speaking = False
                        first_chunk_received = False
                        set_state("LISTENING")
                        continue

                    if _tts_cancel.is_set():
                        if _speaking:
                            _speaking = False
                            first_chunk_received = False
                            set_state("LISTENING")
                        continue
                    
                    if not first_chunk_received:
                        tracker.on_tts_first_audio()
                        first_chunk_received = True
                        if pearl_state == "SPEAKING" and not packets_sent:
                            set_state("OPENING_AUDIO_STARTED")
                        elif pearl_state == "SPEAKING":
                            set_state("RESPONSE_TTS_STARTED")

                    # Send audio back to Exotel as base64 media event
                    encoded = base64.b64encode(audio_chunk).decode("utf-8")
                    out_msg = {
                        "event": "media",
                        "media": {"payload": encoded}
                    }
                    if stream_sid:
                        out_msg["stream_sid"] = stream_sid
                        
                    await websocket.send_json(out_msg)
                    
                    packets_sent += 1
                    if packets_sent == 1:
                        print(f"[Exotel WS] First outbound audio packet sent")
                    elif packets_sent % 1000 == 0:
                        print(f"[Exotel WS] Sent {packets_sent} outbound audio packets so far.")
            
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[Pearl WebSocket] TTS stream receive loop error: {e}")
                await asyncio.sleep(1) # Backoff on error
            
    _bg_tasks.append(asyncio.create_task(_tts_receive_loop()))

    # ── Turn-complete callback: LLM → TTS → Exotel (critical path) ──
    async def on_turn_complete(prospect_text: str):
        nonlocal _speaking
        if not prospect_text.strip():
            return
            
        set_state("TRANSCRIPTION_COMPLETE")

        tracker.on_turn_flushed()
        engine.add_turn("prospect", prospect_text)

        # Background: persist prospect message + analyze signals
        async def _persist_prospect():
            try:
                from database import SessionLocal
                s = SessionLocal()
                if conversation_id:
                    msg = PearlMessage(conversation_id=conversation_id, speaker="prospect", text=prospect_text)
                    s.add(msg)
                    s.commit()
                    analysis = engine.analyze_latest_turn(prospect_text)
                    if analysis.get("signals") or analysis.get("objections"):
                        conv = s.query(PearlConversation).filter(PearlConversation.id == conversation_id).first()
                        if conv:
                            current = conv.qualification_state or {}
                            sigs = current.get("signals", []) + analysis.get("signals", [])
                            objs = current.get("objections", []) + analysis.get("objections", [])
                            conv.qualification_state = {"signals": list(set(sigs)), "objections": list(set(objs))}
                            if "meeting_interest" in analysis.get("signals", []):
                                conv.meeting_requested = True
                            s.commit()
                s.close()
            except Exception as e:
                print(f"[Pearl BG] Persist error: {e}")

        _bg_tasks.append(asyncio.create_task(_persist_prospect()))

        # ── Critical path: LLM stream → sentence chunk → TTS ──
        set_state("PROCESSING")
        _speaking = True
        _tts_cancel.clear()
        tts._llm_finished = False

        if hasattr(tts, 'reset_buffer'):
            tts.reset_buffer()

        llm_start = time.monotonic()
        llm_first_token = None
        sentence_buffer = ""
        full_response = ""
        
        tracker.on_generation_started()

        try:
            async for token in engine.generate_response_stream():
                if _tts_cancel.is_set():
                    await tts.cancel()
                    break  # Barge-in: prospect started speaking

                full_response += token
                sentence_buffer += token

                if llm_first_token is None:
                    llm_first_token = time.monotonic()
                    tracker.on_llm_first_token()
                    print(f"  [METRIC] LLM first token: {(llm_first_token - llm_start)*1000:.0f}ms")
                    set_state("RESPONSE_GENERATED")
                    set_state("SPEAKING")

                # Stream word-by-word for seamless real-time TTS synthesis
                if sentence_buffer.endswith(" ") or _SENTENCE_END_RE.search(sentence_buffer):
                    tracker.on_first_sentence()
                    await tts.send_text(sentence_buffer)
                    sentence_buffer = ""

            # Flush remaining text
            if sentence_buffer.strip() and not _tts_cancel.is_set():
                tracker.on_first_sentence()
                await tts.send_text(sentence_buffer.strip())
            
            # Send flush signal indicating end of LLM response
            if not _tts_cancel.is_set():
                await tts.flush()

        except Exception as e:
            print(f"[Pearl] LLM error: {e}")
            if not full_response.strip():
                print("[Pearl] LLM failed to generate response. Using fallback.")
                set_state("RESPONSE_GENERATED")
                set_state("SPEAKING")
                full_response = "Sorry, could you repeat that?"
                await tts.send_text(full_response)
                await tts.flush()

        tts._llm_finished = True
        engine.add_turn("agent", full_response)
        _broadcast_to_ui(call_id, {"type": "transcript", "data": {"speaker": "agent", "text": full_response}})
        tracker.on_ai_complete()
        breakdown = tracker.finalize()

        # Background: persist agent message
        async def _persist_agent():
            try:
                from database import SessionLocal
                s = SessionLocal()
                if conversation_id:
                    msg = PearlMessage(conversation_id=conversation_id, speaker="agent", text=full_response)
                    s.add(msg)
                    s.commit()
                s.close()
            except Exception as e:
                print(f"[Pearl BG] Agent persist error: {e}")

        _bg_tasks.append(asyncio.create_task(_persist_agent()))

    # ── VAD + STT setup ──
    vad = SileroVADEngine()
    await vad.initialize()

    turn_detector = TurnDetector(on_turn_complete=on_turn_complete, tracker=tracker)

    async def transcript_callback(speaker, text, is_final=True, speech_final=False):
        if pearl_state not in ["LISTENING", "PROSPECT_SPEECH_STARTED", "PROSPECT_SPEECH_ENDED"]:
            return
            
        tracker.on_transcript_received()
        if text:
            turn_detector.on_transcript(text, is_final=is_final)
            
        if is_final and text:
            _broadcast_to_ui(call_id, {"type": "transcript", "data": {"speaker": "prospect", "text": text}})
            
        if speech_final:
            turn_detector.on_speech_final()

    stt = GeminiStream(transcript_callback=transcript_callback)
    stt_connected = await stt.connect()
    if not stt_connected:
        print("[Pearl] STT connection failed, closing audio WS")
        await websocket.close()
        return
        
    # Generate dynamic initial pattern interrupt greeting via LLM
    print(f"[Pearl] Generating dynamic pattern interrupt opening for {prospect_name}")
    set_state("GENERATING_OPENING")
    _speaking = True
    _tts_cancel.clear()
    tts._llm_finished = False
    
    # Reset TTS cumulative buffer for the new turn
    if hasattr(tts, 'reset_buffer'):
        tts.reset_buffer()
        
    sentence_buffer = ""
    full_response = ""
    llm_error = False
    
    try:
        async for token in engine.generate_response_stream():
            if _tts_cancel.is_set():
                await tts.cancel()
                break

            if not full_response:
                set_state("OPENING_GENERATED")
                set_state("SPEAKING")

            full_response += token
            sentence_buffer += token

            if sentence_buffer.endswith(" ") or _SENTENCE_END_RE.search(sentence_buffer):
                await tts.send_text(sentence_buffer)
                sentence_buffer = ""

        if sentence_buffer.strip() and not _tts_cancel.is_set():
            await tts.send_text(sentence_buffer.strip())
        
        if not _tts_cancel.is_set():
            await tts.flush()
            
    except Exception as e:
        print(f"[Pearl] LLM init error: {e}")
        llm_error = True
        
    if llm_error or not full_response.strip():
        print("[Pearl] Initial LLM generation failed or empty. Using safe fallback.")
        set_state("OPENING_GENERATED")
        set_state("SPEAKING")
        full_response = "Hi, I wanted to quickly ask you about something related to your business."
        await tts.send_text(full_response)
        await tts.flush()

    tts._llm_finished = True
    if full_response.strip():
        engine.add_turn("agent", full_response.strip())
        _broadcast_to_ui(call_id, {"type": "transcript", "data": {"speaker": "agent", "text": full_response.strip()}})

    # ── Main audio receive loop ──
    try:
        resample_state = None
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)

            event_type = data.get("event")
            if event_type == "start":
                stream_sid = data.get("start", {}).get("stream_sid")
                print(f"[Pearl WebSocket] Audio stream started for call {call_id}.")
                print(f"[Pearl WebSocket] Stream settings: {data.get('start', {})}")
                
            elif event_type == "media":
                payload = data.get("media", {}).get("payload", "")
                if not payload:
                    continue

                packets_received += 1
                if packets_received == 1:
                    print(f"[Pearl WebSocket] First audio packet received from Exotel.")
                elif packets_received % 1000 == 0:
                    print(f"[Pearl WebSocket] Received {packets_received} audio packets so far.")

                audio_bytes_8k = base64.b64decode(payload)
                # Note: This tracks prospect audio received for VAD
                tracker.on_audio_sent() 

                # Resample 8kHz Exotel audio to 16kHz for Gemini and Silero VAD
                import audioop
                audio_bytes, resample_state = audioop.ratecv(audio_bytes_8k, 2, 1, 8000, 16000, resample_state)

                # Forward to STT (non-blocking) so Gemini connection doesn't time out (1008 error)
                await stt.send_audio(audio_bytes)

                if pearl_state not in ["LISTENING", "PROSPECT_SPEECH_STARTED", "PROSPECT_SPEECH_ENDED"]:
                    # Ignore telephony/system audio or own speech echoing for turn detection
                    continue

                if not vad.is_speaking and _speaking:
                    # Ignore if pearl is still speaking and VAD somehow picked it up
                    continue

                # VAD processing (< 1ms per chunk)
                vad_events = vad.process_chunk(audio_bytes)
                for ev in vad_events:
                    if ev == VADEvent.SPEECH_START:
                        set_state("PROSPECT_SPEECH_STARTED")
                        turn_detector.on_speech_start()
                        # Barge-in: if Pearl is speaking, cancel TTS
                        if _speaking:
                            _tts_cancel.set()
                            print("  [BARGE-IN] Prospect speech detected - cancelling TTS")
                    elif ev == VADEvent.SPEECH_END:
                        set_state("PROSPECT_SPEECH_ENDED")
                        turn_detector.on_speech_end()

            elif event_type == "stop":
                print(f"[Pearl WebSocket] Exotel sent 'stop' event. Ending stream.")
                break

    except WebSocketDisconnect:
        print(f"[Pearl WebSocket] Disconnected by client (Exotel).")
    except Exception as e:
        print(f"[Pearl WebSocket] Audio WS error: {e}")
    finally:
        print(f"[Pearl WebSocket] Connection closed. Total packets received: {packets_received}, sent (by TTS loop).")
        turn_detector.cleanup()
        await stt.close()
        # Wait for background persistence tasks to finish
        for t in _bg_tasks:
            if not t.done():
                try:
                    await asyncio.wait_for(t, timeout=5.0)
                except:
                    pass
        try:
            await websocket.close()
        except:
            pass




from fastapi import Request

@router.post("/webhooks/exotel")
async def exotel_webhook(request: Request, db: Session = Depends(get_db)):
    """Exotel call state webhook."""
    form_data = await request.form()
    custom_field = form_data.get("CustomField")
    status = form_data.get("Status")
    provider_call_id = form_data.get("CallSid")
    duration = form_data.get("Duration")
    
    if not custom_field:
        return {"ok": False}
        
    call = db.query(PearlCall).filter(PearlCall.id == custom_field).first()
    if call:
        # Map Exotel status to our status
        if status == "in-progress":
            call.status = "active"
            if not call.started_at:
                call.started_at = datetime.utcnow()
            if not call.answered_at:
                call.answered_at = datetime.utcnow()
        elif status in ["completed", "busy", "no-answer", "failed", "canceled"]:
            call.status = status if status in ["failed", "busy"] else "completed"
            if status == "no-answer":
                call.status = "no_answer"
            elif status == "canceled":
                call.status = "cancelled"
            
            call.completed_at = datetime.utcnow()
            call.ended_at = datetime.utcnow()
            call.outcome = call.status
            if duration and duration.isdigit():
                call.duration_seconds = int(duration)
            elif call.answered_at:
                call.duration_seconds = int((datetime.utcnow() - call.answered_at).total_seconds())
            
        if provider_call_id:
            call.provider_call_id = provider_call_id
            
        db.commit()
    
    return {"ok": True}


