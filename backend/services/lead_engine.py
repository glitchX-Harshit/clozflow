"""
Lead Discovery & AI Enrichment Engine
──────────────────────────────────────
• search_leads(query)      → Google Places API (Text Search)
• enrich_lead(lead_data)   → AI analysis via Groq (OpenAI-compatible)
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


def _generate_mock_leads(business_type: str, location: str, count: int = 6) -> List[Dict]:
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
        "maxResultCount": 10,
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

Business data:
Name: {business_name}
Category: {category}
City: {city}
Rating: {google_rating}/5
Website: {website}
Instagram: {instagram}
Phone: {phone_number}

Return ONLY valid JSON, no markdown or explanation."""


async def enrich_lead_ai(lead: Dict) -> Dict:
    """Enrich a single lead with AI analysis via Groq."""
    api_key = os.getenv("OPENAI_API_KEY", "")

    if not api_key or not HAS_OPENAI:
        return _mock_enrich(lead)

    try:
        # Detect Groq key (starts with gsk_)
        if api_key.startswith("gsk_"):
            base_url = "https://api.groq.com/openai/v1"
            model = "llama-3.1-8b-instant"
        else:
            base_url = "https://api.openai.com/v1"
            model = "gpt-3.5-turbo"

        client = OpenAI(api_key=api_key, base_url=base_url)

        prompt = ENRICHMENT_PROMPT.format(**lead)
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=300,
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
        return lead

    except Exception as e:
        print(f"[LeadEngine] AI enrichment error: {e}")
        return _mock_enrich(lead)


def _mock_enrich(lead: Dict) -> Dict:
    """Generate deterministic mock enrichment based on lead data."""
    name = lead.get("business_name", "")
    rating = lead.get("google_rating", 0)
    has_website = bool(lead.get("website", ""))
    has_ig = bool(lead.get("instagram", ""))
    category = lead.get("category", "Business")

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

    tier = "high" if score >= 70 else "mid" if score >= 45 else "low"

    lead["ai_summary"] = summaries[tier]
    lead["likely_pain_point"] = pain_points[tier]
    lead["outreach_angle"] = angles[tier]
    lead["lead_score"] = score
    return lead


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═══════════════════════════════════════════════════════════════════════════════

async def search_leads(query: str, filters: Optional[Dict] = None) -> List[Dict]:
    """
    Search for business leads from a natural-language query.
    Uses Google Places API when available, falls back to mock data.
    """
    parsed = parse_search_query(query)
    business_type = parsed["business_type"]
    location = parsed["location"]

    # Apply filter overrides
    if filters:
        if filters.get("city"):
            location = filters["city"]
        if filters.get("business_category"):
            business_type = filters["business_category"]

    # Try Google Places API first
    results = await _search_google_places(business_type, location)

    # Fallback to mock
    if not results:
        results = _search_mock(business_type, location)

    # Apply filters
    if filters:
        min_rating = filters.get("rating")
        if min_rating:
            results = [r for r in results if (r.get("google_rating", 0) or 0) >= float(min_rating)]
        if filters.get("website_presence"):
            results = [r for r in results if r.get("website")]
        if filters.get("instagram_presence"):
            results = [r for r in results if r.get("instagram")]

    # Enrich all leads with AI
    enriched = []
    for lead in results:
        enriched_lead = await enrich_lead_ai(lead)
        enriched.append(enriched_lead)

    # Sort by lead_score descending
    enriched.sort(key=lambda x: x.get("lead_score", 0), reverse=True)

    return enriched
