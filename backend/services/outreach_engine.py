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
import json
import random
from typing import Dict

try:
    from openai import AsyncOpenAI
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False

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
    "direct_observation": "Point out a highly specific business or operational fact — their offer, positioning, or market gap. Not about reviews. Be the sharp founder who notices things others miss.",
    "curiosity_hook": "Create an irresistible information gap about a revenue or operational inefficiency you spotted. Hint at a specific growth lever without revealing it.",
    "pattern_interrupt": "Break their expectation of a cold message. Be direct about the fact it's outreach, then flip it: 'Usually I'd pitch you on X, but looking at your setup...' — confident, not apologetic.",
    "contrarian_observation": "Challenge a core assumption in their industry. State something opposite to what everyone else tells them. Make them question their own model.",
    "founder_to_founder": "Two operators talking. Skip pleasantries. Jump straight to a specific operational or scaling observation. Max 2 sentences, very direct.",
    "local_market_insight": "Use hyper-local context — compare their operational setup to what's happening in their local market specifically. Not generic, not reviews.",
}

ANGLE_VECTORS = [
    "Focus on pricing, margins, or premium positioning.",
    "Focus on friction in their customer onboarding or booking/ordering flow.",
    "Focus on how they compare visually or operationally to their top local competitors.",
    "Focus on customer retention — what brings people back vs what doesn't.",
    "Focus on untapped revenue potential or unmonetized traffic.",
    "Focus on a mismatch between the quality of their work and their external perception.",
]

SCORING_WEIGHTS = {
    "originality": 0.40,
    "relevance": 0.25,
    "curiosity": 0.20,
    "human_sound": 0.15,
}

# Phrases that signal a lazy hook — the model fell back to a template
BANNED_HOOK_PHRASES = [
    "something stood out immediately",
    "one thing doesnt add up",
    "one thing doesn't add up",
    "i noticed something interesting",
    "random observation",
    "this caught my attention",
    "this might sound strange",
    "this might sound like a strange question",
    "i may be wrong but",
    "what's their secret",
    "what's the secret",
    "stars, no website",
]

# Phrases that signal a pattern-locked closing question — the model is templating
BANNED_CLOSING_PHRASES = [
    "is that intentional",
    "was that intentional",
    "intentional?",
    "is that a conscious choice",
    "is that by design",
    "curious if that",
]

def _score_message(message: str, lead_data: dict, channel: str) -> dict:
    business_name = lead_data.get("business_name", "")
    category = lead_data.get("category", "")
    city = lead_data.get("city", "")
    msg_lower = message.lower()

    # Originality score — penalize template reuse (0-100)
    originality = 100
    for phrase in BANNED_HOOK_PHRASES:
        if phrase in msg_lower:
            originality -= 30

    # V5 Review Penalty: heavily penalize obvious review-based hooks
    review_trigger_words = ["reviews", "rating", "stars", "google rating"]
    for rw in review_trigger_words:
        if rw in msg_lower:
            originality -= 50
            break

    # Penalize the pattern-locked closer "is that intentional" and variants
    for phrase in BANNED_CLOSING_PHRASES:
        if phrase in msg_lower:
            originality -= 40
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
    if lead_data.get("instagram") and lead_data["instagram"].lower() in msg_lower:
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
    phone = (lead_data.get("phone_number") or "").strip()
    instagram = (lead_data.get("instagram") or "").strip()
    email = (lead_data.get("email") or "").strip()
    linkedin = (lead_data.get("linkedin") or "").strip()
    return {
        "whatsapp": {"available": bool(phone), "contact": phone},
        "instagram": {"available": bool(instagram), "contact": instagram},
        "linkedin": {"available": bool(linkedin), "contact": linkedin},
        "email": {"available": bool(email), "contact": email},
    }

def _build_outreach_prompt(
    lead_data: dict,
    channel: str,
    outreach_goal: str,
    outreach_strategy: str,
    user_offer: str,
) -> str:
    channel_cfg = CHANNEL_CONFIG.get(channel, CHANNEL_CONFIG["whatsapp"])
    strategy_instruction = STRATEGY_CONFIG.get(outreach_strategy, STRATEGY_CONFIG["curiosity_hook"])
    angle_instruction = random.choice(ANGLE_VECTORS)

    # Pull the sharpest available signal from lead data to force specificity
    ai_summary   = lead_data.get("ai_summary", "") or ""
    pain_point   = lead_data.get("likely_pain_point", "") or ""
    opp_summary  = lead_data.get("opportunity_summary", "") or ""
    opp_signals  = lead_data.get("opportunity_signals", "") or ""
    website      = lead_data.get("website", "") or ""
    instagram    = lead_data.get("instagram", "") or ""
    biz_name     = lead_data.get("business_name", "this business")
    category     = lead_data.get("category", "")
    city         = lead_data.get("city", "")

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

    # Bad→Good rewrites: teach tone by contrast, not by example to copy
    rewrites = random.sample([
        (
            "No Instagram, strong website. How's in-store driving demand?",
            f"Your website's doing real work — most {category} places this size are living on Instagram. What's actually pulling people in the door?"
        ),
        (
            "What drives repeat business at Iris Café?",
            "Your menu changes weekly but there's no visible way to follow it online — are regulars just showing up on instinct or is there something I'm missing?"
        ),
        (
            "You seem to prioritize in-store experience. Is that intentional?",
            "Looks like you're running almost entirely on foot traffic and word of mouth — no ordering app, no loyalty program visible. Is that deliberate or just never been the priority?"
        ),
        (
            "Your reviews are strong. What's your retention strategy?",
            "Strong walk-in volume but I couldn't find any way to book, pre-order, or follow you. Is repeat business just organic or is there a system behind it?"
        ),
        (
            "How are you driving demand without social media?",
            "You've built something people clearly talk about — but I couldn't find a single place online to follow along or pre-order. How much revenue do you think that's costing per month?"
        ),
    ], k=2)

    rewrite_block = "\n\n".join(
        f"  ✗ WEAK: \"{bad}\"\n  ✓ SHARP: \"{good}\""
        for bad, good in rewrites
    )

    return f"""You are a sharp, experienced founder — not a marketer, not an agency, not a cold email writer.
You've spent 10 minutes looking at {biz_name} ({category}, {city}) and you're sending one direct message to start a real conversation.

═══ WHAT YOU KNOW ABOUT THIS BUSINESS ═══
{signals_block}

═══ YOUR APPROACH FOR THIS MESSAGE ═══
Strategy: {strategy_instruction}
Angle: {angle_instruction}

═══ CHANNEL ═══
Platform: {channel.upper()} | Tone: {channel_cfg['tone']} | Hard max: {channel_cfg['max_words']} words

═══ THE DIFFERENCE BETWEEN WEAK AND SHARP ═══
Study these rewrites. The left is what a lazy AI writes. The right is what a real founder sends.

{rewrite_block}

Notice what changes:
- Weak messages ask survey questions ("What drives X?", "How's Y going?")
- Sharp messages name a specific tension, gap, or contradiction they actually spotted
- Sharp messages make the person feel seen, not interviewed
- Sharp messages end with ONE question that's hard to ignore

═══ NOW WRITE THE MESSAGE FOR {biz_name.upper()} ═══
Use the signals above. Name something specific. Create a tension worth responding to.

Rules:
- Max 2–3 sentences. Under 40 words. One question.
- Start mid-thought — no greeting, no "I noticed", no "just reaching out"
- The question must be something only THEY can answer — not a generic "what's your strategy?"
- If no Instagram exists, that IS the signal — use it (e.g. "you're running on word of mouth")
- If website is strong, use that contrast
- NEVER: "is that intentional", "was that intentional", reviews, stars, rating, online presence

Return ONLY valid JSON:
{{
  "observation": "The specific tension or gap you're building on",
  "message": "The exact message to send",
  "expected_reply": "What they'll likely reply",
  "confidence": "High or Medium or Low"
}}"""


def _generate_fallback_message(lead_data: dict, channel: str, outreach_strategy: str, user_offer: str) -> dict:
    return {
        "observation": f"Looking at {lead_data.get('category', 'businesses')} in {lead_data.get('city', 'your area')}, your core offering is strong, but your digital footprint is creating friction for buyers.",
        "message": f"Usually I'd just pitch you, but looking at your setup for {lead_data.get('category', 'businesses')} in {lead_data.get('city', 'your area')}, there's a specific bottleneck creating friction for your buyers. Open to a quick observation?",
        "expected_reply": "Sure, what did you find?",
        "confidence": "Medium"
    }


async def generate_outreach_message(
    lead_data: dict,
    channel: str,
    outreach_goal: str,
    outreach_strategy: str,
    user_offer: str = "",
) -> dict:
    channel = channel.lower() if channel else "whatsapp"
    outreach_strategy = outreach_strategy.lower() if outreach_strategy else "curiosity_hook"

    api_key = os.getenv("HEXAGON_RESEARCH_API_KEY", "")

    if api_key and HAS_OPENAI:
        try:
            if api_key.startswith("AIza"):
                base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
                model = "gemini-3.5-flash"
            elif api_key.startswith("gsk_"):
                base_url = "https://api.groq.com/openai/v1"
                model = "llama-3.3-70b-versatile"
            else:
                base_url = "https://api.openai.com/v1"
                model = "gpt-4o-mini"
            client = AsyncOpenAI(api_key=api_key, base_url=base_url)
            prompt = _build_outreach_prompt(lead_data, channel, outreach_goal, outreach_strategy, user_offer)

            response = await client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.7,  # raised from 0.4 — more variation, less template lock
                max_tokens=800,
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content.strip()
            if "```" in content:
                content = content.split("```")[1].replace("json", "").strip()
            result = json.loads(content)
        except Exception as e:
            print(f"LLM error: {e}")
            result = _generate_fallback_message(lead_data, channel, outreach_strategy, user_offer)
    else:
        result = _generate_fallback_message(lead_data, channel, outreach_strategy, user_offer)

    # Map V4 schema to legacy schema for frontend compatibility
    mapped_result = {
        "observation": result.get("observation", ""),
        "opening_message": result.get("message", ""),
        "likely_reply": result.get("expected_reply", ""),
        "reply_probability": result.get("confidence", "Medium"),
    }

    scores = _score_message(mapped_result.get("opening_message", ""), lead_data, channel)

    return {
        **mapped_result,
        **scores
    }