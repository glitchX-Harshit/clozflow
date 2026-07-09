import os
import json
import time
import asyncio
from typing import Dict, Any, List

try:
    from openai import AsyncOpenAI
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False

class UnifiedConversationBrain:
    def __init__(self, db_session=None):
        self.db_session = db_session
        self.max_retries = 2
        self.max_latency = 15.0
        
        api_key = os.getenv("GROQ_API_KEY", os.getenv("HEXAGON_RESEARCH_API_KEY", ""))
        
        if api_key and HAS_OPENAI:
            if api_key.startswith("AIza") or api_key.startswith("AQ"):
                base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
                self.model = "gemini-3.5-flash"
            elif api_key.startswith("gsk_"):
                base_url = "https://api.groq.com/openai/v1"
                self.model = "llama-3.3-70b-versatile"
            else:
                base_url = "https://api.openai.com/v1"
                self.model = "gpt-4o-mini"
            self.client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        else:
            self.client = None
            self.model = None

    def initialize_memory(self, lead_data: dict, user_context: dict) -> dict:
        """Initialize the unified conversation memory block."""
        return {
            "lead_profile": {
                "business_name": lead_data.get("business_name", ""),
                "category": lead_data.get("category", ""),
                "city": lead_data.get("city", ""),
                "website": lead_data.get("website", ""),
                "instagram": lead_data.get("instagram", ""),
                "phone": lead_data.get("phone_number", ""),
                "ai_summary": lead_data.get("ai_summary", ""),
                "opportunity_summary": lead_data.get("opportunity_summary", ""),
                "opportunity_signals": lead_data.get("opportunity_signals", ""),
                "likely_pain_point": lead_data.get("likely_pain_point", ""),
            },
            "business_context": {
                "your_company": user_context.get("your_company", "a B2B software consulting firm"),
                "your_role": user_context.get("your_role", "Founder / Sales Strategist"),
            },
            "outreach_memory": {
                "observation": "",
                "opening_message": "",
                "expected_reply": "",
                "psychological_angle": "",
                "strategy": "",
            },
            "conversation_history": [],
            "planning_state": {
                "overall_goal": "book_meeting",
                "current_goal": "discover_current_system",
                "next_goal": "identify_problem",
                "qualification_score": 0,
                "meeting_probability": 0,
            },
            "conversation_state": {
                "discovered_information": [],
                "unanswered_questions": [],
                "objections": [],
                "buying_signals": [],
                "trust_score": 0,
                "buying_intent": 0,
            }
        }

    async def generate_outreach(self, memory: dict) -> dict:
        """Phase 1: Generate the initial outreach hook based on the Lead Profile."""
        if not self.client:
            return {"error": "LLM client not configured"}
            
        system_prompt = f"""You are an elite, 11-year veteran sales strategist representing {memory['business_context']['your_company']} as a {memory['business_context']['your_role']}.
Your ultimate goal is to start an organic conversation by highlighting an unseen bottleneck, without ever sounding like you're selling something.

You are crafting the very first OUTREACH message to a new lead.
LEAD PROFILE:
- Business: {memory['lead_profile']['business_name']} ({memory['lead_profile']['category']}, {memory['lead_profile']['city']})
- Summary: {memory['lead_profile']['ai_summary']}
- Opportunity: {memory['lead_profile']['opportunity_summary']}
- Signals: {memory['lead_profile']['opportunity_signals']}
- Pain Point: {memory['lead_profile']['likely_pain_point']}

RULES:
1. Execute a psychological pattern interrupt.
2. Find a massive contrast or unseen friction point in their setup.
3. NEVER pitch a product and NEVER ask for a call, meeting, or Zoom. Spark intense curiosity and trust.
4. Keep it to 1-2 short sentences.
5. End with a soft, low-pressure question that forces them to reply and builds conversation, NOT a request for a meeting or call.

OUTPUT (Strict JSON):
{{
  "observation": "The invisible friction point you noticed",
  "opening_message": "The exact hook you will send",
  "expected_reply": "What they will likely say back",
  "psychological_angle": "Why this specific hook works",
  "strategy": "Your overarching strategy for this lead"
}}"""

        for attempt in range(self.max_retries):
            try:
                response = await asyncio.wait_for(
                    self.client.chat.completions.create(
                        model=self.model,
                        messages=[{"role": "system", "content": system_prompt}],
                        response_format={"type": "json_object"},
                        temperature=0.7,
                    ),
                    timeout=self.max_latency
                )
                
                content = response.choices[0].message.content.strip()
                data = json.loads(content)
                
                # Update Memory
                memory["outreach_memory"] = {
                    "observation": data.get("observation", ""),
                    "opening_message": data.get("opening_message", ""),
                    "expected_reply": data.get("expected_reply", ""),
                    "psychological_angle": data.get("psychological_angle", ""),
                    "strategy": data.get("strategy", "")
                }
                memory["conversation_history"].append({"speaker": "rep", "text": data.get("opening_message", "")})
                
                return data
            except Exception as e:
                if attempt == self.max_retries - 1:
                    print(f"[UnifiedBrain] Outreach Generation Error: {e}")
                    raise e
                    
    async def analyze_and_reply(self, memory: dict, incoming_message: str) -> dict:
        """Phase 2: Analyze a live reply and generate the next strategic move."""
        if not self.client:
            return {"error": "LLM client not configured"}

        # Format conversation history
        history_str = ""
        for msg in memory["conversation_history"]:
            speaker = "PROSPECT" if msg["speaker"] == "prospect" else "YOU"
            history_str += f"{speaker}: {msg['text']}\n"
        
        history_str += f"PROSPECT: {incoming_message}\n"

        system_prompt = f"""You are an elite, 11-year veteran sales strategist representing {memory['business_context']['your_company']} as a {memory['business_context']['your_role']}.
You are in a LIVE conversation. The prospect just replied to you.

--- CORE PHILOSOPHY ---
Never generate a reply from only the latest message. You MUST remember why this conversation started.
Original Observation: {memory['outreach_memory']['observation']}
Opening Message Sent: {memory['outreach_memory']['opening_message']}
Your Strategy: {memory['outreach_memory']['strategy']}
Current Goal: {memory['planning_state']['current_goal']}

--- STRATEGY ENGINE CHECKLIST (Think before replying) ---
1. Why did we start this conversation? (To fix their {memory['lead_profile']['likely_pain_point']})
2. What have we already learned?
3. What information is missing?
4. Should I answer first? (YES. ALWAYS answer their question naturally first.)
5. Should I ask, reframe, or close? (Move one step closer to {memory['planning_state']['overall_goal']})

--- REPLY RULES ---
- 1-3 sentences max. Shorter is almost always better.
- ALWAYS answer their question first naturally.
- PROSPECT PERSPECTIVE FILTER: Before answering, ask yourself: 'If I were the prospect, would I reply to this?' If no, discard it and generate a sharper, value-driven reframe.
- FOCUS ON THE CLOSE: Don't ask fluffy or repetitive questions. Address objections by reframing them and pushing the deal forward. The ultimate goal is to close the deal.
- DO NOT restart discovery. Build on what they just said.
- Continue the original strategy. Do not forget the previous context.
- NEVER become generic or ask random "What's your biggest bottleneck" questions if you already know their bottleneck.
- Sound human, confident, and peer-to-peer. NEVER sound desperate or like a chatbot.

--- LEAD DATA ---
Summary: {memory['lead_profile']['ai_summary']}
Signals: {memory['lead_profile']['opportunity_signals']}

--- CONVERSATION HISTORY ---
{history_str}

OUTPUT (Strict JSON):
{{
  "suggested_reply": "Your exact reply to the prospect",
  "reasoning": "Why you chose this reply based on the Strategy Engine checklist",
  "coaching": "One line of advice to the rep using this reply",
  "updated_goal": "The new current_goal for the next turn (e.g. identify_decision_maker, book_meeting)",
  "updated_stage": "discovery, objection, or closing"
}}"""

        for attempt in range(self.max_retries):
            try:
                start_time = time.time()
                response = await asyncio.wait_for(
                    self.client.chat.completions.create(
                        model=self.model,
                        messages=[{"role": "system", "content": system_prompt}],
                        response_format={"type": "json_object"},
                        temperature=0.4 + (attempt * 0.2), # Increase variation on retry
                    ),
                    timeout=self.max_latency
                )
                
                content = response.choices[0].message.content.strip()
                data = json.loads(content)
                
                # Update memory
                memory["conversation_history"].append({"speaker": "prospect", "text": incoming_message})
                memory["conversation_history"].append({"speaker": "rep", "text": data.get("suggested_reply", "")})
                
                # Keep history bounded if needed, but V2 wants to remember context. 
                # For safety, let's keep the last 10 messages.
                if len(memory["conversation_history"]) > 10:
                    memory["conversation_history"] = memory["conversation_history"][-10:]
                    
                memory["planning_state"]["current_goal"] = data.get("updated_goal", memory["planning_state"]["current_goal"])
                
                # Logging
                print(f"[UnifiedBrain] Reply Gen | Time: {time.time() - start_time:.2f}s | Goal: {data.get('updated_goal')}")
                
                return data
            except Exception as e:
                if attempt == self.max_retries - 1:
                    print(f"[UnifiedBrain] Live Reply Error: {e}")
                    raise e
