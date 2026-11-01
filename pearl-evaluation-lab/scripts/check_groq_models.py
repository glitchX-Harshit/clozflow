import os, sys, httpx
sys.stdout.reconfigure(encoding='utf-8')
with open('backend/.env') as f:
    for line in f:
        if line.startswith('GROQ_API_KEY='):
            key = line.strip().split('=', 1)[1].strip('\'"')
res = httpx.get('https://api.groq.com/openai/v1/models', headers={'Authorization': f'Bearer {key}'})
models = [m['id'] for m in res.json().get('data', [])]
print(models)
