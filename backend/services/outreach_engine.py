"""
Outreach Message Generation Engine V3
────────────────────────────────────
• generate_outreach_message()   → AI-powered strategic outreach via Groq
• detect_available_channels()   → Determine reachable channels from lead data
• Weighted message quality scoring (personalization, curiosity, insight, spam)
"""

import os
import json
from typing import Dict

try:
    from openai import AsyncOpenAI
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False

CHANNEL_CONFIG = {
    "whatsapp": {
        "tone": "casual",
        "style": "SHORT",
        "max_words": 50,
    },
    "instagram": {
        "tone": "friendly",
        "style": "SHORT",
        "max_words": 60,
    },
    "linkedin": {
        "tone": "professional",
        "style": "MEDIUM",
        "max_words": 100,
    },
    "email": {
        "tone": "consultative",
        "style": "MEDIUM",
        "max_words": 150,
    },
}

STRATEGY_CONFIG = {
    "curiosity": "Observation driven conversation starter",
    "insight": "Business insight driven opener",
    "opportunity": "Growth opportunity angle",
    "problem": "Hidden issue discovery",
}

SCORING_WEIGHTS = {
    "personalization": 0.40,
    "curiosity": 0.25,
    "insight": 0.20,
    "spam_risk_inverse": 0.15,
}

def _score_message(message: str, lead_data: dict, channel: str) -> Dict:
    business_name = lead_data.get("business_name", "")
    category = lead_data.get("category", "")
    city = lead_data.get("city", "")
    msg_lower = message.lower()

    # Personalization score (0-100)
    personalization = 0
    if business_name and business_name.lower() in msg_lower:
        personalization += 30
    if category and category.lower() in msg_lower:
        personalization += 20
    if city and city.lower() in msg_lower:
        personalization += 15
    if lead_data.get("instagram") and lead_data["instagram"].lower() in msg_lower:
        personalization += 15
    personalization = min(100, personalization + 20) # base 20

    # Curiosity score (Questions or short hooks)
    curiosity = 50
    if "?" in message:
        curiosity += 30
    if len(message.split()) < 40:
        curiosity += 20
    curiosity = min(100, curiosity)

    # Insight score
    insight = 40
    insight_words = ["noticed", "found", "research", "competitors", "trend", "opportunity", "missing", "potential"]
    matches = sum(1 for w in insight_words if w in msg_lower)
    insight += min(60, matches * 15)

    # Spam risk
    spam_signals = 0
    spam_keywords = ["buy now", "guaranteed", "free", "discount", "offer expires", "click here", "best price"]
    for kw in spam_keywords:
        if kw in msg_lower:
            spam_signals += 1
            
    if spam_signals == 0:
        spam_risk = "Low"
        spam_inverse = 100
    elif spam_signals <= 1:
        spam_risk = "Medium"
        spam_inverse = 50
    else:
        spam_risk = "High"
        spam_inverse = 10

    weighted_total = (
        personalization * SCORING_WEIGHTS["personalization"] +
        curiosity * SCORING_WEIGHTS["curiosity"] +
        insight * SCORING_WEIGHTS["insight"] +
        spam_inverse * SCORING_WEIGHTS["spam_risk_inverse"]
    )
    
    total_score = max(0, min(100, int(weighted_total)))
    likely_response_rate = "High" if total_score >= 75 else "Medium" if total_score >= 50 else "Low"

    return {
        "personalization_score": personalization,
        "curiosity_score": curiosity,
        "insight_score": insight,
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
    strategy_cfg = STRATEGY_CONFIG.get(outreach_strategy, STRATEGY_CONFIG["curiosity"])
    
    return f"""You are an expert AI outreach strategist. Your goal is to generate human outreach that earns replies. NOT pitches, NOT mini sales letters, NOT consultant reports.

═══ LEAD RESEARCH DATA ═══
Business Name: {lead_data.get('business_name', 'Unknown')}
Category: {lead_data.get('category', 'Unknown')}
City: {lead_data.get('city', 'Unknown')}
AI Summary: {lead_data.get('ai_summary', 'N/A')}
Pain Point: {lead_data.get('likely_pain_point', 'N/A')}
Opportunity Summary: {lead_data.get('opportunity_summary', 'N/A')}

═══ OUTREACH CONFIGURATION ═══
Channel: {channel.upper()} (Tone: {channel_cfg['tone']}, Length: {channel_cfg['style']})
Strategy: {outreach_strategy.replace('_', ' ')} -> {strategy_cfg}
Our Offer: {user_offer if user_offer else 'General business services'}

═══ REQUIRED PIPELINE ═══
1. Find the strongest conversation angle (e.g., trust without discoverability).
2. Generate an Observation from research.
3. Generate a Curiosity Hook to create tension.
4. Craft the Opening Message. (NEVER pitch, sell, or ask for a call here).
5. Predict the Likely Reply from the prospect.
6. Plan the Next Move (how to continue the conversation).

═══ HUMAN CONVERSATION LAYER ═══
- Goal: Earn a reply.
- Never: sell_service, pitch_offer, explain_solution, book_call_immediately.
- Style: conversational, observational, curiosity_driven, founder_like.
- Avoid: consultant_language, corporate_language, linkedin_guru_language, ai_marketing_language.

═══ FORBIDDEN PHRASES ═══
Do not use: customer engagement, online visibility, digital transformation, significant potential, comprehensive information, tailored solution, drive more sales, growth opportunity, business optimization, maximize conversions, unlock growth, enhance brand presence, improve customer acquisition, strategic transformation.

═══ FORBIDDEN OPENERS ═══
Do not use: "noticed you dont have a website", "we help businesses grow", "we offer website development", "are you looking for more customers", "i help local businesses".

═══ OPENING MESSAGE RULES ═══
Maximum service mentions: 0
Maximum pitching: 0
Maximum call requests: 0
Required structure: observation -> curiosity -> question

Return ONLY valid JSON with these exact keys:
{{
  "opportunity_angle": "string",
  "observation": "string",
  "curiosity_angle": "string",
  "opening_message": "string",
  "likely_reply": "string",
  "next_move": "string",
  "reasoning": "string",
  "personalization_points": ["array of strings"]
}}"""

def _generate_fallback_message(lead_data: dict, channel: str, outreach_strategy: str, user_offer: str) -> dict:
    return {
        "opportunity_angle": f"Missing local discoverability despite good reputation.",
        "observation": f"I was looking at {lead_data.get('category', 'businesses')} in {lead_data.get('city', 'your area')} and saw you have great reviews but are hard to find on maps.",
        "curiosity_angle": "There's a gap between customer satisfaction and new customer acquisition.",
        "opening_message": f"Hey! Was looking at local {lead_data.get('category', 'businesses')} and noticed something interesting about how people are finding you. Curious if you've seen the same thing?",
        "likely_reply": "No, what did you find?",
        "next_move": "Share the specific observation about their map ranking vs their competitors.",
        "reasoning": "Fallback template using a standard observation-to-curiosity flow.",
        "personalization_points": ["Category", "Local search"]
    }

async def generate_outreach_message(
    lead_data: dict,
    channel: str,
    outreach_goal: str,
    outreach_strategy: str,
    user_offer: str = "",
) -> dict:
    channel = channel.lower() if channel else "whatsapp"
    outreach_strategy = outreach_strategy.lower() if outreach_strategy else "curiosity"
    
    api_key = os.getenv("OPENAI_API_KEY", "")
    
    if api_key and HAS_OPENAI:
        try:
            base_url = "https://api.groq.com/openai/v1" if api_key.startswith("gsk_") else "https://api.openai.com/v1"
            model = "llama-3.3-70b-versatile" if api_key.startswith("gsk_") else "gpt-4o-mini"
            client = AsyncOpenAI(api_key=api_key, base_url=base_url)
            prompt = _build_outreach_prompt(lead_data, channel, outreach_goal, outreach_strategy, user_offer)
            
            response = await client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.7,
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
