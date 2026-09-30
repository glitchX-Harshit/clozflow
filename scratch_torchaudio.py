import asyncio
import websockets
import json
import os
import base64
import torchaudio
import io
import torch
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
                        # Convert to PCM 16-bit 8000Hz using torchaudio
                        waveform, sr = torchaudio.load(io.BytesIO(audio_bytes))
                        print(f"Loaded MP3: shape={waveform.shape}, sr={sr}")
                        
                        if sr != 8000:
                            resampler = torchaudio.transforms.Resample(orig_freq=sr, new_freq=8000)
                            waveform = resampler(waveform)
                            print(f"Resampled to 8000Hz: shape={waveform.shape}")
                        
                        pcm16 = (waveform * 32767.0).to(torch.int16)
                        pcm_bytes = pcm16.numpy().tobytes()
                        print(f"Converted to PCM bytes: {len(pcm_bytes)}")
                    except Exception as e:
                        print(f"Conversion failed: {e}")
                    
                    break

asyncio.run(test())
