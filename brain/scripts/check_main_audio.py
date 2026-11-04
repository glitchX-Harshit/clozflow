"""Check configured audio connections without microphone access or phone calls."""
import asyncio
from contextlib import redirect_stdout, redirect_stderr
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import sys

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT.parent


async def main():
    load_dotenv(MAIN / ".env", override=True)
    sys.path.insert(0, str(MAIN))
    report = {"created_at": datetime.now(timezone.utc).isoformat(),
              "scope": "Provider handshakes and local silence VAD only; no phone call or audio quality evaluation."}
    # Suppress vendor diagnostics, which can include authenticated URLs.
    with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
        from backend.services.gemini_stream import GeminiStream
        from backend.services.pearl.providers.tts import SarvamTTSProvider
        from backend.services.vad_engine import SileroVADEngine

        async def transcript(*args, **kwargs):
            pass

        gemini = GeminiStream(transcript)
        try:
            report["gemini_live_connected"] = bool(await asyncio.wait_for(gemini.connect(), 25))
        except Exception as exc:
            report["gemini_live_error_type"] = type(exc).__name__
            report["gemini_live_connected"] = False
        finally:
            await gemini.close()
            await gemini.client.aio.aclose()

        sarvam = SarvamTTSProvider()
        try:
            await asyncio.wait_for(sarvam.connect(), 25)
            report["sarvam_connected"] = sarvam.ws is not None
        except Exception as exc:
            report["sarvam_error_type"] = type(exc).__name__
            report["sarvam_connected"] = False
        finally:
            await sarvam.close()

        vad = SileroVADEngine()
        try:
            report["vad_initialized"] = bool(await asyncio.wait_for(vad.initialize(), 30))
            report["silence_has_no_speech_events"] = report["vad_initialized"] and not vad.process_chunk(bytes(1024))
        except Exception as exc:
            report["vad_error_type"] = type(exc).__name__
            report["vad_initialized"] = False
    (ROOT / "logs/main-audio-check.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if all(report.get(k) for k in ("gemini_live_connected", "sarvam_connected", "vad_initialized", "silence_has_no_speech_events")) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
