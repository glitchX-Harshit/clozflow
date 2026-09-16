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

    Interface:
        stream = GeminiStream(transcript_callback=my_callback)
        await stream.connect()
        await stream.send_audio(pcm_chunk)   # 16kHz mono linear16
        await stream.close()

    Callback signature:
        async def callback(speaker, text, is_final=True, speech_final=False)
    """

    def __init__(self, transcript_callback):
        self.client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        self.session: Any = None
        self._session_ctx: Any = None
        self.transcript_callback = transcript_callback
        self._receive_task: asyncio.Task | None = None

    async def connect(self):
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

            # Start background receive loop for transcription events
            self._receive_task = asyncio.create_task(self._receive_loop())

            print("Gemini transcription stream connected")
            return True

        except Exception as e:
            print("Exception connecting to Gemini:", e)
            return False

    async def _receive_loop(self):
        """Background task that listens for transcription results from Gemini.

        Maps Gemini events to the same signal interface used by TurnDetector:
          - input_transcription     → is_final=True  (finalized transcript text)
          - turn_complete           → speech_final=True (end-of-speech signal)
          - interim_input_transcription → ignored (matches previous Deepgram behavior)
        """
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
                        # acts like Deepgram's speech_final (endpoint detection).
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

        except asyncio.CancelledError:
            pass  # Normal shutdown — receive loop cancelled by close()
        except Exception as e:
            print("Gemini receive loop ended:", e)

    async def send_audio(self, chunk):
        """Send a raw PCM audio chunk to Gemini for transcription.
        Expected format: 16-bit linear PCM, 16 kHz, mono."""
        try:
            if self.session:
                await self.session.send_realtime_input(
                    audio=types.Blob(
                        data=chunk,
                        mime_type="audio/pcm;rate=16000",
                    )
                )
        except Exception as e:
            print("Audio send error:", e)

    async def close(self):
        """Close the Gemini Live session and cancel the receive loop."""
        try:
            # Cancel receive loop first
            if self._receive_task and not self._receive_task.done():
                self._receive_task.cancel()
                try:
                    await self._receive_task
                except asyncio.CancelledError:
                    pass

            # Close the session via context manager exit
            if self._session_ctx:
                try:
                    await self._session_ctx.__aexit__(None, None, None)
                except Exception:
                    pass  # Session may already be closed
        except Exception as e:
            print("Gemini close error:", e)
