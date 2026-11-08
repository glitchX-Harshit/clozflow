"""
Pearl Tool Execution Engine
Comprehensive execution, live testing, regex validation, data verification,
mock simulation, and cURL command parsing for Clozflow Agent Tools.
"""
import re
import shlex
import time
import json
import asyncio
from typing import Dict, Any, List, Optional
from datetime import datetime

try:
    import httpx
except ImportError:
    httpx = None


# ── Variable Substitution Helper ─────────────────────────────────────────────

def substitute_variables_in_string(text: str, variables: Optional[Dict[str, Any]] = None) -> str:
    """Substitute {{var_name}} or {{var_name | fallback}} in text using provided variables dictionary."""
    if not text:
        return ""
    if not variables:
        # Check if fallback syntax can still be resolved even if variables is empty
        def _fallback_only(match):
            inner = match.group(1).strip()
            if "|" in inner:
                parts = inner.split("|", 1)
                return parts[1].strip().strip('"\'')
            return match.group(0)
        return re.sub(r"\{\{([^}]+)\}\}", _fallback_only, text)

    def _replace(match):
        var_content = match.group(1).strip()
        fallback = None
        var_name = var_content
        if "|" in var_content:
            parts = var_content.split("|", 1)
            var_name = parts[0].strip()
            fallback = parts[1].strip().strip('"\'')

        val = variables.get(var_name)
        if val is not None and str(val).strip() != "":
            return str(val)
        if fallback is not None:
            return fallback
        return ""

    return re.sub(r"\{\{([^}]+)\}\}", _replace, text)


# ── cURL Command Parser ──────────────────────────────────────────────────────

def parse_curl_command(curl_text: str) -> Dict[str, Any]:
    """
    Parse a cURL command string into structured API configuration:
    - method (GET, POST, PUT, DELETE, PATCH)
    - url
    - headers: list of { key, value, enabled }
    - params: list of { key, value, enabled }
    - auth: { type, token, username, password, apiKey, headerName }
    - body: str
    - body_type: 'json' | 'raw' | 'form_data'
    """
    if not curl_text:
        return {
            "method": "GET",
            "url": "",
            "headers": [],
            "params": [],
            "auth": {"type": "none"},
            "body": "",
            "body_type": "json"
        }

    # Normalize line continuations and multiple spaces
    normalized = curl_text.replace("\\\r\n", " ").replace("\\\n", " ").replace("\\\r", " ").strip()
    
    # Strip curl or curl.exe prefix case-insensitively
    normalized = re.sub(r"^(?:curl\.exe|curl)\s+", "", normalized, flags=re.IGNORECASE).strip()

    tokens = []
    try:
        tokens = shlex.split(normalized, posix=True)
    except Exception:
        try:
            tokens = shlex.split(normalized, posix=False)
        except Exception:
            tokens = normalized.split()

    method = "GET"
    url = ""
    headers = []
    body_parts = []
    auth = {"type": "none"}
    explicit_method = False

    i = 0
    n = len(tokens)
    while i < n:
        token = tokens[i]

        # Method: -X, --request
        if token in ("-X", "--request") and i + 1 < n:
            method = tokens[i + 1].upper().strip("\"'")
            explicit_method = True
            i += 2
            continue

        # Force GET: -G, --get
        elif token in ("-G", "--get"):
            method = "GET"
            explicit_method = True
            i += 1
            continue

        # Headers: -H, --header
        elif token in ("-H", "--header") and i + 1 < n:
            raw_h = tokens[i + 1].strip("\"'")
            if ":" in raw_h:
                h_key, h_val = raw_h.split(":", 1)
                h_key = h_key.strip()
                h_val = h_val.strip()

                h_lower = h_key.lower()
                if h_lower == "authorization":
                    if h_val.lower().startswith("bearer "):
                        auth = {"type": "bearer", "token": h_val[7:].strip()}
                    elif h_val.lower().startswith("basic "):
                        basic_b64 = h_val[6:].strip()
                        u, p = "", ""
                        try:
                            import base64
                            decoded = base64.b64decode(basic_b64).decode(errors="ignore")
                            if ":" in decoded:
                                u, p = decoded.split(":", 1)
                        except Exception:
                            pass
                        auth = {"type": "basic", "token": basic_b64, "username": u, "password": p}
                    else:
                        auth = {"type": "apiKey", "headerName": h_key, "apiKey": h_val}
                elif h_lower in ("x-api-key", "api-key", "x-auth-token", "apikey"):
                    auth = {"type": "apiKey", "headerName": h_key, "apiKey": h_val}

                headers.append({"key": h_key, "value": h_val, "enabled": True})
            i += 2
            continue

        # Body: -d, --data, --data-raw, --data-binary, --data-urlencode, --json
        elif token in ("-d", "--data", "--data-raw", "--data-binary", "--data-urlencode", "--json") and i + 1 < n:
            body_parts.append(tokens[i + 1].strip("\"'"))
            if not explicit_method:
                method = "POST"
            i += 2
            continue

        # Basic Auth: -u, --user
        elif token in ("-u", "--user") and i + 1 < n:
            user_pass = tokens[i + 1].strip("\"'")
            parts = user_pass.split(":", 1)
            auth = {
                "type": "basic",
                "username": parts[0],
                "password": parts[1] if len(parts) > 1 else ""
            }
            i += 2
            continue

        # Explicit URL flag: --url
        elif token == "--url" and i + 1 < n:
            url = tokens[i + 1].strip("\"'")
            i += 2
            continue

        # URL detection (starts with http or contains dot, ignoring switches and .exe commands)
        elif not url and (token.startswith("http://") or token.startswith("https://") or ("." in token and not token.startswith("-") and not token.lower().endswith(".exe"))):
            url = token.strip("\"'")
            i += 1
            continue

        else:
            i += 1

    body = "&".join(body_parts) if len(body_parts) > 1 else (body_parts[0] if body_parts else "")

    # Extract query params from URL if present
    params = []
    if "?" in url:
        base_url, query_str = url.split("?", 1)
        url = base_url
        for pair in query_str.split("&"):
            if "=" in pair:
                pk, pv = pair.split("=", 1)
                params.append({"key": pk, "value": pv, "enabled": True})
            elif pair:
                params.append({"key": pair, "value": "", "enabled": True})

    # Detect body type
    body_type = "json"
    content_type = next((h["value"] for h in headers if h["key"].lower() == "content-type"), "")
    if "application/x-www-form-urlencoded" in content_type:
        body_type = "form_data"
    elif body:
        try:
            json.loads(body)
            body_type = "json"
        except Exception:
            body_type = "form_data" if ("=" in body and not body.strip().startswith("{")) else "raw"

    return {
        "method": method,
        "url": url,
        "headers": headers,
        "params": params,
        "auth": auth,
        "body": body,
        "body_type": body_type
    }


# ── JSON Path & Field Extractor ──────────────────────────────────────────────

def extract_json_path(data: Any, path: str) -> Any:
    """
    Extract a nested field value from a JSON object or array.
    Supports:
      - 'order.id', 'data.customer.phone'
      - 'items[0].sku', 'matrix[0][1]'
      - negative indices: 'deliveries[-1].status'
      - root arrays: '[0].id', '$[0].id'
      - bracket notation: "data['order']['status']", 'data["items"][0]["sku"]'
      - dot numbers: 'items.0.sku'
      - '@order.status', '$.order.status', 'response.order.status'
    """
    if data is None or path is None:
        return None

    clean_path = str(path).strip()
    if clean_path.startswith("@"):
        clean_path = clean_path[1:].strip()
    if clean_path.startswith("response."):
        clean_path = clean_path[9:].strip()
    elif clean_path == "response":
        return data

    if clean_path.startswith("$."):
        clean_path = clean_path[2:].strip()
    elif clean_path == "$" or clean_path == "":
        return data
    elif clean_path.startswith("$"):
        clean_path = clean_path[1:].strip()

    # Convert bracket access `['key']` or `["key"]` to `.key`, and `[0]` to `.[0]`
    clean_path = re.sub(r"\[(['\"])(.*?)\1\]", r".\2", clean_path)
    clean_path = re.sub(r"\[(-?\d+)\]", r".[\1]", clean_path)
    if clean_path.startswith("."):
        clean_path = clean_path[1:]

    parts = [p for p in clean_path.split(".") if p]
    current = data

    for part in parts:
        if current is None:
            return None

        # Check for bracket index .[-1] or .[0]
        bracket_match = re.match(r"^\[(-?\d+)\]$", part)
        if bracket_match:
            idx = int(bracket_match.group(1))
            if isinstance(current, list):
                if -len(current) <= idx < len(current):
                    current = current[idx]
                else:
                    return None
            else:
                return None
            continue

        # Check for legacy `name[0]` if any slipped through
        array_match = re.match(r"^(\w+)\[(-?\d+)\]$", part)
        if array_match:
            prop = array_match.group(1)
            idx = int(array_match.group(2))
            if isinstance(current, dict) and prop in current:
                current = current[prop]
                if isinstance(current, list) and -len(current) <= idx < len(current):
                    current = current[idx]
                else:
                    return None
            else:
                return None
            continue

        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list) and (part.isdigit() or (part.startswith("-") and part[1:].isdigit())):
            idx = int(part)
            if -len(current) <= idx < len(current):
                current = current[idx]
            else:
                return None
        else:
            return None

    return current


# ── 1. API Tool Execution Engine ─────────────────────────────────────────────

async def execute_api_tool(config: Dict[str, Any], test_inputs: Optional[Dict[str, Any]] = None, timeout_seconds: int = 10) -> Dict[str, Any]:
    """
    Execute real HTTP request against configured external REST endpoint.
    Handles variable substitution, auth, headers, query params, timeouts,
    latency measurement, and response field extraction.
    """
    inputs = test_inputs or {}
    start_time = time.perf_counter()

    raw_url = config.get("url") or ""
    if not raw_url:
        return {
            "success": False,
            "status_code": 0,
            "latency_ms": 0,
            "response_data": None,
            "extracted_variables": {},
            "error": "Endpoint URL is required."
        }

    # Substitute variables in URL
    url = substitute_variables_in_string(raw_url, inputs)

    method = (config.get("method") or "GET").upper()

    # Query params
    params = {}
    config_params = config.get("params") or []
    if isinstance(config_params, list):
        for p in config_params:
            if p.get("enabled", True) and p.get("key"):
                params[p["key"]] = substitute_variables_in_string(p.get("value") or "", inputs)
    elif isinstance(config_params, dict):
        for k, v in config_params.items():
            params[k] = substitute_variables_in_string(str(v), inputs)

    # Headers
    headers = {}
    config_headers = config.get("headers") or []
    if isinstance(config_headers, list):
        for h in config_headers:
            if h.get("enabled", True) and h.get("key"):
                headers[h["key"]] = substitute_variables_in_string(h.get("value") or "", inputs)
    elif isinstance(config_headers, dict):
        for k, v in config_headers.items():
            headers[k] = substitute_variables_in_string(str(v), inputs)

    # Auth configuration
    auth_config = config.get("auth") or {}
    auth_type = auth_config.get("type", "none")
    if auth_type == "bearer" and auth_config.get("token"):
        token = substitute_variables_in_string(auth_config["token"], inputs)
        headers["Authorization"] = f"Bearer {token}"
    elif auth_type == "apiKey" and auth_config.get("apiKey"):
        key_name = auth_config.get("headerName") or "X-API-Key"
        key_val = substitute_variables_in_string(auth_config["apiKey"], inputs)
        headers[key_name] = key_val
    elif auth_type == "basic" and (auth_config.get("username") or auth_config.get("token")):
        if auth_config.get("token"):
            headers["Authorization"] = f"Basic {auth_config['token']}"
        else:
            import base64
            u = substitute_variables_in_string(auth_config.get("username", ""), inputs)
            p = substitute_variables_in_string(auth_config.get("password", ""), inputs)
            encoded = base64.b64encode(f"{u}:{p}".encode()).decode()
            headers["Authorization"] = f"Basic {encoded}"

    # Body payload
    body_data = None
    json_data = None
    body_config = config.get("body")
    body_str = ""
    if isinstance(body_config, dict):
        body_str = body_config.get("content") or ""
    elif isinstance(body_config, str):
        body_str = body_config

    if body_str and method in ("POST", "PUT", "PATCH", "DELETE"):
        substituted_body = substitute_variables_in_string(body_str, inputs)
        try:
            json_data = json.loads(substituted_body)
        except Exception:
            body_data = substituted_body
            if "content-type" not in [k.lower() for k in headers]:
                headers["Content-Type"] = "text/plain"

    timeout = max(1, min(int(timeout_seconds or config.get("timeout_seconds") or 10), 60))

    if httpx is None:
        return {
            "success": False,
            "status_code": 500,
            "latency_ms": 0,
            "response_data": None,
            "extracted_variables": {},
            "error": "httpx package is not installed on the system."
        }

    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            req_kwargs = {
                "method": method,
                "url": url,
                "headers": headers,
                "params": params if params else None
            }
            if json_data is not None:
                req_kwargs["json"] = json_data
            elif body_data is not None:
                req_kwargs["content"] = body_data

            response = await client.request(**req_kwargs)
            latency_ms = int((time.perf_counter() - start_time) * 1000)

            # Parse response payload
            content_type = response.headers.get("content-type", "")
            try:
                response_json = response.json()
            except Exception:
                response_json = response.text

            # Response mapping to variables
            extracted_variables = {}
            mapping = config.get("response_mapping") or []
            if isinstance(mapping, list) and isinstance(response_json, (dict, list)):
                for item in mapping:
                    field_path = item.get("path") or item.get("field_path")
                    var_name = item.get("variable") or item.get("variable_name")
                    if field_path and var_name:
                        val = extract_json_path(response_json, field_path)
                        if val is not None:
                            extracted_variables[var_name] = val

            is_success = 200 <= response.status_code < 300
            fallback_line = config.get("fallback_response") or "I am having trouble accessing that record right now."

            return {
                "success": is_success,
                "status_code": response.status_code,
                "latency_ms": latency_ms,
                "headers": dict(response.headers),
                "response_data": response_json,
                "extracted_variables": extracted_variables,
                "spoken_feedback": None if is_success else fallback_line,
                "error": None if is_success else f"HTTP {response.status_code}: {response.reason_phrase}"
            }

    except httpx.TimeoutException:
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        fallback = config.get("fallback_response") or "Connection timed out while fetching details."
        return {
            "success": False,
            "status_code": 408,
            "latency_ms": latency_ms,
            "response_data": None,
            "extracted_variables": {},
            "spoken_feedback": fallback,
            "error": f"Request timed out after {timeout} seconds."
        }
    except Exception as exc:
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        fallback = config.get("fallback_response") or "An error occurred while looking up that information."
        return {
            "success": False,
            "status_code": 500,
            "latency_ms": latency_ms,
            "response_data": None,
            "extracted_variables": {},
            "spoken_feedback": fallback,
            "error": f"API execution failed: {str(exc)}"
        }


# ── 2. Data Validator Execution Engine ───────────────────────────────────────

DATA_VALIDATOR_PRESETS = {
    "indian_phone": r"^(?:\+91|0)?[6-9]\d{9}$",
    "pan_card": r"^[A-Z]{5}[0-9]{4}[A-Z]$",
    "pincode": r"^[1-9][0-9]{5}$",
    "email": r"^[^@\s]+@[^@\s]+\.[^@\s]+$",
    "aadhaar_last4": r"^[0-9]{4}$"
}

def execute_data_validator(config: Dict[str, Any], input_value: Any) -> Dict[str, Any]:
    """
    Validate spoken or input string against data type, presets, and custom regex patterns.
    Returns validation result, matched pattern, reason, and configured spoken feedback line.
    """
    raw_val = str(input_value).strip() if input_value is not None else ""
    data_type = (config.get("data_type") or "string").lower()
    preset = config.get("preset") or "custom"
    custom_regex = config.get("regex_pattern") or ""

    spoken_on_success = config.get("spoken_on_success") or "Got it, that looks valid."
    spoken_on_fail = config.get("spoken_on_fail") or "That doesn't seem like a valid entry. Could you please repeat it?"
    spoken_on_error = config.get("spoken_on_error") or "I had trouble validating that format."

    if not raw_val:
        return {
            "success": True,
            "is_valid": False,
            "input_value": raw_val,
            "matched_pattern": None,
            "reason": "Input value is empty.",
            "spoken_feedback": spoken_on_fail
        }

    # 1. Check Data Type
    type_valid = True
    type_reason = ""
    if data_type == "number":
        try:
            float(raw_val.replace(",", "").replace(" ", ""))
        except ValueError:
            type_valid = False
            type_reason = "Value is not a valid numeric amount."
    elif data_type in ("date", "datetime"):
        date_patterns = [
            r"^\d{4}-\d{2}-\d{2}",
            r"^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}",
            r"^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}"
        ]
        if not any(re.search(dp, raw_val, re.IGNORECASE) for dp in date_patterns):
            type_valid = False
            type_reason = "Value does not resemble a valid date format."
    elif data_type == "time":
        time_patterns = [
            r"^\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?",
            r"^\d{1,2}\s*[AaPp][Mm]"
        ]
        if not any(re.search(tp, raw_val, re.IGNORECASE) for tp in time_patterns):
            type_valid = False
            type_reason = "Value does not resemble a valid time format."

    if not type_valid:
        return {
            "success": True,
            "is_valid": False,
            "input_value": raw_val,
            "matched_pattern": None,
            "reason": type_reason,
            "spoken_feedback": spoken_on_fail
        }

    # 2. Check Regex Pattern
    pattern_to_check = custom_regex
    if preset in DATA_VALIDATOR_PRESETS:
        pattern_to_check = DATA_VALIDATOR_PRESETS[preset]

    if pattern_to_check:
        try:
            # Normalize spaces or dashes for phone / pan if appropriate
            test_target = raw_val
            if preset == "indian_phone":
                test_target = re.sub(r"[\s\-\(\)]", "", raw_val)
            elif preset == "pan_card":
                test_target = raw_val.replace(" ", "").upper()
            elif preset == "pincode":
                test_target = raw_val.replace(" ", "")

            is_match = bool(re.search(pattern_to_check, test_target))
            if is_match:
                return {
                    "success": True,
                    "is_valid": True,
                    "input_value": raw_val,
                    "matched_pattern": pattern_to_check,
                    "reason": "Pattern matched successfully.",
                    "spoken_feedback": spoken_on_success
                }
            else:
                return {
                    "success": True,
                    "is_valid": False,
                    "input_value": raw_val,
                    "matched_pattern": pattern_to_check,
                    "reason": f"Input does not conform to pattern '{pattern_to_check}'",
                    "spoken_feedback": spoken_on_fail
                }
        except re.error as re_err:
            return {
                "success": False,
                "is_valid": False,
                "input_value": raw_val,
                "matched_pattern": pattern_to_check,
                "reason": f"Invalid regular expression: {str(re_err)}",
                "spoken_feedback": spoken_on_error
            }

    # If no pattern was specified, type validation alone succeeded
    return {
        "success": True,
        "is_valid": True,
        "input_value": raw_val,
        "matched_pattern": None,
        "reason": f"Conforms to {data_type} format.",
        "spoken_feedback": spoken_on_success
    }


# ── 3. Data Verifier Execution Engine ───────────────────────────────────────

def normalize_verifier_value(val: Any, mode: str) -> str:
    """Normalize input according to configured verifier normalization option."""
    if val is None or str(val).strip() == "":
        return ""
    s = str(val).strip()

    if mode == "strip_phone_formatting":
        # Remove spaces, hyphens, brackets, and +91/0 prefix for reliable telephone matching
        digits = re.sub(r"\D", "", s)
        if digits.startswith("91") and len(digits) > 10:
            digits = digits[2:]
        elif digits.startswith("0") and len(digits) > 10:
            digits = digits[1:]
        return digits

    elif mode == "lowercase":
        return re.sub(r"\s+", " ", s).lower()

    return s


def execute_data_verifier(config: Dict[str, Any], spoken_value: Any, reference_value: Any) -> Dict[str, Any]:
    """
    Verify spoken values (e.g. last 4 digits of phone/card, DOB, order ID) against records on file.
    Applies normalization (strip_phone_formatting, lowercase, none) and match mode (exact_match, contains).
    """
    norm_mode = config.get("normalization") or "strip_phone_formatting"
    match_mode = config.get("match_mode") or "exact_match"

    spoken_on_match = config.get("spoken_on_match") or "Thank you, that matches our records."
    spoken_on_mismatch = config.get("spoken_on_mismatch") or "I'm sorry, that does not match what we have on file."
    spoken_on_error = config.get("spoken_on_error") or "I am having trouble verifying that record right now."

    if reference_value is None or str(reference_value).strip() == "":
        return {
            "success": True,
            "is_match": False,
            "normalized_spoken": str(spoken_value or ""),
            "normalized_reference": "",
            "reason": "Reference record on file is empty.",
            "spoken_feedback": spoken_on_mismatch
        }

    norm_spoken = normalize_verifier_value(spoken_value, norm_mode)
    norm_ref = normalize_verifier_value(reference_value, norm_mode)

    if not norm_spoken:
        return {
            "success": True,
            "is_match": False,
            "normalized_spoken": "",
            "normalized_reference": norm_ref,
            "reason": "Spoken input is empty.",
            "spoken_feedback": spoken_on_mismatch
        }

    if not norm_ref:
        return {
            "success": True,
            "is_match": False,
            "normalized_spoken": norm_spoken,
            "normalized_reference": "",
            "reason": "Normalized reference record is empty.",
            "spoken_feedback": spoken_on_mismatch
        }

    is_match = False
    if match_mode == "exact_match":
        is_match = (norm_spoken == norm_ref)
    elif match_mode == "contains":
        is_match = (norm_spoken in norm_ref) or (norm_ref in norm_spoken)
    else:
        is_match = (norm_spoken == norm_ref)

    return {
        "success": True,
        "is_match": is_match,
        "normalized_spoken": norm_spoken,
        "normalized_reference": norm_ref,
        "match_mode": match_mode,
        "normalization": norm_mode,
        "reason": "Values matched successfully." if is_match else "Values did not match records.",
        "spoken_feedback": spoken_on_match if is_match else spoken_on_mismatch
    }


# ── 4. Mock API Execution Engine ────────────────────────────────────────────

async def execute_mock_api(config: Dict[str, Any], test_inputs: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Simulate API tool calls before the real backend endpoint exists.
    Supports mock latency, mock response JSON body, and @field response extraction.
    """
    inputs = test_inputs or {}
    simulated_latency = max(20, min(int(config.get("simulated_latency_ms") or 150), 3000))
    
    # Custom headers
    resp_headers = {"content-type": "application/json", "x-clozflow-mock": "true"}
    config_headers = config.get("headers") or []
    if isinstance(config_headers, list):
        for h in config_headers:
            if h.get("enabled", True) and h.get("key"):
                resp_headers[h["key"]] = substitute_variables_in_string(h.get("value") or "", inputs)

    # Simulate realistic network wait
    await asyncio.sleep(simulated_latency / 1000.0)

    raw_mock_body = config.get("mock_response_body")
    mock_json = None
    if isinstance(raw_mock_body, dict):
        mock_json = raw_mock_body
    elif isinstance(raw_mock_body, str) and raw_mock_body.strip():
        # Substitute inputs in mock body
        subbed = substitute_variables_in_string(raw_mock_body, inputs)
        try:
            mock_json = json.loads(subbed)
        except Exception:
            mock_json = {"raw": subbed}
    else:
        mock_json = {
            "status": "success",
            "message": "Mock API response verified",
            "timestamp": datetime.utcnow().isoformat()
        }

    # Extract mapped variables
    extracted_variables = {}
    mapping = config.get("response_mapping") or []
    if isinstance(mapping, list) and isinstance(mock_json, (dict, list)):
        for item in mapping:
            field_path = item.get("path") or item.get("field_path")
            var_name = item.get("variable") or item.get("variable_name")
            if field_path and var_name:
                val = extract_json_path(mock_json, field_path)
                if val is not None:
                    extracted_variables[var_name] = val

    spoken_fallback = config.get("fallback_response") or "Mock tool response successfully processed into variables."

    return {
        "success": True,
        "status_code": 200,
        "latency_ms": simulated_latency,
        "headers": resp_headers,
        "response_data": mock_json,
        "extracted_variables": extracted_variables,
        "spoken_feedback": spoken_fallback,
        "error": None
    }


# ── 5. MCP (Model Context Protocol) Engine ───────────────────────────────────

def execute_mcp_tool(config: Dict[str, Any], test_inputs: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Execute or check dynamic tool binding from connected MCP servers.
    """
    server_id = config.get("server_id")
    tool_name = config.get("server_tool_name") or config.get("tool_name")
    
    if not server_id or not tool_name:
        return {
            "success": False,
            "connected": False,
            "status": "not_configured",
            "message": "No integrations connected - Connect a server, then pick its tools",
            "error": "Missing server_id or tool_name"
        }

    return {
        "success": True,
        "connected": True,
        "server_id": server_id,
        "tool_name": tool_name,
        "status": "ready",
        "output": f"MCP tool '{tool_name}' bound from server '{server_id}'",
        "parameters_received": test_inputs or {}
    }


# ── Unified Test Dispatcher ──────────────────────────────────────────────────

async def run_tool_test(tool_type: str, config: Dict[str, Any], test_input: Optional[Dict[str, Any]] = None, timeout_seconds: int = 10) -> Dict[str, Any]:
    """
    Unified entrypoint for the live tool testing endpoint (`POST /api/pearl/agents/{agent_id}/tools/test`).
    """
    inputs = test_input or {}
    t_type = (tool_type or "").lower().strip()

    if t_type == "api_tool":
        return await execute_api_tool(config, test_inputs=inputs, timeout_seconds=timeout_seconds)

    elif t_type == "data_validator":
        input_source = config.get("input_source") or ""
        val = (
            inputs.get("test_value")
            if inputs.get("test_value") is not None
            else inputs.get("value")
            if inputs.get("value") is not None
            else inputs.get("spoken_input")
            if inputs.get("spoken_input") is not None
            else (inputs.get(input_source) if input_source else None)
        )
        if val is None:
            val = ""
        return execute_data_validator(config, input_value=val)

    elif t_type == "data_verifier":
        ref_source = config.get("reference_source") or ""
        spoken_val = inputs.get("spoken_value") if inputs.get("spoken_value") is not None else inputs.get("value")
        if spoken_val is None:
            spoken_val = ""

        ref_from_source = extract_json_path(inputs, ref_source) if ref_source else None
        if ref_from_source is None and ref_source in inputs:
            ref_from_source = inputs[ref_source]

        ref_val = (
            inputs.get("reference_value")
            if inputs.get("reference_value") is not None
            else ref_from_source
            if ref_from_source is not None
            else config.get("reference_value")
            if config.get("reference_value") is not None
            else ""
        )
        return execute_data_verifier(config, spoken_value=spoken_val, reference_value=ref_val)

    elif t_type == "mock_api":
        return await execute_mock_api(config, test_inputs=inputs)

    elif t_type == "mcp":
        return execute_mcp_tool(config, test_inputs=inputs)

    else:
        return {
            "success": False,
            "error": f"Unknown tool type: '{tool_type}'. Expected api_tool, data_validator, data_verifier, mock_api, or mcp."
        }
