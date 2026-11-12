"""Structured LLM access for the Meeting Wizard (spec §5.1).

``generate_json(system, user, schema)`` tries Gemini (``GEMINI_API_KEY``, model
``CLOZFLOW_WIZARD_MODEL`` default ``gemini-2.5-flash``, thinking off) and then
Groq (``GROQ_API_KEY``, the same model ``sales_ai_engine`` uses, JSON mode).
The answer is validated against a small JSON-schema subset (types, required,
nested properties, items, enum); one repair round-trip is attempted before
``LLMUnavailable`` is raised. Callers always have a deterministic fallback.

Nothing here logs prompt or answer text: only vendor names and error types.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
GROQ_MODEL = "openai/gpt-oss-120b"          # the model sales_ai_engine.py / relay_engine.py use
GROQ_BASE_URL = "https://api.groq.com/openai/v1"


class LLMUnavailable(RuntimeError):
    """No vendor could produce a schema-valid JSON answer."""


# ── configuration ────────────────────────────────────────────────────────────

def _env(name: str) -> str:
    return (os.getenv(name) or "").strip()


def gemini_model() -> str:
    return _env("CLOZFLOW_WIZARD_MODEL") or DEFAULT_GEMINI_MODEL


def available_vendors() -> list[str]:
    vendors = []
    if _env("GEMINI_API_KEY"):
        vendors.append("gemini")
    if _env("GROQ_API_KEY"):
        vendors.append("groq")
    return vendors


def is_configured() -> bool:
    return bool(available_vendors())


def describe() -> dict:
    """``{vendor, model, ready}`` for ``GET /api/wizard/preflight``."""
    vendors = available_vendors()
    if not vendors:
        return {"vendor": None, "model": None, "ready": False,
                "reason": "No LLM key configured (GEMINI_API_KEY or GROQ_API_KEY). Briefs and debriefs use the built-in templates."}
    vendor = vendors[0]
    return {"vendor": vendor, "model": gemini_model() if vendor == "gemini" else GROQ_MODEL, "ready": True}


# ── schema validation (subset of JSON Schema) ────────────────────────────────

_TYPE_CHECKS = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
}


def validate(data: Any, schema: dict, path: str = "$") -> list[str]:
    """Human-readable validation errors (empty list = valid)."""
    errors: list[str] = []
    types = schema.get("type")
    if types:
        allowed = types if isinstance(types, list) else [types]
        if not any(_TYPE_CHECKS.get(t, lambda v: True)(data) for t in allowed):
            return [f"{path}: expected {'|'.join(allowed)}, got {type(data).__name__}"]
    if data is None:
        return errors
    if "enum" in schema and data not in schema["enum"]:
        errors.append(f"{path}: must be one of {schema['enum']}")
    if isinstance(data, dict):
        for key in schema.get("required", []):
            if key not in data:
                errors.append(f"{path}.{key}: required")
        for key, sub in (schema.get("properties") or {}).items():
            if key in data:
                errors.extend(validate(data[key], sub, f"{path}.{key}"))
    if isinstance(data, list):
        items = schema.get("items")
        if items:
            for index, item in enumerate(data[:200]):
                errors.extend(validate(item, items, f"{path}[{index}]"))
        max_items = schema.get("maxItems")
        if max_items is not None and len(data) > max_items:
            errors.append(f"{path}: at most {max_items} items")
    return errors[:20]


def parse_json_text(raw: str) -> Any:
    """Tolerant JSON extraction (code fences, leading prose)."""
    if raw is None:
        raise ValueError("empty answer")
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except ValueError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise
        return json.loads(text[start:end + 1])


# ── vendor calls ─────────────────────────────────────────────────────────────

async def _call_gemini(system: str, user: str, *, max_tokens: int, temperature: float) -> str:
    from google import genai  # imported lazily: optional at import time
    from google.genai import types

    client = genai.Client(api_key=_env("GEMINI_API_KEY"))
    model = gemini_model()
    base = dict(system_instruction=system, response_mime_type="application/json",
                max_output_tokens=max_tokens, temperature=temperature)
    configs = [types.GenerateContentConfig(thinking_config=types.ThinkingConfig(thinking_budget=0), **base),
               types.GenerateContentConfig(**base)]
    last: Optional[BaseException] = None
    for config in configs:
        try:
            response = await client.aio.models.generate_content(model=model, contents=user, config=config)
            return response.text or ""
        except Exception as exc:  # noqa: BLE001 - a thinking-config rejection falls through to the plain config
            last = exc
            if "thinking" not in str(exc).lower():
                raise
    raise last  # type: ignore[misc]


async def _call_groq(system: str, user: str, *, max_tokens: int, temperature: float) -> str:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=_env("GROQ_API_KEY"), base_url=GROQ_BASE_URL)
    response = await client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        response_format={"type": "json_object"},
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content or ""


_VENDOR_CALLS = {"gemini": _call_gemini, "groq": _call_groq}


async def generate_json(system: str, user: str, schema: dict, *, max_tokens: int = 1200,
                        timeout: float = 25.0, temperature: float = 0.3) -> dict:
    """Schema-valid JSON from the first vendor that can produce it, else ``LLMUnavailable``."""
    vendors = available_vendors()
    if not vendors:
        raise LLMUnavailable("No LLM key configured (GEMINI_API_KEY or GROQ_API_KEY).")
    failures: list[str] = []
    for vendor in vendors:
        call = _VENDOR_CALLS[vendor]
        try:
            raw = await asyncio.wait_for(call(system, user, max_tokens=max_tokens, temperature=temperature), timeout)
            data = parse_json_text(raw)
            errors = validate(data, schema)
            if errors:
                repair = (f"{user}\n\nYour previous answer was not valid for the required JSON shape: "
                          f"{'; '.join(errors[:8])}. Return ONLY the corrected JSON object.")
                raw = await asyncio.wait_for(call(system, repair, max_tokens=max_tokens, temperature=max(0.0, temperature - 0.2)),
                                             timeout)
                data = parse_json_text(raw)
                errors = validate(data, schema)
                if errors:
                    failures.append(f"{vendor}: invalid JSON after repair")
                    logger.warning("wizard llm: %s answer failed validation twice (%d issues)", vendor, len(errors))
                    continue
            if not isinstance(data, dict):
                failures.append(f"{vendor}: non-object answer")
                continue
            return data
        except asyncio.TimeoutError:
            failures.append(f"{vendor}: timeout after {timeout:.0f}s")
            logger.warning("wizard llm: %s timed out", vendor)
        except (ValueError, TypeError) as exc:
            failures.append(f"{vendor}: unparseable answer ({type(exc).__name__})")
            logger.warning("wizard llm: %s returned unparseable JSON", vendor)
        except Exception as exc:  # noqa: BLE001 - vendor/network errors fall through to the next vendor
            failures.append(f"{vendor}: {type(exc).__name__}")
            logger.warning("wizard llm: %s failed with %s", vendor, type(exc).__name__)
    raise LLMUnavailable("; ".join(failures) or "LLM unavailable")
