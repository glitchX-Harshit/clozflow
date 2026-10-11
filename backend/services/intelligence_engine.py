"""
Lead Intelligence Engine
────────────────────────
Provides the AI-native intelligence layer for ClozFlow's Lead Finder.

Endpoints served:
  POST /intelligence/derive-icp      — Derive ICP from user's product/service description
  POST /intelligence/chat            — Conversational refinement + search command translation
  POST /intelligence/why-this-lead   — Explain why a specific lead is relevant
  POST /intelligence/suggestions     — Get contextual action suggestions for current search
"""

import os
import re
import json
from typing import Dict, List, Optional, Tuple

try:
    from openai import OpenAI
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False


# ═══════════════════════════════════════════════════════════════════════════════
# AI CLIENT FACTORY
# ═══════════════════════════════════════════════════════════════════════════════

def _get_ai_client() -> Tuple[Optional[object], Optional[str]]:
    """Return (client, model_name) or (None, None) if no key available."""
    api_key = os.getenv("HEXAGON_RESEARCH_API_KEY", "")
    if not api_key or not HAS_OPENAI:
        return None, None

    if api_key.startswith("AIza") or api_key.startswith("AQ"):
        base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
        model = "gemini-2.0-flash"
    elif api_key.startswith("gsk_"):
        base_url = "https://api.groq.com/openai/v1"
        model = "openai/gpt-oss-120b"
    else:
        base_url = "https://api.openai.com/v1"
        model = "gpt-4o-mini"

    client = OpenAI(api_key=api_key, base_url=base_url)
    return client, model


def _call_ai(messages: List[Dict], max_tokens: int = 1200) -> Optional[str]:
    """Call AI and return text content, or None on failure."""
    client, model = _get_ai_client()
    if not client:
        return None
    try:
        kwargs = {
            "model": model,
            "messages": messages,
            "temperature": 0.65,
            "max_tokens": max_tokens,
        }
        try:
            resp = client.chat.completions.create(**kwargs, response_format={"type": "json_object"})
        except Exception:
            resp = client.chat.completions.create(**kwargs)
        return resp.choices[0].message.content.strip()
    except Exception as e:
        print(f"[Intelligence] AI call failed: {e}")
        return None


def _parse_json(text: str) -> Optional[Dict]:
    """Safely parse JSON from AI output."""
    if not text:
        return None
    text = text.strip()
    if "```" in text:
        m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
        if m:
            text = m.group(1).strip()
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        text = m.group(0)
    try:
        return json.loads(text)
    except Exception:
        pass
    try:
        return json.loads(re.sub(r"[\r\n]+", " ", text))
    except Exception:
        return None


# ═══════════════════════════════════════════════════════════════════════════════
# ICP DERIVATION
# ═══════════════════════════════════════════════════════════════════════════════

ICP_PROMPT = """You are a B2B sales strategy AI. A user has described what they sell.
Your job is to derive their Ideal Customer Profile (ICP).

User's product/service: "{offer}"

Return a JSON object with exactly these fields:
{{
  "primaryCustomer": "1 sentence describing the primary target customer type",
  "segments": ["3-5 specific business segment strings"],
  "likelyBuyers": ["2-4 job titles/roles who would buy this"],
  "usefulSignals": ["4-6 observable signals that indicate a business needs this product"],
  "derivedFrom": "short restatement of their product/service in 5 words or fewer",
  "searchSuggestion": "A natural language search query to find these customers (e.g. 'restaurants in Mumbai')",
  "confidence": "high|medium|low"
}}

Be specific and business-focused. Avoid generic answers.
Return ONLY valid JSON."""


def derive_icp(offer: str) -> Dict:
    """Derive ICP from user's product/service description."""
    print(f"[Intelligence] Deriving ICP for offer: '{offer}'")

    raw = _call_ai([
        {"role": "system", "content": "You are a sales intelligence AI. Respond only with valid JSON."},
        {"role": "user", "content": ICP_PROMPT.format(offer=offer)},
    ])

    parsed = _parse_json(raw) if raw else None

    if parsed and "primaryCustomer" in parsed:
        print(f"[Intelligence] ICP derived: {parsed['primaryCustomer']}")
        return {
            "success": True,
            "icp": {
                "primaryCustomer": parsed.get("primaryCustomer", ""),
                "segments": parsed.get("segments", []),
                "likelyBuyers": parsed.get("likelyBuyers", []),
                "usefulSignals": parsed.get("usefulSignals", []),
                "derivedFrom": parsed.get("derivedFrom", offer[:40]),
                "searchSuggestion": parsed.get("searchSuggestion", ""),
                "confidence": parsed.get("confidence", "medium"),
            }
        }

    # Fallback — rule-based ICP
    return _fallback_icp(offer)


def _fallback_icp(offer: str) -> Dict:
    """Rule-based ICP fallback when AI is unavailable."""
    offer_lower = offer.lower()

    # Heuristic segment matching
    if any(w in offer_lower for w in ["website", "web dev", "landing page", "wordpress"]):
        icp = {
            "primaryCustomer": "Small and mid-sized local businesses with no or outdated website",
            "segments": ["restaurants", "salons", "local retail shops", "clinics", "coaching centers"],
            "likelyBuyers": ["Owner", "Founder", "Marketing Manager"],
            "usefulSignals": ["no website detected", "active on Instagram", "high Google reviews", "local service business"],
            "derivedFrom": "website development",
            "searchSuggestion": "local businesses in your city",
            "confidence": "medium",
        }
    elif any(w in offer_lower for w in ["video", "edit", "content", "reel", "youtube"]):
        icp = {
            "primaryCustomer": "Brands and creators with active social presence needing professional video content",
            "segments": ["D2C brands", "restaurants", "fitness studios", "influencer businesses", "agencies"],
            "likelyBuyers": ["Founder", "Marketing Lead", "Content Manager"],
            "usefulSignals": ["active Instagram presence", "product-based business", "growing brand", "no professional content"],
            "derivedFrom": "video editing",
            "searchSuggestion": "D2C brands with Instagram presence",
            "confidence": "medium",
        }
    elif any(w in offer_lower for w in ["crm", "software", "saas", "automation", "ai"]):
        icp = {
            "primaryCustomer": "Growing B2B businesses with manual workflows and high customer volume",
            "segments": ["agencies", "professional services", "SaaS companies", "B2B consultancies", "sales teams"],
            "likelyBuyers": ["CEO", "Operations Lead", "Sales Manager", "Founder"],
            "usefulSignals": ["high review volume", "appointment-based workflow", "no CRM visible", "growing team"],
            "derivedFrom": offer[:30],
            "searchSuggestion": "B2B businesses and agencies",
            "confidence": "medium",
        }
    elif any(w in offer_lower for w in ["seo", "marketing", "ads", "social media", "digital"]):
        icp = {
            "primaryCustomer": "Local businesses with weak digital marketing and active customer bases",
            "segments": ["local retail", "restaurants", "gyms", "boutiques", "salons"],
            "likelyBuyers": ["Owner", "Marketing Manager", "Co-Founder"],
            "usefulSignals": ["no Instagram", "no website", "active but invisible online", "strong local reviews"],
            "derivedFrom": "marketing services",
            "searchSuggestion": "local businesses without social media",
            "confidence": "medium",
        }
    else:
        icp = {
            "primaryCustomer": "Small and mid-sized businesses that could benefit from your services",
            "segments": ["local businesses", "SMBs", "service companies", "growing startups"],
            "likelyBuyers": ["Owner", "Founder", "Manager"],
            "usefulSignals": ["active business", "visible online presence", "high review count", "growing customer base"],
            "derivedFrom": offer[:30],
            "searchSuggestion": "businesses in your target city",
            "confidence": "low",
        }

    return {"success": True, "icp": icp}


# ═══════════════════════════════════════════════════════════════════════════════
# CONVERSATIONAL SEARCH COMMAND TRANSLATION
# ═══════════════════════════════════════════════════════════════════════════════

CHAT_SYSTEM_PROMPT = """You are the Lead Intelligence AI for ClozFlow, a sales discovery tool.
You help users find their ideal customers by understanding their product and target audience.

You can do two things:
1. Answer questions about leads, ICPs, and sales strategy
2. Translate user requests into search commands that update the Lead Finder

When the user asks you to find, filter, or change what they're searching for,
you MUST return a search_command in your response.

Current context:
- User sells: {user_offer}
- Current search: {current_query}
- Current ICP: {icp_summary}

Respond with JSON:
{{
  "reply": "Your conversational response (1-3 sentences, premium and direct)",
  "search_command": {{
    "query": "new search query string if applicable, else null",
    "mode": "high_fit_leads|top_businesses|growth_opportunities|underserved_businesses|local_smbs|null",
    "filters": {{}} or null
  }},
  "suggestions": ["2-3 follow-up action strings the user might want to take next"]
}}

search_command fields are optional — only include them when the user is asking to change the search.
reply must always be present.
Return ONLY valid JSON."""


def process_chat_message(
    user_message: str,
    user_offer: str = "",
    current_query: str = "",
    icp: Optional[Dict] = None,
    conversation_history: Optional[List[Dict]] = None,
) -> Dict:
    """Process a conversational message and return reply + optional search command."""
    print(f"[Intelligence] Processing chat: '{user_message}'")

    icp_summary = ""
    if icp:
        icp_summary = f"{icp.get('primaryCustomer', '')} — segments: {', '.join(icp.get('segments', [])[:3])}"

    system_prompt = CHAT_SYSTEM_PROMPT.format(
        user_offer=user_offer or "not specified",
        current_query=current_query or "none",
        icp_summary=icp_summary or "not defined",
    )

    messages = [{"role": "system", "content": system_prompt}]

    # Include recent conversation history
    if conversation_history:
        for msg in conversation_history[-6:]:  # last 3 turns
            messages.append({"role": msg["role"], "content": msg["content"]})

    messages.append({"role": "user", "content": user_message})

    raw = _call_ai(messages, max_tokens=800)
    parsed = _parse_json(raw) if raw else None

    if parsed and "reply" in parsed:
        result = {
            "success": True,
            "reply": parsed.get("reply", ""),
            "suggestions": parsed.get("suggestions", []),
        }

        sc = parsed.get("search_command")
        if sc and isinstance(sc, dict):
            if sc.get("query") or sc.get("mode") or sc.get("filters"):
                result["search_command"] = {
                    "query": sc.get("query") or None,
                    "mode": sc.get("mode") or None,
                    "filters": sc.get("filters") or {},
                }

        return result

    # Fallback — rule-based command parsing
    return _fallback_chat(user_message, current_query)


def _fallback_chat(user_message: str, current_query: str) -> Dict:
    """Rule-based fallback for common chat commands when AI is unavailable."""
    msg = user_message.lower().strip()

    # Location change patterns
    city_match = re.search(r'(?:in|from|around|near)\s+([a-zA-Z\s]+?)(?:\s|$|\.)', msg)
    size_match = re.search(r'(?:fewer than|less than|under|max)\s+(\d+)\s+(?:employees|people|staff)', msg)
    no_website = "no website" in msg or "without website" in msg
    has_instagram = "instagram" in msg or "social" in msg
    high_fit = "high.fit" in msg or "best" in msg or "top" in msg

    sc = {}
    reply_parts = []

    if city_match:
        city = city_match.group(1).strip().title()
        if current_query:
            base = re.sub(r'\s+in\s+\w[\w\s]*$', '', current_query, flags=re.IGNORECASE)
            sc["query"] = f"{base} in {city}"
        reply_parts.append(f"narrowed to {city}")

    if no_website:
        sc["mode"] = "underserved_businesses"
        reply_parts.append("prioritising businesses without websites")

    if high_fit:
        sc["mode"] = "high_fit_leads"
        reply_parts.append("sorted by highest fit")

    if has_instagram:
        sc["filters"] = {"instagram_presence": True}
        reply_parts.append("filtering for Instagram presence")

    reply = "Got it. I've " + ", ".join(reply_parts) + "." if reply_parts else "I've updated your search."

    result = {
        "success": True,
        "reply": reply,
        "suggestions": [
            "Show strongest opportunities",
            "Find businesses without websites",
            "Find businesses with strong social presence",
        ],
    }
    if sc:
        result["search_command"] = sc

    return result


# ═══════════════════════════════════════════════════════════════════════════════
# WHY THIS LEAD
# ═══════════════════════════════════════════════════════════════════════════════

WHY_LEAD_PROMPT = """You are a sales intelligence AI. Given a business lead's data and the user's product/service,
explain concisely why this lead is (or isn't) a good prospect.

User's product/service: {user_offer}

Lead data:
- Name: {business_name}
- Category: {category}
- City: {city}
- Rating: {google_rating}/5 ({reviews_count} reviews)
- Website: {website}
- Instagram: {instagram}
- Opportunity Score: {opportunity_score}/100
- Buying Probability: {buying_probability}
- Opportunity Signals: {signals}

Return JSON:
{{
  "headline": "1 punchy sentence — why or why not this lead",
  "signals": ["2-4 specific observed signals as short strings"],
  "approach": "1-2 sentence recommended sales approach tailored to this lead",
  "confidence": "high|medium|low",
  "data_note": "If data is insufficient or signals can't be verified, note it here. Otherwise empty string."
}}

Be honest. Do NOT fabricate data. If you cannot verify something, say so.
Return ONLY valid JSON."""


def explain_lead(lead: Dict, user_offer: str = "") -> Dict:
    """Explain why a specific lead is (or isn't) relevant."""
    print(f"[Intelligence] Explaining lead: {lead.get('business_name')}")

    signals_str = ", ".join(lead.get("opportunity_signals", [])[:4]) or "none detected"

    raw = _call_ai([
        {"role": "system", "content": "You are a sales intelligence AI. Return only valid JSON."},
        {"role": "user", "content": WHY_LEAD_PROMPT.format(
            user_offer=user_offer or "general business services",
            business_name=lead.get("business_name", "Unknown"),
            category=lead.get("category", ""),
            city=lead.get("city", ""),
            google_rating=lead.get("google_rating", 0),
            reviews_count=lead.get("reviews_count", 0),
            website=lead.get("website") or "None",
            instagram=lead.get("instagram") or "None",
            opportunity_score=lead.get("opportunity_score", 0),
            buying_probability=lead.get("buying_probability", "Unknown"),
            signals=signals_str,
        )},
    ])

    parsed = _parse_json(raw) if raw else None

    if parsed and "headline" in parsed:
        return {
            "success": True,
            "headline": parsed.get("headline", ""),
            "signals": parsed.get("signals", []),
            "approach": parsed.get("approach", ""),
            "confidence": parsed.get("confidence", "medium"),
            "data_note": parsed.get("data_note", ""),
        }

    # Fallback from existing lead data
    return _fallback_why_lead(lead, user_offer)


def _fallback_why_lead(lead: Dict, user_offer: str) -> Dict:
    """Generate why-this-lead explanation from existing scored data."""
    score = lead.get("opportunity_score", 0)
    signals = lead.get("opportunity_signals", [])[:4]
    reason = lead.get("opportunity_reason", "")
    outreach = lead.get("outreach_angle", "")
    prob = lead.get("buying_probability", "Medium")

    if score >= 70:
        headline = f"Strong prospect — {prob.lower()} buying probability based on {len(signals)} signals."
    elif score >= 45:
        headline = f"Moderate opportunity — some positive signals worth pursuing."
    else:
        headline = f"Lower priority — limited signals detected for this lead."

    return {
        "success": True,
        "headline": headline,
        "signals": signals if signals else [reason] if reason else ["Opportunity score signals detected"],
        "approach": outreach or "Lead with value first — understand their current setup before pitching.",
        "confidence": "high" if score >= 70 else "medium" if score >= 45 else "low",
        "data_note": "Analysis based on available digital presence signals." if not signals else "",
    }


# ═══════════════════════════════════════════════════════════════════════════════
# CONTEXTUAL SUGGESTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def generate_suggestions(
    current_query: str = "",
    user_offer: str = "",
    leads_count: int = 0,
    icp: Optional[Dict] = None,
) -> List[str]:
    """Generate contextual action suggestions based on current search state."""
    suggestions = []
    q = current_query.lower()

    # Query-specific suggestions
    if any(w in q for w in ["cafe", "coffee", "restaurant", "food", "bakery"]):
        suggestions = [
            "Find cafes without a website",
            "Find cafes with strong Instagram presence",
            "Find cafes with 100+ reviews",
            "Find underserved cafes in this area",
        ]
    elif any(w in q for w in ["gym", "fitness", "yoga", "sports"]):
        suggestions = [
            "Find gyms without a booking system",
            "Find fitness studios with strong Instagram",
            "Find gyms without a website",
            "Find growing fitness studios",
        ]
    elif any(w in q for w in ["salon", "spa", "beauty", "hair"]):
        suggestions = [
            "Find salons without websites",
            "Find high-rated salons with no Instagram",
            "Find premium salons",
            "Find salons with weak digital presence",
        ]
    elif any(w in q for w in ["d2c", "brand", "ecommerce", "shop", "store"]):
        suggestions = [
            "Find brands with strong social presence",
            "Find brands with ecommerce stores",
            "Find emerging brands",
            "Find brands with website opportunities",
        ]
    elif any(w in q for w in ["agency", "marketing", "digital", "consulting"]):
        suggestions = [
            "Find agencies without strong online presence",
            "Find boutique agencies",
            "Find growing agencies",
            "Find agencies with website issues",
        ]
    elif any(w in q for w in ["clinic", "doctor", "hospital", "dental", "medical"]):
        suggestions = [
            "Find clinics without websites",
            "Find high-rated clinics",
            "Find clinics without booking systems",
            "Find growing medical practices",
        ]
    else:
        # Generic fallback suggestions
        suggestions = [
            "Find businesses without websites",
            "Find businesses with strong Instagram presence",
            "Find highest-fit opportunities",
            "Find underserved businesses in this area",
        ]

    # Offer-aware additions
    if user_offer:
        offer_lower = user_offer.lower()
        if "website" in offer_lower:
            suggestions = ["Find businesses without websites"] + [s for s in suggestions if "website" not in s.lower()][:3]
        elif "video" in offer_lower or "content" in offer_lower:
            suggestions = ["Find businesses with active Instagram"] + [s for s in suggestions if "instagram" not in s.lower()][:3]
        elif "seo" in offer_lower:
            suggestions = ["Find businesses with existing websites"] + [s for s in suggestions if "website" not in s.lower()][:3]

    return suggestions[:4]
