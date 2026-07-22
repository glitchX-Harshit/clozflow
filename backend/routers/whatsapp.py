"""
WhatsApp Integration Router
───────────────────────────
GET  /whatsapp/qr          — Get QR code for WhatsApp connection
GET  /whatsapp/status       — Check connection status
POST /whatsapp/send         — Send a single message
POST /whatsapp/disconnect   — Disconnect session
POST /whatsapp/webhook      — Receive incoming messages (from Node bridge)
GET  /whatsapp/messages      — Get message history
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from sqlalchemy.orm import Session
from database import get_db
from models import WhatsAppSession, WhatsAppMessage, Mission, Lead, CopilotSession, User
from routers.auth import get_current_user
from datetime import datetime
import logging

logger = logging.getLogger("whatsapp_router")

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])


# ── Schemas ──────────────────────────────────────────────────────────

class SendMessageRequest(BaseModel):
    phone: str
    message: str

class WebhookPayload(BaseModel):
    from_phone: str  # use from_phone instead of 'from' since 'from' is reserved
    message: str
    timestamp: Optional[str] = None
    message_id: Optional[str] = None
    push_name: Optional[str] = None

    class Config:
        # Allow 'from' as an alias
        populate_by_name = True

class MessageResponse(BaseModel):
    id: int
    direction: str
    phone_number: str
    message_text: str
    status: str
    push_name: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Routes ───────────────────────────────────────────────────────────

@router.get("/qr")
async def get_qr(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get QR code for WhatsApp Web connection."""
    from services.whatsapp_bridge import get_qr as bridge_get_qr
    
    result = await bridge_get_qr()
    
    # Update session record
    session = db.query(WhatsAppSession).filter(
        WhatsAppSession.user_id == current_user.id
    ).first()
    
    if not session:
        session = WhatsAppSession(
            user_id=current_user.id,
            status="connecting"
        )
        db.add(session)
        db.commit()
    elif result.get('status') == 'connected':
        session.status = 'connected'
        session.connected_at = datetime.utcnow()
        db.commit()
    
    return result


@router.get("/status")
async def get_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Check WhatsApp connection status."""
    from services.whatsapp_bridge import get_status as bridge_get_status
    
    result = await bridge_get_status()
    
    # Sync status to DB
    session = db.query(WhatsAppSession).filter(
        WhatsAppSession.user_id == current_user.id
    ).first()
    
    if session:
        new_status = result.get('status', 'disconnected')
        if new_status in ['connected', 'disconnected', 'connecting']:
            session.status = new_status
            if new_status == 'connected':
                session.phone_number = result.get('phone')
                session.connected_at = session.connected_at or datetime.utcnow()
            db.commit()
    
    return result


@router.post("/send")
async def send_message(
    request: SendMessageRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Send a WhatsApp message."""
    from services.whatsapp_bridge import send_message as bridge_send
    
    result = await bridge_send(request.phone, request.message)
    
    # Log message to DB
    wa_msg = WhatsAppMessage(
        user_id=current_user.id,
        direction='outbound',
        phone_number=request.phone,
        message_text=request.message,
        wa_message_id=result.get('messageId'),
        status='sent' if result.get('success') else 'failed'
    )
    db.add(wa_msg)
    db.commit()
    
    return result


@router.post("/disconnect")
async def disconnect_session(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Disconnect WhatsApp session."""
    from services.whatsapp_bridge import disconnect as bridge_disconnect
    
    result = await bridge_disconnect()
    
    session = db.query(WhatsAppSession).filter(
        WhatsAppSession.user_id == current_user.id
    ).first()
    if session:
        session.status = 'disconnected'
        session.phone_number = None
        db.commit()
    
    return result


@router.post("/webhook")
async def receive_webhook(
    payload: WebhookPayload,
    db: Session = Depends(get_db)
):
    """Receive incoming WhatsApp messages from the Node bridge.
    
    This endpoint is called by the Node.js bridge whenever a message
    is received on the connected WhatsApp account.
    No auth required — called internally by the bridge.
    """
    phone = payload.from_phone.replace('+', '').replace(' ', '').replace('-', '')
    
    # Find which user owns the WhatsApp session
    session = db.query(WhatsAppSession).filter(
        WhatsAppSession.status == 'connected'
    ).first()
    
    if not session:
        return {"status": "no_active_session"}
    
    user_id = session.user_id
    
    # Find if this phone matches any lead
    lead = None
    leads = db.query(Lead).filter(Lead.phone_number.isnot(None)).all()
    for l in leads:
        clean_phone = l.phone_number.replace('+', '').replace(' ', '').replace('-', '')
        if phone in clean_phone or clean_phone in phone:
            lead = l
            break
    
    # Log incoming message
    wa_msg = WhatsAppMessage(
        user_id=user_id,
        lead_id=lead.id if lead else None,
        direction='inbound',
        phone_number=phone,
        message_text=payload.message,
        wa_message_id=payload.message_id,
        push_name=payload.push_name,
        status='received'
    )
    db.add(wa_msg)
    
    # Find active mission for this lead and update reply count
    if lead:
        # Find the most recent mission from this user that's running or completed
        mission = db.query(Mission).filter(
            Mission.user_id == user_id,
            Mission.status.in_(['running', 'completed'])
        ).order_by(Mission.created_at.desc()).first()
        
        if mission:
            wa_msg.mission_id = mission.id
            mission.replies_received = (mission.replies_received or 0) + 1
            
            # Log activity
            from models import MissionActivity
            activity = MissionActivity(
                mission_id=mission.id,
                text=f'📱 Reply from {payload.push_name or phone}: "{payload.message[:80]}..."' if len(payload.message) > 80 else f'📱 Reply from {payload.push_name or phone}: "{payload.message}"',
                activity_type='accent'
            )
            db.add(activity)
        
        # Update or create CopilotSession
        copilot = db.query(CopilotSession).filter(
            CopilotSession.lead_id == lead.id,
            CopilotSession.user_id == user_id,
            CopilotSession.platform == 'whatsapp'
        ).first()
        
        if copilot:
            copilot.last_reply = payload.message
            copilot.updated_at = datetime.utcnow()
        else:
            copilot = CopilotSession(
                user_id=user_id,
                lead_id=lead.id,
                platform='whatsapp',
                platform_identifier=phone,
                status='active',
                last_reply=payload.message,
                stage='reply_received'
            )
            db.add(copilot)
    
    db.commit()
    
    logger.info(f"Webhook received from {phone}: {payload.message[:50]}")
    return {"status": "received", "lead_matched": lead is not None}


@router.get("/messages", response_model=List[MessageResponse])
async def get_messages(
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get WhatsApp message history."""
    messages = db.query(WhatsAppMessage).filter(
        WhatsAppMessage.user_id == current_user.id
    ).order_by(WhatsAppMessage.created_at.desc()).limit(limit).all()
    return messages
