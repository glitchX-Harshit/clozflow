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


class SarvamTTSProvider(TTSProvider):
    """
    Sarvam Bulbul v3 TTS Provider.
    Maintains a persistent WebSocket connection.
    """
    def __init__(self):
        self.api_key = os.getenv("SARVAM_API_KEY")
        if not self.api_key:
            print("WARNING: SARVAM_API_KEY not found in environment.")
        self.ws = None
        self._cancel_event = asyncio.Event()

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

    async def configure(self, language_code: str = "hi-IN", speaker = "shubh", pace: float = 1.0, temperature: float = 0.6):
        if not self.ws:
            return
            
        config = {
            "type": "config",
            "data": {
                "model": "bulbul:v3",
                "language_code": language_code,
                "speaker": speaker,
                "pace": pace,
                "temperature": temperature,
                "sample_rate": 8000,
                "enable_events": True
            }
        }
        print(f"[TTS] Request created - Configuring Sarvam TTS stream")
        await self.ws.send(json.dumps(config))

    async def flush(self):
        if not self.ws or self._cancel_event.is_set():
            return
            
        # For Sarvam, we send a flush message or EOF?
        # Actually, "EOF" usually means we are done. Let's send a ping or just let the socket drain.
        # We can send type: "flush" if it's supported by bulbul v3 or type: "eof".
        # The prompt says: "When Pearl reaches the end of the LLM response, send the Sarvam flush/end-of-speech signal"
        payload = {"type": "flush"}
        await self.ws.send(json.dumps(payload))

    async def receive_audio(self) -> AsyncGenerator[bytes, None]:
        if not self.ws:
            return
            
        try:
            first_chunk_received = False
            self._mp3_buffer = b""
            self._last_yielded_len = 0
            while True:
                message = await self.ws.recv()
                
                # If we were cancelled during this turn, drop audio
                if self._cancel_event.is_set():
                    self._mp3_buffer = b""
                    self._last_yielded_len = 0
                    continue

                if isinstance(message, str):
                    data = json.loads(message)
                    if data.get("type") == "audio" and "data" in data and "audio" in data["data"]:
                        # audio might be base64 encoded
                        audio_b64 = data["data"]["audio"]
                        audio_bytes = base64.b64decode(audio_b64)
                        
                        self._mp3_buffer += audio_bytes
                        pcm_bytes = b""
                        try:
                            import miniaudio
                            decoded = miniaudio.decode(self._mp3_buffer, nchannels=1, sample_rate=8000)
                            all_pcm = bytes(decoded.samples)
                            if len(all_pcm) > self._last_yielded_len:
                                pcm_bytes = all_pcm[self._last_yielded_len:]
                                self._last_yielded_len = len(all_pcm)
                        except Exception as e:
                            # Might fail if buffer doesn't have enough data for a valid frame yet
                            pass
                        
                        if pcm_bytes:
                            if not first_chunk_received:
                                print(f"[TTS] First audio chunk received")
                                first_chunk_received = True
                                
                            print(f"[TTS] Audio chunk size: {len(pcm_bytes)} bytes")
                            yield pcm_bytes
                    elif data.get("type") == "error":
                        print(f"[SarvamTTS] Error received: {data}")
                    elif data.get("type") == "flush_complete":
                        # We flushed successfully, yield marker
                        self._mp3_buffer = b""
                        self._last_yielded_len = 0
                        yield b"__FLUSH_COMPLETE__"
                else:
                    # binary message (raw audio)
                    if not first_chunk_received:
                        print(f"[TTS] First audio chunk received")
                        first_chunk_received = True
                    print(f"[TTS] Audio chunk size: {len(message)} bytes")
                    yield message
        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            print(f"[SarvamTTS] Receive error: {e}")

    async def send_text(self, text: str):
        if not self.ws or not text:
            return
            
        if getattr(self.ws, 'closed', False):
            print(f"[SarvamTTS] WebSocket is already closed. Reconnecting to send text...")
            await self.connect()
            await self.configure()
            
        # Un-cancel if we are sending new text for a new turn
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
            print(f"[TTS] Request accepted - Sent text for synthesis")
        except websockets.exceptions.ConnectionClosed:
            print(f"[SarvamTTS] WebSocket closed. Reconnecting to send text...")
            await self.connect()
            await self.configure()
            await self.ws.send(json.dumps(payload))
            print(f"[TTS] Reconnected and sent text for synthesis")

    async def cancel(self):
        self._cancel_event.set()
        if self.ws:
            # We can optionally send a flush or clear command if Sarvam supports it, 
            # otherwise setting the flag makes receive_audio drop packets.
            pass

    async def close(self):
        if self.ws:
            await self.ws.close()
            self.ws = None

    def reset_buffer(self):
        self._mp3_buffer = b""
        self._last_yielded_len = 0


def get_tts_provider() -> TTSProvider:
    provider_name = os.getenv("PEARL_TTS_PROVIDER", "sarvam").lower()
    
    if provider_name == "sarvam" and os.getenv("SARVAM_API_KEY"):
        return SarvamTTSProvider()
    return ElevenLabsTTSProvider()
