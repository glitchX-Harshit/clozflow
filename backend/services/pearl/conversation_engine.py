"""
Pearl Conversation Engine — Optimized for realtime phone latency.

Key optimizations over previous version:
- Persistent httpx.AsyncClient (no TCP+TLS setup per utterance)
- Streaming token output consumed by caller for immediate TTS chunking
- Compact system prompt cached at init
- Conversation context kept minimal
- import json at module level (not per-token)
"""
import os
import json
import time
import httpx
from typing import Dict, Any, List, AsyncGenerator


# Reusable client — created once per process, connection-pooled
_llm_client: httpx.AsyncClient | None = None

def _get_llm_client() -> httpx.AsyncClient:
    global _llm_client
    if _llm_client is None or _llm_client.is_closed:
        _llm_client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=30.0, write=5.0, pool=5.0),
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
        )
    return _llm_client


class ConversationEngine:
    """
    Evaluates prospect responses and updates conversation state using an LLM.
    Provides the conversational intelligence for the agent.
    """
    
    def __init__(self, objective: str, lead_context: Dict[str, Any]):
        self.objective = objective
        self.lead = lead_context
        self.history: List[Dict[str, str]] = []
        self.system_prompt = self._build_system_prompt()
        self.groq_api_key = os.getenv("GROQ_API_KEY")
        self.model = os.getenv("PEARL_LLM_MODEL", "llama-3.1-8b-instant")
        
        # Pre-built messages prefix (immutable across turns)
        self._system_messages = [{"role": "system", "content": self.system_prompt}]
        
    def _build_system_prompt(self) -> str:
        name = self.lead.get('business_name', 'Unknown')
        capsule = self.lead.get('capsule_context', 'No product context provided.')
        
        return (
            f"You are Pearl, an intelligent, highly natural outbound sales executive, calling a prospect named {name}. "
            f"Derive your company, product, and identity entirely from the context provided below.\n"
            f"Your primary objective is: {self.objective}.\n\n"
            f"PRODUCT & LEAD CONTEXT (CAPSULE):\n{capsule}\n\n"
            f"CONVERSATIONAL INTELLIGENCE & LANGUAGE RULES:\n"
            f"1. Natural Hinglish & Code-Switching: You are a FEMALE. You MUST use female gender conjugations when speaking Hindi/Hinglish (e.g., use 'kar rahi hoon' instead of 'raha', 'karti' instead of 'karta', 'bolungi' instead of 'bolunga'). You MUST speak in conversational Indian 'Hinglish' (a natural blend of Hindi and English). Use natural Hindi filler words seamlessly (e.g., 'Haan', 'Achha', 'Dekhiye', 'Sahi baat hai', 'Bilkul', 'Lekin', 'Matlab'). Never sound like a formal corporate robot. If the prospect speaks Hindi, mirror it heavily. If they speak English, stick mostly to English but keep the Indian conversational warmth (e.g., 'Haan, absolutely', 'Fair point hai').\n"
            f"2. Creative Pattern Interrupt Opening: Your VERY FIRST message must be a highly creative, personalized pattern interrupt. Do NOT use a fixed script. Do NOT use generic greetings ('Hello', 'How are you'). Do NOT always ask the same question. Instead, dynamically invent a fresh, unexpected opening statement, observation, or question derived directly from the Product and Lead context. Vary your approach wildly: sometimes start with a bold assumption, sometimes a highly specific question, sometimes a direct observation about their industry.\n"
            f"3. Smart Sales Behavior: Listen, understand, and respond contextually. Do not dump features, monologue, or sound scripted. Ask useful questions, identify underlying problems, handle objections intelligently, and establish relevance. Never repeat information that has already been established. Move naturally toward the campaign objective.\n"
            f"4. Intelligent Objection Handling: When a prospect objects, validate it naturally (e.g., 'Valid concern hai') before responding. Distinguish their true intent (e.g., 'too expensive' = no budget vs no value seen) and respond contextually.\n"
            f"5. Spoken Format: Generate SPOKEN words only, intended for an Indian Text-To-Speech engine. Keep responses to 1-3 short sentences. NEVER use markdown, bullet points, numbered lists, or corporate jargon. Use natural contractions and simple spoken phrasing."
        )
        
    def add_turn(self, speaker: str, text: str) -> None:
        """Add a turn to the conversation history."""
        role = "user" if speaker == "prospect" else "assistant"
        self.history.append({"role": role, "content": text})
        # Keep context compact: last 10 turns max
        if len(self.history) > 10:
            self.history = self.history[-10:]
        
    async def generate_response_stream(self) -> AsyncGenerator[str, None]:
        """
        Stream the next response using Groq.
        Yields tokens as they arrive — caller can start TTS immediately.
        """
        if not self.groq_api_key:
            yield "I'm sorry, my language processor is currently offline."
            return

        messages = self._system_messages + self.history
        
        # Groq/Minijinja models require at least one user message
        if not self.history:
            messages.append({
                "role": "user",
                "content": "Generate your very first spoken response for this outbound call. Do not use a generic or repetitive opening. Invent a highly creative, wildly varied pattern interrupt based on my business and the product context. Use conversational Hinglish (Hindi mixed with English, using female grammar) for this opening. Return spoken text only."
            })
            
        print(f"[PEARL LLM] Sending {len(messages)} messages. Roles: {[m['role'] for m in messages]}")

        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.groq_api_key}",
            "Content-Type": "application/json"
        }
        data = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "temperature": 0.7,
            "max_tokens": 150,  # Allow slightly longer dynamic answers
        }
        
        client = _get_llm_client()
        try:
            async with client.stream("POST", url, json=data, headers=headers) as response:
                if response.status_code != 200:
                    await response.aread()
                    print(f"[Pearl LLM] HTTP error: {response.status_code} - {response.text}")
                    yield "I apologize, let me get back to you on that."
                    return
                    
                async for chunk in response.aiter_text():
                    for line in chunk.split("\n"):
                        if line.startswith("data: ") and line != "data: [DONE]":
                            try:
                                payload = json.loads(line[6:])
                                delta = payload["choices"][0]["delta"].get("content", "")
                                if delta:
                                    yield delta
                            except (json.JSONDecodeError, KeyError, IndexError):
                                pass
        except Exception as e:
            print(f"[Pearl LLM] Error: {e}")
            yield "I apologize, let me get back to you on that."

    def analyze_latest_turn(self, prospect_text: str) -> Dict[str, Any]:
        """
        Analyze the most recent prospect message for signals.
        Lightweight keyword match — does not block the critical path.
        """
        lower = prospect_text.lower()
        signals = []
        objections = []
        
        if "not interested" in lower or "hang up" in lower or "don't call" in lower:
            objections.append("not_interested")
        if "price" in lower or "expensive" in lower or "cost" in lower or "budget" in lower:
            objections.append("pricing")
        if "already have" in lower or "using" in lower:
            objections.append("competitor")
        if "call back" in lower or "later" in lower or "busy" in lower:
            objections.append("timing")
            
        if "demo" in lower or "show me" in lower or "meeting" in lower or "schedule" in lower:
            signals.append("meeting_interest")
        if "how does it work" in lower or "tell me more" in lower or "interested" in lower:
            signals.append("curiosity")
        if "send" in lower and ("email" in lower or "info" in lower):
            signals.append("info_request")
            
        return {
            "intent": "unknown",
            "signals": signals,
            "objections": objections,
            "qualification_updates": {}
        }
