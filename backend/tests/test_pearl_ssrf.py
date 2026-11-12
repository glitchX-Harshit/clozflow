"""
SSRF guard for user-configured tool URLs (services/pearl/outbound_http.py) and its use by the
API-tool executor. No real network: blocked destinations are refused before any connect,
and allowed-host behaviour is exercised with httpx.MockTransport.
"""
import asyncio
import http.cookiejar
import pathlib
import socket
import sys

import httpx
import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from services.pearl import outbound_http as oh  # noqa: E402
from services.pearl.tool_engine import execute_api_tool, run_tool_test  # noqa: E402


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _production_policy(monkeypatch):
    monkeypatch.delenv("ALLOW_LOCALHOST_CRAWL", raising=False)  # dev-only override of the shared policy


@pytest.mark.parametrize("address", [
    "127.0.0.1", "127.8.9.10", "10.0.0.5", "172.16.3.4", "192.168.1.1", "169.254.169.254", "169.254.0.1",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255", "198.18.0.1",
    "192.0.2.10", "192.88.99.1", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "fec0::1", "ff02::1",
    "2001:db8::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "64:ff9b::a9fe:a9fe", "2002:7f00:1::1",
    "not-an-ip",
])
def test_non_public_addresses_are_disallowed(address):
    assert oh.is_disallowed_address(address) is True


@pytest.mark.parametrize("address", ["8.8.8.8", "93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "64:ff9b::808:808"])
def test_public_addresses_are_allowed(address):
    assert oh.is_disallowed_address(address) is False


@pytest.mark.parametrize("url", [
    "ftp://example.com/x", "file:///etc/passwd", "gopher://example.com", "http:///nohost", "javascript:alert(1)",
    "http://user:secret@example.com/x", "http://example.com@127.0.0.1/", "http://metadata.google.internal/computeMetadata/v1/",
    "http://printer.local/", "http://db.internal:5432/", "http://localhost/",
])
def test_scheme_credentials_and_internal_hostnames_rejected_without_dns(url):
    with pytest.raises(oh.OutboundRequestBlocked):
        oh.check_url(url)


def test_substituted_query_values_with_spaces_are_still_allowed():
    assert oh.check_url("https://api.example.com/v1/search?q=John Doe&city=New Delhi").host == "api.example.com"


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/admin", "http://localhost:8000/", "http://[::1]:8080/", "http://169.254.169.254/latest/meta-data/",
    "http://2130706433/", "http://0x7f000001/", "http://127.1/", "https://10.1.2.3/api", "http://[::ffff:127.0.0.1]/",
    "http://0.0.0.0:22/",
])
def test_internal_destinations_blocked_before_connect(url):
    with pytest.raises(oh.OutboundRequestBlocked):
        run(oh.check_destination(url))


def test_any_private_answer_in_dns_blocks(monkeypatch):
    def fake_getaddrinfo(host, port, *args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port)),
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.7", port))]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(oh.OutboundRequestBlocked):
        run(oh.check_destination("https://mixed.example.test/"))


def test_connect_time_check_defeats_dns_rebinding(monkeypatch):
    """First lookup (pre-flight) is public, the connect-time lookup is internal: still blocked."""
    answers = iter(["93.184.216.34", "127.0.0.1", "127.0.0.1"])

    def fake_getaddrinfo(host, port, *args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (next(answers), port))]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)

    async def go():
        client = oh.create_guarded_client()
        try:
            await oh.guarded_request(client, "GET", "http://rebind.example.test/", timeout=5)
        finally:
            await client.aclose()

    with pytest.raises(oh.OutboundRequestBlocked):
        run(go())


def test_guarded_transport_refuses_internal_ip_even_without_preflight():
    async def go():
        client = oh.create_guarded_client()
        try:
            await client.get("http://127.0.0.1:9/")  # bypasses guarded_request's own checks
        finally:
            await client.aclose()

    with pytest.raises(oh.OutboundRequestBlocked):
        run(go())


def test_redirect_to_metadata_service_is_blocked_on_hop():
    seen = []

    def handler(request):
        seen.append(str(request.url))
        return httpx.Response(302, headers={"Location": "http://169.254.169.254/latest/meta-data/iam"})

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await oh.guarded_request(client, "GET", "http://93.184.216.34/start", timeout=5)

    with pytest.raises(oh.OutboundRequestBlocked):
        run(go())
    assert seen == ["http://93.184.216.34/start"]  # the internal hop was never requested


def test_redirects_are_followed_with_recheck_and_bounded():
    def handler(request):
        if request.url.path == "/start":
            return httpx.Response(301, headers={"Location": "/final"})
        if request.url.path == "/final":
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(302, headers={"Location": "/loop"})

    async def go(path, **kw):
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await oh.guarded_request(client, "GET", f"http://93.184.216.34{path}", timeout=5, **kw)

    res = run(go("/start"))
    assert res.status_code == 200 and res.json() == {"ok": True}
    with pytest.raises(oh.TooManyRedirects):
        run(go("/loop", max_redirects=3))


def test_response_size_is_capped():
    big = b"x" * (oh.DEFAULT_MAX_RESPONSE_BYTES + 10)

    async def chunked():
        yield big[:600_000]
        yield big[600_000:]

    def handler(request):
        if request.url.path == "/declared":
            return httpx.Response(200, content=big)
        return httpx.Response(200, content=chunked())  # streamed, no Content-Length

    async def go(path):
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await oh.guarded_request(client, "GET", f"http://93.184.216.34{path}", timeout=5)

    for path in ("/declared", "/streamed"):
        with pytest.raises(oh.ResponseTooLarge):
            run(go(path))


def test_total_deadline_applies_to_slow_responses():
    async def slow_body():
        for _ in range(50):
            await asyncio.sleep(0.1)
            yield b"."

    def handler(request):
        return httpx.Response(200, content=slow_body())

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await oh.guarded_request(client, "GET", "http://93.184.216.34/slow", timeout=1)

    with pytest.raises(asyncio.TimeoutError):
        run(go())


def test_cookies_are_never_stored_or_replayed():
    seen_cookie_headers = []

    def handler(request):
        seen_cookie_headers.append(request.headers.get("cookie"))
        return httpx.Response(200, headers={"Set-Cookie": "session=tenant-a; Path=/"}, json={})

    async def go():
        jar = http.cookiejar.CookieJar(policy=oh._RejectAllCookies())
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), cookies=jar) as client:
            await oh.guarded_request(client, "GET", "http://93.184.216.34/a", timeout=5)
            await oh.guarded_request(client, "GET", "http://93.184.216.34/b", timeout=5)
            return len(client.cookies.jar)

    assert run(go()) == 0
    assert seen_cookie_headers == [None, None]


def test_guarded_client_has_no_redirects_proxies_or_cookie_memory():
    client = oh.create_guarded_client()
    try:
        assert client.follow_redirects is False and client.trust_env is False
    finally:
        run(client.aclose())


def test_api_tool_execution_and_tool_test_are_guarded():
    res = run(execute_api_tool({"url": "http://169.254.169.254/latest/meta-data/", "method": "GET"}))
    assert res["success"] is False and res["status_code"] == 403 and "Blocked" in res["error"]

    res = run(run_tool_test("api_tool", {"url": "http://127.0.0.1:8000/api/pearl/agents", "method": "POST", "body": "{}"}))
    assert res["success"] is False and res["status_code"] == 403

    res = run(execute_api_tool({"url": "http://{{host}}/x"}, test_inputs={"host": "localhost"}))
    assert res["success"] is False and res["status_code"] == 403
