import asyncio
import logging
import os
import json
import base64
import httpx
from typing import AsyncGenerator
import websockets
from websockets.protocol import State

from .elevenlabs_provider import (
    _get_tts_client, ElevenLabsTTSProvider as OldElevenLabsProvider, elevenlabs_configured,
)

logger = logging.getLogger(__name__)

FLUSH_COMPLETE = b"__FLUSH_COMPLETE__"
# Internal: a provider asked to report_errors yields this when a turn failed on its side
# (error event / HTTP error). FailoverTTSProvider consumes it; it never reaches a pipeline.
TTS_ERROR = b"__TTS_ERROR__"
_CLOSE_SENTINEL = object()

# Every Pearl audio consumer plays 16-bit little-endian mono PCM at 8 kHz: the browser voice
# test downlink and the carrier socket (Vobiz playAudio audio/x-l16 @ 8000, Exotel media).
PIPELINE_SAMPLE_RATE = 8000


def decode_to_pcm16(data: bytes, sample_rate: int = PIPELINE_SAMPLE_RATE) -> bytes:
    """Decode compressed audio (MP3/WAV/FLAC/Vorbis) to mono PCM16 LE at ``sample_rate``."""
    try:
        import miniaudio
    except ImportError:
        logger.error("[TTS] Got compressed audio but miniaudio is not installed; cannot decode it")
        return b""
    try:
        decoded = miniaudio.decode(
            data, output_format=miniaudio.SampleFormat.SIGNED16, nchannels=1, sample_rate=sample_rate
        )
        samples = decoded.samples
        return samples.tobytes() if hasattr(samples, "tobytes") else bytes(samples)
    except Exception as exc:
        logger.warning("[TTS] Could not decode compressed audio: %s", exc)
        return b""


def _looks_compressed(head: bytes) -> bool:
    return head.startswith((b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2", b"OggS", b"fLaC"))


def _strip_wav_header(data: bytes) -> bytes:
    """Return the PCM payload of a WAV blob (or the input unchanged if it isn't one)."""
    if not data.startswith(b"RIFF"):
        return data
    idx = data.find(b"data", 12)
    if idx < 0 or len(data) < idx + 8:
        return data[44:] if len(data) > 44 else b""
    return data[idx + 8:]


class TTSProvider:
    """
    Stateful TTS Provider interface supporting streaming audio generation.

    Contract: ``receive_audio()`` is ONE long-lived stream for the whole session. It
    yields PCM chunks and ``FLUSH_COMPLETE`` at the end of each turn, and keeps
    yielding across turns, ``cancel()`` (barge-in) and reconnects. It only ends after
    ``close()``.
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
    ElevenLabs wrapper conforming to the stateful TTSProvider interface.

    Requests raw PCM at the pipelines' rate (``pcm_8000``: 16-bit LE mono 8 kHz) and always
    yields whole samples (even-length chunks). If ElevenLabs still answers with a compressed
    stream (e.g. MP3), the phrase is decoded with miniaudio to mono PCM16 at that rate.
    ElevenLabs speaks with its configured voice (ELEVENLABS_VOICE_ID); Sarvam persona ids
    passed to ``configure()`` don't apply to it.
    """
    output_format = f"pcm_{PIPELINE_SAMPLE_RATE}"
    sample_rate = PIPELINE_SAMPLE_RATE

    def __init__(self):
        self.provider = OldElevenLabsProvider()
        self._queue = asyncio.Queue()
        self._cancel_event = asyncio.Event()
        self._closed = False
        self.report_errors = False

    async def send_text(self, text: str):
        if not text or self._closed:
            return
        # A new turn starts after a barge-in: accept text again (same as Sarvam).
        if self._cancel_event.is_set():
            self._cancel_event.clear()
        self._queue.put_nowait(text)

    async def flush(self):
        if not self._cancel_event.is_set() and not self._closed:
            self._queue.put_nowait(None)  # end-of-turn marker

    def _stopped(self) -> bool:
        return self._cancel_event.is_set() or self._closed

    async def _synthesize(self, text: str) -> AsyncGenerator[bytes, None]:
        """One phrase -> even-length PCM16 chunks at ``sample_rate``."""
        carry = b""
        compressed = None  # decided on the first bytes of the response
        buffered = []
        async for chunk in self.provider.stream(text, {"output_format": self.output_format}):
            if self._stopped():
                return
            if not chunk:
                continue
            if compressed is None:
                compressed = _looks_compressed(chunk)
                if not compressed and chunk.startswith(b"RIFF"):
                    chunk = _strip_wav_header(chunk)
            if compressed:
                buffered.append(chunk)
                continue
            data = carry + chunk
            usable = len(data) - (len(data) % 2)
            carry = data[usable:]
            if usable:
                yield data[:usable]
        if compressed and buffered and not self._stopped():
            pcm = decode_to_pcm16(b"".join(buffered), self.sample_rate)
            for i in range(0, len(pcm), 3200):
                yield pcm[i:i + 3200]

    async def receive_audio(self) -> AsyncGenerator[bytes, None]:
        # One stream for the whole session: end-of-turn yields FLUSH_COMPLETE and the
        # loop keeps serving later turns (it used to stop after the first turn).
        while not self._closed:
            text = await self._queue.get()
            if text is _CLOSE_SENTINEL or self._closed:
                break
            if text is None:
                if not self._cancel_event.is_set():
                    yield FLUSH_COMPLETE
                continue
            if self._cancel_event.is_set():
                continue

            try:
                async for chunk in self._synthesize(text):
                    if self._stopped():
                        break
                    yield chunk
            except Exception as e:
                logger.warning("[ElevenLabs] stream error: %s", e)
                if self.report_errors and not self._stopped():
                    yield TTS_ERROR

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
        self._closed = True
        self._queue.put_nowait(_CLOSE_SENTINEL)


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
            logger.warning("SARVAM_API_KEY not found in environment.")
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
        self._closed = False
        self._ws_ready = asyncio.Event()  # set while self.ws is an open socket
        self._warmup_task = None
        self.report_errors = False

    async def connect(self):
        if not self.api_key or self._closed:
            return

        async with self._lock:
            if self.ws and self.ws.state is State.OPEN:
                self._ws_ready.set()
                return
            url = "wss://api.sarvam.ai/text-to-speech/ws?model=bulbul:v4-flash&send_completion_event=true"
            headers = {"api-subscription-key": self.api_key}

            try:
                self.ws = await websockets.connect(url, additional_headers=headers)
                self._ws_ready.set()
            except Exception as e:
                logger.warning("[SarvamTTS] Connection failed: %s", e)
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
        logger.debug("[TTS] Configuring Sarvam linear16 PCM stream (speaker: %s, lang: %s)", ws_speaker, actual_lang)
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
        """
        Session-long audio stream. ``cancel()`` (barge-in) closes the current Sarvam
        socket and warms up a new one; this generator then waits for the new socket
        and keeps yielding. (It used to return on the closed socket, so every consumer
        that iterated it once - e.g. the browser voice test - went silent after the
        first interruption.)
        """
        first_chunk_received = False
        self._mp3_buffer = b""
        self._last_yielded_len = 0

        while not self._closed:
            ws = self.ws
            if ws is None or ws.state is not State.OPEN:
                # No usable socket (cancelled, dropped, not yet connected): wait for the
                # next connect(). No await between the check and clear(), so a connect
                # that completes meanwhile cannot be missed.
                self._ws_ready.clear()
                ws = self.ws
                if ws is None or ws.state is not State.OPEN:
                    first_chunk_received = False
                    await self._ws_ready.wait()
                continue

            # If flush requested, use 0.4s idle timeout as safety boundary
            timeout = 0.40 if (self._flush_requested and first_chunk_received) else None
            try:
                if timeout:
                    message = await asyncio.wait_for(ws.recv(), timeout=timeout)
                else:
                    message = await ws.recv()
            except asyncio.TimeoutError:
                if self._flush_requested:
                    self._flush_requested = False
                    first_chunk_received = False
                    yield FLUSH_COMPLETE
                continue
            except websockets.exceptions.ConnectionClosed:
                # Socket closed by cancel()/close() or by the server: drop it and wait
                # for a reconnect instead of ending the stream.
                if self.ws is ws:
                    self.ws = None
                continue
            except Exception as e:
                logger.warning("[SarvamTTS] Receive error: %s", e)
                if self.ws is ws:
                    self.ws = None
                continue

            # If cancelled during this turn, discard residual audio
            if self._cancel_event.is_set():
                continue

            if isinstance(message, str):
                try:
                    data = json.loads(message)
                except ValueError:
                    continue
                msg_type = data.get("type")

                if msg_type == "audio" and isinstance(data.get("data"), dict) and "audio" in data["data"]:
                    audio_b64 = data["data"]["audio"]
                    try:
                        raw_bytes = base64.b64decode(audio_b64)
                    except (ValueError, TypeError):
                        continue
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
                            logger.debug("[TTS] First audio chunk received (%d bytes PCM)", len(pcm_bytes))
                            first_chunk_received = True
                        yield pcm_bytes

                elif msg_type == "event":
                    event_type = (data.get("data") or {}).get("event_type")
                    if event_type in ("final", "flush_complete", "completion"):
                        self._flush_requested = False
                        first_chunk_received = False
                        yield FLUSH_COMPLETE

                elif msg_type == "flush_complete":
                    self._flush_requested = False
                    first_chunk_received = False
                    yield FLUSH_COMPLETE

                elif msg_type == "error":
                    logger.warning("[SarvamTTS] Error event received from provider")
                    if self.report_errors:
                        yield TTS_ERROR

            else:
                # Raw binary message
                if not self._cancel_event.is_set():
                    if not first_chunk_received:
                        logger.debug("[TTS] First audio chunk received (%d bytes)", len(message))
                        first_chunk_received = True
                    yield message

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
            logger.warning("[SarvamTTS] Background reconnect warmup error: %s", e)

    async def send_text(self, text: str):
        if not text or self._closed:
            return

        # A barge-in warm-up may still be connecting: let it finish instead of racing it
        # with a second connect()/configure().
        warmup = self._warmup_task
        if warmup is not None and not warmup.done():
            try:
                await asyncio.wait_for(asyncio.shield(warmup), timeout=5.0)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                pass

        if not self.ws or self.ws.state is not State.OPEN:
            logger.debug("[SarvamTTS] Connecting fresh WebSocket to send text")
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
        except (websockets.exceptions.ConnectionClosed, AttributeError):
            logger.debug("[SarvamTTS] WebSocket closed during send. Reconnecting")
            self.ws = None
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
        if self._warmup_task and not self._warmup_task.done():
            self._warmup_task.cancel()
        ws, self.ws = self.ws, None
        self._ws_ready.clear()
        if ws:
            try:
                await ws.close()
            except Exception:
                pass
        if self._closed:
            return
        # Warm up fresh connection immediately in background while user speaks
        self._warmup_task = asyncio.create_task(self._reconnect_warmup())

    async def close(self):
        self._closed = True
        self._cancel_event.set()
        if self._warmup_task and not self._warmup_task.done():
            self._warmup_task.cancel()
        ws, self.ws = self.ws, None
        self._ws_ready.set()  # wake receive_audio() so it can observe _closed and end
        if ws:
            try:
                await ws.close()
            except Exception:
                pass

    def reset_buffer(self):
        self._mp3_buffer = b""
        self._last_yielded_len = 0
        self._flush_requested = False


class FailoverTTSProvider(TTSProvider):
    """
    A primary TTS provider with standbys. If the active provider fails mid-session -
    connect/configure/send/flush raising, or an error reported while speaking - the session
    switches to the next provider, applies the same configuration and re-sends the text of
    the turn in progress, while ``receive_audio()`` keeps one uninterrupted stream.
    """

    def __init__(self, *providers: TTSProvider):
        if not providers:
            raise ValueError("FailoverTTSProvider needs at least one provider")
        self._providers = list(providers)
        self._index = 0
        self._config = None
        self._turn_texts = []
        self._turn_flushed = False
        self._turn_cancelled = False
        self._closed = False
        self._lock = asyncio.Lock()
        self._llm_finished = False  # read/written by the carrier pipeline
        for provider in self._providers:
            provider.report_errors = True

    @property
    def active(self) -> TTSProvider:
        return self._providers[self._index]

    @property
    def provider_names(self):
        return [type(p).__name__ for p in self._providers]

    async def _failover(self, failed: TTSProvider, reason: str) -> bool:
        async with self._lock:
            if failed is not self.active:
                return True  # someone already switched away from it
            if self._index + 1 >= len(self._providers):
                logger.warning("[TTS] %s failed (%s) and no fallback is left", type(failed).__name__, reason)
                return False
            self._index += 1
            new = self.active
            logger.warning("[TTS] %s failed (%s); switching to %s", type(failed).__name__, reason, type(new).__name__)
            try:
                await failed.close()  # ends its receive stream so receive_audio() moves on
            except Exception:
                pass
            try:
                await new.connect()
                if self._config is not None:
                    await new.configure(**self._config)
            except Exception as exc:
                logger.warning("[TTS] Fallback %s setup failed: %s", type(new).__name__, exc)
            texts, flushed = list(self._turn_texts), self._turn_flushed
        try:
            for text in texts:
                await new.send_text(text)
            if flushed:
                await new.flush()
        except Exception as exc:
            return await self._failover(new, f"replay: {exc}")
        return True

    async def connect(self):
        while True:
            provider = self.active
            try:
                await provider.connect()
                return
            except Exception as exc:
                if not await self._failover(provider, f"connect: {exc}"):
                    raise

    async def configure(self, language_code: str = None, speaker: str = None, pace: float = 1.0, temperature: float = 0.6):
        self._config = {"language_code": language_code, "speaker": speaker, "pace": pace, "temperature": temperature}
        provider = self.active
        try:
            await provider.configure(**self._config)
        except Exception as exc:
            if not await self._failover(provider, f"configure: {exc}"):
                raise

    def _start_turn_if_needed(self):
        if self._turn_flushed or self._turn_cancelled:
            self._turn_texts = []
            self._turn_flushed = False
            self._turn_cancelled = False

    async def send_text(self, text: str):
        if not text or self._closed:
            return
        self._start_turn_if_needed()
        self._turn_texts.append(text)
        provider = self.active
        try:
            await provider.send_text(text)
        except Exception as exc:
            if not await self._failover(provider, f"send_text: {exc}"):
                raise

    async def flush(self):
        self._turn_flushed = True
        provider = self.active
        try:
            await provider.flush()
        except Exception as exc:
            if not await self._failover(provider, f"flush: {exc}"):
                raise

    async def cancel(self):
        self._turn_texts = []
        self._turn_flushed = False
        self._turn_cancelled = True
        try:
            await self.active.cancel()
        except Exception as exc:
            logger.warning("[TTS] cancel failed: %s", exc)

    def reset_buffer(self):
        self._turn_texts = []
        self._turn_flushed = False
        self._turn_cancelled = False
        reset = getattr(self.active, "reset_buffer", None)
        if callable(reset):
            reset()

    async def receive_audio(self) -> AsyncGenerator[bytes, None]:
        while not self._closed:
            provider = self.active
            try:
                async for chunk in provider.receive_audio():
                    if provider is not self.active or self._closed:
                        break  # switched to a fallback while this stream was open
                    if chunk == TTS_ERROR:
                        await self._failover(provider, "provider reported an error")
                        break
                    yield chunk
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                if provider is self.active and not await self._failover(provider, f"stream: {exc}"):
                    logger.warning("[TTS] audio stream error: %s", exc)
            if not self._closed and provider is self.active:
                await asyncio.sleep(0.02)  # the stream ended on its own; don't spin

    async def close(self):
        self._closed = True
        for provider in self._providers:
            try:
                await provider.close()
            except Exception:
                pass


def _make_tts(name: str) -> TTSProvider:
    return SarvamTTSProvider() if name == "sarvam" else ElevenLabsTTSProvider()


def get_tts_provider() -> TTSProvider:
    """
    TTS for one session. ``PEARL_TTS_PROVIDER`` (sarvam | elevenlabs, default sarvam) picks the
    primary; every other configured provider becomes a mid-session fallback. Sarvam needs
    SARVAM_API_KEY, ElevenLabs needs ELEVENLABS_API_KEY (or ELEVEN_LABS_API_KEY).
    """
    preferred = (os.getenv("PEARL_TTS_PROVIDER") or "sarvam").strip().lower()
    order = ["elevenlabs", "sarvam"] if preferred == "elevenlabs" else ["sarvam", "elevenlabs"]
    configured = {
        "sarvam": bool((os.getenv("SARVAM_API_KEY") or "").strip()),
        "elevenlabs": elevenlabs_configured(),
    }
    available = [name for name in order if configured[name]]
    if not available:
        logger.warning("No TTS provider configured (set SARVAM_API_KEY or ELEVENLABS_API_KEY)")
        return ElevenLabsTTSProvider()
    providers = [_make_tts(name) for name in available]
    return providers[0] if len(providers) == 1 else FailoverTTSProvider(*providers)
