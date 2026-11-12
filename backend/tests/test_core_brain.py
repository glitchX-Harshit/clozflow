"""Brain gateway error mapping (routers/brain_local.py)."""
import httpx
import pytest

from routers import brain_local


@pytest.fixture
def brain(monkeypatch):
    """Answer the gateway's Brain requests with ``brain.handler``."""
    state = {"handler": lambda request: httpx.Response(200, json=[])}
    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(lambda request: state["handler"](request))
        return real_client(*args, **kwargs)

    monkeypatch.delenv("CLOZFLOW_BRAIN_URL", raising=False)
    monkeypatch.setattr(brain_local.httpx, "AsyncClient", client_factory)
    return state


def _raise(exc):
    def handler(request):
        raise exc
    return handler


@pytest.mark.parametrize("status, body, expected_status, expected_detail", [
    (500, {"detail": "Traceback (most recent call last): secret internals"}, 503, brain_local.BRAIN_SERVER_ERROR),
    (502, "<html>bad gateway</html>", 503, brain_local.BRAIN_SERVER_ERROR),
    (401, {"detail": "bad token"}, 502, brain_local.BRAIN_REJECTED_GATEWAY),
    (404, {"detail": "Session not found"}, 404, "Session not found"),
    (409, "not json", 409, "Brain request failed"),
])
def test_brain_errors_are_mapped(core_client, core_make_user, brain, status, body, expected_status, expected_detail):
    _, headers = core_make_user()
    if isinstance(body, dict):
        brain["handler"] = lambda request: httpx.Response(status, json=body)
    else:
        brain["handler"] = lambda request: httpx.Response(status, text=body)
    r = core_client.get("/api/brain/sessions", headers=headers)
    assert r.status_code == expected_status
    assert r.json()["detail"] == expected_detail
    assert "Traceback" not in r.text


def test_brain_validation_details_are_relayed(core_client, core_make_user, brain):
    _, headers = core_make_user()
    detail = [{"loc": ["body", "text"], "msg": "Field required", "type": "missing"}]
    brain["handler"] = lambda request: httpx.Response(422, json={"detail": detail})
    r = core_client.get("/api/brain/sessions", headers=headers)
    assert (r.status_code, r.json()["detail"]) == (422, detail)


@pytest.mark.parametrize("exc, expected_status, expected_detail", [
    (httpx.ReadTimeout("slow"), 504, brain_local.BRAIN_TIMEOUT),
    (httpx.ConnectTimeout("down"), 503, brain_local.BRAIN_UNAVAILABLE),
    (httpx.ConnectError("refused"), 503, brain_local.BRAIN_UNAVAILABLE),
])
def test_brain_transport_failures(core_client, core_make_user, brain, exc, expected_status, expected_detail):
    _, headers = core_make_user()
    brain["handler"] = _raise(exc)
    r = core_client.get("/api/brain/sessions", headers=headers)
    assert (r.status_code, r.json()["detail"]) == (expected_status, expected_detail)


def test_unreadable_success_body_and_bad_request_json(core_client, core_make_user, brain):
    _, headers = core_make_user()
    brain["handler"] = lambda request: httpx.Response(200, text="definitely not json")
    r = core_client.get("/api/brain/sessions", headers=headers)
    assert (r.status_code, r.json()["detail"]) == (502, brain_local.BRAIN_BAD_RESPONSE)

    brain["handler"] = lambda request: httpx.Response(200, json={"ok": True})
    r = core_client.post("/api/brain/knowledge", headers={**headers, "Content-Type": "application/json"},
                         content=b"{not json")
    assert (r.status_code, r.json()["detail"]) == (422, "Request body must be valid JSON")
    ok = core_client.post("/api/brain/knowledge", headers=headers, json={"items": []})
    assert ok.status_code == 200 and ok.json() == {"ok": True}
