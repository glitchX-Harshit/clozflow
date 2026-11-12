"""
ElevenLabs TTS Provider — Optimized for realtime phone latency.

Key optimizations:
- Persistent httpx.AsyncClient (no TCP+TLS per utterance)
- Streaming TTS used by default
- Raw PCM requested via ``output_format`` (default ``pcm_8000`` = 16-bit LE mono 8 kHz,
  what the Pearl telephony and browser pipelines play) instead of the MP3 default
- Configuration read through ``elevenlabs_settings()`` only (see below)

Environment (first non-empty name wins):
    API key   ELEVENLABS_API_KEY, ELEVEN_LABS_API_KEY
    voice id  ELEVENLABS_VOICE_ID, ELEVEN_LABS_VOICE_ID
    model id  ELEVENLABS_MODEL_ID, ELEVEN_LABS_MODEL_ID   (default eleven_turbo_v2)
"""
import os
import httpx
from typing import AsyncGenerator, Optional

DEFAULT_VOICE_ID = "OtEfb2LVzIE45wdYe54M"
DEFAULT_MODEL_ID = "eleven_turbo_v2"
DEFAULT_OUTPUT_FORMAT = "pcm_8000"
API_BASE_URL = "https://api.elevenlabs.io"


def _first_env(*names: str) -> Optional[str]:
    for name in names:
        value = (os.getenv(name) or "").strip()
        if value:
            return value
    return None


def elevenlabs_api_key() -> Optional[str]:
    """The ElevenLabs key: ELEVENLABS_API_KEY, falling back to the older ELEVEN_LABS_API_KEY."""
    return _first_env("ELEVENLABS_API_KEY", "ELEVEN_LABS_API_KEY")


def elevenlabs_settings() -> dict:
    return {
        "api_key": elevenlabs_api_key(),
        "voice_id": _first_env("ELEVENLABS_VOICE_ID", "ELEVEN_LABS_VOICE_ID") or DEFAULT_VOICE_ID,
        "model_id": _first_env("ELEVENLABS_MODEL_ID", "ELEVEN_LABS_MODEL_ID") or DEFAULT_MODEL_ID,
    }


def elevenlabs_configured() -> bool:
    return bool(elevenlabs_api_key())


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
        settings = elevenlabs_settings()
        self.api_key = settings["api_key"]
        self.default_voice_id = settings["voice_id"]
        self.model_id = settings["model_id"]

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
        output_format = options.get("output_format", DEFAULT_OUTPUT_FORMAT)
        if not self.api_key:
            raise ValueError("ElevenLabs API Key not configured")

        url = f"{API_BASE_URL}/v1/text-to-speech/{voice_id}"
        client = _get_tts_client()
        response = await client.post(
            url, params={"output_format": output_format}, json=self._payload(text),
            headers=self._headers(), timeout=15.0
        )
        response.raise_for_status()
        return response.content

    async def stream(self, text: str, options: dict = None) -> AsyncGenerator[bytes, None]:
        """Stream TTS audio chunks in ``options['output_format']`` (default pcm_8000)."""
        options = options or {}
        voice_id = options.get("voice_id", self.default_voice_id)
        output_format = options.get("output_format", DEFAULT_OUTPUT_FORMAT)
        if not self.api_key:
            raise ValueError("ElevenLabs API Key not configured")

        url = f"{API_BASE_URL}/v1/text-to-speech/{voice_id}/stream"
        client = _get_tts_client()
        async with client.stream(
            "POST", url, params={"output_format": output_format}, json=self._payload(text), headers=self._headers()
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
