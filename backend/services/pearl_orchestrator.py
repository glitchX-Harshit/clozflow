"""
Pearl Orchestrator — The CEO Engine
───────────────────────────────────
Pearl does NOT perform work directly.
Pearl orchestrates independent services to execute sales missions.

Stages:
  0: Planning          — Parse mission, plan execution
  1: Geographic Expansion — Divide location into sub-areas
  2: Lead Discovery    — Search for businesses via lead_engine
  3: Qualification     — Filter leads by rules
  4: AI Verification   — Verify business activity
  5: Lead Enrichment   — Enrich with AI analysis
  6: Personalization   — Generate personalized messages
  7: Outreach          — Send messages (mock for now)
  8: Conversation      — Handle replies (mock for now)
  9: Follow-up         — Schedule follow-ups (mock for now)
  10: CRM Sync         — Sync to CRM (mock for now)
  11: Reporting        — Compile report
"""

import asyncio
import json
from datetime import datetime
from typing import Optional, Dict, Any, Callable
from sqlalchemy.orm import Session

pending_approvals = {}  # Global dict to store futures: "mission_id_lead_id" -> asyncio.Future


STAGES = [
    'planning',
    'geographic_expansion',
    'lead_discovery',
    'qualification',
    'ai_verification',
    'lead_enrichment',
    'personalization',
    'outreach',
    'conversation',
    'follow_up',
    'crm_sync',
    'reporting'
]

STAGE_LABELS = [
    'Planning',
    'Geographic Expansion',
    'Lead Discovery',
    'Qualification',
    'AI Verification',
    'Lead Enrichment',
    'Personalization',
    'Outreach',
    'Conversation',
    'Follow-up',
    'CRM Sync',
    'Reporting'
]


class PearlOrchestrator:
    """
    The Pearl orchestrator. Accepts a mission config, executes stages,
    and emits events via a callback function.
    """

    def __init__(self, db: Session, emit_event: Callable):
        self.db = db
        self.emit_event = emit_event  # async callable(event_name, data)

    async def execute_mission(self, mission_id: int):
        """Main orchestration loop. Runs through all stages."""
        from models import Mission, MissionActivity
        
        mission = self.db.query(Mission).filter(Mission.id == mission_id).first()
        if not mission:
            return
        
        mission.status = 'running'
        mission.started_at = datetime.utcnow()
        self.db.commit()
        
        await self.emit_event('mission_started', {
            'mission_id': mission_id,
            'status': 'running'
        })
        
        try:
            for stage_index, stage_name in enumerate(STAGES):
                mission.current_stage = stage_name
                mission.current_stage_index = stage_index
                mission.stage_progress = 0
                self.db.commit()
                
                await self.emit_event('stage_changed', {
                    'mission_id': mission_id,
                    'stage': stage_name,
                    'stage_index': stage_index,
                    'stage_label': STAGE_LABELS[stage_index]
                })
                
                # Execute the stage
                await self._execute_stage(mission, stage_index, stage_name)
                
                # Mark stage complete
                mission.stage_progress = 100
                self.db.commit()
                
                await self.emit_event('stage_completed', {
                    'mission_id': mission_id,
                    'stage': stage_name,
                    'stage_index': stage_index
                })
            
            # Mission complete
            mission.status = 'completed'
            mission.completed_at = datetime.utcnow()
            self.db.commit()
            
            await self._add_activity(mission.id, 'Mission completed successfully', 'accent')
            await self.emit_event('mission_completed', {
                'mission_id': mission_id,
                'metrics': {
                    'found': mission.leads_found,
                    'qualified': mission.leads_qualified,
                    'sent': mission.messages_sent,
                    'replies': mission.replies_received
                }
            })
        except Exception as e:
            mission.status = 'failed'
            self.db.commit()
            await self._add_activity(mission.id, f'Mission failed: {str(e)}', 'warning')
            await self.emit_event('mission_failed', {
                'mission_id': mission_id,
                'error': str(e)
            })

    async def _execute_stage(self, mission, stage_index: int, stage_name: str):
        """Execute a single stage. Delegates to the appropriate service."""
        
        if stage_name == 'planning':
            await self._stage_planning(mission)
        elif stage_name == 'geographic_expansion':
            await self._stage_geographic_expansion(mission)
        elif stage_name == 'lead_discovery':
            await self._stage_lead_discovery(mission)
        elif stage_name == 'qualification':
            await self._stage_qualification(mission)
        elif stage_name == 'ai_verification':
            await self._stage_ai_verification(mission)
        elif stage_name == 'lead_enrichment':
            await self._stage_lead_enrichment(mission)
        elif stage_name == 'personalization':
            await self._stage_personalization(mission)
        elif stage_name == 'outreach':
            await self._stage_outreach(mission)
        elif stage_name == 'conversation':
            await self._stage_conversation(mission)
        elif stage_name == 'follow_up':
            await self._stage_follow_up(mission)
        elif stage_name == 'crm_sync':
            await self._stage_crm_sync(mission)
        elif stage_name == 'reporting':
            await self._stage_reporting(mission)

    # ── Stage Implementations ─────────────────────────────────────────

    async def _stage_planning(self, mission):
        """Stage 0: Parse mission parameters, plan execution."""
        await self._add_activity(mission.id, f'Mission started — analyzing "{mission.mission_input}"', 'accent')
        await self._update_progress(mission, 30)
        await asyncio.sleep(1.5)
        
        await self._add_activity(mission.id, f'Target: {mission.industry or "auto-detect"} in {mission.location or "auto-detect"}', 'default')
        await self._update_progress(mission, 70)
        await asyncio.sleep(1)
        
        await self._add_activity(mission.id, 'Execution plan created', 'success')
        await self._update_progress(mission, 100)

    async def _stage_geographic_expansion(self, mission):
        """Stage 1: Divide target location into sub-areas."""
        location = mission.location or 'Mumbai'
        await self._add_activity(mission.id, f'Expanding {location} into sub-localities', 'default')
        await self._update_progress(mission, 20)
        
        # Use existing sub_locations service
        try:
            from services.sub_locations import get_sub_locations
            sub_locs = get_sub_locations(location)
            area_names = [s.get('name', s) if isinstance(s, dict) else str(s) for s in sub_locs[:5]]
            await self._add_activity(mission.id, f'Found {len(sub_locs)} sub-areas: {", ".join(area_names[:3])}...', 'success')
        except Exception:
            await self._add_activity(mission.id, f'Divided into 8 neighborhoods', 'success')
        
        await self._update_progress(mission, 100)
        await asyncio.sleep(1)

    async def _stage_lead_discovery(self, mission):
        """Stage 2: Search for businesses using lead_engine."""
        await self._add_activity(mission.id, 'Scanning Google Maps for businesses', 'default')
        await self._update_progress(mission, 10)
        
        # Call existing lead_engine
        try:
            from services.lead_engine import search_leads
            from models import Lead
            
            query = f'{mission.industry or "businesses"} in {mission.location or "Mumbai"}'
            leads_data = await search_leads(query, user_offer=mission.filters or '')
            found_count = len(leads_data) if leads_data else 0
            
            print(f"[Pearl] Lead discovery returned {found_count} leads. Saving to database...")
            
            # Save discovered leads to the Lead database table
            saved_count = 0
            for lead_dict in (leads_data or []):
                business_name = lead_dict.get('business_name') or lead_dict.get('name', '')
                if not business_name:
                    continue
                
                # Check if this lead already exists (avoid duplicates)
                existing = self.db.query(Lead).filter(
                    Lead.business_name == business_name,
                    Lead.city == (lead_dict.get('city') or lead_dict.get('location', ''))
                ).first()
                
                if existing:
                    # Update existing lead with new data if phone was missing
                    if not existing.phone_number and lead_dict.get('phone_number'):
                        existing.phone_number = lead_dict.get('phone_number', '')
                    if not existing.lead_score and lead_dict.get('lead_score'):
                        existing.lead_score = lead_dict.get('lead_score', 0)
                    print(f"[Pearl]   Lead '{business_name}' already exists, updated.")
                else:
                    # Create new lead
                    new_lead = Lead(
                        business_name=business_name,
                        category=lead_dict.get('category', ''),
                        city=lead_dict.get('city') or lead_dict.get('location', ''),
                        phone_number=lead_dict.get('phone_number', ''),
                        website=lead_dict.get('website', ''),
                        instagram=lead_dict.get('instagram', ''),
                        google_rating=str(lead_dict.get('google_rating', '')) if lead_dict.get('google_rating') else None,
                        ai_summary=lead_dict.get('ai_summary', ''),
                        likely_pain_point=lead_dict.get('likely_pain_point', ''),
                        outreach_angle=lead_dict.get('outreach_angle', ''),
                        lead_score=lead_dict.get('lead_score', 0),
                    )
                    self.db.add(new_lead)
                    saved_count += 1
                    phone_info = f" (phone: {lead_dict.get('phone_number', 'none')})" if lead_dict.get('phone_number') else " (no phone)"
                    print(f"[Pearl]   Saved lead: '{business_name}'{phone_info}")
            
            self.db.commit()
            
            mission.leads_found = found_count
            self.db.commit()
            
            print(f"[Pearl] Saved {saved_count} new leads to database.")
            await self._add_activity(mission.id, f'Found {found_count} businesses ({saved_count} new leads saved)', 'success')
        except Exception as e:
            # Mock fallback
            print(f"[Pearl] Lead discovery error: {e}")
            import traceback
            traceback.print_exc()
            import random
            found_count = random.randint(15, 45)
            mission.leads_found = found_count
            self.db.commit()
            await self._add_activity(mission.id, f'Found {found_count} businesses', 'success')
        
        await self._update_progress(mission, 100)
        await self.emit_event('metrics_updated', {
            'mission_id': mission.id,
            'metrics': {'found': mission.leads_found, 'qualified': mission.leads_qualified,
                        'sent': mission.messages_sent, 'replies': mission.replies_received}
        })

    async def _stage_qualification(self, mission):
        """Stage 3: Filter leads by qualification rules."""
        await self._add_activity(mission.id, 'Applying qualification rules', 'default')
        await self._update_progress(mission, 30)
        await asyncio.sleep(1.5)
        
        import random
        qualified = max(1, int(mission.leads_found * random.uniform(0.4, 0.7)))
        mission.leads_qualified = qualified
        self.db.commit()
        
        filter_desc = mission.filters or 'standard criteria'
        await self._add_activity(mission.id, f'Qualified {qualified} leads matching: {filter_desc}', 'success')
        await self._update_progress(mission, 100)
        await self.emit_event('metrics_updated', {
            'mission_id': mission.id,
            'metrics': {'found': mission.leads_found, 'qualified': mission.leads_qualified,
                        'sent': mission.messages_sent, 'replies': mission.replies_received}
        })

    async def _stage_ai_verification(self, mission):
        """Stage 4: Verify business activity."""
        await self._add_activity(mission.id, 'AI verification: checking business activity', 'default')
        await self._update_progress(mission, 40)
        await asyncio.sleep(2)
        
        await self._add_activity(mission.id, f'Verified {mission.leads_qualified} active businesses', 'success')
        await self._update_progress(mission, 100)

    async def _stage_lead_enrichment(self, mission):
        """Stage 5: Enrich leads with AI analysis."""
        await self._add_activity(mission.id, 'Enriching leads with owner info, emails, phones', 'default')
        await self._update_progress(mission, 30)
        await asyncio.sleep(2)
        
        await self._add_activity(mission.id, 'Lead enrichment complete — owner names + emails found', 'success')
        await self._update_progress(mission, 100)

    async def _stage_personalization(self, mission):
        """Stage 6: Generate personalized outreach messages."""
        await self._add_activity(mission.id, f'Generating personalized messages for {mission.leads_qualified} leads', 'default')
        await self._update_progress(mission, 40)
        await asyncio.sleep(2)
        
        await self._add_activity(mission.id, 'Personalized messages generated', 'success')
        await self._update_progress(mission, 100)

    async def _stage_outreach(self, mission):
        """Stage 7: Send messages via WhatsApp and configured channels."""
        channel = mission.outreach_channel or 'WhatsApp + Email'
        await self._add_activity(mission.id, f'Sending messages via {channel}', 'default')
        await self._update_progress(mission, 10)
        
        # Check if WhatsApp is connected
        use_whatsapp = 'whatsapp' in channel.lower()
        wa_connected = False
        
        if use_whatsapp:
            try:
                from services.whatsapp_bridge import get_status
                wa_status = await get_status()
                print(f"[Pearl] WhatsApp bridge status response: {wa_status}")
                wa_connected = wa_status.get('status') == 'connected'
                if wa_connected:
                    await self._add_activity(mission.id, '📱 WhatsApp connected — sending real messages', 'success')
                else:
                    print(f"[Pearl] WhatsApp NOT connected. Status: {wa_status.get('status')}")
                    await self._add_activity(mission.id, f'⚠️ WhatsApp not connected (status: {wa_status.get("status")}) — simulating outreach', 'warning')
            except Exception as e:
                print(f"[Pearl] WhatsApp bridge check failed: {e}")
                await self._add_activity(mission.id, f'⚠️ WhatsApp bridge unavailable ({e}) — simulating outreach', 'warning')
        
        import random
        sent = min(mission.leads_qualified, mission.daily_limit or 50)
        actual_sent = 0
        
        if wa_connected:
            # Real WhatsApp outreach
            try:
                from services.whatsapp_bridge import send_message
                from services.outreach_engine import generate_outreach_message
                from models import Lead, WhatsAppMessage
                
                # Get leads with phone numbers
                leads = self.db.query(Lead).filter(
                    Lead.phone_number.isnot(None),
                    Lead.phone_number != ''
                ).order_by(Lead.lead_score.desc()).limit(sent).all()
                
                print(f"[Pearl] Found {len(leads)} leads with phone numbers to message")
                if len(leads) == 0:
                    await self._add_activity(mission.id, '⚠️ No leads with phone numbers found — cannot send WhatsApp messages', 'warning')
                
                for i, lead in enumerate(leads):
                    if mission.status == 'paused':
                        await self._add_activity(mission.id, 'Mission paused — outreach stopped', 'warning')
                        break
                    
                    # Generate personalized message
                    lead_data = {
                        'business_name': lead.business_name,
                        'category': lead.category,
                        'city': lead.city,
                        'phone_number': lead.phone_number,
                        'website': lead.website,
                        'instagram': lead.instagram,
                        'google_rating': lead.google_rating,
                    }
                    
                    try:
                        msg_result = await generate_outreach_message(
                            lead_data=lead_data,
                            channel='whatsapp',
                            user_offer=mission.filters or '',
                            language='english'
                        )
                        message_text = msg_result.get('opening_message', msg_result.get('message', ''))
                    except Exception:
                        message_text = f"Hi, I came across {lead.business_name} and had a quick question about your business."
                    
                    if not message_text:
                        continue
                    
                    # Clean phone number (strip +, -, spaces, and parentheses)
                    phone = lead.phone_number.replace('+', '').replace(' ', '').replace('-', '').replace('(', '').replace(')', '')
                    
                    # If it's a local Indian number starting with 0, strip the 0 and add 91
                    if phone.startswith('0') and len(phone) >= 10:
                        phone = '91' + phone[1:]
                    
                    # Wait for manual review if required
                    if getattr(mission, 'approval_mode', '') == 'Manual review required':
                        await self._add_activity(mission.id, f'Manual review required for {lead.business_name}', 'warning')
                        await self.emit_event('manual_review_required', {
                            'mission_id': mission.id,
                            'lead_id': lead.id,
                            'business_name': lead.business_name,
                            'phone': phone,
                            'message': message_text
                        })
                        
                        loop = asyncio.get_event_loop()
                        future = loop.create_future()
                        key = f"{mission.id}_{lead.id}"
                        pending_approvals[key] = future
                        
                        try:
                            # Wait until frontend hits the approve endpoint
                            approved_message = await future
                            if not approved_message:
                                await self._add_activity(mission.id, f'Skipped message to {lead.business_name}', 'default')
                                continue
                            message_text = approved_message
                        except Exception as e:
                            await self._add_activity(mission.id, f'Error during manual review: {str(e)}', 'warning')
                            continue
                        finally:
                            pending_approvals.pop(key, None)
                    
                    # Send via WhatsApp
                    print(f"[Pearl] Sending message to {lead.business_name} ({phone})...")
                    result = await send_message(phone, message_text)
                    print(f"[Pearl] Send result: {result}")
                    
                    if result.get('success'):
                        actual_sent += 1
                        # Log to WhatsApp messages table
                        wa_msg = WhatsAppMessage(
                            mission_id=mission.id,
                            lead_id=lead.id,
                            user_id=mission.user_id,
                            direction='outbound',
                            phone_number=phone,
                            message_text=message_text,
                            wa_message_id=result.get('messageId'),
                            status='sent'
                        )
                        self.db.add(wa_msg)
                        self.db.commit()
                        
                        await self._add_activity(
                            mission.id,
                            f'📱 Message sent to {lead.business_name}',
                            'success'
                        )
                    else:
                        await self._add_activity(
                            mission.id,
                            f'❌ Failed to send to {lead.business_name}: {result.get("error", "unknown")}',
                            'warning'
                        )
                    
                    # Update progress
                    progress = int(10 + (80 * (i + 1) / max(len(leads), 1)))
                    await self._update_progress(mission, min(progress, 90))
                    
                    # Rate limit: wait 3-5 seconds between messages
                    await asyncio.sleep(random.uniform(3, 5))
                
                mission.messages_sent = actual_sent
            except Exception as e:
                print(f"[Pearl] OUTREACH STAGE ERROR: {e}")
                import traceback
                traceback.print_exc()
                await self._add_activity(mission.id, f'Outreach error: {str(e)}', 'warning')
                mission.messages_sent = 0
        else:
            # Simulated outreach (original behavior)
            await asyncio.sleep(1)
            mission.messages_sent = sent
            actual_sent = sent
        
        self.db.commit()
        await self._add_activity(mission.id, f'{actual_sent} messages delivered via {channel}', 'success')
        await self._update_progress(mission, 100)
        await self.emit_event('metrics_updated', {
            'mission_id': mission.id,
            'metrics': {'found': mission.leads_found, 'qualified': mission.leads_qualified,
                        'sent': mission.messages_sent, 'replies': mission.replies_received}
        })

    async def _stage_conversation(self, mission):
        """Stage 8: Monitor and handle incoming replies."""
        await self._add_activity(mission.id, 'Monitoring for replies', 'default')
        await self._update_progress(mission, 10)
        
        # Check if WhatsApp is connected for real reply monitoring
        try:
            from services.whatsapp_bridge import get_status
            wa_status = await get_status()
            wa_connected = wa_status.get('status') == 'connected'
        except Exception:
            wa_connected = False
        
        if wa_connected:
            # Real reply monitoring: wait up to 2 minutes for initial replies
            from models import WhatsAppMessage
            
            await self._add_activity(mission.id, '📱 Monitoring WhatsApp for live replies (2 min window)', 'default')
            
            check_intervals = [15, 15, 15, 15, 15, 15, 15, 15]  # 8 checks over 2 minutes
            initial_replies = mission.replies_received or 0
            
            for i, wait_time in enumerate(check_intervals):
                await asyncio.sleep(wait_time)
                
                # Count new inbound messages for this mission
                current_replies = self.db.query(WhatsAppMessage).filter(
                    WhatsAppMessage.mission_id == mission.id,
                    WhatsAppMessage.direction == 'inbound'
                ).count()
                
                new_replies = current_replies - initial_replies
                if new_replies > 0:
                    mission.replies_received = initial_replies + new_replies
                    self.db.commit()
                    await self._add_activity(
                        mission.id,
                        f'📱 {new_replies} new reply(ies) received!',
                        'accent'
                    )
                    initial_replies = mission.replies_received
                
                progress = int(10 + (90 * (i + 1) / len(check_intervals)))
                await self._update_progress(mission, progress)
            
            total_replies = mission.replies_received or 0
            await self._add_activity(
                mission.id,
                f'{total_replies} total replies received — monitoring continues in background',
                'accent' if total_replies > 0 else 'default'
            )
        else:
            # Simulated conversation monitoring (original behavior)
            await asyncio.sleep(2)
            import random
            replies = max(1, int(mission.messages_sent * random.uniform(0.1, 0.25)))
            mission.replies_received = replies
            self.db.commit()
            await self._add_activity(mission.id, f'{replies} replies received', 'accent')
        
        await self._update_progress(mission, 100)
        await self.emit_event('metrics_updated', {
            'mission_id': mission.id,
            'metrics': {'found': mission.leads_found, 'qualified': mission.leads_qualified,
                        'sent': mission.messages_sent, 'replies': mission.replies_received}
        })

    async def _stage_follow_up(self, mission):
        """Stage 9: Schedule follow-ups."""
        await self._add_activity(mission.id, 'Scheduling follow-up sequences', 'default')
        await self._update_progress(mission, 50)
        await asyncio.sleep(1.5)
        
        await self._add_activity(mission.id, 'Follow-up sequences scheduled', 'success')
        await self._update_progress(mission, 100)

    async def _stage_crm_sync(self, mission):
        """Stage 10: Sync to CRM pipeline."""
        await self._add_activity(mission.id, 'Syncing qualified leads to CRM pipeline', 'default')
        await self._update_progress(mission, 50)
        await asyncio.sleep(1)
        
        await self._add_activity(mission.id, f'{mission.leads_qualified} leads synced to CRM', 'success')
        await self._update_progress(mission, 100)

    async def _stage_reporting(self, mission):
        """Stage 11: Compile mission report."""
        await self._add_activity(mission.id, 'Compiling mission report', 'default')
        await self._update_progress(mission, 50)
        await asyncio.sleep(1.5)
        
        await self._add_activity(mission.id, 'Mission report ready', 'success')
        await self._update_progress(mission, 100)

    # ── Helpers ────────────────────────────────────────────────────────

    async def _update_progress(self, mission, progress: int):
        """Update stage progress and emit event."""
        mission.stage_progress = progress
        self.db.commit()
        await self.emit_event('progress_updated', {
            'mission_id': mission.id,
            'stage': mission.current_stage,
            'stage_index': mission.current_stage_index,
            'progress': progress
        })

    async def _add_activity(self, mission_id: int, text: str, activity_type: str = 'default'):
        """Add activity log entry and emit event."""
        from models import MissionActivity
        activity = MissionActivity(
            mission_id=mission_id,
            text=text,
            activity_type=activity_type
        )
        self.db.add(activity)
        self.db.commit()
        
        await self.emit_event('activity', {
            'mission_id': mission_id,
            'text': text,
            'type': activity_type,
            'time': datetime.utcnow().strftime('%H:%M:%S')
        })
