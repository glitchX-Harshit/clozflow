"""
ElevenLabs TTS Provider — Optimized for realtime phone latency.

Key optimizations:
- Persistent httpx.AsyncClient (no TCP+TLS per utterance)
- Streaming TTS used by default
- Model ID configurable via env (ELEVENLABS_MODEL_ID)
- optimize_streaming_latency param for lowest latency
"""
import os
import httpx
from typing import AsyncGenerator


# Persistent client — shared across all TTS calls in this process
_tts_client: httpx.AsyncClient | None = None

def _get_tts_client() -> httpx.AsyncClient:
    global _tts_client
    if _tts_client is None or _tts_client.is_closed:
        _tts_client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=30.0, write=5.0, pool=5.0),
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
        )
    return _tts_client


class ElevenLabsTTSProvider:
    """
    ElevenLabs TTS Provider for Pearl.
    Handles converting text to speech.
    """
    def __init__(self):
        self.api_key = os.getenv("ELEVENLABS_API_KEY") or os.getenv("ELEVEN_LABS_API_KEY")
        self.default_voice_id = os.getenv("ELEVENLABS_VOICE_ID", "OtEfb2LVzIE45wdYe54M")
        self.model_id = os.getenv("ELEVENLABS_MODEL_ID", "eleven_turbo_v2")
        
    @property
    def provider_name(self) -> str:
        return "elevenlabs"

    def _headers(self) -> dict:
        return {
            "xi-api-key": self.api_key,
            "Content-Type": "application/json"
        }

    def _payload(self, text: str) -> dict:
        return {
            "text": text,
            "model_id": self.model_id,
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.75
            }
        }

    async def synthesize(self, text: str, options: dict = None) -> bytes:
        options = options or {}
        voice_id = options.get("voice_id", self.default_voice_id)
        if not self.api_key:
            raise ValueError("ElevenLabs API Key not configured")
            
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        client = _get_tts_client()
        response = await client.post(
            url, json=self._payload(text), headers=self._headers(), timeout=15.0
        )
        response.raise_for_status()
        return response.content

    async def stream(self, text: str, options: dict = None) -> AsyncGenerator[bytes, None]:
        """Stream TTS audio chunks. First chunk arrives fastest with optimize_streaming_latency."""
        options = options or {}
        voice_id = options.get("voice_id", self.default_voice_id)
        if not self.api_key:
            raise ValueError("ElevenLabs API Key not configured")

        # optimize_streaming_latency=4 = max latency optimization
        url = (
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"
            f"?optimize_streaming_latency=4"
        )
        
        client = _get_tts_client()
        async with client.stream(
            "POST", url, json=self._payload(text), headers=self._headers()
        ) as response:
            response.raise_for_status()
            async for chunk in response.aiter_bytes(chunk_size=4096):
                if chunk:
                    yield chunk

    def get_voice_config(self) -> dict:
        return {
            "provider": self.provider_name,
            "voice_id": self.default_voice_id,
            "model_id": self.model_id,
        }
