"""Copilot bridge call API: the backend calls the rep's phone, bridges the prospect,
and streams both sides of the call through the live copilot.

App endpoints (Bearer JWT, owner only) and carrier endpoints (per-call secret in the
URL). Contract and setup: docs/copilot_bridge.md. Startup cleanup + watchdog run in
this router's lifespan, which ``include_router`` merges into the app's.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from contextlib import asynccontextmanager
from typing import Optional, Union
from urllib.parse import parse_qsl

from fastapi import APIRouter, Depends, Request, WebSocket
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict

import models_bridge  # noqa: F401  (registers copilot_bridge_calls before main.py runs create_all)
from database import SessionLocal
from models import User
from routers.auth import get_current_user, verify_token_string
from services.bridge.config import load_config
from services.bridge.service import BridgeError, bridge_service
from services.bridge.xml_builder import empty_xml

MAX_CARRIER_BODY_BYTES = 64 * 1024


class _RedactSecrets(logging.Filter):
    """Access logs print request URLs; per-call carrier secrets (``t=``) and
    ``token=`` query parameters must never reach them."""
    _pattern = re.compile(r"([?&](?:t|token)=)[^&\s\"']+")

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if isinstance(record.args, tuple) and record.args:
                record.args = tuple(self._pattern.sub(r"\1[redacted]", arg) if isinstance(arg, str) else arg
                                    for arg in record.args)
            if isinstance(record.msg, str):
                record.msg = self._pattern.sub(r"\1[redacted]", record.msg)
        except Exception:
            pass
        return True


_redactor = _RedactSecrets()
for _logger_name in ("uvicorn.access", "uvicorn.error"):
    if not any(isinstance(f, _RedactSecrets) for f in logging.getLogger(_logger_name).filters):
        logging.getLogger(_logger_name).addFilter(_redactor)


@asynccontextmanager
async def lifespan(app):
    # Rows left non-ended by a previous process → ended/server_restart; start the
    # ringing-timeout / time-limit watchdog.
    await bridge_service.startup()
    try:
        yield
    finally:
        await bridge_service.shutdown()


router = APIRouter(prefix="/api/copilot/bridge", tags=["copilot bridge"], lifespan=lifespan)


def _error(exc: BridgeError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail, **exc.extra})


class BridgeCallCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    context_id: Optional[str] = None
    prospect_phone: Optional[Union[str, int]] = None
    rep_phone: Optional[Union[str, int]] = None
    prospect_name: Optional[str] = None


# ── App API ──────────────────────────────────────────────────────────────────

@router.get("/config")
def bridge_config(current_user: User = Depends(get_current_user)):
    return load_config().public_payload()


@router.post("/calls", status_code=201)
async def create_bridge_call(body: BridgeCallCreate, current_user: User = Depends(get_current_user)):
    try:
        return await bridge_service.create_call(
            current_user, context_id=body.context_id, prospect_phone=body.prospect_phone,
            rep_phone=body.rep_phone, prospect_name=body.prospect_name)
    except BridgeError as exc:
        return _error(exc)


@router.get("/calls/{call_id}")
async def get_bridge_call(call_id: str, current_user: User = Depends(get_current_user)):
    try:
        return await bridge_service.get_call(current_user, call_id)
    except BridgeError as exc:
        return _error(exc)


@router.post("/calls/{call_id}/hangup")
async def hangup_bridge_call(call_id: str, current_user: User = Depends(get_current_user)):
    try:
        return await bridge_service.request_hangup(current_user, call_id)
    except BridgeError as exc:
        return _error(exc)


def _socket_token(websocket: WebSocket) -> Optional[str]:
    authorization = websocket.headers.get("authorization", "")
    scheme, _, credentials = authorization.strip().partition(" ")
    if scheme.lower() == "bearer" and credentials.strip():
        return credentials.strip()
    token = (websocket.query_params.get("token") or "").strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if token:
        return token
    for item in websocket.headers.get("sec-websocket-protocol", "").split(","):
        if item.strip().startswith("clozflow-auth."):
            return item.strip()[len("clozflow-auth."):] or None
    return None


def _user_id_for_token(token: str) -> Optional[int]:
    with SessionLocal() as db:
        user = verify_token_string(token, db)
        return user.id if user is not None else None


@router.websocket("/calls/{call_id}/events")
async def bridge_call_events(websocket: WebSocket, call_id: str):
    """Server → app: ``callStatus`` (now and on every change), ``transcriptUpdate``,
    ``aiAnalysis``, ``session_ended``. On (re)connect the current status, the
    transcript so far (last 200 lines) and the latest analysis are replayed."""
    offered = [value.strip() for value in websocket.headers.get("sec-websocket-protocol", "").split(",")]
    await websocket.accept(subprotocol="clozflow" if "clozflow" in offered else None)
    token = _socket_token(websocket)
    user_id = await asyncio.to_thread(_user_id_for_token, token) if token else None
    if user_id is None:
        await websocket.close(code=4401)
        return
    row = await bridge_service.get_row(call_id)
    if row is None or row["user_id"] != user_id:
        await websocket.close(code=4404)
        return
    subscriber = await bridge_service.subscribe(websocket, user_id, call_id)
    try:
        while True:   # {"type":"ping"} keep-alives and anything else are ignored
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
    except Exception:
        pass
    finally:
        subscriber.request_close(1000)


# ── Carrier (Vobiz) endpoints ─────────────────────────────────────────────────

async def _carrier_request(request: Request):
    """(call row if ``bid``/``t`` are valid, callback params, token)."""
    params = {}
    if request.method == "POST":
        body = await request.body()
        content_type = request.headers.get("content-type", "").lower()
        if body and len(body) <= MAX_CARRIER_BODY_BYTES:
            if "json" in content_type:
                try:
                    parsed = json.loads(body)
                except ValueError:
                    parsed = {}
                params = parsed if isinstance(parsed, dict) else {}
            elif "multipart/form-data" in content_type:
                form = await request.form()
                params = {key: value for key, value in form.items() if isinstance(value, str)}
            else:
                params = dict(parse_qsl(body.decode("utf-8", "replace"), keep_blank_values=True))
    else:
        params = {key: value for key, value in request.query_params.items() if key not in ("bid", "t")}
    token = request.query_params.get("t", "")
    row = await bridge_service.authorize_carrier(request.query_params.get("bid", ""), token)
    return row, params, token


def _xml(content: str) -> Response:
    return Response(content=content, media_type="application/xml")


@router.api_route("/vobiz/answer", methods=["GET", "POST"], include_in_schema=False)
async def vobiz_answer(request: Request):
    row, params, token = await _carrier_request(request)
    if row is None:
        return Response(status_code=403)
    return _xml(await bridge_service.on_answer(row, token, params))


@router.api_route("/vobiz/hangup", methods=["GET", "POST"], include_in_schema=False)
async def vobiz_hangup(request: Request):
    row, params, _ = await _carrier_request(request)
    if row is None:
        return Response(status_code=403)
    await bridge_service.on_hangup(row, params)
    return _xml(empty_xml())


@router.api_route("/vobiz/dial-events", methods=["GET", "POST"], include_in_schema=False)
async def vobiz_dial_events(request: Request):
    row, params, _ = await _carrier_request(request)
    if row is None:
        return Response(status_code=403)
    await bridge_service.on_dial_event(row, params)
    return _xml(empty_xml())


@router.api_route("/vobiz/dial-result", methods=["GET", "POST"], include_in_schema=False)
async def vobiz_dial_result(request: Request):
    row, params, _ = await _carrier_request(request)
    if row is None:
        return Response(status_code=403)
    await bridge_service.on_dial_result(row, params)
    return _xml(empty_xml())


@router.api_route("/vobiz/confirm", methods=["GET", "POST"], include_in_schema=False)
async def vobiz_confirm(request: Request):
    """``Dial confirmSound``: the spoken recording disclosure played to the prospect's leg."""
    row, _, _ = await _carrier_request(request)
    if row is None:
        return Response(status_code=403)
    return _xml(await bridge_service.on_confirm(row))


@router.api_route("/vobiz/stream-status", methods=["GET", "POST"], include_in_schema=False)
async def vobiz_stream_status(request: Request):
    row, params, _ = await _carrier_request(request)
    if row is None:
        return Response(status_code=403)
    await bridge_service.on_stream_status(row, params)
    return _xml(empty_xml())


@router.websocket("/vobiz/media")
async def vobiz_media(websocket: WebSocket):
    """Both tracks of the call (``media.track`` inbound = rep, outbound = prospect)."""
    row = await bridge_service.authorize_carrier(websocket.query_params.get("bid", ""),
                                                 websocket.query_params.get("t", ""))
    await websocket.accept()
    if row is None or not bridge_service.attach_media(row, websocket):
        await websocket.close(code=1008)
        return
    await bridge_service.run_media(row, websocket)
