"""Phone number normalisation (contract: digits, spaces, dashes, parentheses and a
leading ``+``; a bare 10-digit number gets +91; 8–15 digits) and masking."""
from __future__ import annotations

import re
from typing import Any, Optional

_ALLOWED = re.compile(r"\+?[0-9 ()\-]+")
_MASK = "•"  # •


def normalize_phone(raw: Any, country_digits: str = "91") -> Optional[str]:
    """E.164 (``+919876543210``) or None when the input isn't a usable number."""
    if isinstance(raw, bool) or raw is None:
        return None
    if isinstance(raw, int):
        raw = str(raw)
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if not text or len(text) > 32 or not _ALLOWED.fullmatch(text):
        return None
    digits = re.sub(r"\D", "", text)
    if not text.startswith("+"):
        if len(digits) == 10:
            digits = country_digits + digits                  # bare national number
        elif len(digits) == 11 and digits.startswith("0") and not digits.startswith("00"):
            digits = country_digits + digits[1:]              # national trunk prefix 0
        elif digits.startswith("00"):
            digits = digits[2:]                               # international prefix 00
    if not 8 <= len(digits) <= 15 or digits.startswith("0"):
        return None
    return "+" + digits


def mask_phone(e164: Optional[str]) -> Optional[str]:
    """``+919876543210`` → ``+91•••••43210`` (country code and last digits only)."""
    if not e164:
        return None
    digits = e164.lstrip("+")
    prefix_len = min(3, max(1, len(digits) - 10)) if len(digits) > 10 else 1
    tail_len = min(5, max(2, len(digits) - prefix_len - 3))
    hidden = len(digits) - prefix_len - tail_len
    return "+" + digits[:prefix_len] + _MASK * hidden + digits[len(digits) - tail_len:]
