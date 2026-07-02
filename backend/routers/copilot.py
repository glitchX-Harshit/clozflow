from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import User, Lead, CopilotSession
from routers.auth import get_current_user
from services.unified_conversation_brain import UnifiedConversationBrain
from pydantic import BaseModel
import json

router = APIRouter()

class SessionStartRequest(BaseModel):
    lead_id: int
    platform: str
    platform_identifier: str

class AnalyzeRequest(BaseModel):
    incoming_message: str
    platform: str

class TestSessionRequest(BaseModel):
    contact_name: str
    phone_number: str
    platform: str

@router.post("/session/start")
async def start_session(req: SessionStartRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    lead = db.query(Lead).filter(Lead.id == req.lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
        
    # Check for existing active session
    session = db.query(CopilotSession).filter(
        CopilotSession.lead_id == req.lead_id,
        CopilotSession.status == "active"
    ).first()
    
    if not session:
        session = CopilotSession(
            user_id=current_user.id,
            lead_id=req.lead_id,
            platform=req.platform,
            platform_identifier=req.platform_identifier,
            status="active",
            stage="initial_contact",
            buying_intent=0,
            trust_score=0
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        
    return {
        "session_id": session.id,
        "status": session.status,
        "lead_name": lead.business_name,
        "lead_company": lead.business_name,
        "summary": session.conversation_summary,
        "stage": session.stage,
        "buying_intent": session.buying_intent,
        "trust_score": session.trust_score
    }

@router.post("/session/test")
async def start_test_session(req: TestSessionRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Create a fake lead for testing
    fake_lead = Lead(
        business_name=f"[TEST] {req.contact_name}",
        phone_number=req.phone_number,
        ai_summary="Fake lead for Developer Testing."
    )
    db.add(fake_lead)
    db.commit()
    db.refresh(fake_lead)
    
    # Create the active copilot session
    session = CopilotSession(
        user_id=current_user.id,
        lead_id=fake_lead.id,
        platform=req.platform,
        platform_identifier=req.phone_number,
        status="active",
        stage="initial_contact",
        buying_intent=0,
        trust_score=0
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    
    return {
        "success": True,
        "session_id": session.id,
        "lead_id": fake_lead.id
    }

@router.get("/sessions/active")
async def get_active_sessions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    sessions = db.query(CopilotSession).filter(
        CopilotSession.user_id == current_user.id,
        CopilotSession.status == "active"
    ).all()
    
    return [
        {
            "session_id": s.id,
            "lead_id": s.lead_id,
            "platform": s.platform,
            "platform_identifier": s.platform_identifier,
            "stage": s.stage,
            "business_name": s.lead.business_name if s.lead else f"Lead #{s.lead_id}",
            "phone_number": s.lead.phone_number if s.lead else ""
        } for s in sessions
    ]

@router.get("/session/{session_id}")
async def get_session(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    session = db.query(CopilotSession).filter(CopilotSession.id == session_id, CopilotSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session

@router.post("/session/{session_id}/analyze")
async def analyze_message(session_id: int, req: AnalyzeRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    session = db.query(CopilotSession).filter(CopilotSession.id == session_id, CopilotSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
        
    user_context = {
        "your_company": current_user.company_name or "a B2B software consulting firm",
        "your_role": current_user.role or "Founder / Sales Strategist",
    }
    
    lead_data = {}
    if session.lead:
        lead_data = {
            "business_name": session.lead.business_name,
            "category": session.lead.category,
            "city": session.lead.city,
            "phone_number": session.lead.phone_number,
            "website": session.lead.website,
            "instagram": session.lead.instagram,
            "ai_summary": session.lead.ai_summary,
            "opportunity_summary": getattr(session.lead, "opportunity_summary", ""),
            "opportunity_signals": getattr(session.lead, "opportunity_signals", ""),
            "likely_pain_point": session.lead.likely_pain_point,
        }
        
    brain = UnifiedConversationBrain(db_session=db)
    
    # Load or Initialize Memory
    memory = None
    if session.conversation_summary:
        try:
            parsed = json.loads(session.conversation_summary)
            if isinstance(parsed, dict):
                memory = parsed
        except Exception:
            pass
            
    if not memory:
        memory = brain.initialize_memory(lead_data, user_context)
        
    # Analyze and Generate Reply
    analysis = await brain.analyze_and_reply(memory, req.incoming_message)
    
    if "error" not in analysis:
        # Save memory state
        session.conversation_summary = json.dumps(memory)
        session.stage = analysis.get("updated_stage", session.stage)
        session.last_reply = analysis.get("suggested_reply", "")
        
        if session.stage == "initial_contact":
            session.stage = "discovery"
            
        db.commit()
        
        return {
            "suggested_reply": analysis.get("suggested_reply", ""),
            "alternative_reply": "",
            "why": analysis.get("coaching", ""),
            "updated_stage": session.stage,
            "updated_buying_intent": session.buying_intent,
            "updated_trust_score": session.trust_score,
            "hidden_concern": session.hidden_concern,
            "objections": session.objections
        }
    
    raise HTTPException(status_code=500, detail="Failed to analyze message")

@router.post("/session/{session_id}/regenerate")
async def regenerate_reply(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    session = db.query(CopilotSession).filter(CopilotSession.id == session_id, CopilotSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
        
    user_context = {
        "your_company": current_user.company_name or "a B2B software consulting firm",
        "your_role": current_user.role or "Founder / Sales Strategist",
    }
    
    lead_data = {}
    if session.lead:
        lead_data = {
            "business_name": session.lead.business_name,
            "category": session.lead.category,
            "city": session.lead.city,
            "phone_number": session.lead.phone_number,
            "website": session.lead.website,
            "instagram": session.lead.instagram,
            "ai_summary": session.lead.ai_summary,
            "opportunity_summary": getattr(session.lead, "opportunity_summary", ""),
            "opportunity_signals": getattr(session.lead, "opportunity_signals", ""),
            "likely_pain_point": session.lead.likely_pain_point,
        }
        
    brain = UnifiedConversationBrain(db_session=db)
    
    # Load or Initialize Memory
    memory = None
    if session.conversation_summary:
        try:
            parsed = json.loads(session.conversation_summary)
            if isinstance(parsed, dict):
                memory = parsed
        except Exception:
            pass
            
    if not memory:
        memory = brain.initialize_memory(lead_data, user_context)

    # Use Outreach Generation if this is a fresh session with no replies yet
    if session.stage == "initial_contact" and len(memory.get("conversation_history", [])) == 0:
        outreach = await brain.generate_outreach(memory)
        
        session.conversation_summary = json.dumps(memory)
        session.last_reply = outreach.get("opening_message", "")
        db.commit()
        
        return {
            "suggested_reply": outreach.get("opening_message", ""),
            "why": f"Strategy: {outreach.get('strategy', 'Generated dynamically.')}"
        }
        
    # Regenerate Live Reply (by popping the last rep message and re-running analysis)
    last_incoming = ""
    history = memory.get("conversation_history", [])
    
    # Find the last message the prospect sent
    for msg in reversed(history):
        if msg["speaker"] == "prospect":
            last_incoming = msg["text"]
            break
            
    # Remove the last rep message so we can generate a new one
    if history and history[-1]["speaker"] == "rep":
        # Check if the message before it is the prospect's incoming message
        if len(history) >= 2 and history[-2]["speaker"] == "prospect":
            history.pop() # Remove rep's reply
            history.pop() # Remove prospect's message, it will be added back in analyze_and_reply
            
    analysis = await brain.analyze_and_reply(memory, last_incoming)
    
    if "error" not in analysis:
        session.conversation_summary = json.dumps(memory)
        session.last_reply = analysis.get("suggested_reply", "")
        db.commit()
        
        return {
            "suggested_reply": analysis.get("suggested_reply", ""),
            "why": analysis.get("coaching", "Regenerated alternative approach based on full context.")
        }
        
    raise HTTPException(status_code=500, detail="Failed to regenerate reply")

@router.put("/session/{session_id}/end")
async def end_session(session_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    session = db.query(CopilotSession).filter(CopilotSession.id == session_id, CopilotSession.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
        
    session.status = "ended"
    db.commit()
    return {"status": "ended"}
