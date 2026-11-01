import os
import httpx
from typing import Optional, Dict, Any

class VobizTelephonyProvider:
    """
    Vobiz Telephony Provider for initiating real-time outbound PSTN calls.
    Uses Vobiz Voice API with bidirectional audio streaming via WebSockets.
    """

    def __init__(self):
        self.auth_id = os.getenv("VOBIZ_AUTH_ID")
        self.auth_secret = os.getenv("VOBIZ_AUTH_SECRET")
        self.account_id = os.getenv("VOBIZ_ACCOUNT_ID")
        base = os.getenv("VOBIZ_BASE_URL", "https://api.vobiz.ai")
        # Ensure trailing slash removed, modernize to api.vobiz.ai if api.vobiz.com was set
        if "api.vobiz.com" in base:
            base = "https://api.vobiz.ai"
        self.base_url = base.rstrip("/")
        self.caller_id = os.getenv("VOBIZ_CALLER_ID", "+918065354620")

    @property
    def provider_name(self) -> str:
        return "vobiz"

    def _headers(self) -> Dict[str, str]:
        return {
            "X-Auth-ID": self.auth_id or "",
            "X-Auth-Token": self.auth_secret or "",
            "Content-Type": "application/json"
        }

    async def create_outbound_call(
        self,
        to_number: str,
        from_number: Optional[str] = None,
        custom_field: str = ""
    ) -> Dict[str, Any]:
        """
        Initiate an outbound call via Vobiz API.
        Vobiz hits the answer_url upon pickup which serves VobizXML with <Stream> tag
        connecting to the Pearl WebSocket endpoint for bidirectional audio AI.
        """
        if not self.auth_id or not self.auth_secret:
            return {
                "success": False,
                "error": "Vobiz credentials (VOBIZ_AUTH_ID, VOBIZ_AUTH_SECRET) not configured."
            }

        caller = from_number or self.caller_id
        if not caller:
            return {
                "success": False,
                "error": "Vobiz caller ID (VOBIZ_CALLER_ID) is required but missing."
            }

        # Normalize target number
        clean_to = to_number.strip()
        if not clean_to.startswith("+") and not clean_to.startswith("91") and len(clean_to) == 10:
            clean_to = f"+91{clean_to}"
        elif not clean_to.startswith("+"):
            clean_to = f"+{clean_to}"

        # Resolve public answer webhook URL
        public_url = os.getenv("PEARL_PUBLIC_URL", "https://circle-riverbank-mumbling.ngrok-free.dev").rstrip("/")
        answer_url = f"{public_url}/api/pearl/vobiz/answer?call_id={custom_field}"
        hangup_url = f"{public_url}/api/pearl/vobiz/events?call_id={custom_field}"

        url = f"{self.base_url}/api/v1/Account/{self.auth_id}/Call/"
        payload = {
            "from": caller,
            "to": clean_to,
            "answer_url": answer_url,
            "answer_method": "POST",
            "hangup_url": hangup_url,
            "hangup_method": "POST"
        }

        print(f"[Vobiz API] Initiating call to {clean_to} from {caller} (call_id: {custom_field})")
        print(f"[Vobiz API] Answer URL: {answer_url}")

        async with httpx.AsyncClient(timeout=12.0) as client:
            try:
                response = await client.post(
                    url,
                    headers=self._headers(),
                    auth=(self.auth_id, self.auth_secret),
                    json=payload
                )

                if response.status_code in (200, 201):
                    data = response.json()
                    provider_call_id = data.get("request_uuid") or data.get("call_uuid") or data.get("api_id")
                    print(f"[Vobiz API] Call queued successfully. Provider Call ID: {provider_call_id}")
                    return {
                        "success": True,
                        "provider_call_id": provider_call_id,
                        "status": "queued",
                        "raw": data
                    }
                else:
                    err_msg = f"Vobiz HTTP {response.status_code}: {response.text}"
                    print(f"[Vobiz API] Error: {err_msg}")
                    return {
                        "success": False,
                        "error": err_msg,
                        "status_code": response.status_code
                    }

            except httpx.RequestError as exc:
                err_msg = f"Vobiz connection error: {exc}"
                print(f"[Vobiz API] Request Exception: {err_msg}")
                return {
                    "success": False,
                    "error": err_msg
                }
            except Exception as exc:
                err_msg = f"Vobiz unexpected error: {exc}"
                print(f"[Vobiz API] Exception: {err_msg}")
                return {
                    "success": False,
                    "error": err_msg
                }

    async def get_call_status(self, provider_call_id: str) -> Dict[str, Any]:
        """Query live status of a call from Vobiz API."""
        if not self.auth_id or not self.auth_secret:
            return {"success": False, "error": "Vobiz credentials not configured."}

        url = f"{self.base_url}/api/v1/Account/{self.auth_id}/Call/{provider_call_id}/"
        async with httpx.AsyncClient(timeout=6.0) as client:
            try:
                response = await client.get(
                    url,
                    headers=self._headers(),
                    auth=(self.auth_id, self.auth_secret)
                )
                if response.status_code == 200:
                    data = response.json()
                    return {
                        "success": True,
                        "status": data.get("call_status") or data.get("status"),
                        "duration": data.get("duration"),
                        "raw": data
                    }
                return {"success": False, "error": f"Vobiz HTTP {response.status_code}: {response.text}"}
            except Exception as exc:
                return {"success": False, "error": str(exc)}
