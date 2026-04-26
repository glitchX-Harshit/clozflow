import os
import json
import time
import asyncio
from typing import Any
from openai import AsyncOpenAI
from difflib import SequenceMatcher
from rag.rag_engine import RAGEngine

api_key = os.getenv("OPENAI_API_KEY")
client = AsyncOpenAI(
    api_key=api_key,
    base_url="https://api.groq.com/openai/v1"
) if api_key else None


class SalesAIEngine:
    def __init__(self, call_context: dict[str, Any] | None = None):
        self.call_context = call_context
        self.message_buffer: list[dict[str, Any]] = []
        self.response_history: list[str] = []
        self.last_strategies: list[str] = []
        
        self.deal_state = {
            "stage": "discovery",
            "last_intent": None,
            "objections_handled": [],
            "pressure_level": 1
        }
        
        self.max_messages = 8
        self.max_latency = 2.0  # V2 2-sec strict limit
        self._last_call_time: float = 0.0
        self._cooldown_secs: float = 2.0  # Min 2 secs between calls
        
        self.rag = RAGEngine()
        self.rag.load_index()

    def get_pressure_instruction(self):
        level = self.deal_state["pressure_level"]

        if level == 1:
            return "Keep it consultative and exploratory."
        elif level == 2:
            return "Guide the prospect toward a decision subtly."
        else:
            return "Apply firm pressure and move toward commitment."

    def update_stage(self, intent: str):
        if intent in ["pricing", "hesitation", "trust"]:
            self.deal_state["stage"] = "objection"
        elif intent in ["interest"]:
            self.deal_state["stage"] = "closing"
        elif intent in ["confusion"]:
            self.deal_state["stage"] = "discovery"

    def add_message(self, speaker: str, text: str):
        self.message_buffer.append({"speaker": speaker, "text": text, "timestamp": time.time()})
        if len(self.message_buffer) > self.max_messages:
            self.message_buffer.pop(0)

    def is_duplicate(self, text: str) -> bool:
        if not text:
            return False
        text_lower = text.lower()
        for past_sugg in self.response_history:
            if SequenceMatcher(None, text_lower, past_sugg.lower()).ratio() > 0.70:
                return True
        return False

    def push_response_history(self, response: str, strategy: str):
        self.response_history.append(response)
        if len(self.response_history) > 3:
            self.response_history.pop(0)
            
        if strategy:
            self.last_strategies.append(strategy)
            # Avoid repeating last 2 used strategies
            if len(self.last_strategies) > 2:
                self.last_strategies.pop(0)

    def smart_fallback(self) -> dict:
        """
        V2 Fallback System: Short strategic question instead of long explanation.
        """
        print("[FALLBACK] Using V2 short strategic fallback.")
        fallback_msg = "Can I ask — what's the main hesitation right now?"
        return {
            "intent": "hesitation",
            "stage": "objection",
            "strategy": "DIAGNOSTIC_QUESTION",
            "confidence": 1.0,
            "response": fallback_msg,
            "next_question": fallback_msg,
            "coaching_tip": "API failed. Use this to keep the prospect talking."
        }

    async def analyze(self, speaker: str, text: str) -> dict | None:
        print(f"[TRANSCRIPT] {speaker}: {text}")

        # V2 Trigger Control
        if speaker != "prospect":
            return None

        if self.deal_state["stage"] == "objection":
            self.deal_state["pressure_level"] = min(self.deal_state["pressure_level"] + 1, 3)

        # Pass transcripts containing useful words
        if len(text.strip().split()) < 3 and len(text.strip()) < 15:
            print("[AI_SKIPPED] Transcript too short.")
            self.add_message(speaker, text)
            return None

        now = time.time()
        if now - self._last_call_time < self._cooldown_secs:
            print("[AI_SKIPPED] Cooldown active.")
            return None
            
        self._last_call_time = now
        self.add_message(speaker, text)

        print("[AI_TRIGGERED] V2 CloserBrain analyzing...")

        if not client:
            print("[AI_INFO] No LLM client configured — using fallback.")
            return self.smart_fallback()

        context_str = ""
        if self.call_context:
            context_str = "\nMANDATORY CONTEXT USAGE:\n" + json.dumps(self.call_context)

        avoid_strategies = ", ".join(self.last_strategies) if self.last_strategies else "None"

        intent = self.deal_state["last_intent"]

        rag_results = self.rag.retrieve(text)

        rag_context = "\n".join([
            f"- Insight: {r.get('insight', '')} | Strategy: {r.get('strategy', '')} | Avoid: {r.get('avoid', '')}"
            for r in rag_results
        ])

        forced_strategy = None
        if rag_results:
            forced_strategy = rag_results[0].get("strategy")

        system_content = f"""You are "CloserBrain V2" — an elite B2B sales closing engine.

{context_str}

RELEVANT SALES INSIGHTS:
{rag_context}

RULES:
- Use insights ONLY if relevant
- Do NOT copy text directly
- Use them to guide strategy selection

CURRENT DEAL STATE:
- Stage: {self.deal_state["stage"]}
- Pressure Level: {self.deal_state["pressure_level"]}

PRESSURE MODE:
{self.get_pressure_instruction()}

CORE BEHAVIOR RULES:
- You MUST lead the conversation.
- You MUST move the deal forward every response.
- NEVER just answer — always guide.
- Always include a directional question.

PERSONALIZATION:
- You MUST reference user's business, problem, or goal.
- Do NOT give generic responses.

STRATEGY RULES:
- Avoid recently used strategies: [{avoid_strategies}]
- Use correct strategy for intent.
- Do NOT repeat same persuasion pattern.
"""
        if forced_strategy:
            system_content += f"\n- Preferred strategy: {forced_strategy}"
            system_content += f"\n- MANDATORY STRATEGY: Use {forced_strategy} for this response."

        system_content += """
AUTHORITY RULES:
- NEVER offer discounts immediately
- NEVER sound desperate
- Maintain control

RESPONSE STYLE:
- Max 2 sentences
- Sharp, confident, non-generic
- Mix statement + question

OUTPUT JSON:
{
  "intent": "...",
  "stage": "...",
  "strategy": "...",
  "confidence": 0.0,
  "response": "...",
  "next_question": "...",
  "coaching_tip": "..."
}
"""

        prev_context = list(self.message_buffer[:-1])

        prompt = f"""
Conversation Buffer:
{json.dumps(prev_context)}

LATEST PROSPECT MESSAGE:
"{text}"

Output strictly conforming JSON.
"""

        for attempt in range(2):
            try:
                llm_response = await asyncio.wait_for(
                    client.chat.completions.create(
                        model="llama-3.3-70b-versatile",
                        messages=[
                            {"role": "system", "content": system_content},
                            {"role": "user", "content": prompt}
                        ],
                        response_format={"type": "json_object"},
                        temperature=0.3 + (attempt * 0.4),
                    ),
                    timeout=self.max_latency
                )

                content = llm_response.choices[0].message.content
                data = json.loads(content)

                intent = data.get("intent", "neutral")
                self.deal_state["last_intent"] = intent
                self.update_stage(intent)

                if intent in ["pricing", "trust", "hesitation"]:
                    self.deal_state["objections_handled"].append(intent)

                suggested_resp = data.get("response", "").strip()
                if not suggested_resp:
                    return self.smart_fallback()

                # Anti-Repetition logic
                if self.is_duplicate(suggested_resp):
                    print("[BLOCKED] Duplicate response prevented")
                    return self.smart_fallback()

                self.push_response_history(suggested_resp, data.get("strategy"))
                
                if self.deal_state["stage"] == "closing":
                    data["next_question"] = "If this solves your problem, is there anything stopping you from moving forward today?"

                # Output Normalization for existing frontend fields
                data["suggested_response"] = suggested_resp
                data["next_best_question"] = data.get("next_question", "")
                data["persuasion_pattern"] = data.get("strategy", "")
                data["type"] = data.get("intent", "")
                data["deal_stage"] = data.get("stage", "")

                print(f"[AI_RESPONSE] ✅ {data.get('strategy', 'NONE')} | {suggested_resp[:60]}...")
                return data

            except asyncio.TimeoutError:
                print(f"[AI_TIMEOUT] Exceeded {self.max_latency}s SLA limit. Forcing fallback.")
                return self.smart_fallback()
            except (json.JSONDecodeError, Exception) as e:
                print(f"[AI_ERROR] Engine Error: {e}")
                return self.smart_fallback()

        return self.smart_fallback()
