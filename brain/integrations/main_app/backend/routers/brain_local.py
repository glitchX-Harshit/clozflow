"""Authenticated main-app gateway to the loopback ClozFlow Brain."""
import os
from typing import Literal
from urllib.parse import urlsplit
from uuid import NAMESPACE_URL, UUID, uuid5

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from models import User
from routers.auth import get_current_user

router = APIRouter(prefix="/api/brain", tags=["Brain workspace"])


def tenant_for(user):
    return str(uuid5(NAMESPACE_URL, f"clozflow-local:user:{user.id}"))


async def call_brain(method, path, *, data=None, params=None):
    base = os.getenv("CLOZFLOW_BRAIN_URL", "http://127.0.0.1:8010").rstrip("/")
    url = urlsplit(base)
    if url.scheme != "http" or url.hostname not in {"127.0.0.1", "localhost", "::1"} or url.username:
        raise HTTPException(503, "Local Brain URL is invalid")
    try:
        async with httpx.AsyncClient(base_url=base, trust_env=False, timeout=httpx.Timeout(300, connect=3)) as client:
            result = await client.request(method, path, json=data, params=params)
        if result.status_code == 204:
            return {"status": "closed"}
        if result.is_error:
            detail = result.json().get("detail", "Brain request failed")
            raise HTTPException(result.status_code, detail)
        return result.json()
    except httpx.HTTPError:
        raise HTTPException(503, "The local Brain is unavailable. Start the local stack and retry.") from None


async def owned_session(session_id, user):
    return await call_brain("GET", f"/v1/sessions/{session_id}", params={"tenant_id": tenant_for(user)})


class SessionInput(BaseModel):
    call_context: dict = Field(default_factory=dict)
    reasoning_profile: Literal["compact", "full"] = "compact"
    session_id: UUID | None = None


@router.post("/sessions", status_code=201)
async def create_session(body: SessionInput, user: User = Depends(get_current_user)):
    return await call_brain("POST", "/v1/sessions", data={"tenant_id": tenant_for(user),
        "salesperson_id": str(user.id), "session_id": str(body.session_id) if body.session_id else None,
        "metadata": {"source": "clozflow-main", "call_context": body.call_context,
                     "reasoning_profile": body.reasoning_profile}})


@router.get("/sessions")
async def list_sessions(user: User = Depends(get_current_user)):
    return await call_brain('GET', f'/v1/tenants/{tenant_for(user)}/sessions')


@router.get("/sessions/{session_id}")
async def session(session_id: UUID, user: User = Depends(get_current_user)):
    return await owned_session(session_id, user)


@router.api_route("/sessions/{session_id}/{resource}", methods=["GET", "POST", "PATCH"])
async def session_resource(session_id: UUID, resource: str, request: Request, user: User = Depends(get_current_user)):
    await owned_session(session_id, user)
    allowed = {"worlds": "GET", "audit": "GET", "tasks": "GET", "wm": "GET",
               "transcripts": "POST", "feedback": "POST", "business-context": "PATCH", "close": "POST", "reflect": "POST"}
    if allowed.get(resource) != request.method:
        raise HTTPException(404, "Brain operation not found")
    if resource == "close":
        return await call_brain("DELETE", f"/v1/sessions/{session_id}", params={"tenant_id": tenant_for(user)})
    data = await request.json() if request.method != "GET" else None
    return await call_brain(request.method, f"/v1/sessions/{session_id}/{resource}", data=data)


@router.patch("/sessions/{session_id}/tasks/{task_id}")
async def task(session_id: UUID, task_id: UUID, request: Request, user: User = Depends(get_current_user)):
    await owned_session(session_id, user)
    return await call_brain("PATCH", f"/v1/sessions/{session_id}/tasks/{task_id}", data=await request.json())


@router.api_route("/{resource}", methods=["GET", "POST", "PUT"])
async def tenant_resource(resource: str, request: Request, user: User = Depends(get_current_user)):
    allowed = {("knowledge", "GET"): "knowledge", ("knowledge", "POST"): "knowledge/import",
               ("policy", "GET"): "policy", ("policy", "PUT"): "policy", ("learning", "GET"): "learning",
               ("export", "GET"): "export", ("retention", "GET"): "retention/preview"}
    path = allowed.get((resource, request.method))
    if not path:
        raise HTTPException(404, "Brain operation not found")
    result = await call_brain(request.method, f"/v1/tenants/{tenant_for(user)}/{path}",
                              data=await request.json() if request.method != "GET" else None)
    if resource == "export":
        import json
        return Response(json.dumps(result), media_type="application/json",
                        headers={"Content-Disposition": 'attachment; filename="clozflow-brain-export.json"'})
    return result
