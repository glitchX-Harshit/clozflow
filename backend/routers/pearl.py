"""
Pearl AI Mission Router
───────────────────────
POST /pearl/missions              — Create & start a new mission
GET  /pearl/missions              — List all missions for current user
GET  /pearl/missions/{id}         — Get mission details + activities
POST /pearl/missions/{id}/pause   — Pause a running mission
POST /pearl/missions/{id}/resume  — Resume a paused mission
"""

import asyncio
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, List
from sqlalchemy.orm import Session
from database import get_db
from models import Mission, MissionActivity, User
from routers.auth import get_current_user
from datetime import datetime

router = APIRouter(prefix="/pearl", tags=["pearl"])


# ── Schemas ──────────────────────────────────────────────────────────

class MissionCreateRequest(BaseModel):
    mission_input: str
    industry: Optional[str] = None
    location: Optional[str] = None
    quantity: Optional[int] = None
    filters: Optional[str] = None
    outreach_channel: str = "WhatsApp + Email"
    daily_limit: int = 50
    working_hours: str = "9:00 AM - 6:00 PM"
    approval_mode: str = "Auto-approve qualified leads"
    safety_rules: str = "No follow-up after rejection"

class ApproveMessageRequest(BaseModel):
    mission_id: int
    lead_id: int
    approved_message: str
    action: str  # "approve" or "skip"



class MissionResponse(BaseModel):
    id: int
    status: str
    mission_input: str
    industry: Optional[str]
    location: Optional[str]
    quantity: Optional[int]
    filters: Optional[str]
    outreach_channel: str
    daily_limit: int
    working_hours: str
    approval_mode: str
    safety_rules: str
    current_stage: str
    current_stage_index: int
    stage_progress: int
    leads_found: int
    leads_qualified: int
    messages_sent: int
    replies_received: int
    meetings_booked: int
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]

    class Config:
        from_attributes = True


class ActivityResponse(BaseModel):
    id: int
    text: str
    activity_type: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── WebSocket event emitter (uses global connected clients dict) ─────

_mission_clients = {}  # mission_id -> list of WebSocket connections

async def _emit_event(event_name: str, data: dict):
    """Broadcast event to all WebSocket clients watching this mission."""
    mission_id = data.get('mission_id')
    if mission_id and mission_id in _mission_clients:
        import json
        message = json.dumps({'event': event_name, **data})
        dead = []
        for ws in _mission_clients[mission_id]:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            _mission_clients[mission_id].remove(ws)


# ── Run mission in background ────────────────────────────────────────

async def _run_mission_background(mission_id: int):
    """Background task that runs the Pearl orchestrator."""
    from database import SessionLocal
    from services.pearl_orchestrator import PearlOrchestrator
    
    db = SessionLocal()
    try:
        orchestrator = PearlOrchestrator(db=db, emit_event=_emit_event)
        await orchestrator.execute_mission(mission_id)
    finally:
        db.close()


# ── Routes ───────────────────────────────────────────────────────────

@router.post("/missions", response_model=MissionResponse)
async def create_mission(
    request: MissionCreateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new mission and start execution in background."""
    mission = Mission(
        user_id=current_user.id,
        mission_input=request.mission_input,
        industry=request.industry,
        location=request.location,
        quantity=request.quantity,
        filters=request.filters,
        outreach_channel=request.outreach_channel,
        daily_limit=request.daily_limit,
        working_hours=request.working_hours,
        approval_mode=request.approval_mode,
        safety_rules=request.safety_rules,
        status='pending'
    )
    db.add(mission)
    db.commit()
    db.refresh(mission)
    
    # Start mission execution in background
    background_tasks.add_task(_run_mission_background, mission.id)
    
    return mission


@router.get("/missions", response_model=List[MissionResponse])
async def list_missions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all missions for the current user."""
    missions = db.query(Mission).filter(
        Mission.user_id == current_user.id
    ).order_by(Mission.created_at.desc()).all()
    return missions


@router.get("/missions/{mission_id}", response_model=MissionResponse)
async def get_mission(
    mission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get mission details."""
    mission = db.query(Mission).filter(
        Mission.id == mission_id,
        Mission.user_id == current_user.id
    ).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")
    return mission


@router.get("/missions/{mission_id}/activities", response_model=List[ActivityResponse])
async def get_mission_activities(
    mission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get activity log for a mission."""
    mission = db.query(Mission).filter(
        Mission.id == mission_id,
        Mission.user_id == current_user.id
    ).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")
    
    activities = db.query(MissionActivity).filter(
        MissionActivity.mission_id == mission_id
    ).order_by(MissionActivity.created_at.desc()).all()
    return activities


@router.post("/missions/{mission_id}/pause")
async def pause_mission(
    mission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Pause a running mission."""
    mission = db.query(Mission).filter(
        Mission.id == mission_id,
        Mission.user_id == current_user.id
    ).first()
    if not mission:
        raise HTTPException(status_code=404, detail="Mission not found")
    if mission.status != 'running':
        raise HTTPException(status_code=400, detail="Mission is not running")
    
    mission.status = 'paused'
    db.commit()
    return {"status": "paused"}


@router.post("/missions/approve-message")
async def approve_mission_message(
    request: ApproveMessageRequest,
    current_user: User = Depends(get_current_user)
):
    """Approve or skip a message during a manual review."""
    from services.pearl_orchestrator import pending_approvals
    key = f"{request.mission_id}_{request.lead_id}"
    
    if key in pending_approvals:
        future = pending_approvals[key]
        if not future.done():
            if request.action == "skip":
                future.set_result(None)
            else:
                future.set_result(request.approved_message)
            return {"success": True}
    return {"success": False, "error": "No pending approval found for this message."}



# ── WebSocket endpoint for mission live updates ──────────────────────

from fastapi import WebSocket, WebSocketDisconnect

@router.websocket("/missions/{mission_id}/ws")
async def mission_websocket(websocket: WebSocket, mission_id: int):
    """WebSocket endpoint for live mission updates."""
    await websocket.accept()
    
    if mission_id not in _mission_clients:
        _mission_clients[mission_id] = []
    _mission_clients[mission_id].append(websocket)
    
    try:
        while True:
            # Keep connection alive, listen for client messages
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        if mission_id in _mission_clients:
            _mission_clients[mission_id] = [
                ws for ws in _mission_clients[mission_id] if ws != websocket
            ]
