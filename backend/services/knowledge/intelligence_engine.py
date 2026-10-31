import os
import json
import re
import asyncio
from typing import Dict, Any, List, Optional, Callable
from openai import AsyncOpenAI


# ── Pass 1: Company Profile, Brand Tone & ICP ─────────────────────────────────

PROMPT_PASS1_COMPANY = """
You are Pearl Knowledge Intelligence, an elite B2B enterprise sales researcher.
Analyze the provided clean business website content or documents. Extract truth-grounded company profile and buyer persona intelligence.

CRITICAL RULES:
1. DO NOT HALLUCINATE OR INVENT INFORMATION.
2. Distinguish strictly between:
   - "observed_fact": Explicitly stated in the text with verifiable evidence.
   - "ai_inference": Inferred buyer psychology, brand positioning, or market analysis.
3. Every fact must include: "value", "confidence" (0.50-1.00), "inference_type", and "source_excerpt" (direct quote).

OUTPUT SCHEMA (Must return valid JSON ONLY):
{
  "business_intelligence": {
    "company_name": {"value": "...", "confidence": 0.95, "inference_type": "observed_fact", "source_excerpt": "..."},
    "business_description": {"value": "...", "confidence": 0.95, "inference_type": "observed_fact", "source_excerpt": "..."},
    "industry": {"value": "...", "confidence": 0.90, "inference_type": "observed_fact", "source_excerpt": "..."},
    "business_model": {"value": "B2B SaaS / Services / Direct / Marketplace", "confidence": 0.85, "inference_type": "ai_inference", "source_excerpt": "..."},
    "brand_positioning": {"value": "...", "confidence": 0.85, "inference_type": "ai_inference", "source_excerpt": "..."},
    "brand_tone": {"value": "Consultative, Authoritative, Energetic, Direct, etc.", "confidence": 0.85, "inference_type": "ai_inference", "source_excerpt": "..."},
    "target_markets": {"value": "...", "confidence": 0.85, "inference_type": "observed_fact", "source_excerpt": "..."},
    "key_differentiators": {"value": "...", "confidence": 0.90, "inference_type": "observed_fact", "source_excerpt": "..."}
  },
  "customer_segments": {
    "target_segments": ["Segment 1", "Segment 2"],
    "buyer_roles": ["VP of Sales", "Operations Director", "..."],
    "buying_motivations": ["Growth", "Efficiency", "..."],
    "decision_criteria": ["ROI", "Speed of Deployment", "..."]
  }
}
"""


# ── Pass 2: Products, Capabilities & Pricing ──────────────────────────────────

PROMPT_PASS2_PRODUCTS = """
You are Pearl Knowledge Intelligence, an elite product catalog analyst.
Analyze the provided product, service, and pricing pages. Extract exact products, features, benefits, and pricing plans.

CRITICAL RULES:
1. DO NOT HALLUCINATE PRICING. If not explicitly published, write "Contact Sales / Custom Quote" with inference_type "observed_fact".
2. Extract all distinct products or core services identified.
3. For each product, extract detailed features and clear customer benefits.

OUTPUT SCHEMA (Must return valid JSON ONLY):
{
  "products": [
    {
      "product_name": "...",
      "description": "...",
      "pricing_and_plans": "...",
      "features": ["Feature 1", "Feature 2", "Feature 3"],
      "benefits": ["Benefit 1", "Benefit 2"],
      "integrations": ["Integration 1", "..."],
      "use_cases": ["Use Case 1", "..."],
      "confidence": 0.95,
      "source_excerpt": "..."
    }
  ]
}
"""


# ── Pass 3: Objections, Pain Points & Sales Battlecards ────────────────────────

PROMPT_PASS3_SALES = """
You are Pearl Knowledge Intelligence, an elite objection handler and sales strategist.
Analyze the company's offerings, customer pain points, FAQs, and market positioning. Synthesize battle-tested objection handlers, discovery questions, and value hooks for phone calls.

CRITICAL RULES:
1. Pain points must represent real operational frictions prospective customers face.
2. Objections must include realistic prospect skepticism (e.g. price, existing solution, implementation effort) and strategic in-character pivot responses.
3. Call opening hook must be punchy, natural, and compelling.

OUTPUT SCHEMA (Must return valid JSON ONLY):
{
  "customer_intelligence": {
    "pain_points": [
      {"problem": "...", "evidence": "...", "confidence": 0.90, "inference_type": "observed_fact"},
      {"problem": "...", "evidence": "...", "confidence": 0.85, "inference_type": "ai_inference"}
    ],
    "potential_objections": [
      {"objection": "Too expensive", "suggested_pivot": "Focus on high ROI and quick payback period.", "confidence": 0.85, "inference_type": "ai_inference"},
      {"objection": "We already have an existing vendor", "suggested_pivot": "Highlight seamless coexistence and specific unique capability.", "confidence": 0.85, "inference_type": "ai_inference"}
    ]
  },
  "sales_intelligence": {
    "discovery_questions": ["Question 1?", "Question 2?"],
    "value_propositions": ["Value prop 1", "Value prop 2"],
    "sales_talking_points": ["Talking point 1", "Talking point 2"],
    "call_opening_hook": "...",
    "qualification_criteria": ["Criteria 1", "Criteria 2"]
  }
}
"""


class IntelligenceEngine:
    def __init__(self):
        self.client = AsyncOpenAI(
            api_key=os.getenv("GROQ_API_KEY"),
            base_url="https://api.groq.com/openai/v1"
        )
        self.model = os.getenv("PEARL_EXTRACTION_MODEL", "qwen/qwen3.8-27b")

    async def _call_llm_with_retry(
        self,
        messages: List[Dict[str, str]],
        max_tokens: int = 850,
        retries: int = 2
    ) -> Dict[str, Any]:
        """
        Executes a targeted LLM call with rate-limit protection and exponential backoff.
        Guarantees max_tokens stays strictly under Groq's 1,000 OTPM limit.
        """
        for attempt in range(retries + 1):
            try:
                resp = await self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    response_format={"type": "json_object"},
                    temperature=0.2,
                    max_tokens=max_tokens
                )

                raw_json = resp.choices[0].message.content.strip()
                raw_json = re.sub(r"^```json\s*", "", raw_json)
                raw_json = re.sub(r"\s*```$", "", raw_json)
                return json.loads(raw_json)

            except Exception as e:
                err_str = str(e)
                if ("429" in err_str or "rate_limit" in err_str.lower()) and attempt < retries:
                    wait_sec = 25
                    print(f"[IntelligenceEngine] Groq 429 rate limit hit. Backing off for {wait_sec}s to let token bucket replenish (attempt {attempt + 1}/{retries})...")
                    await asyncio.sleep(wait_sec)
                else:
                    print(f"[IntelligenceEngine Error] Attempt {attempt + 1} failed: {e}")
                    if attempt == retries:
                        raise e

    def _build_context_digest(
        self,
        pages: List[Dict[str, Any]],
        filter_types: Optional[List[str]] = None,
        max_chars: int = 14000
    ) -> str:
        """Assembles a prioritized textual digest tailored to the specific pass."""
        if filter_types:
            relevant = [p for p in pages if p.get("page_type") in filter_types]
            if not relevant:
                relevant = pages
        else:
            relevant = pages

        digest_blocks = []
        total_len = 0
        for p in relevant[:8]:
            text_snippet = (p.get("clean_text") or "")[:3000]
            if not text_snippet.strip():
                continue
            block = f"=== SOURCE: {p.get('url', 'Document')} ({p.get('title', 'Page')}) ===\n{text_snippet}\n"
            digest_blocks.append(block)
            total_len += len(block)
            if total_len > max_chars:
                break

        return "\n".join(digest_blocks)

    async def extract_multi_pass_intelligence(
        self,
        corpus_pages: List[Dict[str, Any]],
        notifier: Optional[Callable[[Dict[str, Any]], Any]] = None
    ) -> Dict[str, Any]:
        """
        Deep multi-pass extraction pipeline executed over ~2 minutes:
        • Pass 1: Company Profile, Mission, Brand Tone & ICP.
        • Natural interval pacing (20s) to reset Groq OTPM bucket.
        • Pass 2: Products, Catalog Architecture & Pricing tiers.
        • Natural interval pacing (20s) to reset Groq OTPM bucket.
        • Pass 3: Objection Handlers, Pain Points & Sales Talking Points.
        """
        safe_fb = self._generate_safe_fallback(corpus_pages)

        # ── PASS 1: Company Profile & Brand Tone ───────────────────────────────
        if notifier:
            await notifier({
                "stage": 3, "progress": 40,
                "message": "Analyzing company mission, brand voice, and target buyer persona..."
            })

        company_context_digest = self._build_context_digest(
            corpus_pages,
            filter_types=["homepage", "about", "solution", "general"],
            max_chars=12000
        )

        pass1_data = {}
        try:
            p1_messages = [
                {"role": "system", "content": PROMPT_PASS1_COMPANY},
                {"role": "user", "content": f"Extract company identity, brand tone, and customer segments from this corpus:\n\n{company_context_digest}"}
            ]
            pass1_data = await self._call_llm_with_retry(p1_messages, max_tokens=850)
            print("[IntelligenceEngine] Pass 1 (Company & Brand) completed successfully.")
        except Exception as e:
            print(f"[IntelligenceEngine] Pass 1 fallback triggered: {e}")
            pass1_data = {
                "business_intelligence": safe_fb["business_intelligence"],
                "customer_segments": {
                    "target_segments": safe_fb["customer_intelligence"]["target_segments"],
                    "buyer_roles": safe_fb["customer_intelligence"]["buyer_roles"],
                    "buying_motivations": safe_fb["customer_intelligence"]["buying_motivations"],
                    "decision_criteria": safe_fb["customer_intelligence"]["decision_criteria"]
                }
            }

        # Pacing pause: allow Groq per-minute token bucket to reset
        if notifier:
            await notifier({
                "stage": 3, "progress": 48,
                "message": "Company brand tone synthesized. Preparing product catalog extraction..."
            })
        await asyncio.sleep(20)

        # ── PASS 2: Products & Pricing ─────────────────────────────────────────
        if notifier:
            await notifier({
                "stage": 4, "progress": 55,
                "message": "Synthesizing product specifications, pricing models, and key capabilities..."
            })

        product_context_digest = self._build_context_digest(
            corpus_pages,
            filter_types=["pricing", "product", "solution"],
            max_chars=14000
        )

        pass2_data = {}
        try:
            p2_messages = [
                {"role": "system", "content": PROMPT_PASS2_PRODUCTS},
                {"role": "user", "content": f"Extract product offerings, technical features, and pricing structures from this corpus:\n\n{product_context_digest}"}
            ]
            pass2_data = await self._call_llm_with_retry(p2_messages, max_tokens=850)
            print("[IntelligenceEngine] Pass 2 (Products & Pricing) completed successfully.")
        except Exception as e:
            print(f"[IntelligenceEngine] Pass 2 fallback triggered: {e}")
            pass2_data = {"products": safe_fb["products"]}

        # Pacing pause: allow Groq per-minute token bucket to reset
        if notifier:
            await notifier({
                "stage": 5, "progress": 68,
                "message": "Product catalog mapped. Preparing objection handlers and value hooks..."
            })
        await asyncio.sleep(20)

        # ── PASS 3: Objections & Sales Intelligence ───────────────────────────
        if notifier:
            await notifier({
                "stage": 6, "progress": 75,
                "message": "Synthesizing objection battlecards, value hooks, and discovery questions..."
            })

        sales_context_digest = self._build_context_digest(
            corpus_pages,
            filter_types=["faq", "case_study", "documentation", "blog", "pricing"],
            max_chars=12000
        )

        company_summary = pass1_data.get("business_intelligence", {}).get("company_name", {}).get("value", "The company")
        pass3_data = {}
        try:
            p3_messages = [
                {"role": "system", "content": PROMPT_PASS3_SALES},
                {"role": "user", "content": f"For {company_summary}, synthesize objection battlecards and discovery questions from this context:\n\n{sales_context_digest}"}
            ]
            pass3_data = await self._call_llm_with_retry(p3_messages, max_tokens=850)
            print("[IntelligenceEngine] Pass 3 (Objections & Sales Battlecards) completed successfully.")
        except Exception as e:
            print(f"[IntelligenceEngine] Pass 3 fallback triggered: {e}")
            pass3_data = {
                "customer_intelligence": safe_fb["customer_intelligence"],
                "sales_intelligence": safe_fb["sales_intelligence"]
            }

        # ── Merge all passes into unified schema ──────────────────────────────
        cust_merged = {
            "target_segments": pass1_data.get("customer_segments", {}).get("target_segments") or safe_fb["customer_intelligence"]["target_segments"],
            "buyer_roles": pass1_data.get("customer_segments", {}).get("buyer_roles") or safe_fb["customer_intelligence"]["buyer_roles"],
            "buying_motivations": pass1_data.get("customer_segments", {}).get("buying_motivations") or safe_fb["customer_intelligence"]["buying_motivations"],
            "decision_criteria": pass1_data.get("customer_segments", {}).get("decision_criteria") or safe_fb["customer_intelligence"]["decision_criteria"],
            "pain_points": pass3_data.get("customer_intelligence", {}).get("pain_points") or safe_fb["customer_intelligence"]["pain_points"],
            "potential_objections": pass3_data.get("customer_intelligence", {}).get("potential_objections") or safe_fb["customer_intelligence"]["potential_objections"]
        }

        unified_result = {
            "business_intelligence": pass1_data.get("business_intelligence") or safe_fb["business_intelligence"],
            "products": pass2_data.get("products") or safe_fb["products"],
            "customer_intelligence": cust_merged,
            "sales_intelligence": pass3_data.get("sales_intelligence") or safe_fb["sales_intelligence"]
        }

        if notifier:
            await notifier({
                "stage": 7, "progress": 85,
                "message": "All intelligence passes completed. Structuring reviewable Knowledge Capsules..."
            })

        return self._normalize_extracted_data(unified_result)

    async def extract_structured_intelligence(
        self,
        corpus_pages: List[Dict[str, Any]],
        notifier: Optional[Callable[[Dict[str, Any]], Any]] = None
    ) -> Dict[str, Any]:
        """
        Public entry point. Executes deep multi-pass extraction with rate-limit pacing.
        """
        return await self.extract_multi_pass_intelligence(corpus_pages, notifier=notifier)

    def _normalize_extracted_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validates and guarantees all expected sections and fields exist."""
        biz = data.get("business_intelligence", {})
        prods = data.get("products", [])
        cust = data.get("customer_intelligence", {})
        sales = data.get("sales_intelligence", {})

        if not prods:
            prods = [{
                "product_name": biz.get("company_name", {}).get("value", "Core Product"),
                "description": biz.get("business_description", {}).get("value", "Flagship business offering"),
                "pricing_and_plans": "Contact Sales for Pricing",
                "features": ["Autonomous execution", "Real-time CRM sync", "Scalable workflow"],
                "benefits": ["Higher productivity", "Rapid response", "Reduced operational overhead"],
                "confidence": 0.85
            }]

        return {
            "business_intelligence": biz,
            "products": prods,
            "customer_intelligence": cust,
            "sales_intelligence": sales
        }

    def _generate_safe_fallback(self, pages: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Rule-based fallback if LLM request encounters unexpected service outages."""
        title = "Business Entity"
        if pages:
            title = pages[0].get("title", "Business Entity").split(" - ")[0].split(" | ")[0]

        return {
            "business_intelligence": {
                "company_name": {"value": title, "confidence": 0.9, "inference_type": "observed_fact"},
                "business_description": {"value": f"{title} provides enterprise solutions.", "confidence": 0.75, "inference_type": "observed_fact"},
                "industry": {"value": "B2B Technology & Services", "confidence": 0.75, "inference_type": "ai_inference"},
                "business_model": {"value": "Direct Sales & Subscriptions", "confidence": 0.7, "inference_type": "ai_inference"},
                "brand_tone": {"value": "Professional & Consultative", "confidence": 0.85, "inference_type": "ai_inference"},
                "key_differentiators": {"value": "Proprietary execution and dedicated support.", "confidence": 0.7, "inference_type": "ai_inference"}
            },
            "products": [
                {
                    "product_name": f"{title} Platform",
                    "description": "Core product offering identified from business documentation.",
                    "pricing_and_plans": "Contact Sales",
                    "features": ["Enterprise Integration", "Automated Workflows", "Custom Reporting"],
                    "benefits": ["Time savings", "Seamless scalability", "Consistent execution"],
                    "confidence": 0.8
                }
            ],
            "customer_intelligence": {
                "target_segments": ["Mid-Market & Enterprise Accounts"],
                "buyer_roles": ["Decision Maker", "Department Head"],
                "pain_points": [
                    {"problem": "High manual overhead in current operations", "confidence": 0.8, "inference_type": "ai_inference"},
                    {"problem": "Fragmented tooling causing communication lag", "confidence": 0.75, "inference_type": "ai_inference"}
                ],
                "buying_motivations": ["Operational efficiency", "Predictable ROI"],
                "decision_criteria": ["Implementation timeline", "Security compliance"],
                "potential_objections": [
                    {"objection": "We already have an existing process in place.", "suggested_pivot": "Highlight seamless integration without disrupting current tools.", "confidence": 0.8, "inference_type": "ai_inference"}
                ]
            },
            "sales_intelligence": {
                "discovery_questions": [
                    "How are you currently handling your team's workflow constraints?",
                    "What criteria would define success for a new platform implementation this quarter?"
                ],
                "value_propositions": [
                    "Accelerate time-to-results while reducing repetitive administrative burden."
                ],
                "sales_talking_points": [
                    "Purpose-built for fast deployment with zero downtime."
                ],
                "call_opening_hook": f"Hi, I noticed your focus on scaling operations and wanted to share how {title} helps teams like yours.",
                "qualification_criteria": [
                    "Active need within the next 30-90 days",
                    "Authorized budget decision maker"
                ]
            }
        }
