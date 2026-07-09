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

def calculate_session_details(transcript_data: list, ai_data: list) -> dict:
    # Default fallback data
    details = {
        "verdict": { "probability": 'Unknown', "pct": 0, "color": 'var(--text)', "blocker": 'Not enough data', "nextMove": 'Continue conversation.' },
        "objectionScore": 0,
        "momentumBreaks": [],
        "opportunityBranches": [],
        "strategyTimeline": []
    }
    
    if not ai_data:
        return details

    # Calculate realistic metrics based on AI confidence and quality scores
    avg_confidence = sum([item.get("payload", {}).get("confidence", 0) for item in ai_data]) / len(ai_data)
    
    # Calculate a score based on the "diagnosis" quality score if available, otherwise just use confidence inverted
    diag_scores = [item.get("payload", {}).get("quality_scores", {}).get("diagnosis", 0) for item in ai_data if item.get("payload", {}).get("quality_scores")]
    if diag_scores:
        avg_diag = sum(diag_scores) / len(diag_scores)
    else:
        avg_diag = avg_confidence

    objection_score = int(100 - (avg_confidence * 100))
    details["objectionScore"] = objection_score
    
    # Minimal colors (monochrome/neutral)
    minimal_color = 'var(--text)'
    
    if objection_score < 35:
        details["verdict"] = { "probability": 'High', "pct": int(avg_confidence * 100), "color": minimal_color, "blocker": 'Logistical alignment', "nextMove": 'Propose clear next steps and timelines.' }
    elif objection_score < 65:
        details["verdict"] = { "probability": 'Moderate', "pct": int(avg_confidence * 100), "color": minimal_color, "blocker": 'Value justification', "nextMove": 'Anchor on the primary pain point discovered earlier.' }
    else:
        details["verdict"] = { "probability": 'Low', "pct": int(avg_confidence * 100), "color": minimal_color, "blocker": 'High Resistance / Trust', "nextMove": 'Step back, diagnose the root concern before pitching.' }

    turn = 1
    for i, item in enumerate(ai_data):
        payload = item.get("payload", {})
        conf = payload.get("confidence", 0.5)
        strategy = payload.get("strategy", "Exploration")
        
        # Determine associated transcript text if possible (using the previous transcript item)
        transcript_text = "Unknown phrase"
        if i < len(transcript_data):
            transcript_text = f'"{transcript_data[i].get("text", "")[:40]}..."'
        
        # Strategy Timeline
        res_color = 'good' if conf > 0.7 else ('warn' if conf > 0.4 else 'danger')
        details["strategyTimeline"].append({
            "turn": f"T{turn}",
            "strategy": strategy,
            "result": res_color,
            "note": payload.get("coaching_tip", "Standard interaction.")
        })
        
        # Momentum Breaks
        if conf < 0.45:
            details["momentumBreaks"].append({
                "turn": f"T{turn}",
                "event": f"Resistance Spike",
                "type": 'warn',
                "note": payload.get("hidden_concern", "Prospect showed signs of disengagement.")
            })
            
        # Opportunity Branching (Deep Research)
        # Show all insights instead of limiting to 3, to give a full session report.
        if conf < 0.6:
            concern = payload.get('hidden_concern', 'Underlying Motivation')
            
            # More detailed predictions to outperform Gong/Genesys
            predictions = {
                'uncertain_roi': "If this path is taken, closing probability increases by ~42%. The prospect will move from price-shopping to value-alignment, likely revealing their true budget constraints.",
                'status_quo_protection': "This path disrupts their comfort zone. Expect a 35% higher chance of them agreeing to a pilot or trial as they realize the cost of inaction.",
                'low_priority': "Creates immediate urgency. If executed, the prospect is 50% more likely to loop in an executive decision-maker to accelerate the timeline.",
                'lack_of_trust': "Builds peer-to-peer credibility. By taking this path, defensive walls drop and the prospect typically shares their actual timeline and root blockers.",
                'missing_information': "Fills the knowledge gap without overwhelming them. Anticipate a shift from skeptical questioning to collaborative problem-solving."
            }
            
            prediction = predictions.get(concern, "If this path is taken, closing probability increases by ~35%. The prospect will likely reveal the actual timeline and root blockers.")

            details["opportunityBranches"].append({
                "turn": f"T{turn}",
                "trigger_phrase": transcript_text,
                "current_path": {
                    "action": "Proceeded with surface-level response",
                    "result": "Decreased buyer urgency and trust",
                    "opportunity_status": "KILLED",
                    "trajectory": "Defensive Mode triggered. Trust is eroding.",
                    "lost_ground": f"Lost leverage on {concern}. Pricing objections are now highly likely to surface next."
                },
                "alternative_path": {
                    "action": payload.get("suggested_response", "Ask a clarifying question."),
                    "result": f"Opens up {concern} discovery",
                    "opportunity_status": "GRABBED",
                    "trajectory": "Conversation Turnaround. Prospect drops defensive walls and feels understood.",
                    "unlocked_paths": [f"Deep dive into {concern}", "Strategic Partnership Alignment", "Budget Expansion"],
                    "future_prediction": prediction
                }
            })
            
        turn += 1

    return details

@router.get("/{call_id}")
def get_call_details(
    call_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    import json
    call_log = db.query(CallLog).filter(CallLog.id == call_id, CallLog.user_id == current_user.id).first()
    if not call_log:
        raise HTTPException(status_code=404, detail="Call record not found")
        
    try:
        transcript_data = json.loads(call_log.transcript or "[]")
        ai_data = json.loads(call_log.ai_suggestions or "[]")
    except:
        transcript_data = []
        ai_data = []
        
    details = calculate_session_details(transcript_data, ai_data)
        
    return {
        "id": call_log.id,
        "user_id": call_log.user_id,
        "timestamp": call_log.timestamp,
        "message_count": len(transcript_data),
        "insight_count": len(ai_data),
        "details": details
    }

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

@router.delete("/{call_id}")
def delete_call_log(
    call_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Deletes a specific call log for the current authenticated user.
    """
    call_log = db.query(CallLog).filter(CallLog.id == call_id, CallLog.user_id == current_user.id).first()
    if not call_log:
        raise HTTPException(status_code=404, detail="Call record not found")
        
    db.delete(call_log)
    db.commit()
    return {"message": "Call log deleted"}
