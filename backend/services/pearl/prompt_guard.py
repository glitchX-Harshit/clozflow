"""
Pearl Voice AI — Prompt Injection & Adversarial Jailbreak Guardrail
═════════════════════════════════════════════════════════════════════
Defends real-time voice and chat interactions against:
1. Instruction Resets ("Ignore previous instructions", "Disregard prompts")
2. System Prompt Exfiltration ("Reveal your secret prompt", "Print system instructions")
3. Persona Hijacking ("You are now DAN / Developer Mode / Jailbreak")
4. Unauthorized Commercial Commitments ("Repeat after me: 95% discount", "Promise it's free")
5. Delimiter & Token Injections (<|im_start|>, [INST], ### System)

Ultra-low latency: Pure compiled regex heuristics (< 0.2ms per utterance).
Graceful degradation: Replies in character with natural sales re-anchoring instead of robotic crashes.
"""

import re
import random
from typing import Tuple, Optional

# ── Compiled Adversarial Patterns ──────────────────────────────────────────

# 1. Instruction Reset / System Override
_OVERRIDE_PATTERNS = [
    r"\bignore\s+(all\s+)?(previous|prior|above|system)\s+(instructions|prompts|rules|commands)\b",
    r"\bdisregard\s+(all\s+)?(previous|prior|above|system|the)\s+(instructions|prompts|rules|guidelines)\b",
    r"\bforget\s+(all\s+)?(your\s+)?(instructions|prompts|rules|role|sales\s+playbook|script)\b",
    r"\boverride\s+(all\s+)?(previous|system)\s+(instructions|rules)\b",
    r"\bnew\s+rule:\s*ignore\b",
    r"\bclear\s+(all\s+)?memory\s+and\s+(start\s+over|listen)\b",
]

# 2. System Prompt / Architecture Exfiltration
_EXFILTRATION_PATTERNS = [
    r"\b(what\s+is|show\s+me|reveal|tell\s+me|print|output|display|repeat)\s+(your\s+)?(system\s+prompt|initial\s+prompt|hidden\s+prompt|developer\s+instructions|secret\s+rules|internal\s+instructions)\b",
    r"\brepeat\s+(everything|the\s+text)\s+(above|before\s+this|starting\s+from)\b",
    r"\bwhat\s+(were\s+you|are\s+you)\s+told\s+to\s+(do|say|behave)\b",
    r"\bwhat\s+is\s+written\s+in\s+your\s+context\b",
    r"\bread\s+(out\s+)?your\s+(prompt|instructions)\b",
]

# 3. Persona Hijacking / Developer Mode / Jailbreaks
_PERSONA_HIJACK_PATTERNS = [
    r"\byou\s+are\s+now\s+(in\s+)?(developer\s+mode|dan|unrestricted|jailbreak|unfiltered|god\s+mode)\b",
    r"\bact\s+as\s+(an?\s+)?(unfiltered|unrestricted|jailbroken|evil|dan|developer)\b",
    r"\bpretend\s+you\s+have\s+no\s+(rules|guidelines|restrictions|limits)\b",
    r"\bfrom\s+now\s+on\s+you\s+(can|will)\s+do\s+anything\b",
    r"\bhypothetically\s+if\s+you\s+had\s+no\s+rules\b",
]

# 4. Coerced Commercial Commitments / Unauthorized Discounts
_COERCED_COMMITMENT_PATTERNS = [
    r"\brepeat\s+after\s+me:?\s*[\"']?i\s+promise\b",
    r"\bpromise\s+me\s+(that\s+)?(it\s+is\s+|i\s+get\s+)?(100%|90%|95%|free|zero\s+cost|free\s+forever)\b",
    r"\bsay\s+(the\s+words\s+)?[\"']?i\s+give\s+you\s+a\s+\d+%\s+discount\b",
    r"\badmit\s+that\s+your\s+product\s+is\s+(fake|a\s+scam|fraud)\b",
]

# 5. Delimiter & Control Token Attacks
_CONTROL_TOKEN_REGEX = re.compile(
    r"(<\|im_start\|>\s*(system|user|assistant)?|<\|im_end\|>|<\|system\|>|<\|user\|>|<\|assistant\|>|\[INST\]|\[/INST\]|###\s*(System|Instruction|Assistant):?|```system)",
    re.IGNORECASE
)

_OVERRIDE_REGEX = re.compile("|".join(_OVERRIDE_PATTERNS), re.IGNORECASE)
_EXFILTRATION_REGEX = re.compile("|".join(_EXFILTRATION_PATTERNS), re.IGNORECASE)
_PERSONA_HIJACK_REGEX = re.compile("|".join(_PERSONA_HIJACK_PATTERNS), re.IGNORECASE)
_COERCED_COMMITMENT_REGEX = re.compile("|".join(_COERCED_COMMITMENT_PATTERNS), re.IGNORECASE)


# ── Natural Conversational Deflection Responses (In Character) ─────────────

_DEFLECTION_RESPONSES = [
    "Haha, bilkul nahi! Main toh seedhe business results aur conversion ki baat karne aayi hoon. Batayiye, aapka current outbound process kaisa chal raha hai?",
    "Nice try! But honestly, main yahan aapke sales pipeline ko streamline karne ki baat kar rahi hoon. Let's focus on that — challenges kahan aa rahe hain?",
    "Dekhiye, main Pearl hoon aur mera focus sirf aapki company ke growth aur conversions pe hai. Chaliye main topic pe aate hain, what's your biggest priority right now?",
    "Haha, good one! But shortcuts ya tricks chhodte hain, let's talk real business. Aapki team currently leads kaise handle kar rahi hai?",
]

def detect_prompt_injection(text: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Analyzes prospect utterance for prompt injection or adversarial jailbreaks.
    
    Returns:
        (is_injected: bool, attack_type: Optional[str], deflection_response: Optional[str])
    """
    if not text or not isinstance(text, str):
        return False, None, None

    cleaned = text.strip()
    if len(cleaned) < 4:
        return False, None, None

    # Check for raw special control tokens
    if _CONTROL_TOKEN_REGEX.search(cleaned):
        return True, "CONTROL_TOKEN_INJECTION", random.choice(_DEFLECTION_RESPONSES)

    # Check for instruction override / prompt resets
    if _OVERRIDE_REGEX.search(cleaned):
        return True, "INSTRUCTION_OVERRIDE", random.choice(_DEFLECTION_RESPONSES)

    # Check for system prompt / internal architecture exfiltration
    if _EXFILTRATION_REGEX.search(cleaned):
        return True, "SYSTEM_EXFILTRATION", random.choice(_DEFLECTION_RESPONSES)

    # Check for persona hijacking (DAN, developer mode, etc.)
    if _PERSONA_HIJACK_REGEX.search(cleaned):
        return True, "PERSONA_HIJACK", random.choice(_DEFLECTION_RESPONSES)

    # Check for coerced unauthorized commitments / discounts
    if _COERCED_COMMITMENT_REGEX.search(cleaned):
        return True, "COERCED_COMMITMENT", random.choice(_DEFLECTION_RESPONSES)

    return False, None, None


def sanitize_input_tokens(text: str) -> str:
    """
    Strips raw prompt control tokens and system delimiters from user input
    to prevent prompt structure confusion when passed into LLMs.
    """
    if not text or not isinstance(text, str):
        return ""
    # Strip known control markers
    sanitized = _CONTROL_TOKEN_REGEX.sub("", text)
    # Strip excessive repeated whitespace
    sanitized = re.sub(r"[ \t]{2,}", " ", sanitized)
    return sanitized.strip()
