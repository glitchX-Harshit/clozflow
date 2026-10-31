import json
from typing import Any, Optional

def format_capsule_context(capsule: Any, db: Optional[Any] = None) -> str:
    """
    Formats a Capsule (both legacy and newly ingested knowledge capsules)
    into a structured, high-context prompt block for Pearl runtime.
    
    1. Shared Business Context: Automatically merges approved Company Capsule
       (brand tone, company positioning, shared policies) if present.
    2. Selected Product Capsule: Injects product specs, pricing, target buyer profile,
       and sales objection battlecards.
    3. Fully backward-compatible with legacy manual capsules.
    """
    if not capsule:
        return "No specific product context provided."
    
    overall_parts = []
    
    # ── 1. Shared Company Context ─────────────────────────────────────────────
    user_id = getattr(capsule, "user_id", None)
    capsule_type = getattr(capsule, "capsule_type", "product")
    
    company_capsule = None
    if user_id and capsule_type != "company":
        own_db = False
        active_db = db
        if active_db is None:
            try:
                from database import SessionLocal
                active_db = SessionLocal()
                own_db = True
            except Exception:
                active_db = None
                
        if active_db is not None:
            try:
                from models import Capsule
                company_capsule = active_db.query(Capsule).filter(
                    Capsule.user_id == user_id,
                    Capsule.capsule_type == "company"
                ).first()
            except Exception:
                pass
            finally:
                if own_db and active_db:
                    active_db.close()

    if company_capsule:
        c_parts = ["[SHARED COMPANY CONTEXT]"]
        c_name = company_capsule.company_name or company_capsule.product_name or company_capsule.name
        if c_name:
            c_parts.append(f"Company: {c_name}")
        if company_capsule.brand_tone:
            c_parts.append(f"Brand Tone: {company_capsule.brand_tone}")
        if company_capsule.product_specification:
            c_parts.append(f"Company Overview: {company_capsule.product_specification}")
        if company_capsule.key_differentiators:
            c_parts.append(f"Core Value Propositions: {company_capsule.key_differentiators}")
        overall_parts.append("\n".join(c_parts))

    # ── 2. Product Capsule Context ───────────────────────────────────────────
    parts = ["[PRODUCT KNOWLEDGE CAPSULE]"]
    
    company = getattr(capsule, "company_name", None)
    if company and not company_capsule:
        parts.append(f"Company: {company}")
        
    tone = getattr(capsule, "brand_tone", None)
    if tone and not company_capsule:
        parts.append(f"Brand Tone & Style: {tone}")
    
    product_title = getattr(capsule, "product_name", None) or getattr(capsule, "name", "Product")
    parts.append(f"Product Name: {product_title}")
    
    price = getattr(capsule, "product_price", None)
    if price:
        parts.append(f"Price / Commercials: {price}")
    
    specs = getattr(capsule, "product_specification", None)
    if specs:
        parts.append(f"Specifications & Capabilities:\n{specs}")
        
    audience = getattr(capsule, "target_audience", None)
    if audience:
        parts.append(f"Target Audience:\n{audience}")
        
    differentiators = getattr(capsule, "key_differentiators", None)
    if differentiators:
        parts.append(f"Key Differentiators vs Competitors:\n{differentiators}")
        
    pain_points = getattr(capsule, "pain_points_solved", None)
    if pain_points:
        parts.append(f"Customer Pain Points Solved:\n{pain_points}")
        
    additional = getattr(capsule, "additional_context", None)
    if additional:
        parts.append(f"Sales Intelligence & Objections:\n{additional}")
        
    # Process structured intelligence_data if present
    intel = getattr(capsule, "intelligence_data", None)
    if intel:
        if isinstance(intel, str):
            try:
                intel = json.loads(intel)
            except Exception:
                intel = None
                
        if isinstance(intel, dict):
            # Business Intelligence
            b_intel = intel.get("business_intel", {})
            if b_intel:
                b_lines = []
                if b_intel.get("company_name"):
                    b_lines.append(f"Company: {b_intel['company_name']}")
                if b_intel.get("brand_tone"):
                    b_lines.append(f"Brand Tone: {b_intel['brand_tone']}")
                if b_intel.get("unique_selling_propositions"):
                    usps = b_intel["unique_selling_propositions"]
                    b_lines.append(f"Unique Selling Propositions: {', '.join(usps) if isinstance(usps, list) else usps}")
                if b_lines:
                    parts.append("Business Intelligence:\n" + "\n".join(b_lines))

            # Product Intelligence
            p_intel = intel.get("product_intel", {})
            if p_intel:
                p_lines = []
                if p_intel.get("features"):
                    feats = p_intel["features"]
                    p_lines.append(f"Key Features: {', '.join(feats) if isinstance(feats, list) else feats}")
                if p_intel.get("pricing") and not price:
                    p_lines.append(f"Pricing: {json.dumps(p_intel['pricing'])}")
                if p_lines:
                    parts.append("Product Intelligence:\n" + "\n".join(p_lines))

            # Customer Intelligence
            c_intel = intel.get("customer_intel", {})
            if c_intel:
                c_lines = []
                if c_intel.get("target_segments"):
                    segs = c_intel["target_segments"]
                    c_lines.append(f"Target Segments: {', '.join(segs) if isinstance(segs, list) else segs}")
                if c_intel.get("buyer_roles"):
                    roles = c_intel["buyer_roles"]
                    c_lines.append(f"Key Decision Makers: {', '.join(roles) if isinstance(roles, list) else roles}")
                if c_intel.get("objections"):
                    objs = c_intel["objections"]
                    c_lines.append(f"Anticipated Buyer Objections: {', '.join(objs) if isinstance(objs, list) else objs}")
                if c_lines:
                    parts.append("Customer Intelligence:\n" + "\n".join(c_lines))

            # Sales Battlecards
            s_intel = intel.get("sales_intel", {})
            if s_intel:
                s_lines = []
                if s_intel.get("objection_handling"):
                    oh = s_intel["objection_handling"]
                    if isinstance(oh, list):
                        for item in oh:
                            if isinstance(item, dict):
                                obj = item.get("objection", "")
                                resp = item.get("response", "")
                                s_lines.append(f"- When prospect raises '{obj}': Respond with '{resp}'")
                    elif isinstance(oh, str):
                        s_lines.append(oh)
                if s_lines:
                    parts.append("Sales Objection Battlecards:\n" + "\n".join(s_lines))

    overall_parts.append("\n\n".join(parts))
    return "\n\n".join(overall_parts)
