"""
WhatsApp Bridge Client
──────────────────────
Communicates with the Node.js Baileys bridge server.

• get_qr()         → Get QR code for WhatsApp Web connection
• get_status()     → Check connection status
• send_message()   → Send a single WhatsApp message
• send_bulk()      → Send multiple messages with rate limiting
• disconnect()     → Disconnect WhatsApp session
"""

import httpx
import logging
from typing import Optional, Dict, Any, List

logger = logging.getLogger("whatsapp_bridge")

BRIDGE_URL = "http://localhost:3001"


async def get_qr() -> Dict[str, Any]:
    """Get QR code for WhatsApp Web authentication."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(f"{BRIDGE_URL}/qr")
            return response.json()
    except httpx.ConnectError:
        return {"status": "bridge_offline", "qr": None, "error": "WhatsApp bridge is not running. Start it with: cd whatsapp-bridge && npm start"}
    except Exception as e:
        logger.error(f"QR fetch error: {e}")
        return {"status": "error", "qr": None, "error": str(e)}


async def get_status() -> Dict[str, Any]:
    """Check WhatsApp connection status."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{BRIDGE_URL}/status")
            return response.json()
    except httpx.ConnectError:
        return {"status": "bridge_offline", "phone": None}
    except Exception as e:
        logger.error(f"Status check error: {e}")
        return {"status": "error", "phone": None}


async def send_message(phone: str, message: str) -> Dict[str, Any]:
    """Send a single WhatsApp message."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{BRIDGE_URL}/send",
                json={"phone": phone, "message": message}
            )
            return response.json()
    except httpx.ConnectError:
        return {"success": False, "error": "WhatsApp bridge is not running"}
    except Exception as e:
        logger.error(f"Send message error: {e}")
        return {"success": False, "error": str(e)}


async def send_bulk(messages: List[Dict[str, str]], delay: int = 3000) -> Dict[str, Any]:
    """Send multiple WhatsApp messages with rate limiting."""
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.post(
                f"{BRIDGE_URL}/send-bulk",
                json={"messages": messages, "delay": delay}
            )
            return response.json()
    except httpx.ConnectError:
        return {"success": False, "error": "WhatsApp bridge is not running"}
    except Exception as e:
        logger.error(f"Bulk send error: {e}")
        return {"success": False, "error": str(e)}


async def disconnect() -> Dict[str, Any]:
    """Disconnect WhatsApp session."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(f"{BRIDGE_URL}/disconnect")
            return response.json()
    except Exception as e:
        logger.error(f"Disconnect error: {e}")
        return {"success": False, "error": str(e)}
