import asyncio
import os
import json
import base64
import httpx
from typing import AsyncGenerator
import websockets

from .elevenlabs_provider import _get_tts_client, ElevenLabsTTSProvider as OldElevenLabsProvider

class TTSProvider:
    """
    Stateful TTS Provider interface supporting streaming audio generation.
    """
    async def connect(self):
        """Establish connection (e.g. WebSocket)."""
        pass

    async def configure(self, language_code: str, speaker: str, pace: float, temperature: float):
        """Configure the TTS parameters for the session."""
        pass

    async def send_text(self, text: str):
        """Send text chunk for synthesis."""
        pass

    async def flush(self):
        """Signal end of text input (flush buffers)."""
        pass

    async def receive_audio(self) -> AsyncGenerator[bytes, None]:
        """Yield audio chunks as they arrive."""
        yield b"" # Yield empty byte to satisfy type checker if not yielding in base class

    async def close(self):
        """Close connection."""
        pass

    async def cancel(self):
        """Cancel current synthesis."""
        pass


class ElevenLabsTTSProvider(TTSProvider):
    """
    ElevenLabs fallback wrapper conforming to the new stateful TTSProvider interface.
    """
    def __init__(self):
        self.provider = OldElevenLabsProvider()
        self._queue = asyncio.Queue()
        self._cancel_event = asyncio.Event()

    async def send_text(self, text: str):
        if text and not self._cancel_event.is_set():
            self._queue.put_nowait(text)

    async def flush(self):
        if not self._cancel_event.is_set():
            self._queue.put_nowait(None)  # EOF marker

    async def receive_audio(self) -> AsyncGenerator[bytes, None]:
        while True:
            text = await self._queue.get()
            if text is None:
                break
            if self._cancel_event.is_set():
                continue
            
            try:
                async for chunk in self.provider.stream(text):
                    if self._cancel_event.is_set():
                        break
                    yield chunk
            except Exception as e:
                print(f"[ElevenLabs] error: {e}")

    async def cancel(self):
        self._cancel_event.set()
        # Drain the queue
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break

    async def close(self):
        await self.cancel()


VALID_SARVAM_WS_SPEAKERS = {
    "aditya", "ritu", "ashutosh", "priya", "neha", "rahul", "pooja", "rohan",
    "simran", "kavya", "amit", "dev", "ishita", "shreya", "ratan", "varun",
    "manan", "sumit", "roopa", "kabir", "aayan", "shubh", "advait", "anand",
    "tanya", "tarun", "sunny", "mani", "gokul", "vijay", "shruti", "suhani",
    "mohit", "kavitha", "rehan", "soham", "rupali"
}

def get_sarvam_ws_speaker(speaker: str | None) -> str:
    """
    Extract a valid base speaker accepted by Sarvam WebSocket API.
    Strips persona descriptors (e.g. 'shubh_enhi_ads' -> 'shubh', 'ritu_hi_customer' -> 'ritu').
    """
    if not speaker:
        return "shubh"
    base = speaker.strip().lower().split("_")[0]
    if base in VALID_SARVAM_WS_SPEAKERS:
        return base
    return "shubh"


class SarvamTTSProvider(TTSProvider):
    """
    Sarvam Bulbul TTS Provider.
    Maintains a persistent WebSocket connection with low-latency direct chunk decoding
    and network-idle turn boundary detection.
    """
    def __init__(self):
        self.api_key = os.getenv("SARVAM_API_KEY")
        if not self.api_key:
            print("WARNING: SARVAM_API_KEY not found in environment.")
        self.ws = None
        self._cancel_event = asyncio.Event()
        self._flush_requested = False
        self._last_language_code = "hi-IN"
        self._last_speaker = "shubh"
        self._last_pace = 1.0
        self._last_temperature = 0.6
        self._mp3_buffer = b""
        self._last_yielded_len = 0

    async def connect(self):
        if not self.api_key:
            return
            
        url = "wss://api.sarvam.ai/text-to-speech/ws"
        headers = {"api-subscription-key": self.api_key}
        
        try:
            self.ws = await websockets.connect(url, extra_headers=headers)
        except Exception as e:
            print(f"[SarvamTTS] Connection failed: {e}")
            self.ws = None
            raise

    async def configure(self, language_code: str = "hi-IN", speaker: str = "shubh", pace: float = 1.0, temperature: float = 0.6):
        if not self.ws:
            return
            
        ws_speaker = get_sarvam_ws_speaker(speaker)
        actual_lang = language_code
        if actual_lang in ["Auto", None, ""]:
            actual_lang = "en-IN" if "_en_" in speaker else "hi-IN"

        self._last_language_code = actual_lang
        self._last_speaker = ws_speaker
        self._last_pace = pace
        self._last_temperature = temperature

        config = {
            "type": "config",
            "data": {
                "language_code": actual_lang,
                "speaker": ws_speaker,
                "pace": pace,
                "temperature": temperature,
                "sample_rate": 8000,
                "enable_events": True
            }
        }
        print(f"[TTS] Configuring Sarvam TTS stream (speaker: {ws_speaker}, lang: {actual_lang})")
        await self.ws.send(json.dumps(config))

    async def flush(self):
        if not self.ws or self._cancel_event.is_set():
            return
            
        self._flush_requested = True
        payload = {"type": "flush"}
        try:
            await self.ws.send(json.dumps(payload))
        except Exception:
            pass

    async def receive_audio(self) -> AsyncGenerator[bytes, None]:
        if not self.ws:
            return
            
        try:
            first_chunk_received = False
            self._mp3_buffer = b""
            self._last_yielded_len = 0
            import miniaudio

            while True:
                # If a flush was requested and audio has started arriving, detect turn end on 350ms network idle
                timeout = 0.35 if (self._flush_requested and first_chunk_received) else None
                try:
                    if timeout:
                        message = await asyncio.wait_for(self.ws.recv(), timeout=timeout)
                    else:
                        message = await self.ws.recv()
                except asyncio.TimeoutError:
                    if self._flush_requested:
                        self._flush_requested = False
                        first_chunk_received = False
                        self._mp3_buffer = b""
                        self._last_yielded_len = 0
                        yield b"__FLUSH_COMPLETE__"
                    continue

                # If we were cancelled during this turn, drop audio
                if self._cancel_event.is_set():
                    self._mp3_buffer = b""
                    self._last_yielded_len = 0
                    continue

                if isinstance(message, str):
                    data = json.loads(message)
                    if data.get("type") == "audio" and "data" in data and "audio" in data["data"]:
                        audio_b64 = data["data"]["audio"]
                        audio_bytes = base64.b64decode(audio_b64)
                        
                        pcm_bytes = b""

                        # 1. Fast-path: decode this chunk standalone (zero buffer accumulation)
                        try:
                            decoded = miniaudio.decode(audio_bytes, nchannels=1, sample_rate=8000)
                            pcm_bytes = bytes(decoded.samples)
                            self._mp3_buffer = b""
                            self._last_yielded_len = 0
                        except Exception:
                            # 2. Chunk spans MP3 frame boundary: append to stream buffer
                            self._mp3_buffer += audio_bytes
                            try:
                                decoded = miniaudio.decode(self._mp3_buffer, nchannels=1, sample_rate=8000)
                                all_pcm = bytes(decoded.samples)
                                if len(all_pcm) > self._last_yielded_len:
                                    pcm_bytes = all_pcm[self._last_yielded_len:]
                                    self._last_yielded_len = len(all_pcm)
                                    
                                if len(self._mp3_buffer) > 16384:
                                    self._mp3_buffer = b""
                                    self._last_yielded_len = 0
                            except Exception:
                                pass
                        
                        if pcm_bytes:
                            if not first_chunk_received:
                                print(f"[TTS] First audio chunk received")
                                first_chunk_received = True
                                
                            yield pcm_bytes
                    elif data.get("type") == "error":
                        print(f"[SarvamTTS] Error received: {data}")
                    elif data.get("type") == "flush_complete":
                        self._flush_requested = False
                        first_chunk_received = False
                        self._mp3_buffer = b""
                        self._last_yielded_len = 0
                        yield b"__FLUSH_COMPLETE__"
                else:
                    # binary message (raw audio)
                    if not first_chunk_received:
                        print(f"[TTS] First audio chunk received")
                        first_chunk_received = True
                    yield message
        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            print(f"[SarvamTTS] Receive error: {e}")

    async def send_text(self, text: str):
        if not self.ws or not text:
            return
            
        if getattr(self.ws, 'closed', False):
            print(f"[SarvamTTS] WebSocket closed. Reconnecting to send text...")
            await self.connect()
            await self.configure(
                language_code=getattr(self, '_last_language_code', 'hi-IN'),
                speaker=getattr(self, '_last_speaker', 'shubh'),
                pace=getattr(self, '_last_pace', 1.0),
                temperature=getattr(self, '_last_temperature', 0.6)
            )
            
        if self._cancel_event.is_set():
            self._cancel_event.clear()
            
        payload = {
            "type": "text",
            "data": {
                "text": text
            }
        }
        try:
            await self.ws.send(json.dumps(payload))
        except websockets.exceptions.ConnectionClosed:
            print(f"[SarvamTTS] WebSocket closed during send. Reconnecting...")
            await self.connect()
            await self.configure(
                language_code=getattr(self, '_last_language_code', 'hi-IN'),
                speaker=getattr(self, '_last_speaker', 'shubh'),
                pace=getattr(self, '_last_pace', 1.0),
                temperature=getattr(self, '_last_temperature', 0.6)
            )
            await self.ws.send(json.dumps(payload))

    async def cancel(self):
        self._cancel_event.set()
        self._flush_requested = False
        self._mp3_buffer = b""
        self._last_yielded_len = 0

    async def close(self):
        if self.ws:
            await self.ws.close()
            self.ws = None

    def reset_buffer(self):
        self._mp3_buffer = b""
        self._last_yielded_len = 0
        self._flush_requested = False


def get_tts_provider() -> TTSProvider:
    provider_name = os.getenv("PEARL_TTS_PROVIDER", "sarvam").lower()
    
    if provider_name == "sarvam" and os.getenv("SARVAM_API_KEY"):
        return SarvamTTSProvider()
    return ElevenLabsTTSProvider()
