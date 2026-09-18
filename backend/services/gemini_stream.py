import os
import asyncio
from typing import Any
from google import genai
from google.genai import types


class GeminiStream:
    """
    Real-time streaming transcription using Google Gemini 3.5 Transcribe Live.

    Drop-in replacement for DeepgramStream. Uses the google-genai SDK's
    Live API (bidirectional WebSocket) to stream 16-bit PCM audio and
    receive transcription events.

    Auto-reconnect: Gemini Live sessions have a ~10 minute cap. When a
    session expires, this class automatically reconnects with exponential
    backoff (up to 5 attempts) so long-running sales calls are not
    interrupted.

    Interface:
        stream = GeminiStream(transcript_callback=my_callback)
        await stream.connect()
        await stream.send_audio(pcm_chunk)   # 16kHz mono linear16
        await stream.close()

    Callback signature:
        async def callback(speaker, text, is_final=True, speech_final=False)
    """

    MAX_RECONNECT_ATTEMPTS = 5
    RECONNECT_DELAY_BASE = 1.0  # seconds; doubles each attempt (1s, 2s, 4s, 8s, 16s)

    def __init__(self, transcript_callback):
        self.client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        self.session: Any = None
        self._session_ctx: Any = None
        self.transcript_callback = transcript_callback
        self._receive_task: asyncio.Task | None = None
        self._closed = False       # True after explicit close() — stops all reconnection
        self._connected = False    # True while a session is active and ready for audio

    # ──────────────────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────────────────

    async def connect(self):
        """Open the initial Gemini Live session and start the receive loop."""
        try:
            if not await self._open_session():
                return False

            # Start background receive loop (handles transcripts + auto-reconnect)
            self._receive_task = asyncio.create_task(self._receive_loop())
            return True

        except Exception as e:
            print("Exception connecting to Gemini:", e)
            return False

    async def send_audio(self, chunk):
        """Send a raw PCM audio chunk to Gemini for transcription.
        Expected format: 16-bit linear PCM, 16 kHz, mono.

        Chunks sent during a brief reconnection window are silently dropped
        to avoid errors. Transcription resumes once the new session is ready.
        """
        try:
            if self.session and self._connected:
                await self.session.send_realtime_input(
                    audio=types.Blob(
                        data=chunk,
                        mime_type="audio/pcm;rate=16000",
                    )
                )
        except Exception as e:
            print("Audio send error:", e)

    async def close(self):
        """Permanently close the Gemini Live session and cancel the receive loop.
        After calling close(), reconnection is disabled."""
        self._closed = True
        self._connected = False

        # Cancel the receive loop first
        if self._receive_task and not self._receive_task.done():
            self._receive_task.cancel()
            try:
                await self._receive_task
            except asyncio.CancelledError:
                pass

        await self._close_session()

    # ──────────────────────────────────────────────────────────────────────────
    # Session Lifecycle (internal)
    # ──────────────────────────────────────────────────────────────────────────

    async def _open_session(self):
        """Open a new Gemini Live session. Returns True on success."""
        try:
            config = types.LiveConnectConfig(
                response_modalities=["TEXT"],
                input_audio_transcription=types.AudioTranscriptionConfig(),
            )

            self._session_ctx = self.client.aio.live.connect(
                model="gemini-3.5-transcribe-live",
                config=config,
            )
            self.session = await self._session_ctx.__aenter__()
            self._connected = True

            print("Gemini transcription stream connected")
            return True

        except Exception as e:
            self._connected = False
            print("Exception connecting to Gemini:", e)
            return False

    async def _close_session(self):
        """Close the current session without marking as permanently closed.
        Safe to call even if no session is active."""
        self._connected = False
        if self._session_ctx:
            try:
                await self._session_ctx.__aexit__(None, None, None)
            except Exception:
                pass  # Session may already be closed
            self._session_ctx = None
        self.session = None

    async def _reconnect(self):
        """Attempt to reconnect with exponential backoff.

        Returns True if a new session was established, False if all retries
        failed or close() was called during reconnection.
        """
        if self._closed:
            return False

        await self._close_session()

        for attempt in range(1, self.MAX_RECONNECT_ATTEMPTS + 1):
            if self._closed:
                return False

            delay = self.RECONNECT_DELAY_BASE * (2 ** (attempt - 1))
            print(
                f"🔄 Gemini reconnect attempt {attempt}/{self.MAX_RECONNECT_ATTEMPTS} "
                f"in {delay:.1f}s..."
            )

            try:
                await asyncio.sleep(delay)
            except asyncio.CancelledError:
                return False

            if self._closed:
                return False

            if await self._open_session():
                print(f"✅ Gemini reconnected successfully (attempt {attempt})")
                return True

        print(f"❌ Gemini reconnect failed after {self.MAX_RECONNECT_ATTEMPTS} attempts")
        return False

    # ──────────────────────────────────────────────────────────────────────────
    # Receive Loop — Transcript Processing + Auto-Reconnect
    # ──────────────────────────────────────────────────────────────────────────

    async def _receive_loop(self):
        """Background task that listens for transcription results from Gemini.

        Maps Gemini events to the same signal interface used by TurnDetector:
          - input_transcription          → is_final=True  (finalized transcript text)
          - turn_complete                → speech_final=True (end-of-speech signal)
          - interim_input_transcription  → ignored (matches previous behavior)

        When the session expires (~10 min), automatically reconnects and
        resumes listening. The loop only exits on explicit close() or after
        all reconnection attempts are exhausted.
        """
        while not self._closed:
            try:
                async for message in self.session.receive():
                    try:
                        if not message.server_content:
                            continue

                        content = message.server_content
                        turn_complete = getattr(content, "turn_complete", False)

                        # ── Finalized transcription segment ──
                        if content.input_transcription:
                            transcript = content.input_transcription.text or ""
                            if transcript.strip():
                                print(
                                    f"[PROSPECT] TRANSCRIPT "
                                    f"(is_final=True, speech_final={turn_complete}): "
                                    f"{transcript}"
                                )
                                await self.transcript_callback(
                                    "prospect",
                                    transcript.strip(),
                                    is_final=True,
                                    speech_final=turn_complete,
                                )
                            elif turn_complete:
                                # Turn complete with empty finalized text — send signal only
                                await self.transcript_callback(
                                    "prospect",
                                    "",
                                    is_final=False,
                                    speech_final=True,
                                )

                        elif turn_complete:
                            # Standalone turn_complete without transcription —
                            # acts as endpoint detection signal.
                            await self.transcript_callback(
                                "prospect",
                                "",
                                is_final=False,
                                speech_final=True,
                            )

                        # Interim (partial) transcription — not acted on,
                        # matching previous behavior where only finals are forwarded.
                        # elif content.interim_input_transcription:
                        #     pass

                    except Exception as e:
                        print("Transcript processing error:", e)

                # ── async generator ended normally — session expired ──
                if not self._closed:
                    print("⏰ Gemini session expired (10-min limit), reconnecting...")
                    if await self._reconnect():
                        continue  # New session ready — loop back to receive()
                    else:
                        break     # All retries exhausted

            except asyncio.CancelledError:
                break  # Normal shutdown via close()

            except Exception as e:
                if self._closed:
                    break
                print(f"Gemini receive loop error: {e}")
                if await self._reconnect():
                    continue  # Reconnected — resume receiving
                else:
                    break     # Give up
