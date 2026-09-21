"""
Clozflow Relay V1 — AI Content Generation Engine
Generates personalized buyer-facing Relay content from call data + product context.
Uses the same Groq/OpenAI client pattern as the existing sales_ai_engine.
"""

import os
import json
from openai import AsyncOpenAI

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Use Groq endpoint — same pattern as sales_ai_engine.py
client = AsyncOpenAI(
    api_key=os.getenv("GROQ_API_KEY"),
    base_url="https://api.groq.com/openai/v1"
)

MODEL = "openai/gpt-oss-120b"


async def generate_relay_content(
    transcript_data: list,
    ai_data: list,
    capsule: dict | None = None,
    prospect_name: str = "",
    prospect_business: str = "",
    seller_name: str = "",
    seller_company: str = "",
) -> dict:
    """
    Generate buyer-facing Relay content from call transcript + analysis + product context.
    Returns: {summary, benefits: [...], next_step}
    """

    # ── Build conversation text from transcript ────────────────
    conversation_lines = []
    for entry in transcript_data[:40]:  # Cap to avoid token overflow
        speaker = entry.get("speaker", entry.get("role", "Unknown"))
        text = entry.get("text", entry.get("content", ""))
        if text:
            conversation_lines.append(f"{speaker}: {text}")
    conversation_text = "\n".join(conversation_lines) if conversation_lines else "No transcript available."

    # ── Extract AI insights (hidden concerns, coaching tips) ───
    insights = []
    for item in ai_data[:15]:
        payload = item.get("payload", item) if isinstance(item, dict) else {}
        concern = payload.get("hidden_concern", "")
        tip = payload.get("coaching_tip", "")
        strategy = payload.get("strategy", "")
        if concern:
            insights.append(f"Prospect concern: {concern}")
        if tip:
            insights.append(f"Coaching insight: {tip}")
        if strategy:
            insights.append(f"Strategy used: {strategy}")
    insights_text = "\n".join(insights) if insights else "No analysis available."

    # ── Build product context from capsule ─────────────────────
    product_context = ""
    if capsule:
        parts = []
        if capsule.get("product_name"): parts.append(f"Product: {capsule['product_name']}")
        if capsule.get("product_price"): parts.append(f"Price: {capsule['product_price']}")
        if capsule.get("product_specification"): parts.append(f"Features: {capsule['product_specification']}")
        if capsule.get("target_audience"): parts.append(f"Target: {capsule['target_audience']}")
        if capsule.get("key_differentiators"): parts.append(f"Differentiators: {capsule['key_differentiators']}")
        if capsule.get("pain_points_solved"): parts.append(f"Solves: {capsule['pain_points_solved']}")
        product_context = "\n".join(parts)

    # ── System prompt ──────────────────────────────────────────
    system_prompt = """You are Clozflow Relay — an AI that transforms sales conversations into living, buyer-verified decision contexts.
YOUR PURPOSE: Create a premium, highly specific, private briefing that a buyer can read, verify, and forward to other decision-makers.

RULES:
1. SPECIFICITY: AI-generated copy must be grounded in the actual conversation. Generic sales language is FORBIDDEN.
2. NO MAGIC AI: Transform conversation evidence into useful structure, do NOT invent a fictional sales narrative or ROI.
3. EDITORIAL TONE: Quiet, confident, human, minimal. Not a generic SaaS dashboard.
4. FORBIDDEN PHRASES: "tailored approach", "seamless experience", "powerful solution", "transform your business", "take your business to the next level", "dedicated support", "cutting-edge", "best-in-class", "unlock your potential".

Output valid JSON with exactly the following keys:
- "primary_need": The strongest business problem explicitly expressed by the prospect.
- "interest": Evidence showing what the prospect responded positively to.
- "concern": The biggest unresolved concern, objection, or uncertainty.
- "buyer_context": A short, specific description of the situation discussed on the call (the prospect's current situation). Reads as if a thoughtful human wrote it.
- "problem_statement": A large typographic statement summarizing the core problem. E.g. "Most new enquiries are coming through WhatsApp, but follow-up depends on someone remembering to respond." Use actual prospect language.
- "conversation_points": An array of exactly 3-5 strings. Each string must concisely capture: [Specific issue] — [Why it matters] — [What was discussed]. No generic feature lists.
- "impact": A JSON object representing the cost of doing nothing. If the transcript contains real numbers, output {"type": "quantitative", "metric": "e.g. 8 hrs", "label": "e.g. manual follow-up / week", "source": "e.g. mentioned during the call"}. If NO quantitative evidence exists, DO NOT invent one! Instead output {"type": "qualitative", "title": "THE FRICTION", "statement": "Explain the observable impact of the current problem based on the call."}
- "solution_approach": Explain how the discussed solution addresses the specific problem. ONLY what was discussed or approved. No unsupported promises.
- "next_step": Choose or write a concrete next step (e.g. "Product walkthrough", "Pricing discussion", "Decision call").
"""

    user_prompt = f"""CALL TRANSCRIPT:
{conversation_text}

CALL ANALYSIS INSIGHTS:
{insights_text}

PRODUCT CONTEXT:
{product_context if product_context else 'No product context available.'}

PROSPECT: {prospect_name or 'Unknown'} ({prospect_business or 'Unknown business'})
SELLER: {seller_name or 'Unknown'} ({seller_company or 'Unknown company'})

Generate the Relay follow-up context. Return ONLY valid JSON."""

    try:
        response = await client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.3,
            max_tokens=1500,
            response_format={"type": "json_object"}
        )

        content = response.choices[0].message.content
        result = json.loads(content)
        
        return {
            "primary_need": result.get("primary_need", ""),
            "interest": result.get("interest", ""),
            "concern": result.get("concern", ""),
            "buyer_context": result.get("buyer_context", "We discussed your current setup and identified key areas for improvement."),
            "problem_statement": result.get("problem_statement", "A critical operational bottleneck needs addressing."),
            "conversation_points": json.dumps(result.get("conversation_points", [])),
            "impact": json.dumps(result.get("impact", {"type": "qualitative", "title": "THE FRICTION", "statement": "Current processes are creating unnecessary delays."})),
            "solution_approach": result.get("solution_approach", "We explored a structured approach to resolve the identified bottleneck."),
            "next_step": result.get("next_step", "Product walkthrough")
        }

    except Exception as e:
        print(f"Relay AI generation error: {e}")
        return {
            "primary_need": "Unclear from transcript.",
            "interest": "Pending further discussion.",
            "concern": "None explicitly stated.",
            "buyer_context": "We discussed your current workflow and identified a few key operational challenges.",
            "problem_statement": "There is friction in your current process that requires manual intervention.",
            "conversation_points": json.dumps([
                "Current Workflow — Manual steps are slowing down the team — We explored how to automate the handoff.",
                "Visibility — It's hard to see where things stand — We looked at centralizing the data."
            ]),
            "impact": json.dumps({"type": "qualitative", "title": "THE FRICTION", "statement": "Without a change, the team will continue to spend hours on manual coordination rather than core work."}),
            "solution_approach": "A phased rollout to replace the manual steps without disrupting existing work.",
            "next_step": "Product walkthrough"
        }
