from utils.capsule_formatter import format_capsule_context
from utils.variable_parser import substitute_variables_text

"""

Pearl API Router

All Pearl endpoints live under /api/pearl.

Reuses existing auth (get_current_user), database (get_db), and models.

"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, UploadFile, File, Form, Header, Query

from fastapi.responses import StreamingResponse, Response

from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy import func

from pydantic import BaseModel, field_validator

from typing import Optional, List, Dict, Any

from datetime import datetime, timedelta

import asyncio

import json

import logging

import os



from database import get_db

from routers.auth import get_current_user, verify_token_string

from models import User, Capsule, Lead

from models_pearl import (

    PearlAgent, PearlCall, PearlEvent, PearlConversation, PearlMessage,

    PearlTestSession, PearlTestMessage, PearlCampaign, PearlCampaignRecipient,

    AgentTool

)


from services.pearl.lead_ingestion import (

    process_lead_batch, parse_csv_file, parse_xlsx_sheets,

    canonicalize_lead_row, validate_and_normalize_phone

)



from services.pearl.state_machine import AgentStateMachine, InvalidTransition

from services.pearl.policy_engine import PolicyEngine, DEFAULT_AUTONOMY, DEFAULT_QUALIFICATION

from services.pearl.event_logger import EventLogger
from services.pearl.carrier_auth import (
    verify_carrier_token, provider_id_matches, carrier_audio_stream_url, public_base_url,
)
from services.pearl.carrier_events import (
    CarrierEvent, TERMINAL_CALL_STATUSES, IN_FLIGHT_CALL_STATUSES, PRE_ANSWER_CALL_STATUSES,
    parse_vobiz_event, parse_exotel_event, advances,
)
from services.pearl.campaign_schedule import (
    CallSettingsError, CampaignPolicy, DEFAULT_CALL_SETTINGS, SUPPORTED_CALL_PROVIDERS,
    campaign_policy, utc_iso,
)





from services.credit_service import (

    charge_post_call,

    deduct_credits,

    has_sufficient_balance,

    calculate_call_metering,

    RATE_PER_TEST_SIMULATION,

    RATE_PEARL_CALL_PER_MIN

)



router = APIRouter(prefix="/api/pearl", tags=["pearl"])





logger = logging.getLogger("routers.pearl")

# Implicit agents owned by an endpoint itself - never one of the user's saved agents.
CONSOLE_AGENT_MARKER = "pearl-console"            # POST /deploy without agent_id
DRAFT_DIALER_AGENT_MARKER = "pearl-draft-dialer"  # POST /agents/draft/calls (unsaved editor state)
TEST_SESSION_MODES = ("chat", "voice")
CAMPAIGN_PATCHABLE_STATUSES = ("draft", "scheduled", "paused", "completed")


def _get_owned_agent(db: Session, agent_id: str, user: User) -> PearlAgent:
    agent = db.query(PearlAgent).filter(PearlAgent.id == agent_id, PearlAgent.user_id == user.id).first()
    if not agent:
        raise HTTPException(404, "Agent not found")
    return agent


def _get_owned_call(db: Session, call_id: str, user: User) -> PearlCall:
    call = db.query(PearlCall).join(PearlAgent, PearlCall.agent_id == PearlAgent.id).filter(
        PearlCall.id == call_id, PearlAgent.user_id == user.id
    ).first()
    if not call:
        raise HTTPException(404, "Call not found")
    return call


def _get_owned_tool(db: Session, agent_id: str, tool_id: str, user: User) -> AgentTool:
    tool = db.query(AgentTool).join(PearlAgent, AgentTool.agent_id == PearlAgent.id).filter(
        AgentTool.id == tool_id, AgentTool.agent_id == agent_id, PearlAgent.user_id == user.id
    ).first()
    if not tool:
        raise HTTPException(404, "Tool not found")
    return tool


def _get_scratch_agent(db: Session, user: User, marker: str, default_name: str) -> PearlAgent:
    """The caller's implicit agent for ``marker`` (created on first use, never a saved agent)."""
    agent = db.query(PearlAgent).filter(
        PearlAgent.user_id == user.id, PearlAgent.provider_agent_id == marker
    ).order_by(PearlAgent.created_at.asc()).first()
    if agent is None:
        agent = PearlAgent(
            user_id=user.id, name=default_name, role="outbound_qualification", status="draft",
            current_state="idle", provider_agent_id=marker, version=1,
            qualification_rules=DEFAULT_QUALIFICATION, autonomy_policy=DEFAULT_AUTONOMY,
        )
        db.add(agent)
        db.flush()
    return agent


def _normalize_provider(name: Optional[str]) -> str:
    provider = (name or "vobiz").strip().lower()
    if provider not in SUPPORTED_CALL_PROVIDERS:
        raise HTTPException(400, f"Unsupported call_provider '{name}'. Use 'vobiz' or 'exotel'.")
    return provider


def _missing_provider_settings(provider: str) -> List[str]:
    required = {
        "vobiz": ["VOBIZ_AUTH_ID", "VOBIZ_AUTH_SECRET"],
        "exotel": ["EXOTEL_ACCOUNT_SID", "EXOTEL_API_KEY", "EXOTEL_API_TOKEN"],
    }.get(provider, [])
    missing = [k for k in required if not os.getenv(k)]
    if not public_base_url():
        missing.append("PEARL_PUBLIC_URL")
    return missing


def _require_call_balance(db: Session, user: User) -> None:
    if not has_sufficient_balance(db, user.id, RATE_PEARL_CALL_PER_MIN):
        raise HTTPException(
            status_code=402,
            detail=(
                f"Insufficient credits. An outbound call requires at least {RATE_PEARL_CALL_PER_MIN:.2f} "
                f"Credits (\u20b9{RATE_PEARL_CALL_PER_MIN:.2f}). Please top up your wallet."
            ),
        )


async def _dispatch_outbound_call(provider: str, to_number: str, call_id: str) -> Dict[str, Any]:
    """Ask the carrier to place the call. Never raises; returns {success, provider_call_id | error}."""
    from services.pearl.providers import vobiz_provider, exotel_provider
    try:
        if provider == "vobiz":
            prov = vobiz_provider.VobizTelephonyProvider()
            caller_id = os.getenv("VOBIZ_CALLER_ID", "+918065354620")
        else:
            prov = exotel_provider.ExotelTelephonyProvider()
            caller_id = os.getenv("EXOTEL_CALLER_ID", "01140844774")
        res = await prov.create_outbound_call(to_number, caller_id, custom_field=call_id)
        if not isinstance(res, dict):
            return {"success": False, "error": "Telephony provider returned an invalid response"}
        return res
    except Exception as exc:
        logger.warning("Telephony dispatch for call %s failed: %s", call_id[:8], exc)
        return {"success": False, "error": f"{provider} dispatch error: {exc}"}


def _ws_token(websocket) -> Optional[str]:
    token = websocket.query_params.get("token")
    if not token:
        auth = websocket.headers.get("authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    token = (token or "").strip()
    if token.startswith("Bearer "):
        token = token[7:].strip()
    return token or None


class SageChatRequest(BaseModel):
    messages: List[Dict[str, Any]] = []
    query: Optional[str] = None
    agent_state: Optional[Dict[str, Any]] = None


class SageFeedbackRequest(BaseModel):
    agent_id: Optional[Any] = None
    category: Optional[str] = "General"
    notes: Optional[str] = ""


class AgentOutboundCallRequest(BaseModel):
    phone_number: str
    recipient_name: Optional[str] = "Prospect"
    call_provider: Optional[str] = None
    agent_snapshot: Optional[Dict[str, Any]] = None


# ── Request/Response Schemas ──────────────────────────────────────────

DEFAULT_AGENT_ROLE = "outbound_qualification"
MAX_AGENT_ROLE_LENGTH = 64


def _clean_agent_role(value: Any, *, blank_ok: bool) -> Optional[str]:
    """Shared create/update rule for ``role``: a trimmed string of at most 64 characters.
    On create a blank role means the default; on update it is rejected (422)."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("role must be a string")
    role = value.strip()
    if not role:
        if blank_ok:
            return DEFAULT_AGENT_ROLE
        raise ValueError("role must not be empty")
    if len(role) > MAX_AGENT_ROLE_LENGTH:
        raise ValueError(f"role must be at most {MAX_AGENT_ROLE_LENGTH} characters")
    return role


class CreateAgentRequest(BaseModel):

    name: str

    role: str = DEFAULT_AGENT_ROLE

    @field_validator("role", mode="before")
    @classmethod
    def _role(cls, value):
        return _clean_agent_role(value, blank_ok=True) or DEFAULT_AGENT_ROLE

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

    settings: Optional[dict] = None

    tools_config: Optional[list] = None





class UpdateAgentRequest(BaseModel):

    name: Optional[str] = None

    # Same rule as on create (``null`` = unchanged).
    role: Optional[str] = None

    @field_validator("role", mode="before")
    @classmethod
    def _role(cls, value):
        return _clean_agent_role(value, blank_ok=False)

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

    settings: Optional[dict] = None

    tools_config: Optional[list] = None





def tool_to_dict(tool: AgentTool) -> dict:
    """Serialize an AgentTool to dict."""
    cfg = tool.config
    if isinstance(cfg, str):
        try:
            cfg = json.loads(cfg)
        except Exception:
            cfg = {}
    elif not isinstance(cfg, dict):
        cfg = {}

    raw_mode = getattr(tool, "run_mode", None)
    if not raw_mode and isinstance(cfg, dict):
        raw_mode = cfg.get("run_mode")
    raw_mode = str(raw_mode or "").lower().strip()
    is_read = (raw_mode == "read") or (isinstance(cfg, dict) and cfg.get("is_read_tool") is True)
    mode = "read" if is_read else "write"
    is_async_write = (not is_read)

    return {
        "id": tool.id,
        "agent_id": tool.agent_id,
        "name": tool.name,
        "tool_type": tool.tool_type,
        "description": tool.description,
        "run_timing": tool.run_timing or "conversation",
        "run_mode": mode,
        "is_read_tool": is_read,
        "is_async_write": is_async_write,
        "timeout_seconds": tool.timeout_seconds or 10,
        "fallback_response": tool.fallback_response,
        "config": cfg,
        "is_active": bool(tool.is_active) if tool.is_active is not None else True,
        "created_at": tool.created_at.isoformat() if tool.created_at else None,
        "updated_at": tool.updated_at.isoformat() if tool.updated_at else None,
    }


def agent_to_dict(agent: PearlAgent, include_events: bool = False, recent_events: Optional[List[PearlEvent]] = None) -> dict:

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

        "settings": (agent.voice_config or {}).get("settings", {}),

        "tools_config": (agent.voice_config or {}).get("tools_config", []),

        "tools": [tool_to_dict(t) for t in (getattr(agent, "tools", None) or [])],


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
        if recent_events is not None:
            result["recent_events"] = [event_to_dict(e) for e in recent_events]
        else:
            result["recent_events"] = [event_to_dict(e) for e in (getattr(agent, "events", None) or [])[:20]]

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

        "error_code": call.error_code,

        "qualification_result": call.qualification_result,

        "transcript_reference": call.transcript_reference,

        "created_at": call.created_at.isoformat() if call.created_at else None,

        "completed_at": call.completed_at.isoformat() if call.completed_at else None,
        "revenue_billed": round(float(getattr(call, "revenue_billed", 0.0) or 0.0), 2),
        "total_cogs": round(float(getattr(call, "total_cogs", 0.0) or 0.0), 2),
        "gross_profit": round(float(getattr(call, "gross_profit", 0.0) or 0.0), 2),
        "gross_margin_pct": round(float(getattr(call, "gross_margin_pct", 0.0) or 0.0), 1),
        "pulses_30s": int(getattr(call, "pulses_30s", 0) or 0),
        "cogs_telephony": round(float(getattr(call, "cogs_telephony", 0.0) or 0.0), 2),
        "cogs_tts": round(float(getattr(call, "cogs_tts", 0.0) or 0.0), 2),
        "cogs_stt": round(float(getattr(call, "cogs_stt", 0.0) or 0.0), 2),

    }





# ── Sales Archetypes ──────────────────────────────────────────────────────────

@router.get("/archetypes")
def list_sales_archetypes():
    """Returns list of standard pre-built enterprise sales archetypes."""
    from data.sales_archetypes import get_all_archetypes
    return get_all_archetypes()

@router.get("/archetypes/{archetype_id}")
def get_sales_archetype(archetype_id: str):
    """Returns details for a single sales archetype."""
    from data.sales_archetypes import get_archetype_by_id
    arch = get_archetype_by_id(archetype_id)
    if not arch:
        raise HTTPException(status_code=404, detail="Archetype not found")
    return arch


# ── Agent CRUD ────────────────────────────────────────────────────────────────

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

        voice_config=(lambda vc, s, tc: {**(vc or {}), **({"settings": s} if s is not None else {}), **({"tools_config": tc} if tc is not None else {})})(req.voice_config, req.settings, req.tools_config),

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

    agents = db.query(PearlAgent).options(
        joinedload(PearlAgent.capsule),
        selectinload(PearlAgent.tools)
    ).filter(

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

    agent = db.query(PearlAgent).options(
        joinedload(PearlAgent.capsule),
        selectinload(PearlAgent.tools)
    ).filter(

        PearlAgent.id == agent_id,

        PearlAgent.user_id == user.id

    ).first()

    if not agent:
        raise HTTPException(404, "Agent not found")

    recent_events = db.query(PearlEvent).filter(
        PearlEvent.agent_id == agent_id
    ).order_by(PearlEvent.timestamp.desc()).limit(20).all()

    return agent_to_dict(agent, include_events=True, recent_events=recent_events)





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
    # Explicit nulls on NOT NULL columns mean "unchanged" (``name: null`` used to fail with 500).
    for non_nullable in ("name", "role"):
        if non_nullable in update_fields and update_fields[non_nullable] is None:
            update_fields.pop(non_nullable)

    settings_val = update_fields.pop("settings", None)
    tools_val = update_fields.pop("tools_config", None)
    if settings_val is not None or tools_val is not None:
        merged_vc = dict(agent.voice_config or {})
        if settings_val is not None:
            merged_vc["settings"] = settings_val
        if tools_val is not None:
            merged_vc["tools_config"] = tools_val
        agent.voice_config = merged_vc

    for field, value in update_fields.items():
        if hasattr(agent, field):
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
    agent = _get_owned_agent(db, agent_id, user)

    running = db.query(PearlCampaign).filter(
        PearlCampaign.agent_id == agent.id, PearlCampaign.status == "running"
    ).first()
    if running:
        raise HTTPException(409, f"Agent is used by running campaign '{running.name}'. Pause or finish it first.")

    # Detach rows that reference this agent or its calls (foreign keys without ON DELETE).
    call_ids = [cid for (cid,) in db.query(PearlCall.id).filter(PearlCall.agent_id == agent.id).all()]
    if call_ids:
        db.query(PearlCampaignRecipient).filter(PearlCampaignRecipient.call_id.in_(call_ids)).update(
            {PearlCampaignRecipient.call_id: None}, synchronize_session=False
        )
    db.query(PearlCampaign).filter(PearlCampaign.agent_id == agent.id).update(
        {PearlCampaign.agent_id: None}, synchronize_session=False
    )
    for session in db.query(PearlTestSession).filter(PearlTestSession.agent_id == agent.id).all():
        db.delete(session)

    name = agent.name
    db.delete(agent)
    db.commit()
    return {"ok": True, "message": f"Agent '{name}' deleted"}


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
    lead_id: Optional[int] = None
    phone_number: Optional[str] = None
    recipient_name: Optional[str] = None
    agent_id: Optional[str] = None
    objective: Optional[str] = None
    playbook_id: Optional[int] = None
    capsule_id: Optional[int] = None
    call_provider: Optional[str] = None
    voice_provider: Optional[str] = None
    voice_language: Optional[str] = None
    voice_speaker: Optional[str] = None
    voice_pace: Optional[float] = None


def _same_number(raw: Optional[str], normalized: str) -> bool:
    from utils.telephony import normalize_indian_phone_number
    try:
        return normalize_indian_phone_number(raw or "") == normalized
    except ValueError:
        return False


@router.post("/deploy")
async def deploy_pearl_call(
    req: DeployPearlRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """
    Place one outbound Pearl call (dialpad console / "Deploy with code").

    Target: ``lead_id`` (must be one of the caller's leads) and/or ``phone_number``. A
    supplied ``phone_number`` is the number dialled and is saved on the lead, so redialing a
    lead with a corrected number never dials the stale one.

    Agent: ``agent_id`` (one of the caller's saved agents, used as-is and never modified) or,
    when omitted, the caller's implicit console agent, which takes this request's voice_* and
    capsule settings. Saved agents are never overwritten by this endpoint.
    """
    from utils.telephony import normalize_indian_phone_number

    provider = _normalize_provider(req.call_provider)
    requested_phone = (req.phone_number or "").strip()
    if req.lead_id is None and not requested_phone:
        raise HTTPException(400, "Provide lead_id or phone_number")

    lead = None
    if req.lead_id is not None:
        lead = db.query(Lead).filter(Lead.id == req.lead_id, Lead.user_id == user.id).first()
        if not lead:
            raise HTTPException(404, "Lead not found")

    raw_phone = requested_phone or ((lead.phone_number or "").strip() if lead else "")
    if not raw_phone:
        raise HTTPException(400, "Lead has no phone number")
    try:
        normalized_number = normalize_indian_phone_number(raw_phone)
    except ValueError as e:
        raise HTTPException(400, f"Invalid phone number: {e}")

    agent = _get_owned_agent(db, req.agent_id, user) if req.agent_id else None
    capsule = None
    if agent is None and req.capsule_id is not None:
        capsule = db.query(Capsule).filter(Capsule.id == req.capsule_id, Capsule.user_id == user.id).first()
        if not capsule:
            raise HTTPException(404, "Capsule not found or does not belong to you")

    _require_call_balance(db, user)

    missing = _missing_provider_settings(provider)
    if missing:
        raise HTTPException(
            503, f"Telephony provider '{provider}' is not configured on this server (missing {', '.join(missing)})."
        )

    # The dialled number always ends up on the lead (fixes redial-with-corrected-number).
    if lead is None:
        lead = db.query(Lead).filter(Lead.user_id == user.id, Lead.phone_number == normalized_number).first()
        if lead is None:
            lead = Lead(
                user_id=user.id,
                business_name=(req.recipient_name or "").strip() or "Direct Prospect",
                phone_number=normalized_number,
            )
            db.add(lead)
            db.flush()
    elif requested_phone and not _same_number(lead.phone_number, normalized_number):
        lead.phone_number = normalized_number

    if agent is None:
        agent = _get_scratch_agent(db, user, CONSOLE_AGENT_MARKER, "Pearl Execution Engine")
        if capsule is not None:
            agent.capsule_id = capsule.id
        voice_cfg = dict(agent.voice_config or {})
        voice_cfg.update({
            "provider": req.voice_provider or voice_cfg.get("provider") or "Sarvam Bulbul v4-flash",
            "language": req.voice_language or voice_cfg.get("language") or "Auto",
            "speaker": req.voice_speaker or voice_cfg.get("speaker") or "shubh_enhi_ads",
            "pace": req.voice_pace or voice_cfg.get("pace") or 1.0,
        })
        agent.voice_config = voice_cfg
        agent.call_provider = provider

    call = PearlCall(agent_id=agent.id, lead_id=lead.id, provider=provider, status="queued")
    db.add(call)
    db.flush()
    db.add(PearlConversation(call_id=call.id, lead_id=lead.id, objective=req.objective, status="active"))
    db.commit()
    db.refresh(call)

    res = await _dispatch_outbound_call(provider, normalized_number, call.id)
    if not res.get("success"):
        call.status = "failed"
        call.outcome = "failed"
        call.error_code = str(res.get("error") or "Telephony dispatch failed")[:500]
        db.commit()
        raise HTTPException(502, f"Telephony provider failed: {call.error_code}")

    call.provider_call_id = res.get("provider_call_id")
    call.status = "initiating"
    db.commit()

    return {
        "ok": True,
        "call_id": call.id,
        "provider_call_id": call.provider_call_id,
        "status": call.status
    }


MAX_CALLS_PAGE = 100


@router.get("/calls")
def list_my_calls(
    limit: int = 20,
    offset: int = 0,
    agent_id: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """
    The caller's calls across all their agents (incl. the implicit console / draft-dialer
    agents), newest first. ``limit`` 1-100 (default 20), ``offset`` >= 0. Optional filters:
    ``agent_id`` (one of your agents, else 404) and ``status`` (comma-separated statuses).
    """
    limit = max(1, min(int(limit or 20), MAX_CALLS_PAGE))
    offset = max(0, int(offset or 0))
    q = db.query(PearlCall, PearlAgent.name, Lead.business_name).join(
        PearlAgent, PearlCall.agent_id == PearlAgent.id
    ).outerjoin(Lead, PearlCall.lead_id == Lead.id).filter(PearlAgent.user_id == user.id)
    if agent_id:
        _get_owned_agent(db, agent_id, user)
        q = q.filter(PearlCall.agent_id == agent_id)
    statuses = [s.strip().lower() for s in (status or "").split(",") if s.strip()]
    if statuses:
        q = q.filter(PearlCall.status.in_(statuses))
    total = q.count()
    rows = q.order_by(PearlCall.created_at.desc(), PearlCall.id.desc()).offset(offset).limit(limit).all()
    calls = []
    for call, agent_name, lead_name in rows:
        item = call_to_dict(call)
        item["agent_name"] = agent_name
        item["lead_name"] = lead_name
        calls.append(item)
    return {
        "calls": calls,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(calls) < total,
    }


@router.get("/calls/{call_id}")
def get_call_status(
    call_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    call = _get_owned_call(db, call_id, user)
    return {
        "id": call.id,
        "status": call.status,
        "duration_seconds": call.duration_seconds,
        "outcome": call.outcome,
        "provider_call_id": call.provider_call_id,
        "error_code": call.error_code
    }


# Live carrier audio sockets by call id (so cancel can end the AI side of a call).
_carrier_sockets: Dict[str, Any] = {}


async def _hangup_carrier_call(call_id: str, provider: Optional[str], provider_call_id: Optional[str]) -> None:
    """Best effort: stop the AI audio stream and ask the carrier to hang up."""
    ws = _carrier_sockets.get(call_id)
    if ws is not None:
        try:
            await ws.close(code=1000)
        except Exception:
            pass
    if (provider or "").lower() == "vobiz" and provider_call_id and not str(provider_call_id).startswith("sim-") \
            and os.getenv("VOBIZ_AUTH_ID") and os.getenv("VOBIZ_AUTH_SECRET"):
        try:
            from services.pearl.providers import vobiz_provider
            await vobiz_provider.VobizTelephonyProvider().hangup_call(provider_call_id)
        except Exception as exc:
            logger.warning("Carrier hangup for call %s failed: %s", call_id[:8], exc)


@router.post("/calls/{call_id}/cancel")
async def cancel_call(
    call_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    call = _get_owned_call(db, call_id, user)

    if call.status in TERMINAL_CALL_STATUSES or call.status == "rejected":
        raise HTTPException(400, "Call is already finished")

    call.status = "cancelled"
    call.outcome = call.outcome or "cancelled"
    rec = db.query(PearlCampaignRecipient).filter(PearlCampaignRecipient.call_id == call.id).first()
    if rec and rec.status in ("calling", "queued"):
        rec.status = "failed"
        rec.outcome = "cancelled"
        rec.error_reason = "Cancelled by user"
        rec.next_attempt_at = None  # a cancelled call is never retried
    provider, provider_call_id = call.provider, call.provider_call_id
    db.commit()

    await _hangup_carrier_call(call_id, provider, provider_call_id)
    return {"ok": True, "status": "cancelled"}



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
    limit = max(1, min(int(limit or 50), 200))
    offset = max(0, int(offset or 0))

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


@router.post("/agents/{agent_id}/calls")
async def trigger_agent_outbound_call(
    agent_id: str,
    req: AgentOutboundCallRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """
    Direct outbound cold call dialer endpoint for Sage and testing workflows.
    ``agent_id`` is one of the caller's agents, or ``draft`` for unsaved editor state
    (``agent_snapshot``), which runs on the caller's implicit draft-dialer agent - a saved
    agent is never modified here.
    """
    from utils.telephony import normalize_indian_phone_number

    try:
        normalized_phone = normalize_indian_phone_number(req.phone_number)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    provider_name = _normalize_provider(req.call_provider)

    if agent_id and agent_id != "draft":
        agent = _get_owned_agent(db, agent_id, user)
    else:
        snap = req.agent_snapshot or {}
        agent = _get_scratch_agent(db, user, DRAFT_DIALER_AGENT_MARKER, str(snap.get("name") or "Draft Agent"))
        if snap.get("name"):
            agent.name = str(snap["name"])[:200]
        if "system_prompt" in snap:
            agent.system_prompt = snap.get("system_prompt")
        if "greeting" in snap:
            agent.greeting = snap.get("greeting")
        if isinstance(snap.get("voice_config"), dict):
            agent.voice_config = snap["voice_config"]
        if snap.get("role"):
            agent.role = str(snap["role"])

    _require_call_balance(db, user)

    call = PearlCall(agent_id=agent.id, provider=provider_name, status="queued")
    db.add(call)
    db.commit()
    db.refresh(call)

    if _missing_provider_settings(provider_name):
        # Development / simulation mode: no telephony credentials on this server.
        dispatch_res = {"success": True, "provider_call_id": f"sim-{call.id[:8]}", "simulated": True}
    else:
        dispatch_res = await _dispatch_outbound_call(provider_name, normalized_phone, call.id)

    if dispatch_res.get("success"):
        simulated = bool(dispatch_res.get("simulated"))
        call.provider_call_id = dispatch_res.get("provider_call_id")
        call.status = "initiating"
        db.commit()
        return {
            "ok": True,
            "call_id": call.id,
            "provider_call_id": call.provider_call_id,
            "status": call.status,
            "phone_number": normalized_phone,
            "recipient_name": req.recipient_name,
            "provider": call.provider,
            # True when this server has no telephony credentials / PEARL_PUBLIC_URL: nothing
            # was dialled (provider_call_id starts with "sim-").
            "simulated": simulated,
            "message": (
                f"Simulated cold call: {call.provider} is not configured on this server, so no real call was placed."
                if simulated else f"Cold call initiated to {normalized_phone} via {call.provider}"
            ),
        }

    call.status = "failed"
    call.outcome = "failed"
    call.error_code = str(dispatch_res.get("error") or "Telephony dispatch error")[:500]
    db.commit()
    raise HTTPException(
        status_code=502,
        detail=f"Telephony dispatch failed: {call.error_code}"
    )


# ── SSE Live Activity Stream ─────────────────────────────────────────────────

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
    _get_owned_agent(db, agent_id, user)
    from database import SessionLocal

    def _poll(since):
        # A fresh short-lived session per poll: the request session must not stay open
        # (holding a pooled connection / read transaction) for the life of the stream.
        with SessionLocal() as s:
            q = s.query(PearlEvent).filter(PearlEvent.agent_id == agent_id)
            if since is None:
                rows = q.order_by(PearlEvent.timestamp.desc()).limit(1).all()
            else:
                rows = q.filter(PearlEvent.timestamp >= since).order_by(PearlEvent.timestamp.asc()).limit(100).all()
            return [(e.id, e.timestamp, event_to_dict(e)) for e in rows]

    async def event_generator():
        last_ts = None
        seen: set = set()
        while True:
            for event_id, ts, payload in _poll(last_ts):
                if event_id in seen:
                    continue
                if last_ts is None or (ts and ts > last_ts):
                    seen = set()
                    last_ts = ts
                seen.add(event_id)
                yield f"data: {json.dumps(payload)}\n\n"
            if last_ts is None:
                last_ts = datetime.utcnow()
            await asyncio.sleep(2)  # Poll every 2 seconds

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


# ── Call WebSockets & Webhooks ───────────────────────────────────────────────

from fastapi import WebSocket, WebSocketDisconnect



_ui_connections: dict[str, list[WebSocket]] = {}
_ui_send_tasks: set = set()


def _ui_send_done(task: asyncio.Task) -> None:
    _ui_send_tasks.discard(task)
    if not task.cancelled():
        task.exception()  # retrieve, so a closed UI socket doesn't log "never retrieved"


def _broadcast_to_ui(call_id: str, msg: dict):
    for ws in list(_ui_connections.get(call_id, ())):
        try:
            task = asyncio.create_task(ws.send_json(msg))
        except RuntimeError:
            return  # no running event loop
        _ui_send_tasks.add(task)
        task.add_done_callback(_ui_send_done)


@router.websocket("/calls/{call_id}/stream")
async def call_websocket_endpoint(websocket: WebSocket, call_id: str, db: Session = Depends(get_db)):
    """Live status of one of the caller's calls. Auth: ``?token=<JWT>``; other users' calls are refused (1008)."""
    token = _ws_token(websocket)
    user = verify_token_string(token, db) if token else None
    call = db.query(PearlCall).join(PearlAgent, PearlCall.agent_id == PearlAgent.id).filter(
        PearlCall.id == call_id,
        PearlAgent.user_id == user.id
    ).first() if user else None
    db.close()  # don't hold the request session for the life of the socket

    if not call:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    _ui_connections.setdefault(call_id, []).append(websocket)
    from database import SessionLocal

    try:
        while True:
            with SessionLocal() as s:
                row = s.query(PearlCall.status, PearlCall.outcome, PearlCall.duration_seconds).filter(
                    PearlCall.id == call_id
                ).first()
            if row is None:
                break
            status, outcome, duration = row
            await websocket.send_json({"type": "call.status", "data": {"status": status, "outcome": outcome, "duration": duration}})
            if status in TERMINAL_CALL_STATUSES:
                break  # final status delivered; nothing more will change
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug("Call status socket for %s ended: %s", call_id[:8], e)
    finally:
        conns = _ui_connections.get(call_id)
        if conns is not None:
            if websocket in conns:
                conns.remove(websocket)
            if not conns:
                _ui_connections.pop(call_id, None)
        try:
            await websocket.close()
        except Exception:
            pass



import base64

import time

import re

from services.pearl.conversation_engine import ConversationEngine


from services.gemini_stream import GeminiStream

from services.vad_engine import SileroVADEngine, VADEvent

from services.turn_detector import TurnDetector

from services.latency_tracker import LatencyTracker



from services.pearl.providers.tts import get_tts_provider

from services.pearl.phrase_chunker import PhraseChunker

from services.bridge.audio import FrameDecoder, parse_media_format

# How long to wait for Vobiz's ``start`` frame (it carries the streamId every
# playAudio/clearAudio/checkpoint must name, and the inbound mediaFormat) before the
# greeting is spoken. Vobiz sends it right after the socket opens.
VOBIZ_START_TIMEOUT_SECONDS = 3.0



# Sentence boundary regex for TTS chunking (primary: .!?।, secondary: ,—;)

_SENTENCE_END_RE = re.compile(r'[.!?\u0964,—;]\s*$')



# Agent setting ``maxCallLength`` (minutes; both editors store it in voice_config.settings).
MAX_CALL_LENGTH_MINUTES_MIN = 1.0
MAX_CALL_LENGTH_MINUTES_MAX = 240.0
DEFAULT_TIME_LIMIT_GOODBYE = "Thank you so much for your time today. I'll let you go now. Have a great day!"


def _agent_settings(voice_cfg: Any) -> dict:
    settings = voice_cfg.get("settings") if isinstance(voice_cfg, dict) else None
    return settings if isinstance(settings, dict) else {}


def _max_call_seconds(voice_cfg: Any) -> Optional[float]:
    """The agent's max call length in seconds (``settings.maxCallLength`` minutes, clamped to
    1-240); None when it isn't set or isn't a positive number (no limit, as before)."""
    raw = _agent_settings(voice_cfg).get("maxCallLength")
    if raw is None or isinstance(raw, bool):
        return None
    try:
        minutes = float(raw)
    except (TypeError, ValueError):
        return None
    if minutes != minutes or minutes in (float("inf"), float("-inf")) or minutes <= 0:
        return None
    return min(max(minutes, MAX_CALL_LENGTH_MINUTES_MIN), MAX_CALL_LENGTH_MINUTES_MAX) * 60.0


def _time_limit_goodbye(voice_cfg: Any) -> str:
    phrase = _agent_settings(voice_cfg).get("disconnectPhrase")
    return phrase.strip() if isinstance(phrase, str) and phrase.strip() else DEFAULT_TIME_LIMIT_GOODBYE


def _log_call_event(agent_id: Optional[str], call_id: str, event_type: str, summary: str, payload: dict) -> None:
    """Append an agent timeline event from a worker thread (own DB session, best effort)."""
    if not agent_id:
        return
    from database import SessionLocal
    try:
        with SessionLocal() as s:
            EventLogger(s, agent_id).log(event_type, summary, payload, call_id=call_id)
    except Exception as exc:
        logger.debug("Could not log %s for call %s: %s", event_type, call_id[:8], exc)


@router.websocket("/calls/{call_id}/audio")

async def call_audio_stream(websocket: WebSocket, call_id: str, db: Session = Depends(get_db)):
    """
    Carrier (Vobiz / Exotel) bidirectional media WebSocket - realtime pipeline.

    Auth: the carrier connects with ``?token=<carrier_token(call_id)>`` - the URL we handed it
    when the call was dispatched. Unknown calls, bad tokens and finished calls are refused (1008).
    """
    call = db.query(PearlCall).filter(PearlCall.id == call_id).first()
    if not call or not verify_carrier_token(call_id, websocket.query_params.get("token")) \
            or call.status in TERMINAL_CALL_STATUSES:
        logger.warning("[Pearl WebSocket] Refused carrier audio socket for call %s", call_id[:8])
        db.close()
        await websocket.close(code=1008)
        return

    await websocket.accept()
    logger.debug("[Pearl WebSocket] Carrier audio connected for call %s", call_id[:8])

    packets_received = 0

    packets_sent = 0



    # ── Pre-call warmup: initialize everything BEFORE prospect audio arrives ──

    conversation_id = call.conversation.id if call.conversation else None

    

    agent = db.query(PearlAgent).filter(PearlAgent.id == call.agent_id).first()

    capsule_text = format_capsule_context(agent.capsule) if (agent and agent.capsule) else "No specific product context provided." 



    is_vobiz = (call.provider or "").lower() == "vobiz"
    prospect_name = "there"

    if call.lead and call.lead.business_name:
        prospect_name = call.lead.business_name
    else:
        rec = db.query(PearlCampaignRecipient).filter(PearlCampaignRecipient.call_id == call_id).first()
        if rec and (rec.name or rec.business_name):
            prospect_name = rec.name or rec.business_name



    # Retrieve TTS & Voice Persona settings from Agent config or fallback
    voice_cfg = agent.voice_config or {} if agent else {}
    speaker = voice_cfg.get("speaker", "shubh_enhi_ads")
    lang = voice_cfg.get("language", "Auto")
    pace = float(voice_cfg.get("pace", 1.0))
    temperature = 0.6
    agent_display_name = (agent.name if (agent and agent.name) else "Pearl").strip()
    call_provider, provider_call_id, call_agent_id = call.provider, call.provider_call_id, call.agent_id
    max_call_seconds = _max_call_seconds(voice_cfg)

    # All DB reads are done: release the request session for the rest of the call (it
    # would otherwise pin a pooled connection) and record that the call audio is live.
    db.close()
    _mark_call_active(call_id)
    _carrier_sockets[call_id] = websocket
    audio_connected_at = time.monotonic()
    _ending = False          # the call is being ended at the agent's max call length
    limit_task: Optional[asyncio.Task] = None

    engine = ConversationEngine(
        objective=call.conversation.objective if (call.conversation and call.conversation.objective) else (agent.mission if agent and agent.mission else "Qualify and book a meeting"),
        lead_context={"business_name": prospect_name, "capsule_context": capsule_text, "agent_name": agent_display_name, "voice_config": voice_cfg, "speaker": speaker},
        system_prompt_override=agent.system_prompt if agent and agent.system_prompt and agent.system_prompt.strip() else None,
        agent_name=agent_display_name,
        speaker=speaker,
        voice_config=voice_cfg
    )

    # Initialize stateful TTS Provider (Sarvam default, ElevenLabs fallback)
    tts = get_tts_provider()

    tracker = LatencyTracker()
    _bg_tasks: list[asyncio.Task] = []

    # Connect and configure TTS before audio arrives
    try:
        connect_start = time.monotonic()
        await tts.connect()

        

        # Map frontend "Auto" or language selections to Sarvam codes

        lang_code = lang if lang not in ["Auto", None, ""] else None

        

        await tts.configure(language_code=lang_code, speaker=speaker, pace=pace, temperature=temperature)

        logger.debug(f"  [METRIC] TTS connection ready: {(time.monotonic() - connect_start)*1000:.0f}ms")

    except Exception as e:

        logger.warning("[Pearl] TTS provider init failed for call %s: %s", call_id[:8], e)
        # get_tts_provider() already fails over between configured providers; only try a
        # fresh ElevenLabs session here if it is configured and wasn't the one that failed.
        from services.pearl.providers.tts import ElevenLabsTTSProvider as FBProvider
        from services.pearl.providers.elevenlabs_provider import elevenlabs_configured
        if elevenlabs_configured() and not isinstance(tts, FBProvider):
            tts = FBProvider()
            try:
                await tts.connect()
                await tts.configure(language_code="en", speaker="default", pace=1.0, temperature=0.6)
            except Exception as fb_exc:
                logger.warning("[Pearl] ElevenLabs fallback init failed for call %s: %s", call_id[:8], fb_exc)



    # State tracking for clean orchestration

    pearl_state = "CALL_CONNECTED"

    def set_state(new_state):

        nonlocal pearl_state

        pearl_state = new_state

        logger.debug(f"[PEARL STATE] {pearl_state}")



    # Barge-in control
    _speaking = False
    _first_audio_sent_at = 0.0
    _tts_cancel = asyncio.Event()
    _generation_id = 0
    stream_sid = None
    # Vobiz inbound audio: L16/8 kHz is requested in the answer XML, but the ``start``
    # frame's mediaFormat is authoritative (μ-law/8k and L16/16k are decoded too).
    vobiz_decoder = FrameDecoder("audio/x-l16", 8000) if is_vobiz else None

    def _on_carrier_start(data: dict) -> None:
        nonlocal stream_sid
        start_meta = data.get("start") if isinstance(data.get("start"), dict) else {}
        stream_sid = start_meta.get("streamId") or start_meta.get("stream_sid") or data.get("streamId") \
            or data.get("stream_sid") or stream_sid
        if vobiz_decoder is not None:
            encoding, rate = parse_media_format(start_meta.get("mediaFormat"))
            if encoding or rate:
                vobiz_decoder.configure(encoding, rate)

    async def trigger_barge_in(source: str):
        nonlocal _speaking, _first_audio_sent_at, _generation_id
        if not _speaking or _ending:
            return  # the time-limit goodbye is never cut off
        logger.debug(f"  [BARGE-IN] Interruption triggered via {source} -> cancelling TTS immediately")
        _tts_cancel.set()
        _generation_id += 1
        _speaking = False
        _first_audio_sent_at = 0.0
        vad.set_agent_speaking(False)
        set_state("LISTENING")
        asyncio.create_task(tts.cancel())
        if stream_sid:
            try:
                if is_vobiz:
                    asyncio.create_task(websocket.send_json({"event": "clearAudio", "streamId": stream_sid}))
                else:
                    asyncio.create_task(websocket.send_json({"event": "clear", "stream_sid": stream_sid, "streamSid": stream_sid}))
            except Exception:
                pass
        turn_detector.on_speech_start()

    # Telephony audio frame parameters: 8kHz 16-bit mono = 16,000 bytes/sec
    # Exotel requires frames >= 3,200 bytes (~200ms) aligned to 320 bytes.
    # Vobiz accepts 3,200 bytes (~200ms) audio/x-l16.
    FRAME_BYTES = 3200
    FRAME_DURATION = 0.200

    async def _send_telephony_frame(frame: bytes):
        nonlocal packets_sent
        if is_vobiz and vobiz_decoder is not None and vobiz_decoder.byte_order == "big":
            # The account carries L16 in network byte order: answer in the same order.
            import numpy as np
            frame = np.frombuffer(frame[: len(frame) // 2 * 2], dtype="<i2").astype(">i2").tobytes()
        encoded = base64.b64encode(frame).decode("utf-8")
        if is_vobiz:
            out_msg = {
                "event": "playAudio",
                "streamId": stream_sid,
                "media": {
                    "contentType": "audio/x-l16",
                    "sampleRate": 8000,
                    "payload": encoded
                }
            }
        else:
            out_msg = {
                "event": "media",
                "media": {"payload": encoded}
            }
            if stream_sid:
                out_msg["stream_sid"] = stream_sid
                out_msg["streamSid"] = stream_sid
        await websocket.send_json(out_msg)
        packets_sent += 1
        if packets_sent == 1:
            logger.debug("[Exotel/Vobiz WS] First outbound audio packet sent")
        elif packets_sent % 100 == 0:
            logger.debug(f"[Exotel/Vobiz WS] Sent {packets_sent} outbound audio frames so far.")

    # Continuous background task to receive TTS audio and pace frames to carrier
    async def _tts_receive_loop():
        nonlocal packets_sent, _speaking, _first_audio_sent_at
        pcm_accumulator = b""
        next_send_time = None
        lead_budget = 0.250  # 250ms lead buffer on carrier to prevent starvation without buffer bloat

        while True:
            try:
                audio_iter = tts.receive_audio().__aiter__()
                while True:
                    try:
                        timeout = 1.0 if (_speaking and getattr(tts, '_llm_finished', False)) else None
                        if timeout:
                            audio_chunk = await asyncio.wait_for(audio_iter.__anext__(), timeout=timeout)
                        else:
                            audio_chunk = await audio_iter.__anext__()
                    except asyncio.TimeoutError:
                        if _speaking:
                            logger.debug("[TTS] Idle timeout reached. Assuming turn is complete.")
                            _speaking = False
                            _first_audio_sent_at = 0.0
                            pcm_accumulator = b""
                            next_send_time = None
                            vad.set_agent_speaking(False)
                            set_state("LISTENING")
                        continue
                    except StopAsyncIteration:
                        if _speaking:
                            logger.debug("[TTS] Stream iter ended. Re-attaching...")
                        await asyncio.sleep(0.02)
                        break

                    if audio_chunk == b"__FLUSH_COMPLETE__":
                        # Flush any remaining audio in accumulator before completing turn
                        if len(pcm_accumulator) > 0 and not _tts_cancel.is_set():
                            # Pad to multiple of 320 bytes and at least 3200 bytes for Exotel
                            pad_target = max(FRAME_BYTES, ((len(pcm_accumulator) + 319) // 320) * 320)
                            final_frame = pcm_accumulator + (b"\x00" * (pad_target - len(pcm_accumulator)))
                            try:
                                await _send_telephony_frame(final_frame)
                            except Exception:
                                pass
                        pcm_accumulator = b""
                        next_send_time = None
                        _speaking = False
                        _first_audio_sent_at = 0.0
                        vad.set_agent_speaking(False)
                        set_state("LISTENING")
                        continue

                    if _tts_cancel.is_set():
                        pcm_accumulator = b""
                        next_send_time = None
                        if _speaking:
                            _speaking = False
                            _first_audio_sent_at = 0.0
                            vad.set_agent_speaking(False)
                            set_state("LISTENING")
                        continue

                    pcm_accumulator += audio_chunk

                    while len(pcm_accumulator) >= FRAME_BYTES:
                        if _tts_cancel.is_set():
                            pcm_accumulator = b""
                            break

                        frame = pcm_accumulator[:FRAME_BYTES]
                        pcm_accumulator = pcm_accumulator[FRAME_BYTES:]

                        # Pacing: schedule frame delivery
                        now = time.monotonic()
                        if next_send_time is None:
                            # First frame sent immediately
                            _speaking = True
                            _first_audio_sent_at = now
                            tracker.on_tts_first_audio()
                            vad.set_agent_speaking(True)
                            if pearl_state == "SPEAKING" and not packets_sent:
                                set_state("OPENING_AUDIO_STARTED")
                            elif pearl_state == "SPEAKING":
                                set_state("RESPONSE_TTS_STARTED")
                            next_send_time = now + FRAME_DURATION
                        else:
                            # Paced subsequent frames
                            delay = (next_send_time - lead_budget) - now
                            if delay > 0:
                                try:
                                    await asyncio.wait_for(_tts_cancel.wait(), timeout=delay)
                                    # Interrupted during wait!
                                    pcm_accumulator = b""
                                    break
                                except asyncio.TimeoutError:
                                    pass
                            next_send_time = max(next_send_time + FRAME_DURATION, time.monotonic() + FRAME_DURATION)

                        await _send_telephony_frame(frame)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"[Pearl WebSocket] TTS stream receive loop error: {e}")
                await asyncio.sleep(0.1)

    tts_loop_task = asyncio.create_task(_tts_receive_loop())



    # ── Turn-complete callback: LLM → TTS → Exotel (critical path) ──

    async def on_turn_complete(prospect_text: str):

        nonlocal _speaking

        if not prospect_text.strip() or _ending:

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

                logger.debug(f"[Pearl BG] Persist error: {e}")



        _bg_tasks.append(asyncio.create_task(_persist_prospect()))



        # ── Critical path: LLM stream → PhraseChunker → TTS ──

        nonlocal _generation_id

        _generation_id += 1

        current_gen = _generation_id



        set_state("PROCESSING")
        _speaking = False
        _first_audio_sent_at = 0.0
        vad.set_agent_speaking(False)
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

                    logger.debug(f"  [METRIC] LLM first token: {(llm_first_token - llm_start)*1000:.0f}ms")

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

            logger.debug(f"[Pearl] LLM error: {e}")

            if not full_response.strip():

                logger.debug("[Pearl] LLM failed to generate response. Using fallback.")

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

                logger.debug(f"[Pearl BG] Agent persist error: {e}")



        _bg_tasks.append(asyncio.create_task(_persist_agent()))



    # ── VAD + STT setup ──

    vad = SileroVADEngine()

    await vad.initialize()



    turn_detector = TurnDetector(on_turn_complete=on_turn_complete, tracker=tracker)



    async def transcript_callback(speaker, text, is_final=True, speech_final=False):
        if not text or not text.strip():
            if speech_final:
                turn_detector.on_speech_final()
            return

        # If agent was speaking and user speaks, trigger immediate barge-in!
        if _speaking:
            await trigger_barge_in("STT transcript")

        tracker.on_transcript_received()
        turn_detector.on_transcript(text, is_final=is_final)

        if is_final:
            _broadcast_to_ui(call_id, {"type": "transcript", "data": {"speaker": "prospect", "text": text}})

        if speech_final:
            turn_detector.on_speech_final()



    stt = GeminiStream(transcript_callback=transcript_callback)

    stt_connected = await stt.connect()

    if not stt_connected:

        logger.warning("[Pearl] STT connection failed for call %s, closing audio WS", call_id[:8])
        tts_loop_task.cancel()
        _carrier_sockets.pop(call_id, None)
        try:
            await tts.close()
        except Exception:
            pass
        await websocket.close()

        return

        

    if is_vobiz and stream_sid is None:
        # Every playAudio must carry the streamId from Vobiz's ``start`` frame, so read
        # it before the greeting is spoken (bounded: the greeting goes out regardless).
        await _await_vobiz_start(websocket, _on_carrier_start, VOBIZ_START_TIMEOUT_SECONDS)
        if stream_sid is None:
            logger.warning("[Pearl WebSocket] No Vobiz start frame for call %s yet", call_id[:8])

    # Check for user-configured custom greeting override first
    custom_greeting = agent.greeting if (agent and agent.greeting and agent.greeting.strip()) else None

    set_state("GENERATING_OPENING")
    _generation_id += 1
    opening_gen = _generation_id
    _speaking = False
    _first_audio_sent_at = 0.0
    vad.set_agent_speaking(False)
    _tts_cancel.clear()
    tts._llm_finished = False

    if hasattr(tts, 'reset_buffer'):
        tts.reset_buffer()

    full_response = ""
    llm_error = False

    if custom_greeting:
        logger.debug(f"[Pearl] Using configured custom greeting for {agent_display_name}")
        rendered_greet = custom_greeting
        for k, v in {"prospect_name": prospect_name, "name": prospect_name, "company": prospect_name, "business_name": prospect_name, "agent_name": agent_display_name}.items():
            rendered_greet = rendered_greet.replace(f"{{{{{k}}}}}", str(v))
        full_response = rendered_greet
        set_state("OPENING_GENERATED")
        set_state("SPEAKING")
        await tts.send_text(full_response)
        await tts.flush()
    else:
        # Generate dynamic pattern interrupt opening via LLM as agent_display_name
        logger.debug("[Pearl] Generating dynamic opening for call %s", call_id[:8])
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
            logger.debug(f"[Pearl] LLM init error: {e}")
            llm_error = True

        if llm_error or not full_response.strip():
            logger.debug("[Pearl] Initial LLM generation failed or empty. Using safe fallback.")
            set_state("OPENING_GENERATED")
            set_state("SPEAKING")
            full_response = f"Hi, main {agent_display_name} bol rahi hoon. Ek quick sawal tha aapke business ke regarding."
            await tts.send_text(full_response)
            await tts.flush()



    tts._llm_finished = True

    if full_response.strip():

        engine.add_turn("agent", full_response.strip())

        _broadcast_to_ui(call_id, {"type": "transcript", "data": {"speaker": "agent", "text": full_response.strip()}})

    # ── Max call length: say goodbye and hang up cleanly at the agent's limit ──
    async def _end_call_at_limit(limit_seconds: float):
        nonlocal _ending, _speaking, _first_audio_sent_at, _generation_id
        remaining = limit_seconds - (time.monotonic() - audio_connected_at)
        if remaining > 0:
            await asyncio.sleep(remaining)
        _ending = True  # no new turns, no barge-in from here on
        logger.info("[Pearl] Call %s reached its max call length (%.0f min); ending it", call_id[:8], limit_seconds / 60)

        # Stop whatever the agent is saying or generating, then speak the goodbye.
        _tts_cancel.set()
        _generation_id += 1
        try:
            await tts.cancel()
        except Exception:
            pass
        if stream_sid:
            try:
                if is_vobiz:
                    await websocket.send_json({"event": "clearAudio", "streamId": stream_sid})
                else:
                    await websocket.send_json({"event": "clear", "stream_sid": stream_sid, "streamSid": stream_sid})
            except Exception:
                pass
        _speaking = False
        _first_audio_sent_at = 0.0
        vad.set_agent_speaking(False)

        goodbye = _time_limit_goodbye(voice_cfg)
        _tts_cancel.clear()
        if hasattr(tts, "reset_buffer"):
            tts.reset_buffer()
        tts._llm_finished = False
        set_state("SPEAKING")
        frames_before = packets_sent
        try:
            await tts.send_text(goodbye)
            await tts.flush()
        except Exception as exc:
            logger.debug("[Pearl] Time-limit goodbye TTS failed for call %s: %s", call_id[:8], exc)
        tts._llm_finished = True
        engine.add_turn("agent", goodbye)
        _broadcast_to_ui(call_id, {"type": "transcript", "data": {"speaker": "agent", "text": goodbye}})

        def _persist_goodbye():
            if not conversation_id:
                return
            from database import SessionLocal
            try:
                with SessionLocal() as s:
                    s.add(PearlMessage(conversation_id=conversation_id, speaker="agent", text=goodbye))
                    s.commit()
            except Exception as exc:
                logger.debug("[Pearl BG] Goodbye persist error: %s", exc)

        _bg_tasks.append(asyncio.create_task(asyncio.to_thread(_persist_goodbye)))

        # Let the goodbye play out (bounded: a dead TTS must not keep the line open).
        started = time.monotonic()
        while packets_sent == frames_before and time.monotonic() - started < 4.0:
            await asyncio.sleep(0.05)
        started = time.monotonic()
        while _speaking and time.monotonic() - started < 15.0:
            await asyncio.sleep(0.05)
        await asyncio.sleep(0.6)  # the carrier plays ~250 ms of buffered audio after the last frame

        minutes = round(limit_seconds / 60, 2)
        await asyncio.to_thread(
            _log_call_event, call_agent_id, call_id, "call_max_length_reached",
            f"Call ended at the {minutes:g}-minute max call length", {"max_call_minutes": minutes},
        )
        await _hangup_carrier_call(call_id, call_provider, provider_call_id)

    async def _call_time_limit(limit_seconds: float):
        try:
            await _end_call_at_limit(limit_seconds)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("[Pearl] Max call length handling failed for call %s: %s", call_id[:8], exc)
            await _hangup_carrier_call(call_id, call_provider, provider_call_id)

    if max_call_seconds:
        limit_task = asyncio.create_task(_call_time_limit(max_call_seconds))

    # ── Main audio receive loop ──

    try:

        resample_state = None

        while True:

            raw = await websocket.receive_text()

            data = json.loads(raw)



            event_type = data.get("event")

            if event_type == "start":
                # Also a Vobiz reconnect (maxRetries): a new streamId for the same call.
                _on_carrier_start(data)

                logger.debug("[Pearl WebSocket] Audio stream started for call %s", call_id[:8])



            elif event_type == "media":

                payload = data.get("media", {}).get("payload", "")

                if not payload:

                    continue



                packets_received += 1

                if packets_received == 1:

                    logger.debug(f"[Pearl WebSocket] First audio packet received from Exotel.")

                elif packets_received % 1000 == 0:

                    logger.debug(f"[Pearl WebSocket] Received {packets_received} audio packets so far.")



                if vobiz_decoder is not None:
                    # Decoded per start.mediaFormat (L16 8k/16k or μ-law 8k) → 16 kHz.
                    audio_bytes, resample_state = _decode_vobiz_inbound(vobiz_decoder, payload, resample_state)
                    if not audio_bytes:
                        continue
                else:
                    audio_bytes_8k = base64.b64decode(payload)
                    # Resample 8kHz Exotel audio to 16kHz for Gemini and Silero VAD
                    audio_bytes, resample_state = _upsample_8k_to_16k(audio_bytes_8k, resample_state)

                # Note: This tracks prospect audio received for VAD
                tracker.on_audio_sent()



                # Forward to STT (non-blocking) so Gemini connection doesn't time out (1008 error)

                await stt.send_audio(audio_bytes)



                # VAD processing (< 1ms per chunk)
                vad_events = vad.process_chunk(audio_bytes)
                now = time.monotonic()
                for ev in vad_events:
                    if ev == VADEvent.SPEECH_START:
                        if not _speaking:
                            set_state("PROSPECT_SPEECH_STARTED")
                            turn_detector.on_speech_start()
                        elif _first_audio_sent_at > 0 and (now - _first_audio_sent_at > 0.20):
                            await trigger_barge_in("VAD SPEECH_START")
                    elif ev == VADEvent.SPEECH_END:
                        if not _speaking:
                            set_state("PROSPECT_SPEECH_ENDED")
                            turn_detector.on_speech_end()

                # Sustained speech check: triggers barge-in even if user spoke during initial 200ms
                if _speaking and vad.is_speaking and _first_audio_sent_at > 0 and (now - _first_audio_sent_at > 0.20):
                    await trigger_barge_in("VAD sustained speech")



            elif event_type == "stop":

                logger.debug(f"[Pearl WebSocket] Exotel sent 'stop' event. Ending stream.")

                break



    except WebSocketDisconnect:

        logger.debug(f"[Pearl WebSocket] Disconnected by client (Exotel).")

    except Exception as e:

        logger.debug(f"[Pearl WebSocket] Audio WS error: {e}")

    finally:
        logger.debug("[Pearl WebSocket] Call %s audio closed (packets in=%d, out=%d)", call_id[:8], packets_received, packets_sent)
        if limit_task is not None and not limit_task.done():
            if _ending:
                # Closing the socket is part of the time-limit hang-up: let the carrier
                # hang-up request that follows it finish (bounded).
                await asyncio.wait({limit_task}, timeout=8.0)
            if not limit_task.done():
                limit_task.cancel()
        if _carrier_sockets.get(call_id) is websocket:
            _carrier_sockets.pop(call_id, None)
        turn_detector.cleanup()
        tts_loop_task.cancel()
        try:
            await stt.close()
        except Exception:
            pass
        # Let in-flight persistence finish (bounded), then release the TTS socket.
        pending = [t for t in _bg_tasks if not t.done()]
        if pending:
            await asyncio.wait(pending, timeout=5.0)
        try:
            await asyncio.wait_for(asyncio.gather(tts_loop_task, return_exceptions=True), timeout=2.0)
        except Exception:
            pass
        try:
            await tts.close()
        except Exception:
            pass
        try:
            await websocket.close()
        except Exception:
            pass


def _mark_call_active(call_id: str) -> None:
    """The carrier connected the call audio: move the call forward to ``active``."""
    from database import SessionLocal
    try:
        with SessionLocal() as s:
            call = s.query(PearlCall).filter(PearlCall.id == call_id).first()
            if call and call.ended_at is None and advances(call.status, "active"):
                now = datetime.utcnow()
                call.status = "active"
                call.answered_at = call.answered_at or now
                call.started_at = call.started_at or now
                s.commit()
    except Exception as exc:
        logger.warning("Could not mark call %s active: %s", call_id[:8], exc)


try:
    import audioop as _audioop  # removed in Python 3.13; production image runs 3.11
except ImportError:  # pragma: no cover - depends on interpreter
    _audioop = None


async def _await_vobiz_start(websocket, on_start, timeout: float) -> bool:
    """Reads the carrier socket until Vobiz's ``start`` frame (``on_start(data)``) or
    ``timeout``. Frames before it carry no usable audio context and are dropped.
    False on timeout or a closed socket (the main receive loop then sees the close)."""
    deadline = time.monotonic() + max(0.0, timeout)
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=remaining)
        except asyncio.TimeoutError:
            return False
        except Exception:
            return False
        try:
            data = json.loads(raw)
        except ValueError:
            continue
        if isinstance(data, dict) and data.get("event") == "start":
            on_start(data)
            return True


def _decode_vobiz_inbound(decoder: "FrameDecoder", payload, state):
    """Vobiz ``media.payload`` → (PCM16LE at 16 kHz, resample state), per the stream's
    reported format. (None, state) for an empty or malformed payload."""
    pcm = decoder.decode_native(payload)
    if pcm is None:
        return None, state
    if decoder.sample_rate == 8000:
        return _upsample_8k_to_16k(pcm, state)
    return pcm, state


def _upsample_8k_to_16k(pcm: bytes, state):
    """8 kHz -> 16 kHz PCM16 mono for STT/VAD (audioop.ratecv, or a linear-interpolation fallback)."""
    if _audioop is not None:
        return _audioop.ratecv(pcm, 2, 1, 8000, 16000, state)
    import numpy as np
    samples = np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype="<i2").astype(np.float32)
    if samples.size == 0:
        return b"", state
    prev = samples[0] if state is None else float(state)
    shifted = np.concatenate(([prev], samples[:-1]))
    out = np.empty(samples.size * 2, dtype=np.float32)
    out[0::2] = (shifted + samples) / 2.0
    out[1::2] = samples
    return out.astype("<i2").tobytes(), float(samples[-1])









from fastapi import Request



async def _read_carrier_payload(request: Request) -> Dict[str, Any]:
    """Carrier callback fields from a JSON or form body, plus query parameters."""
    payload: Dict[str, Any] = {}
    if request.method != "GET":
        content_type = request.headers.get("content-type", "")
        try:
            if "json" in content_type:
                body = await request.json()
                if isinstance(body, dict):
                    payload.update(body)
            else:
                form = await request.form()
                payload.update({k: v for k, v in form.items()})
        except Exception:
            pass
    for key, value in request.query_params.items():
        payload.setdefault(key, value)
    return payload


def _bill_finished_call(db: Session, call: PearlCall) -> None:
    """Charge the call owner once for a finished call (guarded by revenue_billed)."""
    duration = int(call.duration_seconds or 0)
    if duration <= 0 or float(call.revenue_billed or 0.0) > 0:
        return
    agent = db.query(PearlAgent).filter(PearlAgent.id == call.agent_id).first()
    if not agent or not agent.user_id:
        return
    meter = calculate_call_metering(duration)
    call.revenue_billed = meter["total_credits"]
    call.pulses_30s = meter["pulses"]
    call.cogs_telephony = meter["telephony_cost"]
    try:
        # The call already happened: charge what the wallet holds (never negative,
        # no 402) and record any shortfall. Commits, which also persists the
        # revenue fields set above (revenue_billed guards against billing twice).
        result = charge_post_call(
            db,
            agent.user_id,
            meter["total_credits"],
            (
                f"Outbound Call #{call.id[:8]} ({duration}s) - Pearl AI: \u20b9{meter['pearl_voice_cost']:.2f}, "
                f"Telephony ({meter['pulses']} pulses): \u20b9{meter['telephony_cost']:.2f}"
            ),
        )
        if result["shortfall"] > 0:
            logger.warning("Post-call metering for call %s: charged %.2f of %.2f credits (shortfall %.2f)",
                           call.id[:8], result["charged"], meter["total_credits"], result["shortfall"])
    except Exception:
        db.rollback()
        logger.exception("Post-call metering for call %s failed", call.id[:8])


def _apply_carrier_event(db: Session, call: PearlCall, ev: CarrierEvent, provider: str) -> str:
    """
    Apply a normalized carrier event to a call. Idempotent:

    * final events are processed exactly once per call (atomic claim on ``ended_at``):
      terminal status, duration, campaign recipient + campaign counters, one billing charge;
      duplicates/retries return "duplicate" and change nothing;
    * progress events only move a live call forward (initiating -> ringing -> active) and
      never touch campaign recipients.
    """
    db.flush()
    if ev.final:
        now = datetime.utcnow()
        claimed = db.query(PearlCall).filter(
            PearlCall.id == call.id, PearlCall.ended_at.is_(None)
        ).update({PearlCall.ended_at: now}, synchronize_session=False)
        if claimed != 1:
            db.commit()
            return "duplicate"
        db.refresh(call)

        # "failed" with no ended_at = we already failed (and counted) this call ourselves: the
        # stale-call healer or a dispatch error. Its campaign counters must not count it twice.
        counted_as_failed = call.status == "failed"
        final_status = "cancelled" if call.status == "cancelled" else (ev.status or "completed")
        if ev.duration_seconds is not None:
            duration = ev.duration_seconds
        elif call.answered_at:
            duration = int((now - call.answered_at).total_seconds())
        else:
            duration = int(call.duration_seconds or 0)

        call.status = final_status
        call.completed_at = call.completed_at or now
        call.duration_seconds = max(0, int(duration))
        call.outcome = final_status
        if final_status != "completed" and ev.detail:
            call.error_code = call.error_code or f"{provider}: {ev.detail}"[:200]

        rec = db.query(PearlCampaignRecipient).filter(PearlCampaignRecipient.call_id == call.id).first()
        if rec:
            rec.status = "completed" if final_status == "completed" else "failed"
            rec.outcome = final_status
            rec.duration_seconds = call.duration_seconds
            rec.error_reason = None if final_status == "completed" else (ev.detail or final_status)[:200]
            campaign = db.query(PearlCampaign).filter(PearlCampaign.id == rec.campaign_id).first()
            if final_status == "completed" or final_status == "cancelled":
                rec.next_attempt_at = None
            elif campaign and campaign.status not in ("completed", "failed") and rec.next_attempt_at is None:
                rec.next_attempt_at = campaign_policy(campaign.call_settings).retry_due_at(
                    rec.attempts or 1, final_status, now
                )
            if campaign:
                if final_status == "completed":
                    campaign.completed_calls = (campaign.completed_calls or 0) + 1
                    if counted_as_failed:
                        campaign.failed_calls = max(0, (campaign.failed_calls or 0) - 1)
                elif not counted_as_failed:
                    campaign.failed_calls = (campaign.failed_calls or 0) + 1
        db.commit()

        try:
            EventLogger(db, call.agent_id).call_completed(call.id, final_status, call.duration_seconds, call.lead_id)
        except Exception:
            db.rollback()
        _bill_finished_call(db, call)
        return "final"

    if ev.status is None or call.ended_at is not None or not advances(call.status, ev.status):
        db.commit()
        return "ignored"
    call.status = ev.status
    if ev.status == "active":
        now = datetime.utcnow()
        call.answered_at = call.answered_at or now
        call.started_at = call.started_at or now
    db.commit()
    return "progress"


@router.post("/webhooks/exotel")
async def exotel_webhook(
    request: Request,
    call_id: Optional[str] = None,
    token: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Exotel call status callback. Authenticated by the per-call ``token`` in the
    StatusCallback URL we gave Exotel, or by a ``CallSid`` equal to the one stored at dispatch.
    """
    payload = await _read_carrier_payload(request)
    target_id = call_id or payload.get("CustomField") or payload.get("custom_field")
    if not target_id:
        raise HTTPException(400, "Missing call id (CustomField)")
    call = db.query(PearlCall).filter(PearlCall.id == str(target_id)).first()
    if not call:
        raise HTTPException(404, "Call not found")
    call_sid = payload.get("CallSid") or payload.get("callsid")
    if not (verify_carrier_token(call.id, token) or provider_id_matches(call.provider_call_id, call_sid)):
        raise HTTPException(403, "Invalid carrier credentials for this call")
    if call_sid and not call.provider_call_id:
        call.provider_call_id = str(call_sid)

    result = _apply_carrier_event(db, call, parse_exotel_event(payload), "exotel")
    return {"ok": True, "result": result}



class VoicePreviewRequest(BaseModel):

    speaker: str

    text: str = "Hello, I am ready to help you discover and qualify prospects."



@router.get("/voice-preview/{speaker}")
async def get_voice_preview_audio(speaker: str):
    """
    Return pre-cached static audio file for voice preview (0 API cost for repeated listens).
    Uses Bulbul v4 Flash (bulbul:v4-flash). Public.
    """
    import base64, requests
    from fastapi.responses import FileResponse

    normalized = _preview_speaker_or_404(speaker)
    os.makedirs(_VOICE_PREVIEW_DIR, exist_ok=True)
    cache_file = os.path.join(_VOICE_PREVIEW_DIR, f"{normalized}.mp3")

    # If cached on disk, return immediately (0 API credits!)
    if os.path.exists(cache_file):
        return FileResponse(cache_file, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=31536000"})

    api_key = os.getenv("SARVAM_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Voice preview is unavailable: SARVAM_API_KEY is not configured")

    # Select native language greeting for optimal audition
    sp_lower = normalized.lower()
    if "_en_" in sp_lower:
        lang, preview_text = "en-IN", "Hello, I am ready to handle your outbound sales and discovery calls."
    elif "_ta_" in sp_lower:
        lang, preview_text = "ta-IN", "Vanakkam! Ungal business sales call-galai handle seiya naan ready."
    elif "_te_" in sp_lower:
        lang, preview_text = "te-IN", "Namaskaram! Mee business sales calls handle cheyadaniki nenu ready."
    elif "_bn_" in sp_lower:
        lang, preview_text = "bn-IN", "Nomoshkar! Aami aapnar business-er sales call handle korte ready."
    elif "_mr_" in sp_lower:
        lang, preview_text = "mr-IN", "Namaskar! Mi tumchya business che sales call sambhalnyasathi tayar ahe."
    elif "_gu_" in sp_lower:
        lang, preview_text = "gu-IN", "Namaste! Hu tamara business na sales calls sambhalva mate taiyar chhu."
    elif "_pa_" in sp_lower:
        lang, preview_text = "pa-IN", "Sat Sri Akal! Main tuhade business de sales calls sambhalan layi tayaar haan."
    elif "_kn_" in sp_lower:
        lang, preview_text = "kn-IN", "Namaskara! Nimma business sales calls manage madoke naanu ready."
    elif "_ml_" in sp_lower:
        lang, preview_text = "ml-IN", "Namaskaram! Ningalude business sales calls handle cheyyan njan ready aanu."
    elif "_od_" in sp_lower:
        lang, preview_text = "od-IN", "Namaskar! Aapananka business sales calls handle kariba pain mu ready."
    else:
        lang, preview_text = "hi-IN", "Namaste! Main aapke business ke sales aur calls handle karne ke liye tayar hoon."

    audio_b64 = await _sarvam_tts_b64(api_key, preview_text, lang, normalized)
    audio_bytes = base64.b64decode(audio_b64)
    with open(cache_file, "wb") as f_out:
        f_out.write(audio_bytes)
    return Response(content=audio_bytes, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=31536000"})


_VOICE_PREVIEW_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static", "voice_previews")
_PREVIEW_SPEAKER_RE = re.compile(r"^[a-z]{2,20}(?:_[a-z]{2,16}){1,3}$")


def _preview_speaker_or_404(raw: str) -> str:
    """Normalized Sarvam persona id; refuses anything that isn't a known voice (no paths, no cost abuse)."""
    from services.pearl.providers.tts import normalize_sarvam_v4_speaker, VALID_SARVAM_WS_SPEAKERS
    from services.pearl.conversation_engine import SARVAM_SPEAKER_GENDER
    normalized = normalize_sarvam_v4_speaker(raw)
    base = normalized.split("_", 1)[0]
    if not _PREVIEW_SPEAKER_RE.match(normalized) or (base not in VALID_SARVAM_WS_SPEAKERS and base not in SARVAM_SPEAKER_GENDER):
        raise HTTPException(status_code=404, detail="Unknown voice")
    return normalized


async def _sarvam_tts_b64(api_key: str, text: str, lang: str, speaker: str) -> str:
    """One Sarvam REST synthesis (run off the event loop). Returns base64 audio or raises 502."""
    import requests
    payload = {
        "inputs": [text],
        "target_language_code": lang,
        "speaker": speaker,
        "pitch": 0,
        "pace": 1.0,
        "loudness": 1.5,
        "speech_sample_rate": 24000,
        "enable_preprocessing": True,
        "model": "bulbul:v4-flash"
    }
    headers = {"api-subscription-key": api_key, "Content-Type": "application/json"}
    try:
        resp = await asyncio.to_thread(
            requests.post, "https://api.sarvam.ai/text-to-speech", json=payload, headers=headers, timeout=10
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.warning("[Voice Preview] Sarvam synthesis failed for %s: %s", speaker, e)
        raise HTTPException(status_code=502, detail="Voice preview synthesis failed")
    audios = data.get("audios") if isinstance(data, dict) else None
    if not audios:
        raise HTTPException(status_code=502, detail="No audio returned from Sarvam")
    return audios[0]


@router.post("/preview_voice")
async def preview_voice(req: VoicePreviewRequest, current_user = Depends(get_current_user)):
    """Generate a quick TTS preview for the frontend UI using Sarvam bulbul:v4-flash with disk caching."""
    import base64, hashlib

    normalized = _preview_speaker_or_404(req.speaker)
    text = (req.text or "").strip()[:500] or VoicePreviewRequest.model_fields["text"].default
    target_lang = "en-IN" if "_en_" in normalized else "hi-IN"
    # Cache per (speaker, language, text): user text must never overwrite the shared public preview.
    digest = hashlib.sha256(f"{target_lang}|{text}".encode("utf-8")).hexdigest()[:16]
    os.makedirs(_VOICE_PREVIEW_DIR, exist_ok=True)
    cache_file = os.path.join(_VOICE_PREVIEW_DIR, f"{normalized}-{digest}.mp3")

    if os.path.exists(cache_file):
        with open(cache_file, "rb") as f_in:
            b64_audio = base64.b64encode(f_in.read()).decode("ascii")
        return {"audio_base64": b64_audio, "cached": True}

    api_key = os.getenv("SARVAM_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Voice preview is unavailable: SARVAM_API_KEY is not configured")

    audio_b64 = await _sarvam_tts_b64(api_key, text, target_lang, normalized)
    with open(cache_file, "wb") as f_out:
        f_out.write(base64.b64decode(audio_b64))
    return {"audio_base64": audio_b64, "cached": False}



# ═══════════════════════════════════════════════════════════════════════════════

# BROWSER TEST SESSIONS & CHAT / VOICE TESTING

# ═══════════════════════════════════════════════════════════════════════════════



class CreateTestSessionRequest(BaseModel):

    agent_id: str

    mode: str = "chat"  # "chat" or "voice"





class SendChatMessageRequest(BaseModel):

    message: str





VOICE_OPENING_FALLBACK = "Haan namaste, main Clozflow se bol rahi hoon. Kya aapke paas 2 minute honge?"


def _voice_test_greeting(snapshot: dict) -> Optional[str]:
    """The fixed greeting a voice test speaks (the old built-in default greeting is ignored there)."""
    greeting = snapshot.get("greeting")
    if isinstance(greeting, str) and greeting.strip() \
            and not ("How are you doing today" in greeting and "calling from" in greeting):
        return greeting
    return None


def _voice_test_engine(snapshot: dict) -> "ConversationEngine":
    """ConversationEngine for a voice test session (also used to write its seeded opening)."""
    test_vars = snapshot.get("test_variables") or {}
    voice_cfg = snapshot.get("voice_config") or {}
    speaker = voice_cfg.get("speaker", "shubh_enhi_ads")
    system_prompt = substitute_variables_text(snapshot.get("system_prompt"), test_vars)
    agent_name = snapshot.get("name") or "Pearl"
    lead_ctx = {
        "business_name": test_vars.get("prospect_name") or test_vars.get("company") or "Prospect",
        "capsule_context": snapshot.get("capsule_context", "No product context provided."),
    }
    return ConversationEngine(
        objective=snapshot.get("mission", "Qualify prospect and discuss needs."),
        lead_context={**lead_ctx, "agent_name": agent_name, "voice_config": voice_cfg, "speaker": speaker},
        system_prompt_override=system_prompt if system_prompt and system_prompt.strip() else None,
        agent_name=agent_name,
        speaker=speaker,
        voice_config=voice_cfg
    )


async def _voice_test_opening(snapshot: dict) -> str:
    """The opening line a voice test session starts with (fixed greeting, else the engine's opener)."""
    greeting = _voice_test_greeting(snapshot)
    if greeting:
        return substitute_variables_text(greeting, snapshot.get("test_variables") or {})
    text = ""
    try:
        async for tok in _voice_test_engine(snapshot).generate_response_stream():
            text += tok
    except Exception as e:
        logger.warning("[Create Test Session] Voice opening error: %s", e)
    return text.strip() or VOICE_OPENING_FALLBACK


def _seeded_opening_text(db: Session, session_id: str) -> Optional[str]:
    """Latest opening line stored for a test session (``meta.is_opening``), if any."""
    rows = db.query(PearlTestMessage).filter(
        PearlTestMessage.session_id == session_id, PearlTestMessage.role == "assistant"
    ).order_by(PearlTestMessage.timestamp.desc()).all()
    for m in rows:
        if isinstance(m.meta, dict) and m.meta.get("is_opening") and (m.text or "").strip():
            return m.text
    return None


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
    Charges the flat test-simulation fee only after the request has been validated.
    """
    if req.mode not in TEST_SESSION_MODES:
        raise HTTPException(400, "mode must be 'chat' or 'voice'")

    agent = _get_owned_agent(db, req.agent_id, user)

    # Enforce meter: 2 Rs / 2 credits per test simulation (402 if the balance is too low)
    deduct_credits(
        db=db,
        user_id=user.id,
        amount=RATE_PER_TEST_SIMULATION,
        description=f"Pearl Agent Test Simulation (Agent #{agent.id})"
    )

    # Build comprehensive capsule context via format_capsule_context

    capsule_text = format_capsule_context(agent.capsule)



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



    # Seed the opening line (chat and voice). The voice socket speaks this exact line when it
    # connects, so the session's messages and what the caller hears always agree.

    if req.mode == "voice":

        initial_msg = PearlTestMessage(
            session_id=session.id,
            role="assistant",
            text=await _voice_test_opening(snapshot),
            meta={"is_opening": True},
        )
        db.add(initial_msg)
        db.commit()
        db.refresh(session)

    elif req.mode == "chat":

        if custom_greeting:

            tvars = snapshot.get("test_variables") or {}

            rendered_greeting = substitute_variables_text(custom_greeting, tvars)

            opening_text = rendered_greeting

        else:

            # Generate dynamic pattern interrupt opening via ConversationEngine

            prospect_name = snapshot.get("test_variables", {}).get("prospect_name") or "there"

            sys_override = substitute_variables_text(snapshot.get("system_prompt"), snapshot.get("test_variables") or {})

            _test_agent_name = snapshot.get("name") or "Pearl"
            _test_vc = snapshot.get("voice_config") or {}
            engine = ConversationEngine(
                objective=snapshot.get("mission") or "Qualify prospect and establish fit.",
                lead_context={"business_name": prospect_name, "capsule_context": capsule_text, "agent_name": _test_agent_name, "voice_config": _test_vc, "speaker": _test_vc.get("speaker")},
                system_prompt_override=sys_override if sys_override and sys_override.strip() else None,
                agent_name=_test_agent_name,
                speaker=_test_vc.get("speaker"),
                voice_config=_test_vc
            )

            tokens = []

            try:

                async for tok in engine.generate_response_stream():

                    tokens.append(tok)

                opening_text = "".join(tokens).strip() or "Namaste, main Clozflow se bol rahi hoon."

            except Exception as e:

                logger.warning("[Create Test Session] Dynamic opening error: %s", e)

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



    _chat_agent_name = snapshot.get("name") or "Pearl"
    _chat_vc = snapshot.get("voice_config") or {}
    engine = ConversationEngine(
        objective=objective,
        lead_context={**lead_ctx, "agent_name": _chat_agent_name, "voice_config": _chat_vc, "speaker": _chat_vc.get("speaker")},
        system_prompt_override=system_prompt if system_prompt and system_prompt.strip() else None,
        agent_name=_chat_agent_name,
        speaker=_chat_vc.get("speaker"),
        voice_config=_chat_vc
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

        logger.warning("[Browser Test Chat] LLM error: %s", e)

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



    # Restart with an opening message (voice sessions speak it when the socket connects)

    if session.mode == "voice":

        db.add(PearlTestMessage(
            session_id=session.id,
            role="assistant",
            text=await _voice_test_opening(snapshot),
            meta={"is_opening": True},
        ))

    elif session.mode == "chat":

        if custom_greeting and custom_greeting.strip():

            tvars = snapshot.get("test_variables") or {}

            rendered_greeting = substitute_variables_text(custom_greeting, tvars)

            opening_text = rendered_greeting

        else:

            prospect_name = snapshot.get("test_variables", {}).get("prospect_name") or "there"

            capsule_text = snapshot.get("capsule_context") or "No product context provided."

            sys_override = substitute_variables_text(snapshot.get("system_prompt"), snapshot.get("test_variables") or {})

            _clear_agent_name = snapshot.get("name") or "Pearl"
            _clear_vc = snapshot.get("voice_config") or {}
            engine = ConversationEngine(
                objective=snapshot.get("mission") or "Qualify prospect and establish fit.",
                lead_context={"business_name": prospect_name, "capsule_context": capsule_text, "agent_name": _clear_agent_name, "voice_config": _clear_vc, "speaker": _clear_vc.get("speaker")},
                system_prompt_override=sys_override if sys_override and sys_override.strip() else None,
                agent_name=_clear_agent_name,
                speaker=_clear_vc.get("speaker"),
                voice_config=_clear_vc
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
    Dedicated Browser Voice Test WebSocket. Auth: ``?token=<JWT>``; only the owner of an
    *active* test session may connect (otherwise closed with 1008 before accept).

    Streams 16kHz linear PCM between the browser and Pearl's real AI pipeline:
      - Browser Mic PCM16 -> GeminiStream (STT) + Silero VAD
      - Recognized speech -> ConversationEngine (LLM)
      - Agent response -> get_tts_provider() (Sarvam Bulbul / ElevenLabs) -> Browser Audio Playback
      - Supports interruption (barge-in) on every turn and clean disconnect
      - Absolutely zero PSTN / telephony interaction

    Server -> client: ready, agent_thinking, audio{data}, transcript{speaker,text},
    partial_transcript{text}, interrupted, tts_finished, error{message}.
    Client -> server: binary PCM16 frames, {"type": "stop"}.
    """
    from services.pearl.providers.tts import FLUSH_COMPLETE

    token = _ws_token(websocket)
    user = verify_token_string(token, db) if token else None
    session = db.query(PearlTestSession).filter(
        PearlTestSession.id == session_id,
        PearlTestSession.user_id == user.id
    ).first() if user else None

    if not session or (session.status or "active") != "active":
        db.close()
        await websocket.close(code=1008)
        return

    snapshot = dict(session.agent_snapshot or {})
    test_session_id = session.id
    seeded_opening = _seeded_opening_text(db, test_session_id)  # written by POST /test-sessions
    db.close()  # the session lives for minutes; don't pin a pooled DB connection

    await websocket.accept()
    logger.debug("[Browser Voice Test] Session %s connected", test_session_id[:8])

    test_vars = snapshot.get("test_variables") or {}
    voice_cfg = snapshot.get("voice_config") or {}
    speaker = voice_cfg.get("speaker", "shubh_enhi_ads")
    language = voice_cfg.get("language", "Auto")
    try:
        pace = float(voice_cfg.get("pace", 1.0))
    except (TypeError, ValueError):
        pace = 1.0

    engine = _voice_test_engine(snapshot)

    tts = get_tts_provider()
    try:
        await tts.connect()
        lang_code = language if language not in ["Auto", None, ""] else None
        await tts.configure(language_code=lang_code, speaker=speaker, pace=pace, temperature=0.6)
    except Exception as e:
        logger.warning("[Browser Voice Test] TTS setup warning: %s", e)

    # Interruption & turn control
    closed = False
    _is_speaking = False
    _generating = False
    _first_audio_sent_at = 0.0
    _tts_cancel = asyncio.Event()
    _generation_id = 0
    _bg_tasks: set = set()

    def _spawn(coro) -> asyncio.Task:
        task = asyncio.create_task(coro)
        _bg_tasks.add(task)
        task.add_done_callback(_bg_tasks.discard)
        return task

    async def _send(msg: dict) -> bool:
        if closed:
            return False
        try:
            await websocket.send_json(msg)
            return True
        except Exception:
            return False

    def _save_test_msg(s_id, role, text, meta=None):
        try:
            from database import SessionLocal
            with SessionLocal() as s:
                s.add(PearlTestMessage(session_id=s_id, role=role, text=text, meta=meta))
                s.commit()
        except Exception as e:
            logger.warning("[Browser Voice Test] Could not save message: %s", e)

    async def _cancel_speech(notify: bool = True):
        """Stop the agent's current utterance (barge-in or a newer turn)."""
        nonlocal _is_speaking, _first_audio_sent_at, _generation_id
        _tts_cancel.set()
        _generation_id += 1
        _is_speaking = False
        _first_audio_sent_at = 0.0
        vad.set_agent_speaking(False)
        try:
            await tts.cancel()
        except Exception as e:
            logger.warning("[Browser Voice Test] TTS cancel failed: %s", e)
        if notify:
            await _send({"type": "interrupted"})

    async def trigger_browser_barge_in(source: str):
        if not _is_speaking:
            return
        logger.debug("[Browser Voice Test] Interruption detected (%s)", source)
        await _cancel_speech()
        turn_detector.on_speech_start()

    async def _tts_consumer_loop():
        """
        Forward agent audio to the browser for the whole session. If the provider's stream
        ends (e.g. its socket is replaced after a barge-in) re-attach instead of stopping -
        previously the loop ended after the first interruption and later turns were silent.
        """
        nonlocal _is_speaking, _first_audio_sent_at
        while not closed:
            try:
                async for chunk in tts.receive_audio():
                    if closed:
                        break
                    if _tts_cancel.is_set():
                        continue
                    if chunk == FLUSH_COMPLETE:
                        _is_speaking = False
                        _first_audio_sent_at = 0.0
                        vad.set_agent_speaking(False)
                        await _send({"type": "tts_finished"})
                        continue
                    if not chunk:
                        continue
                    if not _is_speaking:
                        _is_speaking = True
                        _first_audio_sent_at = time.time()
                        vad.set_agent_speaking(True)
                    await _send({"type": "audio", "data": base64.b64encode(chunk).decode("ascii")})
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.warning("[Browser Voice Test] TTS consumer error: %s", e)
            if not closed:
                await asyncio.sleep(0.02)

    async def _speak_generation(gen_id: int, fallback_text: str) -> str:
        """LLM tokens -> phrase chunker -> TTS for generation ``gen_id``; returns the text produced."""
        nonlocal _generating
        chunker = PhraseChunker(first_chunk_words=3, subsequent_chunk_words=7)
        full = ""

        def _stale() -> bool:
            return closed or _tts_cancel.is_set() or _generation_id != gen_id

        _generating = True
        try:
            async for tok in engine.generate_response_stream():
                if _stale():
                    break
                full += tok
                for phrase in chunker.feed(tok):
                    if _stale():
                        break
                    await tts.send_text(phrase)
            if not _stale():
                for phrase in chunker.flush():
                    if _stale():
                        break
                    await tts.send_text(phrase)
            if not _stale():
                await tts.flush()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("[Browser Voice Test] LLM error: %s", e)
            if not full.strip() and not _stale():
                full = fallback_text
                try:
                    await tts.send_text(full)
                    await tts.flush()
                except Exception:
                    pass
        finally:
            if _generation_id == gen_id:
                _generating = False
        return full

    async def on_turn_complete(user_transcript: str):
        nonlocal _generation_id
        text = (user_transcript or "").strip()
        if not text or closed:
            return

        # A new user turn supersedes whatever the agent is still saying or generating.
        if _is_speaking or _generating:
            await _cancel_speech()

        await _send({"type": "transcript", "speaker": "user", "text": text})
        _spawn(asyncio.to_thread(_save_test_msg, test_session_id, "user", text))
        engine.add_turn("prospect", text)

        _generation_id += 1
        current_gen = _generation_id
        _tts_cancel.clear()
        if hasattr(tts, "reset_buffer"):
            tts.reset_buffer()
        await _send({"type": "agent_thinking"})

        full_response = await _speak_generation(current_gen, "I apologize, could you say that again?")
        if full_response.strip() and not closed:
            engine.add_turn("agent", full_response)
            await _send({"type": "transcript", "speaker": "agent", "text": full_response})
            _spawn(asyncio.to_thread(_save_test_msg, test_session_id, "assistant", full_response))

    # VAD & Turn Detector
    vad = SileroVADEngine()
    await vad.initialize()
    turn_detector = TurnDetector(on_turn_complete=on_turn_complete)
    tts_task = asyncio.create_task(_tts_consumer_loop())

    async def transcript_callback(speaker, text, is_final=True, speech_final=False):
        if not text or not text.strip():
            if speech_final:
                turn_detector.on_speech_final()
            return

        if _is_speaking:
            await trigger_browser_barge_in("STT transcript")

        turn_detector.on_transcript(text, is_final=is_final)
        if not is_final:
            await _send({"type": "partial_transcript", "text": text})

        if speech_final:
            turn_detector.on_speech_final()

    stt = GeminiStream(transcript_callback=transcript_callback)

    try:
        stt_connected = await stt.connect()
        if not stt_connected:
            logger.warning("[Browser Voice Test] STT stream connection failed")
            await _send({"type": "error", "message": "Failed to connect to transcription service"})

        await _send({"type": "ready", "agent_name": snapshot.get("name"), "speaker": speaker})

        # ── Opening (custom greeting, or dynamic pattern interrupt from the engine) ──
        _generation_id += 1
        opening_gen = _generation_id
        _tts_cancel.clear()
        if hasattr(tts, "reset_buffer"):
            tts.reset_buffer()

        custom_greeting = _voice_test_greeting(snapshot)
        if seeded_opening or custom_greeting:
            # The line seeded at session creation (already stored), else the fixed greeting.
            full_opening = seeded_opening or substitute_variables_text(custom_greeting, test_vars)
            await _send({"type": "transcript", "speaker": "agent", "text": full_opening})
            await tts.send_text(full_opening)
            await tts.flush()
            engine.add_turn("agent", full_opening)
        else:
            await _send({"type": "agent_thinking"})
            full_opening = await _speak_generation(
                opening_gen, "Haan namaste, main Clozflow se bol rahi hoon. Kya aapke paas 2 minute honge?"
            )
            if full_opening.strip():
                engine.add_turn("agent", full_opening.strip())
                await _send({"type": "transcript", "speaker": "agent", "text": full_opening.strip()})
                _spawn(asyncio.to_thread(_save_test_msg, test_session_id, "assistant", full_opening.strip(), {"is_opening": True}))

        # ── Audio Ingestion Loop ──
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break

            pcm_data = msg.get("bytes")
            if pcm_data:
                await stt.send_audio(pcm_data)

                # VAD for speech activity and interruption
                events = vad.process_chunk(pcm_data)
                now = time.time()
                for ev in events:
                    if ev == VADEvent.SPEECH_START:
                        if not _is_speaking:
                            turn_detector.on_speech_start()
                        elif _first_audio_sent_at > 0 and (now - _first_audio_sent_at > 0.20):
                            await trigger_browser_barge_in("VAD SPEECH_START")
                    elif ev == VADEvent.SPEECH_END:
                        if not _is_speaking:
                            turn_detector.on_speech_end()

                # Sustained speech check: triggers barge-in even if user spoke during initial 200ms
                if _is_speaking and vad.is_speaking and _first_audio_sent_at > 0 and (now - _first_audio_sent_at > 0.20):
                    await trigger_browser_barge_in("VAD sustained speech")

            elif msg.get("text"):
                try:
                    data = json.loads(msg["text"])
                except ValueError:
                    continue
                if isinstance(data, dict) and data.get("type") == "stop":
                    break

    except WebSocketDisconnect:
        logger.debug("[Browser Voice Test] Client disconnected")
    except Exception as e:
        logger.warning("[Browser Voice Test] WebSocket error: %s", e)
    finally:
        # Stop any in-flight generation, then release every resource of the session.
        closed = True
        _generation_id += 1
        _tts_cancel.set()
        turn_detector.cleanup()
        tts_task.cancel()
        await asyncio.gather(tts_task, return_exceptions=True)
        for closer in (stt.close, tts.close):
            try:
                await closer()
            except Exception:
                pass
        if _bg_tasks:
            await asyncio.wait(list(_bg_tasks), timeout=5.0)
        try:
            await websocket.close()
        except Exception:
            pass
        logger.debug("[Browser Voice Test] Session %s cleaned up", test_session_id[:8])





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

        "call_settings": c.call_settings or dict(DEFAULT_CALL_SETTINGS),

        # What the dialer does with call_settings (provider, window, attempts, intervals).
        "effective_call_settings": campaign_policy(c.call_settings).to_dict(datetime.utcnow()),

        "schedule_time": c.schedule_time.isoformat() if c.schedule_time else None,

        "metrics": {

            "total_recipients": c.total_recipients,

            "eligible_recipients": c.eligible_recipients,

            "completed_calls": c.completed_calls,

            "failed_calls": c.failed_calls,

            # Not tracked: no call outcome is qualified by the pipeline yet, so the stored
            # counter was always 0. null = unknown (the key stays for older clients).
            "qualified_calls": None,

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

        # Set while a failed / unanswered recipient waits for its next attempt.
        "next_attempt_at": utc_iso(r.next_attempt_at),

        "retry_scheduled": bool(r.next_attempt_at is not None and r.status == "failed"),

        "duration_seconds": r.duration_seconds,

        "outcome": r.outcome,

        "error_reason": r.error_reason,

        "transcript": r.transcript,

        "summary": r.summary,

        "created_at": r.created_at.isoformat() if r.created_at else None,

    }





RECIPIENT_STATUSES = ("valid", "invalid", "excluded", "queued", "calling", "completed", "failed")


def _recipient_status_counts(db: Session, campaign_id: str) -> Dict[str, int]:
    """Recipients per status for a campaign; every known status is present (0 when unused)."""
    counts = {s: 0 for s in RECIPIENT_STATUSES}
    for status, n in db.query(PearlCampaignRecipient.status, func.count(PearlCampaignRecipient.id)).filter(
        PearlCampaignRecipient.campaign_id == campaign_id
    ).group_by(PearlCampaignRecipient.status).all():
        counts[status or "unknown"] = counts.get(status or "unknown", 0) + int(n or 0)
    return counts


def _retry_scheduled_q(db: Session, campaign_id: str):
    return db.query(PearlCampaignRecipient).filter(
        PearlCampaignRecipient.campaign_id == campaign_id,
        PearlCampaignRecipient.status == "failed",
        PearlCampaignRecipient.next_attempt_at.isnot(None),
    )


def _retry_scheduled_count(db: Session, campaign_id: str) -> int:
    return _retry_scheduled_q(db, campaign_id).count()


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

        call_settings=req.call_settings or dict(DEFAULT_CALL_SETTINGS),

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

    campaigns = db.query(PearlCampaign).options(
        joinedload(PearlCampaign.agent)
    ).filter(

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

    campaign = db.query(PearlCampaign).options(
        joinedload(PearlCampaign.agent),
        selectinload(PearlCampaign.recipients)
    ).filter(

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



    update_fields = req.model_dump(exclude_unset=True)
    for non_nullable in ("name", "status"):
        if non_nullable in update_fields and update_fields[non_nullable] is None:
            update_fields.pop(non_nullable)
    new_status = update_fields.get("status")

    if campaign.status == "running":
        config_fields = [f for f in update_fields if f != "status"]
        if config_fields or new_status not in (None, "paused", "completed", "running"):
            raise HTTPException(400, "Cannot edit configuration of an actively running campaign. Pause it first.")
    if new_status is not None and new_status != campaign.status and new_status not in CAMPAIGN_PATCHABLE_STATUSES:
        raise HTTPException(
            400,
            f"status can only be set to one of: {', '.join(CAMPAIGN_PATCHABLE_STATUSES)}. "
            "Use POST /campaigns/{id}/launch or /resume to start calling."
        )
    if update_fields.get("agent_id"):
        _get_owned_agent(db, update_fields["agent_id"], user)

    for field, value in update_fields.items():
        setattr(campaign, field, value)
    if new_status == "completed":
        # A finished campaign dials nobody again: drop retries that were still scheduled.
        db.query(PearlCampaignRecipient).filter(
            PearlCampaignRecipient.campaign_id == campaign.id,
            PearlCampaignRecipient.next_attempt_at.isnot(None),
        ).update({PearlCampaignRecipient.next_attempt_at: None}, synchronize_session=False)

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



    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "Uploaded file is too large (max 10 MB)")
    filename = (file.filename or "").lower()

    raw_rows: List[dict] = []



    if filename.endswith(".csv"):
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = content.decode("latin-1", errors="replace")
        raw_rows = await asyncio.to_thread(parse_csv_file, text)
    elif filename.endswith(".xlsx"):
        try:
            raw_rows = await asyncio.to_thread(parse_xlsx_sheets, content)
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



    processed, stats = await asyncio.to_thread(
        process_lead_batch, raw_rows, source="csv_upload", existing_phone_set=existing_phones
    )

    # Persist recipients to DB in batch
    new_recipients = [
        PearlCampaignRecipient(
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
        for item in processed
    ]

    db.add_all(new_recipients)
    db.commit()

    # Recalculate campaign totals in single grouped query
    counts = dict(
        db.query(PearlCampaignRecipient.status, func.count(PearlCampaignRecipient.id))
        .filter(PearlCampaignRecipient.campaign_id == campaign_id)
        .group_by(PearlCampaignRecipient.status)
        .all()
    )
    total = sum(counts.values())
    eligible = counts.get("valid", 0)

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
async def import_campaign_leads_from_finder(
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

    processed, stats = await asyncio.to_thread(
        process_lead_batch, req.leads, source="lead_finder", existing_phone_set=existing_phones
    )

    # Persist recipients to DB in batch
    new_recipients = [
        PearlCampaignRecipient(
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
        for item in processed
    ]

    db.add_all(new_recipients)
    db.commit()

    # Recalculate campaign totals in single grouped query
    counts = dict(
        db.query(PearlCampaignRecipient.status, func.count(PearlCampaignRecipient.id))
        .filter(PearlCampaignRecipient.campaign_id == campaign_id)
        .group_by(PearlCampaignRecipient.status)
        .all()
    )
    total = sum(counts.values())
    eligible = counts.get("valid", 0)

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
    rec_status, rec_error = ("valid", err) if is_valid else ("invalid", err)
    if is_valid and db.query(PearlCampaignRecipient.id).filter(
        PearlCampaignRecipient.campaign_id == campaign_id,
        PearlCampaignRecipient.normalized_phone == norm_phone
    ).first():
        rec_status, rec_error = "excluded", f"Duplicate phone number detected ({norm_phone})"



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

        status=rec_status,

        validation_error=rec_error

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

    status: Optional[str] = None,

    db: Session = Depends(get_db),

    user: User = Depends(get_current_user)

):

    """List recipients for review with pagination.

    ``counts`` has the number of recipients per status for the whole campaign (every status
    of the vocabulary is present, 0 when unused); ``retry_scheduled`` counts failed recipients
    waiting for another attempt. Optional ``status`` (comma-separated) filters the page;
    ``total`` is the number of recipients matching it (all of them without a filter).
    """
    limit = max(1, min(int(limit or 200), 1000))
    offset = max(0, int(offset or 0))

    campaign = db.query(PearlCampaign).filter(

        PearlCampaign.id == campaign_id,

        PearlCampaign.user_id == user.id

    ).first()

    if not campaign:

        raise HTTPException(404, "Campaign not found")

    base = db.query(PearlCampaignRecipient).filter(PearlCampaignRecipient.campaign_id == campaign_id)
    statuses = [s.strip().lower() for s in (status or "").split(",") if s.strip()]
    page_query = base.filter(PearlCampaignRecipient.status.in_(statuses)) if statuses else base

    recipients = page_query.order_by(PearlCampaignRecipient.created_at.asc()).offset(offset).limit(limit).all()

    total = page_query.count()

    return {

        "recipients": [recipient_to_dict(r) for r in recipients],

        "total": total,

        "limit": limit,

        "offset": offset,

        "counts": _recipient_status_counts(db, campaign_id),

        "retry_scheduled": _retry_scheduled_count(db, campaign_id),

    }





class ToggleRecipientRequest(BaseModel):
    status: Optional[str] = None


@router.patch("/campaigns/{campaign_id}/recipients/{recipient_id}")
def toggle_campaign_recipient(
    campaign_id: str,
    recipient_id: str,
    payload: Optional[ToggleRecipientRequest] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Toggle a recipient between valid and excluded in review table."""
    target_status = (payload.status if payload and payload.status else None) or status
    if not target_status or target_status not in ("valid", "excluded"):
        raise HTTPException(400, "Status must be 'valid' or 'excluded'")

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

    # Don't allow marking invalid number as valid if it fails E.164
    if target_status == "valid" and not recipient.normalized_phone:
        raise HTTPException(400, "Cannot enable a recipient with an invalid phone number")

    recipient.status = target_status
    recipient.next_attempt_at = None  # a manual change replaces any scheduled retry
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



_running_campaign_workers: set = set()


STALE_CALL_SECONDS = 180
STALE_CALL_STATUSES = PRE_ANSWER_CALL_STATUSES + ("ringing",)


def _campaign_pacing_seconds(settings: Optional[dict]) -> float:
    """Pause between two dispatches (``call_settings.pacing_seconds``, 0-5 s, default 2)."""
    return campaign_policy(settings).pacing_seconds


def _schedule_retry(s: Session, rec: PearlCampaignRecipient, outcome: str, now: datetime) -> None:
    """Set ``rec.next_attempt_at`` from its campaign's retry policy (None = no further attempt)."""
    campaign = s.query(PearlCampaign).filter(PearlCampaign.id == rec.campaign_id).first()
    if campaign is None or campaign.status in ("completed", "failed"):
        rec.next_attempt_at = None
        return
    rec.next_attempt_at = campaign_policy(campaign.call_settings).retry_due_at(rec.attempts or 1, outcome, now)


def _heal_stale_calls(s: Session) -> None:
    """Fail calls stuck before answer for >180s (lost carrier webhooks) so they free their line.

    Each healed campaign call counts once in ``failed_calls`` and its recipient becomes
    ``failed`` (retried per the campaign's policy). ``ended_at`` stays empty: a late final
    carrier event still records the real outcome and bills; ``_apply_carrier_event`` then
    corrects the counters instead of counting the call a second time."""
    now = datetime.utcnow()
    threshold = now - timedelta(seconds=STALE_CALL_SECONDS)
    stale_ids = [cid for (cid,) in s.query(PearlCall.id).filter(
        PearlCall.status.in_(STALE_CALL_STATUSES),
        PearlCall.created_at < threshold,
        PearlCall.ended_at.is_(None),
    ).all()]
    for call_id in stale_ids:
        # Conditional update: a final carrier event processed meanwhile (ended_at set) wins.
        healed = s.query(PearlCall).filter(
            PearlCall.id == call_id,
            PearlCall.ended_at.is_(None),
            PearlCall.status.in_(STALE_CALL_STATUSES),
        ).update({
            PearlCall.status: "failed",
            PearlCall.error_code: func.coalesce(PearlCall.error_code, "Dialing timeout / Stale"),
        }, synchronize_session=False)
        if healed != 1:
            continue
        stale_rec = s.query(PearlCampaignRecipient).filter(
            PearlCampaignRecipient.call_id == call_id, PearlCampaignRecipient.status == "calling"
        ).first()
        if stale_rec is None:
            continue
        stale_rec.status = "failed"
        stale_rec.outcome = "failed"
        stale_rec.error_reason = "No carrier response"
        _schedule_retry(s, stale_rec, "failed", now)
        s.query(PearlCampaign).filter(PearlCampaign.id == stale_rec.campaign_id).update(
            {PearlCampaign.failed_calls: func.coalesce(PearlCampaign.failed_calls, 0) + 1},
            synchronize_session=False
        )
    if stale_ids:
        s.commit()


CAMPAIGN_WINDOW_POLL_SECONDS = 30.0   # longest sleep while the calling window is closed
CAMPAIGN_IDLE_POLL_SECONDS = 15.0     # longest sleep while waiting for retries / in-flight calls
CAMPAIGN_STATUS_POLL_SECONDS = 5.0    # while waiting, a pause / stop is noticed within this time
IN_FLIGHT_WAIT_CAP = timedelta(hours=3)  # older in-flight calls no longer hold a retry campaign open


def _due_recipient_ids(s: Session, campaign_id: str, policy: CampaignPolicy, now: datetime) -> List[str]:
    """Recipients to dial now: never-dialled ``valid`` ones, then retries that are due."""
    ids = [rid for (rid,) in s.query(PearlCampaignRecipient.id).filter(
        PearlCampaignRecipient.campaign_id == campaign_id,
        PearlCampaignRecipient.status == "valid"
    ).order_by(PearlCampaignRecipient.created_at.asc()).all()]
    if policy.retries_enabled:
        ids += [rid for (rid,) in s.query(PearlCampaignRecipient.id).filter(
            PearlCampaignRecipient.campaign_id == campaign_id,
            PearlCampaignRecipient.status == "failed",
            PearlCampaignRecipient.next_attempt_at.isnot(None),
            PearlCampaignRecipient.next_attempt_at <= now,
            func.coalesce(PearlCampaignRecipient.attempts, 0) < policy.max_attempts,
        ).order_by(PearlCampaignRecipient.next_attempt_at.asc()).all()]
    return ids


def _next_campaign_event(s: Session, campaign_id: str, policy: CampaignPolicy, now: datetime) -> Optional[datetime]:
    """Nothing is due now but there may be more to dial: ``now`` while a call that may still
    need a retry is in flight, else the earliest scheduled retry. None = the campaign is done
    (always the case without retries: it completes once every recipient has been dialled)."""
    if not policy.retries_enabled:
        return None
    in_flight = s.query(PearlCampaignRecipient.id).join(
        PearlCall, PearlCampaignRecipient.call_id == PearlCall.id
    ).filter(
        PearlCampaignRecipient.campaign_id == campaign_id,
        PearlCampaignRecipient.status == "calling",
        PearlCall.status.in_(IN_FLIGHT_CALL_STATUSES),
        PearlCall.created_at > now - IN_FLIGHT_WAIT_CAP,
    ).first()
    if in_flight is not None:
        return now
    return s.query(func.min(PearlCampaignRecipient.next_attempt_at)).filter(
        PearlCampaignRecipient.campaign_id == campaign_id,
        PearlCampaignRecipient.status == "failed",
        PearlCampaignRecipient.next_attempt_at.isnot(None),
        func.coalesce(PearlCampaignRecipient.attempts, 0) < policy.max_attempts,
    ).scalar()


def _claim_recipient(s: Session, rec_id: str, policy: CampaignPolicy, now: datetime) -> bool:
    """Atomically move a recipient to ``calling`` (valid -> calling, or a due retry
    failed -> calling); False if another worker / request got there first."""
    values = {
        PearlCampaignRecipient.status: "calling",
        PearlCampaignRecipient.attempts: func.coalesce(PearlCampaignRecipient.attempts, 0) + 1,
        PearlCampaignRecipient.next_attempt_at: None,
        PearlCampaignRecipient.outcome: None,
        PearlCampaignRecipient.error_reason: None,
    }
    claimed = s.query(PearlCampaignRecipient).filter(
        PearlCampaignRecipient.id == rec_id, PearlCampaignRecipient.status == "valid"
    ).update(values, synchronize_session=False)
    if claimed == 1 or not policy.retries_enabled:
        return claimed == 1
    return s.query(PearlCampaignRecipient).filter(
        PearlCampaignRecipient.id == rec_id,
        PearlCampaignRecipient.status == "failed",
        PearlCampaignRecipient.next_attempt_at.isnot(None),
        PearlCampaignRecipient.next_attempt_at <= now,
        func.coalesce(PearlCampaignRecipient.attempts, 0) < policy.max_attempts,
    ).update(values, synchronize_session=False) == 1


async def _wait_while_running(s: Session, campaign_id: str, seconds: float) -> bool:
    """Sleep ``seconds``, checking the campaign every few seconds; False once it stops running."""
    deadline = time.monotonic() + max(0.0, seconds)
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return True
        await asyncio.sleep(min(remaining, CAMPAIGN_STATUS_POLL_SECONDS))
        status = s.query(PearlCampaign.status).filter(PearlCampaign.id == campaign_id).scalar()
        s.commit()
        if status != "running":
            return False


async def _dispatch_campaign_worker(campaign_id: str):
    """
    Background worker that dials eligible recipients of a running campaign.

    * One worker per campaign per process, and every recipient is claimed atomically
      (valid -> calling, or a due retry failed -> calling) right before dialling, so a
      resumed / duplicated worker can never dial the same person twice.
    * Concurrency governor: at most ``concurrency_limit`` in-flight calls for the campaign
      and ``MAX_SERVER_CONCURRENCY`` across the server.
    * Calling window (``call_settings``, in the campaign's time zone, default Asia/Kolkata):
      no call starts outside it; the campaign stays ``running`` and dialling resumes when the
      window opens. Calls already connected are not cut.
    * Retries: a recipient whose call failed / was busy / unanswered is dialled again after
      the retry interval until it has had ``max_attempts`` calls. With retries the campaign
      completes only once no call that could need a retry is in flight and none is scheduled.
    * Settings are re-read every round, so a pause -> edit -> resume always takes effect.
    * Transactions are closed before every await (no DB transaction held while sleeping).
    * Campaign completed/failed counters are updated by the final carrier event, the
      stale-call healer and dispatch failures - each call is counted once.
    """
    if campaign_id in _running_campaign_workers:
        return
    _running_campaign_workers.add(campaign_id)
    from database import SessionLocal

    s = SessionLocal()
    try:
        try:
            max_server_limit = max(1, int(os.getenv("MAX_SERVER_CONCURRENCY", "20")))
        except ValueError:
            max_server_limit = 20
        announced = None

        while True:
            campaign = s.query(PearlCampaign).filter(PearlCampaign.id == campaign_id).first()
            if not campaign or campaign.status != "running":
                return
            policy = campaign_policy(campaign.call_settings)
            agent_id = campaign.agent_id
            objective = campaign.objective or "Qualify and schedule next steps"
            if not agent_id:
                logger.warning("[Campaign Dispatch] Campaign %s has no agent; pausing", campaign_id[:8])
                campaign.status = "paused"
                s.commit()
                return
            s.commit()
            provider = policy.call_provider
            effective_limit = min(policy.concurrency_limit, max_server_limit)
            if announced != (provider, effective_limit):
                logger.info("[Campaign Dispatch] Campaign %s running via %s (limit %d)", campaign_id[:8], provider, effective_limit)
                announced = (provider, effective_limit)

            # ── CALLING WINDOW ── outside it nothing is dialled; wait (still running) for it to open.
            now = datetime.utcnow()
            if not policy.window_open(now):
                _heal_stale_calls(s)
                wait = (policy.next_window_open(now) - now).total_seconds()
                if not await _wait_while_running(s, campaign_id, min(max(wait, 1.0), CAMPAIGN_WINDOW_POLL_SECONDS)):
                    return
                continue

            recipient_ids = _due_recipient_ids(s, campaign_id, policy, now)
            s.commit()
            if not recipient_ids:
                next_event = _next_campaign_event(s, campaign_id, policy, now)
                s.commit()
                if next_event is None:
                    break  # every recipient has been dialled (and, with retries, settled)
                _heal_stale_calls(s)
                wait = (next_event - now).total_seconds()
                if not await _wait_while_running(s, campaign_id, min(max(wait, 1.0), CAMPAIGN_IDLE_POLL_SECONDS)):
                    return
                continue

            for rec_id in recipient_ids:
                # ── CONCURRENCY THROTTLE GOVERNOR ──
                interrupted = None  # "stopped" | "window_closed"
                while True:
                    status = s.query(PearlCampaign.status).filter(PearlCampaign.id == campaign_id).scalar()
                    if status != "running":
                        interrupted = "stopped"
                        break
                    if not policy.window_open(datetime.utcnow()):
                        interrupted = "window_closed"
                        break
                    _heal_stale_calls(s)
                    active_campaign_calls = s.query(PearlCall).join(
                        PearlCampaignRecipient, PearlCampaignRecipient.call_id == PearlCall.id
                    ).filter(
                        PearlCampaignRecipient.campaign_id == campaign_id,
                        PearlCall.status.in_(IN_FLIGHT_CALL_STATUSES)
                    ).count()
                    global_active_calls = s.query(PearlCall).filter(PearlCall.status.in_(IN_FLIGHT_CALL_STATUSES)).count()
                    s.commit()
                    if active_campaign_calls < effective_limit and global_active_calls < max_server_limit:
                        break
                    await asyncio.sleep(1.0)
                if interrupted is not None:
                    s.commit()
                    if interrupted == "stopped":
                        return
                    # The window closed: the outer loop waits for it to open again. (Never
                    # loop back without yielding - a spin here would stall every live call.)
                    await asyncio.sleep(0.05)
                    break

                # Claim the recipient atomically; skip if someone else did.
                if not _claim_recipient(s, rec_id, policy, datetime.utcnow()):
                    s.commit()
                    continue
                rec = s.query(PearlCampaignRecipient).filter(PearlCampaignRecipient.id == rec_id).first()
                call = PearlCall(agent_id=agent_id, lead_id=rec.lead_id, provider=provider, status="queued")
                s.add(call)
                s.flush()
                rec.call_id = call.id
                s.add(PearlConversation(call_id=call.id, lead_id=rec.lead_id, objective=objective, status="active"))
                call_id, to_number = call.id, rec.normalized_phone
                s.commit()

                res = await _dispatch_outbound_call(provider, to_number, call_id)

                call = s.query(PearlCall).filter(PearlCall.id == call_id).first()
                rec = s.query(PearlCampaignRecipient).filter(PearlCampaignRecipient.id == rec_id).first()
                if res.get("success"):
                    if call is not None:
                        call.provider_call_id = call.provider_call_id or res.get("provider_call_id")
                        if call.status == "queued":  # a fast webhook may already have moved it on
                            call.status = "initiating"
                elif call is None or (call.ended_at is None and call.status != "cancelled"):
                    # (a final carrier event that already settled the call has counted it)
                    err_detail = str(res.get("error") or f"{provider.upper()} Call Request Failed")[:500]
                    if call is not None:
                        call.status = "failed"
                        call.outcome = "failed"
                        call.error_code = err_detail
                    if rec is not None and rec.call_id == call_id:
                        rec.status = "failed"
                        rec.outcome = "failed"
                        rec.error_reason = err_detail[:200]
                        rec.next_attempt_at = policy.retry_due_at(rec.attempts or 1, "failed", datetime.utcnow())
                    s.query(PearlCampaign).filter(PearlCampaign.id == campaign_id).update(
                        {PearlCampaign.failed_calls: func.coalesce(PearlCampaign.failed_calls, 0) + 1},
                        synchronize_session=False
                    )
                s.commit()

                # Pacing interval between dispatches (respecting concurrency limits)
                await asyncio.sleep(policy.pacing_seconds)

        s.query(PearlCampaign).filter(
            PearlCampaign.id == campaign_id, PearlCampaign.status == "running"
        ).update({PearlCampaign.status: "completed", PearlCampaign.completed_at: datetime.utcnow()},
                 synchronize_session=False)
        s.commit()

    except Exception:
        logger.exception("[Campaign Dispatch] Campaign %s worker failed", campaign_id[:8])
        try:
            s.rollback()
            s.query(PearlCampaign).filter(PearlCampaign.id == campaign_id).update(
                {PearlCampaign.status: "failed"}, synchronize_session=False
            )
            s.commit()
        except Exception:
            s.rollback()
    finally:
        s.close()
        _running_campaign_workers.discard(campaign_id)


# ── Vobiz Telephony Webhooks ──────────────────────────────────────────────────

def _vobiz_ids(payload: Dict[str, Any]) -> tuple:
    return tuple(payload.get(k) for k in ("RequestUUID", "CallUUID", "request_uuid", "call_uuid"))


_HANGUP_XML = '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n    <Hangup/>\n</Response>'


@router.api_route("/vobiz/answer", methods=["GET", "POST"])
async def vobiz_answer_webhook(
    request: Request,
    call_id: Optional[str] = None,
    token: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Vobiz answer webhook: invoked by Vobiz when the outbound call connects. Authenticated by
    the per-call ``token`` in the answer_url (or a RequestUUID/CallUUID equal to the stored id).
    Returns VobizXML whose <Stream> connects the call audio to the call's tokenized socket.
    """
    from xml.sax.saxutils import escape

    payload = await _read_carrier_payload(request)
    resolved_call_id = call_id or payload.get("call_id") or payload.get("CustomField")
    call = db.query(PearlCall).filter(PearlCall.id == str(resolved_call_id)).first() if resolved_call_id else None
    authorized = call is not None and (
        verify_carrier_token(call.id, token) or provider_id_matches(call.provider_call_id, *_vobiz_ids(payload))
    )
    if not authorized:
        logger.warning("[Vobiz Webhook] Refused answer webhook for an unknown call or bad token")
        return Response(content=_HANGUP_XML, media_type="application/xml", status_code=403)
    if call.status in TERMINAL_CALL_STATUSES:
        return Response(content=_HANGUP_XML, media_type="application/xml")

    _apply_carrier_event(db, call, CarrierEvent(False, "active", None, True, "answered"), "vobiz")
    ws_url = carrier_audio_stream_url(call.id) or carrier_audio_stream_url(call.id, str(request.base_url))
    logger.debug("[Vobiz Webhook] Call %s answered; connecting stream", call.id[:8])

    xml_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Stream bidirectional="true" audioTrack="inbound" streamTimeout="7200" keepCallAlive="true" contentType="audio/x-l16;rate=8000">{escape(ws_url)}</Stream>
</Response>"""
    return Response(content=xml_content, media_type="application/xml")


@router.api_route("/vobiz/events", methods=["GET", "POST"])
async def vobiz_events_webhook(
    request: Request,
    call_id: Optional[str] = None,
    token: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Vobiz call event webhook (hangup_url). Authenticated like the answer webhook.
    Only final events (Hangup / terminal CallStatus / a HangupCause) end the call and its
    campaign recipient; progress events never mark recipients failed. Idempotent.
    """
    payload = await _read_carrier_payload(request)
    event_call_id = call_id or payload.get("call_id") or payload.get("CustomField")
    if not event_call_id:
        raise HTTPException(400, "Missing call id")
    call = db.query(PearlCall).filter(PearlCall.id == str(event_call_id)).first()
    if not call:
        raise HTTPException(404, "Call not found")
    if not (verify_carrier_token(call.id, token) or provider_id_matches(call.provider_call_id, *_vobiz_ids(payload))):
        raise HTTPException(403, "Invalid carrier credentials for this call")

    ev = parse_vobiz_event(payload)
    result = _apply_carrier_event(db, call, ev, "vobiz")
    logger.debug("[Vobiz Events] call=%s final=%s status=%s result=%s", call.id[:8], ev.final, ev.status, result)
    return {"status": "ok", "result": result}


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



    agent = db.query(PearlAgent).filter(
        PearlAgent.id == campaign.agent_id, PearlAgent.user_id == user.id
    ).first()

    if not agent:

        raise HTTPException(400, "Selected Agent does not exist")



    # Count eligible recipients

    eligible_count = db.query(PearlCampaignRecipient).filter(

        PearlCampaignRecipient.campaign_id == campaign_id,

        PearlCampaignRecipient.status == "valid"

    ).count()



    if eligible_count == 0:

        raise HTTPException(400, "Cannot launch campaign: no eligible recipients found. Please import or enable at least one valid recipient.")



    # Validate call_settings (carrier, calling window, time zone, retries) and the carrier
    policy = _launchable_policy(campaign)

    # Transition campaign to running (atomic: two concurrent launches can't both start workers)
    started = db.query(PearlCampaign).filter(
        PearlCampaign.id == campaign.id,
        PearlCampaign.status.notin_(("running", "completed"))
    ).update({
        PearlCampaign.status: "running",
        PearlCampaign.started_at: datetime.utcnow(),
        PearlCampaign.eligible_recipients: eligible_count,
    }, synchronize_session=False)
    db.commit()
    if started != 1:
        raise HTTPException(409, "Campaign is already running")
    db.refresh(campaign)

    # Dispatch via background task worker

    background_tasks.add_task(_dispatch_campaign_worker, campaign.id)

    now = datetime.utcnow()
    message = f"Campaign '{campaign.name}' launched successfully with {eligible_count} recipients."
    if not policy.window_open(now):
        message += f" Calls start when the calling window opens ({policy.window.label()})."

    return {

        "ok": True,

        "message": message,

        "campaign": campaign_to_dict(campaign),

        "calling_window": policy.window.to_dict(now) if policy.window is not None else None,

    }


def _launchable_policy(campaign: PearlCampaign) -> CampaignPolicy:
    """The campaign's dialing policy, or 400 with a clear message when its call_settings can't
    be dialled (unsupported call_provider, unknown time zone, malformed window or retry values)
    or the selected carrier isn't configured on this server."""
    try:
        policy = campaign_policy(campaign.call_settings, strict=True)
    except CallSettingsError as exc:
        raise HTTPException(400, str(exc))
    if policy.call_provider == "exotel":
        if not all(os.getenv(k) for k in ("EXOTEL_ACCOUNT_SID", "EXOTEL_API_KEY", "EXOTEL_API_TOKEN")):
            raise HTTPException(
                400,
                "Telephony gateway unready: Exotel API credentials (EXOTEL_ACCOUNT_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN) are missing from server configuration."
            )
    elif not all(os.getenv(k) for k in ("VOBIZ_AUTH_ID", "VOBIZ_AUTH_SECRET")):
        raise HTTPException(
            400,
            "Telephony gateway unready: Vobiz API credentials (VOBIZ_AUTH_ID, VOBIZ_AUTH_SECRET) are missing from server configuration."
        )
    return policy





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

    """Resume a paused campaign.

    Also restarts the dialer of a ``running`` campaign that has none in this server process
    (e.g. after a restart): ``{"ok": true, "status": "running", "reattached": true}``.
    """

    campaign = db.query(PearlCampaign).filter(

        PearlCampaign.id == campaign_id,

        PearlCampaign.user_id == user.id

    ).first()

    if not campaign:

        raise HTTPException(404, "Campaign not found")

    if campaign.status == "running":
        if campaign.id in _running_campaign_workers:
            raise HTTPException(400, "Only paused campaigns can be resumed")
        _launchable_policy(campaign)
        background_tasks.add_task(_dispatch_campaign_worker, campaign.id)
        return {"ok": True, "status": "running", "reattached": True}

    if campaign.status != "paused":
        raise HTTPException(400, "Only paused campaigns can be resumed")
    if not campaign.agent_id:
        raise HTTPException(400, "Please select an Agent for this campaign before resuming")
    _launchable_policy(campaign)

    resumed = db.query(PearlCampaign).filter(
        PearlCampaign.id == campaign.id, PearlCampaign.status == "paused"
    ).update({PearlCampaign.status: "running"}, synchronize_session=False)
    db.commit()
    if resumed != 1:
        raise HTTPException(400, "Only paused campaigns can be resumed")

    background_tasks.add_task(_dispatch_campaign_worker, campaign.id)

    return {"ok": True, "status": "running"}





@router.get("/campaigns/{campaign_id}/status")

def get_campaign_status(

    campaign_id: str,

    db: Session = Depends(get_db),

    user: User = Depends(get_current_user)

):

    """Retrieve real-time campaign status and live metrics.

    Besides the recipient counts: ``retry_scheduled`` / ``next_retry_at`` (failed recipients
    waiting for another attempt), ``calling_window`` (``{start, end, timezone, open,
    next_open_at}`` or null = no restriction), ``dialing_state`` while running
    (``dialing`` | ``waiting_for_window`` | ``waiting_for_retry`` | ``waiting_for_calls``, else
    null) and ``dialer_active`` (this server process is dialling the campaign).
    """

    campaign = db.query(PearlCampaign).filter(

        PearlCampaign.id == campaign_id,

        PearlCampaign.user_id == user.id

    ).first()

    if not campaign:

        raise HTTPException(404, "Campaign not found")

    counts = _recipient_status_counts(db, campaign_id)
    total = sum(counts.values())
    completed, calling, failed = counts.get("completed", 0), counts.get("calling", 0), counts.get("failed", 0)

    now = datetime.utcnow()
    policy = campaign_policy(campaign.call_settings)
    retry_q = _retry_scheduled_q(db, campaign_id)
    retry_scheduled = retry_q.count()
    next_retry_at = db.query(func.min(PearlCampaignRecipient.next_attempt_at)).filter(
        PearlCampaignRecipient.campaign_id == campaign_id,
        PearlCampaignRecipient.status == "failed",
        PearlCampaignRecipient.next_attempt_at.isnot(None),
    ).scalar()

    dialing_state = None
    if campaign.status == "running":
        retry_due = policy.retries_enabled and next_retry_at is not None and next_retry_at <= now
        if not policy.window_open(now):
            dialing_state = "waiting_for_window"
        elif counts.get("valid", 0) > 0 or retry_due:
            dialing_state = "dialing"
        elif retry_scheduled and policy.retries_enabled:
            dialing_state = "waiting_for_retry"
        elif calling:
            dialing_state = "waiting_for_calls"
        else:
            dialing_state = "dialing"

    return {

        "status": campaign.status,

        "total_recipients": total,

        "eligible_recipients": campaign.eligible_recipients,

        "completed": completed,

        "calling": calling,

        "failed": failed,

        "retry_scheduled": retry_scheduled,

        "next_retry_at": utc_iso(next_retry_at),

        "calling_window": policy.window.to_dict(now) if policy.window is not None else None,

        "dialing_state": dialing_state,

        "dialer_active": campaign.id in _running_campaign_workers,

        "started_at": campaign.started_at.isoformat() if campaign.started_at else None,

        "completed_at": campaign.completed_at.isoformat() if campaign.completed_at else None

    }


# ── Sage · AI Agent Architect Endpoint ───────────────────────────────────

@router.post("/sage/chat")
async def sage_chat_endpoint(
    req: SageChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Sage · AI Agent Architect
    Powered by Qwen (qwen/qwen3.8-27b via Groq) with intelligent heuristic fallback.
    Delivers multi-step architectural reasoning, context-aware call cut & objection calibration,
    interactive decision cards, and live agent configuration patches.
    """
    from services.pearl.sage_service import run_sage_conversation
    response = await run_sage_conversation(
        messages=req.messages,
        query=req.query,
        agent_state=req.agent_state or {},
        user_id=current_user.id,
        db=db
    )
    return response


@router.post("/sage/feedback")
async def sage_feedback_endpoint(
    req: SageFeedbackRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Store or log user feedback and suggestions regarding Sage AI Agent Architect.
    """
    logger.info(
        "[Sage Feedback] user=%s agent_id=%s category=%s notes_len=%d",
        current_user.id, req.agent_id, req.category, len(req.notes or "")
    )
    return {"status": "ok", "message": "Feedback received by Clozflow engineering."}


# ── Agent Tools Endpoints (API Tool, Validator, Verifier, Mock, MCP) ─────────

class CreateAgentToolRequest(BaseModel):
    name: str
    tool_type: str  # api_tool | data_validator | data_verifier | mock_api | mcp
    description: Optional[str] = None
    run_timing: Optional[str] = "conversation"  # call_start | conversation | call_end
    run_mode: Optional[str] = "write"  # "write" (Pattern A: async non-blocking) | "read" (Pattern B: filler + live lookup)
    is_read_tool: Optional[bool] = None
    is_async_write: Optional[bool] = None
    timeout_seconds: Optional[int] = 10
    fallback_response: Optional[str] = None
    config: Optional[dict] = None
    is_active: Optional[bool] = True


class UpdateAgentToolRequest(BaseModel):
    name: Optional[str] = None
    tool_type: Optional[str] = None
    description: Optional[str] = None
    run_timing: Optional[str] = None
    run_mode: Optional[str] = None
    is_read_tool: Optional[bool] = None
    is_async_write: Optional[bool] = None
    timeout_seconds: Optional[int] = None
    fallback_response: Optional[str] = None
    config: Optional[dict] = None
    is_active: Optional[bool] = None


class TestAgentToolRequest(BaseModel):
    tool_id: Optional[str] = None
    tool_type: Optional[str] = None
    config: Optional[dict] = None
    test_input: Optional[dict] = None
    timeout_seconds: Optional[int] = 10


class ParseCurlRequest(BaseModel):
    curl_command: str


_VALID_TOOL_TYPES = ("api_tool", "data_validator", "data_verifier", "mock_api", "mcp")
# Agent ids the editors use for tools of an agent that isn't saved yet.
_UNSAVED_AGENT_IDS = ("test_sandbox", "draft")


@router.get("/agents/{agent_id}/tools")
def list_agent_tools(
    agent_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all tools configured for a Pearl agent."""
    _get_owned_agent(db, agent_id, current_user)

    tools = db.query(AgentTool).filter(AgentTool.agent_id == agent_id).order_by(AgentTool.created_at.asc()).all()
    return [tool_to_dict(t) for t in tools]


@router.post("/agents/{agent_id}/tools")
def create_agent_tool(
    agent_id: str,
    req: CreateAgentToolRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new tool for a Pearl agent."""
    _get_owned_agent(db, agent_id, current_user)

    if req.tool_type not in _VALID_TOOL_TYPES:
        raise HTTPException(400, f"Invalid tool_type '{req.tool_type}'. Must be one of: {', '.join(_VALID_TOOL_TYPES)}")

    if not req.name or not req.name.strip():
        raise HTTPException(400, "Tool name cannot be empty")

    cfg = req.config
    if isinstance(cfg, str):
        try:
            cfg = json.loads(cfg)
        except Exception:
            cfg = {}
    elif not isinstance(cfg, dict):
        cfg = {}

    # Resolve tool execution mode (Pattern A write vs Pattern B read)
    mode = "write"
    if req.run_mode is not None and str(req.run_mode).strip():
        mode = str(req.run_mode).lower().strip()
    elif req.is_read_tool is True:
        mode = "read"
    elif req.is_async_write is False:
        mode = "read"
    elif isinstance(cfg, dict):
        if cfg.get("run_mode"):
            mode = str(cfg["run_mode"]).lower().strip()
        elif cfg.get("is_read_tool") is True:
            mode = "read"
    if mode not in ("write", "read"):
        mode = "write"

    tool = AgentTool(
        agent_id=agent_id,
        name=req.name.strip(),
        tool_type=req.tool_type,
        description=req.description,
        run_timing=req.run_timing or "conversation",
        run_mode=mode,
        timeout_seconds=req.timeout_seconds or 10,
        fallback_response=req.fallback_response,
        config=cfg,
        is_active=True if req.is_active is None else req.is_active
    )
    db.add(tool)
    db.commit()
    db.refresh(tool)

    return tool_to_dict(tool)


@router.get("/agents/{agent_id}/tools/{tool_id}")
def get_agent_tool(
    agent_id: str,
    tool_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Retrieve details of a specific tool."""
    tool = _get_owned_tool(db, agent_id, tool_id, current_user)

    return tool_to_dict(tool)


@router.put("/agents/{agent_id}/tools/{tool_id}")
def update_agent_tool(
    agent_id: str,
    tool_id: str,
    req: UpdateAgentToolRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update configuration of an existing tool."""
    tool = _get_owned_tool(db, agent_id, tool_id, current_user)

    if req.name is not None:
        trimmed = req.name.strip()
        if not trimmed:
            raise HTTPException(400, "Tool name cannot be empty")
        tool.name = trimmed
    if req.tool_type is not None:
        if req.tool_type not in _VALID_TOOL_TYPES:
            raise HTTPException(400, f"Invalid tool_type '{req.tool_type}'. Must be one of: {', '.join(_VALID_TOOL_TYPES)}")
        tool.tool_type = req.tool_type
    if req.description is not None:
        tool.description = req.description
    if req.run_timing is not None:
        tool.run_timing = req.run_timing
    if req.run_mode is not None or req.is_read_tool is not None or req.is_async_write is not None:
        if req.run_mode is not None and str(req.run_mode).strip():
            m = str(req.run_mode).lower().strip()
            tool.run_mode = "read" if m == "read" else "write"
        elif req.is_read_tool is not None:
            tool.run_mode = "read" if req.is_read_tool else "write"
        elif req.is_async_write is not None:
            tool.run_mode = "write" if req.is_async_write else "read"
    if req.timeout_seconds is not None:
        tool.timeout_seconds = req.timeout_seconds
    if req.fallback_response is not None:
        tool.fallback_response = req.fallback_response
    if req.config is not None:
        upd_cfg = req.config
        if isinstance(upd_cfg, str):
            try:
                upd_cfg = json.loads(upd_cfg)
            except Exception:
                upd_cfg = {}
        elif not isinstance(upd_cfg, dict):
            upd_cfg = {}
        tool.config = upd_cfg
        # If run_mode was not explicitly supplied at top level, inspect config payload
        if req.run_mode is None and req.is_read_tool is None and req.is_async_write is None and isinstance(upd_cfg, dict):
            if upd_cfg.get("run_mode"):
                tool.run_mode = "read" if str(upd_cfg["run_mode"]).lower().strip() == "read" else "write"
            elif upd_cfg.get("is_read_tool") is not None:
                tool.run_mode = "read" if upd_cfg["is_read_tool"] else "write"
            elif upd_cfg.get("is_async_write") is not None:
                tool.run_mode = "write" if upd_cfg["is_async_write"] else "read"
    if req.is_active is not None:
        tool.is_active = req.is_active

    tool.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(tool)

    return tool_to_dict(tool)


@router.patch("/agents/{agent_id}/tools/{tool_id}")
def patch_agent_tool(
    agent_id: str,
    tool_id: str,
    req: UpdateAgentToolRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Partially update tool attributes, e.g. toggle is_active status."""
    return update_agent_tool(agent_id, tool_id, req, db, current_user)


@router.delete("/agents/{agent_id}/tools/{tool_id}")
def delete_agent_tool(
    agent_id: str,
    tool_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Remove a tool from an agent."""
    tool = _get_owned_tool(db, agent_id, tool_id, current_user)

    db.delete(tool)
    db.commit()

    return {"ok": True, "deleted_id": tool_id}


@router.post("/tools/test")
@router.post("/agents/{agent_id}/tools/test")
async def test_agent_tool_endpoint(
    req: TestAgentToolRequest,
    agent_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Live test tool execution endpoint.
    Executes real HTTP requests for api_tool, regex format checking for data_validator,
    database comparison for data_verifier, simulated responses for mock_api, and MCP checks.
    """
    from services.pearl.tool_engine import run_tool_test

    target_type = req.tool_type
    target_config = req.config or {}
    timeout = req.timeout_seconds or 10

    if agent_id and agent_id not in _UNSAVED_AGENT_IDS:
        _get_owned_agent(db, agent_id, current_user)

    # If tool_id provided, merge with the caller's stored tool if not explicitly overridden
    if req.tool_id:
        tool_q = db.query(AgentTool).join(PearlAgent, AgentTool.agent_id == PearlAgent.id).filter(
            AgentTool.id == req.tool_id,
            PearlAgent.user_id == current_user.id
        )
        if agent_id and agent_id not in _UNSAVED_AGENT_IDS:
            tool_q = tool_q.filter(AgentTool.agent_id == agent_id)
        tool = tool_q.first()
        if tool:
            if not target_type:
                target_type = tool.tool_type
            if not target_config:
                target_config = tool.config or {}
            if not req.timeout_seconds:
                timeout = tool.timeout_seconds or 10

    if not target_type:
        raise HTTPException(400, "tool_type is required for testing")

    result = await run_tool_test(
        tool_type=target_type,
        config=target_config,
        test_input=req.test_input or {},
        timeout_seconds=timeout
    )
    return result


@router.post("/tools/parse-curl")
@router.post("/agents/{agent_id}/tools/parse-curl")
def parse_curl_endpoint(
    req: ParseCurlRequest,
    agent_id: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Parse raw cURL command into structured API tool configuration."""
    from services.pearl.tool_engine import parse_curl_command
    parsed = parse_curl_command(req.curl_command or "")
    has_url = bool(parsed.get("url"))
    return {
        "success": has_url,
        "data": parsed,
        **parsed
    }




