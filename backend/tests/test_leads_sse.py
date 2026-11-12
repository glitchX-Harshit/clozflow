import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import test_leads_helpers as h  # noqa: E402

import pytest  # noqa: E402

from services import lead_engine  # noqa: E402
import routers.leads as leads_router  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_limits():
    h.reset_limits()
    yield
    h.reset_limits()


def _deep(headers, body=None):
    return h.client().post("/leads/deep-search", json=body or {"query": "cafes in Pune"}, headers=headers)


def test_deep_search_streams_and_ends_with_complete_in_sample_mode():
    _, headers = h.make_user()
    resp = _deep(headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert resp.headers.get("x-accel-buffering") == "no"
    events = h.parse_sse(resp.text)
    assert events[0] == ("comment", "stream-open")
    names = [e for e, _ in events if e != "comment"]
    assert names[0] == "searching" and names[-1] == "complete"
    assert names.count("complete") == 1 and "error" not in names
    final = json.loads(events[-1][1])
    assert final["sample"] is True and final["stopped_reason"]
    assert final["leads"] and all(lead["is_sample"] for lead in final["leads"])
    found = [json.loads(d) for e, d in events if e == "lead_found"]
    assert found and all(lead["is_sample"] for lead in found)


def test_deep_search_quota_error_is_terminal_error_event(monkeypatch):
    _, headers = h.make_user()
    monkeypatch.setattr(lead_engine, "places_api_configured", lambda: True)

    async def quota(business_type, location):
        raise lead_engine.PlacesProviderError("quota", quota=True, status_code=429)

    monkeypatch.setattr(lead_engine, "_search_google_places", quota)
    events = h.parse_sse(_deep(headers).text)
    names = [e for e, _ in events if e != "comment"]
    assert names == ["searching", "area_done", "error"]
    err = json.loads(events[-1][1])
    assert err["code"] == "provider_quota" and err["detail"]


def test_deep_search_unexpected_failure_still_ends_with_error(monkeypatch):
    _, headers = h.make_user()

    async def broken(*args, **kwargs):
        yield lead_engine._sse("searching", {"area": "x"})
        raise RuntimeError("bug")

    monkeypatch.setattr(lead_engine, "deep_search_leads", broken)
    events = h.parse_sse(_deep(headers).text)
    names = [e for e, _ in events if e != "comment"]
    assert names == ["searching", "error"]
    assert json.loads(events[-1][1])["code"] == "internal_error"


def test_deep_search_concurrency_cap_per_user():
    user_id, headers = h.make_user()
    key = f"user:{user_id}"
    tokens = [leads_router._deep_search_slots.acquire(key) for _ in range(leads_router.MAX_CONCURRENT_DEEP_SEARCHES)]
    try:
        resp = _deep(headers)
        assert resp.status_code == 429
    finally:
        for t in tokens:
            leads_router._deep_search_slots.release(key, t)
    assert _deep(headers).status_code == 200
    # The slot taken by the finished stream was released.
    assert leads_router._deep_search_slots.active(key) == 0


class _FakeRequest:
    def __init__(self, disconnect_after=None):
        self.checks = 0
        self.disconnect_after = disconnect_after

    async def is_disconnected(self):
        self.checks += 1
        return self.disconnect_after is not None and self.checks > self.disconnect_after


def test_guarded_stream_stops_producer_when_client_disconnects():
    state = {"produced": 0, "closed": False}

    async def endless():
        try:
            while True:
                state["produced"] += 1
                yield lead_engine._sse("lead_found", {"n": state["produced"]})
                await asyncio.sleep(0.01)
        finally:
            state["closed"] = True

    async def run():
        closed = []
        frames = []
        async for frame in leads_router.sse_guarded_stream(
            _FakeRequest(disconnect_after=3), endless(), heartbeat_seconds=0.05, on_close=lambda: closed.append(1)
        ):
            frames.append(frame)
        await asyncio.sleep(0.05)
        leftovers = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
        return frames, closed, leftovers

    frames, closed, leftovers = asyncio.run(run())
    assert state["closed"] is True          # producer generator was closed
    assert closed == [1]                    # slot released exactly once
    assert leftovers == []                  # no task leaked
    assert not any(f.startswith(("event: complete", "event: error")) for f in frames)
    produced_at_stop = state["produced"]
    assert produced_at_stop < 50


def test_guarded_stream_heartbeats_and_adds_missing_terminal_event():
    async def slow_without_terminal():
        await asyncio.sleep(0.2)
        yield lead_engine._sse("searching", {"area": "a"})

    async def run():
        return [f async for f in leads_router.sse_guarded_stream(
            _FakeRequest(), slow_without_terminal(), heartbeat_seconds=0.03
        )]

    frames = asyncio.run(run())
    assert frames[0] == ": stream-open\n\n"
    assert ": keep-alive\n\n" in frames
    assert frames[-1].startswith("event: error")
    assert json.loads(frames[-1].split("data: ", 1)[1])["code"] == "incomplete"


def test_guarded_stream_stops_after_terminal_event():
    after = {"resumed": False}

    async def complete_then_more():
        yield lead_engine._sse("complete", {"total_leads": 0})
        after["resumed"] = True
        yield lead_engine._sse("lead_found", {})

    async def run():
        return [f async for f in leads_router.sse_guarded_stream(_FakeRequest(), complete_then_more())]

    frames = asyncio.run(run())
    assert frames[-1].startswith("event: complete")
    assert not any(f.startswith("event: lead_found") for f in frames)
