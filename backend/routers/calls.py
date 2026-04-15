from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session
from typing import List
from database import get_db
from models import CallLog, User
from routers.auth import get_current_user
from services.report_generator import generate_call_report
from pydantic import BaseModel
from datetime import datetime

router = APIRouter(prefix="/calls", tags=["calls"])

class CallLogResponse(BaseModel):
    id: int
    user_id: int
    timestamp: datetime
    message_count: int
    insight_count: int

    class Config:
        from_attributes = True

@router.get("/", response_model=List[CallLogResponse])
def get_call_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns the call history for the current authenticated user.
    """
    import json
    calls = db.query(CallLog).filter(CallLog.user_id == current_user.id).order_by(CallLog.timestamp.desc()).all()
    
    # Custom formatting to add counts
    results = []
    for call in calls:
        try:
            msg_count = len(json.loads(call.transcript or "[]"))
            ins_count = len(json.loads(call.ai_suggestions or "[]"))
        except:
            msg_count = 0
            ins_count = 0
            
        results.append({
            "id": call.id,
            "user_id": call.user_id,
            "timestamp": call.timestamp,
            "message_count": msg_count,
            "insight_count": ins_count
        })
    
    return results

@router.get("/{call_id}/report")
def download_call_report(
    call_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Generates and returns a PDF report for the specified call.
    """
    call_log = db.query(CallLog).filter(CallLog.id == call_id, CallLog.user_id == current_user.id).first()
    if not call_log:
        raise HTTPException(status_code=404, detail="Call record not found")
        
    try:
        pdf_buffer = generate_call_report(call_log)
        pdf_filename = f"hexagon_report_{call_id}.pdf"
        
        return Response(
            content=pdf_buffer.getvalue(),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{pdf_filename}"'
            }
        )
    except Exception as e:
        print(f"❌ PDF Generation Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate report")
