"""Optional company enrichment for the brief: homepage title + meta description.

Off when ``CLOZFLOW_WIZARD_ENRICH=0``. https only, 10 s, 1 MB, SSRF-checked through
``services.knowledge.url_safety``. Never raises: returns None on any problem.
"""
from __future__ import annotations

import asyncio
import html
import logging
import os
import re
from typing import Optional

import httpx

from services.knowledge import url_safety

logger = logging.getLogger(__name__)

MAX_BYTES = 1024 * 1024
TIMEOUT_S = 10.0

_DOMAIN_RE = re.compile(r"^(?:https?://)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:/.*)?$", re.I)
_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
_META_RE = re.compile(r"<meta\s+[^>]*?(?:name|property)=[\"'](?:description|og:description)[\"'][^>]*?content=[\"']([^\"']*)[\"']", re.I | re.S)
_META_RE_REV = re.compile(r"<meta\s+[^>]*?content=[\"']([^\"']*)[\"'][^>]*?(?:name|property)=[\"'](?:description|og:description)[\"']", re.I | re.S)


def enabled() -> bool:
    return (os.getenv("CLOZFLOW_WIZARD_ENRICH") or "1").strip().lower() not in ("0", "false", "no", "off")


def guess_domain(company: Optional[str], website: Optional[str] = None) -> Optional[str]:
    """A domain when ``website`` or ``company`` looks like one (``acme.in``, ``https://acme.com/about``)."""
    for candidate in (website, company):
        if not candidate:
            continue
        match = _DOMAIN_RE.match(candidate.strip())
        if match and "." in match.group(1) and " " not in candidate.strip():
            return match.group(1).lower()
    return None


def extract_title_description(markup: str) -> tuple[Optional[str], Optional[str]]:
    title = None
    match = _TITLE_RE.search(markup)
    if match:
        title = re.sub(r"\s+", " ", html.unescape(match.group(1))).strip()[:200] or None
    description = None
    match = _META_RE.search(markup) or _META_RE_REV.search(markup)
    if match:
        description = re.sub(r"\s+", " ", html.unescape(match.group(1))).strip()[:500] or None
    return title, description


async def fetch_homepage(url: str) -> Optional[str]:
    """The first MAX_BYTES of the page as text, or None (patched in tests)."""
    try:
        normalized = await url_safety.validate_public_url(url)
    except url_safety.UnsafeURLError:
        return None
    client = url_safety.safe_async_client(timeout=TIMEOUT_S, headers={"User-Agent": "ClozFlow-Brief/1.0"})
    try:
        async with client:
            response, body, _ = await url_safety.fetch_limited(client, normalized, max_bytes=MAX_BYTES, deadline_seconds=TIMEOUT_S)
    except (url_safety.UnsafeURLError, httpx.HTTPError, asyncio.TimeoutError, TimeoutError):
        return None
    if response.status_code >= 400:
        return None
    return url_safety.decode_body(response, body)


async def enrich_company(company: Optional[str], website: Optional[str] = None) -> Optional[dict]:
    """``{"domain", "url", "title", "description"}`` or None when disabled / nothing found."""
    if not enabled():
        return None
    domain = guess_domain(company, website)
    if not domain:
        return None
    url = f"https://{domain}/"
    try:
        markup = await fetch_homepage(url)
    except Exception:  # noqa: BLE001 - enrichment is best effort
        logger.info("wizard enrich: homepage fetch failed")
        return None
    if not markup:
        return None
    title, description = extract_title_description(markup)
    if not title and not description:
        return None
    return {"domain": domain, "url": url, "title": title, "description": description}
