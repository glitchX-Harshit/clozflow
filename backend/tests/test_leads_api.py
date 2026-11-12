import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import test_leads_helpers as h  # noqa: E402

import pytest  # noqa: E402

from services import lead_engine  # noqa: E402
from services.usage_limits import WindowRateLimiter  # noqa: E402
import routers.leads as leads_router  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_limits():
    h.reset_limits()
    yield
    h.reset_limits()


PROTECTED = [
    ("post", "/leads/search", {"query": "cafes in Pune"}),
    ("post", "/leads/deep-search", {"query": "cafes in Pune"}),
    ("post", "/leads/save", {"business_name": "X"}),
    ("get", "/leads/saved", None),
    ("delete", "/leads/saved/1", None),
    ("post", "/outreach/generate", {"lead_data": {"business_name": "X"}}),
    ("post", "/outreach/channels", {"lead_data": {"business_name": "X"}}),
    ("post", "/intelligence/derive-icp", {"offer": "websites"}),
    ("post", "/intelligence/chat", {"message": "hi"}),
    ("post", "/intelligence/why-this-lead", {"lead": {"business_name": "X"}}),
    ("post", "/intelligence/suggestions", {}),
    ("get", "/api/knowledge/overview", None),
    ("post", "/api/knowledge/crawl", {"url": "https://example.com"}),
    ("get", "/api/capsules", None),
    ("get", "/api/relay/", None),
    ("patch", "/api/relay/1", {"buyer_confirmed": True}),
]


@pytest.mark.parametrize("method,path,body", PROTECTED)
def test_paid_and_user_routes_require_login(method, path, body):
    c = h.client()
    kwargs = {"json": body} if body is not None else {}
    resp = getattr(c, method)(path, **kwargs)
    assert resp.status_code == 401, (path, resp.status_code, resp.text)


def test_search_without_places_key_returns_flagged_sample_leads():
    _, headers = h.make_user()
    resp = h.client().post("/leads/search", json={"query": "cafes in Pune"}, headers=headers)
    assert resp.status_code == 200, resp.text
    leads = resp.json()
    assert leads and all(lead["is_sample"] is True for lead in leads)
    assert resp.headers.get("X-Sample-Data") == "true"
    # No LLM key in tests -> rule-based enrichment, flagged as such.
    assert all(lead["ai_enriched"] is False for lead in leads)
    assert all("reviews_count" in lead for lead in leads)


def test_search_with_places_key_never_returns_fakes(monkeypatch):
    _, headers = h.make_user()
    monkeypatch.setenv("GOOGLE_PLACES_API_KEY", "configured-for-test")

    async def no_matches(business_type, location):
        return []

    monkeypatch.setattr(lead_engine, "_search_google_places", no_matches)
    resp = h.client().post("/leads/search", json={"query": "cafes in Pune"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json() == []
    assert "X-Sample-Data" not in resp.headers


@pytest.mark.parametrize("quota,expected", [(True, 503), (False, 502)])
def test_search_provider_failure_is_an_error_not_fake_leads(monkeypatch, quota, expected):
    _, headers = h.make_user()
    monkeypatch.setenv("GOOGLE_PLACES_API_KEY", "configured-for-test")

    async def failing(business_type, location):
        raise lead_engine.PlacesProviderError("boom", quota=quota, status_code=429 if quota else 500)

    monkeypatch.setattr(lead_engine, "_search_google_places", failing)
    resp = h.client().post("/leads/search", json={"query": "cafes in Pune"}, headers=headers)
    assert resp.status_code == expected
    assert resp.json()["detail"]
    if quota:
        assert resp.headers.get("Retry-After") == "60"


def test_places_http_errors_raise_provider_error(monkeypatch):
    """_search_google_places maps HTTP failures instead of returning []."""
    import asyncio
    import httpx

    monkeypatch.setenv("GOOGLE_PLACES_API_KEY", "configured-for-test")

    def handler(request):
        assert request.url.host == "places.googleapis.com"
        return httpx.Response(429, json={"error": {"status": "RESOURCE_EXHAUSTED"}})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(lead_engine.httpx, "AsyncClient",
                        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    with pytest.raises(lead_engine.PlacesProviderError) as info:
        asyncio.run(lead_engine._search_google_places("cafe", "Pune"))
    assert info.value.quota is True


def test_filters_are_applied_before_paid_enrichment(monkeypatch):
    _, headers = h.make_user()
    calls = []
    real = lead_engine.enrich_lead_ai

    async def counting(lead, user_offer=""):
        calls.append(lead["business_name"])
        return await real(lead, user_offer)

    monkeypatch.setattr(lead_engine, "enrich_lead_ai", counting)
    resp = h.client().post(
        "/leads/search",
        json={"query": "cafes in Pune", "filters": {"rating": 4.6}},
        headers=headers,
    )
    assert resp.status_code == 200
    leads = resp.json()
    assert all(lead["google_rating"] >= 4.6 for lead in leads)
    assert len(calls) == len(leads) < 20  # dropped leads were never enriched


def test_search_input_validation():
    _, headers = h.make_user()
    c = h.client()
    assert c.post("/leads/search", json={"query": "x"}, headers=headers).status_code == 400
    assert c.post("/leads/search", json={"query": "a" * 301}, headers=headers).status_code == 400
    bad = c.post("/leads/search", json={"query": "cafes", "filters": {"rating": "lots"}}, headers=headers)
    assert bad.status_code == 400 and "rating" in bad.json()["detail"]


def test_saved_leads_are_isolated_per_user():
    _, a = h.make_user("a")
    _, b = h.make_user("b")
    c = h.client()
    saved = c.post("/leads/save", json={"business_name": "Alpha Cafe", "city": "Pune", "lead_score": 70}, headers=a)
    assert saved.status_code == 200
    lead_id = saved.json()["id"]
    assert [l["id"] for l in c.get("/leads/saved", headers=a).json()] == [lead_id]
    assert c.get("/leads/saved", headers=b).json() == []
    assert c.delete(f"/leads/saved/{lead_id}", headers=b).status_code == 404
    assert c.delete(f"/leads/saved/{lead_id}", headers=a).status_code == 200


def test_resaving_a_lead_updates_contact_fields_owner_scoped():
    _, a = h.make_user("a")
    _, b = h.make_user("b")
    c = h.client()
    base = {"business_name": "Brew Lab", "city": "Pune", "lead_score": 60}
    first = c.post("/leads/save", json={**base, "phone_number": "+91 90000 00001", "website": "https://old.example"}, headers=a)
    lead_id = first.json()["id"]

    # Same name + city -> dedupe hit: the corrected number (and other sent contacts) win.
    again = c.post("/leads/save", json={**base, "phone_number": " +91 90000 00002 ", "instagram": "@brewlab"}, headers=a)
    assert again.json() == {"message": "Lead updated", "id": lead_id}
    saved = {l["id"]: l for l in c.get("/leads/saved", headers=a).json()}[lead_id]
    assert saved["phone_number"] == "+91 90000 00002"
    assert saved["instagram"] == "@brewlab"
    assert saved["website"] == "https://old.example"  # not sent -> kept

    # Empty values never erase stored contacts.
    c.post("/leads/save", json={**base, "phone_number": "", "website": "  "}, headers=a)
    saved = {l["id"]: l for l in c.get("/leads/saved", headers=a).json()}[lead_id]
    assert saved["phone_number"] == "+91 90000 00002" and saved["website"] == "https://old.example"

    # Another user's identical lead is a separate row and never touches A's.
    other = c.post("/leads/save", json={**base, "phone_number": "+91 90000 00009"}, headers=b)
    assert other.json()["message"] == "Lead saved" and other.json()["id"] != lead_id
    saved = {l["id"]: l for l in c.get("/leads/saved", headers=a).json()}[lead_id]
    assert saved["phone_number"] == "+91 90000 00002"


def test_search_rate_limit_is_per_user(monkeypatch):
    monkeypatch.setattr(leads_router, "_search_limiter", WindowRateLimiter("t", 2, 60, "Lead search rate limit exceeded."))
    _, a = h.make_user("a")
    _, b = h.make_user("b")
    c = h.client()
    body = {"query": "cafes in Pune", "filters": {"rating": 4.9}}
    assert c.post("/leads/search", json=body, headers=a).status_code == 200
    assert c.post("/leads/search", json=body, headers=a).status_code == 200
    limited = c.post("/leads/search", json=body, headers=a)
    assert limited.status_code == 429 and limited.headers.get("Retry-After")
    assert c.post("/leads/search", json=body, headers=b).status_code == 200
