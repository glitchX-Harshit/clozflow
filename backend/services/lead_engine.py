"""
Lead Discovery & Opportunity Scoring Engine
────────────────────────────────────────────
• search_leads(query)             → Google Places API (Text Search)
• enrich_lead_ai(lead, offer)     → AI analysis via Groq (OpenAI-compatible)
• _compute_opportunity_score()    → Rule-based opportunity scoring (no API)
• _filter_enterprises()           → Remove large enterprises / franchises
• Sample (fabricated) leads ONLY when no Places API key is configured; every
  such lead carries ``is_sample: True``. When a key IS configured, provider
  failures raise ``PlacesProviderError`` instead of silently returning fakes.
"""

import os
import re
import json
import time
import hashlib
import asyncio
from datetime import datetime
from typing import List, Dict, Optional, AsyncGenerator

# ── Optional imports ─────────────────────────────────────────────────────────
try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False

try:
    from openai import AsyncOpenAI
    try:
        from openai import BadRequestError as _OpenAIBadRequest
    except ImportError:  # pragma: no cover - very old SDKs
        _OpenAIBadRequest = None
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False
    _OpenAIBadRequest = None


# Bounded parallelism for AI enrichment (each lead = one LLM call).
LEAD_ENRICH_CONCURRENCY = max(1, int(os.getenv("LEAD_ENRICH_CONCURRENCY", "3") or 3))
LEAD_ENRICH_TIMEOUT_SECONDS = float(os.getenv("LEAD_ENRICH_TIMEOUT_SECONDS", "30") or 30)

# Deep search spends one paid Places call per area: cap areas and wall time.
DEEP_SEARCH_MAX_AREAS = max(1, int(os.getenv("DEEP_SEARCH_MAX_AREAS", "40") or 40))
DEEP_SEARCH_TIME_BUDGET_SECONDS = float(os.getenv("DEEP_SEARCH_TIME_BUDGET_SECONDS", "300") or 300)
DEEP_SEARCH_MAX_CONSECUTIVE_PROVIDER_ERRORS = 3


class PlacesProviderError(Exception):
    """The Google Places API is configured but the call failed."""

    def __init__(self, message: str, *, quota: bool = False, status_code: Optional[int] = None):
        super().__init__(message)
        self.quota = quota
        self.status_code = status_code

    @property
    def code(self) -> str:
        return "provider_quota" if self.quota else "provider_error"

    @property
    def public_detail(self) -> str:
        if self.quota:
            return "Lead search quota is exhausted right now. Please try again later."
        return "The lead search provider failed to respond. Please try again."


def places_api_configured() -> bool:
    """True when real Google Places lookups are possible (otherwise: sample data)."""
    return HAS_HTTPX and bool(os.getenv("GOOGLE_PLACES_API_KEY", "").strip())


def _as_float(value) -> Optional[float]:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _sse(event: str, payload: Dict) -> str:
    """One complete server-sent event frame."""
    return f"event: {event}\ndata: {json.dumps(payload, default=str)}\n\n"


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


def get_country_code_for_location(location: str) -> str:
    loc = location.lower().strip()
    
    # 1. Spain
    if any(k in loc for k in ["spain", "madrid", "barcelona", "valencia", "seville", "zaragoza", "malaga"]):
        return "+34"
    # 2. USA
    if any(k in loc for k in ["usa", "united states", "new york", "los angeles", "chicago", "houston", "miami", "san francisco", "boston", "seattle"]):
        return "+1"
    # 3. UK
    if any(k in loc for k in ["uk", "united kingdom", "london", "manchester", "birmingham", "leeds", "glasgow", "liverpool"]):
        return "+44"
    # 4. Germany
    if any(k in loc for k in ["germany", "berlin", "munich", "frankfurt", "hamburg", "cologne"]):
        return "+49"
    # 5. France
    if any(k in loc for k in ["france", "paris", "marseille", "lyon", "toulouse", "nice"]):
        return "+33"
    # 6. Italy
    if any(k in loc for k in ["italy", "rome", "milan", "naples", "turin", "palermo"]):
        return "+39"
    # 7. Canada
    if any(k in loc for k in ["canada", "toronto", "vancouver", "montreal", "ottawa", "calgary"]):
        return "+1"
    # 8. Australia
    if any(k in loc for k in ["australia", "sydney", "melbourne", "brisbane", "perth", "adelaide"]):
        return "+61"
    # 9. UAE
    if any(k in loc for k in ["uae", "dubai", "abu dhabi", "sharjah"]):
        return "+971"
    # 10. Singapore
    if any(k in loc for k in ["singapore"]):
        return "+65"
    # 11. Japan
    if any(k in loc for k in ["japan", "tokyo", "osaka", "kyoto", "yokohama"]):
        return "+81"
    # 12. Brazil
    if any(k in loc for k in ["brazil", "sao paulo", "rio de janeiro", "brasilia"]):
        return "+55"
    # 13. Mexico
    if any(k in loc for k in ["mexico", "mexico city", "guadalajara", "monterrey"]):
        return "+52"
    # 14. India
    if any(k in loc for k in ["india", "delhi", "mumbai", "bangalore", "hyderabad", "pune", "chennai", "kolkata", "jaipur", "ahmedabad", "lucknow"]):
        return "+91"
        
    common_countries = {
        "netherlands": "+31", "belgium": "+32", "switzerland": "+41", "austria": "+43",
        "sweden": "+46", "norway": "+47", "denmark": "+45", "finland": "+358",
        "portugal": "+351", "greece": "+30", "russia": "+7", "china": "+86",
        "south korea": "+82", "new zealand": "+64", "south africa": "+27",
        "turkey": "+90", "saudi arabia": "+966", "malaysia": "+60", "thailand": "+66",
        "vietnam": "+84", "indonesia": "+62", "philippines": "+63", "ireland": "+353"
    }
    for c, code in common_countries.items():
        if c in loc:
            return code
            
    return "+91"


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
        country_code = get_country_code_for_location(location)
        if country_code == "+34":
            phone_rest = "".join([str(rng.randint(0, 9)) for _ in range(7)])
            phone_prefix = rng.choice(["6", "7", "9"])
            phone = f"+34 {phone_prefix}{phone_rest[:4]} {phone_rest[4:]}"
        elif country_code in ["+1", "+44", "+49", "+33", "+39", "+61"]:
            phone_rest = "".join([str(rng.randint(0, 9)) for _ in range(8)])
            phone_prefix = rng.choice(["6", "7", "8", "9"])
            phone = f"{country_code} {phone_prefix}{phone_rest[:3]} {phone_rest[3:]}"
        else:
            phone_prefix = rng.choice(["98", "99", "88", "87", "91", "70", "80"])
            phone_rest = "".join([str(rng.randint(0, 9)) for _ in range(8)])
            phone = f"{country_code} {phone_prefix}{phone_rest[:3]} {phone_rest[3:]}"

        # Generate website slug
        slug = name.lower().replace(" ", "").replace("&", "and")[:18]
        website = f"https://{slug}.{'in' if rng.random() > 0.5 else 'com'}" if has_website else ""

        # Generate instagram handle
        ig_slug = name.lower().replace(" ", "_").replace("&", "")[:20]
        ig_city_tag = city.lower()[:3]
        instagram = f"@{ig_slug}.{ig_city_tag}" if has_ig else ""

        # Generate reviews count
        reviews_count = rng.randint(5, 450)

        leads.append({
            "business_name": name,
            "category": bt_title,
            "city": city,
            "phone_number": phone,
            "website": website,
            "instagram": instagram,
            "google_rating": rating,
            "reviews_count": reviews_count,
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


def _localized_text(value) -> str:
    """Places v1 returns LocalizedText objects ({"text": ...}); tolerate anything else."""
    if isinstance(value, dict):
        text = value.get("text")
        return text if isinstance(text, str) else ""
    return value if isinstance(value, str) else ""


async def _search_google_places(business_type: str, location: str) -> List[Dict]:
    """Fetch businesses using Google Places API v1 (Text Search).

    Returns [] when no API key is configured (callers then use sample data).
    Raises PlacesProviderError when the configured API fails (quota, auth,
    timeout, bad response) so callers never substitute fabricated businesses
    for real results. A successful call with zero matches returns [].
    """
    api_key = os.getenv("GOOGLE_PLACES_API_KEY", "").strip()
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
    except httpx.HTTPError as e:
        print(f"[LeadEngine] Google Places API request failed: {type(e).__name__}")
        raise PlacesProviderError("Google Places request failed") from e

    if resp.status_code != 200:
        quota = resp.status_code == 429 or "RESOURCE_EXHAUSTED" in resp.text[:4000]
        print(f"[LeadEngine] Google Places API error: HTTP {resp.status_code}")
        raise PlacesProviderError(
            f"Google Places returned HTTP {resp.status_code}", quota=quota, status_code=resp.status_code
        )
    try:
        data = resp.json()
    except ValueError as e:
        raise PlacesProviderError("Google Places returned an invalid response") from e

    places = data.get("places") if isinstance(data, dict) else None
    if not isinstance(places, list):
        places = []

    results = []
    seen = set()
    for place in places:
        if not isinstance(place, dict):
            continue
        name = _localized_text(place.get("displayName"))
        address = place.get("formattedAddress", "") or ""
        dedup_key = hashlib.md5(f"{name}{address}".lower().encode()).hexdigest()
        if dedup_key in seen:
            continue
        seen.add(dedup_key)

        # Extract category from primaryTypeDisplayName or primaryType
        category = (
            _localized_text(place.get("primaryTypeDisplayName"))
            or place.get("primaryType", "")
            or business_type.title()
        )

        results.append({
            "business_name": name,
            "category": category,
            "city": location.title() if location else "",
            # Prefer international phone number because it contains the country code 
            # and avoids local trunk prefixes (like leading 0s) which break WhatsApp.
            "phone_number": place.get("internationalPhoneNumber", "") or place.get("nationalPhoneNumber", ""),
            "website": place.get("websiteUri", ""),
            "instagram": "",   # Google Places doesn't return social handles
            "google_rating": place.get("rating", 0) or 0,
            "reviews_count": place.get("userRatingCount", 0) or 0,
            "address": place.get("shortFormattedAddress", "") or address,
            "is_sample": False,
        })

    print(f"[LeadEngine] Google Places returned {len(results)} results for '{query_str}'")
    return results


def _search_mock(business_type: str, location: str) -> List[Dict]:
    """Generate SAMPLE leads (fabricated, flagged ``is_sample``) for any business type + city.

    Only used when no Google Places API key is configured.
    """
    leads = _generate_mock_leads(business_type, location)
    for lead in leads:
        lead["is_sample"] = True
    return leads


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


def _parse_json_safely(raw_text: str) -> Optional[Dict]:
    """Parse JSON safely with markdown stripping, bracket matching, string repair, and regex fallback."""
    if not raw_text or not raw_text.strip():
        return None
    text = raw_text.strip()

    # 1. Strip markdown code fences if present
    if "```" in text:
        match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
        if match:
            text = match.group(1).strip()
        else:
            parts = text.split("```")
            if len(parts) > 1:
                text = parts[1]
                if text.startswith("json"):
                    text = text[4:]
                text = text.strip()

    # 2. Extract outermost JSON block { ... }
    json_match = re.search(r"\{[\s\S]*\}", text)
    if json_match:
        text = json_match.group(0)

    # 3. Direct parse
    try:
        return json.loads(text)
    except Exception:
        pass

    # 4. Clean unescaped control characters / newlines inside strings
    try:
        cleaned = re.sub(r"[\r\n]+", " ", text)
        return json.loads(cleaned)
    except Exception:
        pass

    # 5. Try auto-repairing truncated strings (common if token limit reached)
    repaired = text.strip()
    if repaired.count('"') % 2 != 0:
        repaired += '"'
    if not repaired.endswith("}"):
        repaired += "}"
    try:
        return json.loads(repaired)
    except Exception:
        pass

    # 6. Regex fallback: extract key-value pairs individually
    extracted = {}
    for key in ["ai_summary", "likely_pain_point", "outreach_angle", "opportunity_summary", "service_fit_reason"]:
        m = re.search(rf'"{key}"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)', text)
        if m:
            extracted[key] = m.group(1).replace('\\"', '"')

    score_m = re.search(r'"lead_score"\s*:\s*(\d+)', text)
    if score_m:
        extracted["lead_score"] = int(score_m.group(1))

    return extracted if extracted else None


class _PromptFields(dict):
    """format_map() source that renders missing lead fields as empty strings."""

    def __missing__(self, key):
        return ""


def _research_llm_config() -> Optional[tuple]:
    """(api_key, base_url, model) for HEXAGON_RESEARCH_API_KEY, or None."""
    api_key = os.getenv("HEXAGON_RESEARCH_API_KEY", "").strip()
    if not api_key or not HAS_OPENAI:
        return None
    # Detect Gemini key (starts with AIza or AQ) or Groq key (starts with gsk_)
    if api_key.startswith("AIza") or api_key.startswith("AQ"):
        return api_key, "https://generativelanguage.googleapis.com/v1beta/openai/", "gemini-3.5-flash"
    if api_key.startswith("gsk_"):
        return api_key, "https://api.groq.com/openai/v1", "openai/gpt-oss-120b"
    return api_key, "https://api.openai.com/v1", "gpt-3.5-turbo"


def _bounded_int(value, default: int = 50) -> int:
    try:
        return max(1, min(100, int(float(value))))
    except (TypeError, ValueError):
        return default


async def enrich_lead_ai(lead: Dict, user_offer: str = "") -> Dict:
    """Enrich a single lead with AI analysis via Groq / Gemini / OpenAI.

    Uses the async client so the event loop is never blocked and a cancelled
    request (e.g. a closed deep-search stream) cancels the in-flight call.
    Falls back to rule-based text (``ai_enriched: False``) on any failure.
    """
    config = _research_llm_config()
    if not config:
        return _mock_enrich(lead, user_offer)
    api_key, base_url, model = config

    try:
        prompt_data = _PromptFields({**lead, "user_offer": user_offer or "general business services"})
        prompt = ENRICHMENT_PROMPT.format_map(prompt_data)

        kwargs = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7,
            "max_tokens": 1500,
        }

        async with AsyncOpenAI(
            api_key=api_key, base_url=base_url, timeout=LEAD_ENRICH_TIMEOUT_SECONDS, max_retries=1
        ) as client:
            # Try with JSON object mode first; fall back to standard only if the
            # provider rejects the parameter (not on rate limits / timeouts).
            try:
                response = await client.chat.completions.create(
                    **kwargs,
                    response_format={"type": "json_object"}
                )
            except Exception as exc:
                if _OpenAIBadRequest is None or not isinstance(exc, _OpenAIBadRequest):
                    raise
                response = await client.chat.completions.create(**kwargs)

        content = (response.choices[0].message.content or "").strip()

        enrichment = _parse_json_safely(content)
        if not enrichment:
            print("[LeadEngine] AI enrichment parse failed; using rule-based enrichment")
            return _mock_enrich(lead, user_offer)

        lead["ai_summary"] = str(enrichment.get("ai_summary", "") or "")
        lead["likely_pain_point"] = str(enrichment.get("likely_pain_point", "") or "")
        lead["outreach_angle"] = str(enrichment.get("outreach_angle", "") or "")
        lead["lead_score"] = _bounded_int(enrichment.get("lead_score", 50))
        lead["opportunity_summary"] = str(enrichment.get("opportunity_summary", "") or "")
        lead["service_fit_reason"] = str(enrichment.get("service_fit_reason", "") or "")
        lead["ai_enriched"] = True
        print(f"[LeadEngine] AI enriched '{lead.get('business_name')}' (score: {lead['lead_score']})")
        return lead

    except Exception as e:
        print(f"[LeadEngine] AI enrichment error: {type(e).__name__}")
        return _mock_enrich(lead, user_offer)


async def _enrich_all(leads: List[Dict], user_offer: str) -> List[Dict]:
    """Enrich leads concurrently (bounded), preserving order."""
    if not leads:
        return []
    semaphore = asyncio.Semaphore(LEAD_ENRICH_CONCURRENCY)

    async def _one(lead: Dict) -> Dict:
        async with semaphore:
            return await enrich_lead_ai(lead, user_offer)

    return list(await asyncio.gather(*(_one(lead) for lead in leads)))


def _mock_enrich(lead: Dict, user_offer: str = "") -> Dict:
    """Generate deterministic mock enrichment based on lead data and user offer."""
    name = lead.get("business_name", "")
    rating = _as_float(lead.get("google_rating")) or 0
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
    lead["ai_enriched"] = False  # rule-based text, not an AI analysis

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

    Uses Google Places when GOOGLE_PLACES_API_KEY is set. Without a key it
    returns SAMPLE leads, each flagged ``is_sample: True``. With a key, a
    provider failure raises PlacesProviderError (never fabricated leads) and a
    query with no matches returns [].

    Pipeline:
        1. Parse query → extract business_type + location
        2. Fetch leads (Google Places, or sample data without a key; pool of 20)
        3. Apply enterprise/franchise filter
        4. Compute opportunity scores for each lead (rule-based, free)
        5. Apply search mode sorting/filtering
        6. Apply user filters
        7. Enrich ONLY the surviving leads with AI (one paid call per lead)
        8. Return results
    """
    print(f"[LeadEngine] ── Search started ──────────────────────────────────")
    print(f"[LeadEngine] Mode: '{search_mode}'")

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
    sample_mode = not places_api_configured()
    if sample_mode:
        print("[LeadEngine] No GOOGLE_PLACES_API_KEY — returning SAMPLE leads (is_sample=True)")
        results = _search_mock(business_type, location)
    else:
        results = await _search_google_places(business_type, location)  # may raise PlacesProviderError

    print(f"[LeadEngine] Raw candidate pool: {len(results)} leads")

    # ── Step 3: Enterprise filter ────────────────────────────────────────────
    results = _filter_enterprises(results)

    # ── Step 4: Compute opportunity scores ───────────────────────────────────
    for lead in results:
        _compute_opportunity_score(lead, user_offer)

    # ── Steps 5-6: Search mode + user filters (before paying for enrichment) ─
    results = _apply_search_mode(results, search_mode)
    results = _apply_user_filters(results, filters, user_offer)

    # ── Step 7: AI enrichment ────────────────────────────────────────────────
    print(f"[LeadEngine] Enriching {len(results)} leads with AI...")
    enriched = await _enrich_all(results, user_offer)
    for lead in enriched:
        lead["is_sample"] = bool(lead.get("is_sample", sample_mode))

    print(f"[LeadEngine] ── Search complete: returning {len(enriched)} leads ──")
    return enriched


def _apply_user_filters(leads: List[Dict], filters: Optional[Dict], user_offer: str) -> List[Dict]:
    """User filters + strict website filters derived from the offer text."""
    if filters:
        min_rating = _as_float(filters.get("rating"))
        if min_rating:
            leads = [r for r in leads if (_as_float(r.get("google_rating")) or 0) >= min_rating]
        if filters.get("website_presence"):
            leads = [r for r in leads if r.get("website")]
        if filters.get("instagram_presence"):
            leads = [r for r in leads if r.get("instagram")]

    # Apply STRICT filters based on user_offer text
    offer_lower = user_offer.lower() if user_offer else ""
    if "no website" in offer_lower or "without website" in offer_lower:
        print("[LeadEngine] STRICT FILTER: Dropping leads that already have a website.")
        leads = [r for r in leads if not r.get("website")]
    elif "must have website" in offer_lower or "with website" in offer_lower:
        print("[LeadEngine] STRICT FILTER: Keeping only leads that have a website.")
        leads = [r for r in leads if r.get("website")]
    return leads


# ═══════════════════════════════════════════════════════════════════════════════
# DYNAMIC SUB-AREA EXTRACTION FROM GOOGLE PLACES RESULTS
# ═══════════════════════════════════════════════════════════════════════════════

# Common geographic terms / noise to exclude when extracting sub-areas
_NOISE_TERMS = {
    # Countries
    "india", "usa", "united states", "uk", "united kingdom", "uae",
    "united arab emirates", "singapore", "canada", "australia", "germany",
    "france", "japan", "china", "brazil", "south africa", "indonesia",
    "thailand", "malaysia", "philippines", "vietnam", "south korea",
    "saudi arabia", "qatar", "oman", "bahrain", "kuwait", "egypt",
    "turkey", "russia", "mexico", "italy", "spain", "netherlands",
    "pakistan", "bangladesh", "sri lanka", "nepal",
    # Indian states
    "maharashtra", "karnataka", "delhi", "tamil nadu", "telangana",
    "west bengal", "gujarat", "rajasthan", "uttar pradesh", "madhya pradesh",
    "andhra pradesh", "kerala", "punjab", "haryana", "bihar", "odisha",
    "jharkhand", "chhattisgarh", "assam", "goa", "uttarakhand",
    "himachal pradesh", "jammu and kashmir", "new delhi",
    # US states
    "new york", "california", "texas", "florida", "illinois", "pennsylvania",
    "ohio", "georgia", "north carolina", "michigan", "new jersey", "virginia",
    "washington", "arizona", "massachusetts", "tennessee", "indiana",
    "missouri", "maryland", "wisconsin", "colorado", "minnesota",
    # UK regions
    "england", "scotland", "wales", "northern ireland", "greater london",
    # Generic
    "road", "street", "lane", "marg", "path", "nagar", "sector",
}


def _extract_sub_areas_from_results(results: list, city: str, already_seen: set) -> List[str]:
    """
    Dynamically extract unique sub-area/locality names from Google Places 
    result addresses. This works for ANY city globally.
    
    E.g. from "Shop 5, Lokhandwala Complex, Andheri West, Mumbai 400053, India"
    → extracts: "Lokhandwala Complex"
    """
    areas = []
    city_lower = city.lower().strip()
    city_words = set(city_lower.split())

    for result in results:
        address = result.get("address", "") or ""
        if not address:
            continue

        parts = [p.strip() for p in address.split(",")]

        for part in parts:
            clean = part.strip()
            part_lower = clean.lower().strip()

            # Skip empty, too short, or too long
            if len(clean) < 3 or len(clean) > 60:
                continue

            # Skip if contains digits (postal codes, shop numbers)
            if any(c.isdigit() for c in clean):
                continue

            # Skip if it's the city name itself
            if part_lower == city_lower or city_lower in part_lower or part_lower in city_lower:
                continue

            # Skip if overlaps with city words significantly
            part_words = set(part_lower.split())
            if part_words & city_words:
                continue

            # Skip noise terms (countries, states, generic words)
            if part_lower in _NOISE_TERMS:
                continue

            # Skip if already seen
            if part_lower in already_seen:
                continue

            already_seen.add(part_lower)
            areas.append(clean)

    # Cap at 40 discovered sub-areas to avoid excessive API calls
    return areas[:40]


async def deep_search_leads(
    query: str,
    filters: Optional[Dict] = None,
    user_offer: str = "",
    search_mode: str = "high_fit_leads",
    target_count: int = 20,
    max_areas: Optional[int] = None,
    time_budget_seconds: Optional[float] = None,
) -> AsyncGenerator[str, None]:
    """
    Multi-level deep area iteration search with dynamic geographic discovery.
    Works globally for ANY city — no hardcoding required.

    Algorithm (3 levels of depth):
    ─────────────────────────────────────────────────────────────
    LEVEL 1 — NEIGHBORHOODS
      Search known neighborhoods (from database) or dynamically
      discovered ones. For Mumbai: Andheri, Bandra, Borivali...

    LEVEL 2 — MICRO-AREAS (dynamically discovered)
      Extract micro-area names from Level 1 result addresses.
      E.g. from Andheri results → Lokhandwala, Four Bungalows,
      DN Nagar, Oshiwara, etc. Search each one.

    LEVEL 3 — STREETS (dynamically discovered)
      Extract street-level names from Level 2 results.
      E.g. from Lokhandwala results → Lokhandwala Complex Road,
      Back Road, etc.

    At every level:
      - Only collect leads WITHOUT websites
      - Deduplicate across all levels
      - Apply the user's filters BEFORE the (paid) AI enrichment
      - Stop once target_count is reached, after ``max_areas`` paid area
        lookups, or when the wall-clock budget is spent
    ─────────────────────────────────────────────────────────────

    Yields complete SSE frames as soon as each one is ready:
      searching / lead_found / area_done, then exactly one terminal frame:
      ``complete`` ({total_leads, areas_searched, leads, sample, stopped_reason})
      or ``error`` ({detail, code, total_leads, areas_searched, sample}).
    """
    from services.sub_locations import get_sub_locations

    print(f"[DeepSearch] ══════════════════════════════════════════════════")
    print(f"[DeepSearch] Multi-level deep search started")

    # ── Parse query ──────────────────────────────────────────────────────
    parsed = parse_search_query(query)
    business_type = parsed["business_type"]
    location = parsed["location"]

    if filters:
        if filters.get("city"):
            location = filters["city"]
        if filters.get("business_category"):
            business_type = filters["business_category"]

    if not location:
        location = "Delhi"

    print(f"[DeepSearch] Business: '{business_type}' | City: '{location}'")

    sample_mode = not places_api_configured()
    area_cap = max_areas or DEEP_SEARCH_MAX_AREAS
    budget = time_budget_seconds or DEEP_SEARCH_TIME_BUDGET_SECONDS
    started = time.monotonic()
    min_rating = _as_float((filters or {}).get("rating"))
    need_instagram = bool((filters or {}).get("instagram_presence"))

    # ── State tracking ───────────────────────────────────────────────────
    collected: List[Dict] = []
    seen_hashes = set()          # dedup leads by name+address hash
    seen_area_names = set()      # dedup area names across all levels
    counters = {"areas": 0, "consecutive_errors": 0}
    stop = {"reason": None}
    level2_queue = []            # (micro_area, parent_neighborhood)
    level3_queue = []            # (street, parent_micro_area, parent_neighborhood)

    def _should_stop() -> bool:
        if len(collected) >= target_count:
            stop["reason"] = "target_reached"
            return True
        if counters["areas"] >= area_cap:
            stop["reason"] = "area_limit"
            return True
        if time.monotonic() - started >= budget:
            stop["reason"] = "time_limit"
            return True
        return False

    # ── Helper: search one area, yielding frames as they are produced ────
    async def _search_area(area_label, search_query_loc, level, total_est, raw_out: list):
        counters["areas"] += 1
        level_labels = {1: "Neighborhood", 2: "Micro-Area", 3: "Street"}
        level_name = level_labels.get(level, "Area")

        yield _sse("searching", {
            "area": area_label,
            "area_index": counters["areas"],
            "total_areas": total_est,
            "leads_found": len(collected),
            "level": level,
            "level_name": level_name,
            "sample": sample_mode,
        })

        if sample_mode:
            results = _search_mock(business_type, search_query_loc)
        else:
            try:
                results = await _search_google_places(business_type, search_query_loc)
            except PlacesProviderError as exc:
                counters["consecutive_errors"] += 1
                yield _sse("area_done", {
                    "area": area_label, "new_leads": 0, "total_leads": len(collected),
                    "level": level, "error": exc.code,
                })
                if exc.quota or counters["consecutive_errors"] >= DEEP_SEARCH_MAX_CONSECUTIVE_PROVIDER_ERRORS:
                    raise
                return
            counters["consecutive_errors"] = 0

        raw_out.extend(results)
        await asyncio.sleep(0.3)

        # Filter enterprises
        results = _filter_enterprises(results)
        new_count = 0

        for lead in results:
            if len(collected) >= target_count:
                break

            # CORE FILTER: Skip leads that have a website
            if lead.get("website"):
                continue

            name = lead.get("business_name", "")
            addr = lead.get("address", "")
            dedup_key = hashlib.md5(f"{name}{addr}".lower().encode()).hexdigest()

            if dedup_key in seen_hashes:
                continue
            seen_hashes.add(dedup_key)

            # User filters first: never pay for enriching a lead we would drop.
            if min_rating and (_as_float(lead.get("google_rating")) or 0) < min_rating:
                continue
            if need_instagram and not lead.get("instagram"):
                continue

            # Score and enrich
            _compute_opportunity_score(lead, user_offer)
            enriched_lead = await enrich_lead_ai(lead, user_offer)
            enriched_lead["is_sample"] = bool(enriched_lead.get("is_sample", sample_mode))

            collected.append(enriched_lead)
            new_count += 1
            yield _sse("lead_found", enriched_lead)

        yield _sse("area_done", {
            "area": area_label, "new_leads": new_count, "total_leads": len(collected), "level": level,
        })

    try:
        # ═════════════════════════════════════════════════════════════════
        # LEVEL 1 — NEIGHBORHOODS
        # ═════════════════════════════════════════════════════════════════
        level1_areas = get_sub_locations(location)
        for a in level1_areas:
            seen_area_names.add(a.lower().strip())

        total_estimate = min(len(level1_areas), area_cap)
        print(f"[DeepSearch] Level 1: {len(level1_areas)} neighborhoods for '{location}'")

        for area in level1_areas:
            if _should_stop():
                break
            raw_results: list = []
            async for frame in _search_area(area, f"{area}, {location}", 1, total_estimate, raw_results):
                yield frame

            # Extract micro-areas from these results for Level 2
            if raw_results:
                micro_areas = _extract_sub_areas_from_results(raw_results, location, seen_area_names)
                for ma in micro_areas:
                    level2_queue.append((ma, area))

        # ═════════════════════════════════════════════════════════════════
        # LEVEL 2 — MICRO-AREAS (dynamically discovered from Level 1)
        # ═════════════════════════════════════════════════════════════════
        if not _should_stop() and level2_queue:
            total_estimate = min(counters["areas"] + len(level2_queue), area_cap)
            print(f"[DeepSearch] Level 2: {len(level2_queue)} micro-areas discovered")

            for micro_area, parent in level2_queue:
                if _should_stop():
                    break
                raw_results = []
                async for frame in _search_area(
                    f"{micro_area} ({parent})", f"{micro_area}, {parent}, {location}", 2, total_estimate, raw_results
                ):
                    yield frame

                # Extract street-level areas for Level 3
                if raw_results:
                    streets = _extract_sub_areas_from_results(raw_results, location, seen_area_names)
                    for st in streets:
                        level3_queue.append((st, micro_area, parent))

        # ═════════════════════════════════════════════════════════════════
        # LEVEL 3 — STREETS (dynamically discovered from Level 2)
        # ═════════════════════════════════════════════════════════════════
        if not _should_stop() and level3_queue:
            total_estimate = min(counters["areas"] + len(level3_queue), area_cap)
            print(f"[DeepSearch] Level 3: {len(level3_queue)} street-level areas discovered")

            for street, micro_area, parent in level3_queue:
                if _should_stop():
                    break
                async for frame in _search_area(
                    f"{street} ({micro_area}, {parent})", f"{street}, {micro_area}, {parent}, {location}",
                    3, total_estimate, [],
                ):
                    yield frame

    except PlacesProviderError as exc:
        print(f"[DeepSearch] Stopped by provider error ({exc.code}) after {counters['areas']} areas")
        yield _sse("error", {
            "detail": exc.public_detail,
            "code": exc.code,
            "total_leads": len(collected),
            "areas_searched": counters["areas"],
            "sample": sample_mode,
        })
        return

    # ═════════════════════════════════════════════════════════════════════
    # FINAL — Apply search mode and return
    # ═════════════════════════════════════════════════════════════════════
    if stop["reason"] is None:
        stop["reason"] = "target_reached" if len(collected) >= target_count else "areas_exhausted"
    collected = _apply_search_mode(collected, search_mode)

    print(f"[DeepSearch] Complete: {len(collected)} leads from {counters['areas']} areas ({stop['reason']})")

    yield _sse("complete", {
        "total_leads": len(collected),
        "areas_searched": counters["areas"],
        "leads": collected,
        "sample": sample_mode,
        "stopped_reason": stop["reason"],
    })
