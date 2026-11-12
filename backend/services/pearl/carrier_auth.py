"""
Per-call secrets for carrier-facing Pearl endpoints.

Telephony carriers (Vobiz, Exotel) cannot send a user JWT, so every URL we hand to a
carrier for a call (answer / hangup / status webhooks and the bidirectional audio
socket) carries ``token=<carrier_token(call_id)>``. The token is an HMAC of the call id
under a server secret, so it needs no storage, cannot be guessed from the call id and
is checked with ``hmac.compare_digest``.

Secret: ``PEARL_WEBHOOK_SECRET`` if set, else the JWT signing secret
(``JWT_SECRET_KEY`` / ``SECRET_KEY`` / routers.auth.SECRET_KEY). If none can be found a
random per-process key is used (tokens then only validate in the issuing process).
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from typing import Optional
from urllib.parse import quote

_PROCESS_FALLBACK_SECRET = secrets.token_hex(32)


def _signing_key() -> bytes:
    secret = os.getenv("PEARL_WEBHOOK_SECRET") or os.getenv("JWT_SECRET_KEY") or os.getenv("SECRET_KEY")
    if not secret:
        try:
            from routers.auth import SECRET_KEY as _jwt_secret  # same default the API tokens use
            secret = _jwt_secret
        except Exception:
            secret = None
    secret = secret or _PROCESS_FALLBACK_SECRET
    return hashlib.sha256(b"clozflow-pearl-carrier-v1|" + str(secret).encode("utf-8")).digest()


def carrier_token(call_id: str) -> str:
    """Deterministic per-call secret handed to the carrier in callback/stream URLs."""
    return hmac.new(_signing_key(), str(call_id).encode("utf-8"), hashlib.sha256).hexdigest()[:40]


def verify_carrier_token(call_id: Optional[str], token: Optional[str]) -> bool:
    if not call_id or not token or not isinstance(token, str):
        return False
    return hmac.compare_digest(carrier_token(call_id).encode("ascii"), token.strip().encode("utf-8", "ignore"))


def provider_id_matches(stored: Optional[str], *candidates: Optional[str]) -> bool:
    """Constant-time check that a carrier-supplied call id equals the one we stored at dispatch."""
    if not stored:
        return False
    stored_b = str(stored).strip().encode("utf-8")
    ok = False
    for cand in candidates:
        if cand:
            ok |= hmac.compare_digest(stored_b, str(cand).strip().encode("utf-8"))
    return ok


def public_base_url() -> Optional[str]:
    url = (os.getenv("PEARL_PUBLIC_URL") or "").strip().rstrip("/")
    return url or None


def carrier_query(call_id: str) -> str:
    """``call_id=…&token=…`` query string for carrier webhooks."""
    return f"call_id={quote(str(call_id), safe='')}&token={carrier_token(call_id)}"


def carrier_audio_stream_url(call_id: str, base_url: Optional[str] = None) -> Optional[str]:
    """wss:// URL of the carrier audio socket for ``call_id`` (with its token), or None if no public URL."""
    base = (base_url or public_base_url() or "").rstrip("/")
    if not base:
        return None
    ws_base = base.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
    return f"{ws_base}/api/pearl/calls/{quote(str(call_id), safe='')}/audio?token={carrier_token(call_id)}"
