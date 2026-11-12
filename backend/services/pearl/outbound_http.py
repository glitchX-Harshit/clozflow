"""
Outbound HTTP guard for user-configured URLs (agent API tools and the tool test endpoint).

Every request to a URL that a user typed goes through ``guarded_request``:

* only ``http`` / ``https`` URLs without embedded credentials and without internal
  hostnames (localhost, *.internal, metadata.google.internal, ...) are accepted;
* the host is resolved and *every* address must be public: private, loopback, link-local
  (incl. the 169.254.169.254 cloud metadata service), multicast, reserved, unspecified,
  CGNAT, documentation/benchmark ranges and IPv4-mapped / 6to4 / NAT64 embeddings of
  them are refused (IPv4 and IPv6);

URL / address *policy* is shared with the knowledge crawler: it comes from
``services/knowledge/url_safety.py`` (``normalize_url`` / ``blocked_ip_reason``), so there is
a single definition of what counts as an internal destination (incl. its development-only
``ALLOW_LOCALHOST_CRAWL`` switch). This module adds what tool calls need on top: manual
redirect handling with a re-check per hop, a body cap, a hard deadline and no cookie memory.
* the same check runs again at socket-connect time against the exact IP being dialled
  (``GuardedAsyncTransport``), so DNS rebinding between the check and the connect cannot
  reach an internal address;
* redirects are followed manually and each hop is re-checked;
* the response body is capped (decompressed size), the whole exchange has a hard
  deadline, environment proxies are ignored and cookies are never stored or replayed
  across requests (the client is shared by all tenants).
"""
from __future__ import annotations

import asyncio
import http.cookiejar
import ipaddress
import json as _json
import re
import socket
from dataclasses import dataclass
from typing import Any, List, Optional

import httpcore
import httpx

try:
    from services.knowledge.url_safety import UnsafeURLError, blocked_ip_reason, normalize_url
except ImportError:  # pragma: no cover - package-relative fallback
    from ..knowledge.url_safety import UnsafeURLError, blocked_ip_reason, normalize_url

ALLOWED_SCHEMES = ("http", "https")
DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024  # 1 MiB
DEFAULT_MAX_REDIRECTS = 5


class OutboundRequestBlocked(Exception):
    """The destination (scheme, host or resolved address) is not allowed."""


class OutboundResolutionError(Exception):
    """The destination host could not be resolved."""


class ResponseTooLarge(Exception):
    """The response body exceeded the configured size cap."""


class TooManyRedirects(Exception):
    """The redirect chain was longer than allowed."""


# ── Address classification ────────────────────────────────────────────────────

def is_disallowed_address(address: Any) -> bool:
    """True if ``address`` (str or ipaddress object) is not a public unicast address
    (shared policy: services.knowledge.url_safety.blocked_ip_reason)."""
    try:
        ip = address if isinstance(address, (ipaddress.IPv4Address, ipaddress.IPv6Address)) \
            else ipaddress.ip_address(str(address).split("%", 1)[0].strip("[]"))
    except ValueError:
        return True
    return blocked_ip_reason(ip) is not None


def check_url(url: str) -> httpx.URL:
    """Validate scheme, credentials and hostname of ``url`` (no DNS). Returns the parsed URL."""
    try:
        parsed = httpx.URL(url)
    except Exception as exc:  # httpx.InvalidURL and friends
        raise OutboundRequestBlocked(f"Invalid URL: {exc}") from None
    if parsed.scheme.lower() not in ALLOWED_SCHEMES:
        raise OutboundRequestBlocked("Only http:// and https:// URLs are allowed")
    if not parsed.host:
        raise OutboundRequestBlocked("URL has no host")
    try:
        # httpx has already percent-encoded the URL, so spaces in substituted query values are fine.
        normalize_url(str(parsed))
    except UnsafeURLError as exc:
        raise OutboundRequestBlocked(str(exc)) from None
    return parsed


_LEGACY_IPV4_RE = re.compile(r"^(?:0x[0-9a-f]*|[0-9]+)(?:\.(?:0x[0-9a-f]*|[0-9]+)){0,3}\.?$", re.IGNORECASE)


def _legacy_ipv4(host: str) -> Optional[ipaddress.IPv4Address]:
    """
    inet_aton-style numeric hosts ("2130706433", "0x7f000001", "127.1", "0177.0.0.1"). Some
    resolvers turn these into IPs, others don't - so they are decoded (and checked) here, the
    same way on every platform. Returns None for ordinary hostnames.
    """
    if not _LEGACY_IPV4_RE.match(host):
        return None
    try:
        parts = []
        for part in host.rstrip(".").split("."):
            if part.lower().startswith("0x"):
                parts.append(int(part[2:] or "0", 16))
            elif len(part) > 1 and part.startswith("0"):
                parts.append(int(part, 8))
            else:
                parts.append(int(part))
        *head, last = parts
        if any(p > 255 for p in head) or last >= 256 ** (4 - len(head)):
            raise ValueError
        value = 0
        for p in head:
            value = (value << 8) | p
        value = (value << (8 * (4 - len(head)))) | last
        return ipaddress.IPv4Address(value)
    except ValueError:
        raise OutboundRequestBlocked(f"Invalid numeric host '{host}'") from None


async def resolve_public_addresses(host: str, port: int) -> List[str]:
    """Resolve ``host`` and return its addresses; raise if any of them is not public."""
    host = (host or "").strip().strip("[]")
    if not host:
        raise OutboundRequestBlocked("URL has no host")

    try:
        literal = ipaddress.ip_address(host.split("%", 1)[0])
    except ValueError:
        literal = _legacy_ipv4(host)
    if literal is not None:
        if is_disallowed_address(literal):
            raise OutboundRequestBlocked("Destination address is not publicly routable (private/internal network)")
        return [str(literal)]

    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError, OSError) as exc:
        raise OutboundResolutionError(f"Could not resolve host '{host}'") from exc

    addresses: List[str] = []
    for info in infos:
        addr = info[4][0]
        if addr not in addresses:
            addresses.append(addr)
    if not addresses:
        raise OutboundResolutionError(f"Could not resolve host '{host}'")
    for addr in addresses:
        if is_disallowed_address(addr):
            raise OutboundRequestBlocked(
                f"Destination host '{host}' resolves to a non-public address (private/internal network)"
            )
    return addresses


async def check_destination(url: str) -> httpx.URL:
    """Full pre-flight check: scheme, host and resolved addresses."""
    parsed = check_url(url)
    port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
    await resolve_public_addresses(parsed.host, port)
    return parsed


# ── Connect-time enforcement ──────────────────────────────────────────────────

class _GuardedNetworkBackend(httpcore.AsyncNetworkBackend):
    """Resolves and validates the host itself, then connects to the validated IP only."""

    def __init__(self) -> None:
        self._backend = httpcore.AnyIOBackend()

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        try:
            addresses = await resolve_public_addresses(host, port)
        except OutboundResolutionError as exc:
            raise httpcore.ConnectError(str(exc)) from exc
        last_exc: Optional[BaseException] = None
        for addr in addresses:
            try:
                return await self._backend.connect_tcp(
                    addr, port, timeout=timeout, local_address=local_address, socket_options=socket_options
                )
            except (httpcore.ConnectError, httpcore.ConnectTimeout, OSError) as exc:
                last_exc = exc
        if isinstance(last_exc, (httpcore.ConnectError, httpcore.ConnectTimeout)):
            raise last_exc
        raise httpcore.ConnectError(str(last_exc or "Connection failed"))

    async def connect_unix_socket(self, path, timeout=None, socket_options=None):
        raise OutboundRequestBlocked("Unix domain sockets are not allowed")

    async def sleep(self, seconds: float) -> None:
        await self._backend.sleep(seconds)


class GuardedAsyncTransport(httpx.AsyncHTTPTransport):
    """httpx transport whose connection pool only ever dials validated public addresses."""

    def __init__(self, limits: httpx.Limits = httpx.Limits(max_connections=20, max_keepalive_connections=10)):
        super().__init__(trust_env=False, limits=limits)
        # Replace the default pool with one using the guarded network backend.
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=httpx.create_ssl_context(),
            max_connections=limits.max_connections,
            max_keepalive_connections=limits.max_keepalive_connections,
            keepalive_expiry=limits.keepalive_expiry,
            http1=True,
            http2=False,
            network_backend=_GuardedNetworkBackend(),
        )


class _RejectAllCookies(http.cookiejar.DefaultCookiePolicy):
    """Never store or send cookies: the client is shared across users and tools."""

    def set_ok(self, cookie, request):
        return False

    def return_ok(self, cookie, request):
        return False


def create_guarded_client(max_connections: int = 20, max_keepalive_connections: int = 10) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=GuardedAsyncTransport(
            limits=httpx.Limits(max_connections=max_connections, max_keepalive_connections=max_keepalive_connections)
        ),
        timeout=httpx.Timeout(connect=5.0, read=30.0, write=5.0, pool=5.0),
        follow_redirects=False,
        trust_env=False,
        cookies=http.cookiejar.CookieJar(policy=_RejectAllCookies()),
    )


# ── Guarded request ───────────────────────────────────────────────────────────

@dataclass
class GuardedResponse:
    status_code: int
    headers: httpx.Headers
    content: bytes
    url: str
    reason_phrase: str
    encoding: str = "utf-8"

    @property
    def text(self) -> str:
        try:
            return self.content.decode(self.encoding or "utf-8", errors="replace")
        except LookupError:
            return self.content.decode("utf-8", errors="replace")

    def json(self) -> Any:
        return _json.loads(self.content)


async def _read_capped(response: httpx.Response, max_bytes: int) -> bytes:
    declared = response.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > max_bytes:
        raise ResponseTooLarge(f"Response body exceeds the {max_bytes} byte limit")
    chunks: List[bytes] = []
    total = 0
    async for chunk in response.aiter_bytes():
        total += len(chunk)
        if total > max_bytes:
            raise ResponseTooLarge(f"Response body exceeds the {max_bytes} byte limit")
        chunks.append(chunk)
    return b"".join(chunks)


async def guarded_request(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    headers: Optional[dict] = None,
    params: Optional[dict] = None,
    json: Any = None,
    content: Any = None,
    timeout: float = 10.0,
    max_response_bytes: int = DEFAULT_MAX_RESPONSE_BYTES,
    max_redirects: int = DEFAULT_MAX_REDIRECTS,
) -> GuardedResponse:
    """
    Perform a request to a user-supplied URL with SSRF protection.

    Raises OutboundRequestBlocked, OutboundResolutionError, ResponseTooLarge,
    TooManyRedirects, asyncio.TimeoutError or httpx errors.
    """
    timeout = max(1.0, float(timeout))

    async def _run() -> GuardedResponse:
        request_kwargs = {"headers": headers, "params": params or None, "timeout": timeout}
        if json is not None:
            request_kwargs["json"] = json
        elif content is not None:
            request_kwargs["content"] = content
        request = client.build_request(method, url, **request_kwargs)
        for hop in range(max_redirects + 1):
            await check_destination(str(request.url))
            response = await client.send(request, stream=True, follow_redirects=False)
            try:
                next_request = response.next_request
                if next_request is not None:
                    if hop >= max_redirects:
                        raise TooManyRedirects(f"Stopped after {max_redirects} redirects")
                    request = next_request
                    continue
                body = await _read_capped(response, max_response_bytes)
                return GuardedResponse(
                    status_code=response.status_code,
                    headers=response.headers,
                    content=body,
                    url=str(response.url),
                    reason_phrase=response.reason_phrase,
                    encoding=response.encoding or "utf-8",
                )
            finally:
                await response.aclose()
        raise TooManyRedirects(f"Stopped after {max_redirects} redirects")

    return await asyncio.wait_for(_run(), timeout=timeout)
