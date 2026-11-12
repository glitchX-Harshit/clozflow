import logging
import os
import httpx
from typing import Optional
from datetime import datetime

from ..carrier_auth import carrier_audio_stream_url, carrier_query, public_base_url

logger = logging.getLogger(__name__)


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

    @property
    def provider_name(self) -> str:
        return "exotel"

    async def create_outbound_call(self, to_number: str, from_number: str, custom_field: str) -> dict:
        """
        Initiate an outbound call via Exotel, streaming call audio to Pearl's carrier socket.

        ``custom_field`` is the Pearl call id. The StreamUrl and StatusCallback carry its
        per-call token so the carrier-facing endpoints can authenticate Exotel.
        """
        if not self.account_sid or not self.api_key or not self.api_token:
            return {"success": False, "error": "Exotel credentials (EXOTEL_ACCOUNT_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN) not configured."}

        public_url = public_base_url()
        if not public_url:
            return {"success": False, "error": "PEARL_PUBLIC_URL is not configured; Exotel cannot reach the audio stream."}

        url = f"{self.base_url}/v1/Accounts/{self.account_sid}/Calls/connect.json"
        stream_url = carrier_audio_stream_url(custom_field, public_url)
        status_callback = f"{public_url}/api/pearl/webhooks/exotel?{carrier_query(custom_field)}"

        data = {
            "From": to_number,
            "CallerId": from_number,
            "CustomField": str(custom_field), # Pass the Pearl call_id here
            "StreamUrl": stream_url,
            "StreamType": "bidirectional",
            "StatusCallback": status_callback,
        }

        async with httpx.AsyncClient() as client:
            try:
                logger.info("[Exotel API] Requesting outbound AI stream call %s", str(custom_field)[:8])
                response = await client.post(
                    url,
                    auth=(self.api_key, self.api_token),
                    data=data,
                    timeout=10.0
                )
                response.raise_for_status()
                json_resp = response.json()
                call_info = json_resp.get("Call", {})
                logger.info("[Exotel API] Call %s initiated", str(custom_field)[:8])
                return {
                    "success": True,
                    "provider_call_id": call_info.get("Sid"),
                    "status": call_info.get("Status"),
                    "raw": call_info
                }
            except httpx.HTTPStatusError as e:
                logger.warning("[Exotel API] HTTP error %s for call %s", e.response.status_code, str(custom_field)[:8])
                return {
                    "success": False,
                    "error": f"Exotel HTTP {e.response.status_code}: {e.response.text[:300]}"
                }
            except Exception as e:
                logger.warning("[Exotel API] Exception: %s", e)
                return {
                    "success": False,
                    "error": str(e)
                }

    async def get_call_status(self, provider_call_id: str) -> dict:
        if not self.account_sid:
            return {"success": False, "error": "Exotel credentials not configured."}
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
