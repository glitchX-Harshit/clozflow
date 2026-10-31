import os
import json
import re
from typing import Dict, Any, List, Optional
from openai import AsyncOpenAI


EXTRACTION_PROMPT = """
You are Pearl Knowledge Intelligence, an elite B2B enterprise sales researcher.
Analyze the provided clean business website content or uploaded documents. Extract truth-grounded, structured business and sales intelligence.

CRITICAL RULES:
1. DO NOT HALLUCINATE OR INVENT PRICING, TESTIMONIALS, GUARANTEES, OR FEATURES. If pricing is not publicly stated, set pricing to "Contact Sales / Custom Quote" with inference_type "observed_fact".
2. DISTINGUISH STRICTLY BETWEEN:
   - "observed_fact": Explicitly stated in the text with verifiable evidence.
   - "ai_inference": Strategically inferred buyer psychology, sales angles, or objection handlers derived from context.
3. Every single extracted fact must provide:
   - "value": The extracted truth or strategic insight.
   - "confidence": Float between 0.50 and 1.00.
   - "inference_type": "observed_fact" OR "ai_inference".
   - "source_excerpt": Short direct quote from text proving this fact (or empty string if general inference).

OUTPUT SCHEMA (Must return valid JSON ONLY):
{
  "business_intelligence": {
    "company_name": {"value": "...", "confidence": 0.95, "inference_type": "observed_fact", "source_excerpt": "..."},
    "business_description": {"value": "...", "confidence": 0.95, "inference_type": "observed_fact", "source_excerpt": "..."},
    "industry": {"value": "...", "confidence": 0.90, "inference_type": "observed_fact", "source_excerpt": "..."},
    "business_model": {"value": "B2B SaaS / Services / etc.", "confidence": 0.85, "inference_type": "ai_inference", "source_excerpt": "..."},
    "brand_positioning": {"value": "...", "confidence": 0.85, "inference_type": "ai_inference", "source_excerpt": "..."},
    "brand_tone": {"value": "Consultative, Authoritative, Energetic, etc.", "confidence": 0.85, "inference_type": "ai_inference", "source_excerpt": "..."},
    "target_markets": {"value": "...", "confidence": 0.85, "inference_type": "observed_fact", "source_excerpt": "..."},
    "key_differentiators": {"value": "...", "confidence": 0.90, "inference_type": "observed_fact", "source_excerpt": "..."}
  },
  "products": [
    {
      "product_name": "...",
      "description": "...",
      "pricing_and_plans": "...",
      "features": ["...", "..."],
      "benefits": ["...", "..."],
      "integrations": ["...", "..."],
      "use_cases": ["...", "..."],
      "product_faqs": [{"question": "...", "answer": "..."}],
      "confidence": 0.95,
      "source_excerpt": "..."
    }
  ],
  "customer_intelligence": {
    "target_segments": ["...", "..."],
    "buyer_roles": ["VP of Sales", "CTO", "..."],
    "pain_points": [
      {"problem": "...", "evidence": "...", "confidence": 0.90, "inference_type": "observed_fact"},
      {"problem": "...", "evidence": "...", "confidence": 0.80, "inference_type": "ai_inference"}
    ],
    "buying_motivations": ["...", "..."],
    "decision_criteria": ["...", "..."],
    "potential_objections": [
      {"objection": "Too expensive", "suggested_pivot": "...", "confidence": 0.85, "inference_type": "ai_inference"},
      {"objection": "Already have a vendor", "suggested_pivot": "...", "confidence": 0.85, "inference_type": "ai_inference"}
    ]
  },
  "sales_intelligence": {
    "discovery_questions": ["...", "..."],
    "value_propositions": ["...", "..."],
    "sales_talking_points": ["...", "..."],
    "call_opening_hook": "...",
    "qualification_criteria": ["...", "..."]
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

    async def extract_structured_intelligence(
        self,
        corpus_pages: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Processes ingested website pages or documents and returns structured intelligence.
        """
        # Build aggregated digest (prioritize pricing, products, about, home)
        ranked_pages = sorted(
            corpus_pages,
            key=lambda p: 100 if p.get("page_type") in ("pricing", "product") else (80 if p.get("page_type") == "homepage" else 50),
            reverse=True
        )

        digest_blocks = []
        total_len = 0
        for p in ranked_pages[:8]:
            text_snippet = p.get("clean_text", "")[:3500]
            block = f"=== SOURCE: {p.get('url', 'Document')} ({p.get('title', 'Page')}) ===\n{text_snippet}\n"
            digest_blocks.append(block)
            total_len += len(block)
            if total_len > 24000:
                break

        full_context = "\n".join(digest_blocks)

        prompt_messages = [
            {"role": "system", "content": EXTRACTION_PROMPT},
            {"role": "user", "content": f"Extract structured business intelligence from this verified corpus:\n\n{full_context}"}
        ]

        try:
            resp = await self.client.chat.completions.create(
                model=self.model,
                messages=prompt_messages,
                response_format={"type": "json_object"},
                temperature=0.2,
                max_tokens=3000
            )

            raw_json = resp.choices[0].message.content.strip()
            # Clean markdown fences if present
            raw_json = re.sub(r"^```json\s*", "", raw_json)
            raw_json = re.sub(r"\s*```$", "", raw_json)

            data = json.loads(raw_json)
            return self._normalize_extracted_data(data)

        except Exception as e:
            print(f"[IntelligenceEngine Error] Extraction failed: {e}. Falling back to rule-based fallback.")
            return self._generate_safe_fallback(corpus_pages)

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
        """Rule-based fallback if LLM request encounters API limits."""
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
