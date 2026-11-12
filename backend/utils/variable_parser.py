"""
Dynamic Variable Binding Parser for Python Backend
Parses {{variable_name}} and fallback syntax {{variable_name | "Fallback Value"}},
single-quote fallback {{variable_name | 'Fallback Value'}}, or unquoted {{variable_name | Fallback Value}}.
"""
import re
from typing import Dict, Any, List

VARIABLE_PATTERN = re.compile(
    r'\{\{\s*([a-zA-Z0-9_]+)(?:\s*\|\s*(?:"([^"]*)"|\'([^\']*)\'|([^}]+?)))?\s*\}\}'
)

def _get_fallback_from_match(m) -> str:
    """Helper to extract fallback string across double-quote, single-quote, and unquoted groups."""
    if m.group(2) is not None:
        return m.group(2)
    if m.group(3) is not None:
        return m.group(3)
    if m.group(4) is not None:
        return m.group(4).strip()
    return ""

def extract_variables_from_text(text: str) -> List[Dict[str, str]]:
    """Extracts all variable tokens with names and fallback values."""
    if not text:
        return []
    
    seen = {}
    for m in VARIABLE_PATTERN.finditer(text):
        name = m.group(1)
        fallback = _get_fallback_from_match(m)
        if name not in seen:
            seen[name] = {"name": name, "fallback": fallback, "raw": m.group(0)}
        elif not seen[name]["fallback"] and fallback:
            seen[name]["fallback"] = fallback
            
    return list(seen.values())

def substitute_variables_text(
    template: str, 
    values_map: Dict[str, Any] = None,
    use_fallback: bool = True,
    preserve_unmatched: bool = False
) -> str:
    """
    Substitutes variable tokens in template with values from values_map.
    Uses fallback value if present and value is missing or empty.
    """
    if not template:
        return ""
    values_map = values_map or {}

    def _replace(match):
        var_name = match.group(1)
        fallback = _get_fallback_from_match(match)
        val = values_map.get(var_name)
        
        if val is not None and str(val).strip() != "":
            return str(val)
        if use_fallback and fallback:
            return fallback
        if preserve_unmatched:
            return match.group(0)
        return ""

    return VARIABLE_PATTERN.sub(_replace, template)
