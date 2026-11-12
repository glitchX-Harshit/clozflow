"""Vobiz REST calls for the bridge.

Reuses the credentials/base URL handling of ``services/pearl/providers/vobiz_provider.py``
(read-only) but places its own calls: the Pearl helper points the answer/hangup URLs
at Pearl and logs phone numbers, which the bridge must never do.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import httpx

log = logging.getLogger("clozflow.bridge")


@dataclass
class PlaceCallResult:
    ok: bool
    request_uuid: Optional[str] = None
    status_code: Optional[int] = None


@dataclass
class HangupResult:
    ok: bool                 # the leg is gone (hung up now, or already ended)
    already_ended: bool = False
    status_code: Optional[int] = None


class VobizBridgeClient:
    def __init__(self, provider=None, *, transport: Optional[httpx.AsyncBaseTransport] = None):
        if provider is None:
            from services.pearl.providers.vobiz_provider import VobizTelephonyProvider
            provider = VobizTelephonyProvider()
        self._provider = provider
        self._transport = transport

    def _client(self, timeout: float) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=timeout, transport=self._transport, trust_env=False)

    def _call_url(self, suffix: str = "") -> str:
        return f"{self._provider.base_url}/api/v1/Account/{self._provider.auth_id}/Call/{suffix}"

    async def place_call(self, *, to: str, caller_id: str, answer_url: str, hangup_url: str,
                         ring_timeout: int, time_limit: int) -> PlaceCallResult:
        """POST …/Call/ — Vobiz calls ``to`` (the rep) and requests ``answer_url`` on pickup."""
        if not (self._provider.auth_id and self._provider.auth_secret):
            return PlaceCallResult(ok=False)
        payload = {
            "from": caller_id,
            "to": to,
            "answer_url": answer_url,
            "answer_method": "POST",
            "hangup_url": hangup_url,
            "hangup_method": "POST",
            "ring_timeout": int(ring_timeout),
            "time_limit": int(time_limit),
        }
        try:
            async with self._client(12.0) as client:
                response = await client.post(self._call_url(), headers=self._provider._headers(),
                                             auth=(self._provider.auth_id, self._provider.auth_secret),
                                             json=payload)
        except httpx.HTTPError as exc:
            log.warning("Vobiz make-call request failed: %s", type(exc).__name__)
            return PlaceCallResult(ok=False)
        if response.status_code not in (200, 201):
            log.warning("Vobiz make-call rejected: HTTP %s", response.status_code)
            return PlaceCallResult(ok=False, status_code=response.status_code)
        try:
            data = response.json()
        except ValueError:
            data = {}
        request_uuid = None
        if isinstance(data, dict):
            request_uuid = data.get("request_uuid") or data.get("call_uuid")
        if isinstance(request_uuid, list):
            request_uuid = request_uuid[0] if request_uuid else None
        return PlaceCallResult(ok=True, request_uuid=str(request_uuid) if request_uuid else None,
                               status_code=response.status_code)

    async def hangup(self, call_uuid: str) -> HangupResult:
        """DELETE …/Call/{uuid}/ — ends a live call or cancels a queued one.
        404 means the call is already over, which is what we wanted."""
        if not call_uuid or not (self._provider.auth_id and self._provider.auth_secret):
            return HangupResult(ok=False)
        try:
            async with self._client(8.0) as client:
                response = await client.delete(self._call_url(f"{call_uuid}/"), headers=self._provider._headers(),
                                               auth=(self._provider.auth_id, self._provider.auth_secret))
        except httpx.HTTPError as exc:
            log.warning("Vobiz hang-up request failed: %s", type(exc).__name__)
            return HangupResult(ok=False)
        if response.status_code in (200, 202, 204):
            return HangupResult(ok=True, status_code=response.status_code)
        if response.status_code == 404:
            return HangupResult(ok=True, already_ended=True, status_code=404)
        log.warning("Vobiz hang-up rejected: HTTP %s", response.status_code)
        return HangupResult(ok=False, status_code=response.status_code)


def default_client() -> VobizBridgeClient:
    return VobizBridgeClient()
