"""
Pearl API Router
All Pearl endpoints live under /api/pearl.
Reuses existing auth (get_current_user), database (get_db), and models.
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import asyncio
import json

from database import get_db
from routers.auth import get_current_user, verify_token_string
from models import User, Capsule, Lead
from models_pearl import (
    PearlAgent, PearlCall, PearlEvent, PearlConversation, PearlMessage,
    PearlTestSession, PearlTestMessage, PearlCampaign, PearlCampaignRecipient
)
from services.pearl.lead_ingestion import (
    process_lead_batch, parse_csv_file, parse_xlsx_sheets,
    canonicalize_lead_row, validate_and_normalize_phone
)

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
    system_prompt: Optional[str] = None
    greeting: Optional[str] = None
    test_variables: Optional[dict] = None


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
    system_prompt: Optional[str] = None
    greeting: Optional[str] = None
    test_variables: Optional[dict] = None


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
        "system_prompt": agent.system_prompt,
        "greeting": agent.greeting,
        "test_variables": agent.test_variables,
        "version": agent.version or 1,
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
        system_prompt=req.system_prompt,
        greeting=req.greeting,
        test_variables=req.test_variables,
        version=1,
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


@router.post("/agents/{agent_id}/duplicate")
def duplicate_agent(
    agent_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Duplicate an existing agent with a new ID and draft status."""
    agent = db.query(PearlAgent).filter(
        PearlAgent.id == agent_id,
        PearlAgent.user_id == user.id
    ).first()
    if not agent:
        raise HTTPException(404, "Agent not found")

    new_agent = PearlAgent(
        user_id=user.id,
        name=f"{agent.name} (Copy)",
        role=agent.role,
        capsule_id=agent.capsule_id,
        mission=agent.mission,
        target_market=agent.target_market,
        qualification_rules=agent.qualification_rules,
        autonomy_policy=agent.autonomy_policy,
        voice_config=agent.voice_config,
        lead_source_config=agent.lead_source_config,
        call_provider=agent.call_provider,
        system_prompt=agent.system_prompt,
        greeting=agent.greeting,
        test_variables=agent.test_variables,
        version=1,
        status="draft",
        current_state="idle",
    )
    db.add(new_agent)
    db.commit()
    db.refresh(new_agent)

    logger = EventLogger(db, new_agent.id)
    logger.agent_created(new_agent.name)

    return agent_to_dict(new_agent)


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
        "provider": req.voice_provider or "Sarvam Bulbul v4-flash",
        "language": req.voice_language or "Auto",
        "speaker": req.voice_speaker or "shubh_enhi_ads",
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
    call = db.query(PearlCall).join(PearlAgent).filter(
        PearlCall.id == call_id,
        PearlAgent.user_id == user.id
    ).first()
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
    call = db.query(PearlCall).join(PearlAgent).filter(
        PearlCall.id == call_id,
        PearlAgent.user_id == user.id
    ).first()
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
    token = websocket.query_params.get("token")
    user = verify_token_string(token, db) if token else None
    
    call = db.query(PearlCall).join(PearlAgent).filter(
        PearlCall.id == call_id,
        PearlAgent.user_id == user.id
    ).first() if user else None
    
    if not call:
        await websocket.close(code=1008)
        return

    await websocket.accept()
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
from services.pearl.phrase_chunker import PhraseChunker

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
        objective=call.conversation.objective if (call.conversation and call.conversation.objective) else (agent.mission if agent and agent.mission else "Qualify and book a meeting"),
        lead_context={"business_name": prospect_name, "capsule_context": capsule_text},
        system_prompt_override=agent.system_prompt if agent and agent.system_prompt and agent.system_prompt.strip() else None
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
        speaker = voice_cfg.get("speaker", "shubh_enhi_ads")
        lang = voice_cfg.get("language", "Auto")
        pace = float(voice_cfg.get("pace", 1.0))
        temperature = 0.6
        
        # Map frontend "Auto" or language selections to Sarvam codes
        lang_code = "en-IN"
        if lang == "Hindi": lang_code = "hi-IN"
        elif lang == "English": lang_code = "en-IN"
        elif "_hi_" in speaker: lang_code = "hi-IN"
        
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
    _generation_id = 0
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

        # ── Critical path: LLM stream → PhraseChunker → TTS ──
        nonlocal _generation_id
        _generation_id += 1
        current_gen = _generation_id

        set_state("PROCESSING")
        _speaking = True
        _tts_cancel.clear()
        tts._llm_finished = False

        if hasattr(tts, 'reset_buffer'):
            tts.reset_buffer()

        llm_start = time.monotonic()
        llm_first_token = None
        full_response = ""
        chunker = PhraseChunker(first_chunk_words=3, subsequent_chunk_words=7)
        
        tracker.on_generation_started()

        try:
            async for token in engine.generate_response_stream():
                if _tts_cancel.is_set() or _generation_id != current_gen:
                    await tts.cancel()
                    break  # Barge-in: prospect started speaking

                full_response += token

                if llm_first_token is None:
                    llm_first_token = time.monotonic()
                    tracker.on_llm_first_token()
                    print(f"  [METRIC] LLM first token: {(llm_first_token - llm_start)*1000:.0f}ms")
                    set_state("RESPONSE_GENERATED")
                    set_state("SPEAKING")

                for phrase in chunker.feed(token):
                    if _tts_cancel.is_set() or _generation_id != current_gen:
                        break
                    tracker.on_first_sentence()
                    await tts.send_text(phrase)

            # Flush remaining phrases
            if not _tts_cancel.is_set() and _generation_id == current_gen:
                for phrase in chunker.flush():
                    if _tts_cancel.is_set() or _generation_id != current_gen:
                        break
                    tracker.on_first_sentence()
                    await tts.send_text(phrase)
            
            # Send flush signal indicating end of LLM response
            if not _tts_cancel.is_set() and _generation_id == current_gen:
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
    _generation_id += 1
    opening_gen = _generation_id
    _speaking = True
    _tts_cancel.clear()
    tts._llm_finished = False
    
    # Reset TTS cumulative buffer for the new turn
    if hasattr(tts, 'reset_buffer'):
        tts.reset_buffer()
        
    full_response = ""
    llm_error = False
    chunker = PhraseChunker(first_chunk_words=3, subsequent_chunk_words=7)
    
    try:
        async for token in engine.generate_response_stream():
            if _tts_cancel.is_set() or _generation_id != opening_gen:
                await tts.cancel()
                break

            if not full_response:
                set_state("OPENING_GENERATED")
                set_state("SPEAKING")

            full_response += token
            for phrase in chunker.feed(token):
                if _tts_cancel.is_set() or _generation_id != opening_gen:
                    break
                await tts.send_text(phrase)

        if not _tts_cancel.is_set() and _generation_id == opening_gen:
            for phrase in chunker.flush():
                if _tts_cancel.is_set() or _generation_id != opening_gen:
                    break
                await tts.send_text(phrase)
        
        if not _tts_cancel.is_set() and _generation_id == opening_gen:
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

                # VAD processing (< 1ms per chunk)
                vad_events = vad.process_chunk(audio_bytes)
                for ev in vad_events:
                    if ev == VADEvent.SPEECH_START:
                        # Barge-in: if Pearl is speaking, cancel TTS immediately and clear telephony buffer
                        if _speaking:
                            print("  [BARGE-IN] Prospect speech detected - cancelling TTS")
                            _tts_cancel.set()
                            _generation_id += 1
                            _speaking = False
                            set_state("LISTENING")
                            asyncio.create_task(tts.cancel())
                            if stream_sid:
                                try:
                                    asyncio.create_task(websocket.send_json({"event": "clear", "stream_sid": stream_sid}))
                                except Exception:
                                    pass
                            turn_detector.on_speech_start()
                        else:
                            set_state("PROSPECT_SPEECH_STARTED")
                            turn_detector.on_speech_start()
                    elif ev == VADEvent.SPEECH_END:
                        if not _speaking:
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




class VoicePreviewRequest(BaseModel):
    speaker: str
    text: str = "Hello, I am ready to help you discover and qualify prospects."

@router.post("/preview_voice")
async def preview_voice(req: VoicePreviewRequest, current_user = Depends(get_current_user)):
    """Generate a quick TTS preview for the frontend UI using Sarvam."""
    import os
    import requests
    from fastapi.responses import JSONResponse

    api_key = os.getenv("SARVAM_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="SARVAM_API_KEY missing")

    url = "https://api.sarvam.ai/text-to-speech"
    headers = {
        "api-subscription-key": api_key,
        "Content-Type": "application/json"
    }
    from services.pearl.providers.tts import normalize_sarvam_v4_speaker
    normalized_speaker = normalize_sarvam_v4_speaker(req.speaker)
    target_lang = "en-IN" if "_en_" in normalized_speaker else "hi-IN"
    payload = {
        "inputs": [req.text],
        "target_language_code": target_lang,
        "speaker": normalized_speaker,
        "pitch": 0,
        "pace": 1.0,
        "loudness": 1.5,
        "speech_sample_rate": 8000,
        "enable_preprocessing": True,
        "model": "bulbul:v4-flash"
    }
    
    try:
        resp = requests.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        if "audios" in data and len(data["audios"]) > 0:
            return {"audio_base64": data["audios"][0]}
        raise HTTPException(status_code=500, detail="No audio returned from Sarvam")
    except Exception as e:
        print(f"Sarvam preview error: {e}")
        raise HTTPException(status_code=500, detail=str(e))




# ═══════════════════════════════════════════════════════════════════════════════
# BROWSER TEST SESSIONS & CHAT / VOICE TESTING
# ═══════════════════════════════════════════════════════════════════════════════

class CreateTestSessionRequest(BaseModel):
    agent_id: str
    mode: str = "chat"  # "chat" or "voice"


class SendChatMessageRequest(BaseModel):
    message: str


def test_session_to_dict(session: PearlTestSession) -> dict:
    return {
        "id": session.id,
        "agent_id": session.agent_id,
        "mode": session.mode,
        "status": session.status,
        "agent_snapshot": session.agent_snapshot,
        "summary": session.summary,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "text": m.text,
                "timestamp": m.timestamp.isoformat() if m.timestamp else None,
                "meta": m.meta
            }
            for m in (session.messages or [])
        ]
    }


@router.post("/test-sessions")
async def create_test_session(
    req: CreateTestSessionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """
    Create a new browser test session for an agent.
    Takes an immutable snapshot of the agent's current configuration.
    """
    agent = db.query(PearlAgent).filter(
        PearlAgent.id == req.agent_id,
        PearlAgent.user_id == user.id
    ).first()
    if not agent:
        raise HTTPException(404, "Agent not found")

    # Build comprehensive capsule context if linked
    capsule_text = "No specific product context provided."
    if agent.capsule:
        c = agent.capsule
        capsule_text = (
            f"Product Name: {c.product_name}\n"
            f"Price: {c.product_price or 'N/A'}\n"
            f"Specs: {c.product_specification or 'N/A'}\n"
            f"Target Audience: {c.target_audience or 'N/A'}\n"
            f"Key Differentiators: {c.key_differentiators or 'N/A'}\n"
            f"Pain Points Solved: {c.pain_points_solved or 'N/A'}\n"
            f"Extra Context: {c.additional_context or ''}"
        )

    # greeting is ONLY set if explicitly configured by the user; no canned fallback!
    custom_greeting = agent.greeting if (agent.greeting and agent.greeting.strip()) else None

    snapshot = {
        "agent_id": agent.id,
        "name": agent.name,
        "mission": agent.mission or "Qualify prospect and establish fit.",
        "system_prompt": agent.system_prompt or "",
        "greeting": custom_greeting,
        "voice_config": agent.voice_config or {},
        "capsule_id": agent.capsule_id,
        "capsule_context": capsule_text,
        "test_variables": agent.test_variables or {"prospect_name": "Prospect", "company": "Acme Corp"},
        "version": agent.version or 1
    }

    session = PearlTestSession(
        user_id=user.id,
        agent_id=agent.id,
        mode=req.mode,
        status="active",
        agent_snapshot=snapshot
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    # For chat mode: seed initial opening
    if req.mode == "chat":
        if custom_greeting:
            tvars = snapshot.get("test_variables") or {}
            rendered_greeting = custom_greeting
            for k, v in tvars.items():
                rendered_greeting = rendered_greeting.replace(f"{{{{{k}}}}}", str(v))
            opening_text = rendered_greeting
        else:
            # Generate dynamic pattern interrupt opening via ConversationEngine
            prospect_name = snapshot.get("test_variables", {}).get("prospect_name") or "there"
            sys_override = snapshot.get("system_prompt")
            engine = ConversationEngine(
                objective=snapshot.get("mission") or "Qualify prospect and establish fit.",
                lead_context={"business_name": prospect_name, "capsule_context": capsule_text},
                system_prompt_override=sys_override if sys_override and sys_override.strip() else None
            )
            tokens = []
            try:
                async for tok in engine.generate_response_stream():
                    tokens.append(tok)
                opening_text = "".join(tokens).strip() or "Namaste, main Clozflow se bol rahi hoon."
            except Exception as e:
                print(f"[Create Test Session] Dynamic opening error: {e}")
                opening_text = "Namaste, main Clozflow se bol rahi hoon."

        initial_msg = PearlTestMessage(
            session_id=session.id,
            role="assistant",
            text=opening_text,
            meta={"is_opening": True}
        )
        db.add(initial_msg)
        db.commit()
        db.refresh(session)

    return test_session_to_dict(session)


@router.get("/test-sessions/{session_id}")
def get_test_session(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Retrieve test session status, snapshot, and conversation history."""
    session = db.query(PearlTestSession).filter(
        PearlTestSession.id == session_id,
        PearlTestSession.user_id == user.id
    ).first()
    if not session:
        raise HTTPException(404, "Test session not found")
    return test_session_to_dict(session)


@router.post("/test-sessions/{session_id}/chat")
async def send_test_chat_message(
    session_id: str,
    req: SendChatMessageRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """
    Execute a turn in Chat testing mode.
    Uses the real ConversationEngine with the agent's snapshot and product capsule.
    """
    session = db.query(PearlTestSession).filter(
        PearlTestSession.id == session_id,
        PearlTestSession.user_id == user.id
    ).first()
    if not session:
        raise HTTPException(404, "Test session not found")

    user_text = req.message.strip()
    if not user_text:
        raise HTTPException(400, "Message cannot be empty")

    # Persist user message
    user_msg = PearlTestMessage(session_id=session.id, role="user", text=user_text)
    db.add(user_msg)
    db.commit()

    # Load agent snapshot
    snapshot = session.agent_snapshot or {}
    objective = snapshot.get("mission", "Qualify prospect and answer questions.")
    lead_ctx = {
        "business_name": snapshot.get("test_variables", {}).get("prospect_name") or snapshot.get("test_variables", {}).get("company") or "Prospect",
        "capsule_context": snapshot.get("capsule_context", "No product context provided.")
    }
    system_prompt = snapshot.get("system_prompt")

    engine = ConversationEngine(
        objective=objective,
        lead_context=lead_ctx,
        system_prompt_override=system_prompt if system_prompt and system_prompt.strip() else None
    )

    # Replay session history into engine
    prior_messages = db.query(PearlTestMessage).filter(
        PearlTestMessage.session_id == session.id
    ).order_by(PearlTestMessage.timestamp.asc()).all()

    for m in prior_messages:
        engine.add_turn("prospect" if m.role == "user" else "agent", m.text)

    # Stream or generate real LLM response
    import time
    t0 = time.monotonic()
    response_tokens = []
    try:
        async for token in engine.generate_response_stream():
            response_tokens.append(token)
    except Exception as e:
        print(f"[Browser Test Chat] LLM error: {e}")
        response_tokens = ["I apologize, my language processor encountered a momentary delay. Could you please repeat that?"]

    response_text = "".join(response_tokens).strip() or "I understand. How else can I assist with your inquiry?"
    latency_ms = int((time.monotonic() - t0) * 1000)

    asst_msg = PearlTestMessage(
        session_id=session.id,
        role="assistant",
        text=response_text,
        meta={"latency_ms": latency_ms}
    )
    db.add(asst_msg)
    session.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(asst_msg)

    return {
        "ok": True,
        "message": {
            "id": asst_msg.id,
            "role": asst_msg.role,
            "text": asst_msg.text,
            "timestamp": asst_msg.timestamp.isoformat(),
            "meta": asst_msg.meta
        }
    }


@router.post("/test-sessions/{session_id}/clear")
async def clear_test_session(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Clear conversation history and restart session."""
    session = db.query(PearlTestSession).filter(
        PearlTestSession.id == session_id,
        PearlTestSession.user_id == user.id
    ).first()
    if not session:
        raise HTTPException(404, "Test session not found")

    db.query(PearlTestMessage).filter(PearlTestMessage.session_id == session.id).delete()

    snapshot = session.agent_snapshot or {}
    custom_greeting = snapshot.get("greeting")

    # For chat mode: restart with opening message
    if session.mode == "chat":
        if custom_greeting and custom_greeting.strip():
            tvars = snapshot.get("test_variables") or {}
            rendered_greeting = custom_greeting
            for k, v in tvars.items():
                rendered_greeting = rendered_greeting.replace(f"{{{{{k}}}}}", str(v))
            opening_text = rendered_greeting
        else:
            prospect_name = snapshot.get("test_variables", {}).get("prospect_name") or "there"
            capsule_text = snapshot.get("capsule_context") or "No product context provided."
            sys_override = snapshot.get("system_prompt")
            engine = ConversationEngine(
                objective=snapshot.get("mission") or "Qualify prospect and establish fit.",
                lead_context={"business_name": prospect_name, "capsule_context": capsule_text},
                system_prompt_override=sys_override if sys_override and sys_override.strip() else None
            )
            tokens = []
            try:
                async for tok in engine.generate_response_stream():
                    tokens.append(tok)
                opening_text = "".join(tokens).strip() or "Namaste, main Clozflow se bol rahi hoon."
            except Exception:
                opening_text = "Namaste, main Clozflow se bol rahi hoon."

        initial_msg = PearlTestMessage(
            session_id=session.id,
            role="assistant",
            text=opening_text,
            meta={"is_opening": True}
        )
        db.add(initial_msg)

    session.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(session)
    return test_session_to_dict(session)


@router.post("/test-sessions/{session_id}/end")
def end_test_session(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """End a test session."""
    session = db.query(PearlTestSession).filter(
        PearlTestSession.id == session_id,
        PearlTestSession.user_id == user.id
    ).first()
    if not session:
        raise HTTPException(404, "Test session not found")

    session.status = "completed"
    session.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "status": session.status}


# ── Browser Voice Testing WebSocket ──────────────────────────────────────────

@router.websocket("/test-sessions/{session_id}/voice")
async def browser_voice_test_websocket(
    websocket: WebSocket,
    session_id: str,
    db: Session = Depends(get_db)
):
    """
    Dedicated Browser Voice Test WebSocket.
    Streams 16kHz linear PCM between the browser and Pearl's real AI pipeline:
      - Browser Mic PCM16 -> GeminiStream (STT) + Silero VAD
      - Recognized speech -> ConversationEngine (Groq LLM)
      - Agent response -> get_tts_provider() (Sarvam Bulbul / ElevenLabs) -> Browser Audio Playback
      - Supports interruption (barge-in) and clean disconnect
      - Absolutely zero PSTN / telephony interaction
    """
    token = websocket.query_params.get("token")
    user = verify_token_string(token, db) if token else None

    session = db.query(PearlTestSession).filter(
        PearlTestSession.id == session_id,
        PearlTestSession.user_id == user.id
    ).first() if user else None

    if not session:
        print(f"[Browser Voice Test] Unauthorized or invalid session {session_id}")
        await websocket.close(code=1008)
        return

    print(f"[Browser Voice Test] Connecting session {session_id}")
    await websocket.accept()
    if not session:
        print(f"[Browser Voice Test] Session {session_id} not found in DB")
        await websocket.close(code=1008)
        return

    snapshot = session.agent_snapshot or {}
    objective = snapshot.get("mission", "Qualify prospect and discuss needs.")
    capsule_text = snapshot.get("capsule_context", "No product context provided.")
    system_prompt = snapshot.get("system_prompt")
    voice_cfg = snapshot.get("voice_config") or {}
    speaker = voice_cfg.get("speaker", "shubh_enhi_ads")
    language = voice_cfg.get("language", "Auto")
    pace = float(voice_cfg.get("pace", 1.0))

    lead_ctx = {
        "business_name": snapshot.get("test_variables", {}).get("prospect_name") or snapshot.get("test_variables", {}).get("company") or "Prospect",
        "capsule_context": capsule_text
    }

    engine = ConversationEngine(
        objective=objective,
        lead_context=lead_ctx,
        system_prompt_override=system_prompt if system_prompt and system_prompt.strip() else None
    )

    # Initialize TTS provider
    tts = get_tts_provider()
    tts_connected = False
    try:
        await tts.connect()
        lang_code = "hi-IN" if language == "Hindi" or "_hi_" in speaker else "en-IN"
        await tts.configure(language_code=lang_code, speaker=speaker, pace=pace, temperature=0.6)
        tts_connected = True
    except Exception as e:
        print(f"[Browser Voice Test] TTS setup warning: {e}")

    # Interruption & Turn control
    _is_speaking = False
    _first_audio_sent_at = 0.0
    _turn_completed_at = 0.0
    _tts_cancel = asyncio.Event()
    _generation_id = 0

    async def _send_audio_to_browser(audio_bytes: bytes):
        nonlocal _is_speaking, _first_audio_sent_at
        if audio_bytes and len(audio_bytes) > 0 and not _tts_cancel.is_set():
            try:
                if not _is_speaking:
                    _is_speaking = True
                    _first_audio_sent_at = time.time()
                b64 = base64.b64encode(audio_bytes).decode('ascii')
                await websocket.send_json({"type": "audio", "data": b64})
            except Exception:
                pass

    # TTS consumer loop
    async def _tts_consumer_loop():
        nonlocal _is_speaking, _first_audio_sent_at
        try:
            async for chunk in tts.receive_audio():
                if _tts_cancel.is_set():
                    continue
                if chunk == b"__FLUSH_COMPLETE__":
                    _is_speaking = False
                    _first_audio_sent_at = 0.0
                    await websocket.send_json({"type": "tts_finished"})
                elif chunk:
                    await _send_audio_to_browser(chunk)
        except Exception as e:
            print(f"[Browser Voice Test] TTS consumer error: {e}")

    tts_task = asyncio.create_task(_tts_consumer_loop())

    async def on_turn_complete(user_transcript: str):
        nonlocal _is_speaking, _turn_completed_at, _generation_id
        if not user_transcript.strip():
            return

        # If Pearl was speaking when turn finalized, cancel active speech
        if _is_speaking:
            _tts_cancel.set()
            _generation_id += 1
            _is_speaking = False
            _first_audio_sent_at = 0.0
            await tts.cancel()
            await websocket.send_json({"type": "interrupted"})

        _turn_completed_at = time.time()
        print(f"[Browser Voice Test] User turn: {user_transcript}")
        # Notify browser of recognized user transcript
        await websocket.send_json({"type": "transcript", "speaker": "user", "text": user_transcript})

        # Save user message asynchronously off the critical path
        def _save_test_msg_bg(s_id, r, t):
            try:
                from database import SessionLocal
                db = SessionLocal()
                db.add(PearlTestMessage(session_id=s_id, role=r, text=t))
                db.commit()
                db.close()
            except Exception as e:
                print(f"[DB save error] {e}")

        asyncio.create_task(asyncio.to_thread(_save_test_msg_bg, session.id, "user", user_transcript))

        # Add to engine history
        engine.add_turn("prospect", user_transcript)

        # Generate response - NOTE: Pearl is THINKING, NOT speaking yet
        _generation_id += 1
        current_gen = _generation_id
        _tts_cancel.clear()
        await websocket.send_json({"type": "agent_thinking"})

        chunker = PhraseChunker(first_chunk_words=3, subsequent_chunk_words=7)
        full_response = ""

        try:
            async for token in engine.generate_response_stream():
                if _tts_cancel.is_set() or _generation_id != current_gen:
                    await tts.cancel()
                    break
                full_response += token
                for phrase in chunker.feed(token):
                    if _tts_cancel.is_set() or _generation_id != current_gen:
                        break
                    await tts.send_text(phrase)

            if not _tts_cancel.is_set() and _generation_id == current_gen:
                for phrase in chunker.flush():
                    if _tts_cancel.is_set() or _generation_id != current_gen:
                        break
                    await tts.send_text(phrase)

            if not _tts_cancel.is_set() and _generation_id == current_gen:
                await tts.flush()

        except Exception as e:
            print(f"[Browser Voice Test] LLM error: {e}")
            full_response = "I apologize, could you say that again?"
            await tts.send_text(full_response)
            await tts.flush()

        engine.add_turn("agent", full_response)
        await websocket.send_json({"type": "transcript", "speaker": "agent", "text": full_response})

        # Save assistant message asynchronously off critical path
        asyncio.create_task(asyncio.to_thread(_save_test_msg_bg, session.id, "assistant", full_response))

    # VAD & Turn Detector
    vad = SileroVADEngine()
    await vad.initialize()
    turn_detector = TurnDetector(on_turn_complete=on_turn_complete)

    async def transcript_callback(speaker, text, is_final=True, speech_final=False):
        if text:
            turn_detector.on_transcript(text, is_final=is_final)
            if not is_final:
                await websocket.send_json({"type": "partial_transcript", "text": text})
        if speech_final:
            turn_detector.on_speech_final()

    stt = GeminiStream(transcript_callback=transcript_callback)
    stt_connected = await stt.connect()
    if not stt_connected:
        print("[Browser Voice Test] Gemini STT stream connection failed")
        await websocket.send_json({"type": "error", "message": "Failed to connect to transcription service"})

    # Send initial status
    await websocket.send_json({
        "type": "ready",
        "agent_name": snapshot.get("name"),
        "speaker": speaker
    })

    # ── Initial Opening Hook (Dynamic Pattern Interrupt via ConversationEngine) ──
    print(f"[Browser Voice Test] Generating dynamic pattern interrupt opening for {lead_ctx.get('business_name', 'Prospect')}")
    _generation_id += 1
    opening_gen = _generation_id
    _is_speaking = True
    _tts_cancel.clear()
    
    if hasattr(tts, 'reset_buffer'):
        tts.reset_buffer()

    full_opening = ""
    chunker = PhraseChunker(first_chunk_words=3, subsequent_chunk_words=7)

    custom_greeting = snapshot.get("greeting")
    # If user explicitly configured a custom scripted greeting override (and not generic boilerplate)
    if custom_greeting and custom_greeting.strip() and not ("How are you doing today" in custom_greeting and "calling from" in custom_greeting):
        tvars = snapshot.get("test_variables") or {}
        rendered_greeting = custom_greeting
        for k, v in tvars.items():
            rendered_greeting = rendered_greeting.replace(f"{{{{{k}}}}}", str(v))
        full_opening = rendered_greeting
        _first_audio_sent_at = time.time()
        await websocket.send_json({"type": "transcript", "speaker": "agent", "text": full_opening})
        await tts.send_text(full_opening)
        await tts.flush()
        engine.add_turn("agent", full_opening)
    else:
        # True dynamic pattern interrupt opening generated by LLM from ConversationEngine system prompt
        await websocket.send_json({"type": "agent_thinking"})
        try:
            async for token in engine.generate_response_stream():
                if _tts_cancel.is_set() or _generation_id != opening_gen:
                    await tts.cancel()
                    break

                if not full_opening:
                    _first_audio_sent_at = time.time()

                full_opening += token
                for phrase in chunker.feed(token):
                    if _tts_cancel.is_set() or _generation_id != opening_gen:
                        break
                    await tts.send_text(phrase)

            if not _tts_cancel.is_set() and _generation_id == opening_gen:
                for phrase in chunker.flush():
                    if _tts_cancel.is_set() or _generation_id != opening_gen:
                        break
                    await tts.send_text(phrase)

                if not _tts_cancel.is_set() and _generation_id == opening_gen:
                    await tts.flush()

        except Exception as e:
            print(f"[Browser Voice Test] Dynamic opening LLM error: {e}")
            full_opening = "Haan namaste, main Clozflow se bol rahi hoon. Kya aapke paas 2 minute honge?"
            await tts.send_text(full_opening)
            await tts.flush()

        if full_opening.strip():
            engine.add_turn("agent", full_opening.strip())
            await websocket.send_json({"type": "transcript", "speaker": "agent", "text": full_opening.strip()})
            def _save_initial_msg(s_id, text):
                try:
                    from database import SessionLocal
                    db_s = SessionLocal()
                    db_s.add(PearlTestMessage(session_id=s_id, role="assistant", text=text, meta={"is_opening": True}))
                    db_s.commit()
                    db_s.close()
                except Exception:
                    pass
            asyncio.create_task(asyncio.to_thread(_save_initial_msg, session.id, full_opening.strip()))

    # ── Audio Ingestion Loop ──
    try:
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break

            if "bytes" in msg:
                pcm_data = msg["bytes"]
                if not pcm_data:
                    continue

                # Feed to STT
                await stt.send_audio(pcm_data)

                # Feed to VAD for speech activity and interruption
                events = vad.process_chunk(pcm_data)
                now = time.time()
                for ev in events:
                    if ev == VADEvent.SPEECH_START:
                        # Barge-in: only allowed if Pearl has been actively emitting speech for > 0.25s
                        if _is_speaking and _first_audio_sent_at > 0 and (now - _first_audio_sent_at > 0.25):
                            print("[Browser Voice Test] Interruption detected -> cancelling TTS")
                            _tts_cancel.set()
                            _generation_id += 1
                            _is_speaking = False
                            _first_audio_sent_at = 0.0
                            await tts.cancel()
                            await websocket.send_json({"type": "interrupted"})
                            turn_detector.on_speech_start()
                        elif not _is_speaking:
                            turn_detector.on_speech_start()
                    elif ev == VADEvent.SPEECH_END:
                        if not _is_speaking:
                            turn_detector.on_speech_end()

            elif "text" in msg:
                data = json.loads(msg["text"])
                if data.get("type") == "stop":
                    break

    except WebSocketDisconnect:
        print("[Browser Voice Test] Client disconnected")
    except Exception as e:
        print(f"[Browser Voice Test] WebSocket error: {e}")
    finally:
        # Graceful cleanup
        tts_task.cancel()
        try:
            await stt.close()
            await tts.close()
        except Exception:
            pass
        print(f"[Browser Voice Test] Session {session_id} cleaned up safely")


# ═══════════════════════════════════════════════════════════════════════════════
# OUTBOUND CAMPAIGNS & RECIPIENTS MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════

class CreateCampaignRequest(BaseModel):
    name: str
    agent_id: Optional[str] = None
    objective: Optional[str] = None
    description: Optional[str] = None
    source_type: str = "lead_finder"
    call_settings: Optional[dict] = None
    schedule_time: Optional[datetime] = None


class UpdateCampaignRequest(BaseModel):
    name: Optional[str] = None
    agent_id: Optional[str] = None
    objective: Optional[str] = None
    description: Optional[str] = None
    call_settings: Optional[dict] = None
    schedule_time: Optional[datetime] = None
    status: Optional[str] = None


class ImportFromFinderRequest(BaseModel):
    leads: List[dict]


class ManualRecipientRequest(BaseModel):
    name: Optional[str] = None
    business_name: Optional[str] = None
    phone_number: str
    company: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None


def campaign_to_dict(c: PearlCampaign, include_recipients: bool = False) -> dict:
    result = {
        "id": c.id,
        "user_id": c.user_id,
        "agent_id": c.agent_id,
        "agent_name": c.agent.name if c.agent else None,
        "name": c.name,
        "objective": c.objective,
        "description": c.description,
        "status": c.status,
        "source_type": c.source_type,
        "call_settings": c.call_settings or {
            "calling_hours": "09:00 - 18:00",
            "timezone": "Asia/Kolkata (IST)",
            "max_attempts": 2,
            "retry_interval": 30,
            "concurrency_limit": 1
        },
        "schedule_time": c.schedule_time.isoformat() if c.schedule_time else None,
        "metrics": {
            "total_recipients": c.total_recipients,
            "eligible_recipients": c.eligible_recipients,
            "completed_calls": c.completed_calls,
            "failed_calls": c.failed_calls,
            "qualified_calls": c.qualified_calls,
        },
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
        "started_at": c.started_at.isoformat() if c.started_at else None,
        "completed_at": c.completed_at.isoformat() if c.completed_at else None,
    }
    if include_recipients:
        result["recipients"] = [recipient_to_dict(r) for r in (c.recipients or [])]
    return result


def recipient_to_dict(r: PearlCampaignRecipient) -> dict:
    return {
        "id": r.id,
        "campaign_id": r.campaign_id,
        "lead_id": r.lead_id,
        "name": r.name,
        "business_name": r.business_name,
        "phone_number": r.phone_number,
        "normalized_phone": r.normalized_phone,
        "email": r.email,
        "website": r.website,
        "company": r.company,
        "source": r.source,
        "status": r.status,
        "validation_error": r.validation_error,
        "call_id": r.call_id,
        "attempts": r.attempts,
        "duration_seconds": r.duration_seconds,
        "outcome": r.outcome,
        "error_reason": r.error_reason,
        "transcript": r.transcript,
        "summary": r.summary,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


@router.post("/campaigns")
def create_campaign(
    req: CreateCampaignRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Create a new campaign draft."""
    if req.agent_id:
        agent = db.query(PearlAgent).filter(
            PearlAgent.id == req.agent_id,
            PearlAgent.user_id == user.id
        ).first()
        if not agent:
            raise HTTPException(404, "Agent not found")

    campaign = PearlCampaign(
        user_id=user.id,
        agent_id=req.agent_id,
        name=req.name,
        objective=req.objective,
        description=req.description,
        source_type=req.source_type,
        status="draft",
        call_settings=req.call_settings or {
            "calling_hours": "09:00 - 18:00",
            "timezone": "Asia/Kolkata (IST)",
            "max_attempts": 2,
            "retry_interval": 30,
            "concurrency_limit": 1
        },
        schedule_time=req.schedule_time
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return campaign_to_dict(campaign)


@router.get("/campaigns")
def list_campaigns(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """List all campaigns for current user."""
    campaigns = db.query(PearlCampaign).filter(
        PearlCampaign.user_id == user.id
    ).order_by(PearlCampaign.created_at.desc()).all()
    return [campaign_to_dict(c) for c in campaigns]


@router.get("/campaigns/{campaign_id}")
def get_campaign(
    campaign_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Get single campaign details and recipients."""
    campaign = db.query(PearlCampaign).filter(
        PearlCampaign.id == campaign_id,
        PearlCampaign.user_id == user.id
    ).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    return campaign_to_dict(campaign, include_recipients=True)


@router.patch("/campaigns/{campaign_id}")
def update_campaign(
    campaign_id: str,
    req: UpdateCampaignRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Update campaign draft settings."""
    campaign = db.query(PearlCampaign).filter(
        PearlCampaign.id == campaign_id,
        PearlCampaign.user_id == user.id
    ).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    if campaign.status == "running" and req.status not in ("paused", None):
        raise HTTPException(400, "Cannot edit configuration of an actively running campaign")

    update_fields = req.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        setattr(campaign, field, value)

    campaign.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(campaign)
    return campaign_to_dict(campaign)


@router.delete("/campaigns/{campaign_id}")
def delete_campaign(
    campaign_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Delete a draft or completed campaign."""
    campaign = db.query(PearlCampaign).filter(
        PearlCampaign.id == campaign_id,
        PearlCampaign.user_id == user.id
    ).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    if campaign.status == "running":
        raise HTTPException(400, "Cannot delete an actively running campaign")

    db.delete(campaign)
    db.commit()
    return {"ok": True, "message": f"Campaign '{campaign.name}' deleted"}


# ── Recipient Ingestion Endpoints ─────────────────────────────────────────────

@router.post("/campaigns/{campaign_id}/import-leads")
async def import_campaign_leads_file(
    campaign_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """
    Import and validate leads from a CSV or Excel (.xlsx) file.
    Applies shared lead ingestion: E.164 normalization, deduplication, and column mapping.
    """
    campaign = db.query(PearlCampaign).filter(
        PearlCampaign.id == campaign_id,
        PearlCampaign.user_id == user.id
    ).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    content = await file.read()
    if not content:
        raise HTTPException(400, "Uploaded file is empty")

    filename = file.filename.lower()
    raw_rows: List[dict] = []

    if filename.endswith(".csv"):
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = content.decode("latin-1", errors="replace")
        raw_rows = parse_csv_file(text)
    elif filename.endswith(".xlsx"):
        try:
            raw_rows = parse_xlsx_sheets(content)
        except Exception as e:
            raise HTTPException(400, f"Failed to parse Excel workbook: {str(e)}")
    else:
        raise HTTPException(400, "Unsupported file format. Please upload a .csv or .xlsx file")

    if not raw_rows:
        raise HTTPException(400, "No valid data rows found in uploaded file")

    # Fetch existing phone numbers in this campaign to detect duplicates
    existing_recipients = db.query(PearlCampaignRecipient.normalized_phone).filter(
        PearlCampaignRecipient.campaign_id == campaign_id
    ).all()
    existing_phones = {r[0] for r in existing_recipients if r[0]}

    processed, stats = process_lead_batch(raw_rows, source="csv_upload", existing_phone_set=existing_phones)

    # Persist recipients to DB
    new_recipients = []
    for item in processed:
        rec = PearlCampaignRecipient(
            campaign_id=campaign.id,
            name=item.get("name"),
            business_name=item.get("business_name"),
            company=item.get("company"),
            phone_number=item.get("phone_number") or "",
            normalized_phone=item.get("normalized_phone") or "",
            email=item.get("email"),
            website=item.get("website"),
            source="csv_upload",
            status=item.get("status", "valid"),
            validation_error=item.get("validation_error")
        )
        db.add(rec)
        new_recipients.append(rec)

    db.commit()

    # Recalculate campaign totals
    total = db.query(PearlCampaignRecipient).filter(PearlCampaignRecipient.campaign_id == campaign_id).count()
    eligible = db.query(PearlCampaignRecipient).filter(
        PearlCampaignRecipient.campaign_id == campaign_id,
        PearlCampaignRecipient.status == "valid"
    ).count()

    campaign.total_recipients = total
    campaign.eligible_recipients = eligible
    campaign.source_type = "csv_upload"
    db.commit()

    return {
        "ok": True,
        "stats": stats,
        "imported_count": len(new_recipients),
        "total_campaign_recipients": total,
        "eligible_count": eligible,
        "recipients": [recipient_to_dict(r) for r in new_recipients[:100]]
    }


@router.post("/campaigns/{campaign_id}/import-from-finder")
def import_campaign_leads_from_finder(
    campaign_id: str,
    req: ImportFromFinderRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """
    Import leads directly selected from Clozflow Lead Finder into a campaign.
    Normalizes phone numbers and deduplicates seamlessly.
    """
    campaign = db.query(PearlCampaign).filter(
        PearlCampaign.id == campaign_id,
        PearlCampaign.user_id == user.id
    ).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    if not req.leads:
        raise HTTPException(400, "No leads provided in selection")

    existing_recipients = db.query(PearlCampaignRecipient.normalized_phone).filter(
        PearlCampaignRecipient.campaign_id == campaign_id
    ).all()
    existing_phones = {r[0] for r in existing_recipients if r[0]}

    processed, stats = process_lead_batch(req.leads, source="lead_finder", existing_phone_set=existing_phones)

    new_recipients = []
    for item in processed:
        rec = PearlCampaignRecipient(
            campaign_id=campaign.id,
            name=item.get("name"),
            business_name=item.get("business_name"),
            company=item.get("company"),
            phone_number=item.get("phone_number") or "",
            normalized_phone=item.get("normalized_phone") or "",
            email=item.get("email"),
            website=item.get("website"),
            source="lead_finder",
            status=item.get("status", "valid"),
            validation_error=item.get("validation_error")
        )
        db.add(rec)
        new_recipients.append(rec)

    db.commit()

    total = db.query(PearlCampaignRecipient).filter(PearlCampaignRecipient.campaign_id == campaign_id).count()
    eligible = db.query(PearlCampaignRecipient).filter(
        PearlCampaignRecipient.campaign_id == campaign_id,
        PearlCampaignRecipient.status == "valid"
    ).count()

    campaign.total_recipients = total
    campaign.eligible_recipients = eligible
    campaign.source_type = "lead_finder"
    db.commit()

    return {
        "ok": True,
        "stats": stats,
        "imported_count": len(new_recipients),
        "total_campaign_recipients": total,
        "eligible_count": eligible,
        "recipients": [recipient_to_dict(r) for r in new_recipients]
    }


@router.post("/campaigns/{campaign_id}/add-manual-recipient")
def add_manual_recipient(
    campaign_id: str,
    req: ManualRecipientRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Add a single manual recipient to the campaign."""
    campaign = db.query(PearlCampaign).filter(
        PearlCampaign.id == campaign_id,
        PearlCampaign.user_id == user.id
    ).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    is_valid, norm_phone, err = validate_and_normalize_phone(req.phone_number)

    display_name = req.name or req.business_name or "Direct Contact"
    display_biz = req.business_name or req.company or req.name or "Direct Business"

    rec = PearlCampaignRecipient(
        campaign_id=campaign.id,
        name=display_name,
        business_name=display_biz,
        company=display_biz,
        phone_number=req.phone_number,
        normalized_phone=norm_phone if is_valid else "",
        email=req.email,
        website=req.website,
        source="manual",
        status="valid" if is_valid else "invalid",
        validation_error=err
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)

    total = db.query(PearlCampaignRecipient).filter(PearlCampaignRecipient.campaign_id == campaign_id).count()
    eligible = db.query(PearlCampaignRecipient).filter(
        PearlCampaignRecipient.campaign_id == campaign_id,
        PearlCampaignRecipient.status == "valid"
    ).count()

    campaign.total_recipients = total
    campaign.eligible_recipients = eligible
    db.commit()

    return {
        "ok": True,
        "recipient": recipient_to_dict(rec),
        "total_campaign_recipients": total,
        "eligible_count": eligible
    }


@router.get("/campaigns/{campaign_id}/recipients")
def get_campaign_recipients(
    campaign_id: str,
    limit: int = 200,
    offset: int = 0,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """List recipients for review with pagination."""
    campaign = db.query(PearlCampaign).filter(
        PearlCampaign.id == campaign_id,
        PearlCampaign.user_id == user.id
    ).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    recipients = db.query(PearlCampaignRecipient).filter(
        PearlCampaignRecipient.campaign_id == campaign_id
    ).order_by(PearlCampaignRecipient.created_at.asc()).offset(offset).limit(limit).all()

    total = db.query(PearlCampaignRecipient).filter(PearlCampaignRecipient.campaign_id == campaign_id).count()

    return {
        "recipients": [recipient_to_dict(r) for r in recipients],
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.patch("/campaigns/{campaign_id}/recipients/{recipient_id}")
def toggle_campaign_recipient(
    campaign_id: str,
    recipient_id: str,
    status: str,  # "valid" | "excluded"
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Toggle a recipient between valid and excluded in review table."""
    campaign = db.query(PearlCampaign).filter(
        PearlCampaign.id == campaign_id,
        PearlCampaign.user_id == user.id
    ).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    recipient = db.query(PearlCampaignRecipient).filter(
        PearlCampaignRecipient.id == recipient_id,
        PearlCampaignRecipient.campaign_id == campaign_id
    ).first()
    if not recipient:
        raise HTTPException(404, "Recipient not found")

    if status not in ("valid", "excluded"):
        raise HTTPException(400, "Status must be 'valid' or 'excluded'")

    # Don't allow marking invalid number as valid if it fails E.164
    if status == "valid" and not recipient.normalized_phone:
        raise HTTPException(400, "Cannot enable a recipient with an invalid phone number")

    recipient.status = status
    db.commit()

    eligible = db.query(PearlCampaignRecipient).filter(
        PearlCampaignRecipient.campaign_id == campaign_id,
        PearlCampaignRecipient.status == "valid"
    ).count()

    campaign.eligible_recipients = eligible
    db.commit()

    return {
        "ok": True,
        "recipient": recipient_to_dict(recipient),
        "eligible_count": eligible
    }


@router.delete("/campaigns/{campaign_id}/recipients/{recipient_id}")
def delete_campaign_recipient(
    campaign_id: str,
    recipient_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Remove a recipient from the campaign review list."""
    campaign = db.query(PearlCampaign).filter(
        PearlCampaign.id == campaign_id,
        PearlCampaign.user_id == user.id
    ).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    recipient = db.query(PearlCampaignRecipient).filter(
        PearlCampaignRecipient.id == recipient_id,
        PearlCampaignRecipient.campaign_id == campaign_id
    ).first()
    if not recipient:
        raise HTTPException(404, "Recipient not found")

    db.delete(recipient)
    db.commit()

    total = db.query(PearlCampaignRecipient).filter(PearlCampaignRecipient.campaign_id == campaign_id).count()
    eligible = db.query(PearlCampaignRecipient).filter(
        PearlCampaignRecipient.campaign_id == campaign_id,
        PearlCampaignRecipient.status == "valid"
    ).count()

    campaign.total_recipients = total
    campaign.eligible_recipients = eligible
    db.commit()

    return {"ok": True, "total_recipients": total, "eligible_count": eligible}


# ── Campaign Launch & Telephony Dispatch ──────────────────────────────────────

async def _dispatch_campaign_worker(campaign_id: str):
    """
    Background worker that executes outbound calls for eligible recipients in a campaign.
    Reuses the existing ExotelTelephonyProvider and PearlCall models.
    """
    from database import SessionLocal
    from services.pearl.providers.exotel_provider import ExotelTelephonyProvider
    import os

    provider = ExotelTelephonyProvider()
    caller_id = os.getenv("EXOTEL_CALLER_ID", "0000000000")

    s = SessionLocal()
    try:
        campaign = s.query(PearlCampaign).filter(PearlCampaign.id == campaign_id).first()
        if not campaign or campaign.status != "running":
            return

        recipients = s.query(PearlCampaignRecipient).filter(
            PearlCampaignRecipient.campaign_id == campaign_id,
            PearlCampaignRecipient.status == "valid"
        ).order_by(PearlCampaignRecipient.created_at.asc()).all()

        for rec in recipients:
            # Check if campaign was paused or cancelled mid-execution
            s.refresh(campaign)
            if campaign.status in ("paused", "completed", "failed"):
                break

            rec.status = "calling"
            rec.attempts += 1
            s.commit()

            # Create PearlCall record
            call = PearlCall(
                agent_id=campaign.agent_id,
                lead_id=rec.lead_id,
                provider="exotel",
                status="queued"
            )
            s.add(call)
            s.commit()
            s.refresh(call)

            rec.call_id = call.id

            # Create PearlConversation record
            conv = PearlConversation(
                call_id=call.id,
                lead_id=rec.lead_id,
                objective=campaign.objective or "Qualify and schedule next steps",
                status="active"
            )
            s.add(conv)
            s.commit()

            # Execute real outbound call via Exotel
            try:
                res = await provider.create_outbound_call(
                    to_number=rec.normalized_phone,
                    from_number=caller_id,
                    custom_field=call.id
                )
                if res.get("success"):
                    call.provider_call_id = res.get("provider_call_id")
                    call.status = "dialing"
                    rec.status = "calling"
                    campaign.completed_calls += 1
                else:
                    call.status = "failed"
                    call.error_code = res.get("error", "Exotel Call Request Failed")
                    rec.status = "failed"
                    rec.error_reason = call.error_code
                    campaign.failed_calls += 1

            except Exception as e:
                print(f"[Campaign Dispatch Worker] Error calling {rec.normalized_phone}: {e}")
                call.status = "failed"
                call.error_code = str(e)
                rec.status = "failed"
                rec.error_reason = str(e)
                campaign.failed_calls += 1

            s.commit()

            # Pacing interval between dispatches (respecting concurrency limits)
            pacing = float(campaign.call_settings.get("retry_interval", 2.0)) if campaign.call_settings else 2.0
            await asyncio.sleep(min(pacing, 5.0))

        # Check if all completed
        remaining = s.query(PearlCampaignRecipient).filter(
            PearlCampaignRecipient.campaign_id == campaign_id,
            PearlCampaignRecipient.status == "valid"
        ).count()

        if remaining == 0:
            campaign.status = "completed"
            campaign.completed_at = datetime.utcnow()
            s.commit()

    except Exception as e:
        print(f"[Campaign Dispatch Error] {e}")
        try:
            campaign.status = "failed"
            s.commit()
        except Exception:
            pass
    finally:
        s.close()


@router.post("/campaigns/{campaign_id}/launch")
async def launch_campaign(
    campaign_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """
    Explicitly launch an outbound campaign.
    Validates agent, eligible recipients (>0), and provider readiness.
    Prevents double submissions and executes calls through existing Exotel integration.
    """
    campaign = db.query(PearlCampaign).filter(
        PearlCampaign.id == campaign_id,
        PearlCampaign.user_id == user.id
    ).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    if campaign.status in ("running", "completed"):
        raise HTTPException(400, f"Campaign is already in '{campaign.status}' state")

    if not campaign.agent_id:
        raise HTTPException(400, "Please select an Agent for this campaign before launching")

    agent = db.query(PearlAgent).filter(PearlAgent.id == campaign.agent_id).first()
    if not agent:
        raise HTTPException(400, "Selected Agent does not exist")

    # Count eligible recipients
    eligible_count = db.query(PearlCampaignRecipient).filter(
        PearlCampaignRecipient.campaign_id == campaign_id,
        PearlCampaignRecipient.status == "valid"
    ).count()

    if eligible_count == 0:
        raise HTTPException(400, "Cannot launch campaign: no eligible recipients found. Please import or enable at least one valid recipient.")

    # Validate Exotel telephony readiness
    import os
    exotel_sid = os.getenv("EXOTEL_ACCOUNT_SID")
    exotel_key = os.getenv("EXOTEL_API_KEY")
    exotel_token = os.getenv("EXOTEL_API_TOKEN")

    if not all([exotel_sid, exotel_key, exotel_token]):
        raise HTTPException(
            400,
            "Telephony gateway unready: Exotel API credentials (EXOTEL_ACCOUNT_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN) are missing from server configuration."
        )

    # Transition campaign to running
    campaign.status = "running"
    campaign.started_at = datetime.utcnow()
    campaign.eligible_recipients = eligible_count
    db.commit()
    db.refresh(campaign)

    # Dispatch via background task worker
    background_tasks.add_task(_dispatch_campaign_worker, campaign.id)

    return {
        "ok": True,
        "message": f"Campaign '{campaign.name}' launched successfully with {eligible_count} recipients.",
        "campaign": campaign_to_dict(campaign)
    }


@router.post("/campaigns/{campaign_id}/pause")
def pause_campaign(
    campaign_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Pause an actively running campaign."""
    campaign = db.query(PearlCampaign).filter(
        PearlCampaign.id == campaign_id,
        PearlCampaign.user_id == user.id
    ).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    if campaign.status != "running":
        raise HTTPException(400, "Only running campaigns can be paused")

    campaign.status = "paused"
    db.commit()
    return {"ok": True, "status": "paused"}


@router.post("/campaigns/{campaign_id}/resume")
async def resume_campaign(
    campaign_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Resume a paused campaign."""
    campaign = db.query(PearlCampaign).filter(
        PearlCampaign.id == campaign_id,
        PearlCampaign.user_id == user.id
    ).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    if campaign.status != "paused":
        raise HTTPException(400, "Only paused campaigns can be resumed")

    campaign.status = "running"
    db.commit()

    background_tasks.add_task(_dispatch_campaign_worker, campaign.id)
    return {"ok": True, "status": "running"}


@router.get("/campaigns/{campaign_id}/status")
def get_campaign_status(
    campaign_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Retrieve real-time campaign status and live metrics."""
    campaign = db.query(PearlCampaign).filter(
        PearlCampaign.id == campaign_id,
        PearlCampaign.user_id == user.id
    ).first()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    total = db.query(PearlCampaignRecipient).filter(PearlCampaignRecipient.campaign_id == campaign_id).count()
    completed = db.query(PearlCampaignRecipient).filter(
        PearlCampaignRecipient.campaign_id == campaign_id,
        PearlCampaignRecipient.status == "completed"
    ).count()
    calling = db.query(PearlCampaignRecipient).filter(
        PearlCampaignRecipient.campaign_id == campaign_id,
        PearlCampaignRecipient.status == "calling"
    ).count()
    failed = db.query(PearlCampaignRecipient).filter(
        PearlCampaignRecipient.campaign_id == campaign_id,
        PearlCampaignRecipient.status == "failed"
    ).count()

    return {
        "status": campaign.status,
        "total_recipients": total,
        "eligible_recipients": campaign.eligible_recipients,
        "completed": completed,
        "calling": calling,
        "failed": failed,
        "started_at": campaign.started_at.isoformat() if campaign.started_at else None,
        "completed_at": campaign.completed_at.isoformat() if campaign.completed_at else None
    }
