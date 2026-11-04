"""Create private local settings for this checkout without overwriting credentials."""
from pathlib import Path
import secrets
import shutil

from dotenv import dotenv_values, set_key

ROOT = Path(__file__).resolve().parents[1]


def main():
    for relative in ('.env', 'brain/.env', 'frontend/.env.local'):
        target = ROOT / relative
        if not target.exists():
            example = target.parent / '.env.example'
            shutil.copy2(example, target)
    main_env = ROOT / '.env'
    config = dotenv_values(main_env)
    defaults = {'CLOZFLOW_COPILOT_ENGINE': 'brain', 'CLOZFLOW_LOCAL_MODE': '1',
                'CLOZFLOW_BRAIN_URL': 'http://127.0.0.1:8110',
                'CLOZFLOW_BRAIN_TIMEOUT_SECONDS': '300'}
    for key, value in defaults.items():
        if not config.get(key):
            set_key(main_env, key, value)
    if not config.get('JWT_SECRET_KEY'):
        set_key(main_env, 'JWT_SECRET_KEY', secrets.token_urlsafe(48))
    if config.get('GEMINI_API_KEY'):
        set_key(ROOT / 'brain/.env', 'GEMINI_API_KEY', config['GEMINI_API_KEY'])
    set_key(ROOT / 'frontend/.env.local', 'VITE_AUTH_MODE', 'local')
    print('Local settings ready. Set GEMINI_API_KEY in the root .env, then rerun this command to sync it.')
    print('Development ports: UI 5273, main API 8100, Brain API 8110. No existing service was changed.')


if __name__ == '__main__':
    main()
