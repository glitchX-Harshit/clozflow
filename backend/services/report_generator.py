import json
from io import BytesIO
from datetime import datetime
from reportlab.lib.pagesizes import LETTER
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

def generate_call_report(call_log):
    """
    Generates a PDF report for a specific call log.
    call_log: models.CallLog object
    """
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=LETTER, rightMargin=72, leftMargin=72, topMargin=72, bottomMargin=72)
    
    styles = getSampleStyleSheet()
    
    # Custom Styles
    title_style = ParagraphStyle(
        'ClozFlowTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor("#111827"), # Dark slate
        spaceAfter=12,
        alignment=1 # Center
    )
    
    header_style = ParagraphStyle(
        'ClozFlowHeader',
        parent=styles['Heading2'],
        fontSize=14,
        textColor=colors.HexColor("#09090b"),
        spaceBefore=24,
        spaceAfter=12,
        borderPadding=10,
        backgroundColor=colors.HexColor("#f4f4f5")
    )
    
    prospect_style = ParagraphStyle(
        'ProspectText',
        parent=styles['Normal'],
        fontSize=11,
        textColor=colors.HexColor("#374151"),
        leftIndent=20,
        spaceBefore=10
    )
    
    ai_style = ParagraphStyle(
        'AIInsight',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.HexColor("#2563eb"),
        leftIndent=40,
        backColor=colors.HexColor("#eff6ff"),
        borderPadding=8,
        borderRadius=4,
        spaceBefore=5,
        spaceAfter=10
    )

    elements = []
    
    # Header
    elements.append(Paragraph("ClozFlow Deep Research Report", title_style))
    elements.append(Spacer(1, 12))
    
    date_str = call_log.timestamp.strftime("%B %d, %Y at %I:%M %p")
    elements.append(Paragraph(f"<b>Session Date:</b> {date_str}", styles['Normal']))
    elements.append(Paragraph(f"<b>Session ID:</b> #{call_log.id}", styles['Normal']))
    elements.append(Spacer(1, 24))
    
    # Parse Data
    transcript_data = json.loads(call_log.transcript or "[]")
    ai_data = json.loads(call_log.ai_suggestions or "[]")
    
    # Calculate Real Metrics (No dummy data)
    avg_conf = 0
    objection_score = 0
    momentum_drops = 0
    
    if len(ai_data) > 0:
        conf_sum = sum(float(item["data"].get("payload", {}).get("confidence", 0.5)) for item in ai_data if "data" in item)
        avg_conf = conf_sum / len(ai_data)
        objection_score = int((1.0 - avg_conf) * 100)
        
        for item in ai_data:
            c = float(item.get("data", {}).get("payload", {}).get("confidence", 0.5))
            if c < 0.45:
                momentum_drops += 1
                
    closing_prob = max(0, int(avg_conf * 100))
    verdict = "High" if closing_prob > 75 else ("Moderate" if closing_prob > 50 else "Low")
    
    # Overview Table
    stats = [
        ["Closing Probability", f"{closing_prob}% ({verdict})"],
        ["Objection Resistance", f"{objection_score} / 100"],
        ["Momentum Drops", f"{momentum_drops} critical events"],
        ["Conversation Flow", f"{len(transcript_data)} messages exchanged"]
    ]
    
    t = Table(stats, colWidths=[200, 200])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor("#f8fafc")),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor("#334155")),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
    ]))
    elements.append(t)
    elements.append(Spacer(1, 32))
    
    # Timeline Section
    elements.append(Paragraph("Conversation Trajectory", header_style))
    
    # Combine transcript and AI into a timeline
    timeline = []
    for entry in transcript_data:
        timeline.append({"type": "transcript", "data": entry})
    for entry in ai_data:
        timeline.append({"type": "ai", "data": entry})
        
    try:
        timeline.sort(key=lambda x: x["data"].get("timestamp", ""))
    except Exception:
        pass 

    for item in timeline:
        if item["type"] == "transcript":
            text = item["data"].get("text", "")
            speaker = item["data"].get("speaker", "prospect").capitalize()
            elements.append(Paragraph(f"<b>{speaker}:</b> \"{text}\"", prospect_style))
        else:
            payload = item["data"].get("payload", {})
            strategy = payload.get("strategy", "General")
            response = payload.get("suggested_response", "")
            tip = payload.get("coaching_tip", payload.get("quick_tip", ""))
            concern = payload.get("hidden_concern", "N/A")
            
            ai_content = f"<b>AI Insight ({strategy}):</b><br/>"
            if response:
                ai_content += f"<i>Suggested Path:</i> \"{response}\"<br/>"
            if concern != "N/A":
                ai_content += f"<i>Diagnosed Blocker:</i> {concern}<br/>"
            if tip:
                ai_content += f"<i>Strategic Note:</i> {tip}"
            
            elements.append(Paragraph(ai_content, ai_style))
        
        elements.append(Spacer(1, 6))

    doc.build(elements)
    buffer.seek(0)
    return buffer
