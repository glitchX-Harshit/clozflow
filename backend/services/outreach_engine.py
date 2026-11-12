"""
Outreach Message Generation Engine V4
────────────────────────────────────
• generate_outreach_message()   → AI-powered strategic outreach via Groq
• detect_available_channels()   → Determine reachable channels from lead data
• Weighted message quality scoring (personalization, curiosity, insight, spam)

CHANGELOG V4:
- Fixed pattern-locked "You seem to... Is that intentional?" loop
- ANGLE_VECTORS and STRATEGY_CONFIG now actually injected into prompt
- Replaced "good examples" bank with dynamic bad→good REWRITES (sampled randomly)
- Rewrites teach tone by contrast — model sees weak vs sharp, not a template to copy
- Prompt is now persona-first: "you are this person" not "follow these rules"
- Dynamic signal block forces model to use actual lead data, not generic observations
- No-Instagram / has-website treated as explicit named signals
- Added BANNED_CLOSING_PHRASES to scoring — penalizes "is that intentional" variants
- temperature kept at 0.7 for variation
"""

import os
import re
import json
import random
from collections import OrderedDict
from typing import Dict, List, Any, Optional
from difflib import SequenceMatcher

# Recent drafts per (user, lead), used to avoid repeating an angle/message.
# Bounded LRU so it cannot grow without limit; keyed per user so one
# tenant's history never influences another tenant's drafts.
GENERATED_HISTORY: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
MAX_HISTORY_ENTRIES = 5000

OUTREACH_LLM_TIMEOUT_SECONDS = float(os.getenv("OUTREACH_LLM_TIMEOUT_SECONDS", "30") or 30)

try:
    from openai import AsyncOpenAI
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False


class OutreachGenerationError(Exception):
    """No real draft could be produced; maps to an HTTP error (never a fake draft)."""

    def __init__(self, detail: str, *, status_code: int = 502, retry_after: Optional[int] = None, code: str = "provider_error"):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code
        self.retry_after = retry_after
        self.code = code


def _is_quota_error(exc: Exception) -> bool:
    status_code = getattr(exc, "status_code", None)
    if status_code == 429:
        return True
    text = str(exc).lower()
    return "rate_limit" in text or "rate limit" in text or "quota" in text or "resource_exhausted" in text


def _history_entry(key: str) -> Dict[str, Any]:
    entry = GENERATED_HISTORY.get(key)
    if entry is None:
        entry = {"messages": [], "last_angle_index": -1}
        GENERATED_HISTORY[key] = entry
        while len(GENERATED_HISTORY) > MAX_HISTORY_ENTRIES:
            GENERATED_HISTORY.popitem(last=False)
    else:
        GENERATED_HISTORY.move_to_end(key)
    return entry


def _parse_llm_json(content: str) -> Dict[str, Any]:
    text = (content or "").strip()
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if fenced:
        text = fenced.group(1).strip()
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("LLM returned a non-object JSON payload")
    return parsed

CHANNEL_CONFIG = {
    "whatsapp": {
        "tone": "sharp and direct",
        "style": "SHORT",
        "max_words": 50,
    },
    "instagram": {
        "tone": "professional but engaging",
        "style": "SHORT",
        "max_words": 60,
    },
    "linkedin": {
        "tone": "top-tier consultative sales",
        "style": "MEDIUM",
        "max_words": 100,
    },
    "email": {
        "tone": "executive B2B sales",
        "style": "MEDIUM",
        "max_words": 150,
    },
}

STRATEGY_CONFIG = {
    "default": "You are not selling anything and you are not a stranger doing 'research' on them. You noticed one real, specific thing while looking at how their business actually runs, and it's bugging you enough that you want to ask about it. NEVER pitch, NEVER mention a call/meeting/Zoom/demo, NEVER use the word 'help' in a sales sense. The entire message only works if it reads like it was written by someone who runs a similar business and stumbled onto something odd — not by someone trying to get their attention. If it could be mistaken for a template, it has failed."
}

ANGLE_VECTORS = [
    "Ask a very simple, direct question about a specific detail on their website or phone setup, like you're just trying to verify how it works — genuinely unsure, not performing curiosity.",
    "Make a casual, friendly observation about a minor friction point you personally ran into (e.g. line was busy, booking link was buried), without dropping stats or pitches.",
    "Drop a 1-sentence thought about their customer flow (e.g. trying to book a slot) and ask a quick, curiosity-based question that assumes they'll know the answer off the top of their head.",
    "Ask a peer-to-peer question about how they handle their busy hours, keeping the language extremely raw and short, like a voice note typed out.",
    "Act as a helpful neighbor business owner who noticed a small glitch in their digital setup and is just calling it out to be helpful, no ask attached.",
    "Make a backhanded-compliment observation — something genuinely impressive about their setup paired with one thing that doesn't match it, and ask why the gap exists.",
    "State a blunt, slightly risky guess about how they currently handle something operationally (e.g. 'guessing you're doing X manually right now') and ask them to confirm or correct you.",
    "Open with 'almost didn't message you but' framing — a small hesitation that signals you're not doing mass outreach, followed by the one specific thing that made you send it anyway.",
    "Take a mild contrarian stance on something most businesses in their category do, note they seem to be the exception (or not), and ask which side of it they're actually on.",
]

BANNED_CLOSING_PHRASES = [
    "is that intentional", "was that intentional", "just wondering", "just curious",
    "let me know if", "would love to", "quick question for you", "no pressure",
    "just checking in", "reaching out because", "hope this helps",
]

SCORING_WEIGHTS = {
    "originality": 0.40,
    "relevance": 0.25,
    "curiosity": 0.20,
    "human_sound": 0.15,
}



def _score_message(message: str, lead_data: dict, channel: str) -> dict:
    business_name = str(lead_data.get("business_name") or "")
    category = str(lead_data.get("category") or "")
    city = str(lead_data.get("city") or "")
    msg_lower = message.lower()

    # Originality score — penalize template reuse (0-100)
    originality = 100

    # V5 Review Penalty: heavily penalize obvious review-based hooks
    review_trigger_words = ["reviews", "rating", "stars", "google rating"]
    for rw in review_trigger_words:
        if rw in msg_lower:
            originality -= 50
            break


    # Penalize generic openers
    generic_starts = ["hey!", "hey ", "hi!", "hi ", "hello", "hope you"]
    for gs in generic_starts:
        if msg_lower.startswith(gs):
            originality -= 20
    originality = max(0, originality)

    # Relevance score — how much business context is woven in (0-100)
    relevance = 0
    if business_name and business_name.lower() in msg_lower:
        relevance += 30
    if category and category.lower() in msg_lower:
        relevance += 20
    if city and city.lower() in msg_lower:
        relevance += 15
    if lead_data.get("instagram") and str(lead_data["instagram"]).lower() in msg_lower:
        relevance += 15
    relevance = min(100, relevance + 20)  # base 20

    # Curiosity score (0-100)
    curiosity = 50
    if "?" in message:
        curiosity += 30
    if len(message.split()) < 40:
        curiosity += 20
    curiosity = min(100, curiosity)

    # Human sound score — penalize corporate/marketing language (0-100)
    human_sound = 100
    corporate_phrases = [
        "online presence", "digital transformation", "customer engagement",
        "unlock growth", "maximize visibility", "strategic opportunity",
        "business optimization", "growth leverage", "scalable acquisition",
        "tailored solution", "comprehensive information", "enhance brand",
    ]
    for cp in corporate_phrases:
        if cp in msg_lower:
            human_sound -= 15

    # Penalize the exact template-y closing phrases that make a message feel mass-sent
    for bp in BANNED_CLOSING_PHRASES:
        if bp in msg_lower:
            human_sound -= 25
    human_sound = max(0, human_sound)

    # Spam risk (separate from weighted score)
    spam_signals = 0
    spam_keywords = ["buy now", "guaranteed", "free", "discount", "offer expires", "click here", "best price"]
    for kw in spam_keywords:
        if kw in msg_lower:
            spam_signals += 1
    spam_risk = "Low" if spam_signals == 0 else "Medium" if spam_signals <= 1 else "High"

    weighted_total = (
        originality * SCORING_WEIGHTS["originality"] +
        relevance * SCORING_WEIGHTS["relevance"] +
        curiosity * SCORING_WEIGHTS["curiosity"] +
        human_sound * SCORING_WEIGHTS["human_sound"]
    )

    total_score = max(0, min(100, int(weighted_total)))
    likely_response_rate = "High" if total_score >= 75 else "Medium" if total_score >= 50 else "Low"

    return {
        "personalization_score": relevance,
        "curiosity_score": curiosity,
        "insight_score": originality,
        "likely_response_rate": likely_response_rate,
        "spam_risk": spam_risk,
    }

def detect_available_channels(lead_data: dict) -> dict:
    phone = str(lead_data.get("phone_number") or "").strip()
    instagram = str(lead_data.get("instagram") or "").strip()
    email = str(lead_data.get("email") or "").strip()
    linkedin = str(lead_data.get("linkedin") or "").strip()
    return {
        "whatsapp": {"available": bool(phone), "contact": phone},
        "instagram": {"available": bool(instagram), "contact": instagram},
        "linkedin": {"available": bool(linkedin), "contact": linkedin},
        "email": {"available": bool(email), "contact": email},
    }

def _build_outreach_prompt(
    lead_data: dict,
    channel: str,
    user_offer: str,
    angle_index: int = 0,
    language: str = "english"
) -> str:
    channel_cfg = CHANNEL_CONFIG.get(channel, CHANNEL_CONFIG["whatsapp"])
    strategy_instruction = STRATEGY_CONFIG["default"]
    angle_instruction = ANGLE_VECTORS[angle_index % len(ANGLE_VECTORS)]

    # Pull the sharpest available signal from lead data to force specificity
    ai_summary   = lead_data.get("ai_summary", "") or ""
    pain_point   = lead_data.get("likely_pain_point", "") or ""
    opp_summary  = lead_data.get("opportunity_summary", "") or ""
    opp_signals  = lead_data.get("opportunity_signals", "") or ""
    website      = lead_data.get("website", "") or ""
    instagram    = lead_data.get("instagram", "") or ""
    biz_name     = str(lead_data.get("business_name") or "this business")
    category     = str(lead_data.get("category") or "")
    city         = str(lead_data.get("city") or "")

    # Build a dynamic "what we know" block so the model can't ignore specifics
    known_signals = []
    if ai_summary:   known_signals.append(f"AI summary of their business: {ai_summary}")
    if pain_point:   known_signals.append(f"Identified pain point: {pain_point}")
    if opp_summary:  known_signals.append(f"Opportunity spotted: {opp_summary}")
    if opp_signals:  known_signals.append(f"Specific signals: {opp_signals}")
    if website:      known_signals.append(f"Has website: {website}")
    if not instagram: known_signals.append("No Instagram presence detected")
    else:            known_signals.append(f"Instagram: {instagram}")
    signals_block = "\n".join(f"  • {s}" for s in known_signals) if known_signals else "  • No enriched data — use category and city only"

    rewrites = random.sample([
        (
            "I noticed your website lacks a booking system. I can help with that.",
            "Your site looks sharp but I couldn't find a way to actually book a slot on it. Are people just DMing you directly, or am I missing a link somewhere?"
        ),
        (
            "You have no social media presence. We should get on a call.",
            "Was about to send your page to a friend and realized there's no Instagram tag anywhere. Do you run this purely offline or is there a handle you keep private?"
        ),
        (
            "I was trying to place an order but there's no link.",
            "Weird thing I noticed — your menu's all laid out but there's no way to actually order from it online. Is that on purpose, like you'd rather people call in?"
        ),
        (
            "I noticed you don't use an AI receptionist.",
            "Called around lunch and it rang out twice before someone picked up. Genuinely curious, does that happen a lot during your rush hours?"
        ),
        (
            "I noticed your prices aren't listed anywhere online.",
            "Almost didn't message but noticed something odd — every competitor near you lists pricing upfront and you don't. Is that a deliberate call, or just hasn't come up yet?"
        ),
        (
            "Your business hours online seem outdated, please fix that.",
            "Guessing this is a long shot, but does your team update hours manually on three different places, or is there one source of truth somewhere?"
        ),
        (
            "I'd love to help you get more leads through better outreach.",
            "Your work looks genuinely better than most of what's around you, which made the lack of a contact form kind of jump out. What's the actual first step for someone who wants to reach you?"
        ),
    ], k=3)

    rewrite_block = "\n\n".join(
        f"  ✗ WEAK: \"{bad}\"\n  ✓ SHARP: \"{good}\""
        for bad, good in rewrites
    )

    user_offer_instruction = ""
    if user_offer:
        user_offer_instruction = f"\n═══ YOUR VALUE PROPOSITION: {user_offer.upper()} ═══\nYou are an expert providing '{user_offer}'. The observation and final question MUST be highly tailored to how a business in their specific category handles the domains related to '{user_offer}'.\nFor example, if '{user_offer}' is 'AI Receptionist', ask about how they handle busy hours or overflow calls. If '{user_offer}' is 'Website Development', observe their digital funnel.\nEnsure the observation naturally connects to '{user_offer}' without pitching it.\n"
        
    language_instruction = ""
    if language.lower() == "hinglish":
        language_instruction = "\n═══ LANGUAGE REQUIREMENT: HINGLISH ═══\nYou MUST write the final message in natural 'Hinglish' (a conversational mix of Hindi and English written in the Latin alphabet). Make it sound exactly like how an Indian business owner or creator texts on WhatsApp. Example: 'Bhai, ek quick question—website pe direct booking ka option nahi hai kya? Sirf Instagram se handle kar rahe ho?' DO NOT use pure Hindi or formal English.\n"
    elif language.lower() != "english":
        language_instruction = f"\n═══ LANGUAGE REQUIREMENT: {language.upper()} ═══\nYou MUST write the final message in natural {language}. Ensure it sounds like a native {language} speaker texting casually.\n"

    return f"""You are a casual business peer or digital creator. You communicate in a very short, raw, and text-like way. You never use marketing jargon, corporate words, statistics, or case studies.
Your ultimate goal is to effortlessly build trust through a friendly, peer-to-peer operational observation and get them to reply. You never ask for a call or meeting in the first message. You've spent 10 minutes analyzing {biz_name} ({category}, {city}) and you're sending one highly tactical direct message to spark an organic conversation.
{user_offer_instruction}{language_instruction}
═══ WHAT YOU KNOW ABOUT THIS BUSINESS ═══
{signals_block}

═══ YOUR APPROACH FOR THIS MESSAGE ═══
Strategy: {strategy_instruction}
Angle: {angle_instruction}

═══ THE DIFFERENCE BETWEEN WEAK AND SHARP ═══
Study these rewrites. The left is what a lazy AI writes. The right is what a real founder sends.

{rewrite_block}

Notice what changes:
- Weak messages ask survey questions
- Sharp messages execute a pattern interrupt by naming a specific tension or using a very brief storyline (e.g. "I was trying to figure out how your customers book...").
- Sharp messages make the person feel seen, not pitched to.
- Sharp messages end with ONE question that acts like a "pro cold DM" — playing the student, acting slightly confused, or asking for their expert input, which lowers their guard.

═══ NOW WRITE THE MESSAGE FOR {biz_name.upper()} ═══
Use the signals above. Form a 2-3 sentence pattern interrupt. Create a tension worth responding to.

Rules:
- Exactly 2 to 3 sentences. No more.
- EXTRAORDINARY PATTERN INTERRUPT: Your opening observation must feel extraordinary, sharp, and highly specific. It should be counter-intuitive or intriguing, making them immediately wonder how you noticed it. Never use obvious, weak observations.
- NO BAIT-AND-SWITCH: NEVER pretend to be a customer trying to buy, book, or order from them (do NOT say 'I tried to book an appointment' or 'I tried to call/order'). Approach them honestly as a fellow business peer or creator asking about their digital/operational setup.
- Use simple, everyday conversational style. Do not use advanced vocabulary, big words, or formal phrasing. Write exactly like a normal human texting a peer.
- Absolutely NO greetings ("Hi", "Hey", "Hope you're well"). Start immediately mid-thought.
- Absolutely NO introductions ("I am from", "We do").
- Use a psychological pattern interrupt: state a surprising observation about their business or a mini-storyline.
- The final sentence should either be a highly specific "pro cold DM" question (frame it as if you are studying their space, genuinely confused, or asking for their expert input — e.g. "Am I missing something hidden?", "How are you guys actually handling X?") OR a blunt guess about how they operate that invites a correction. Whichever you use, it must be impossible to answer with just "yes" or "no" without adding something — that's what actually gets a reply typed out.
- Vary sentence length on purpose — one short punchy line, then one slightly longer one. Two sentences of identical length in a row reads like a template.
- No exclamation marks. No emojis unless the channel is whatsapp or instagram AND it's a single, natural one at most.
- NEVER use: "word of mouth", "is that intentional", "was that intentional", "just wondering", "just curious", "no pressure", "reaching out because", reviews, stars, rating, online presence, or marketing jargon. These phrases are exactly what makes a message look mass-sent — a single one of them anywhere in the message ruins it.

Return ONLY valid JSON:
{{
  "observation": "The specific tension or gap you're building on",
  "message": "The exact message to send",
  "expected_reply": "What they'll likely reply",
  "confidence": "High or Medium or Low"
}}"""


def _llm_config():
    api_key = os.getenv("HEXAGON_RESEARCH_API_KEY", "").strip()
    if not api_key or not HAS_OPENAI:
        return None
    if api_key.startswith("AIza") or api_key.startswith("AQ"):
        return api_key, "https://generativelanguage.googleapis.com/v1beta/openai/", "gemini-3.5-flash"
    if api_key.startswith("gsk_"):
        return api_key, "https://api.groq.com/openai/v1", "openai/gpt-oss-120b"
    return api_key, "https://api.openai.com/v1", "gpt-4o-mini"


def _text(value, default: str = "") -> str:
    if value is None:
        return default
    return value if isinstance(value, str) else str(value)


async def generate_outreach_message(
    lead_data: dict,
    channel: str,
    user_offer: str = "",
    language: str = "english",
    user_id: Optional[int] = None,
) -> dict:
    """Generate one outreach draft.

    Raises OutreachGenerationError when no real draft can be produced (AI not
    configured, provider quota exhausted, provider failure). It never returns
    an error string dressed up as a draft.
    """
    channel = channel.lower() if channel else "whatsapp"

    config = _llm_config()
    if not config:
        raise OutreachGenerationError(
            "Outreach generation is not available: no AI provider is configured on the server.",
            status_code=503, code="not_configured",
        )
    api_key, base_url, model = config

    # Identify the lead to track history (scoped to the requesting user)
    lead_id = (
        lead_data.get("phone_number") or
        lead_data.get("instagram") or
        lead_data.get("website") or
        lead_data.get("business_name") or
        "default_lead"
    )
    history = _history_entry(f"{user_id if user_id is not None else '-'}:{lead_id}")

    # Cycle to the next angle index
    angle_index = (history["last_angle_index"] + 1) % len(ANGLE_VECTORS)

    best_draft = None   # last real draft produced (even if it failed a quality gate)
    best_scores = {}
    last_error: Optional[Exception] = None

    async with AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=OUTREACH_LLM_TIMEOUT_SECONDS, max_retries=1) as client:
        for attempt in range(3):
            try:
                # Cycle angle index on retries to ensure a different prompt structure is tried
                current_angle_index = (angle_index + attempt) % len(ANGLE_VECTORS)
                prompt = _build_outreach_prompt(lead_data, channel, user_offer, current_angle_index, language)

                response = await client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.7 + (attempt * 0.1),  # increase variation on retry
                    max_tokens=800,
                    response_format={"type": "json_object"},
                )
                result = _parse_llm_json(response.choices[0].message.content or "")

                mapped_result = {
                    "observation": _text(result.get("observation")),
                    "opening_message": _text(result.get("message")).strip(),
                    "likely_reply": _text(result.get("expected_reply")),
                    "reply_probability": _text(result.get("confidence"), "Medium") or "Medium",
                }
                if not mapped_result["opening_message"]:
                    raise ValueError("LLM returned an empty message")

                scores = _score_message(mapped_result["opening_message"], lead_data, channel)
                best_draft, best_scores = mapped_result, scores

                # Check similarity against past generated messages for this lead
                is_duplicate = False
                for past_msg in history["messages"]:
                    if SequenceMatcher(None, mapped_result["opening_message"].lower(), past_msg.lower()).ratio() > 0.6:
                        is_duplicate = True
                        break

                if is_duplicate:
                    print(f"[OutreachEngine] Duplicate detected on attempt {attempt+1} (ratio > 0.6). Retrying with a new angle...")
                    continue

                # Originality (insight_score) gate
                if scores.get("insight_score", 100) >= 65:
                    print(f"[OutreachEngine] Passed originality gate on attempt {attempt+1} (Score: {scores.get('insight_score')})")
                    # Update cache state
                    history["last_angle_index"] = current_angle_index
                    history["messages"].append(mapped_result["opening_message"])
                    if len(history["messages"]) > 5:
                        history["messages"].pop(0)
                    break
                else:
                    print(f"[OutreachEngine] Failed originality gate on attempt {attempt+1} (Score: {scores.get('insight_score')}). Retrying...")
            except Exception as e:
                last_error = e
                print(f"[OutreachEngine] LLM error on attempt {attempt+1}: {type(e).__name__}")
                if _is_quota_error(e):
                    break  # retrying a quota/rate-limit error only burns more quota

    if best_draft is None:
        if last_error is not None and _is_quota_error(last_error):
            raise OutreachGenerationError(
                "The AI provider's quota is exhausted right now. Please try again in a minute.",
                status_code=503, retry_after=60, code="provider_quota",
            )
        raise OutreachGenerationError(
            "Message generation failed at the AI provider. Please try again.",
            status_code=502, code="provider_error",
        )

    return {
        **best_draft,
        **best_scores
    }