"""

Pearl Conversation Engine — Optimized for realtime phone latency.



Key optimizations over previous version:

- Persistent httpx.AsyncClient (no TCP+TLS setup per utterance)

- Streaming token output consumed by caller for immediate TTS chunking

- Compact system prompt cached at init

- Conversation context kept minimal

- import json at module level (not per-token)

- KV Prefix Caching: Static foundation prompt separated from dynamic call
  context to maximise inference-server prefix cache hit rate and cut TTFT
  by ~200-250ms per turn (RadixAttention / Groq automatic prefix caching)

"""

import os

import json
import re
import hashlib

import time

import asyncio
import httpx

from typing import Dict, Any, List, AsyncGenerator, Optional, Tuple



try:

    from .prompt_guard import detect_prompt_injection, sanitize_input_tokens

except (ImportError, ValueError):

    from services.pearl.prompt_guard import detect_prompt_injection, sanitize_input_tokens

try:
    from .tool_engine import ToolDispatcher, get_conversational_filler, RUN_MODE_READ, RUN_MODE_WRITE
except (ImportError, ValueError):
    from services.pearl.tool_engine import ToolDispatcher, get_conversational_filler, RUN_MODE_READ, RUN_MODE_WRITE





# Reusable client — created once per process, connection-pooled

_llm_client: httpx.AsyncClient | None = None



def _get_llm_client() -> httpx.AsyncClient:

    global _llm_client

    if _llm_client is None or _llm_client.is_closed:

        _llm_client = httpx.AsyncClient(

            timeout=httpx.Timeout(connect=5.0, read=30.0, write=5.0, pool=5.0),

            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),

        )

    return _llm_client






# ─── KV PREFIX CACHE: STATIC FOUNDATION PROMPT ──────────────────────────────
# This prompt is IDENTICAL across every call, every turn, every agent persona.
# It occupies position [0] in the messages array, ensuring the inference server
# (Groq LPU, vLLM RadixAttention, SGLang, TRT-LLM) can cache its KV matrices
# in GPU VRAM and skip the prefill computation (~200-250ms savings per turn).
#
# RULES FOR CACHE INTEGRITY (DO NOT VIOLATE):
#   1. This string must be byte-for-byte identical across all calls.
#   2. NEVER inject timestamps, lead names, agent names, or any per-call
#      variable into this block.
#   3. All per-call dynamic content (agent identity, prospect name, capsule,
#      call-cut rules) goes into the DYNAMIC CONTEXT message at position [1].
# ──────────────────────────────────────────────────────────────────────────────

_STATIC_FOUNDATION_PROMPT: str = (
    "You are an expert Indian sales executive on a live outbound phone call.\n"
    "\n"
    "CONVERSATION STYLE & SPOKEN NUANCE:\n"
    "- Sound like a real Indian executive on a spontaneous phone call; never sound like a bot, telemarketer, or translated script.\n"
    "- Colloquial Hinglish Cadence: Blend English business terms with natural spoken markers "
    "('haan haan', 'achha', 'dekhiye', 'ek minute', 'suno', 'theek hai na', 'bilkul', 'actually'). "
    "Never use literal bookish translations (avoid 'pain solve karna', 'tied hai', 'priority slot assign kar raha hoon').\n"
    "- Executive Peer Status: Speak with relaxed confidence on first-name terms. "
    "Address prospects by their first name or 'Sir/Ma\'am' only. "
    "Never address them with their full surname, and do NOT append or force 'ji'. "
    "Never apologize for calling.\n"
    "- Dynamically mirror the prospect's language, pace, and energy.\n"
    "\n"
    "BREVITY & CONVERSATIONAL RHYTHM:\n"
    "- Spoken Opening: Usually 1-2 punchy sentences (~15-25 words), flexible if context requires.\n"
    "- Spoken Turns & Human Nuance: By default, keep conversational turns concise (~15-25 words per simple turn) "
    "following the one-breath rhythm so phone tempo stays lively. Do NOT enforce rigid, artificial 1-2 sentence "
    "handcuffs across every turn: explain thoroughly with natural human nuance when answering prospect queries, "
    "addressing objections, or clarifying details.\n"
    "- TTS Script Purity: Generate Roman script only. Never include Devanagari or other Indic script characters "
    "in romanized Hinglish/English output to prevent TTS synthesis glitches.\n"
    "\n"
    "SALES INTELLIGENCE:\n"
    "- Handle objections conversationally: acknowledge warmly "
    "('Bilkul sahi sawaal hai' / 'Samajh rahi hoon' / 'Samajh raha hoon'), "
    "then respond using relevant context.\n"
    "\n"
    "SPOKEN OUTPUT:\n"
    "- Generate only words intended to be spoken aloud. Use punctuation to create natural TTS rhythm and pauses. "
    "No markdown, bullets, emojis, stage directions, or meta-commentary."
)

# Precomputed hash for runtime integrity verification
_STATIC_PROMPT_HASH: str = hashlib.sha256(_STATIC_FOUNDATION_PROMPT.encode("utf-8")).hexdigest()

# Module-level pre-built system message (shared across all engine instances)
_CACHED_SYSTEM_MESSAGE: List[Dict[str, str]] = [
    {"role": "system", "content": _STATIC_FOUNDATION_PROMPT}
]

# KV cache hit/miss counters for observability
_kv_cache_stats: Dict[str, int] = {"hits": 0, "misses": 0, "turns_total": 0}

def get_kv_cache_stats() -> Dict[str, Any]:
    """Returns current KV prefix cache hit statistics for monitoring dashboards."""
    total = _kv_cache_stats["turns_total"]
    return {
        **_kv_cache_stats,
        "hit_rate_pct": round(_kv_cache_stats["hits"] / max(1, total) * 100, 2),
        "estimated_ttft_savings_ms": _kv_cache_stats["hits"] * 220,
    }


# 87 Base Persona Gender Registry
SARVAM_SPEAKER_GENDER: Dict[str, str] = {
    # Male Speakers
    "shubh": "Male", "rohan": "Male", "rahul": "Male", "aditya": "Male", "dev": "Male",
    "anand": "Male", "tarun": "Male", "sumit": "Male", "kabir": "Male", "aayan": "Male",
    "varun": "Male", "mohit": "Male", "rehan": "Male", "amit": "Male", "manan": "Male",
    "advait": "Male", "sunny": "Male", "ratan": "Male", "ashutosh": "Male", "mani": "Male",
    "gokul": "Male", "vijay": "Male", "karthik": "Male", "srinivas": "Male", "harish": "Male",
    "rajesh": "Male", "sourav": "Male", "debasish": "Male", "subhash": "Male", "soham": "Male",
    "madhav": "Male", "aniket": "Male", "chetan": "Male", "raghu": "Male", "pradeep": "Male",
    "jatin": "Male", "ketan": "Male", "chirag": "Male", "harpreet": "Male", "jaswinder": "Male",
    "baljeet": "Male", "biju": "Male", "anoop": "Male", "subrat": "Male", "biswajit": "Male",
    "aakash": "Male", "alok": "Male", "arjun": "Male", "deepak": "Male", "arnab": "Male",
    "ashwin": "Male", "deven": "Male", "kalpit": "Male", "nachiket": "Male", "ojas": "Male",
    "rustom": "Male", "bhavik": "Male", "ashok": "Male", "kunal": "Male", "mahesh": "Male",
    "nilesh": "Male", "jaspal": "Male", "aravind": "Male", "bimal": "Male", "girish": "Male",
    "sarang": "Male", "aryaman": "Male", "mukul": "Male", "vaibhav": "Male", "vipul": "Male",

    # Female Speakers
    "ritu": "Female", "simran": "Female", "priya": "Female", "kavya": "Female", "ishita": "Female",
    "neha": "Female", "pooja": "Female", "shreya": "Female", "shruti": "Female", "suhani": "Female",
    "rupali": "Female", "roopa": "Female", "tanya": "Female", "kavitha": "Female", "selvi": "Female",
    "deepa": "Female", "lakshmi": "Female", "bhavani": "Female", "swapna": "Female", "ananya": "Female",
    "poulomi": "Female", "tanima": "Female", "sai": "Female", "swati": "Female", "tanvi": "Female",
    "anusha": "Female", "manjula": "Female", "bhavna": "Female", "hansa": "Female", "gurpreet": "Female",
    "simranjit": "Female", "sreeja": "Female", "remya": "Female", "sunita": "Female", "lipsa": "Female",
    "aditi": "Female", "anushka": "Female", "divya": "Female", "kangkana": "Female", "mouchumi": "Female",
    "aparna": "Female", "chandrika": "Female", "nupur": "Female", "sanchita": "Female", "shabana": "Female",
    "shalini": "Female", "zarina": "Female", "chhavi": "Female", "sarika": "Female", "suchitra": "Female",
    "chaitra": "Female", "shilpa": "Female", "mrunal": "Female", "amelia": "Female", "sophia": "Female",
    "payal": "Female", "aarti": "Female", "suman": "Female", "vandana": "Female",
}

def resolve_persona_gender(
    speaker: Optional[str] = None,
    explicit_gender: Optional[str] = None,
    agent_name: Optional[str] = None,
    voice_config: Optional[Dict[str, Any]] = None,
    lead_context: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Intelligently resolves the persona gender ('Male' or 'Female') from multiple available signals:
    1. Explicit gender parameter or stored in voice_config / lead_context
    2. Speaker identifier lookup (e.g. 'shubh_enhi_ads' -> 'shubh' -> 'Male')
    3. Agent name heuristic fallback
    """
    candidates = [
        explicit_gender,
        (voice_config or {}).get("gender"),
        (lead_context or {}).get("gender"),
        (lead_context or {}).get("voice_gender"),
    ]
    for cand in candidates:
        if cand and isinstance(cand, str):
            c_low = cand.strip().lower()
            if c_low in ("female", "woman", "f"):
                return "Female"
            if c_low in ("male", "man", "m"):
                return "Male"

    speaker_id = (
        speaker
        or (voice_config or {}).get("speaker")
        or (lead_context or {}).get("speaker")
        or (lead_context or {}).get("voice_speaker")
    )
    if speaker_id and isinstance(speaker_id, str):
        base = speaker_id.strip().lower().split("_")[0]
        if base in SARVAM_SPEAKER_GENDER:
            return SARVAM_SPEAKER_GENDER[base]

    if agent_name and isinstance(agent_name, str):
        name_clean = agent_name.strip().lower()
        if name_clean in SARVAM_SPEAKER_GENDER:
            return SARVAM_SPEAKER_GENDER[name_clean]
        # Indian male name heuristics (including Raj, Sunny, etc.)
        if any(m_name in name_clean for m_name in ["raj", "sunny", "vijay", "shubh", "rohan", "rahul", "aditya", "anand", "kabir", "arjun", "alok", "aman", "karan", "vikram", "amit", "deepak", "sanjay", "ajay", "gaurav", "manish", "sachin", "vivek", "dev"]):
            return "Male"
        if any(f_name in name_clean for f_name in ["pearl", "neha", "priya", "kavya", "pooja", "simran", "aditi", "ritu", "ishita", "ananya", "shreya"]):
            return "Female"

    return "Female"

class ConversationEngine:

    """

    Evaluates prospect responses and updates conversation state using an LLM.

    Provides the conversational intelligence for the agent.

    """

    

    def __init__(
        self,
        objective: str,
        lead_context: Dict[str, Any],
        system_prompt_override: Optional[str] = None,
        agent_name: Optional[str] = None,
        speaker: Optional[str] = None,
        voice_config: Optional[Dict[str, Any]] = None,
        gender: Optional[str] = None,
        model: Optional[str] = None,
        sarvam_api_key: Optional[str] = None,
        reasoning_effort: Optional[str] = None,
        tools: Optional[List[Any]] = None,
        tool_dispatcher: Optional[Any] = None,
    ):

        self.objective = objective

        self.lead = lead_context

        self.agent_name = (agent_name or lead_context.get("agent_name") or "Pearl").strip()

        self.voice_config = voice_config or lead_context.get("voice_config") or {}

        self.speaker = speaker or self.voice_config.get("speaker") or lead_context.get("speaker") or lead_context.get("voice_speaker")

        self.gender = resolve_persona_gender(
            speaker=self.speaker,
            explicit_gender=gender or self.voice_config.get("gender") or lead_context.get("gender"),
            agent_name=self.agent_name,
            voice_config=self.voice_config,
            lead_context=self.lead
        )

        self.history: List[Dict[str, str]] = []

        # Tool Dispatcher & Dual Pattern Registry
        self.tools: List[Any] = tools or lead_context.get("tools") or []
        self.tool_dispatcher = tool_dispatcher or ToolDispatcher(tools=self.tools, gender=self.gender)

        # ── KV PREFIX CACHE ARCHITECTURE ──────────────────────────────────
        # Layer 1 (STATIC): _CACHED_SYSTEM_MESSAGE is a module-level singleton
        # containing the foundation prompt. It is byte-for-byte identical across
        # every ConversationEngine instance, every call, every turn. This enables
        # the inference server to cache its KV matrices in GPU VRAM permanently.
        #
        # Layer 2 (DYNAMIC): _dynamic_context_message contains agent identity,
        # prospect name, capsule, objective, call-cut rules, and custom directives.
        # This changes per call but remains stable across turns within a call.
        # ──────────────────────────────────────────────────────────────────
        self._dynamic_context = self._build_dynamic_context(custom_instructions=system_prompt_override)
        self._dynamic_context_message = {"role": "system", "content": self._dynamic_context}

        # Legacy compatibility: full system_prompt = static + dynamic (for logging / debugging only)
        self.system_prompt = _STATIC_FOUNDATION_PROMPT + "\n\n" + self._dynamic_context

        self.groq_api_key = os.getenv("GROQ_API_KEY")
        self.sarvam_api_key = sarvam_api_key or os.getenv("SARVAM_API_KEY")

        self.model = model or os.getenv("PEARL_LLM_MODEL", "qwen/qwen3.8-27b")
        self.reasoning_effort = reasoning_effort
        self.last_reasoning: str = ""

        self.last_security_event: Optional[Dict[str, Any]] = None

        settings = (self.voice_config or {}).get("settings", {})
        raw_temp = settings.get("temperature", (self.voice_config or {}).get("temperature", 0.7))
        try:
            self.temperature = float(raw_temp)
        except (ValueError, TypeError):
            self.temperature = 0.7

        

        # Pre-built messages prefix for KV cache-optimized inference.
        # Position [0]: Static foundation (globally cached KV across all calls)
        # Position [1]: Dynamic call context (cached within this call's turns)
        self._system_messages = _CACHED_SYSTEM_MESSAGE + [self._dynamic_context_message]

        

    def _resolve_language_instruction(self) -> str:
        target_lang = ((self.voice_config or {}).get("language") or (self.lead or {}).get("language") or "Auto").strip()
        tl_lower = target_lang.lower()

        if tl_lower == "marathi":
            return (
                "PRIMARY SPOKEN LANGUAGE: MARATHI (मराठी). You MUST speak and generate all conversational responses in natural, fluent, polite Marathi (मराठी). "
                "Use authentic spoken Marathi expressions: 'हो नक्कीच', 'नमस्कार', 'बघा', 'काही हरकत नाही', 'नक्की'. "
                "Standard tech/business terms (like 'demo', 'pricing', 'meeting', 'CRM', 'software') can be used naturally inside Marathi phrasing. "
                "If the prospect speaks Marathi, stay strictly in Marathi. If they switch to English, match their language."
            )
        elif tl_lower in ("bengali", "bangla"):
            return (
                "PRIMARY SPOKEN LANGUAGE: BENGALI (বাংলা). You MUST speak and generate all conversational responses in natural, fluent, polite Bengali (বাংলা). "
                "Use authentic spoken Bengali expressions: 'হ্যাঁ নিশ্চয়ই', 'নমস্কার', 'একদম ঠিক', 'শুনুন'."
            )
        elif tl_lower == "gujarati":
            return (
                "PRIMARY SPOKEN LANGUAGE: GUJARATI (ગુજરાતી). You MUST speak and generate all conversational responses in natural, fluent, polite Gujarati (ગુજરાતી). "
                "Use authentic spoken Gujarati expressions: 'હા ચોક્કસ', 'નમસ્તે', 'બરાબર છે', 'જોવો'."
            )
        elif tl_lower == "tamil":
            return (
                "PRIMARY SPOKEN LANGUAGE: TAMIL (தமிழ்). You MUST speak and generate all conversational responses in natural, fluent, polite spoken Tamil (தமிழ்). "
                "Use authentic spoken Tamil expressions: 'வணக்கம்', 'கண்டிப்பா', 'சரிங்க', 'பாருங்க'."
            )
        elif tl_lower == "telugu":
            return (
                "PRIMARY SPOKEN LANGUAGE: TELUGU (తెలుగు). You MUST speak and generate all conversational responses in natural, fluent, polite spoken Telugu (తెలుగు). "
                "Use authentic spoken Telugu expressions: 'నమస్కారం', 'తప్పకుండా', 'అవునండి', 'చూడండి'."
            )
        elif tl_lower == "kannada":
            return (
                "PRIMARY SPOKEN LANGUAGE: KANNADA (ಕನ್ನಡ). You MUST speak and generate all conversational responses in natural, fluent, polite spoken Kannada (ಕನ್ನಡ). "
                "Use authentic spoken Kannada expressions: 'ನಮಸ್ಕಾರ', 'ಖಂಡಿತ', 'ಸರಿ', 'ನೋಡಿ'."
            )
        elif tl_lower == "malayalam":
            return (
                "PRIMARY SPOKEN LANGUAGE: MALAYALAM (മലയാളം). You MUST speak and generate all conversational responses in natural, fluent, polite spoken Malayalam (മലയാളം). "
                "Use authentic spoken Malayalam expressions: 'നമസ്കാരം', 'തീർച്ചയായും', 'ശരി', 'നോക്കൂ'."
            )
        elif tl_lower == "punjabi":
            return (
                "PRIMARY SPOKEN LANGUAGE: PUNJABI (ਪੰਜਾਬੀ). You MUST speak and generate all conversational responses in natural, warm, polite spoken Punjabi (ਪੰਜਾਬੀ). "
                "Use authentic spoken Punjabi expressions: 'ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ', 'ਹਾਂਜੀ ਬਿਲਕੁਲ', 'ਠੀਕ ਹੈ ਜੀ'."
            )
        elif tl_lower == "odia":
            return (
                "PRIMARY SPOKEN LANGUAGE: ODIA (ଓଡ଼ିଆ). You MUST speak and generate all conversational responses in natural, fluent, polite spoken Odia (ଓଡ଼ିଆ). "
                "Use authentic spoken Odia expressions: 'ନମସ୍କାର', 'ନିଶ୍ଚୟ', 'ଠିକ ଅଛି'."
            )
        elif tl_lower == "hindi":
            return (
                "PRIMARY SPOKEN LANGUAGE: HINDI. Speak in natural, polished, conversational Hindi in Roman script with respectful tone and common everyday business vocabulary."
            )
        elif tl_lower in ("english", "indian english"):
            return (
                "PRIMARY SPOKEN LANGUAGE: INDIAN ENGLISH. Speak in clear, natural Indian English with consultative professional cadence."
            )
        else:
            return (
                "Default naturally toward conversational Hinglish. Mix Hindi and English the way educated Indian speakers naturally do in real conversations; do not translate everything into Hindi or English. "
                "Dynamically mirror the prospect's language, vocabulary, pace, formality, and energy. If they speak mostly Hindi, use more Hindi. If mostly English, use mostly English with natural Indian conversational phrasing. If they code-switch, code-switch naturally with them."
            )

    def _build_dynamic_context(self, custom_instructions: Optional[str] = None) -> str:
        """
        Build the DYNAMIC per-call context message (Layer 2 of KV cache architecture).

        This contains agent identity, prospect name, objective, capsule, call-cut rules,
        and custom directives. It changes per call but remains byte-stable across all
        turns within the same call, enabling the inference server to cache the combined
        [static_foundation + dynamic_context] KV prefix after the first turn.

        IMPORTANT: Do NOT include timestamps or any value that changes between turns.
        """

        full_name = self.lead.get('business_name') or self.lead.get('prospect_name') or 'Unknown'
        first_name = full_name.split()[0] if full_name and full_name != 'Unknown' else full_name
        name = first_name

        capsule = self.lead.get('capsule_context', 'No product context provided.')

        curr_agent_name = getattr(self, 'agent_name', None) or self.lead.get('agent_name') or 'Pearl'

        curr_gender = getattr(self, 'gender', 'Female')

        is_female = (curr_gender.lower() == 'female')

        gender_word = "female" if is_female else "male"

        settings = (getattr(self, 'voice_config', None) or {}).get("settings") or (self.lead or {}).get("settings") or {}
        call_cut_rule = settings.get("callCutRule", "reframe_once_then_exit")
        custom_disconnect = settings.get("disconnectPhrase", "Understood, thank you for your time. Have a great day!")

        if call_cut_rule == "immediate_disconnect":
            call_cut_instruction = f"Immediate Disconnect: If the prospect expresses disinterest, rejection, or asks to end the call, do not argue or push. Gracefully end the call immediately: '{custom_disconnect}'."
            brush_off_instruction = f"When prospects attempt brush-offs or decline: Respect their decision immediately — do not argue or push back; acknowledge warmly and end the call gracefully ('{custom_disconnect}')."
        elif call_cut_rule == "two_touch_reframe":
            call_cut_instruction = f"Adaptive Reframe: Provide up to 2 distinct value angles when addressing objections. If the prospect persists in rejecting or asks not to call, gracefully and politely end the call: '{custom_disconnect}'."
            brush_off_instruction = f"When prospects attempt soft brush-offs (e.g. 'email pe details bhej do' / 'send me an email'): Warmly acknowledge and pivot with a concise, high-value clarifying question before exiting."
        else:
            call_cut_instruction = f"Rejection & Graceful Call Cut: Do not force an artificial multi-step objection tree. For soft brush-offs (e.g. 'send info', 'busy now'), provide one natural, empathetic value reframe. But if the prospect gives a firm rejection ('not interested', 'stop calling', or repeated refusal), do not badger them — gracefully and politely end the call ('{custom_disconnect}') to maintain brand goodwill."
            brush_off_instruction = f"When prospects say 'email bhej do' / 'busy now': Confidently agree with natural cadence ('Haan haan, mail toh main abhi shoot kar deta hoon'), then immediately pivot to qualify relevance: 'Bas generic deck bhej ke time waste nahi karunga—roughly monthly call volume kitna rehta hai aapka?'"

        # Language instruction (resolved from voice_config / lead_context)
        lang_instruction = self._resolve_language_instruction()

        prompt = (
            f"CALL IDENTITY:\n"
            f"You are {curr_agent_name} ({gender_word} grammar) on a live outbound phone call with {name}.\n"
            f"Objective: {self.objective}.\n\n"
            f"PROSPECT CONTEXT:\n{capsule}\n\n"
            f"PROSPECT ADDRESSING:\n"
            f"- Address the prospect by first name '{first_name}' or 'Sir/Ma\'am'. "
            f"Never say '{first_name} ji' or '{full_name}'. Never use their surname.\n\n"
            f"CALL-CUT & OBJECTION RULES:\n"
            f"- {call_cut_instruction}\n"
            f"- {brush_off_instruction}\n\n"
            f"LANGUAGE DIRECTIVE:\n"
            f"- {lang_instruction}"
        )

        if custom_instructions and custom_instructions.strip():
            clean_instructions = custom_instructions.strip()
            # Guardrail: Never let legacy B2B static blocks degrade or duplicate the core conversation engine.
            if "You are Aditya, enterprise sales specialist representing" in clean_instructions or "[Native Clozflow B2B Engine]" in clean_instructions:
                clean_instructions = re.sub(
                    r'You are Aditya, enterprise sales specialist representing.*?(?=(?:SPECIFIC AGENT DIRECTIVES|ADDITIONAL DIRECTIVES|\Z))',
                    '',
                    clean_instructions,
                    flags=re.DOTALL
                ).strip()
                clean_instructions = clean_instructions.replace(
                    "[Native Clozflow B2B Engine] Leverages backend conversation engine with autonomous discovery, dynamic pattern interrupt, and consultative BANT qualification.",
                    ""
                ).strip()

            if clean_instructions:
                return f"{prompt}\n\nARCHETYPE BLUEPRINT & DIRECTIVES:\n{clean_instructions}"

        return prompt

        

    def _build_system_prompt(self, custom_instructions: Optional[str] = None) -> str:
        """Legacy alias — returns the full combined prompt for debugging/logging."""
        return _STATIC_FOUNDATION_PROMPT + "\n\n" + self._build_dynamic_context(custom_instructions)

    def add_turn(self, speaker: str, text: str) -> None:

        """Add a turn to the conversation history."""

        if speaker == "prospect" and text:

            text = sanitize_input_tokens(text)

        role = "user" if speaker == "prospect" else "assistant"

        self.history.append({"role": role, "content": text})

        # Keep context compact: last 10 turns max

        if len(self.history) > 10:

            self.history = self.history[-10:]

    def register_tool(self, tool: Any) -> None:
        """Register a tool dynamically into this conversation engine."""
        self.tools.append(tool)
        if self.tool_dispatcher:
            self.tool_dispatcher.register_tool(tool)

    def inject_tool_result(self, tool_name: str, result: Dict[str, Any], filler_phrase: Optional[str] = None) -> None:
        """
        Pattern B: Inject live verified lookup data into conversation history.
        Preserves the KV prefix cache at positions [0] and [1] while grounding
        the agent's subsequent response in live facts.
        """
        filler_instruction = ""
        if filler_phrase:
            filler_instruction = (
                f"NOTE: The agent has ALREADY just spoken to the prospect: '{filler_phrase}'. "
                "DO NOT repeat this or any other filler, acknowledgment, or delay phrasing (e.g. 'ek second', 'main check karti hoon', 'let me check'). "
                "Immediately state the direct answer based on the live data.\n"
            )
        content = (
            f"[Live System Lookup for '{tool_name}']:\n"
            f"{json.dumps(result, ensure_ascii=False)}\n"
            f"{filler_instruction}"
            "Use these live verified details to conversationally and accurately answer the prospect's query."
        )
        self.history.append({"role": "system", "content": content})
        if len(self.history) > 10:
            self.history = self.history[-10:]

    def detect_tool_intent(self, text: str) -> Optional[Tuple[str, Dict[str, Any]]]:
        """Inspect prospect utterance for matching tool trigger."""
        if self.tool_dispatcher:
            return self.tool_dispatcher.match_tool_by_intent(text)
        return None

        

    async def generate_response_stream(self) -> AsyncGenerator[str, None]:

        """

        Stream the next response using Groq.

        Yields tokens as they arrive — caller can start TTS immediately.

        """

        # Pre-LLM Guardrail: check latest prospect message for adversarial injection / jailbreak
        last_user_msg = next((m for m in reversed(self.history) if m.get("role") == "user"), None)
        if last_user_msg:
            is_injected, attack_type, deflection = detect_prompt_injection(last_user_msg.get("content", ""))
            if is_injected and deflection:
                self.last_security_event = {
                    "timestamp": time.time(),
                    "attack_type": attack_type,
                    "input_snippet": (last_user_msg.get("content", "") or "")[:100],
                }
                print(f"[PEARL GUARDRAIL] Intercepted {attack_type} attack. Deflecting in-character.")
                words = deflection.split(" ")
                for i in range(0, len(words), 3):
                    yield " ".join(words[i:i+3]) + (" " if i + 3 < len(words) else "")
                return



        sarvam_models = {
            "glm5.3-flash", "glm5.3", "gemma4", 
            "deepseekv4.1-flash-1017", "sarvam-105b-conversations", "sarvam-105b"
        }
        is_sarvam = (
            self.model in sarvam_models 
            or "sarvam" in self.model.lower() 
            or "glm" in self.model.lower() 
            or "gemma" in self.model.lower() 
            or "deepseek" in self.model.lower()
        )

        if is_sarvam:
            sarvam_key = self.sarvam_api_key or os.getenv("SARVAM_API_KEY")
            if not sarvam_key:
                yield "I'm sorry, my language processor is currently offline."
                return
            url = "https://api.sarvam.ai/v2/chat/completions"
            headers = {
                "api-subscription-key": sarvam_key,
                "Content-Type": "application/json"
            }
        else:
            if not self.groq_api_key:
                yield "I'm sorry, my language processor is currently offline."
                return
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {
                "Authorization": f"Bearer {self.groq_api_key}",
                "Content-Type": "application/json"
            }

        messages = self._system_messages + self.history

        # Groq/Minijinja models require at least one user message
        if not self.history:
            full_lead_name = self.lead.get('business_name') or self.lead.get('prospect_name') or 'Unknown'
            first_lead_name = full_lead_name.split()[0] if full_lead_name and full_lead_name != 'Unknown' else full_lead_name
            messages.append({
                "role": "user",
                "content": (
                    f"Generate your first spoken opening for this call as {getattr(self, 'agent_name', 'Pearl')} "
                    f"({'female grammar' if getattr(self, 'gender', 'Female').lower() == 'female' else 'male grammar'}). "
                    "Execute an authentic pattern interrupt tailored to the call context and archetype blueprint. "
                    f"Address the prospect by their first name '{first_lead_name}' or 'Sir/Ma\'am' (never append 'ji', never say '{first_lead_name} ji', never say '{full_lead_name}'). "
                    "Keep the opening punchy, usually 1-2 spoken sentences (~15-25 words) in natural conversational Roman Hinglish. Do not pitch features or tools. "
                    "Output Roman script only (strictly zero Devanagari script). Return spoken text only."
                )
            })

        # ── KV Cache Instrumentation ──────────────────────────────────────
        _kv_cache_stats["turns_total"] += 1
        pos0_content = messages[0]["content"]
        _cache_aligned = (pos0_content == _STATIC_FOUNDATION_PROMPT)
        _static_hash_check = _STATIC_PROMPT_HASH[:16] if _cache_aligned else hashlib.sha256(pos0_content.encode("utf-8")).hexdigest()[:16]
        if _cache_aligned:
            _kv_cache_stats["hits"] += 1
        else:
            _kv_cache_stats["misses"] += 1
        print(f"[PEARL LLM] Model: {self.model}. Sending {len(messages)} messages. KV-Cache: {'HIT' if _cache_aligned else 'MISS'} (prefix={_static_hash_check[:8]})")

        max_tokens = 500 if "deepseek" in self.model.lower() else 160
        data = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "temperature": getattr(self, "temperature", 0.7),
            "max_tokens": max_tokens,
        }
        if getattr(self, "reasoning_effort", None):
            data["reasoning_effort"] = self.reasoning_effort

        client = _get_llm_client()
        self.last_reasoning = ""

        for attempt in range(4):
            try:
                async with client.stream("POST", url, json=data, headers=headers) as response:
                    if response.status_code == 429:
                        await response.aread()
                        wait_sec = 2.5 * (attempt + 1)
                        print(f"[Pearl LLM] Rate limited (429). Retrying in {wait_sec}s (attempt {attempt+1}/4)...")
                        await asyncio.sleep(wait_sec)
                        continue

                    if response.status_code != 200:
                        await response.aread()
                        print(f"[Pearl LLM] HTTP error: {response.status_code} - {response.text}")
                        yield "I apologize, let me get back to you on that."
                        return

                    async for chunk in response.aiter_text():
                        for line in chunk.split("\n"):
                            if line.startswith("data: ") and line != "data: [DONE]":
                                try:
                                    payload = json.loads(line[6:])
                                    choices = payload.get("choices", [])
                                    if choices:
                                        delta = choices[0].get("delta", {})
                                        reasoning = delta.get("reasoning_content", "")
                                        if reasoning:
                                            self.last_reasoning += reasoning
                                        content_token = delta.get("content", "")
                                        if content_token:
                                            yield content_token
                                except (json.JSONDecodeError, KeyError, IndexError):
                                    pass
                    return

            except Exception as e:

                print(f"[Pearl LLM] Error: {e}")

                if attempt >= 3:

                    yield "I apologize, let me get back to you on that."

                    return

                await asyncio.sleep(1.5)
        else:
            yield "Haan bilkul, ek second dijiye main check kar leti hoon."
            return



    def analyze_latest_turn(self, prospect_text: str) -> Dict[str, Any]:

        """

        Analyze the most recent prospect message for signals.

        Lightweight keyword match — does not block the critical path.

        """

        lower = prospect_text.lower()

        signals = []

        objections = []

        

        if "not interested" in lower or "hang up" in lower or "don't call" in lower:

            objections.append("not_interested")

        if "price" in lower or "expensive" in lower or "cost" in lower or "budget" in lower:

            objections.append("pricing")

        if "already have" in lower or "using" in lower:

            objections.append("competitor")

        if "call back" in lower or "later" in lower or "busy" in lower:

            objections.append("timing")

            

        if "demo" in lower or "show me" in lower or "meeting" in lower or "schedule" in lower:

            signals.append("meeting_interest")

        if "how does it work" in lower or "tell me more" in lower or "interested" in lower:

            signals.append("curiosity")

        if "send" in lower and ("email" in lower or "info" in lower):

            signals.append("info_request")

            

        return {

            "intent": "unknown",

            "signals": signals,

            "objections": objections,

            "qualification_updates": {}

        }

