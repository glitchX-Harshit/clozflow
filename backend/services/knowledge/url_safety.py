"""
SSRF protection for every server-side fetch of a user-supplied URL.

Two layers:

1. ``validate_public_url`` / ``validate_url_security`` — fast, user-facing
   check of a URL: http(s) only, no credentials, no internal hostnames, and
   every DNS answer must be a public unicast address.
2. ``SSRFSafeBackend`` / ``safe_async_client`` — an httpx transport whose
   network backend resolves the host and validates each address *at connect
   time*, then dials exactly the validated IP. Every redirect hop opens its
   connection through it, so redirects and DNS rebinding cannot reach
   private, loopback, link-local (incl. 169.254.169.254), multicast or
   reserved addresses (IPv4 and IPv6, incl. IPv4-mapped / NAT64 forms).

``ALLOW_LOCALHOST_CRAWL=true`` (development only) additionally allows
loopback and RFC1918/ULA private addresses; link-local/metadata, multicast,
reserved and unspecified addresses stay blocked.
"""

from __future__ import annotations

import asyncio
import ipaddress
import os
import socket
from typing import Iterable, List, Optional, Tuple
from urllib.parse import urlsplit

import httpcore
import httpx

ALLOWED_SCHEMES = ("http", "https")
MAX_URL_LENGTH = 2048

BLOCKED_HOSTNAMES = {
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "ip6-loopback",
    "metadata",
    "metadata.google.internal",
    "instance-data",
    "instance-data.ec2.internal",
}
BLOCKED_HOST_SUFFIXES = (".localhost", ".local", ".localdomain", ".internal", ".home.arpa")

# Special-purpose ranges beyond what ipaddress' flags already cover.
_EXTRA_BLOCKED_V4 = [ipaddress.ip_network(n) for n in (
    "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
    "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16",
    "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
)]
_EXTRA_BLOCKED_V6 = [ipaddress.ip_network(n) for n in (
    "::/128", "::1/128", "100::/64", "2001::/23", "2001:db8::/32", "2002::/16",
    "fc00::/7", "fe80::/10", "fec0::/10", "ff00::/8",
)]
_NAT64 = (ipaddress.ip_network("64:ff9b::/96"), ipaddress.ip_network("64:ff9b:1::/48"))
_PRIVATE_OK_IN_DEV = [ipaddress.ip_network(n) for n in (
    "10.0.0.0/8", "127.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "::1/128", "fc00::/7",
)]


class UnsafeURLError(ValueError):
    """The URL (or an address it resolves to) is not allowed to be fetched."""


def allow_private_targets() -> bool:
    return os.getenv("ALLOW_LOCALHOST_CRAWL", "false").strip().lower() in ("true", "1", "yes")


def blocked_ip_reason(ip, allow_private: Optional[bool] = None) -> Optional[str]:
    """Why ``ip`` must not be contacted, or None when it is a public address."""
    if allow_private is None:
        allow_private = allow_private_targets()
    if isinstance(ip, str):
        ip = ipaddress.ip_address(ip.split("%", 1)[0])  # drop IPv6 zone id
    if ip.version == 6:
        if ip.ipv4_mapped is not None:
            return blocked_ip_reason(ip.ipv4_mapped, allow_private)
        if any(ip in net for net in _NAT64):
            return blocked_ip_reason(ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF), allow_private)
    if ip.is_unspecified:
        return "unspecified address"
    if ip.is_link_local:
        return "link-local address"
    if ip.is_multicast:
        return "multicast address"
    if ip.is_reserved:
        return "reserved address"
    if allow_private and any(ip in net for net in _PRIVATE_OK_IN_DEV):
        return None
    if ip.is_loopback:
        return "loopback address"
    if ip.is_private:
        return "private address"
    extra = _EXTRA_BLOCKED_V4 if ip.version == 4 else _EXTRA_BLOCKED_V6
    if any(ip in net for net in extra):
        return "special-purpose address"
    if not ip.is_global:
        return "non-public address"
    return None


def _check_hostname(hostname: str) -> None:
    host = hostname.lower().rstrip(".")
    if not host:
        raise UnsafeURLError("Invalid URL: missing hostname.")
    if allow_private_targets():
        return
    if host in BLOCKED_HOSTNAMES or host.endswith(BLOCKED_HOST_SUFFIXES):
        if host == "localhost" or host.endswith((".localhost", ".local")):
            raise UnsafeURLError(
                "Destination 'localhost' is restricted for security (SSRF protection). To test local sites, "
                "use an ngrok/localtunnel URL or set ALLOW_LOCALHOST_CRAWL=true in backend/.env."
            )
        raise UnsafeURLError(f"Target destination '{hostname}' is not permitted.")


def normalize_url(url: str) -> str:
    """Syntax-level checks (no DNS). Returns the normalized URL or raises UnsafeURLError."""
    if not isinstance(url, str):
        raise UnsafeURLError("URL must be a string.")
    url = url.strip()
    if not url:
        raise UnsafeURLError("URL is required.")
    if len(url) > MAX_URL_LENGTH:
        raise UnsafeURLError("URL is too long.")
    if any(ord(ch) < 0x21 for ch in url):
        raise UnsafeURLError("URL contains invalid characters.")
    if "://" not in url:
        url = f"https://{url}"
    try:
        parts = urlsplit(url)
        _ = parts.port  # raises ValueError for junk ports
    except ValueError:
        raise UnsafeURLError("Invalid URL.")
    if (parts.scheme or "").lower() not in ALLOWED_SCHEMES:
        raise UnsafeURLError("Only HTTP and HTTPS URLs are permitted.")
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise UnsafeURLError("URLs with embedded credentials are not permitted.")
    hostname = parts.hostname
    if not hostname:
        raise UnsafeURLError("Invalid URL: missing hostname.")
    _check_hostname(hostname)
    normalized = f"{parts.scheme.lower()}://{parts.netloc}{parts.path}"
    if parts.query:
        normalized += f"?{parts.query}"
    return normalized


def _literal_ip(host: str):
    try:
        return ipaddress.ip_address(host.strip("[]").split("%", 1)[0])
    except ValueError:
        return None


async def resolve_host(host: str, port: int = 443) -> List[str]:
    """All addresses ``host`` resolves to (non-blocking)."""
    literal = _literal_ip(host)
    if literal is not None:
        return [str(literal)]
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError, OSError):
        raise UnsafeURLError(f"Could not resolve domain '{host}'.")
    addresses: List[str] = []
    for info in infos:
        addr = info[4][0]
        if addr not in addresses:
            addresses.append(addr)
    if not addresses:
        raise UnsafeURLError(f"Could not resolve domain '{host}'.")
    return addresses


def assert_public_addresses(host: str, addresses: Iterable[str]) -> List[str]:
    """Every address must be public; one bad answer rejects the host."""
    checked = []
    for addr in addresses:
        reason = blocked_ip_reason(addr)
        if reason:
            raise UnsafeURLError(
                f"Destination IP {addr} resolves to a private or restricted network ({reason})."
            )
        checked.append(addr)
    if not checked:
        raise UnsafeURLError(f"Could not resolve domain '{host}'.")
    return checked


async def validate_public_url(url: str) -> str:
    """Full check incl. DNS. Returns the normalized URL or raises UnsafeURLError."""
    normalized = normalize_url(url)
    parts = urlsplit(normalized)
    port = parts.port or (443 if parts.scheme == "https" else 80)
    assert_public_addresses(parts.hostname, await resolve_host(parts.hostname, port))
    return normalized


async def validate_url_security_async(url: str) -> Tuple[bool, str]:
    """(is_safe, normalized_url_or_error) without blocking the event loop."""
    try:
        return True, await validate_public_url(url)
    except UnsafeURLError as exc:
        return False, str(exc)
    except Exception as exc:  # pragma: no cover - defensive
        return False, f"URL validation failed: {type(exc).__name__}"


def validate_url_security(url: str) -> Tuple[bool, str]:
    """Synchronous variant (blocking DNS) kept for existing callers.
    Do not call from async code — use ``validate_url_security_async``."""
    try:
        normalized = normalize_url(url)
        parts = urlsplit(normalized)
        port = parts.port or (443 if parts.scheme == "https" else 80)
        literal = _literal_ip(parts.hostname)
        if literal is not None:
            addresses = [str(literal)]
        else:
            try:
                addresses = list(dict.fromkeys(
                    info[4][0] for info in socket.getaddrinfo(parts.hostname, port, type=socket.SOCK_STREAM)
                ))
            except (socket.gaierror, UnicodeError, OSError):
                return False, f"Could not resolve domain '{parts.hostname}'."
        assert_public_addresses(parts.hostname, addresses)
        return True, normalized
    except UnsafeURLError as exc:
        return False, str(exc)
    except Exception as exc:  # pragma: no cover - defensive
        return False, f"URL validation failed: {type(exc).__name__}"


# ── Connect-time enforcement ─────────────────────────────────────────────────

class SSRFSafeBackend(httpcore.AsyncNetworkBackend):
    """Resolves + validates at connect time and dials only validated IPs."""

    def __init__(self, inner: Optional[httpcore.AsyncNetworkBackend] = None):
        self._inner = inner or httpcore.AnyIOBackend()

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        addresses = assert_public_addresses(host, await resolve_host(host, port))
        last_error: Optional[BaseException] = None
        for addr in addresses:
            try:
                return await self._inner.connect_tcp(
                    addr, port, timeout=timeout, local_address=local_address, socket_options=socket_options
                )
            except (httpcore.ConnectError, httpcore.ConnectTimeout, OSError) as exc:
                last_error = exc
        if last_error is not None:
            raise last_error
        raise httpcore.ConnectError(f"Could not connect to {host}")

    async def connect_unix_socket(self, path, timeout=None, socket_options=None):
        raise UnsafeURLError("Unix socket connections are not permitted.")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


class SSRFSafeTransport(httpx.AsyncHTTPTransport):
    """httpx transport that never uses env proxies and connects via SSRFSafeBackend."""

    def __init__(self, *, limits: httpx.Limits = httpx.Limits(max_connections=10, max_keepalive_connections=5),
                 network_backend: Optional[httpcore.AsyncNetworkBackend] = None):
        super().__init__(trust_env=False, limits=limits)
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=httpx.create_ssl_context(trust_env=False),
            max_connections=limits.max_connections,
            max_keepalive_connections=limits.max_keepalive_connections,
            keepalive_expiry=limits.keepalive_expiry,
            http1=True,
            http2=False,
            network_backend=network_backend or SSRFSafeBackend(),
        )


async def _check_redirect_target(response: httpx.Response) -> None:
    """Response hook: reject redirects to non-http(s) schemes / internal hostnames
    early with a clear message (the backend still validates the IP at connect)."""
    if response.is_redirect:
        location = response.headers.get("Location")
        if location:
            target = str(response.url.join(location))
            try:
                normalize_url(target)
            except UnsafeURLError as exc:
                raise UnsafeURLError(f"Redirect to a prohibited destination was blocked: {exc}")


def safe_async_client(*, timeout: float = 12.0, max_redirects: int = 5, headers: Optional[dict] = None,
                      network_backend: Optional[httpcore.AsyncNetworkBackend] = None) -> httpx.AsyncClient:
    """AsyncClient for user-supplied URLs (see module docstring)."""
    return httpx.AsyncClient(
        transport=SSRFSafeTransport(network_backend=network_backend),
        trust_env=False,
        timeout=timeout,
        follow_redirects=True,
        max_redirects=max_redirects,
        headers=headers,
        event_hooks={"response": [_check_redirect_target]},
    )


async def fetch_limited(client: httpx.AsyncClient, url: str, *, max_bytes: int, deadline_seconds: float,
                        headers: Optional[dict] = None) -> Tuple[httpx.Response, bytes, bool]:
    """GET ``url`` reading at most ``max_bytes`` of body within ``deadline_seconds``.

    Returns (response, body, truncated). Raises UnsafeURLError for blocked
    destinations, httpx errors for network failures, asyncio.TimeoutError
    when the deadline passes.
    """
    async def _do() -> Tuple[httpx.Response, bytes, bool]:
        async with client.stream("GET", url, headers=headers) as response:
            chunks: List[bytes] = []
            size = 0
            truncated = False
            async for chunk in response.aiter_bytes():
                remaining = max_bytes - size
                if len(chunk) > remaining:
                    chunks.append(chunk[:remaining])
                    size = max_bytes
                    truncated = True
                    break
                chunks.append(chunk)
                size += len(chunk)
            return response, b"".join(chunks), truncated

    return await asyncio.wait_for(_do(), timeout=deadline_seconds)


def decode_body(response: httpx.Response, body: bytes) -> str:
    encoding = response.charset_encoding or "utf-8"
    try:
        return body.decode(encoding, errors="replace")
    except LookupError:
        return body.decode("utf-8", errors="replace")
