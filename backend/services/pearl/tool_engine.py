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
import urllib.parse
import unicodedata
import functools
import random
from typing import Dict, Any, List, Optional, Tuple, Union, Callable, Set
from datetime import datetime, date

try:
    import httpx
except ImportError:
    httpx = None

try:
    from .outbound_http import (
        create_guarded_client, guarded_request, OutboundRequestBlocked, OutboundResolutionError,
        ResponseTooLarge, TooManyRedirects, DEFAULT_MAX_RESPONSE_BYTES,
    )
except (ImportError, ValueError):
    from services.pearl.outbound_http import (
        create_guarded_client, guarded_request, OutboundRequestBlocked, OutboundResolutionError,
        ResponseTooLarge, TooManyRedirects, DEFAULT_MAX_RESPONSE_BYTES,
    )

_tool_http_client: Optional[Any] = None

def _get_tool_http_client() -> Any:
    """Shared, SSRF-guarded client for user-configured tool URLs (no redirects, env proxies or cookies)."""
    global _tool_http_client
    if _tool_http_client is None or getattr(_tool_http_client, "is_closed", False):
        _tool_http_client = create_guarded_client(max_connections=20, max_keepalive_connections=10)
    return _tool_http_client


# ── Compiled Regular Expressions ─────────────────────────────────────────────
_DOUBLE_BRACE_RE = re.compile(r"\{\{([^}]+)\}\}")
_SINGLE_BRACE_RE = re.compile(r"\{([a-zA-Z0-9_\-.]+)\}")
_CURL_PREFIX_RE = re.compile(r"^(?:curl\.exe|curl)\s+", flags=re.IGNORECASE)

_BRACKET_QUOTE_RE = re.compile(r"\[(['\"])(.*?)\1\]")
_BRACKET_NUM_RE = re.compile(r"\[(-?\d+)\]")
_BRACKET_INDEX_RE = re.compile(r"^\[(-?\d+)\]$")
_ARRAY_MATCH_RE = re.compile(r"^(\w+)\[(-?\d+)\]$")

_MISSING_TOKEN_RE = re.compile(r"\{+([a-zA-Z0-9_\-.]+)\}+")
_TEMPLATE_TOKEN_RE = re.compile(r"@([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)")

_DATE_PATTERNS_COMPILED = [
    re.compile(r"^\d{4}-\d{2}-\d{2}", re.IGNORECASE),
    re.compile(r"^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}", re.IGNORECASE),
    re.compile(r"^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}", re.IGNORECASE)
]
_TIME_PATTERNS_COMPILED = [
    re.compile(r"^\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?", re.IGNORECASE),
    re.compile(r"^\d{1,2}\s*[AaPp][Mm]", re.IGNORECASE)
]

_PHONE_PUNCT_RE = re.compile(r"[\s\-\(\)]")
_DATE_TIME_SUFFIX_RE = re.compile(r"[T\s]\d{1,2}:\d{2}(?::\d{2})?.*$")
_DATE_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ORDINAL_SUFFIX_RE = re.compile(r"(\d+)(?:st|nd|rd|th)")
_WHITESPACE_RE = re.compile(r"\s+")
_DATE_SEP_RE = re.compile(r"^\d{1,4}[./\-]\d{1,2}[./\-]\d{1,4}$")
_DATE_SEP_SUB_RE = re.compile(r"[./]")
_PHONE_EXT_RE = re.compile(r"^(.*?)(?:\s*(?:ext|x|#|extension)\.?\s*(\d+))?$", flags=re.IGNORECASE)
_NON_DIGITS_RE = re.compile(r"\D")
_ALPHANUMERIC_RE = re.compile(r"[a-zA-Z0-9]")


# ── Variable Substitution Helper ─────────────────────────────────────────────

def substitute_variables_in_string(text: str, variables: Optional[Dict[str, Any]] = None, url_encode_path: bool = False) -> str:
    """
    Substitute {{var_name}} or {{var_name | fallback}} or {var_name} in text using provided variables dictionary.
    Supports nested variable paths (e.g. {{lead.phone}}), fallback defaults, and URL path-safe encoding.
    """
    if not text or "{" not in text:
        return text or ""
    if not variables:
        # Check if fallback syntax can still be resolved even if variables is empty
        def _fallback_only(match):
            inner = match.group(1).strip()
            if "|" in inner:
                parts = inner.split("|", 1)
                return parts[1].strip().strip('"\'')
            return match.group(0)
        return _DOUBLE_BRACE_RE.sub(_fallback_only, text)

    def _get_val(k: str) -> Any:
        v = variables.get(k)
        if v is None and "." in k:
            v = extract_json_path(variables, k)
        return v

    def _replace(match):
        var_content = match.group(1).strip()
        fallback = None
        var_name = var_content
        if "|" in var_content:
            parts = var_content.split("|", 1)
            var_name = parts[0].strip()
            fallback = parts[1].strip().strip('"\'')

        val = _get_val(var_name)
        if val is not None and str(val).strip() != "":
            s_val = str(val)
            return urllib.parse.quote(s_val, safe="") if url_encode_path else s_val
        if fallback is not None:
            return fallback
        return match.group(0)

    res = _DOUBLE_BRACE_RE.sub(_replace, text)
    if variables:
        def _replace_single_brace(m):
            k = m.group(1).strip()
            val = _get_val(k)
            if val is not None and str(val).strip() != "":
                s_val = str(val)
                return urllib.parse.quote(s_val, safe="") if url_encode_path else s_val
            return m.group(0)
        res = _SINGLE_BRACE_RE.sub(_replace_single_brace, res)
    return res


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
    normalized = _CURL_PREFIX_RE.sub("", normalized).strip()

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

    if not clean_path:
        return data

    parts = _parse_json_path(clean_path)
    current = data

    for item in parts:
        if current is None:
            return None
        kind = item[0]
        if kind == 'bracket_idx':
            idx = item[1]
            if isinstance(current, list) and -len(current) <= idx < len(current):
                current = current[idx]
            else:
                return None
        elif kind == 'prop':
            prop = item[1]
            if isinstance(current, dict):
                current = current.get(prop)
            else:
                return None
        elif kind == 'int_or_prop':
            idx, prop = item[1], item[2]
            if isinstance(current, dict):
                current = current.get(prop)
            elif isinstance(current, list) and -len(current) <= idx < len(current):
                current = current[idx]
            else:
                return None
        else:
            return None

    return current


@functools.lru_cache(maxsize=2048)
def _parse_json_path(clean_path: str) -> tuple:
    p = _BRACKET_QUOTE_RE.sub(r".\2", clean_path)
    p = _BRACKET_NUM_RE.sub(r".[\1]", p)
    if p.startswith("."):
        p = p[1:]

    raw_parts = [seg for seg in p.split(".") if seg]
    parsed_parts = []
    for part in raw_parts:
        bracket_match = _BRACKET_INDEX_RE.match(part)
        if bracket_match:
            parsed_parts.append(('bracket_idx', int(bracket_match.group(1))))
            continue

        array_match = _ARRAY_MATCH_RE.match(part)
        if array_match:
            parsed_parts.append(('prop', array_match.group(1)))
            parsed_parts.append(('bracket_idx', int(array_match.group(2))))
            continue

        if part.isdigit() or (part.startswith("-") and part[1:].isdigit()):
            parsed_parts.append(('int_or_prop', int(part), part))
        else:
            parsed_parts.append(('prop', part))
    return tuple(parsed_parts)


# ── 1. API Tool Execution Engine ─────────────────────────────────────────────

async def execute_api_tool(config: Dict[str, Any], test_inputs: Optional[Dict[str, Any]] = None, timeout_seconds: int = 10) -> Dict[str, Any]:
    """
    Execute real HTTP request against configured external REST endpoint.
    Handles variable substitution, auth, headers, query params, timeouts,
    latency measurement, and response field extraction.
    """
    inputs = test_inputs or {}
    start_time = time.perf_counter()

    raw_url = (config.get("url") or "").strip()
    if not raw_url:
        return {
            "success": False,
            "status_code": 0,
            "latency_ms": 0,
            "response_data": None,
            "extracted_variables": {},
            "error": "Endpoint URL is required."
        }

    # Split into path and query if query exists
    if "?" in raw_url:
        base_path, query_part = raw_url.split("?", 1)
        substituted_path = substitute_variables_in_string(base_path, inputs, url_encode_path=True)
        substituted_query = substitute_variables_in_string(query_part, inputs, url_encode_path=False)
        url = f"{substituted_path}?{substituted_query}"
    else:
        url = substitute_variables_in_string(raw_url, inputs, url_encode_path=True)

    # Check for missing path parameters (unsubstituted {tokens} or {{tokens}})
    path_part_check = url.split("?", 1)[0].split("#", 1)[0]
    raw_missing = _MISSING_TOKEN_RE.findall(path_part_check)
    missing_tokens = list(dict.fromkeys(raw_missing))
    if missing_tokens:
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        fallback = config.get("fallback_response") or "Missing required details to look up that record."
        return {
            "success": False,
            "status_code": 400,
            "latency_ms": latency_ms,
            "response_data": None,
            "extracted_variables": {},
            "spoken_feedback": fallback,
            "error": f"Missing required path parameter(s): {', '.join(missing_tokens)}"
        }

    # Validate URL protocol scheme
    if not url.startswith("http://") and not url.startswith("https://"):
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        return {
            "success": False,
            "status_code": 400,
            "latency_ms": latency_ms,
            "response_data": None,
            "extracted_variables": {},
            "spoken_feedback": config.get("fallback_response") or "Invalid endpoint URL.",
            "error": "Endpoint URL must begin with http:// or https://"
        }

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

    try:
        timeout = max(1, min(int(timeout_seconds or config.get("timeout_seconds") or 10), 60))
    except (ValueError, TypeError):
        timeout = 10

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
        client = _get_tool_http_client()
        # SSRF-guarded: public http(s) destinations only (re-checked on every redirect hop
        # and at connect time), response capped, whole exchange bounded by `timeout`.
        response = await guarded_request(
            client,
            method,
            url,
            headers=headers,
            params=params if params else None,
            json=json_data,
            content=body_data if json_data is None else None,
            timeout=timeout,
            max_response_bytes=DEFAULT_MAX_RESPONSE_BYTES,
        )
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

        # Support clean @field response template (e.g. "The account balance is @balance.")
        response_template = (config.get("response_template") or "").strip()
        spoken_feedback = None
        if response_template and isinstance(response_json, (dict, list)):
            rendered_template = response_template
            for token in _TEMPLATE_TOKEN_RE.findall(response_template):
                val = extract_json_path(response_json, token)
                if val is not None:
                    extracted_variables[token] = val
                    rendered_template = rendered_template.replace(f"@{token}", str(val))
            if 200 <= response.status_code < 300:
                spoken_feedback = rendered_template

        is_success = 200 <= response.status_code < 300
        fallback_line = config.get("fallback_response") or "I am having trouble accessing that record right now."

        if not spoken_feedback:
            spoken_feedback = None if is_success else fallback_line

        reason = getattr(response, "reason_phrase", "")
        if not reason and httpx:
            try:
                reason = httpx.codes.get_reason_phrase(response.status_code)
            except Exception:
                reason = "Request failed"

        err_msg = None
        if not is_success:
            if isinstance(response_json, dict):
                api_err = response_json.get("error") or response_json.get("message") or response_json.get("detail")
                if api_err:
                    err_msg = f"HTTP {response.status_code}: {api_err}"
            elif isinstance(response_json, str) and response_json.strip() and len(response_json) < 200:
                err_msg = f"HTTP {response.status_code}: {response_json.strip()}"
            if not err_msg:
                err_msg = f"HTTP {response.status_code}: {reason or 'Request failed'}"

        return {
            "success": is_success,
            "status_code": response.status_code,
            "latency_ms": latency_ms,
            "headers": dict(response.headers),
            "response_data": response_json,
            "extracted_variables": extracted_variables,
            "spoken_feedback": spoken_feedback,
            "error": err_msg
        }

    except OutboundRequestBlocked as exc:
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        return {
            "success": False,
            "status_code": 403,
            "latency_ms": latency_ms,
            "response_data": None,
            "extracted_variables": {},
            "spoken_feedback": config.get("fallback_response") or "I am having trouble accessing that record right now.",
            "error": f"Blocked outbound request: {exc}"
        }
    except OutboundResolutionError as exc:
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        return {
            "success": False,
            "status_code": 503,
            "latency_ms": latency_ms,
            "response_data": None,
            "extracted_variables": {},
            "spoken_feedback": config.get("fallback_response") or "Unable to connect to the external endpoint.",
            "error": f"Connection error: {exc}."
        }
    except (ResponseTooLarge, TooManyRedirects) as exc:
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        return {
            "success": False,
            "status_code": 502,
            "latency_ms": latency_ms,
            "response_data": None,
            "extracted_variables": {},
            "spoken_feedback": config.get("fallback_response") or "An error occurred while communicating with the service.",
            "error": str(exc)
        }
    except (httpx.TimeoutException, asyncio.TimeoutError):
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
    except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        fallback = config.get("fallback_response") or "Unable to connect to the external endpoint."
        return {
            "success": False,
            "status_code": 503,
            "latency_ms": latency_ms,
            "response_data": None,
            "extracted_variables": {},
            "spoken_feedback": fallback,
            "error": f"Connection error: Could not reach endpoint {url}."
        }
    except httpx.HTTPError as exc:
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        fallback = config.get("fallback_response") or "An error occurred while communicating with the service."
        return {
            "success": False,
            "status_code": 502,
            "latency_ms": latency_ms,
            "response_data": None,
            "extracted_variables": {},
            "spoken_feedback": fallback,
            "error": f"HTTP transport error: {str(exc)}"
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

COMPILED_VALIDATOR_PRESETS = {
    k: re.compile(v) for k, v in DATA_VALIDATOR_PRESETS.items()
}

@functools.lru_cache(maxsize=256)
def _compile_user_regex(pattern: str):
    return re.compile(pattern)

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
        if not any(dp.search(raw_val) for dp in _DATE_PATTERNS_COMPILED):
            type_valid = False
            type_reason = "Value does not resemble a valid date format."
    elif data_type == "time":
        if not any(tp.search(raw_val) for tp in _TIME_PATTERNS_COMPILED):
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
    compiled_pat = None
    if preset in DATA_VALIDATOR_PRESETS:
        pattern_to_check = DATA_VALIDATOR_PRESETS[preset]
        compiled_pat = COMPILED_VALIDATOR_PRESETS.get(preset)

    if pattern_to_check:
        try:
            # Normalize spaces or dashes for phone / pan if appropriate
            test_target = raw_val
            if preset == "indian_phone":
                test_target = _PHONE_PUNCT_RE.sub("", raw_val)
            elif preset == "pan_card":
                test_target = raw_val.replace(" ", "").upper()
            elif preset == "pincode":
                test_target = raw_val.replace(" ", "")

            if compiled_pat is None:
                compiled_pat = _compile_user_regex(pattern_to_check)

            is_match = bool(compiled_pat.search(test_target))
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

def normalize_date_string(val: Any) -> Optional[str]:
    """Parse various date formats into canonical YYYY-MM-DD with strict calendar validation."""
    if val is None:
        return None
    if isinstance(val, (datetime, date)):
        return val.strftime("%Y-%m-%d")

    s = unicodedata.normalize("NFKC", str(val)).strip()
    if not s:
        return None

    # Strip time component if present (e.g. 1990-05-15T00:00:00Z, 1990-05-15 14:30:00)
    s_clean = _DATE_TIME_SUFFIX_RE.sub("", s).strip()

    # Validate standard ISO format YYYY-MM-DD with strict datetime.strptime
    if _DATE_ISO_RE.match(s_clean):
        try:
            dt = datetime.strptime(s_clean, "%Y-%m-%d")
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            return None

    # Remove ordinal suffixes like 1st, 2nd, 3rd, 4th, 21st, 22nd
    s_clean = _ORDINAL_SUFFIX_RE.sub(r"\1", s_clean)
    s_clean = s_clean.replace(",", " ").strip()
    s_clean = _WHITESPACE_RE.sub(" ", s_clean)

    # Normalize mixed separators e.g. 15/05.2024 or 15-05/2024 into unified -
    if _DATE_SEP_RE.search(s_clean):
        s_clean = _DATE_SEP_SUB_RE.sub("-", s_clean)

    date_formats = [
        "%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d",
        "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y",
        "%m-%d-%Y", "%m/%d/%Y",
        "%d %b %Y", "%d %B %Y",
        "%b %d %Y", "%B %d %Y",
        "%Y %b %d", "%Y %B %d",
        # Month names with separators
        "%d-%b-%Y", "%d-%B-%Y",
        "%d/%b/%Y", "%d/%B/%Y",
        "%d.%b.%Y", "%d.%B.%Y",
        "%b-%d-%Y", "%B-%d-%Y",
        "%b/%d/%Y", "%B/%d/%Y",
        # 2-digit year formats
        "%d-%m-%y", "%d/%m/%y", "%d.%m.%y",
        "%m-%d-%y", "%m/%d/%y",
        "%d-%b-%y", "%d-%B-%y",
        "%d/%b/%y", "%d/%B/%y",
        "%d %b %y", "%d %B %y",
        "%b-%d-%y", "%B-%d-%y",
        "%b %d %y", "%B %d %y"
    ]

    for fmt in date_formats:
        try:
            dt = datetime.strptime(s_clean, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            pass

    return None


def normalize_phone_string(val: Any) -> str:
    """Normalize phone number by stripping country prefix, spaces, and formatting characters."""
    if val is None:
        return ""
    s = unicodedata.normalize("NFKC", str(val)).strip()
    if not s:
        return ""

    # Check for extension syntax e.g. "ext 123", "x4401", "#99"
    # If string is only an extension like "x401" or "ext 123", extract extension digits
    # If string has primary phone plus extension, e.g. "+91 98765-43210 ext 4401", keep primary phone
    ext_match = _PHONE_EXT_RE.search(s)
    if ext_match and ext_match.group(2) and ext_match.group(1).strip():
        primary_part = ext_match.group(1).strip()
        primary_digits = _NON_DIGITS_RE.sub("", primary_part)
        if len(primary_digits) >= 7:
            s = primary_part

    digits = _NON_DIGITS_RE.sub("", s)
    if not digits:
        return ""

    # Strip international call access codes: "00" (EU/Asia) or "011" (US/Canada)
    if digits.startswith("00") and len(digits) > 8:
        digits = digits[2:]
    elif digits.startswith("011") and len(digits) > 9:
        digits = digits[3:]

    # India: 91 country code without +
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("91") and len(digits) == 13 and digits[2] == "0":
        # 91 + trunk 0 + 10 digits
        digits = digits[3:]
    elif digits.startswith("91") and len(digits) > 12:
        digits = digits[2:]

    # UK: 44 country code without +
    elif digits.startswith("44") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("44") and len(digits) == 13 and digits[2] == "0":
        # +44 (0) 7911...
        digits = digits[3:]

    # US / Canada: 1 country code without +
    elif digits.startswith("1") and len(digits) == 11:
        digits = digits[1:]

    # Local trunk prefix 0: 09876543210 -> 9876543210 (11 digits starting with 0)
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]

    return digits


def normalize_verifier_value(val: Any, mode: str) -> str:
    """Normalize input according to configured verifier normalization option (none, phone, date, text)."""
    if val is None or str(val).strip() == "":
        return ""
    s = unicodedata.normalize("NFKC", str(val)).strip()
    norm_mode = (mode or "none").lower()

    if norm_mode in ("phone", "strip_phone_formatting"):
        return normalize_phone_string(s)

    elif norm_mode == "date":
        standardized = normalize_date_string(s)
        return standardized if standardized is not None else s

    elif norm_mode in ("text", "lowercase"):
        return _WHITESPACE_RE.sub(" ", s).lower()

    return s


def execute_data_verifier(config: Dict[str, Any], spoken_value: Any, reference_value: Any) -> Dict[str, Any]:
    """
    Verify caller spoken or extracted values (e.g. last 4 digits of phone/card, DOB, order ID) against records on file.
    Supports input sources: fixed_value, agent_variable, let_agent_decide.
    Supports normalization: none, phone, date, text (with backward compatibility).
    Supports match modes: exact_match, last_n, first_n, contains, date_equals.
    """
    norm_mode = (config.get("normalize_as") or config.get("normalization") or "none").lower()
    match_mode = (config.get("match_mode") or "exact_match").lower()
    try:
        raw_n = config.get("match_n")
        match_n = int(raw_n) if raw_n is not None and str(raw_n).strip() != "" else 4
        if match_n <= 0:
            match_n = 4
    except (ValueError, TypeError):
        match_n = 4

    # Support spoken_responses object and backward-compatible flat keys (Original ClozFlow Phrasing)
    spoken_responses = config.get("spoken_responses") or {}
    spoken_on_match = (
        spoken_responses.get("on_match")
        or config.get("spoken_on_match")
        or "Thanks — that matches our records on file."
    )
    spoken_on_mismatch = (
        spoken_responses.get("on_no_match")
        or config.get("spoken_on_mismatch")
        or "That doesn't match what we have on record. Could you please double-check?"
    )
    spoken_on_error = (
        spoken_responses.get("on_error")
        or config.get("spoken_on_error")
        or "I'm experiencing an issue checking those details right now. Let's try again in a moment."
    )

    if reference_value is None or str(reference_value).strip() == "":
        return {
            "success": True,
            "is_match": False,
            "normalized_spoken": str(spoken_value or ""),
            "normalized_reference": "",
            "match_mode": match_mode,
            "normalize_as": norm_mode,
            "match_n": match_n,
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
            "match_mode": match_mode,
            "normalize_as": norm_mode,
            "match_n": match_n,
            "reason": "Spoken input is empty or invalid format.",
            "spoken_feedback": spoken_on_mismatch
        }

    if not norm_ref:
        return {
            "success": True,
            "is_match": False,
            "normalized_spoken": norm_spoken,
            "normalized_reference": "",
            "match_mode": match_mode,
            "normalize_as": norm_mode,
            "match_n": match_n,
            "reason": "Normalized reference record is empty.",
            "spoken_feedback": spoken_on_mismatch
        }

    # Security check: inputs with only punctuation/spaces/dashes must not match
    if not _ALPHANUMERIC_RE.search(norm_spoken) or not _ALPHANUMERIC_RE.search(norm_ref):
        return {
            "success": True,
            "is_match": False,
            "normalized_spoken": norm_spoken,
            "normalized_reference": norm_ref,
            "match_mode": match_mode,
            "normalize_as": norm_mode,
            "match_n": match_n,
            "reason": "Input or reference record contains no alphanumeric characters.",
            "spoken_feedback": spoken_on_mismatch
        }

    is_match = False
    try:
        if match_mode == "exact_match":
            is_match = (norm_spoken == norm_ref)

        elif match_mode in ("last_n", "last_n_characters"):
            n = max(1, match_n)
            spoken_tail = norm_spoken[-n:] if len(norm_spoken) >= n else norm_spoken
            ref_tail = norm_ref[-n:] if len(norm_ref) >= n else norm_ref
            is_match = (spoken_tail == ref_tail) or (norm_spoken == ref_tail) or (spoken_tail == norm_ref)

        elif match_mode in ("first_n", "first_n_characters"):
            n = max(1, match_n)
            spoken_head = norm_spoken[:n] if len(norm_spoken) >= n else norm_spoken
            ref_head = norm_ref[:n] if len(norm_ref) >= n else norm_ref
            is_match = (spoken_head == ref_head) or (norm_spoken == ref_head) or (spoken_head == norm_ref)

        elif match_mode == "contains":
            if not norm_spoken or not norm_ref:
                is_match = False
            else:
                is_match = (norm_spoken in norm_ref) or (norm_ref in norm_spoken)

        elif match_mode == "date_equals":
            d_spoken = normalize_date_string(spoken_value)
            d_ref = normalize_date_string(reference_value)
            if d_spoken and d_ref:
                is_match = (d_spoken == d_ref)
            else:
                # Both must be valid parseable dates to match
                is_match = False

        else:
            is_match = (norm_spoken == norm_ref)

    except Exception as exc:
        return {
            "success": False,
            "is_match": False,
            "normalized_spoken": norm_spoken,
            "normalized_reference": norm_ref,
            "match_mode": match_mode,
            "normalize_as": norm_mode,
            "match_n": match_n,
            "reason": f"Verification evaluation error: {str(exc)}",
            "spoken_feedback": spoken_on_error,
            "error": str(exc)
        }

    return {
        "success": True,
        "is_match": is_match,
        "normalized_spoken": norm_spoken,
        "normalized_reference": norm_ref,
        "match_mode": match_mode,
        "normalize_as": norm_mode,
        "match_n": match_n,
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
    Defensively sanitizes all inputs and handles malformed payloads without crashing the process.
    """
    start_time = time.perf_counter()
    try:
        t_type = str(tool_type or "").lower().strip()
        cfg = config if isinstance(config, dict) else {}
        inputs = test_input if isinstance(test_input, dict) else {}

        try:
            timeout = max(1, min(int(timeout_seconds or cfg.get("timeout_seconds") or 10), 60))
        except (ValueError, TypeError):
            timeout = 10

        if t_type == "api_tool":
            return await execute_api_tool(cfg, test_inputs=inputs, timeout_seconds=timeout)

        elif t_type == "data_validator":
            input_source = cfg.get("input_source") or ""
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
            return execute_data_validator(cfg, input_value=val)

        elif t_type == "data_verifier":
            input_source = cfg.get("input_source") or "let_agent_decide"
            reference_source = cfg.get("reference_source") or "agent_variable"

            # 1. Resolve spoken / test value
            spoken_val = None
            if input_source == "fixed_value":
                spoken_val = (
                    cfg.get("input_value")
                    if cfg.get("input_value") is not None
                    else inputs.get("input_value")
                    if inputs.get("input_value") is not None
                    else inputs.get("spoken_value")
                    if inputs.get("spoken_value") is not None
                    else inputs.get("value")
                )
            elif input_source == "agent_variable":
                var_name = str(cfg.get("input_variable") or cfg.get("input_source_variable") or "").strip()
                if var_name:
                    spoken_val = extract_json_path(inputs, var_name)
                    if spoken_val is None and var_name in inputs:
                        spoken_val = inputs[var_name]
                    if spoken_val == var_name and inputs.get("spoken_value") and inputs.get("spoken_value") != var_name:
                        spoken_val = inputs.get("spoken_value")
                if spoken_val is None or (var_name and spoken_val == var_name):
                    spoken_val = (
                        inputs.get("spoken_value")
                        if inputs.get("spoken_value") is not None
                        else (inputs.get("input_value") or inputs.get("value"))
                    )
            else:  # let_agent_decide
                spoken_val = (
                    inputs.get("spoken_value")
                    if inputs.get("spoken_value") is not None
                    else inputs.get("caller_speech")
                    if inputs.get("caller_speech") is not None
                    else inputs.get("value")
                    if inputs.get("value") is not None
                    else inputs.get("test_value")
                )

            if spoken_val is None:
                spoken_val = ""

            # 2. Resolve reference value
            ref_val = None
            if reference_source == "fixed_value":
                ref_val = (
                    inputs.get("reference_value")
                    if inputs.get("reference_value") is not None
                    else cfg.get("reference_value")
                )
            else:  # agent_variable
                ref_path = str(cfg.get("reference_value") or cfg.get("reference_source") or "").strip()
                if ref_path:
                    ref_from_source = extract_json_path(inputs, ref_path)
                    if ref_from_source is None and ref_path in inputs:
                        ref_from_source = inputs[ref_path]
                    if ref_from_source == ref_path and inputs.get("reference_value") and inputs.get("reference_value") != ref_path:
                        ref_from_source = inputs.get("reference_value")
                    ref_val = ref_from_source

                if ref_val is None or (ref_path and ref_val == ref_path):
                    sample_ref = inputs.get("reference_value")
                    if sample_ref is not None and sample_ref != ref_path:
                        ref_val = sample_ref
                    else:
                        ref_val = (
                            inputs.get("reference_value")
                            if inputs.get("reference_value") is not None
                            else cfg.get("reference_value")
                        )

            if ref_val is None:
                ref_val = ""

            res = execute_data_verifier(cfg, spoken_value=spoken_val, reference_value=ref_val)
            res["latency_ms"] = int((time.perf_counter() - start_time) * 1000)
            res["input_source"] = input_source
            res["reference_source"] = reference_source
            return res

        elif t_type == "mock_api":
            return await execute_mock_api(cfg, test_inputs=inputs)

        elif t_type == "mcp":
            return execute_mcp_tool(cfg, test_inputs=inputs)

        else:
            return {
                "success": False,
                "error": f"Unknown tool type: '{tool_type}'. Expected api_tool, data_validator, data_verifier, mock_api, or mcp."
            }

    except Exception as exc:
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        return {
            "success": False,
            "status_code": 500,
            "latency_ms": latency_ms,
            "error": f"Tool test execution failed: {str(exc)}",
            "spoken_feedback": (config.get("fallback_response") if isinstance(config, dict) else None) or "Tool test failed due to an unexpected error."
        }


# ── Dual Pattern A + Pattern B Tool Execution Architecture ───────────────────

RUN_MODE_WRITE = "write"
RUN_MODE_READ = "read"

def get_tool_run_mode(tool_or_config: Any) -> str:
    """
    Determine the tool execution mode:
    - 'write': Pattern A (Async non-blocking write/action tool, e.g. WhatsApp, CRM, DNC, Calendar)
    - 'read':  Pattern B (Live lookup tool requiring fetched data before speaking, e.g. pincode, inventory, loan status)
    """
    if tool_or_config is None:
        return RUN_MODE_WRITE

    # 1. First check explicit boolean flag properties or attributes
    is_read = getattr(tool_or_config, "is_read_tool", None)
    if is_read is True:
        return RUN_MODE_READ

    is_async_write = getattr(tool_or_config, "is_async_write", None)
    if is_async_write is False:
        return RUN_MODE_READ

    # 2. Check nested config dictionary or string
    cfg = tool_or_config
    if isinstance(tool_or_config, dict):
        if tool_or_config.get("is_read_tool") is True or str(tool_or_config.get("run_mode") or "").lower().strip() == RUN_MODE_READ:
            return RUN_MODE_READ
        if "config" in tool_or_config:
            cfg = tool_or_config["config"]
    elif hasattr(tool_or_config, "config"):
        cfg = tool_or_config.config

    if isinstance(cfg, str):
        try:
            cfg = json.loads(cfg)
        except Exception:
            cfg = {}

    if isinstance(cfg, dict):
        if cfg.get("is_read_tool") is True or str(cfg.get("run_mode") or "").lower().strip() == RUN_MODE_READ:
            return RUN_MODE_READ
        if cfg.get("is_async_write") is False:
            return RUN_MODE_READ

    # 3. Direct attribute on AgentTool or dataclass
    raw_mode = getattr(tool_or_config, "run_mode", None)
    if raw_mode:
        m = str(raw_mode).lower().strip()
        if m in (RUN_MODE_READ, RUN_MODE_WRITE):
            return m

    # 4. Check negative boolean flags
    if is_read is False:
        return RUN_MODE_WRITE
    if is_async_write is True:
        return RUN_MODE_WRITE

    if isinstance(cfg, dict):
        if str(cfg.get("run_mode") or "").lower().strip() == RUN_MODE_WRITE:
            return RUN_MODE_WRITE
        if cfg.get("is_async_write") is True or cfg.get("is_read_tool") is False:
            return RUN_MODE_WRITE

    # 5. Naming heuristic fallback
    name = getattr(tool_or_config, "name", None) or (tool_or_config.get("name") if isinstance(tool_or_config, dict) else "")
    n_low = str(name).lower().strip()
    read_prefixes = ("get_", "check_", "fetch_", "lookup_", "search_", "read_", "query_", "find_", "verify_")
    if any(n_low.startswith(p) for p in read_prefixes) or "pincode" in n_low or "inventory" in n_low or "stock" in n_low:
        return RUN_MODE_READ

    return RUN_MODE_WRITE


def is_read_tool(tool_or_config: Any) -> bool:
    """Return True if tool operates in Pattern B (live read/lookup)."""
    return get_tool_run_mode(tool_or_config) == RUN_MODE_READ


def is_write_tool(tool_or_config: Any) -> bool:
    """Return True if tool operates in Pattern A (async write/action)."""
    return get_tool_run_mode(tool_or_config) == RUN_MODE_WRITE


# ── Pattern B Conversational Fillers Registry ────────────────────────────────

CONVERSATIONAL_FILLERS: Dict[str, Dict[str, List[str]]] = {
    "Female": {
        "general": [
            "Ek second rukiye, main system mein check kar leti hoon...",
            "Haan bilkul, main ek minute details dekh leti hoon...",
            "Aap bas ek second hold kijiye, main records verify kar leti hoon...",
            "Theek hai, main turant system mein status check kar leti hoon...",
            "Sure, ek minute dijiye, main screen par fetch kar rahi hoon...",
            "Bas ek moment, main backend se details nikaal rahi hoon...",
        ],
        "pincode": [
            "Ek second dijiye, main pincode par serviceability check kar leti hoon...",
            "Haan bilkul, main courier network mein delivery timeline check kar leti hoon...",
            "Bas ek moment rukiye, main aapke area ka delivery status dekh leti hoon...",
        ],
        "inventory": [
            "Ek second rukiye, main warehouse inventory check kar leti hoon...",
            "Haan bilkul, main stock availability screen par dekh leti hoon...",
            "Bas ek second, main size and stock verify kar leti hoon...",
        ],
        "verification": [
            "Aap bas ek second hold kijiye, main aapka verification status check kar leti hoon...",
            "Ek minute rukiye, main system mein KYC application verify kar leti hoon...",
            "Haan bilkul, main verification portal par check kar leti hoon...",
        ],
        "crm": [
            "Ek minute rukiye, main aapki profile details verify kar leti hoon...",
            "Bas ek second, main account details screen par load kar leti hoon...",
        ],
        "calendar": [
            "Ek second rukiye, main calendar slots check kar leti hoon...",
            "Haan bilkul, main available timings dekh leti hoon...",
        ],
    },
    "Male": {
        "general": [
            "Ek second rukiye, main system mein check kar leta hoon...",
            "Haan bilkul, main ek minute details dekh leta hoon...",
            "Aap bas ek second hold kijiye, main records verify kar leta hoon...",
            "Theek hai, main turant system mein status check kar leta hoon...",
            "Sure, ek minute dijiye, main screen par fetch kar raha hoon...",
            "Bas ek moment, main backend se details nikaal raha hoon...",
        ],
        "pincode": [
            "Ek second dijiye, main pincode par serviceability check kar leta hoon...",
            "Haan bilkul, main courier network mein delivery timeline check kar leta hoon...",
            "Bas ek moment rukiye, main aapke area ka delivery status dekh leta hoon...",
        ],
        "inventory": [
            "Ek second rukiye, main warehouse inventory check kar leta hoon...",
            "Haan bilkul, main stock availability screen par dekh leta hoon...",
            "Bas ek second, main size and stock verify kar leta hoon...",
        ],
        "verification": [
            "Aap bas ek second hold kijiye, main aapka verification status check kar leta hoon...",
            "Ek minute rukiye, main system mein KYC application verify kar leta hoon...",
            "Haan bilkul, main verification portal par check kar leta hoon...",
        ],
        "crm": [
            "Ek minute rukiye, main aapki profile details verify kar leta hoon...",
            "Bas ek second, main account details screen par load kar leta hoon...",
        ],
        "calendar": [
            "Ek second rukiye, main calendar slots check kar leta hoon...",
            "Haan bilkul, main available timings dekh leta hoon...",
        ],
    }
}


def get_conversational_filler(
    gender: str = "Female",
    category: Optional[str] = None,
    seed: Optional[int] = None
) -> str:
    """
    Select a natural, randomized Hinglish conversational filler phrase
    for Pattern B live lookup tools to eliminate dead air while the API
    fetches live data in parallel.
    """
    g_key = "Male" if str(gender).strip().lower() in ("male", "man", "m") else "Female"
    cat_key = (category or "general").lower().strip()

    pool = CONVERSATIONAL_FILLERS.get(g_key, CONVERSATIONAL_FILLERS["Female"])
    phrases = pool.get(cat_key) or pool.get("general") or [
        "Ek second rukiye, main system mein check kar leti hoon..." if g_key == "Female" else "Ek second rukiye, main system mein check kar leta hoon..."
    ]

    if seed is not None:
        idx = seed % len(phrases)
    else:
        idx = random.randint(0, len(phrases) - 1)

    return phrases[idx]


# ── Unified Action Executor ──────────────────────────────────────────────────

async def execute_tool_action(
    tool_def: Union[Dict[str, Any], Any],
    arguments: Optional[Dict[str, Any]] = None,
    context: Optional[Dict[str, Any]] = None,
    timeout_seconds: Optional[int] = None
) -> Dict[str, Any]:
    """
    Unified execution handler for both Pattern A and Pattern B tools.
    Invokes the appropriate underlying engine (api_tool, data_validator, data_verifier, mock_api, mcp)
    or custom callable.
    """
    start_time = time.perf_counter()
    tool_name = getattr(tool_def, "name", None) or (tool_def.get("name") if isinstance(tool_def, dict) else "") or "unnamed_tool"
    tool_type = str(getattr(tool_def, "tool_type", None) or (tool_def.get("tool_type") if isinstance(tool_def, dict) else "") or "mock_api").lower().strip()
    cfg = getattr(tool_def, "config", None) or (tool_def.get("config") if isinstance(tool_def, dict) else {}) or {}
    if not isinstance(cfg, dict):
        cfg = {}

    timeout = timeout_seconds or getattr(tool_def, "timeout_seconds", 10) or cfg.get("timeout_seconds", 10) or 10
    try:
        timeout = max(1, min(int(timeout), 60))
    except (ValueError, TypeError):
        timeout = 10

    merged_inputs = {**(context or {}), **(arguments or {})}

    # Check for direct callable handler (e.g. MockToolRegistry or lambda)
    direct_exec = (tool_def.get("execute") if isinstance(tool_def, dict) else None) or getattr(tool_def, "execute", None)
    if callable(direct_exec):
        try:
            res = direct_exec(arguments or {})
            if asyncio.iscoroutine(res):
                res = await res
            if isinstance(res, dict):
                res.setdefault("tool_name", tool_name)
                res.setdefault("latency_ms", int((time.perf_counter() - start_time) * 1000))
                return res
            return {"success": True, "tool_name": tool_name, "output": res, "latency_ms": int((time.perf_counter() - start_time) * 1000)}
        except Exception as e:
            return {"success": False, "tool_name": tool_name, "error": str(e), "latency_ms": int((time.perf_counter() - start_time) * 1000)}

    if callable(tool_def):
        try:
            res = tool_def(arguments or {})
            if asyncio.iscoroutine(res):
                res = await res
            if isinstance(res, dict):
                res.setdefault("tool_name", tool_name)
                res.setdefault("latency_ms", int((time.perf_counter() - start_time) * 1000))
                return res
            return {"success": True, "tool_name": tool_name, "output": res, "latency_ms": int((time.perf_counter() - start_time) * 1000)}
        except Exception as e:
            return {"success": False, "tool_name": tool_name, "error": str(e), "latency_ms": int((time.perf_counter() - start_time) * 1000)}

    try:
        if tool_type == "api_tool":
            res = await execute_api_tool(cfg, test_inputs=merged_inputs, timeout_seconds=timeout)
        elif tool_type == "data_validator":
            val = (arguments or {}).get("value") or (arguments or {}).get("test_value") or (arguments or {}).get("spoken_input") or ""
            res = execute_data_validator(cfg, input_value=val)
        elif tool_type == "data_verifier":
            spoken = (arguments or {}).get("spoken_value") or (arguments or {}).get("value") or ""
            ref = (arguments or {}).get("reference_value") or (context or {}).get("reference_value") or ""
            res = execute_data_verifier(cfg, spoken_value=spoken, reference_value=ref)
        elif tool_type == "mock_api":
            res = await execute_mock_api(cfg, test_inputs=merged_inputs)
        elif tool_type == "mcp":
            res = execute_mcp_tool(cfg, test_inputs=merged_inputs)
        else:
            res = await execute_mock_api(cfg, test_inputs=merged_inputs)

        res["tool_name"] = tool_name
        res["run_mode"] = get_tool_run_mode(tool_def)
        res["latency_ms"] = int((time.perf_counter() - start_time) * 1000)
        return res

    except Exception as exc:
        latency_ms = int((time.perf_counter() - start_time) * 1000)
        return {
            "success": False,
            "tool_name": tool_name,
            "run_mode": get_tool_run_mode(tool_def),
            "status_code": 500,
            "latency_ms": latency_ms,
            "error": f"Tool '{tool_name}' execution failed: {str(exc)}",
            "spoken_feedback": cfg.get("fallback_response") or "Service is temporarily unavailable."
        }


# ── Pattern A: Asynchronous Non-blocking Write Dispatcher ────────────────────

def dispatch_pattern_a_write(
    tool_def: Any,
    arguments: Optional[Dict[str, Any]] = None,
    context: Optional[Dict[str, Any]] = None,
    on_complete: Optional[Callable[[Dict[str, Any]], Any]] = None,
    on_error: Optional[Callable[[Exception], Any]] = None,
) -> asyncio.Task:
    """
    Pattern A (Write / Action Tools):
    Launches an asynchronous background task via asyncio.create_task.
    Returns immediately so agent streams spoken dialogue to TTS with ZERO dead air (~230ms TTFT).
    """
    async def _run_write():
        try:
            res = await execute_tool_action(tool_def, arguments=arguments, context=context)
            if on_complete:
                if asyncio.iscoroutinefunction(on_complete):
                    await on_complete(res)
                else:
                    res_c = on_complete(res)
                    if asyncio.iscoroutine(res_c):
                        await res_c
            return res
        except Exception as exc:
            if on_error:
                if asyncio.iscoroutinefunction(on_error):
                    await on_error(exc)
                else:
                    err_c = on_error(exc)
                    if asyncio.iscoroutine(err_c):
                        await err_c
            return {"success": False, "error": str(exc), "run_mode": RUN_MODE_WRITE}

    task = asyncio.create_task(_run_write())
    return task


# ── Pattern B: Live Read / Lookup Tool Execution ──────────────────────────────

async def execute_pattern_b_read(
    tool_def: Any,
    arguments: Optional[Dict[str, Any]] = None,
    context: Optional[Dict[str, Any]] = None,
    timeout_seconds: Optional[int] = None
) -> Dict[str, Any]:
    """
    Pattern B (Read / Lookup Tools):
    Live data fetch executed in parallel with conversational filler speech.
    Returns live data to feed into the conversation stream so the agent speaks the accurate answer.
    """
    return await execute_tool_action(
        tool_def,
        arguments=arguments,
        context=context,
        timeout_seconds=timeout_seconds
    )


# ── Tool Dispatcher ──────────────────────────────────────────────────────────

class ToolDispatcher:
    """
    Central tool orchestrator managing dual Pattern A + Pattern B tools:
    - Pattern A: Asynchronous non-blocking background write execution (zero dead air).
    - Pattern B: Parallel conversational filler playback + live lookup data injection (zero dead air).
    """
    def __init__(
        self,
        tools: Optional[List[Any]] = None,
        gender: str = "Female",
        on_tool_executed: Optional[Callable[[str, str, Dict[str, Any]], Any]] = None,
        allow_unregistered: bool = True
    ):
        self.gender = gender
        self.on_tool_executed = on_tool_executed
        self.allow_unregistered = allow_unregistered
        self._tools: Dict[str, Any] = {}
        self._tools_lower: Dict[str, Any] = {}
        self._active_background_tasks: List[asyncio.Task] = []
        self._execution_history: List[Dict[str, Any]] = []

        if tools:
            for t in tools:
                self.register_tool(t)

    def register_tool(self, tool: Any) -> None:
        name = getattr(tool, "name", None) or (tool.get("name") if isinstance(tool, dict) else "")
        if name and str(name).strip():
            clean_name = str(name).strip()
            self._tools[clean_name] = tool
            self._tools_lower[clean_name.lower()] = tool

    def get_tool(self, tool_name: str) -> Optional[Any]:
        if not tool_name:
            return None
        t = self._tools.get(tool_name) or self._tools.get(tool_name.strip())
        if t:
            return t
        return self._tools_lower.get(str(tool_name).strip().lower())

    def get_run_mode(self, tool_name: str) -> str:
        t = self.get_tool(tool_name)
        if t:
            return get_tool_run_mode(t)
        return get_tool_run_mode({"name": tool_name})

    def get_timeout(self, tool_name: str) -> int:
        tool = self.get_tool(tool_name)
        if tool:
            cfg = getattr(tool, "config", {}) or (tool.get("config", {}) if isinstance(tool, dict) else {})
            to = getattr(tool, "timeout_seconds", None) or (cfg.get("timeout_seconds") if isinstance(cfg, dict) else None)
            if to:
                try:
                    return max(1, min(int(to), 60))
                except (ValueError, TypeError):
                    pass
        return 10

    def is_read(self, tool_name: str) -> bool:
        return self.get_run_mode(tool_name) == RUN_MODE_READ

    def is_write(self, tool_name: str) -> bool:
        return self.get_run_mode(tool_name) == RUN_MODE_WRITE

    def get_filler_phrase(self, tool_name: Optional[str] = None, seed: Optional[int] = None) -> str:
        category = "general"
        if tool_name:
            t_low = tool_name.lower()
            if any(w in t_low for w in ["pincode", "deliver", "courier", "service"]):
                category = "pincode"
            elif any(w in t_low for w in ["inventory", "stock", "size", "item"]):
                category = "inventory"
            elif any(w in t_low for w in ["verify", "kyc", "loan", "status", "application"]):
                category = "verification"
            elif any(w in t_low for w in ["crm", "lead", "profile"]):
                category = "crm"
            elif any(w in t_low for w in ["slot", "calendar", "callback", "schedule"]):
                category = "calendar"
        return get_conversational_filler(gender=self.gender, category=category, seed=seed)

    def dispatch_write(
        self,
        tool_name: str,
        arguments: Optional[Dict[str, Any]] = None,
        context: Optional[Dict[str, Any]] = None,
        on_complete: Optional[Callable[[Dict[str, Any]], Any]] = None
    ) -> asyncio.Task:
        """Pattern A: Fire-and-forget non-blocking write task."""
        tool = self.get_tool(tool_name) or {
            "name": tool_name,
            "tool_type": "mock_api",
            "run_mode": RUN_MODE_WRITE,
            "config": {
                "mock_response_body": json.dumps({"status": "success", "action": tool_name})
            }
        }

        async def _internal_on_complete(res: Dict[str, Any]):
            self._execution_history.append({"tool": tool_name, "mode": "write", "result": res})
            if self.on_tool_executed:
                cb = self.on_tool_executed(tool_name, "write", res)
                if asyncio.iscoroutine(cb):
                    await cb
            if on_complete:
                res_cb = on_complete(res)
                if asyncio.iscoroutine(res_cb):
                    await res_cb

        task = dispatch_pattern_a_write(
            tool_def=tool,
            arguments=arguments,
            context=context,
            on_complete=_internal_on_complete
        )
        self._active_background_tasks.append(task)
        task.add_done_callback(lambda t: self._cleanup_done_task(t))
        return task

    def _cleanup_done_task(self, task: asyncio.Task):
        try:
            if task in self._active_background_tasks:
                self._active_background_tasks.remove(task)
        except (ValueError, KeyError):
            pass

    def cancel_pending_tasks(self):
        """Cancel and drain any active background write tasks."""
        for t in list(self._active_background_tasks):
            if not t.done():
                t.cancel()
        self._active_background_tasks.clear()

    async def execute_read(
        self,
        tool_name: str,
        arguments: Optional[Dict[str, Any]] = None,
        context: Optional[Dict[str, Any]] = None,
        timeout_seconds: Optional[int] = None
    ) -> Dict[str, Any]:
        """Pattern B: Execute live read lookup."""
        tool = self.get_tool(tool_name) or {
            "name": tool_name,
            "tool_type": "mock_api",
            "run_mode": RUN_MODE_READ,
            "config": {
                "mock_response_body": json.dumps({
                    "status": "success",
                    "lookup": tool_name,
                    "result": "available",
                    "details": "Verified successfully"
                })
            }
        }
        to = timeout_seconds or self.get_timeout(tool_name)
        res = await execute_pattern_b_read(
            tool_def=tool,
            arguments=arguments,
            context=context,
            timeout_seconds=to
        )
        self._execution_history.append({"tool": tool_name, "mode": "read", "result": res})
        if self.on_tool_executed:
            cb = self.on_tool_executed(tool_name, "read", res)
            if asyncio.iscoroutine(cb):
                await cb
        return res

    def match_tool_by_intent(self, text: str) -> Optional[Tuple[str, Dict[str, Any]]]:
        """
        Inspect prospect speech for tool triggers:
        - Pincode check (read): e.g. "560034", "check delivery", "pincode"
        - Inventory check (read): e.g. "size M in stock", "check inventory"
        - Loan / KYC verification (read): e.g. "application status", "verify loan"
        - WhatsApp send (write): e.g. "send whatsapp", "link bhej do"
        - DNC opt out (write): e.g. "do not call", "dnc"
        - Calendar callback (write): e.g. "call back tomorrow", "schedule demo"
        - CRM update (write): e.g. "update note", "change address"
        """
        if not text:
            return None
        t_low = text.lower()

        # 1. First check explicitly registered tools
        for name, tool in self._tools.items():
            cfg = getattr(tool, "config", {}) or (tool.get("config", {}) if isinstance(tool, dict) else {})
            if not isinstance(cfg, dict):
                cfg = {}
            raw_triggers = cfg.get("trigger_keywords") or getattr(tool, "trigger_keywords", None) or []
            if isinstance(raw_triggers, str):
                triggers = [k.strip().lower() for k in raw_triggers.split(",") if k.strip()]
            elif isinstance(raw_triggers, list):
                triggers = [str(k).strip().lower() for k in raw_triggers if str(k).strip()]
            else:
                triggers = []
            if triggers and any(kw in t_low for kw in triggers):
                return name, {"user_query": text}

        # 2. Heuristic Matching
        has_registered_tools = len(self._tools) > 0

        # Pattern B: Pincode lookup
        pin_match = re.search(r"\b([1-9][0-9]{5})\b", text)
        if pin_match or any(w in t_low for w in ["pincode", "serviceable", "serviceability", "deliver to", "delivery available"]):
            pincode = pin_match.group(1) if pin_match else ""
            for name in self._tools:
                if any(w in name.lower() for w in ["pincode", "deliver", "service"]):
                    return name, {"pincode": pincode, "user_query": text}
            if not has_registered_tools and self.allow_unregistered:
                return "check_pincode_serviceability", {"pincode": pincode, "user_query": text}

        # Pattern B: Inventory / Stock check
        if any(w in t_low for w in ["in stock", "stock", "available", "inventory", "size m", "size l", "size s"]):
            for name in self._tools:
                if any(w in name.lower() for w in ["inventory", "stock"]):
                    return name, {"user_query": text}
            if not has_registered_tools and self.allow_unregistered:
                return "check_product_inventory", {"user_query": text}

        # Pattern B: Loan / Verification status check
        if any(w in t_low for w in ["loan status", "kyc status", "application status", "verification status", "verify status"]):
            for name in self._tools:
                if any(w in name.lower() for w in ["loan", "kyc", "verify", "status"]):
                    return name, {"user_query": text}
            if not has_registered_tools and self.allow_unregistered:
                return "verify_loan_status", {"user_query": text}

        # Pattern A: WhatsApp send
        if any(w in t_low for w in ["whatsapp", "link bhej", "send link", "send details", "share details", "bhej do"]):
            for name in self._tools:
                if "whatsapp" in name.lower() or "link" in name.lower():
                    return name, {"action": "send_link", "user_query": text}
            if not has_registered_tools and self.allow_unregistered:
                return "send_whatsapp", {"action": "send_link", "user_query": text}

        # Pattern A: DNC opt out
        if any(w in t_low for w in ["do not call", "dnc", "stop calling", "remove my number", "number hatao"]):
            for name in self._tools:
                if "dnc" in name.lower() or "opt_out" in name.lower():
                    return name, {"action": "mark_dnc"}
            if not has_registered_tools and self.allow_unregistered:
                return "mark_dnc", {"action": "mark_dnc"}

        # Pattern A: Schedule callback / Calendar
        if any(w in t_low for w in ["call back", "later", "parso", "kal call", "schedule", "meeting", "slot"]):
            for name in self._tools:
                if any(w in name.lower() for w in ["callback", "calendar", "schedule", "slot"]):
                    return name, {"datetime": text}
            if not has_registered_tools and self.allow_unregistered:
                return "schedule_callback", {"datetime": text}

        # Pattern A: CRM update
        if any(w in t_low for w in ["update address", "note this", "change email", "update note", "update crm"]):
            for name in self._tools:
                if "crm" in name.lower() or "update" in name.lower():
                    return name, {"note": text}
            if not has_registered_tools and self.allow_unregistered:
                return "update_crm", {"note": text}

        return None

