"""
Pearl Nightly Report Service
────────────────────────────
Compiles daily mission metrics and sends email reports.

• generate_daily_report()   → Build HTML report for a user
• send_report_email()       → Send report via SMTP
• run_nightly_reports()     → Background task for all users
"""

import smtplib
import os
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from typing import Optional

logger = logging.getLogger("pearl_reports")


def generate_daily_report(db: Session, user_id: int) -> dict:
    """Generate a daily report summarizing all Pearl mission activity."""
    from models import Mission, WhatsAppMessage, PearlReport, User
    
    today = datetime.utcnow().date()
    start_of_day = datetime.combine(today, datetime.min.time())
    end_of_day = datetime.combine(today, datetime.max.time())
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return {}
    
    # Aggregate mission metrics
    active_missions = db.query(Mission).filter(
        Mission.user_id == user_id,
        Mission.status.in_(['running', 'completed']),
        Mission.updated_at >= start_of_day
    ).all()
    
    total_found = sum(m.leads_found or 0 for m in active_missions)
    total_contacted = sum(m.messages_sent or 0 for m in active_missions)
    total_replies = sum(m.replies_received or 0 for m in active_missions)
    total_meetings = sum(m.meetings_booked or 0 for m in active_missions)
    
    # Count WhatsApp messages sent today
    wa_sent_today = db.query(WhatsAppMessage).filter(
        WhatsAppMessage.user_id == user_id,
        WhatsAppMessage.direction == 'outbound',
        WhatsAppMessage.created_at >= start_of_day,
        WhatsAppMessage.created_at <= end_of_day
    ).count()
    
    wa_received_today = db.query(WhatsAppMessage).filter(
        WhatsAppMessage.user_id == user_id,
        WhatsAppMessage.direction == 'inbound',
        WhatsAppMessage.created_at >= start_of_day,
        WhatsAppMessage.created_at <= end_of_day
    ).count()
    
    # Calculate response rate
    response_rate = round((wa_received_today / max(wa_sent_today, 1)) * 100, 1)
    
    report_data = {
        'user_name': user.full_name or user.username or user.email,
        'user_email': user.email,
        'report_date': today.strftime('%B %d, %Y'),
        'missions_active': len(active_missions),
        'leads_found': total_found,
        'leads_contacted': total_contacted,
        'whatsapp_sent': wa_sent_today,
        'whatsapp_received': wa_received_today,
        'replies_received': total_replies,
        'meetings_booked': total_meetings,
        'response_rate': response_rate,
        'follow_ups_pending': max(0, total_contacted - total_replies),
    }
    
    report_data['html'] = _build_report_html(report_data)
    
    # Save report record
    report = PearlReport(
        user_id=user_id,
        report_date=datetime.utcnow(),
        missions_active=len(active_missions),
        leads_found=total_found,
        leads_contacted=total_contacted,
        replies_received=total_replies,
        follow_ups_sent=max(0, total_contacted - total_replies),
        meetings_booked=total_meetings,
        report_html=report_data['html'],
    )
    db.add(report)
    db.commit()
    
    return report_data


def _build_report_html(data: dict) -> str:
    """Build a styled HTML email report."""
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin:0;padding:0;background:#f4f6f8;font-family:'Segoe UI',Roboto,sans-serif;">
        <div style="max-width:600px;margin:0 auto;padding:32px 20px;">
            <!-- Header -->
            <div style="background:linear-gradient(135deg,#0a0a0a 0%,#1e293b 100%);border-radius:16px 16px 0 0;padding:32px;text-align:center;">
                <div style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;">Pearl AI — Nightly Report</div>
                <h1 style="color:#fff;font-size:24px;margin:0;font-weight:700;">Daily Performance Summary</h1>
                <p style="color:#94a3b8;font-size:14px;margin-top:8px;">{data['report_date']}</p>
            </div>
            
            <!-- Metrics Grid -->
            <div style="background:#fff;padding:32px;border:1px solid #e2e8f0;">
                <p style="color:#475569;font-size:14px;margin:0 0 24px 0;">Hi {data['user_name']}, here's what Pearl accomplished today:</p>
                
                <table style="width:100%;border-collapse:collapse;">
                    <tr>
                        <td style="padding:16px;text-align:center;border:1px solid #f1f5f9;background:#f8fafc;border-radius:8px;">
                            <div style="font-size:28px;font-weight:800;color:#0a0a0a;">{data['leads_found']}</div>
                            <div style="font-size:12px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:1px;">Leads Found</div>
                        </td>
                        <td style="width:12px;"></td>
                        <td style="padding:16px;text-align:center;border:1px solid #f1f5f9;background:#f8fafc;border-radius:8px;">
                            <div style="font-size:28px;font-weight:800;color:#0a0a0a;">{data['leads_contacted']}</div>
                            <div style="font-size:12px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:1px;">Contacted</div>
                        </td>
                    </tr>
                    <tr><td colspan="3" style="height:12px;"></td></tr>
                    <tr>
                        <td style="padding:16px;text-align:center;border:1px solid #f1f5f9;background:#f8fafc;border-radius:8px;">
                            <div style="font-size:28px;font-weight:800;color:#16a34a;">{data['replies_received']}</div>
                            <div style="font-size:12px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:1px;">Replies</div>
                        </td>
                        <td style="width:12px;"></td>
                        <td style="padding:16px;text-align:center;border:1px solid #f1f5f9;background:#f8fafc;border-radius:8px;">
                            <div style="font-size:28px;font-weight:800;color:#7c3aed;">{data['response_rate']}%</div>
                            <div style="font-size:12px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:1px;">Response Rate</div>
                        </td>
                    </tr>
                </table>
                
                <!-- WhatsApp Stats -->
                <div style="margin-top:24px;padding:20px;background:#f0fdf4;border-radius:12px;border:1px solid #bbf7d0;">
                    <div style="font-size:13px;font-weight:600;color:#15803d;margin-bottom:12px;">📱 WhatsApp Activity</div>
                    <table style="width:100%;">
                        <tr>
                            <td style="color:#475569;font-size:13px;padding:4px 0;">Messages Sent</td>
                            <td style="color:#0a0a0a;font-weight:700;text-align:right;font-size:13px;">{data['whatsapp_sent']}</td>
                        </tr>
                        <tr>
                            <td style="color:#475569;font-size:13px;padding:4px 0;">Replies Received</td>
                            <td style="color:#0a0a0a;font-weight:700;text-align:right;font-size:13px;">{data['whatsapp_received']}</td>
                        </tr>
                        <tr>
                            <td style="color:#475569;font-size:13px;padding:4px 0;">Follow-ups Pending</td>
                            <td style="color:#0a0a0a;font-weight:700;text-align:right;font-size:13px;">{data['follow_ups_pending']}</td>
                        </tr>
                        <tr>
                            <td style="color:#475569;font-size:13px;padding:4px 0;">Meetings Booked</td>
                            <td style="color:#0a0a0a;font-weight:700;text-align:right;font-size:13px;">{data['meetings_booked']}</td>
                        </tr>
                    </table>
                </div>
                
                <!-- Missions -->
                <div style="margin-top:24px;padding:20px;background:#faf5ff;border-radius:12px;border:1px solid #e9d5ff;">
                    <div style="font-size:13px;font-weight:600;color:#7c3aed;margin-bottom:8px;">🔮 Active Missions</div>
                    <div style="font-size:24px;font-weight:800;color:#0a0a0a;">{data['missions_active']}</div>
                    <div style="font-size:12px;color:#64748b;margin-top:4px;">missions worked on today</div>
                </div>
            </div>
            
            <!-- Footer -->
            <div style="background:#f8fafc;border-radius:0 0 16px 16px;padding:24px;text-align:center;border:1px solid #e2e8f0;border-top:none;">
                <p style="color:#94a3b8;font-size:12px;margin:0;">Generated by Pearl AI · ClozFlow</p>
                <p style="color:#cbd5e1;font-size:11px;margin-top:8px;">Pearl works while you sleep 🌙</p>
            </div>
        </div>
    </body>
    </html>
    """


def send_report_email(to_email: str, report_html: str, report_date: str) -> bool:
    """Send the nightly report via SMTP."""
    smtp_host = os.getenv('SMTP_HOST', 'smtp.gmail.com')
    smtp_port = int(os.getenv('SMTP_PORT', '587'))
    smtp_user = os.getenv('SMTP_USER', '')
    smtp_pass = os.getenv('SMTP_PASS', '')
    from_email = os.getenv('SMTP_FROM', smtp_user)
    
    if not smtp_user or not smtp_pass:
        logger.warning("SMTP credentials not configured. Skipping email send.")
        return False
    
    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = f'Pearl AI Report — {report_date}'
        msg['From'] = f'Pearl AI <{from_email}>'
        msg['To'] = to_email
        
        # Plain text fallback
        text_part = MIMEText(f'Your Pearl AI daily report for {report_date} is ready. View in an HTML-capable email client.', 'plain')
        html_part = MIMEText(report_html, 'html')
        
        msg.attach(text_part)
        msg.attach(html_part)
        
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(from_email, to_email, msg.as_string())
        
        logger.info(f"Report email sent to {to_email}")
        return True
    except Exception as e:
        logger.error(f"Email send failed: {e}")
        return False


async def run_nightly_reports():
    """Background task: generate and email reports for all users with active missions."""
    from database import SessionLocal
    from models import Mission, User, PearlReport
    
    db = SessionLocal()
    try:
        # Find all users who had active missions today
        today = datetime.utcnow().date()
        start_of_day = datetime.combine(today, datetime.min.time())
        
        active_user_ids = db.query(Mission.user_id).filter(
            Mission.status.in_(['running', 'completed']),
            Mission.updated_at >= start_of_day
        ).distinct().all()
        
        for (user_id,) in active_user_ids:
            try:
                report_data = generate_daily_report(db, user_id)
                if report_data and report_data.get('user_email'):
                    success = send_report_email(
                        to_email=report_data['user_email'],
                        report_html=report_data['html'],
                        report_date=report_data['report_date']
                    )
                    if success:
                        # Mark report as sent
                        latest_report = db.query(PearlReport).filter(
                            PearlReport.user_id == user_id
                        ).order_by(PearlReport.created_at.desc()).first()
                        if latest_report:
                            latest_report.email_sent = True
                            db.commit()
                            
                    logger.info(f"Report generated for user {user_id}")
            except Exception as e:
                logger.error(f"Report generation failed for user {user_id}: {e}")
    finally:
        db.close()
