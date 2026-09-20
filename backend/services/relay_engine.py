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
    system_prompt = """You are Clozflow Relay, an AI that creates personalized follow-up briefings after cold calls.
Your goal is to make the buyer feel: "They understood what I told them."
Do NOT write generic SaaS marketing copy. Do NOT invent problems, solutions, or next steps.

Output valid JSON with the following keys:
- "summary": A concise, prospect-centric reflection of the actual problem, pain point, or situation discussed. Start naturally (e.g., "You mentioned that..."). DO NOT summarize the whole call. Focus on THEIR problem.
- "benefits": A JSON array of up to 3 strings explaining what was explored to solve their specific problem. Connect directly to their situation. Avoid generic fluff like "Tailored approach" or "Seamless experience". Keep it direct and human.
- "next_step": Explain what remains before the next meaningful step (e.g., "A short walkthrough of how this fits your workflow"). If an actual step was agreed upon, use it. Do not fabricate an agreement."""

    user_prompt = f"""CALL TRANSCRIPT:
{conversation_text}

CALL ANALYSIS INSIGHTS:
{insights_text}

PRODUCT CONTEXT:
{product_context if product_context else 'No product context available.'}

PROSPECT: {prospect_name or 'Unknown'} ({prospect_business or 'Unknown business'})
SELLER: {seller_name or 'Unknown'} ({seller_company or 'Unknown company'})

Generate the Relay follow-up page content. Return ONLY valid JSON."""

    try:
        response = await client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.5,
            max_tokens=600,
            response_format={"type": "json_object"}
        )

        content = response.choices[0].message.content
        result = json.loads(content)

        return {
            "summary": result.get("summary", "We recently had a conversation about how we might be able to help your business."),
            "benefits": result.get("benefits", ["Personalized solution for your needs"]),
            "next_step": result.get("next_step", "Let's schedule a follow-up to discuss the next steps.")
        }

    except Exception as e:
        print(f"Relay AI generation error: {e}")
        # Graceful fallback — never block relay creation
        return {
            "summary": "We recently discussed how our solution could help your business. Here's a summary of what we covered and the next steps.",
            "benefits": [
                "Tailored approach for your specific needs",
                "Dedicated support throughout the process",
                "Clear timeline and next steps"
            ],
            "next_step": "Let's schedule a follow-up call to discuss the details and answer any questions."
        }
