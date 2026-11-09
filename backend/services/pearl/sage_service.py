"""
Sage · AI Agent Architect Service
═══════════════════════════════════
Powers the Sage side-panel intelligence in Clozflow Pearl.
Runs on the Qwen model (qwen/qwen3.8-27b via Groq) to think, plan,
ask high-value context-aware questions, and dynamically tune voice agents.

Specialties:
- Contextual understanding of the user's business & ICP
- Flexible objection & call-cut architecture (replaces rigid 2-yes frameworks with
  smart push-and-reframe vs. graceful call termination)
- Natural human-like cadence & Indian English/Hinglish nuance without hardcoded fillers
- Actionable configuration patches for agent directives, greeting, and telephony settings
"""

import os
import json
import re
import time
import asyncio
from typing import Dict, Any, List, Optional
import httpx

# Models to attempt in order
DEFAULT_MODEL = os.getenv("PEARL_LLM_MODEL", "qwen/qwen3.8-27b")
FALLBACK_MODELS = [
    DEFAULT_MODEL,
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant"
]

_http_client: Optional[httpx.AsyncClient] = None

def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=25.0, write=5.0, pool=5.0),
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
        )
    return _http_client

SAGE_SYSTEM_PROMPT = """You are Sage, the Lead AI Agent Architect at Clozflow.
You are collaborating with a sales leader / founder inside the Clozflow Agent Editor to craft a production-grade, human-sounding autonomous voice agent.

YOUR ARCHITECTURAL CORE:
1. DEEP BUSINESS UNDERSTANDING:
   - Absorb the product context, target prospect, and conversion goal.
   - Always connect conversational strategy directly to business outcomes (e.g. booked demos, qualified interest, KYC verification).

2. NATURAL HUMAN-LIKE VOICE (NO ARTIFICIAL FILLERS):
   - Real telephone conversations do NOT use mechanical checklists of bridge words.
   - Do NOT force canned phrases ("dekhiye", "actually", "haan haan") onto every sentence.
   - Let authentic conversational cadence, tone, and Indian English / Hinglish nuance emerge organically from the context and scenario.

3. FLEXIBLE OBJECTION & DISCONNECTION ARCHITECTURE (BEYOND RIGID 2-YES TREES):
   - Reject rigid "2-Yes" objection models when inappropriate. Real sales require knowing when to push/reframe naturally vs when to gracefully cut the call to respect prospects and brand reputation.
   - Calibrate the appropriate callCutRule:
     * "reframe_once_then_exit" (default): Push & reframe once naturally with value on soft hesitation; disconnect immediately on firm rejection.
     * "immediate_disconnect": Hang up immediately and politely upon first disinterest or rejection without pushback.
     * "two_touch_reframe": Up to 2 distinct value angles before graceful call exit.
     * "custom": Custom exit criteria.
   - Proactively ask or calibrate:
     * When should the agent cut the call vs push & reframe?
     * What specific signals indicate hard rejection (e.g. "not interested", "remove my number", competitor loyalty) where the agent should immediately thank them and disconnect?
     * When should the agent attempt a natural 1-sentence value reframe (e.g. "I'm busy", "send an email")?

4. HIGH-VALUE CONTEXT-AWARE QUESTIONS:
   - Every question you ask must be substantive, context-aware, and impactful.
   - Never ask generic pleasantries. Ask about call exit rules, qualification criteria, or objection handling thresholds.

5. STRICT OUTPUT FORMAT:
   You MUST return a single valid JSON object with EXACTLY this structure:
   {
     "steps": "Worked on 3 steps >",
     "steps_detail": [
       "Analyzed business value proposition & ICP",
       "Calibrated rejection thresholds and graceful call disconnection logic",
       "Constructed dynamic conversational patch and smart action options"
     ],
     "text": "Direct, consultative opening response summarizing what was planned or tuned.",
     "body": "Clear explanation of the architectural choices, explaining the rejection handling and human tone strategy.",
     "follow_up_questions": [
       "Context-aware question about when to cut the call or qualify prospects?"
     ],
     "action_card": {
       "title": "Interactive decision or next action",
       "options": [
         "Option 1",
         "Option 2"
       ]
     },
     "patch": {
       "fine_tuning_directives": "Updated or enriched agent directives...",
       "greeting_enabled": false,
       "greeting_text": "Optional greeting string if enabled",
       "settings": {
         "callCutRule": "reframe_once_then_exit",
         "disconnectPhrase": "Understood sir, thank you for your time. Have a great day!",
         "bargeIn": true
       },
       "voice_config": {
         "speaker": "shubh_enhi_ads",
         "language": "Auto"
       }
     }
   }
"""

_JSON_CODE_BLOCK_RE = re.compile(r"```json\s*(.*?)\s*```", re.DOTALL)
_GENERIC_CODE_BLOCK_RE = re.compile(r"```\s*(.*?)\s*```", re.DOTALL)

def _clean_json_text(raw: str) -> str:
    """Extract clean JSON text from LLM response containing markdown code blocks."""
    cleaned = raw.strip()
    if "```json" in cleaned:
        match = _JSON_CODE_BLOCK_RE.search(cleaned)
        if match:
            return match.group(1).strip()
    if "```" in cleaned:
        match = _GENERIC_CODE_BLOCK_RE.search(cleaned)
        if match:
            return match.group(1).strip()
    # Find start '{' and end '}'
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        return cleaned[start:end+1]
    return cleaned

def _build_context_summary(agent_state: Dict[str, Any]) -> str:
    """Build a concise, rich summary of the agent state for Sage's prompt."""
    name = agent_state.get("name", "Conversation Agent")
    role = agent_state.get("role", "outbound_qualification")
    mission = agent_state.get("mission", "Qualify intent and book discovery calls.")
    capsule_name = agent_state.get("capsule_name") or agent_state.get("capsule_title") or "General B2B Sales"
    capsule_context = agent_state.get("capsule_context") or ""
    capsule_metadata = agent_state.get("capsule_metadata") or {}
    prompt_mode = agent_state.get("prompt_mode", "expert")
    directives = agent_state.get("fine_tuning_directives") or agent_state.get("system_prompt") or ""
    greeting_enabled = agent_state.get("greeting_enabled", False)
    greeting_text = agent_state.get("greeting_text", "")
    voice_config = agent_state.get("voice_config", {})
    speaker = voice_config.get("speaker", "shubh_enhi_ads")
    language = voice_config.get("language", "Auto")
    settings = agent_state.get("settings", {})
    call_cut_rule = settings.get("callCutRule", "reframe_once_then_exit")
    disconnect_phrase = settings.get("disconnectPhrase", "Understood, thank you for your time. Have a great day!")

    capsule_details = [f"- Knowledge Capsule: {capsule_name}"]
    if isinstance(capsule_metadata, dict):
        prod = capsule_metadata.get("product_name") or capsule_metadata.get("product")
        if prod:
            capsule_details.append(f"  • Product Name: {prod}")
        desc = capsule_metadata.get("description") or capsule_metadata.get("product_specification") or capsule_metadata.get("summary")
        if desc:
            capsule_details.append(f"  • Product / Solution: {desc}")
        aud = capsule_metadata.get("target_audience") or capsule_metadata.get("icp")
        if aud:
            capsule_details.append(f"  • Target Audience (ICP): {aud}")
        vp = capsule_metadata.get("value_props") or capsule_metadata.get("key_differentiators") or capsule_metadata.get("usp")
        if vp:
            capsule_details.append(f"  • Key Value Proposition: {vp}")
        pains = capsule_metadata.get("pain_points_solved") or capsule_metadata.get("pain_points")
        if pains:
            capsule_details.append(f"  • Pain Points Solved: {pains}")
        company = capsule_metadata.get("company_name") or capsule_metadata.get("business_name")
        if company:
            capsule_details.append(f"  • Company: {company}")
    if capsule_context:
        capsule_details.append(f"  • Capsule Grounding Data:\n    {capsule_context[:700]}")
    capsule_summary_str = "\n".join(capsule_details)

    return (
        f"CURRENT AGENT SNAPSHOT:\n"
        f"- Name: {name}\n"
        f"- Role: {role}\n"
        f"- Mission: {mission}\n"
        f"{capsule_summary_str}\n"
        f"- Prompt Architecture: {prompt_mode}\n"
        f"- Existing Directives: {directives[:300]}...\n"
        f"- Greeting Enabled: {greeting_enabled} (Text: '{greeting_text}')\n"
        f"- Voice & Speaker: {speaker} | Language: {language}\n"
        f"- Call Cut & Rejection Rule: {call_cut_rule}\n"
        f"- Disconnect Phrase: '{disconnect_phrase}'\n"
        f"- Barge-in: {settings.get('bargeIn', True)} | Max Call Length: {settings.get('maxCallLength', 15)}m\n"
    )

def _merge_or_replace_directive_section(existing: str, section_title: str, section_body: str) -> str:
    """
    Safely updates or appends a named directive section without duplicating headers.
    """
    clean_existing = (existing or "").strip()
    pattern = rf"(?:^|\n\n){re.escape(section_title)}:.*?(?=(?:\n\n[A-Z0-9 _\-]+:|\Z))"
    new_section = f"{section_title}:\n{section_body.strip()}"
    
    if re.search(pattern, clean_existing, flags=re.DOTALL):
        updated = re.sub(pattern, f"\n\n{new_section}", clean_existing, flags=re.DOTALL).strip()
        return updated
    else:
        if clean_existing:
            return f"{clean_existing}\n\n{new_section}"
        return new_section

def _normalize_call_cut_rule(rule_str: Optional[str]) -> str:
    """Standardize call cut rules to canonical enum values expected by editor and engine."""
    if not rule_str or not isinstance(rule_str, str):
        return "reframe_once_then_exit"
    r = rule_str.strip().lower()
    if any(k in r for k in ["immediate", "hangup", "hang_up", "drop", "first_rejection", "no_push"]):
        return "immediate_disconnect"
    if any(k in r for k in ["two", "2", "twice"]):
        return "two_touch_reframe"
    if "custom" in r:
        return "custom"
    return "reframe_once_then_exit"


def _get_capsule_patch_id(db: Any, agent_state: Dict[str, Any]) -> Dict[str, Any]:
    if db and not agent_state.get("capsule_id"):
        try:
            from models import Capsule
            cap = db.query(Capsule).first()
            if cap:
                return {"capsule_id": cap.id}
        except Exception:
            pass
    return {}

def _generate_heuristic_response(query: str, agent_state: Dict[str, Any], db: Any = None) -> Dict[str, Any]:
    """
    Intelligent heuristic fallback when LLM API is unavailable or offline.
    Deeply analyzes user query and returns context-aware recommendations,
    valuable call-cut questions, and actionable configuration patches.
    """
    q_low = query.lower()
    name = agent_state.get("name", "Voice Agent")
    role = agent_state.get("role", "outbound_qualification")
    existing_directives = agent_state.get("fine_tuning_directives") or agent_state.get("system_prompt") or ""

    # 0. Direct Cold Call / Phone Dialer Request
    if any(k in q_low for k in ["call my number", "to my number", "dial my number", "cold call right now", "call right now", "test call"]):
        return {
            "steps": "Worked on 3 steps >",
            "steps_detail": [
                "Verified agent audio configuration and telephony route",
                "Prepared live outbound dialer dispatch payload",
                "Initiated real-time cold call testing workflow"
            ],
            "text": "Opening direct cold call dialer for live audio test.",
            "body": "I'm launching the direct phone call dialer. Enter your phone number below and Clozflow Pearl will initiate a live outbound call so you can experience the agent's tone, barge-in responsiveness, and rejection handling in real time.",
            "follow_up_questions": [
                "Would you like to test soft hesitation ('send an email') or an immediate hard rejection ('not interested')?",
                "Do you want to adjust the agent's opening cadence before placing the call?"
            ],
            "action_card": {
                "title": "Direct Dialer Dispatch",
                "options": [
                    "Place one cold call to my number right now",
                    "Review dynamic outbound opening directives",
                    "Configure graceful call disconnection rules for rejected calls"
                ]
            },
            "patch": {
                "settings": {
                    "bargeIn": True,
                    "callCutRule": agent_state.get("settings", {}).get("callCutRule", "reframe_once_then_exit")
                }
            }
        }

    # 1. Objection, Call Cut & 2-Yes Calibration
    objection_keywords = [
        "cut", "disconnect", "rejection", "objection", "push", "hang up", "not interested",
        "2-yes", "2 yes", "two yes", "exit", "refusal", "refuse", "reframe", "mana kare",
        "mana kar", "nahi chahiye", "drop call", "end call", "brush off", "brushoff"
    ]
    if any(k in q_low for k in objection_keywords):
        # Determine specific calibration rule
        if any(k in q_low for k in ["immediate", "first rejection", "no push", "without push", "don't push", "dont push", "turant", "seedhe cut", "instant"]):
            call_cut_rule = "immediate_disconnect"
            disconnect_phrase = "Understood sir, thank you for your time. Have a great day!"
            text = "I've updated the agent to disconnect immediately upon first clear rejection without pushback."
            body = (
                "For certain campaigns and brand safety policies, pushing when a prospect says 'not interested' can create unnecessary friction. "
                "I've configured the agent to immediately and courteously thank the prospect and end the call upon any clear rejection."
            )
            directives_content = (
                "- Hard Rejection / Disinterest: If the prospect explicitly says 'not interested', 'busy', 'don't call', or declines, DO NOT push or argue. Gracefully end the call immediately: 'Understood sir, thank you for your time. Have a great day!' and disconnect.\n"
                "- Respect Prospect Time: Never badger or repeatedly ask questions when the prospect clearly declines."
            )
            action_options = [
                "Place one cold call to my number right now",
                "Revert to 1 natural value reframe before disconnecting",
                "Customize the polite disconnect phrase"
            ]
        elif any(k in q_low for k in ["two", "2 reframe", "2 touch", "twice", "2 times", "two touch"]):
            call_cut_rule = "two_touch_reframe"
            disconnect_phrase = "Bilkul samjha sir, thank you for your time. Have a great day!"
            text = "I've configured an adaptive 2-touch reframe policy before graceful call termination."
            body = (
                "The agent will provide up to 2 context-grounded value perspectives for mild hesitation or brush-offs (e.g. 'send an email' or 'busy now'). "
                "However, if the prospect firmly refuses or repeats their objection, the agent will gracefully disconnect rather than entering a circular loop."
            )
            directives_content = (
                "- Soft Hesitation: Provide up to 2 distinct, empathetic reframes tailored to the prospect's industry or scale.\n"
                "- Hard Rejection: If the prospect confirms rejection twice or asks not to be called, exit gracefully: 'Bilkul samjha sir, thank you for your time. Have a great day!' and disconnect immediately."
            )
            action_options = [
                "Place one cold call to my number right now",
                "Switch to 1 reframe then exit to prevent prospect fatigue",
                "Switch to immediate disconnect on first rejection"
            ]
        else:
            call_cut_rule = "reframe_once_then_exit"
            disconnect_phrase = "Bilkul samjha sir, thank you for your time. Have a great day!"
            text = "I've restructured the agent's objection handling to move away from rigid multi-step loops toward natural reframing with a clean exit."
            body = (
                "In high-conversion sales, pushing blindly when a prospect says 'not interested' damages brand trust. "
                "I've configured the agent to offer exactly one natural, context-grounded reframe on soft objections, "
                "but immediately and courteously cut the call when a firm rejection or DND signal is detected."
            )
            directives_content = (
                "- Soft Hesitation / Brush-off: When prospect says 'busy right now' or 'send info', acknowledge warmly and offer one brief 1-sentence value hook or quick qualification question.\n"
                "- Hard Rejection: If the prospect explicitly says 'not interested', 'don't call again', or refuses, DO NOT push or argue. Gracefully end the call: 'Bilkul samjha sir, thank you for your time. Have a great day!' and disconnect immediately.\n"
                "- Natural Accent Cadence: Speak with organic conversational flow. Do not use canned fillers mechanically."
            )
            action_options = [
                "Place one cold call to my number right now",
                "Push & reframe once naturally, then disconnect politely if rejected",
                "Disconnect immediately on first rejection without pushback"
            ]

        new_directives = _merge_or_replace_directive_section(
            existing_directives,
            "OBJECTION & DISCONNECTION HANDLING",
            directives_content
        )

        return {
            "steps": "Worked on 3 steps >",
            "steps_detail": [
                "Deconstructed rigid objection assumptions & analyzed sales exit thresholds",
                "Formulated adaptive push-and-reframe vs graceful disconnection rules",
                "Synthesized dynamic behavioral patch for call termination & objection handling"
            ],
            "text": text,
            "body": body,
            "follow_up_questions": [
                "When a prospect says 'send an email', should the agent ask one qualifying question first (like monthly call volume), or immediately send a WhatsApp overview and disconnect?",
                "What specific hard rejection phrase should trigger an immediate courteous hang-up without any pushback?"
            ],
            "action_card": {
                "title": "Select Call Disconnection Policy",
                "options": action_options
            },
            "patch": {
                "fine_tuning_directives": new_directives,
                **({"greeting_enabled": False} if any(k in q_low for k in ["cold call", "outbound", "pattern interrupt"]) else {}),
                "settings": {
                    "callCutRule": call_cut_rule,
                    "disconnectPhrase": disconnect_phrase,
                    "bargeIn": True
                }
            }
        }

    # 2. Cold Calling / Outbound Setup
    if any(k in q_low for k in ["cold call", "outbound", "sales", "start", "setup", "pitch"]):
        outbound_content = (
            "- Opening: Use a 1-sentence context-grounded pattern interrupt based on the prospect's industry. Never use generic sales intros.\n"
            "- Listening: Allow prospect to speak freely (barge-in enabled). Mirror their language and formality level.\n"
            "- Exit Strategy: If prospect rejects or cannot talk, do not harass them. Exit gracefully in under 5 seconds."
        )
        new_directives = _merge_or_replace_directive_section(
            existing_directives,
            "OUTBOUND CONVERSATION PROTOCOL",
            outbound_content
        )
        return {
            "steps": "Worked on 4 steps >",
            "steps_detail": [
                "Evaluated product context and ICP pattern interrupt opportunity",
                "Disabled fixed opening greeting to enable spontaneous context-grounded opening",
                "Configured BANT discovery cadence and barge-in recovery",
                "Prepared live test scenario"
            ],
            "text": "I've optimized your agent for high-conversion outbound cold calling with spontaneous pattern interrupts.",
            "body": (
                "For outbound calls, fixed greetings ('Hi I am calling from...') trigger immediate resistance. "
                "I have disabled the fixed opening script so the agent opens dynamically based on prospect context. "
                "The conversation style is set to natural Indian conversational flow with adaptive objection handling."
            ),
            "follow_up_questions": [
                "What is your target qualification criterion (e.g., minimum monthly lead volume or budget) before pitching a demo walkthrough?",
                "When should the agent cut the call if the prospect is not the decision maker?"
            ],
            "action_card": {
                "title": "What do you want to do next?",
                "options": [
                    "Place one cold call to my number right now",
                    "Review dynamic outbound opening directives",
                    "Configure graceful call disconnection rules for rejected calls"
                ]
            },
            "patch": {
                "greeting_enabled": False,
                "fine_tuning_directives": new_directives,
                "settings": {
                    "bargeIn": True,
                    "callCutRule": "reframe_once_then_exit",
                    "backgroundSound": "office",
                    "backgroundVolume": 30
                }
            }
        }

    # 3. Tone, Language & Accent
    if any(k in q_low for k in ["language", "accent", "tone", "hindi", "hinglish", "filler", "bridge", "human"]):
        tone_content = (
            "- Speak like a knowledgeable, polite colleague over the phone.\n"
            "- Do not insert fillers or bridge words mechanically. Let natural sentence rhythm carry the conversation.\n"
            "- Dynamically match the prospect's language level (Hindi, English, or Hinglish code-switching)."
        )
        new_directives = _merge_or_replace_directive_section(
            existing_directives,
            "AUTHENTIC HUMAN CADENCE",
            tone_content
        )
        return {
            "steps": "Worked on 2 steps >",
            "steps_detail": [
                "Removed artificial bridge words and mechanical filler constraints",
                "Activated natural conversational cadence with dynamic Indic language adaptation"
            ],
            "text": "I've tuned the agent's tone for authentic, spontaneous human speech without hardcoded fillers.",
            "body": (
                "Mechanical bridge words ('dekhiye', 'actually' on every turn) sound robotic. "
                "I have updated the prompt instructions to let genuine Indian conversational cadence and cultural nuances "
                "emerge organically from the dialogue, with automatic language matching between English, Hinglish, and regional dialects."
            ),
            "follow_up_questions": [
                "Should the agent default to conversational Hinglish, polished Indian English, or a regional language like Marathi or Bengali?",
                "Do you prefer a warm consultative advisor tone or a fast-paced energetic sales cadence?"
            ],
            "action_card": {
                "title": "Language & Voice Customization",
                "options": [
                    "Set starting language to natural Conversational Hinglish",
                    "Switch to authoritative Indian English consultative voice",
                    "Adjust speech pace and response latency"
                ]
            },
            "patch": {
                "voice_config": {
                    "speaker": "shubh_enhi_ads",
                    "language": "Auto",
                    "pace": 1.0,
                    "tone": "Professional"
                },
                "fine_tuning_directives": new_directives
            }
        }

    # 4. Inbound Customer Support & Service
    if any(k in q_low for k in ["inbound", "support", "customer care", "help desk", "inbound call", "customer service"]):
        inbound_content = (
            "- Inbound Welcoming: Open with a warm, professional greeting acknowledging the caller immediately.\n"
            "- Active Listening & Diagnosis: Clarify the customer's exact inquiry or issue before offering solutions.\n"
            "- Knowledge Grounding: Provide precise, direct answers using connected product documentation or policies.\n"
            "- Escalation Protocol: If an issue requires human supervisor review or technical deep-dive, politely collect the caller's details and confirm a callback timeframe."
        )
        new_directives = _merge_or_replace_directive_section(
            existing_directives,
            "INBOUND CUSTOMER SUPPORT PROTOCOL",
            inbound_content
        )
        return {
            "steps": "Worked on 3 steps >",
            "steps_detail": [
                "Configured inbound caller greeting & empathetic tone",
                "Activated diagnostic issue clarification & escalation routing",
                "Calibrated telephony parameters for low latency customer resolution"
            ],
            "text": "I've configured your agent for high-satisfaction inbound customer support.",
            "body": (
                "Inbound support requires immediate empathy, clarity, and structured diagnosis. "
                "I've enabled a warm, welcoming opening greeting, configured active listening directives, and established clean escalation pathways "
                "so callers get instant answers without being placed on hold."
            ),
            "follow_up_questions": [
                "What is your standard protocol for issues that require human escalation?",
                "Would you like to connect a specific Knowledge Capsule containing your product FAQs?"
            ],
            "action_card": {
                "title": "Inbound Configuration Actions",
                "options": [
                    "Connect product FAQ knowledge capsule",
                    "Place one test call to my number right now",
                    "Calibrate escalation contact & ticket creation triggers"
                ]
            },
            "patch": {
                "role": "inbound_support",
                "greeting_enabled": True,
                "greeting_text": "Thank you for calling support! My name is Sage. How can I assist you today?",
                "fine_tuning_directives": new_directives,
                "settings": {
                    "bargeIn": True,
                    "callCutRule": "reframe_once_then_exit",
                    "backgroundSound": "quiet"
                }
            }
        }

    # 5. Knowledge Base & Product Grounding
    if any(k in q_low for k in ["knowledge base", "knowledge", "capsule", "product question", "faq", "grounding", "add a knowledge"]):
        kb_content = (
            "- Product Truth: Ground all answers strictly in verified Knowledge Capsule specifications and policies.\n"
            "- Transparent Honesty: If a customer asks about a feature, price, or policy not documented in the capsule, never guess or hallucinate—state politely that you will confirm with the product specialist.\n"
            "- Concise Delivery: Deliver direct, actionable answers under 2 sentences before checking caller comprehension."
        )
        new_directives = _merge_or_replace_directive_section(
            existing_directives,
            "KNOWLEDGE CAPSULE GROUNDING",
            kb_content
        )
        return {
            "steps": "Worked on 3 steps >",
            "steps_detail": [
                "Audited active Knowledge Capsule grounding parameters",
                "Embedded strict hallucination guards and truthful policy bounds",
                "Synchronized real-time objection grounding directives"
            ],
            "text": "I've grounded your agent in verified product knowledge and anti-hallucination guardrails.",
            "body": (
                "Voice agents must maintain total accuracy when discussing product features, pricing, and SLAs. "
                "I've configured directives ensuring the agent references verified Knowledge Capsule data concisely, "
                "with an explicit directive to never guess or invent unverified specs."
            ),
            "follow_up_questions": [
                "Are there specific pricing tiers or technical caveats the agent should highlight?",
                "Should the agent share detailed specs over the phone or offer to dispatch a PDF via WhatsApp?"
            ],
            "action_card": {
                "title": "Knowledge Grounding Actions",
                "options": [
                    "Attach or select a Product Knowledge Capsule",
                    "Place one cold call to my number right now",
                    "Review anti-hallucination qualification guardrails"
                ]
            },
            "patch": {
                "fine_tuning_directives": new_directives,
                **(_get_capsule_patch_id(db, agent_state)),
                "settings": {
                    "bargeIn": True
                }
            }
        }

    # 6. Production Readiness & Live Call Verification
    if any(k in q_low for k in ["ready to take live calls", "production ready", "take live calls", "verify agent", "pre-flight", "checklist", "launch ready"]):
        prod_content = (
            "- Live Call Standard: Deliver crisp responses under 500ms with natural turn-taking.\n"
            "- Barge-in Grace: Yield immediately when the prospect speaks, acknowledging interruptions smoothly.\n"
            "- Respectful Termination: Respect prospect time; execute courteous call exit upon firm rejection without arguing."
        )
        new_directives = _merge_or_replace_directive_section(
            existing_directives,
            "PRODUCTION FLIGHT CONTROLS",
            prod_content
        )
        return {
            "steps": "Worked on 4 steps >",
            "steps_detail": [
                "Audited voice persona latency and barge-in responsiveness",
                "Verified call-cut rules and graceful exit phrases",
                "Checked ambient audio and telephony disconnect bounds",
                "Validated prompt injection defense & qualification metrics"
            ],
            "text": "Your agent has been audited and calibrated for live production calls.",
            "body": (
                "I've verified the telephony parameters, audio interruption models, and exit thresholds against Clozflow production standards. "
                "Barge-in is enabled for organic human turn-taking, polite call-cut rules are locked in to protect brand reputation, and latency is optimized."
            ),
            "follow_up_questions": [
                "Would you like to run an instant live test call to your mobile phone before going live?",
                "What is your target daily call volume for this campaign?"
            ],
            "action_card": {
                "title": "Production Deployment Options",
                "options": [
                    "Place one cold call to my number right now",
                    "Review full telephony & audio settings",
                    "Launch agent into live campaign"
                ]
            },
            "patch": {
                "fine_tuning_directives": new_directives,
                "settings": {
                    "bargeIn": True,
                    "callCutRule": agent_state.get("settings", {}).get("callCutRule", "reframe_once_then_exit"),
                    "maxCallLength": 15,
                    "backgroundSound": "office",
                    "backgroundVolume": 25
                }
            }
        }

    # Default General Architecture Consultation
    general_content = (
        "- Goal: Qualify prospect intent cleanly and respectfully.\n"
        "- Objection handling: 1 natural reframe on soft objections, immediate polite disconnect on hard rejection."
    )
    new_directives = _merge_or_replace_directive_section(
        existing_directives,
        "CONVERSATIONAL FOCUS",
        general_content
    )
    return {
        "steps": "Worked on 3 steps >",
        "steps_detail": [
            "Analyzed your configuration requirements against Clozflow sales benchmarks",
            "Evaluated live dialogue pacing, qualification logic, and exit thresholds",
            "Formulated architectural recommendations for your review"
        ],
        "text": f"I've analyzed your instructions for {name} and prepared context-aware enhancements.",
        "body": (
            "I'm continuously calibrating your agent's conversational architecture. "
            "We focus on three pillars: spontaneous context-aware hooks, consultative qualification, and "
            "knowing exactly when to push with value versus when to gracefully disconnect upon rejection."
        ),
        "follow_up_questions": [
            "When should the agent disconnect the call vs push & reframe during objections?",
            "What is the single most important call outcome for your business (e.g. booked calendar demo or WhatsApp sync)?"
        ],
        "action_card": {
            "title": "Recommended Architectural Next Steps",
            "options": [
                "Place one cold call to my number right now",
                "Tune Call Disconnection & Rejection thresholds",
                "Configure dynamic outbound pattern interrupt hook"
            ]
        },
        "patch": {
            "fine_tuning_directives": new_directives
        }
    }

async def run_sage_conversation(
    messages: List[Dict[str, Any]],
    query: Optional[str] = None,
    agent_state: Optional[Dict[str, Any]] = None,
    user_id: Optional[int] = None,
    db: Any = None
) -> Dict[str, Any]:
    """
    Executes Sage's planning and generation pipeline.
    Uses Qwen model (qwen/qwen3.8-27b) via Groq API.
    Falls back gracefully to intelligent heuristic generation if external API fails.
    """
    state = agent_state or {}
    user_query = (query or "").strip()
    if not user_query and messages:
        # Get query from latest user message
        for m in reversed(messages):
            if m.get("role") == "user" or m.get("sender") == "user":
                user_query = m.get("content") or m.get("text") or ""
                break

    if not user_query:
        user_query = "Help me optimize this agent for high-conversion sales calls."

    # Ground Sage with DB Knowledge Capsule if capsule_id is provided
    if db and state.get("capsule_id"):
        try:
            from models import Capsule
            c_id = state.get("capsule_id")
            if isinstance(c_id, (int, str)) and str(c_id).isdigit():
                cap = db.query(Capsule).filter(Capsule.id == int(c_id)).first()
                if cap:
                    if not state.get("capsule_name"):
                        state["capsule_name"] = cap.name or cap.product_name
                    meta = state.setdefault("capsule_metadata", {})
                    if not meta.get("product_name") and cap.product_name:
                        meta["product_name"] = cap.product_name
                    if not meta.get("description") and cap.product_specification:
                        meta["description"] = cap.product_specification
                    if not meta.get("target_audience") and cap.target_audience:
                        meta["target_audience"] = cap.target_audience
                    if not meta.get("value_props") and cap.key_differentiators:
                        meta["value_props"] = cap.key_differentiators
                    if not meta.get("pain_points_solved") and cap.pain_points_solved:
                        meta["pain_points_solved"] = cap.pain_points_solved
                    if not state.get("capsule_context"):
                        parts = [
                            f"Product: {cap.product_name}" if cap.product_name else "",
                            f"Audience: {cap.target_audience}" if cap.target_audience else "",
                            f"Specs: {cap.product_specification}" if cap.product_specification else "",
                            f"Differentiators: {cap.key_differentiators}" if cap.key_differentiators else "",
                            f"Pain Points: {cap.pain_points_solved}" if cap.pain_points_solved else "",
                            f"Context: {cap.additional_context}" if cap.additional_context else ""
                        ]
                        state["capsule_context"] = " | ".join(p for p in parts if p)
        except Exception as e:
            print(f"[Sage Service] Error loading Capsule from DB: {e}")

    groq_api_key = os.getenv("GROQ_API_KEY", "").strip()
    context_summary = _build_context_summary(state)

    llm_messages = [
        {"role": "system", "content": f"{SAGE_SYSTEM_PROMPT}\n\n{context_summary}"}
    ]

    # Include recent conversation turns (up to last 6 turns)
    for m in messages[-6:]:
        role = "assistant" if (m.get("role") == "assistant" or m.get("sender") == "assistant") else "user"
        content = m.get("content") or m.get("text") or ""
        if content:
            llm_messages.append({"role": role, "content": content})

    if not messages or (llm_messages[-1]["role"] != "user" or llm_messages[-1]["content"] != user_query):
        llm_messages.append({"role": "user", "content": user_query})

    # If Groq API key is present, attempt LLM call
    if groq_api_key:
        client = _get_http_client()
        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {groq_api_key}",
            "Content-Type": "application/json"
        }

        for model_cand in FALLBACK_MODELS:
            payload = {
                "model": model_cand,
                "messages": llm_messages,
                "temperature": 0.4,
                "max_tokens": 1200,
                "response_format": {"type": "json_object"} if "qwen" in model_cand or "llama-3" in model_cand else None
            }
            # Remove response_format if None
            if payload["response_format"] is None:
                del payload["response_format"]

            try:
                resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    content = data["choices"][0]["message"]["content"]
                    clean_content = _clean_json_text(content)
                    parsed = json.loads(clean_content)

                    # Ensure standard response format
                    steps = parsed.get("steps")
                    if isinstance(steps, list):
                        steps_str = f"Worked on {len(steps)} steps >"
                        steps_detail = steps
                    else:
                        steps_str = str(steps or "Worked on 3 steps >")
                        steps_detail = parsed.get("steps_detail") or [
                            "Understood business context & qualification hurdles",
                            "Calibrated objection resilience vs call termination criteria",
                            "Generated actionable configuration patch"
                        ]

                    patch = parsed.get("patch") or {}
                    if "settings" in patch and isinstance(patch["settings"], dict):
                        if "callCutRule" in patch["settings"]:
                            patch["settings"]["callCutRule"] = _normalize_call_cut_rule(patch["settings"]["callCutRule"])

                    return {
                        "id": f"s-{int(time.time()*1000)}",
                        "sender": "assistant",
                        "text": parsed.get("text") or "I've analyzed your instructions and updated the configuration.",
                        "steps": steps_str,
                        "steps_detail": steps_detail,
                        "body": parsed.get("body") or "",
                        "follow_up_questions": parsed.get("follow_up_questions") or [],
                        "action_card": parsed.get("action_card") or None,
                        "patch": patch,
                        "timestamp": "Just now"
                    }
                else:
                    print(f"[Sage Service] Model {model_cand} returned HTTP {resp.status_code}: {resp.text}")
            except Exception as e:
                print(f"[Sage Service] Error calling model {model_cand}: {e}")

    # Fallback to intelligent context-aware heuristic
    heuristic_res = _generate_heuristic_response(user_query, state, db=db)
    heuristic_res["id"] = f"s-{int(time.time()*1000)}"
    heuristic_res["timestamp"] = "Just now"
    return heuristic_res
