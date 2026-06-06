"""
Outreach Message Generation Engine V3
────────────────────────────────────
• generate_outreach_message()   → AI-powered strategic outreach via Groq
• detect_available_channels()   → Determine reachable channels from lead data
• Weighted message quality scoring (personalization, curiosity, insight, spam)
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
    "direct_observation": "DIRECT OBSERVATION MODE: Point out a highly specific business or operational fact. Move beyond just 'reviews'—look at their offering, positioning, or market gaps. Be a sharp, consultative sales expert.",
    "curiosity_hook": "CURIOSITY HOOK MODE: Create an irresistible information gap about a revenue or operational inefficiency you spotted. Hint at a specific growth lever.",
    "pattern_interrupt": "PATTERN INTERRUPT MODE: Use a top-tier B2B sales pattern interrupt. Examples: 'Not sure if I'm reaching the right person, but...', 'Usually I'd pitch you on X, but honestly looking at your setup...', 'This is a cold outreach, feel free to hang up on me (digitally), but...' - Keep it extremely sharp, professional, and confident.",
    "contrarian_observation": "CONTRARIAN MODE: Challenge a core assumption in their industry. Look at their business model and state something opposite to conventional wisdom.",
    "founder_to_founder": "FOUNDER-TO-FOUNDER MODE: You are a successful founder talking to another successful founder. Talk about operations, scaling, or systems in 2 short, direct sentences.",
    "local_market_insight": "LOCAL INSIGHT MODE: Use hyper-local context. Compare their operational setup (not just reviews) to broader local market trends.",
}

ANGLE_VECTORS = [
    "Focus purely on pricing, margins, or premium positioning.",
    "Focus purely on friction in their customer onboarding or booking flow.",
    "Focus purely on how they compare visually or operationally to their top 3 local competitors.",
    "Focus purely on customer retention and backend systems.",
    "Focus purely on their untapped revenue potential or unmonetized traffic.",
    "Focus purely on a mismatch between the quality of their work and their external perception.",
]

SCORING_WEIGHTS = {
    "originality": 0.40,
    "relevance": 0.25,
    "curiosity": 0.20,
    "human_sound": 0.15,
}

# Template phrases that must NEVER appear in hooks — V2 hook intelligence
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

def _score_message(message: str, lead_data: dict, channel: str) -> Dict:
    business_name = lead_data.get("business_name", "")
    category = lead_data.get("category", "")
    city = lead_data.get("city", "")
    msg_lower = message.lower()

    # Originality score — penalize template reuse (0-100)
    originality = 100
    for phrase in BANNED_HOOK_PHRASES:
        if phrase in msg_lower:
            originality -= 30
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
    strategy_desc = STRATEGY_CONFIG.get(outreach_strategy, STRATEGY_CONFIG["curiosity_hook"])
    random_angle = random.choice(ANGLE_VECTORS)
    
    return f"""You are an expert outreach strategist. Your ONLY job: make the prospect stop scrolling and reply. You are NOT selling. You are NOT pitching. You are starting a conversation.

═══ PHILOSOPHY ═══
First message goal: EARN ATTENTION.
Second goal: EARN A REPLY.
Never goal: immediate sale, immediate pitch, service explanation.

═══ LEAD RESEARCH DATA ═══
Business Name: {lead_data.get('business_name', 'Unknown')}
Category: {lead_data.get('category', 'Unknown')}
City: {lead_data.get('city', 'Unknown')}
Google Rating: {lead_data.get('google_rating', 'N/A')}
Website: {lead_data.get('website', 'None')}
Instagram: {lead_data.get('instagram', 'None')}
AI Summary: {lead_data.get('ai_summary', 'N/A')}
Pain Point: {lead_data.get('likely_pain_point', 'N/A')}
Opportunity Summary: {lead_data.get('opportunity_summary', 'N/A')}
Opportunity Signals: {lead_data.get('opportunity_signals', 'N/A')}

═══ OUTREACH CONFIGURATION ═══
Channel: {channel.upper()} (Tone: {channel_cfg['tone']}, Length: {channel_cfg['style']}, Max Words: {channel_cfg['max_words']})
Goal: {outreach_goal.replace('_', ' ')}
Our Offer: {user_offer if user_offer else 'General business services'}

═══ ENFORCED STRATEGY MODE: {outreach_strategy.upper()} ═══
You MUST strictly follow this approach for your message:
{strategy_desc}
If you do not follow this exact mode, the message will fail. 
DO NOT mix strategies. If it's pattern_interrupt, make it a true pattern interrupt. If it's founder_to_founder, sound like a founder.

═══ REQUIRED CREATIVE ANGLE ═══
To ensure variety, you MUST build your entire message around this specific operational lens:
"{random_angle}"
Do NOT use the most obvious angle. Force your strategy through this specific lens.

═══ HOOK INTELLIGENCE ENGINE (V2) ═══
CRITICAL: Generate THOUGHTS, not templates. Every hook must be UNIQUE and derived from THIS business's specific context.

Workflow:
1. Analyze the business using ALL research data.
2. Ask yourself: What is UNUSUAL about this business?
3. Ask yourself: How do I apply the "{outreach_strategy.upper()}" mode to this insight?
4. Convert that internal thought into an attention hook.
5. Build the opening message around it, adhering STRICTLY to the Strategy Mode.
6. Predict the likely reply and plan next move.

═══ BANNED GENERIC PATTERNS (auto-reject if used) ═══
NEVER use these exact phrases or formats — they are overused templates and sound like a bot:
- "something stood out immediately"
- "one thing doesn't add up"
- "i noticed something interesting"
- "random observation"
- "this caught my attention"
- "this might sound strange"
- "i may be wrong but"
- "[Rating] stars, no website. What's the secret?" (Do not use this exact format!)
If you catch yourself using any of these, STOP and generate a new hook from business context.

═══ TOP TIER SALES DIRECTIVE ═══
- Do NOT just talk about their "reviews" or "stars". That is amateur level. Focus on operations, market gaps, revenue leaks, or their specific offering.
- Sound like a highly paid, extremely confident, top-tier sales professional. You are peer-to-peer. You are not begging for attention.

═══ LANGUAGE RULES ═══
Reading level: SIMPLE. Tone: CONVERSATIONAL. Sound HUMAN.
Avoid: consultant language, corporate language, linkedin guru language, marketing jargon.

═══ FORBIDDEN PHRASES ═══
online presence, customer engagement, digital transformation, maximize growth, strategic opportunity, business optimization, unlock growth, enhance visibility, significant potential, comprehensive information, tailored solution, drive more sales, growth opportunity, maximize conversions, enhance brand presence, improve customer acquisition, strategic transformation.

═══ OPENING MESSAGE RULES ═══
- No hello. No hi. No introduction. No service pitch. No call request.
- Ensure the message explicitly matches the {outreach_strategy.upper()} mode.
- The message must feel like a real person writing it.

═══ QUALITY CHECK ═══
Reject your own output if it: starts with hello/hi, sounds like a sales pitch, sounds like a LinkedIn post, sounds like marketing copy, mentions your service, asks for a meeting.

═══ SUCCESS METRIC ═══
Not: message generated. But: prospect stops scrolling. Then: prospect replies.

Return ONLY valid JSON with these exact keys:
{{
  "opportunity_angle": "The strongest angle you identified",
  "opening_strategy": "{outreach_strategy}",
  "generated_thought": "Your internal reasoning — what unusual thing did you notice about THIS specific business?",
  "attention_hook": "The UNIQUE hook derived from your thought (NEVER a template phrase)",
  "observation": "Your research-based observation",
  "curiosity_angle": "The tension/curiosity element",
  "opening_message": "The full opening message (max {channel_cfg['max_words']} words)",
  "likely_reply": "Predicted prospect reply",
  "reply_probability": "High or Medium or Low",
  "next_move": "How to continue after they reply",
  "reasoning": "Brief explanation of how you strictly applied the {outreach_strategy} mode",
  "personalization_points": ["array of specific data points used"]
}}"""

def _generate_fallback_message(lead_data: dict, channel: str, outreach_strategy: str, user_offer: str) -> dict:
    return {
        "opportunity_angle": f"Operational inefficiency in local discoverability.",
        "opening_strategy": outreach_strategy,
        "generated_thought": "Business has a solid core offering but is losing out on high-intent local search traffic.",
        "attention_hook": "I was about to pitch you, but then I noticed your local setup.",
        "observation": f"Looking at {lead_data.get('category', 'businesses')} in {lead_data.get('city', 'your area')}, your core offering is strong, but your digital footprint is creating friction for buyers.",
        "curiosity_angle": "There's a specific bottleneck preventing organic acquisition.",
        "opening_message": f"Usually I'd just pitch you, but looking at your setup for {lead_data.get('category', 'businesses')} in {lead_data.get('city', 'your area')}, there's a specific bottleneck creating friction for your buyers. Open to a quick observation?",
        "likely_reply": "Sure, what did you find?",
        "reply_probability": "Medium",
        "next_move": "Share the specific bottleneck about their map ranking or booking flow.",
        "reasoning": "Fallback template using a strong pattern interrupt and consultative tone.",
        "personalization_points": ["Category", "City location"]
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
            base_url = "https://api.groq.com/openai/v1" if api_key.startswith("gsk_") else "https://api.openai.com/v1"
            model = "llama-3.3-70b-versatile" if api_key.startswith("gsk_") else "gpt-4o-mini"
            client = AsyncOpenAI(api_key=api_key, base_url=base_url)
            prompt = _build_outreach_prompt(lead_data, channel, outreach_goal, outreach_strategy, user_offer)
            
            response = await client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.8,
                max_tokens=800,
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content.strip()
            if "```" in content: content = content.split("```")[1].replace("json", "").strip()
            result = json.loads(content)
        except Exception as e:
            print(f"LLM error: {e}")
            result = _generate_fallback_message(lead_data, channel, outreach_strategy, user_offer)
    else:
        result = _generate_fallback_message(lead_data, channel, outreach_strategy, user_offer)
        
    scores = _score_message(result.get("opening_message", ""), lead_data, channel)
    
    return {
        **result,
        **scores
    }
