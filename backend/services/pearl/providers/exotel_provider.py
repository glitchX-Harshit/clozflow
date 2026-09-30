import os
import httpx
from typing import Optional
from datetime import datetime

class ExotelTelephonyProvider:
    """
    Exotel Provider for initiating outbound calls.
    """
    
    def __init__(self):
        self.account_sid = os.getenv("EXOTEL_ACCOUNT_SID")
        self.api_key = os.getenv("EXOTEL_API_KEY")
        self.api_token = os.getenv("EXOTEL_API_TOKEN")
        self.base_url = os.getenv("EXOTEL_BASE_URL", "https://api.exotel.com")
        self.subdomain = os.getenv("EXOTEL_SUBDOMAIN", "api") # In case region is specified
        
        if not all([self.account_sid, self.api_key, self.api_token]):
            # Graceful warning or exception depending on Pearl's strictness
            pass

    @property
    def provider_name(self) -> str:
        return "exotel"

    async def create_outbound_call(self, to_number: str, from_number: str, custom_field: str) -> dict:
        """
        Initiate an outbound call via Exotel.
        For streaming/audio gateway connection, Exotel uses Applets or Call Streams.
        We would ideally connect this to a webhook endpoint or Exotel Custom App.
        """
        if not self.account_sid or not self.api_key or not self.api_token:
            raise ValueError("Exotel credentials not configured properly.")

        url = f"{self.base_url}/v1/Accounts/{self.account_sid}/Calls/connect.json"
        
        # This payload assumes using a specific Exotel App or streaming URL
        # For this implementation, we simulate the standard Exotel Call Connect payload.
        # It calls the 'to_number', and connects to 'from_number' or an 'app_id'.
        # Since this is an AI agent, we usually connect the call to a WebSocket stream.
        # Exotel uses 'Url' (webhook URL) or App ID to connect logic after answering.
        
        # The Pearl WebSocket URL for the streaming audio
        public_url = os.getenv("PEARL_PUBLIC_URL")
        if public_url:
            base_ws = public_url.replace("http://", "ws://").replace("https://", "wss://")
        else:
            base_ws = "wss://api.example.com" # Placeholder if not set, must be a public URL for Exotel to reach it
            
        stream_url = f"{base_ws}/api/pearl/calls/{custom_field}/audio"
        
        data = {
            "From": to_number,
            "CallerId": from_number,
            "CustomField": str(custom_field), # Pass the Pearl call_id here
            "StreamUrl": stream_url,
            "StreamType": "bidirectional"
        }
            
        async with httpx.AsyncClient() as client:
            try:
                print(f"[Exotel API] Requesting Outbound AI Stream Call to {to_number}")
                print(f"[Exotel API] StreamUrl: {stream_url}")
                response = await client.post(
                    url,
                    auth=(self.api_key, self.api_token),
                    data=data,
                    timeout=10.0
                )
                response.raise_for_status()
                json_resp = response.json()
                call_info = json_resp.get("Call", {})
                print(f"[Exotel API] Call Initiated. SID: {call_info.get('Sid')}")
                return {
                    "success": True,
                    "provider_call_id": call_info.get("Sid"),
                    "status": call_info.get("Status"),
                    "raw": call_info
                }
            except httpx.HTTPStatusError as e:
                print(f"[Exotel API] HTTP Error: {e.response.status_code} - {e.response.text}")
                return {
                    "success": False,
                    "error": f"{str(e)} - Body: {e.response.text}"
                }
            except Exception as e:
                print(f"[Exotel API] Exception: {str(e)}")
                return {
                    "success": False,
                    "error": str(e)
                }

    async def get_call_status(self, provider_call_id: str) -> dict:
        if not self.account_sid:
            raise ValueError("Exotel credentials not configured.")
        url = f"{self.base_url}/v1/Accounts/{self.account_sid}/Calls/{provider_call_id}.json"
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    url,
                    auth=(self.api_key, self.api_token),
                    timeout=5.0
                )
                response.raise_for_status()
                call_info = response.json().get("Call", {})
                return {
                    "success": True,
                    "status": call_info.get("Status"),
                    "duration": call_info.get("Duration"),
                    "raw": call_info
                }
            except Exception as e:
                return {
                    "success": False,
                    "error": str(e)
                }
