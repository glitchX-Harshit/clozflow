import json
import base64
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.services.pearl_v2.core.state_machine import PearlRealtimeRuntime

router = APIRouter()

@router.websocket("/calls/{call_id}/audio")
async def call_audio_stream_v2(websocket: WebSocket, call_id: str, db: Session = Depends(get_db)):
    """
    Exotel Media Stream WebSocket — V2 Architecture
    Strict separation of Telephony Adapter from the Runtime.
    """
    print(f"[Pearl V2] Connection opened for call_id: {call_id}")
    await websocket.accept()
    
    stream_sid = None
    
    async def audio_out_callback(pcm_bytes: bytes):
        """Adapter: PCM to Exotel Base64 JSON"""
        if not pcm_bytes or pcm_bytes == b"__FLUSH_COMPLETE__":
            return
            
        encoded = base64.b64encode(pcm_bytes).decode("utf-8")
        out_msg = {
            "event": "media",
            "media": {"payload": encoded}
        }
        if stream_sid:
            out_msg["stream_sid"] = stream_sid
        await websocket.send_json(out_msg)

    # Instantiate the V2 Runtime
    # Passing hardcoded lead_id for now as in old code, usually derived from call_id
    runtime = PearlRealtimeRuntime(call_id=call_id, lead_id="test", audio_out_callback=audio_out_callback)
    await runtime.start()

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            event_type = data.get("event")
            
            if event_type == "connected":
                print("[Exotel WS V2] Connected event.")
                
            elif event_type == "start":
                stream_sid = data.get("start", {}).get("streamSid")
                print(f"[Exotel WS V2] Stream started: {stream_sid}")
                
            elif event_type == "media":
                payload = data.get("media", {}).get("payload")
                if payload:
                    audio_bytes = base64.b64decode(payload)
                    # Push raw PCM to the runtime engine
                    await runtime.process_telephony_audio(audio_bytes)
                    
            elif event_type == "stop":
                print("[Exotel WS V2] Stream stopped by Exotel.")
                break
                
    except WebSocketDisconnect:
        print(f"[Pearl V2] WebSocket disconnected.")
    except Exception as e:
        print(f"[Pearl V2] WebSocket error: {e}")
    finally:
        # Cleanup
        print(f"[Pearl V2] Call {call_id} ended.")
