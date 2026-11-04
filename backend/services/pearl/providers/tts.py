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
    "aakash", "aayan", "aditi", "aditya", "advait", "alok", "amit", "anand",
    "ananya", "aniket", "anoop", "anusha", "anushka", "arjun", "ashutosh",
    "baljeet", "bhavani", "bhavna", "biju", "biswajit", "chetan", "chirag",
    "debasish", "deepa", "deepak", "dev", "divya", "gokul", "gurpreet",
    "hansa", "harish", "harpreet", "ishita", "jaswinder", "jatin", "kabir",
    "karthik", "kavitha", "kavya", "ketan", "lakshmi", "lipsa", "madhav",
    "manan", "mani", "manjula", "mohit", "neha", "pooja", "poulomi",
    "pradeep", "priya", "raghu", "rahul", "rajesh", "ratan", "rehan",
    "remya", "ritu", "rohan", "roopa", "rupali", "sai", "selvi",
    "shreya", "shruti", "shubh", "simran", "simranjit", "soham", "sourav",
    "sreeja", "srinivas", "subhash", "subrat", "suhani", "sumit", "sunita",
    "sunny", "swapna", "swati", "tanima", "tanvi", "tanya", "tarun",
    "varun", "vijay"
}

def normalize_sarvam_v4_speaker(speaker: str | None) -> str:
    """
    Ensure a valid persona ID for Sarvam Bulbul v4 Flash (e.g. 'shubh_enhi_ads', 'ritu_hi_customer').
    If a legacy short name is passed (e.g. 'shubh'), maps to its primary v4 persona.
    """
    if not speaker:
        return "shubh_enhi_ads"
    sp = speaker.strip().lower()
    if "_" in sp:
        return sp
    # Legacy short name fallbacks
    if sp in ["shubh", "rohan", "rahul", "dev", "kabir", "sumit", "tarun", "aayan", "aditya", "alok"]:
        return f"{sp}_enhi_ads"
    if sp in ["ritu", "priya", "pooja", "neha", "shruti", "rupali", "aditi"]:
        return f"{sp}_hi_customer"
    if sp in ["simran", "kavya", "ishita", "shreya", "anushka", "divya"]:
        return f"{sp}_en_customer"
    return f"{sp}_enhi_ads"

def get_sarvam_ws_speaker(speaker: str | None) -> str:
    """
    Extract a valid persona speaker accepted by Sarvam bulbul:v4-flash WebSocket API.
    Uses expanded persona ID format (e.g. 'shubh_enhi_ads', 'ritu_hi_customer').
    """
    return normalize_sarvam_v4_speaker(speaker)


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
        self._lock = asyncio.Lock()
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
            
        async with self._lock:
            if self.ws and not getattr(self.ws, 'closed', False):
                return
            url = "wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v4-flash&send_completion_event=true"
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

        # Map language names to BCP-47 codes
        LANG_MAP = {
            "auto": None,
            "english": "en-IN",
            "indian english": "en-IN",
            "hindi": "hi-IN",
            "hinglish": "hi-IN",
            "tamil": "ta-IN",
            "telugu": "te-IN",
            "bengali": "bn-IN",
            "marathi": "mr-IN",
            "kannada": "kn-IN",
            "gujarati": "gu-IN",
            "punjabi": "pa-IN",
            "malayalam": "ml-IN",
            "odia": "od-IN",
            "assamese": "as-IN",
        }
        if actual_lang and actual_lang.lower().strip() in LANG_MAP:
            actual_lang = LANG_MAP[actual_lang.lower().strip()]

        # If language code is empty or default, infer from persona ID suffix
        if not actual_lang:
            sp_lower = (speaker or "").lower()
            if "_ta_" in sp_lower: actual_lang = "ta-IN"
            elif "_te_" in sp_lower: actual_lang = "te-IN"
            elif "_bn_" in sp_lower: actual_lang = "bn-IN"
            elif "_mr_" in sp_lower: actual_lang = "mr-IN"
            elif "_kn_" in sp_lower: actual_lang = "kn-IN"
            elif "_gu_" in sp_lower: actual_lang = "gu-IN"
            elif "_pa_" in sp_lower: actual_lang = "pa-IN"
            elif "_ml_" in sp_lower: actual_lang = "ml-IN"
            elif "_od_" in sp_lower: actual_lang = "od-IN"
            elif "_as_" in sp_lower: actual_lang = "as-IN"
            elif "_en_" in sp_lower: actual_lang = "en-IN"
            else: actual_lang = "hi-IN"

        self._last_language_code = actual_lang
        self._last_speaker = ws_speaker
        self._last_pace = pace
        self._last_temperature = temperature

        config = {
            "type": "config",
            "data": {
                "model": "bulbul:v4-flash",
                "target_language_code": actual_lang,
                "language_code": actual_lang,
                "speaker": ws_speaker,
                "pace": pace,
                "temperature": temperature,
                "speech_sample_rate": 8000,
                "sample_rate": 8000,
                "output_audio_codec": "linear16",
                "min_buffer_size": 30,
                "max_chunk_length": 150
            }
        }
        print(f"[TTS] Configuring Sarvam linear16 PCM stream (speaker: {ws_speaker}, lang: {actual_lang})")
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

            while True:
                # If flush requested, use 0.4s idle timeout as safety boundary
                timeout = 0.40 if (self._flush_requested and first_chunk_received) else None
                try:
                    if timeout:
                        message = await asyncio.wait_for(self.ws.recv(), timeout=timeout)
                    else:
                        message = await self.ws.recv()
                except asyncio.TimeoutError:
                    if self._flush_requested:
                        self._flush_requested = False
                        first_chunk_received = False
                        yield b"__FLUSH_COMPLETE__"
                    continue

                # If cancelled during this turn, discard residual audio
                if self._cancel_event.is_set():
                    continue

                if isinstance(message, str):
                    data = json.loads(message)
                    msg_type = data.get("type")

                    if msg_type == "audio" and "data" in data and "audio" in data["data"]:
                        audio_b64 = data["data"]["audio"]
                        raw_bytes = base64.b64decode(audio_b64)
                        content_type = data["data"].get("content_type", "")
                        
                        # Direct Linear16 PCM fast-path (uncompressed, lossless, zero jitter)
                        # Strip container WAV/RIFF header (first 44 bytes) if returned by provider
                        if len(raw_bytes) > 44 and raw_bytes.startswith(b"RIFF"):
                            raw_bytes = raw_bytes[44:]

                        if content_type in ("audio/pcm", "audio/x-l16", "linear16") or not (
                            raw_bytes.startswith(b"ID3") or raw_bytes.startswith(b"\xff\xfb") or raw_bytes.startswith(b"\xff\xf3")
                        ):
                            pcm_bytes = raw_bytes
                        else:
                            # Fallback if compressed MP3 frames are returned
                            try:
                                import miniaudio
                                decoded = miniaudio.decode(raw_bytes, nchannels=1, sample_rate=8000)
                                pcm_bytes = bytes(decoded.samples)
                            except Exception:
                                pcm_bytes = raw_bytes
                        
                        if pcm_bytes and not self._cancel_event.is_set():
                            if not first_chunk_received:
                                print(f"[TTS] First audio chunk received ({len(pcm_bytes)} bytes PCM)")
                                first_chunk_received = True
                                
                            yield pcm_bytes

                    elif msg_type == "event":
                        event_type = data.get("data", {}).get("event_type")
                        if event_type in ("final", "flush_complete", "completion"):
                            self._flush_requested = False
                            first_chunk_received = False
                            yield b"__FLUSH_COMPLETE__"

                    elif msg_type == "flush_complete":
                        self._flush_requested = False
                        first_chunk_received = False
                        yield b"__FLUSH_COMPLETE__"

                    elif msg_type == "error":
                        print(f"[SarvamTTS] Error received: {data}")

                else:
                    # Raw binary message
                    if not self._cancel_event.is_set():
                        if not first_chunk_received:
                            print(f"[TTS] First audio chunk received ({len(message)} bytes)")
                            first_chunk_received = True
                        yield message

        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            print(f"[SarvamTTS] Receive error: {e}")

    async def _reconnect_warmup(self):
        """Warm up fresh connection in background after cancellation so next turn starts instantly."""
        try:
            await self.connect()
            await self.configure(
                language_code=getattr(self, '_last_language_code', 'hi-IN'),
                speaker=getattr(self, '_last_speaker', 'shubh'),
                pace=getattr(self, '_last_pace', 1.0),
                temperature=getattr(self, '_last_temperature', 0.6)
            )
            # Note: _cancel_event is intentionally NOT cleared here.
            # It will be cleanly cleared when the next turn begins in send_text().
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[SarvamTTS] Background reconnect warmup error: {e}")

    async def send_text(self, text: str):
        if not text:
            return
            
        if not self.ws or getattr(self.ws, 'closed', False):
            print(f"[SarvamTTS] Connecting fresh WebSocket to send text...")
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
        """Instantly kill server synthesis, close active socket, and warm a fresh connection in background."""
        self._cancel_event.set()
        self._flush_requested = False
        self._mp3_buffer = b""
        self._last_yielded_len = 0
        if hasattr(self, '_warmup_task') and self._warmup_task and not self._warmup_task.done():
            self._warmup_task.cancel()
        if self.ws:
            try:
                await self.ws.close()
            except Exception:
                pass
            self.ws = None
        # Warm up fresh connection immediately in background while user speaks
        self._warmup_task = asyncio.create_task(self._reconnect_warmup())

    async def close(self):
        self._cancel_event.set()
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
