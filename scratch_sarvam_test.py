import asyncio
import websockets
import json
import os
from dotenv import load_dotenv

load_dotenv("backend/.env")
api_key = os.getenv("SARVAM_API_KEY")

async def test_sarvam():
    url = "wss://api.sarvam.ai/text-to-speech/ws"
    headers = {"api-subscription-key": api_key}
    
    async with websockets.connect(url, extra_headers=headers) as ws:
        print("Connected.")
        config = {
            "type": "config",
            "data": { 
                "model": "bulbul:v3",
                "language_code": "en-IN",
                "speaker": "ritu",
                "pace": 1.0,
                "temperature": 0.6,
                "sample_rate": 8000,
                "enable_events": True
            }
        }
        await ws.send(json.dumps(config))
        print("Sent config")
        
        # Now send text
        payload = {
            "type": "text",
            "data": {
                "text": "Hello, this is Pearl."
            }
        }
        await ws.send(json.dumps(payload))
        print("Sent text")
        
        while True:
            try:
                resp = await asyncio.wait_for(ws.recv(), timeout=2.0)
                if isinstance(resp, str):
                    d = json.loads(resp)
                    if d.get("type") == "audio":
                        print("Content Type:", d["data"].get("content_type"))
                        if "audio" in d.get("data", {}):
                            print("Audio length:", len(d["data"]["audio"]))
            except asyncio.TimeoutError:
                break

asyncio.run(test_sarvam())
