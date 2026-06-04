"""
Lead Discovery & Opportunity Scoring Engine
────────────────────────────────────────────
• search_leads(query)             → Google Places API (Text Search)
• enrich_lead_ai(lead, offer)     → AI analysis via Groq (OpenAI-compatible)
• _compute_opportunity_score()    → Rule-based opportunity scoring (no API)
• _filter_enterprises()           → Remove large enterprises / franchises
• Graceful fallback to realistic mock data when keys are missing
"""

import os
import re
import json
import hashlib
from datetime import datetime
from typing import List, Dict, Optional

# ── Optional imports ─────────────────────────────────────────────────────────
try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False

try:
    from openai import OpenAI
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False


# ═══════════════════════════════════════════════════════════════════════════════
# ENTERPRISE / FRANCHISE FILTER
# ═══════════════════════════════════════════════════════════════════════════════

_ENTERPRISE_SIGNALS = [
    "starbucks", "mcdonald", "subway", "domino", "pizza hut", "burger king",
    "kfc", "dunkin", "taco bell", "wendy", "walmart", "target", "costco",
    "ikea", "h&m", "zara", "nike", "adidas", "amazon", "flipkart",
    "reliance", "tata", "hdfc", "icici", "sbi", "axis bank", "kotak",
    "apollo", "fortis", "max hospital", "marriott", "hilton", "hyatt",
    "oberoi", "taj hotel", "radisson", "holiday inn", "best western",
    "7-eleven", "circle k", "shell", "bp", "haldiram", "bikanervala",
    "chai point", "cafe coffee day", "starbucks", "costa coffee",
]


def _filter_enterprises(leads: list) -> list:
    """Remove leads whose names contain signals of large enterprises or franchises."""
    filtered = []
    for lead in leads:
        name_lower = lead.get("business_name", "").lower()
        is_enterprise = any(signal in name_lower for signal in _ENTERPRISE_SIGNALS)
        if is_enterprise:
            print(f"[LeadEngine] Filtered out enterprise/franchise: {lead.get('business_name')}")
        else:
            filtered.append(lead)
    print(f"[LeadEngine] Enterprise filter: {len(leads)} → {len(filtered)} leads")
    return filtered


# ═══════════════════════════════════════════════════════════════════════════════
# OPPORTUNITY SCORING ENGINE — Pure rule-based, no API calls
# ═══════════════════════════════════════════════════════════════════════════════

OFFER_SCORING_RULES = {
    "website development": {
        "positive_signals": lambda l: [
            (not l.get("website"), 15, "No website — high-value prospect"),
            (l.get("google_rating", 0) >= 4.0, 8, "Active business with strong reviews"),
            (bool(l.get("instagram")), 5, "Active on social, ready for digital expansion"),
        ],
    },
    "video editing": {
        "positive_signals": lambda l: [
            (bool(l.get("instagram")), 12, "Active social media presence"),
            (l.get("google_rating", 0) >= 3.5, 5, "Established business needing content"),
            (not l.get("website"), 3, "Low digital presence — content could help"),
        ],
    },
    "ai automation": {
        "positive_signals": lambda l: [
            (l.get("google_rating", 0) >= 4.0, 10, "High-activity business — automation saves time"),
            (bool(l.get("phone_number")), 8, "Appointment-based — automation opportunity"),
            (not l.get("website") or not l.get("instagram"), 5, "Manual workflows likely"),
        ],
    },
    "marketing agency": {
        "positive_signals": lambda l: [
            (not l.get("instagram"), 15, "Weak social presence — marketing opportunity"),
            (not l.get("website"), 8, "No digital presence"),
            (l.get("google_rating", 0) >= 3.5, 5, "Active business needs visibility"),
        ],
    },
    "seo services": {
        "positive_signals": lambda l: [
            (bool(l.get("website")), 10, "Has website — SEO applicable"),
            (l.get("google_rating", 0) >= 3.5, 8, "Established enough to invest in SEO"),
            (not l.get("instagram"), 5, "Weak digital footprint"),
        ],
    },
    "crm software": {
        "positive_signals": lambda l: [
            (l.get("google_rating", 0) >= 4.0, 12, "High-volume business needs CRM"),
            (bool(l.get("phone_number")), 8, "Phone-based workflow — CRM fits"),
            (bool(l.get("website")), 3, "Has digital presence — ready for CRM"),
        ],
    },
}


def _compute_opportunity_score(lead: dict, user_offer: str) -> dict:
    """
    Compute a multi-factor opportunity score (0–100) for a lead.
    Pure rule-based — no API calls required.

    Factors & Weights:
        digital_presence   (25)  — No website = higher opportunity
        website_quality    (20)  — No website = full points
        social_presence    (15)  — Context-dependent
        review_activity    (10)  — Higher rating = active business
        business_growth    (15)  — Rating 4.0+ = growth phase
        service_offer_fit  (15)  — How well the user's offer matches
    """
    signals: List[str] = []
    factor_scores: Dict[str, float] = {}

    has_website = bool(lead.get("website"))
    has_instagram = bool(lead.get("instagram"))
    rating = lead.get("google_rating", 0) or 0
    has_phone = bool(lead.get("phone_number"))

    # ── Factor 1: Digital Presence (weight 25) ───────────────────────────────
    if not has_website and not has_instagram:
        factor_scores["digital_presence"] = 25
        signals.append("No digital presence — greenfield opportunity")
    elif not has_website:
        factor_scores["digital_presence"] = 20
        signals.append("No website — digital gap")
    elif not has_instagram:
        factor_scores["digital_presence"] = 12
        signals.append("No social media — partial digital presence")
    else:
        factor_scores["digital_presence"] = 5
        signals.append("Has website and social media")

    # ── Factor 2: Website Quality (weight 20) ────────────────────────────────
    if not has_website:
        factor_scores["website_quality"] = 20
        signals.append("No website — full opportunity for web services")
    else:
        factor_scores["website_quality"] = 5
        signals.append("Has existing website")

    # ── Factor 3: Social Presence (weight 15) ────────────────────────────────
    if has_instagram:
        factor_scores["social_presence"] = 10
        signals.append("Active on social media — engaged with digital")
    else:
        factor_scores["social_presence"] = 15
        signals.append("No social presence — marketing opportunity")

    # ── Factor 4: Review Activity (weight 10) ────────────────────────────────
    if rating >= 4.5:
        factor_scores["review_activity"] = 10
        signals.append(f"Excellent reviews ({rating}/5) — thriving business")
    elif rating >= 4.0:
        factor_scores["review_activity"] = 8
        signals.append(f"Strong reviews ({rating}/5) — active business")
    elif rating >= 3.5:
        factor_scores["review_activity"] = 5
        signals.append(f"Moderate reviews ({rating}/5)")
    else:
        factor_scores["review_activity"] = 2
        signals.append(f"Low reviews ({rating}/5) — may struggle")

    # ── Factor 5: Business Growth Signals (weight 15) ────────────────────────
    if rating >= 4.5:
        factor_scores["business_growth_signals"] = 15
        signals.append("High-growth phase — likely investing in business")
    elif rating >= 4.0:
        factor_scores["business_growth_signals"] = 12
        signals.append("Growth phase — open to new solutions")
    elif rating >= 3.5:
        factor_scores["business_growth_signals"] = 7
        signals.append("Stable business — may need convincing")
    else:
        factor_scores["business_growth_signals"] = 3
        signals.append("Early/struggling stage")

    # ── Factor 6: Service-Offer Fit (weight 15) ──────────────────────────────
    offer_key = user_offer.lower().strip() if user_offer else ""
    offer_fit_score = 0
    offer_signals: List[str] = []

    if offer_key in OFFER_SCORING_RULES:
        rule = OFFER_SCORING_RULES[offer_key]
        signal_checks = rule["positive_signals"](lead)
        for condition, points, reason in signal_checks:
            if condition:
                offer_fit_score += points
                offer_signals.append(reason)
        # Cap at 15
        offer_fit_score = min(offer_fit_score, 15)
    elif offer_key:
        # Default scoring for unknown offers
        if not has_website:
            offer_fit_score += 5
            offer_signals.append("No website — potential digital service need")
        if not has_instagram:
            offer_fit_score += 4
            offer_signals.append("No social media — outreach opportunity")
        if rating >= 4.0:
            offer_fit_score += 4
            offer_signals.append("Active business — likely to invest")
        if has_phone:
            offer_fit_score += 2
            offer_signals.append("Reachable by phone")
        offer_fit_score = min(offer_fit_score, 15)
    else:
        # No offer specified — give moderate default
        offer_fit_score = 7
        offer_signals.append("No specific offer — using general scoring")

    factor_scores["service_offer_fit"] = offer_fit_score
    signals.extend(offer_signals)

    # ── Aggregate ────────────────────────────────────────────────────────────
    total_score = sum(factor_scores.values())
    total_score = max(0, min(100, int(total_score)))

    # Determine buying probability
    if total_score >= 70:
        buying_probability = "High"
    elif total_score >= 40:
        buying_probability = "Medium"
    else:
        buying_probability = "Low"

    # Pick the top reason (highest-weight factor)
    top_factor = max(factor_scores, key=factor_scores.get)
    top_reason_map = {
        "digital_presence": "Significant gaps in digital presence create a strong opportunity",
        "website_quality": "Missing or weak website — prime candidate for digital services",
        "social_presence": "Social media gap indicates untapped marketing potential",
        "review_activity": "Active review profile signals a thriving, engaged business",
        "business_growth_signals": "Growth indicators suggest readiness to invest",
        "service_offer_fit": "Strong alignment between your offer and their needs",
    }
    opportunity_reason = top_reason_map.get(top_factor, "General opportunity detected")

    # Attach to lead
    lead["opportunity_score"] = total_score
    lead["opportunity_reason"] = opportunity_reason
    lead["opportunity_signals"] = signals
    lead["buying_probability"] = buying_probability

    print(f"[LeadEngine] Scored '{lead.get('business_name')}': {total_score}/100 ({buying_probability})")
    return lead


# ═══════════════════════════════════════════════════════════════════════════════
# SEARCH MODES
# ═══════════════════════════════════════════════════════════════════════════════

SEARCH_MODES = {
    "high_fit_leads": "Sort by opportunity_score descending (default)",
    "top_businesses": "Sort by google_rating descending",
    "growth_opportunities": "Filter to businesses with rating >= 4.0 and no website",
    "underserved_businesses": "Filter to businesses with no website AND no instagram",
    "local_smbs": "Sort by opportunity_score, exclude any with very high ratings (4.8+) which might be chains",
}


def _apply_search_mode(leads: list, mode: str) -> list:
    """Apply search mode sorting/filtering to the lead list."""
    mode = mode if mode in SEARCH_MODES else "high_fit_leads"
    print(f"[LeadEngine] Applying search mode: {mode}")

    if mode == "high_fit_leads":
        leads.sort(key=lambda x: x.get("opportunity_score", 0), reverse=True)

    elif mode == "top_businesses":
        leads.sort(key=lambda x: x.get("google_rating", 0), reverse=True)

    elif mode == "growth_opportunities":
        leads = [
            l for l in leads
            if (l.get("google_rating", 0) or 0) >= 4.0 and not l.get("website")
        ]
        leads.sort(key=lambda x: x.get("opportunity_score", 0), reverse=True)

    elif mode == "underserved_businesses":
        leads = [
            l for l in leads
            if not l.get("website") and not l.get("instagram")
        ]
        leads.sort(key=lambda x: x.get("opportunity_score", 0), reverse=True)

    elif mode == "local_smbs":
        leads = [
            l for l in leads
            if (l.get("google_rating", 0) or 0) < 4.8
        ]
        leads.sort(key=lambda x: x.get("opportunity_score", 0), reverse=True)

    print(f"[LeadEngine] After search mode '{mode}': {len(leads)} leads")
    return leads


# ═══════════════════════════════════════════════════════════════════════════════
# DYNAMIC MOCK GENERATOR — generates leads for ANY business type + ANY city
# ═══════════════════════════════════════════════════════════════════════════════

# Name prefixes/suffixes that get combined with the business type to create realistic names
_NAME_PREFIXES = [
    "The", "Royal", "Prime", "Elite", "Urban", "Golden", "Star", "Bright",
    "Nova", "Metro", "Classic", "Supreme", "Ace", "NextGen", "Pro",
]
_NAME_SUFFIXES = [
    "Hub", "Zone", "Point", "Studio", "Works", "Place", "Corner", "Center",
    "House", "Spot", "Lab", "Square", "Junction", "World", "Empire",
]

# Localities per city (used when city is known)
_CITY_LOCALITIES = {
    "delhi":     ["Connaught Place", "Hauz Khas", "Saket", "Lajpat Nagar", "Rajouri Garden", "Greater Kailash", "Dwarka", "Rohini", "Karol Bagh", "Defence Colony"],
    "mumbai":    ["Andheri West", "Bandra", "Lower Parel", "Powai", "Juhu", "Dadar", "Worli", "Malad", "Goregaon", "Thane"],
    "bangalore": ["Indiranagar", "Koramangala", "HSR Layout", "Whitefield", "Jayanagar", "MG Road", "Marathahalli", "Electronic City", "JP Nagar", "Malleshwaram"],
    "hyderabad": ["Banjara Hills", "Jubilee Hills", "Gachibowli", "Hitech City", "Madhapur", "Kukatpally", "Ameerpet", "Secunderabad", "Kondapur", "Begumpet"],
    "pune":      ["Koregaon Park", "Viman Nagar", "Hinjewadi", "Kothrud", "Baner", "Aundh", "Shivaji Nagar", "Wakad", "Hadapsar", "Magarpatta"],
    "chennai":   ["T. Nagar", "Adyar", "Anna Nagar", "Velachery", "Nungambakkam", "Besant Nagar", "Mylapore", "Porur", "Sholinganallur", "Tambaram"],
    "kolkata":   ["Park Street", "Salt Lake", "New Town", "Ballygunge", "Howrah", "Dum Dum", "Gariahat", "Jadavpur", "Alipore", "Rajarhat"],
    "jaipur":    ["C-Scheme", "Malviya Nagar", "Vaishali Nagar", "Raja Park", "Mansarovar", "Tonk Road", "Bani Park", "Sodala", "Jagatpura", "Ajmer Road"],
    "ahmedabad": ["CG Road", "Prahlad Nagar", "SG Highway", "Navrangpura", "Satellite", "Maninagar", "Bopal", "Vastrapur", "Ellisbridge", "Thaltej"],
    "lucknow":   ["Hazratganj", "Gomti Nagar", "Aliganj", "Aminabad", "Indira Nagar", "Charbagh", "Alambagh", "Mahanagar", "Vikas Nagar", "Rajajipuram"],
}

# Fallback localities when city isn't in our map
_DEFAULT_LOCALITIES = ["Main Road", "Market Area", "City Center", "Station Road", "Ring Road", "Commercial Street", "High Street", "Business Park", "Old Town", "New Extension"]


def _generate_mock_leads(business_type: str, location: str, count: int = 20) -> List[Dict]:
    """
    Dynamically generate realistic mock leads for ANY business type in ANY city.
    Uses deterministic seeding so the same query always returns the same results.
    """
    import random as _rng

    bt = business_type.strip()
    bt_title = bt.title()
    city = location.strip().title() if location else "Delhi"
    city_key = city.lower()

    # Deterministic seed from query so results are stable
    seed = int(hashlib.md5(f"{bt}{city}".lower().encode()).hexdigest()[:8], 16)
    rng = _rng.Random(seed)

    # Pick localities for this city
    localities = _CITY_LOCALITIES.get(city_key, _DEFAULT_LOCALITIES)

    leads = []
    used_names = set()

    for i in range(count):
        # Generate a unique business name
        for _ in range(20):  # avoid infinite loop
            prefix = rng.choice(_NAME_PREFIXES)
            suffix = rng.choice(_NAME_SUFFIXES)
            # Mix up the naming patterns
            patterns = [
                f"{prefix} {bt_title} {suffix}",
                f"{bt_title} {suffix}",
                f"The {bt_title} {suffix}",
                f"{prefix} {bt_title}",
                f"{bt_title} by {prefix}",
                f"{prefix}{suffix} {bt_title}",
            ]
            name = rng.choice(patterns)
            if name not in used_names:
                used_names.add(name)
                break

        locality = rng.choice(localities)
        rating = round(rng.uniform(3.2, 4.9), 1)
        has_website = rng.random() > 0.3
        has_ig = rng.random() > 0.4

        # Generate a realistic phone number
        phone_prefix = rng.choice(["98", "99", "88", "87", "91", "70", "80"])
        phone_rest = "".join([str(rng.randint(0, 9)) for _ in range(8)])
        phone = f"+91 {phone_prefix}{phone_rest[:3]} {phone_rest[3:]}"

        # Generate website slug
        slug = name.lower().replace(" ", "").replace("&", "and")[:18]
        website = f"https://{slug}.{'in' if rng.random() > 0.5 else 'com'}" if has_website else ""

        # Generate instagram handle
        ig_slug = name.lower().replace(" ", "_").replace("&", "")[:20]
        ig_city_tag = city.lower()[:3]
        instagram = f"@{ig_slug}.{ig_city_tag}" if has_ig else ""

        leads.append({
            "business_name": name,
            "category": bt_title,
            "city": city,
            "phone_number": phone,
            "website": website,
            "instagram": instagram,
            "google_rating": rating,
            "address": f"{locality}, {city}",
        })

    print(f"[LeadEngine] Generated {len(leads)} mock leads for '{bt_title}' in '{city}'")
    return leads


# ═══════════════════════════════════════════════════════════════════════════════
# QUERY PARSING
# ═══════════════════════════════════════════════════════════════════════════════

def parse_search_query(query: str) -> Dict[str, str]:
    """Extract business type and location from natural-language query."""
    q = query.lower().strip()
    # Remove common prefixes
    for prefix in ["find ", "search ", "look for ", "get ", "show me ", "list "]:
        if q.startswith(prefix):
            q = q[len(prefix):]
            break

    # Try to extract "X in Y"
    match = re.match(r"(.+?)\s+in\s+(.+)", q, re.IGNORECASE)
    if match:
        return {"business_type": match.group(1).strip(), "location": match.group(2).strip()}

    # Try "X near Y"
    match = re.match(r"(.+?)\s+near\s+(.+)", q, re.IGNORECASE)
    if match:
        return {"business_type": match.group(1).strip(), "location": match.group(2).strip()}

    return {"business_type": q, "location": ""}


# ═══════════════════════════════════════════════════════════════════════════════
# GOOGLE PLACES API (Text Search)
# ═══════════════════════════════════════════════════════════════════════════════

PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"

# Fields we request — controls billing (Basic fields are cheapest)
PLACES_FIELD_MASK = ",".join([
    "places.displayName",
    "places.formattedAddress",
    "places.rating",
    "places.userRatingCount",
    "places.nationalPhoneNumber",
    "places.internationalPhoneNumber",
    "places.websiteUri",
    "places.googleMapsUri",
    "places.primaryType",
    "places.primaryTypeDisplayName",
    "places.shortFormattedAddress",
])


async def _search_google_places(business_type: str, location: str) -> List[Dict]:
    """Fetch businesses using Google Places API v1 (Text Search)."""
    api_key = os.getenv("GOOGLE_PLACES_API_KEY", "")
    if not api_key or not HAS_HTTPX:
        return []

    query_str = f"{business_type} in {location}" if location else business_type

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": PLACES_FIELD_MASK,
    }

    body = {
        "textQuery": query_str,
        "maxResultCount": 20,
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(PLACES_TEXT_SEARCH_URL, json=body, headers=headers)
            if resp.status_code != 200:
                print(f"[LeadEngine] Google Places API error: {resp.status_code} — {resp.text[:200]}")
                return []
            data = resp.json()
    except Exception as e:
        print(f"[LeadEngine] Google Places API request failed: {e}")
        return []

    results = []
    seen = set()
    for place in data.get("places", []):
        name = place.get("displayName", {}).get("text", "")
        address = place.get("formattedAddress", "")
        dedup_key = hashlib.md5(f"{name}{address}".lower().encode()).hexdigest()
        if dedup_key in seen:
            continue
        seen.add(dedup_key)

        # Extract category from primaryTypeDisplayName or primaryType
        category = (
            place.get("primaryTypeDisplayName", {}).get("text")
            or place.get("primaryType", "")
            or business_type.title()
        )

        results.append({
            "business_name": name,
            "category": category,
            "city": location.title() if location else "",
            "phone_number": place.get("nationalPhoneNumber", "") or place.get("internationalPhoneNumber", ""),
            "website": place.get("websiteUri", ""),
            "instagram": "",   # Google Places doesn't return social handles
            "google_rating": place.get("rating", 0),
            "address": place.get("shortFormattedAddress", "") or address,
        })

    print(f"[LeadEngine] Google Places returned {len(results)} results for '{query_str}'")
    return results


def _search_mock(business_type: str, location: str) -> List[Dict]:
    """Dynamically generate realistic mock leads for any business type + city."""
    return _generate_mock_leads(business_type, location)


# ═══════════════════════════════════════════════════════════════════════════════
# AI ENRICHMENT
# ═══════════════════════════════════════════════════════════════════════════════

ENRICHMENT_PROMPT = """You are a sales intelligence AI. Analyze this business and return JSON with exactly these fields:

- ai_summary (string, 2 sentences max): A concise business analysis
- likely_pain_point (string, 1-2 sentences): Their most probable operational pain point
- outreach_angle (string, 1-2 sentences): The best sales angle to approach them
- lead_score (integer 1-100): Quality score based on online presence, rating, and reachability
- opportunity_summary (string, 1-2 sentences): Why this business is a good fit for the user's service
- service_fit_reason (string, 1 sentence): Specific reason the user's service matches this lead's needs

Business data:
Name: {business_name}
Category: {category}
City: {city}
Rating: {google_rating}/5
Website: {website}
Instagram: {instagram}
Phone: {phone_number}

User's Service Offer: {user_offer}

Context: The user sells "{user_offer}" services. Tailor your analysis to explain why this lead would benefit from that specific service. If no offer is specified, give a general business analysis.

Return ONLY valid JSON, no markdown or explanation."""


async def enrich_lead_ai(lead: Dict, user_offer: str = "") -> Dict:
    """Enrich a single lead with AI analysis via Groq."""
    api_key = os.getenv("HEXAGON_RESEARCH_API_KEY") or os.getenv("OPENAI_API_KEY", "")

    if not api_key or not HAS_OPENAI:
        return _mock_enrich(lead, user_offer)

    try:
        # Detect Groq key (starts with gsk_)
        if api_key.startswith("gsk_"):
            base_url = "https://api.groq.com/openai/v1"
            model = "llama-3.1-8b-instant"
        else:
            base_url = "https://api.openai.com/v1"
            model = "gpt-3.5-turbo"

        client = OpenAI(api_key=api_key, base_url=base_url)

        prompt_data = {**lead, "user_offer": user_offer or "general business services"}
        prompt = ENRICHMENT_PROMPT.format(**prompt_data)
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=400,
        )
        content = response.choices[0].message.content.strip()

        # Parse JSON from response (handle possible markdown wrapping)
        if "```" in content:
            content = content.split("```")[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()

        enrichment = json.loads(content)
        lead["ai_summary"] = enrichment.get("ai_summary", "")
        lead["likely_pain_point"] = enrichment.get("likely_pain_point", "")
        lead["outreach_angle"] = enrichment.get("outreach_angle", "")
        lead["lead_score"] = max(1, min(100, int(enrichment.get("lead_score", 50))))
        lead["opportunity_summary"] = enrichment.get("opportunity_summary", "")
        lead["service_fit_reason"] = enrichment.get("service_fit_reason", "")
        print(f"[LeadEngine] AI enriched '{lead.get('business_name')}' (score: {lead['lead_score']})")
        return lead

    except Exception as e:
        print(f"[LeadEngine] AI enrichment error: {e}")
        return _mock_enrich(lead, user_offer)


def _mock_enrich(lead: Dict, user_offer: str = "") -> Dict:
    """Generate deterministic mock enrichment based on lead data and user offer."""
    name = lead.get("business_name", "")
    rating = lead.get("google_rating", 0)
    has_website = bool(lead.get("website", ""))
    has_ig = bool(lead.get("instagram", ""))
    category = lead.get("category", "Business")
    offer = user_offer.strip() if user_offer else "business services"

    # Deterministic score
    score = 40
    if rating >= 4.5:
        score += 25
    elif rating >= 4.0:
        score += 15
    elif rating >= 3.5:
        score += 8
    if has_website:
        score += 15
    if has_ig:
        score += 10
    score = min(score, 95)

    summaries = {
        "high": f"{name} has strong local reviews and active social presence, but likely relies on manual operations for customer management.",
        "mid": f"{name} shows moderate digital presence with room for growth in online customer acquisition and retention.",
        "low": f"{name} has minimal online infrastructure, suggesting heavy reliance on walk-in traffic and word-of-mouth.",
    }

    pain_points = {
        "high": "Customer data is likely scattered across platforms. No unified follow-up or retention system.",
        "mid": "Inconsistent online ordering or booking flow leading to lost revenue opportunities.",
        "low": "No digital presence for customer acquisition. Manual handling of all inquiries and bookings.",
    }

    angles = {
        "high": "Position around scaling what already works — automate their customer engagement to free up time for growth.",
        "mid": f"Focus on how competitors in {category.lower()} are capturing customers online while they're missing out.",
        "low": "Lead with simplicity — show how even basic digital tools can double their reach with zero technical skill.",
    }

    # ── Offer-aware opportunity summary & service fit reason ─────────────────
    if not has_website:
        opportunity_summaries = {
            "high": f"{name} is digitally active on social media but lacks a website — {offer} could unlock their next growth phase.",
            "mid": f"{name} has moderate online activity but no website — {offer} would fill a critical gap.",
            "low": f"{name} has virtually no digital footprint — {offer} represents a foundational opportunity.",
        }
    else:
        opportunity_summaries = {
            "high": f"{name} is a thriving business with strong reviews — {offer} can help them scale operations further.",
            "mid": f"{name} has a decent online setup but gaps remain — {offer} could improve efficiency.",
            "low": f"{name} has basic digital presence — {offer} could modernize their workflow.",
        }

    if not has_website and not has_ig:
        service_fit_reason = f"Zero digital presence makes {name} an ideal candidate for {offer} — they need everything."
    elif not has_website:
        service_fit_reason = f"{name} is active on social but has no website — {offer} fits their digital gap perfectly."
    elif not has_ig:
        service_fit_reason = f"{name} has a website but no social media — {offer} can expand their reach."
    else:
        service_fit_reason = f"{name} has existing digital infrastructure — {offer} can optimize and scale what they already have."

    tier = "high" if score >= 70 else "mid" if score >= 45 else "low"

    lead["ai_summary"] = summaries[tier]
    lead["likely_pain_point"] = pain_points[tier]
    lead["outreach_angle"] = angles[tier]
    lead["lead_score"] = score
    lead["opportunity_summary"] = opportunity_summaries[tier]
    lead["service_fit_reason"] = service_fit_reason

    print(f"[LeadEngine] Mock enriched '{name}' (score: {score}, tier: {tier})")
    return lead


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═══════════════════════════════════════════════════════════════════════════════

async def search_leads(
    query: str,
    filters: Optional[Dict] = None,
    user_offer: str = "",
    search_mode: str = "high_fit_leads",
) -> List[Dict]:
    """
    Search for business leads from a natural-language query.
    Uses Google Places API when available, falls back to mock data.

    Pipeline:
        1. Parse query → extract business_type + location
        2. Fetch leads (Google Places or mock, pool of 20)
        3. Apply enterprise/franchise filter
        4. Compute opportunity scores for each lead
        5. Enrich with AI (pass user_offer)
        6. Apply search mode sorting/filtering
        7. Apply user filters
        8. Return results
    """
    print(f"[LeadEngine] ── Search started ──────────────────────────────────")
    print(f"[LeadEngine] Query: '{query}' | Offer: '{user_offer}' | Mode: '{search_mode}'")

    # ── Step 1: Parse query ──────────────────────────────────────────────────
    parsed = parse_search_query(query)
    business_type = parsed["business_type"]
    location = parsed["location"]

    # Apply filter overrides for business_type / location
    if filters:
        if filters.get("city"):
            location = filters["city"]
        if filters.get("business_category"):
            business_type = filters["business_category"]

    print(f"[LeadEngine] Parsed → type='{business_type}', location='{location}'")

    # ── Step 2: Fetch leads ──────────────────────────────────────────────────
    results = await _search_google_places(business_type, location)

    # Fallback to mock
    if not results:
        print("[LeadEngine] Google Places returned nothing — using mock data")
        results = _search_mock(business_type, location)

    print(f"[LeadEngine] Raw candidate pool: {len(results)} leads")

    # ── Step 3: Enterprise filter ────────────────────────────────────────────
    results = _filter_enterprises(results)

    # ── Step 4: Compute opportunity scores ───────────────────────────────────
    print(f"[LeadEngine] Computing opportunity scores (offer: '{user_offer}')...")
    for lead in results:
        _compute_opportunity_score(lead, user_offer)

    # ── Step 5: AI enrichment ────────────────────────────────────────────────
    print(f"[LeadEngine] Enriching {len(results)} leads with AI...")
    enriched = []
    for lead in results:
        enriched_lead = await enrich_lead_ai(lead, user_offer)
        enriched.append(enriched_lead)

    # ── Step 6: Apply search mode ────────────────────────────────────────────
    enriched = _apply_search_mode(enriched, search_mode)

    # ── Step 7: Apply user filters ───────────────────────────────────────────
    if filters:
        min_rating = filters.get("rating")
        if min_rating:
            enriched = [r for r in enriched if (r.get("google_rating", 0) or 0) >= float(min_rating)]
        if filters.get("website_presence"):
            enriched = [r for r in enriched if r.get("website")]
        if filters.get("instagram_presence"):
            enriched = [r for r in enriched if r.get("instagram")]

    print(f"[LeadEngine] ── Search complete: returning {len(enriched)} leads ──")
    return enriched
