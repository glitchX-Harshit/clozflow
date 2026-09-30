import asyncio, websockets, json, os
from dotenv import load_dotenv
load_dotenv('backend/.env')

async def run():
    try:
        async with websockets.connect('wss://api.sarvam.ai/text-to-speech/ws', extra_headers={'api-subscription-key': os.getenv('SARVAM_API_KEY')}) as ws:
            await ws.send(json.dumps({'type':'config','data':{'model':'bulbul:v3','language_code':'en-IN','speaker':'ritu','sample_rate':8000}}))
            await ws.send(json.dumps({'type':'text','data':{'text':'Testing.'}}))
            msg = json.loads(await ws.recv())
            if msg.get('type') == 'audio':
                print('content_type:', msg['data'].get('content_type'))
                import base64
                audio_bytes = base64.b64decode(msg['data']['audio'])
                print('Bytes signature:', audio_bytes[:10])
    except Exception as e:
        print("Error:", e)

asyncio.run(run())
