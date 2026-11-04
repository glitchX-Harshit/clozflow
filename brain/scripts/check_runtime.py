"""Check local dependencies; optionally send one synthetic model request."""
import argparse
import importlib.util
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--live-model", action="store_true")
    args = parser.parse_args()
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
    provider = os.getenv("CEB_LLM_PROVIDER", "local")
    modules = ["pydantic", "fastapi", "uvicorn", "sqlalchemy", "qdrant_client", "celery"]
    if provider == "local":
        modules += ["llama_cpp", "huggingface_hub"]
    if os.getenv("CEB_AUTH_MODE", "local") == "jwt":
        modules += ["jwt"]
    missing = [name for name in modules if importlib.util.find_spec(name) is None]
    print("Python:", sys.version.split()[0])
    print("Configured provider:", provider)
    print("Missing dependencies:", ", ".join(missing) or "none for selected runtime")
    if missing:
        return 1
    if args.live_model:
        from pydantic import BaseModel
        class CheckResponse(BaseModel):
            message: str
        from clozflow_brain.infrastructure.llm import _build_real_client
        client = _build_real_client(provider)
        if client is None:
            print("Provider configuration is incomplete")
            return 1
        try:
            result = client.generate_structured_output(
                'Return a JSON object whose message is "ready".', CheckResponse,
            )
            if result.message != "ready":
                print("Model returned unexpected content")
                return 1
            print("Live structured model request: passed")
        except Exception as exc:
            print("Live structured model request: failed (" + type(exc).__name__ + ")")
            from clozflow_brain.infrastructure.llm_gemini import GeminiAPIError
            if isinstance(exc, GeminiAPIError):
                print(str(exc))
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
