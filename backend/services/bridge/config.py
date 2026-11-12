"""Bridge-call configuration, read from the environment on every use (cheap, and
lets an operator fix a missing variable without a code change)."""
from __future__ import annotations

import ipaddress
import math
import os
import re
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlsplit

# The ngrok URL hard-coded as PEARL_PUBLIC_URL's fallback in the Pearl code. It is
# somebody's old tunnel, so it counts as "not configured".
PLACEHOLDER_PUBLIC_URLS = frozenset({"https://circle-riverbank-mumbling.ngrok-free.dev"})

DEFAULT_RATE_PER_MINUTE = 3.0
DEFAULT_MAX_MINUTES = 60
MAX_MAX_MINUTES = 240          # Vobiz Dial timeLimit default (14400 s)
COUNTRY_DEFAULT = "+91"

REASON_NO_CREDENTIALS = "Phone calls aren't set up on this server yet (no phone provider account)."
REASON_NO_CALLER_ID = "Phone calls aren't set up on this server yet (no caller ID number)."
REASON_NO_PUBLIC_URL = "Phone calls aren't set up on this server yet (no public HTTPS address)."

# Spoken disclosure played to the prospect's leg right after they answer (Meeting Wizard
# consent mode ``bridge_disclosure``). ``off`` (default) keeps the rep-announce path;
# ``on`` plays it; ``gate`` also asks for a keypress (Vobiz confirmKey; enforcement unverified).
DISCLOSURE_MODES = ("off", "on", "gate")
DEFAULT_DISCLOSURE_TEXT = ("This call is assisted by ClozFlow for notes.\n"
                           "Yeh call notes ke liye ClozFlow ki madad se ho rahi hai.")
DEFAULT_DISCLOSURE_GATE_TEXT = ("This call is assisted by ClozFlow for notes. Press 1 to continue.\n"
                                "Yeh call notes ke liye ClozFlow ki madad se ho rahi hai. Jaari rakhne ke liye 1 dabayein.")
MAX_DISCLOSURE_CHARS = 600

_E164 = re.compile(r"\+[1-9][0-9]{7,14}")


@dataclass(frozen=True)
class BridgeConfig:
    enabled: bool
    reason: Optional[str]
    public_url: Optional[str]      # https://host[:port][/prefix], no trailing slash
    ws_base: Optional[str]         # wss://host[:port][/prefix]
    caller_id: Optional[str]       # E.164
    rate_per_minute: float
    max_minutes: int
    disclosure: str = "off"        # off | on | gate
    disclosure_text: str = DEFAULT_DISCLOSURE_TEXT

    @property
    def min_balance(self) -> float:
        """One minute of calling."""
        return round(self.rate_per_minute, 2)

    @property
    def disclosure_enabled(self) -> bool:
        return self.disclosure in ("on", "gate")

    def public_payload(self) -> dict:
        return {
            "enabled": self.enabled,
            "reason": self.reason,
            "rate_per_minute": self.rate_per_minute,
            "min_balance": self.min_balance,
            "max_minutes": self.max_minutes,
            "country_default": COUNTRY_DEFAULT,
        }


def _env(name: str) -> str:
    return (os.getenv(name) or "").strip()


def rate_per_minute() -> float:
    raw = _env("COPILOT_BRIDGE_RATE_PER_MINUTE")
    try:
        value = float(raw) if raw else DEFAULT_RATE_PER_MINUTE
    except ValueError:
        return DEFAULT_RATE_PER_MINUTE
    if not math.isfinite(value) or value < 0:
        return DEFAULT_RATE_PER_MINUTE
    return round(value, 2)


def max_minutes() -> int:
    raw = _env("COPILOT_BRIDGE_MAX_MINUTES")
    try:
        value = int(raw) if raw else DEFAULT_MAX_MINUTES
    except ValueError:
        return DEFAULT_MAX_MINUTES
    return max(1, min(MAX_MAX_MINUTES, value))


def disclosure_mode() -> str:
    raw = _env("COPILOT_BRIDGE_DISCLOSURE").lower()
    if raw in ("1", "true", "yes"):
        return "on"
    if raw in ("0", "false", "no", ""):
        return "off"
    return raw if raw in DISCLOSURE_MODES else "off"


def disclosure_text(mode: Optional[str] = None) -> str:
    mode = mode or disclosure_mode()
    raw = _env("COPILOT_BRIDGE_DISCLOSURE_TEXT")
    if raw:
        return raw.replace("\\n", "\n")[:MAX_DISCLOSURE_CHARS]
    return DEFAULT_DISCLOSURE_GATE_TEXT if mode == "gate" else DEFAULT_DISCLOSURE_TEXT


def normalize_public_url(raw: str) -> Optional[str]:
    """The public base URL if it is a usable https origin (optionally with a path
    prefix), else None. Loopback/private hosts can't receive carrier webhooks."""
    if not raw:
        return None
    try:
        parts = urlsplit(raw.strip())
        host = parts.hostname
        port = parts.port
    except ValueError:
        return None
    if parts.scheme.lower() != "https" or not host or parts.username or parts.password:
        return None
    if parts.query or parts.fragment:
        return None
    host = host.lower()
    if host == "localhost" or host.endswith(".localhost"):
        return None
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None and (address.is_loopback or address.is_private or address.is_unspecified):
        return None
    netloc = host if port in (None, 443) else f"{host}:{port}"
    path = parts.path.rstrip("/")
    url = f"https://{netloc}{path}"
    if url in PLACEHOLDER_PUBLIC_URLS:
        return None
    return url


def normalize_caller_id(raw: str) -> Optional[str]:
    if not raw:
        return None
    compact = re.sub(r"[\s()\-]", "", raw)
    if not compact.startswith("+"):
        compact = "+" + compact
    return compact if _E164.fullmatch(compact) else None


def load_config() -> BridgeConfig:
    public_url = normalize_public_url(_env("PEARL_PUBLIC_URL"))
    caller_id = normalize_caller_id(_env("VOBIZ_CALLER_ID"))
    reason = None
    if not (_env("VOBIZ_AUTH_ID") and _env("VOBIZ_AUTH_SECRET")):
        reason = REASON_NO_CREDENTIALS
    elif not caller_id:
        reason = REASON_NO_CALLER_ID
    elif not public_url:
        reason = REASON_NO_PUBLIC_URL
    ws_base = "wss://" + public_url[len("https://"):] if public_url else None
    mode = disclosure_mode()
    return BridgeConfig(
        enabled=reason is None,
        reason=reason,
        public_url=public_url,
        ws_base=ws_base,
        caller_id=caller_id,
        rate_per_minute=rate_per_minute(),
        max_minutes=max_minutes(),
        disclosure=mode,
        disclosure_text=disclosure_text(mode),
    )
