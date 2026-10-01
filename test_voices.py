import asyncio, websockets, json, os, base64
from dotenv import load_dotenv
load_dotenv('backend/.env')

async def test_voice(voice_name):
    print(f"Testing voice: {voice_name}")
    try:
        async with websockets.connect('wss://api.sarvam.ai/text-to-speech/ws', extra_headers={'api-subscription-key': os.getenv('SARVAM_API_KEY')}) as ws:
            await ws.send(json.dumps({'type':'config','data':{'model':'bulbul:v3','language_code':'en-IN','speaker':voice_name,'sample_rate':8000}}))
            await ws.send(json.dumps({'type':'text','data':{'text':'Hello, this is a test.'}}))
            
            while True:
                resp = await asyncio.wait_for(ws.recv(), timeout=5.0)
                if isinstance(resp, str):
                    d = json.loads(resp)
                    if d.get("type") == "error":
                        print(f"Error for {voice_name}:", d)
                        break
                    elif d.get("type") == "audio":
                        audio = base64.b64decode(d["data"]["audio"])
                        print(f"Success for {voice_name}! Audio bytes:", audio[:10])
                        break
    except Exception as e:
        print(f"Exception for {voice_name}:", e)

async def main():
    await test_voice("ritu")
    await test_voice("arjun")
    await test_voice("amartya")
    await test_voice("meera")
    
asyncio.run(main())
