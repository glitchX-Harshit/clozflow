"""Validate updated local configuration without printing credentials."""
from pathlib import Path
import json
import importlib.util
import sys

import httpx
from dotenv import dotenv_values, set_key
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT.parent
sys.path.insert(0, str(ROOT / 'src'))
from clozflow_brain.infrastructure.llm_gemini import GeminiLLMClient, GeminiAPIError  # noqa: E402


class Probe(BaseModel):
    message: str


def main():
    config = dotenv_values(MAIN / '.env')
    brain = dotenv_values(ROOT / '.env')
    result = {'gemini': {}, 'groq': {}, 'optional_dependencies': {}}
    model = brain.get('GEMINI_MODEL', 'gemini-3.5-flash-lite')
    try:
        reply = GeminiLLMClient(config.get('GEMINI_API_KEY', ''), model).generate_structured_output(
            'Return the message ready.', Probe, 'This is a synthetic connectivity test.')
        result['gemini'] = {'status': 'verified', 'model': model, 'structured_output': bool(reply.message)}
        # User asked to apply the updated main-app configuration to the system.
        set_key(ROOT / '.env', 'GEMINI_API_KEY', config['GEMINI_API_KEY'])
        result['gemini']['brain_key_synchronized'] = True
    except GeminiAPIError as error:
        result['gemini'] = {'status': 'failed', 'detail': str(error), 'brain_key_synchronized': False}
    if config.get('GROQ_API_KEY'):
        try:
            response = httpx.get('https://api.groq.com/openai/v1/models',
                headers={'Authorization': 'Bearer ' + config['GROQ_API_KEY']}, timeout=15)
            result['groq']['http_status'] = response.status_code
            if response.status_code == 200:
                models = {item['id'] for item in response.json().get('data', [])}
                result['groq'].update(status='verified', legacy_model_available='openai/gpt-oss-120b' in models,
                    pearl_model=config.get('PEARL_LLM_MODEL'), pearl_model_available=config.get('PEARL_LLM_MODEL') in models)
            else:
                result['groq']['status'] = 'failed'
        except httpx.HTTPError:
            result['groq']['status'] = 'network_failed'
    for name in ('faiss', 'sentence_transformers', 'torch', 'silero_vad', 'onnxruntime', 'deepgram', 'google.genai'):
        try:
            result['optional_dependencies'][name] = importlib.util.find_spec(name) is not None
        except ModuleNotFoundError:
            result['optional_dependencies'][name] = False
    result['local_routing'] = {name: config.get(name) for name in
        ('CLOZFLOW_COPILOT_ENGINE', 'CLOZFLOW_LOCAL_MODE', 'CLOZFLOW_BRAIN_TIMEOUT_SECONDS')}
    (ROOT / 'logs/main-config-check.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
