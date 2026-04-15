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
        'HexagonTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor("#6366f1"), # Indigo
        spaceAfter=12,
        alignment=1 # Center
    )
    
    header_style = ParagraphStyle(
        'HexagonHeader',
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
        textColor=colors.HexColor("#09090b"),
        leftIndent=20,
        spaceBefore=10
    )
    
    ai_style = ParagraphStyle(
        'AIInsight',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.HexColor("#4f46e5"),
        leftIndent=40,
        backColor=colors.HexColor("#f5f3ff"),
        borderPadding=8,
        borderRadius=4,
        spaceBefore=5,
        spaceAfter=10
    )

    elements = []
    
    # Header
    elements.append(Paragraph("Hexagon Call Intelligence Report", title_style))
    elements.append(Spacer(1, 12))
    
    date_str = call_log.timestamp.strftime("%B %d, %Y at %I:%M %p")
    elements.append(Paragraph(f"<b>Date:</b> {date_str}", styles['Normal']))
    elements.append(Paragraph(f"<b>Call ID:</b> #{call_log.id}", styles['Normal']))
    elements.append(Spacer(1, 24))
    
    # Overview Table
    transcript_data = json.loads(call_log.transcript or "[]")
    ai_data = json.loads(call_log.ai_suggestions or "[]")
    
    stats = [
        ["Total Duration", "Est. 5-10 mins"],
        ["Total Exchanges", f"{len(transcript_data)} messages"],
        ["AI Insights Provided", f"{len(ai_data)} tips"]
    ]
    
    t = Table(stats, colWidths=[150, 200])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor("#f4f4f5")),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor("#71717a")),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
    ]))
    elements.append(t)
    elements.append(Spacer(1, 32))
    
    # Timeline Section
    elements.append(Paragraph("Conversation Timeline", header_style))
    
    # Combine transcript and AI into a timeline
    # We'll use the timestamp if available, otherwise order of entry
    timeline = []
    for entry in transcript_data:
        timeline.append({"type": "transcript", "data": entry})
    for entry in ai_data:
        timeline.append({"type": "ai", "data": entry})
        
    # Sort by timestamp string if available
    try:
        timeline.sort(key=lambda x: x["data"].get("timestamp", ""))
    except Exception:
        pass # Fallback to original order if sorting fails

    for item in timeline:
        if item["type"] == "transcript":
            text = item["data"].get("text", "")
            speaker = item["data"].get("speaker", "prospect").capitalize()
            elements.append(Paragraph(f"<b>{speaker}:</b> \"{text}\"", prospect_style))
        else:
            payload = item["data"].get("payload", {})
            strategy = payload.get("strategy", "General")
            response = payload.get("suggested_response", "")
            tip = payload.get("quick_tip", "")
            
            ai_content = f"<b>AI Insight ({strategy}):</b><br/>"
            if response:
                ai_content += f"<i>Suggested:</i> \"{response}\"<br/>"
            if tip:
                ai_content += f"<i>Tip:</i> {tip}"
            
            elements.append(Paragraph(ai_content, ai_style))
        
        elements.append(Spacer(1, 6))

    # Build PDF
    doc.build(elements)
    buffer.seek(0)
    return buffer
