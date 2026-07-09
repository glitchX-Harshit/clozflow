import os
import asyncio
from typing import Any
from deepgram import DeepgramClient, LiveOptions, LiveTranscriptionEvents


class DeepgramStream:

    def __init__(self, transcript_callback):
        self.dg = DeepgramClient(os.getenv("DEEPGRAM_API_KEY"))
        self.connection: Any = None
        self.transcript_callback = transcript_callback

    async def connect(self):
        try:
            self.connection = self.dg.listen.asynclive.v("1")

            options = LiveOptions(
                model="nova-2-general",
                language="en",
                encoding="linear16",
                sample_rate=16000,
                channels=1,
                interim_results=True,
                punctuate=True,
                # Enable Deepgram's endpoint detection (speech_final signal).
                # 200ms = fire speech_final after 200ms of silence detected by Deepgram.
                # This acts as a redundant signal alongside Silero VAD.
                endpointing=200,
                # diarize intentionally omitted — prospect-only mode
            )

            # ⚠️ Register handler BEFORE start() — events can fire immediately on connect
            self.connection.on(
                LiveTranscriptionEvents.Transcript,
                self._on_transcript
            )

            await self.connection.start(options)

            print("Deepgram stream connected")
            return True

        except Exception as e:
            print("Exception connecting to Deepgram:", e)
            return False

    async def _on_transcript(self, *args, **kwargs):
        """Process all transcript events and forward with signal metadata.
        All audio is treated as prospect — no diarization or speaker detection."""
        result = kwargs.get("result") or (args[0] if args else None)
        try:
            if not result or not result.channel or not result.channel.alternatives:
                return

            alt = result.channel.alternatives[0]
            transcript = alt.transcript or ""
            is_final = result.is_final
            speech_final = getattr(result, 'speech_final', False)

            # Forward final transcripts with non-empty text
            # Also forward speech_final events (even with empty text) as a signal
            if (is_final and transcript.strip()) or speech_final:
                print(f"[PROSPECT] TRANSCRIPT (is_final={is_final}, speech_final={speech_final}): {transcript}")
                await self.transcript_callback(
                    "prospect",
                    transcript.strip() if transcript else "",
                    is_final=is_final,
                    speech_final=speech_final,
                )

        except Exception as e:
            print("Transcript processing error:", e)



    async def send_audio(self, chunk):
        try:
            if self.connection:
                await self.connection.send(chunk)
        except Exception as e:
            print("Audio send error:", e)

    async def close(self):
        try:
            if self.connection:
                await self.connection.finish()
        except Exception as e:
            print("Deepgram close error:", e)