"""
WhatsApp Bridge Client
──────────────────────
Communicates with the Node.js Baileys bridge server.

• get_qr()         → Get QR code for WhatsApp Web connection
• get_status()     → Check connection status
• send_message()   → Send a single WhatsApp message (with retry)
• send_bulk()      → Send multiple messages with rate limiting
• disconnect()     → Disconnect WhatsApp session
"""

import httpx
import asyncio
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


async def send_message(phone: str, message: str, retries: int = 2) -> Dict[str, Any]:
    """Send a single WhatsApp message with automatic retries."""
    last_error = None
    for attempt in range(1, retries + 1):
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{BRIDGE_URL}/send",
                    json={"phone": phone, "message": message}
                )
                data = response.json()
                if data.get("success"):
                    return data
                # Bridge returned an error response — retry if not a 4xx
                if response.status_code >= 400 and response.status_code < 500:
                    return data  # Don't retry client errors (bad phone, etc.)
                last_error = data.get("error", "Unknown bridge error")
                logger.warning(f"Send attempt {attempt} failed: {last_error}")
        except httpx.ConnectError:
            last_error = "WhatsApp bridge is not running"
            logger.warning(f"Send attempt {attempt}: bridge not reachable")
        except httpx.ReadTimeout:
            last_error = "Bridge timed out sending message"
            logger.warning(f"Send attempt {attempt}: read timeout")
        except Exception as e:
            last_error = str(e)
            logger.warning(f"Send attempt {attempt} error: {e}")
        
        if attempt < retries:
            await asyncio.sleep(3)  # Wait 3s before retry
    
    logger.error(f"Send message failed after {retries} attempts: {last_error}")
    return {"success": False, "error": last_error}


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
