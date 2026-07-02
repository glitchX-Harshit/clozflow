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
    "default": "Execute a psychological pattern interrupt. You are an elite, 11-year veteran sales strategist who knows every objection before it happens. Your goal is NEVER to sell a product in the chat. Your goal is to spark intense curiosity and trust through a brief, tactical observation or micro-story. You must prove you understand their business better than they do. The ultimate psychological goal is to effortlessly bridge the conversation toward a casual Zoom meeting (e.g., 'Would love to show you what I mean on a quick call') without ever sounding desperate, needy, or salesy."
}

ANGLE_VECTORS = [
    "Tell a very brief story about a similar business in their niche that was bleeding revenue from an identical invisible friction point, offering to show them the fix on a quick call.",
    "Share a sharp psychological insight about their specific customer journey that they likely haven't considered, leading to a casual offer to unpack it on a 5-minute Zoom.",
    "Highlight a massive contrast between their premium brand and a missed operational detail, positioning a quick screen-share as the easiest way to reveal the gap.",
    "Ask a highly tactical, non-salesy question about their retention strategy that proves your 11-year expertise, hinting that a brief call could save them thousands.",
    "Position yourself as an elite peer who noticed a small but expensive flaw in their current digital setup, offering to walk them through the exact solution on a quick, no-pressure call."
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
    "i noticed",
    "just landed on",
    "just wanted to reach out",
    "random observation",
    "this caught my attention",
    "this might sound strange",
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
    user_offer: str,
) -> str:
    channel_cfg = CHANNEL_CONFIG.get(channel, CHANNEL_CONFIG["whatsapp"])
    strategy_instruction = STRATEGY_CONFIG["default"]
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
            "I noticed your website lacks a booking system. I can help with that.",
            "Hey guys, love the aesthetic you've built. Quick question—how are you currently handling overflow when people try to book? Saw a tiny bit of friction there that usually leaks leads. Open to a quick 5-min Zoom? I'd love to show you a quick workaround."
        ),
        (
            "You have no social media presence. We should get on a call.",
            "Big fan of what you're doing. I work with a few similar brands and was looking for your Instagram to see your recent work, but couldn't find one. Are you running purely on referrals right now? Let's jump on a quick Zoom later this week—I can show you how much traffic you're accidentally leaving on the table."
        ),
        (
            "I was trying to place an order but there's no link.",
            "Hey! The menu looks incredible. I was actually showing it to a buddy and we were wondering how you guys process digital orders without a direct link? Seems like you might be handling it all manually. If you're open to it, I'd love to hop on a 5-minute screen share to show you a system we built for this."
        ),
        (
            "I noticed you don't use an AI receptionist.",
            "Hey team, incredible reviews on Google. Quick thought—when things get insanely busy during peak hours, how are you capturing the missed calls? I saw a small gap in the current setup that might be costing a few bookings. Would love to show you a quick visual of what I mean on a short Zoom call."
        ),
    ], k=2)

    rewrite_block = "\n\n".join(
        f"  ✗ WEAK: \"{bad}\"\n  ✓ SHARP: \"{good}\""
        for bad, good in rewrites
    )

    user_offer_instruction = ""
    if user_offer:
        user_offer_instruction = f"\n═══ YOUR VALUE PROPOSITION: {user_offer.upper()} ═══\nYou are an expert providing '{user_offer}'. The observation, problem statement, and final question MUST be highly tailored to how a business in their specific category handles the domains related to '{user_offer}'.\nFor example, if '{user_offer}' is 'AI Receptionist', ask about how they handle missed calls or appointments. If '{user_offer}' is 'Website Development', observe their digital funnel.\nEnsure the observation naturally connects to '{user_offer}' without explicitly pitching it.\n"

    return f"""You are an elite, 11-year veteran sales strategist and consultant. You understand business psychology perfectly and know every objection before it happens. You are NOT a marketer, NOT an agency, and you NEVER sound desperate or pitch products directly.
Your ultimate goal is to effortlessly build trust through storytelling and bridge them to a casual 5-10 minute Zoom meeting for showcasing the product demo. You've spent 10 minutes analyzing {biz_name} ({category}, {city}) and you're sending one highly tactical direct message to spark an irresistible conversation.
{user_offer_instruction}
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
- Use simple, everyday conversational English. Do not use advanced vocabulary, big words, or formal phrasing. Write exactly like a normal human texting a peer.
- Absolutely NO greetings ("Hi", "Hey", "Hope you're well"). Start immediately mid-thought.
- Absolutely NO introductions ("I am from", "We do").
- Use a psychological pattern interrupt: state a surprising observation about their business or a mini-storyline.
- The final sentence MUST be a highly specific "pro cold DM" question — frame it as if you are studying their space, genuinely confused, or asking for their expert input (e.g. "Am I missing something hidden?", "How are you guys actually handling X?").
- NEVER use: "word of mouth", "is that intentional", "was that intentional", reviews, stars, rating, online presence, or marketing jargon.

Return ONLY valid JSON:
{{
  "observation": "The specific tension or gap you're building on",
  "message": "The exact message to send",
  "expected_reply": "What they'll likely reply",
  "confidence": "High or Medium or Low"
}}"""


def _generate_fallback_message(lead_data: dict, channel: str, user_offer: str) -> dict:
    offer_context = f" related to your {user_offer.lower()} setup" if user_offer else ""
    return {
        "observation": f"Noticed a friction point in how they handle their operations{offer_context}.",
        "message": f"Just came across your profile and couldn't figure out how you guys handle a specific bottleneck{offer_context}. Are you doing everything manually, or did I miss a link somewhere?",
        "expected_reply": "What bottleneck did you notice?",
        "confidence": "Medium"
    }


async def generate_outreach_message(
    lead_data: dict,
    channel: str,
    user_offer: str = "",
) -> dict:
    channel = channel.lower() if channel else "whatsapp"

    api_key = os.getenv("HEXAGON_RESEARCH_API_KEY", "")

    if api_key and HAS_OPENAI:
        try:
            if api_key.startswith("AIza") or api_key.startswith("AQ"):
                base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
                model = "gemini-3.5-flash"
            elif api_key.startswith("gsk_"):
                base_url = "https://api.groq.com/openai/v1"
                model = "llama-3.3-70b-versatile"
            else:
                base_url = "https://api.openai.com/v1"
                model = "gpt-4o-mini"
            client = AsyncOpenAI(api_key=api_key, base_url=base_url)
            prompt = _build_outreach_prompt(lead_data, channel, user_offer)

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
            result = _generate_fallback_message(lead_data, channel, user_offer)
    else:
        result = _generate_fallback_message(lead_data, channel, user_offer)

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