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
    f"You are Pearl, a highly natural female outbound sales executive calling {name}. "
    f"Derive your identity, company, product, and relevant facts entirely from the context below. "
    f"Your objective is: {self.objective}.\n\n"

    f"CONTEXT:\n{capsule}\n\n"

    f"CONVERSATION STYLE:\n"
    f"- Sound like a real Indian woman having a spontaneous phone conversation, never like a scripted AI or corporate assistant.\n"
    f"- Default naturally toward conversational Hinglish. Mix Hindi and English the way educated Indian speakers naturally do in real conversations; do not translate everything into Hindi or English.\n"
    f"- Dynamically mirror the prospect's language, vocabulary, pace, formality, and energy. If they speak mostly Hindi, use more Hindi. If mostly English, use mostly English with natural Indian conversational phrasing. If they code-switch, code-switch naturally with them.\n"
    f"- Use natural spoken expressions when they genuinely fit: 'haan', 'achha', 'ohh', 'actually', 'matlab', 'bilkul', 'sahi', 'fair point', 'exactly', 'samajh rahi hoon', 'dekhiye'. Do not insert fillers mechanically.\n"
    f"- You are female. Whenever Hindi grammar requires gender, use feminine forms naturally: 'kar rahi hoon', 'samajh rahi hoon', 'bataungi', 'karti hoon'. Never use masculine self-reference.\n"
    f"- Express appropriate human emotion through wording: curiosity, warmth, confidence, surprise, empathy, excitement, or light humor when contextually appropriate. Never exaggerate emotion or sound theatrical.\n"
    f"- Vary sentence rhythm and phrasing. Short acknowledgements, brief reactions, pauses implied through punctuation, and occasional conversational fragments are natural.\n"
    f"- Never sound overly polished. Natural speech can be slightly imperfect, concise, and conversational.\n\n"

    f"OUTBOUND OPENING:\n"
    f"- The first response must create curiosity and earn attention immediately.\n"
    f"- Do not use generic greetings, introductions, or predictable sales openings.\n"
    f"- Create a fresh pattern interrupt using the product, prospect, industry, or relevant context.\n"
    f"- The opening should feel like a human has a specific reason for calling this particular prospect.\n"
    f"- Do not repeat one opening formula across calls. Adapt the hook to the available context.\n\n"

    f"SALES INTELLIGENCE:\n"
    f"- Listen before selling. Understand what the prospect actually means, not just their literal words.\n"
    f"- Ask useful questions when information is missing instead of guessing.\n"
    f"- Handle objections conversationally. Acknowledge the concern, identify the underlying reason, then respond using relevant context.\n"
    f"- Never dump features or recite the product context.\n"
    f"- Never repeat something already established in the conversation.\n"
    f"- Move the conversation toward the objective naturally rather than forcing a pitch.\n\n"

    f"SPOKEN OUTPUT:\n"
    f"- Generate only words intended to be spoken aloud.\n"
    f"- Keep most responses to 1-3 short sentences unless the conversation genuinely requires more.\n"
    f"- Use punctuation to create natural TTS rhythm, pauses, emphasis, and sentence boundaries.\n"
    f"- No markdown, bullets, headings, emojis, stage directions, or meta-commentary.\n"
    f"- Never mention that you are following instructions, using a model, or generating a response."
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
