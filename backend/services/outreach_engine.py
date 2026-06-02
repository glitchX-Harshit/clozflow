"""
Outreach Message Generation Engine V2
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
        "tone": "conversational, personal, concise",
        "style": "SHORT",
        "max_words": 60,
    },
    "instagram": {
        "tone": "casual, friendly, curiosity_driven",
        "style": "SHORT",
        "max_words": 80,
    },
    "linkedin": {
        "tone": "professional, business_focused, authority",
        "style": "MEDIUM",
        "max_words": 150,
    },
    "email": {
        "tone": "detailed, consultative, research_based",
        "style": "LONG",
        "max_words": 300,
    },
}

STRATEGY_CONFIG = {
    "curiosity": "Start conversation through observation. Make them wonder what you found.",
    "insight": "Share a business insight based on their specific situation.",
    "opportunity": "Highlight a specific growth opportunity you've identified.",
    "problem": "Surface a hidden issue or bottleneck in their current setup.",
}

GOAL_CONTEXT = {
    "start_conversation": "Open a dialogue. Do NOT pitch.",
    "book_call": "Get them to agree to a short call or meeting.",
    "follow_up": "Re-engage after a previous touchpoint.",
    "re_engage": "Reignite interest with a cold lead.",
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
    if len(message.split()) < 60:
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
    
    return f"""You are an expert AI outreach strategist. Your goal is to create conversation opportunities based on business angles, NOT just generate generic messages.

═══ LEAD RESEARCH DATA ═══
Business Name: {lead_data.get('business_name', 'Unknown')}
Category: {lead_data.get('category', 'Unknown')}
City: {lead_data.get('city', 'Unknown')}
AI Summary: {lead_data.get('ai_summary', 'N/A')}
Pain Point: {lead_data.get('likely_pain_point', 'N/A')}
Opportunity Summary: {lead_data.get('opportunity_summary', 'N/A')}

═══ OUTREACH CONFIGURATION ═══
Channel: {channel.upper()} (Tone: {channel_cfg['tone']}, Length: {channel_cfg['style']})
Goal: {outreach_goal.replace('_', ' ')}
Strategy: {outreach_strategy.replace('_', ' ')} -> {strategy_cfg}
Our Offer: {user_offer if user_offer else 'General business services'}

═══ REQUIRED PIPELINE ═══
1. Find the strongest business angle (e.g., trust without discoverability, demand without conversion).
2. Generate an Opportunity Insight (why this lead is worth contacting).
3. Explain Why This Matters.
4. Craft the Opening Message.
5. Craft a Follow-up Message.
6. Craft a Transition to Call.

═══ RULES ═══
- Forbidden: selling immediately, mentioning services in first line, generic compliments, obvious pitching, AI-style openers (e.g., "noticed you don't have a website", "we help businesses grow").
- Required: observation, curiosity, business context, conversation hook.
- Good example openers: "one thing stood out while reviewing local businesses in your category", "the interesting part isn't your reviews, it's what happens before customers find them".

Return ONLY valid JSON with these exact keys:
{{
  "opportunity_insight": "string",
  "why_this_matters": "string",
  "opening_message": "string",
  "followup_message": "string",
  "call_transition": "string",
  "reasoning": "string",
  "personalization_points": ["array of strings"]
}}"""

def _generate_fallback_message(lead_data: dict, channel: str, outreach_strategy: str, user_offer: str) -> dict:
    return {
        "opportunity_insight": f"Identified missing optimization for {lead_data.get('business_name', 'this business')}.",
        "why_this_matters": "This limits their ability to capture local demand effectively.",
        "opening_message": f"Hey! Was looking at local {lead_data.get('category', 'businesses')} and noticed something interesting about how people find you. Open to a quick thought?",
        "followup_message": "Just circling back—I had a specific idea on how to improve your local discoverability.",
        "call_transition": "Would you have 10 mins this week to see if this makes sense for you?",
        "reasoning": "Fallback template based on curiosity hook.",
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
