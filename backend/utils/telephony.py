import re

_PHONE_CLEAN_RE = re.compile(r'[\s\-\(\)]')
_E164_RE = re.compile(r'^\+[1-9]\d{1,14}$')

def normalize_indian_phone_number(phone: str) -> str:
    """
    Normalize an Indian phone number to E.164 format.
    Removes spaces, hyphens, and handles 0, +91, or 91 prefixes.
    """
    if not phone:
        raise ValueError("Phone number cannot be empty")
        
    cleaned = _PHONE_CLEAN_RE.sub('', phone)
    
    if cleaned.startswith("+91") and len(cleaned) == 13:
        return cleaned
    elif cleaned.startswith("91") and len(cleaned) == 12:
        return "+" + cleaned
    elif cleaned.startswith("0") and len(cleaned) == 11:
        return "+91" + cleaned[1:]
    elif len(cleaned) == 10 and cleaned.isdigit():
        return "+91" + cleaned
    else:
        raise ValueError("Invalid Indian phone number format")

def is_valid_e164(phone: str) -> bool:
    return bool(_E164_RE.match(phone))

