import miniaudio
import asyncio
import websockets
import json
import os
import base64
from dotenv import load_dotenv

load_dotenv('backend/.env')

async def test():
    async with websockets.connect('wss://api.sarvam.ai/text-to-speech/ws', extra_headers={'api-subscription-key': os.getenv('SARVAM_API_KEY')}) as ws:
        await ws.send(json.dumps({'type': 'config', 'data': {'model': 'bulbul:v3', 'language_code': 'en-IN', 'speaker': 'ritu', 'pace': 1.0, 'temperature': 0.6, 'sample_rate': 8000, 'enable_events': True}}))
        await ws.send(json.dumps({'type': 'text', 'data': {'text': 'Hello, this is Pearl.'}}))
        
        while True:
            resp = await ws.recv()
            if isinstance(resp, str):
                d = json.loads(resp)
                if d.get('type') == 'audio':
                    audio_b64 = d['data']['audio']
                    audio_bytes = base64.b64decode(audio_b64)
                    
                    try:
                        # Decode MP3 to raw PCM, resampled to 8000Hz mono
                        decoded = miniaudio.decode(audio_bytes, nchannels=1, sample_rate=8000)
                        
                        # decoded.samples is an array of signed 16-bit integers, we can get bytes
                        import ctypes
                        pcm_bytes = bytes(decoded.samples)
                        
                        print(f"Original MP3 bytes: {len(audio_bytes)}")
                        print(f"Decoded PCM 8kHz bytes: {len(pcm_bytes)}")
                    except Exception as e:
                        print(f"Conversion failed: {e}")
                    
                    break

asyncio.run(test())
