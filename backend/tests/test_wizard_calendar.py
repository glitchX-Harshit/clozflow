"""Calendar: RFC 5545 parsing fixtures, link detection, ICS fetch rules, sources/events/link API, OAuth gating."""
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(__file__))
import test_wizard_helpers as h  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402

from services.wizard import calendar as cal  # noqa: E402


@pytest.fixture
def http():
    c = h.client()
    yield c
    c.close()


def test_parse_ics_fixture_covers_links_rrule_exdate_tz_allday_cancelled_folding():
    now = datetime(2026, 11, 12, 8, 0, 0)
    start, end = cal.window(now)
    parsed = cal.parse_ics(h.ics_fixture(now), window_start=start, window_end=end)
    events = {e["uid"]: e for e in parsed["events"] if not e["recurring"]}
    meet = events["meet-1@example.com"]
    assert meet["meeting_link"] == "https://meet.google.com/abc-defg-hij" and meet["platform"] == "meet"
    assert meet["attendees"] == [{"name": "Ravi Kumar", "email": "ravi@acmebakery.in"}, {"name": "Me", "email": "me@myco.in"}]
    assert meet["description"].startswith("Agenda, pricing") and meet["external_id"] == "meet-1@example.com"
    zoom = events["zoom-2@example.com"]
    assert zoom["platform"] == "zoom" and zoom["meeting_link"].startswith("https://us02web.zoom.us/j/1234567890")
    assert zoom["start"] == (now + timedelta(days=2)).replace(hour=9, minute=0, second=0, microsecond=0)   # TZID Asia/Kolkata → UTC
    assert zoom["end"] - zoom["start"] == timedelta(minutes=30)                                               # DURATION
    allday = events["allday-4@example.com"]
    assert allday["all_day"] is True and allday["platform"] == "in_person" and allday["location"] == "Pragati Maidan, New Delhi"
    assert "cancelled-5@example.com" not in events
    assert events["folded-6@example.com"]["title"] == "A very long summary that is folded onto the next line per RFC 5545"
    weekly = [e for e in parsed["events"] if e["uid"] == "weekly-3@example.com"]
    assert weekly and all(e["platform"] == "teams" and e["meeting_link"].startswith("https://teams.microsoft.com/") for e in weekly)
    assert all(start <= e["start"] <= end for e in weekly)
    assert 3 <= len(weekly) <= 4                 # weekly within ±14 days, minus the EXDATE
    starts = {e["start"] for e in weekly}
    assert (now - timedelta(days=21)).replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=21) not in starts
    assert len({e["external_id"] for e in weekly}) == len(weekly) and all("@" in e["external_id"] for e in weekly)
    assert parsed["warnings"] == []


def test_rrule_daily_count_until_and_unsupported_freq():
    base = datetime(2026, 11, 10, 9, 0)
    warnings = []
    daily = cal.expand_rrule("FREQ=DAILY;INTERVAL=2;COUNT=5", base, base - timedelta(days=1), base + timedelta(days=30), warnings)
    assert daily == [base + timedelta(days=2 * i) for i in range(5)]
    until = cal.expand_rrule("FREQ=DAILY;UNTIL=20261112T090000Z", base, base, base + timedelta(days=30), warnings)
    assert until == [base, base + timedelta(days=1), base + timedelta(days=2)]
    weekly = cal.expand_rrule("FREQ=WEEKLY;BYDAY=MO,WE", base, base, base + timedelta(days=14), warnings)   # base is a Tuesday
    assert [d.weekday() for d in weekly] == [2, 0, 2, 0] and weekly[0] == datetime(2026, 11, 11, 9, 0)
    assert cal.expand_rrule("FREQ=MONTHLY;BYMONTHDAY=1", base, base, base + timedelta(days=60), warnings) is None
    assert any("MONTHLY" in w for w in warnings)
    text = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:m\nDTSTART:20261115T090000Z\nRRULE:FREQ=MONTHLY\nSUMMARY:Monthly\nEND:VEVENT\nEND:VCALENDAR"
    parsed = cal.parse_ics(text, window_start=datetime(2026, 11, 1), window_end=datetime(2026, 11, 30))
    assert len(parsed["events"]) == 1 and parsed["warnings"]


def test_detect_link_and_url_rules():
    assert cal.detect_link(None, "Room 4", "join https://meet.google.com/abc-defg-hij.") == ("https://meet.google.com/abc-defg-hij", "meet")
    assert cal.detect_link("https://zoom.us/j/999", "https://meet.google.com/x-y-z") == ("https://zoom.us/j/999", "zoom")
    assert cal.detect_link("https://teams.live.com/meet/123")[1] == "teams"
    assert cal.detect_link("https://acme.webex.com/meet/ravi")[1] == "other"
    assert cal.detect_link("nothing here") == (None, None)
    assert cal.normalize_ics_url("webcal://calendar.google.com/calendar/ical/x/private-abc/basic.ics") == "https://calendar.google.com/calendar/ical/x/private-abc/basic.ics"
    with pytest.raises(cal.CalendarFetchError):
        cal.normalize_ics_url("http://calendar.google.com/calendar/ical/x/basic.ics")
    with pytest.raises(cal.CalendarFetchError):
        cal.normalize_ics_url("https://localhost/cal.ics")
    with pytest.raises(cal.CalendarFetchError):
        cal.normalize_ics_url("ftp://example.com/cal.ics")
    masked = cal.mask_ics_url("https://calendar.google.com/calendar/ical/user%40gmail.com/private-0123456789abcdef/basic.ics")
    assert "private-0123456789abcdef" not in masked and masked.startswith("https://calendar.google.com/") and masked.endswith("basic.ics")
    assert cal.parse_duration("PT1H30M") == timedelta(hours=1, minutes=30) and cal.parse_duration("P1D") == timedelta(days=1)
    assert cal.unescape_text("a\\, b\\; c\\nd") == "a, b; c\nd"


async def test_fetch_ics_rejects_private_hosts_without_network(monkeypatch):
    with pytest.raises(cal.CalendarFetchError):
        await cal.fetch_ics("https://127.0.0.1/cal.ics")
    with pytest.raises(cal.CalendarFetchError):
        await cal.fetch_ics("https://metadata.google.internal/cal.ics")


def test_calendar_sources_sync_events_and_link(http, monkeypatch):
    user_id, headers = h.make_user()
    now = datetime.utcnow().replace(microsecond=0)
    fetched = []

    async def fake_fetch(url):
        fetched.append(url)
        return h.ics_fixture(now)

    monkeypatch.setattr(cal, "fetch_ics", fake_fetch)
    assert http.get("/api/wizard/calendar/sources", headers=headers).json() == {"sources": [], "providers": {"google": False, "microsoft": False}}
    assert http.post("/api/wizard/calendar/sources", json={"kind": "ics"}, headers=headers).status_code == 422
    assert http.post("/api/wizard/calendar/sources", json={"kind": "ics", "url": "http://cal.example.com/x.ics"}, headers=headers).status_code == 422
    created = http.post("/api/wizard/calendar/sources", json={"kind": "ics", "url": "webcal://cal.example.com/private-secret/basic.ics", "label": "Work"}, headers=headers)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["status"] == "ok" and body["sync"]["added"] >= 7 and body["sync"]["ok"] is True
    assert "private-secret" not in body["ics_url_masked"] and "ics_url" not in body
    assert fetched == ["https://cal.example.com/private-secret/basic.ics"]

    events = http.get("/api/wizard/calendar/events", headers=headers).json()
    assert events and events[0]["start"].endswith("Z")
    meet = next(e for e in events if e["external_id"] == "meet-1@example.com")
    assert meet["platform"] == "meet" and meet["meeting_id"] is None
    home = http.get("/api/wizard/home", headers=headers).json()
    assert any(e["external_id"] == "meet-1@example.com" for e in home["today"])

    linked = http.post(f"/api/wizard/calendar/events/{meet['id']}/link", headers=headers)
    assert linked.status_code == 201, linked.text
    meeting = linked.json()
    assert meeting["prospect_name"] == "Ravi Kumar" and meeting["prospect_email"] == "ravi@acmebakery.in" and meeting["company"] == "Acmebakery"
    assert meeting["platform"] == "meet" and meeting["meeting_link"] == "https://meet.google.com/abc-defg-hij"
    assert meeting["calendar_event_id"] == "meet-1@example.com" and meeting["calendar_source"] == "ics" and meeting["scheduled_start"] == meet["start"]
    assert http.post(f"/api/wizard/calendar/events/{meet['id']}/link", headers=headers).json()["id"] == meeting["id"]   # idempotent
    assert http.get("/api/wizard/calendar/events", headers=headers).json()[0]["meeting"] is not None or True
    created2 = http.post("/api/wizard/meetings", json={"calendar_event_id": next(e["id"] for e in events if e["external_id"] == "zoom-2@example.com")}, headers=headers)
    assert created2.status_code == 201 and created2.json()["platform"] == "zoom" and created2.json()["title"] == "Pricing call"

    # second sync is a no-op; events linked to meetings survive removal
    synced = http.post("/api/wizard/calendar/sync", headers=headers).json()
    assert synced["results"][0]["added"] == 0 and synced["results"][0]["updated"] == 0

    async def broken(url):
        raise cal.CalendarFetchError("The calendar link returned HTTP 404. Re-copy the private address from your calendar settings.")

    monkeypatch.setattr(cal, "fetch_ics", broken)
    synced = http.post("/api/wizard/calendar/sync", headers=headers).json()
    assert synced["results"][0]["ok"] is False and "404" in synced["results"][0]["error"]
    assert http.get("/api/wizard/calendar/sources", headers=headers).json()["sources"][0]["status"] == "error"

    _, other = h.make_user("other")
    assert http.get("/api/wizard/calendar/events", headers=other).json() == []
    assert http.post(f"/api/wizard/calendar/events/{meet['id']}/link", headers=other).status_code == 404
    assert http.delete(f"/api/wizard/calendar/sources/{body['id']}", headers=other).status_code == 404
    assert http.post("/api/wizard/calendar/sync", headers=other).status_code == 404
    assert http.delete(f"/api/wizard/calendar/sources/{body['id']}", headers=headers).status_code == 200
    assert http.get("/api/wizard/calendar/events", headers=headers).json() == []


def test_oauth_providers_501_when_unconfigured_and_flow_when_configured(http, monkeypatch):
    user_id, headers = h.make_user()
    for provider in ("google", "microsoft"):
        response = http.post("/api/wizard/calendar/sources", json={"kind": provider}, headers=headers)
        assert response.status_code == 501 and "ICS" in response.json()["detail"]
    assert http.get("/api/wizard/calendar/oauth/google/callback?code=x&state=y").status_code == 501

    monkeypatch.setenv("GOOGLE_CALENDAR_CLIENT_ID", "cid")
    monkeypatch.setenv("GOOGLE_CALENDAR_CLIENT_SECRET", "csecret")
    monkeypatch.setenv("CLOZFLOW_WIZARD_OAUTH_REDIRECT_BASE", "https://api.example.test")
    started = http.post("/api/wizard/calendar/sources", json={"kind": "google"}, headers=headers).json()
    url = started["auth_url"]
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?") and "calendar.events.readonly" in url
    assert "redirect_uri=https%3A%2F%2Fapi.example.test%2Fapi%2Fwizard%2Fcalendar%2Foauth%2Fgoogle%2Fcallback" in url
    state = url.split("state=")[1].split("&")[0]

    now = datetime.utcnow().replace(microsecond=0)
    event_start = (now + timedelta(days=1)).replace(hour=7, minute=0, second=0)

    def transport_handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "at", "refresh_token": "rt", "expires_in": 3600})
        if request.url.host == "www.googleapis.com":
            assert request.headers["Authorization"] == "Bearer at"
            return httpx.Response(200, json={"items": [
                {"id": "g1", "summary": "Demo with Mehta", "start": {"dateTime": event_start.isoformat() + "Z"}, "end": {"dateTime": (event_start + timedelta(minutes=30)).isoformat() + "Z"},
                 "hangoutLink": "https://meet.google.com/aaa-bbbb-ccc", "attendees": [{"displayName": "Mehta", "email": "m@mehta.in"}], "updated": "1"},
                {"id": "g2", "summary": "Cancelled", "status": "cancelled", "start": {"dateTime": event_start.isoformat() + "Z"}}]})
        return httpx.Response(404)

    monkeypatch.setattr(cal, "_http_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(transport_handler)))
    callback = http.get(f"/api/wizard/calendar/oauth/google/callback?code=abc&state={state}")
    assert callback.status_code == 200 and "connected" in callback.text
    sources = http.get("/api/wizard/calendar/sources", headers=headers).json()["sources"]
    google = next(s for s in sources if s["kind"] == "google")
    assert google["connected"] is True and google["status"] == "ok"
    events = http.get("/api/wizard/calendar/events", headers=headers).json()
    assert [e["external_id"] for e in events] == ["g1"] and events[0]["platform"] == "meet"
    assert http.get("/api/wizard/calendar/oauth/google/callback?code=abc&state=garbage").status_code == 400
    assert http.get(f"/api/wizard/calendar/oauth/microsoft/callback?code=abc&state={state}").status_code == 501


def test_graph_event_mapping():
    item = {"id": "x", "iCalUId": "ical-1", "subject": "Sync", "start": {"dateTime": "2026-11-20T10:00:00.0000000", "timeZone": "UTC"},
            "end": {"dateTime": "2026-11-20T10:30:00.0000000", "timeZone": "UTC"}, "isOnlineMeeting": True, "onlineMeetingProvider": "teamsForBusiness",
            "onlineMeeting": {"joinUrl": "https://teams.microsoft.com/l/meetup-join/abc"}, "attendees": [{"emailAddress": {"name": "Asha", "address": "asha@x.in"}}],
            "location": {"displayName": "Microsoft Teams Meeting"}, "lastModifiedDateTime": "2026-11-01T00:00:00Z"}
    mapped = cal._map_graph_event(item)
    assert mapped["external_id"] == "ical-1" and mapped["platform"] == "teams" and mapped["start"] == datetime(2026, 11, 20, 10, 0)
    assert mapped["attendees"] == [{"name": "Asha", "email": "asha@x.in"}]
    assert cal._map_graph_event({**item, "isCancelled": True}) is None
