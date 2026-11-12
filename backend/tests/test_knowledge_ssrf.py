"""SSRF guard tests — no real network: DNS and sockets are mocked."""

import asyncio
import os
import socket
import sys

sys.path.insert(0, os.path.dirname(__file__))
import test_leads_helpers as h  # noqa: E402,F401  (env + sys.path setup)

import httpcore  # noqa: E402
import pytest  # noqa: E402

from services.knowledge import url_safety  # noqa: E402
from services.knowledge.crawler import WebsiteCrawler  # noqa: E402

BLOCKED = [
    "127.0.0.1", "127.8.9.10", "10.1.2.3", "172.16.5.4", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "240.0.0.1", "255.255.255.255", "198.18.0.1",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1",
    "::ffff:169.254.169.254", "64:ff9b::a9fe:a9fe", "2002:7f00:1::1", "2001:db8::1",
]
ALLOWED = ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "64:ff9b::808:808"]


@pytest.mark.parametrize("ip", BLOCKED)
def test_non_public_addresses_are_blocked(ip):
    assert url_safety.blocked_ip_reason(ip, allow_private=False)


@pytest.mark.parametrize("ip", ALLOWED)
def test_public_addresses_are_allowed(ip):
    assert url_safety.blocked_ip_reason(ip, allow_private=False) is None


def test_dev_flag_allows_private_but_never_metadata():
    assert url_safety.blocked_ip_reason("127.0.0.1", allow_private=True) is None
    assert url_safety.blocked_ip_reason("10.0.0.7", allow_private=True) is None
    assert url_safety.blocked_ip_reason("169.254.169.254", allow_private=True)
    assert url_safety.blocked_ip_reason("::ffff:169.254.169.254", allow_private=True)
    assert url_safety.blocked_ip_reason("224.0.0.1", allow_private=True)


@pytest.mark.parametrize("url", [
    "ftp://example.com/x", "file:///etc/passwd", "gopher://example.com/", "javascript:alert(1)",
    "http://user:pass@example.com/", "http://evil.com@127.0.0.1/", "http://localhost:8000/",
    "http://metadata.google.internal/computeMetadata/v1/", "http://db.internal/", "http://printer.local/",
    "http://example.com:99999/", "http://exa mple.com/",
])
def test_bad_urls_are_rejected_before_dns(url):
    with pytest.raises(url_safety.UnsafeURLError):
        url_safety.normalize_url(url)


def test_bare_domain_is_normalized_to_https():
    assert url_safety.normalize_url("example.com/pricing?x=1") == "https://example.com/pricing?x=1"


def _fake_dns(monkeypatch, table):
    def fake_getaddrinfo(host, port, *args, **kwargs):
        if host not in table:
            raise socket.gaierror("unknown host")
        return [(socket.AF_INET6 if ":" in ip else socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))
                for ip in table[host]]
    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)


def test_dns_answers_are_all_checked(monkeypatch):
    _fake_dns(monkeypatch, {
        "public.test": ["93.184.216.34"],
        "mixed.test": ["93.184.216.34", "10.0.0.5"],
        "rebind.test": ["169.254.169.254"],
        "2130706433": ["127.0.0.1"],  # decimal IP literal resolves to loopback
    })
    assert asyncio.run(url_safety.validate_public_url("http://public.test/")) == "http://public.test/"
    for url in ("http://mixed.test/", "http://rebind.test/", "http://2130706433/", "http://nope.test/"):
        ok, reason = asyncio.run(url_safety.validate_url_security_async(url))
        assert ok is False and reason
    ok, reason = url_safety.validate_url_security("http://mixed.test/")  # sync legacy API
    assert ok is False and "10.0.0.5" in reason


class _RecordingBackend(httpcore.AsyncNetworkBackend):
    """Inner backend: records dialed hosts and serves canned HTTP responses."""

    def __init__(self, responses):
        self.dialed = []
        self._responses = responses

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        self.dialed.append(host)
        return httpcore.AsyncMockStream(list(self._responses(host)))

    async def sleep(self, seconds):
        await asyncio.sleep(seconds)


def _http(status, headers=(), body=b""):
    head = f"HTTP/1.1 {status}\r\n" + "".join(f"{k}: {v}\r\n" for k, v in headers)
    head += f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n"
    return [head.encode() + body]


def _run_get(backend, url, **kw):
    async def go():
        async with url_safety.safe_async_client(network_backend=url_safety.SSRFSafeBackend(backend)) as client:
            return await url_safety.fetch_limited(client, url, max_bytes=kw.get("max_bytes", 10_000), deadline_seconds=5)
    return asyncio.run(go())


def test_connect_time_check_dials_validated_ip_only(monkeypatch):
    _fake_dns(monkeypatch, {"public.test": ["93.184.216.34"]})
    inner = _RecordingBackend(lambda host: _http("200 OK", [("Content-Type", "text/html")], b"<p>ok</p>"))
    resp, body, truncated = _run_get(inner, "http://public.test/")
    assert resp.status_code == 200 and body == b"<p>ok</p>" and not truncated
    assert inner.dialed == ["93.184.216.34"]  # the IP, never the hostname


def test_redirect_to_private_address_is_blocked_at_connect(monkeypatch):
    _fake_dns(monkeypatch, {"public.test": ["93.184.216.34"], "sneaky.test": ["10.0.0.5"]})
    inner = _RecordingBackend(lambda host: _http("302 Found", [("Location", "http://sneaky.test/admin")]))
    with pytest.raises(url_safety.UnsafeURLError):
        _run_get(inner, "http://public.test/")
    assert inner.dialed == ["93.184.216.34"]  # 10.0.0.5 was never dialed


def test_redirect_to_metadata_literal_and_bad_scheme_blocked(monkeypatch):
    _fake_dns(monkeypatch, {"public.test": ["93.184.216.34"]})
    for location in ("http://169.254.169.254/latest/meta-data/", "file:///etc/passwd", "http://localhost/"):
        inner = _RecordingBackend(lambda host, loc=location: _http("301 Moved", [("Location", loc)]))
        with pytest.raises(Exception) as info:
            _run_get(inner, "http://public.test/")
        assert isinstance(info.value, url_safety.UnsafeURLError) or "UnsupportedProtocol" in type(info.value).__name__
        assert inner.dialed == ["93.184.216.34"]


def test_response_size_is_capped(monkeypatch):
    _fake_dns(monkeypatch, {"public.test": ["93.184.216.34"]})
    inner = _RecordingBackend(lambda host: _http("200 OK", [("Content-Type", "text/html")], b"a" * 50_000))
    resp, body, truncated = _run_get(inner, "http://public.test/", max_bytes=1000)
    assert truncated is True and len(body) == 1000


def test_crawler_rejects_private_start_url(monkeypatch):
    _fake_dns(monkeypatch, {"intranet.test": ["192.168.0.10"]})
    with pytest.raises(ValueError):
        asyncio.run(WebsiteCrawler("http://intranet.test/").crawl())


def test_crawler_is_bounded_and_uses_guarded_connections(monkeypatch):
    _fake_dns(monkeypatch, {"shop.test": ["93.184.216.34"]})
    links = "".join(f'<li><a href="/page-{i}">Page number {i} details</a></li>' for i in range(40))
    html = f"<html><head><title>Shop</title></head><body><h1>Shop home page</h1><p>{'Great products for everyone. ' * 10}</p><ul>{links}</ul></body></html>"
    inner = _RecordingBackend(lambda host: _http("200 OK", [("Content-Type", "text/html")], html.encode()))
    crawler = WebsiteCrawler("http://shop.test/", max_pages=4, network_backend=url_safety.SSRFSafeBackend(inner))
    results = asyncio.run(crawler.crawl())
    assert 1 <= len(results) <= 4
    assert set(inner.dialed) == {"93.184.216.34"}
