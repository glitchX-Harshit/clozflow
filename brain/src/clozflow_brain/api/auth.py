"""Authentication and tenant authorization shared by HTTP and WebSocket routes.

JWT verification follows https://pyjwt.readthedocs.io/en/latest/api.html.
Local mode is restricted to loopback clients and must not be used behind a proxy.
"""
from __future__ import annotations

import os
from collections import OrderedDict
from pathlib import Path
from threading import Lock
from time import monotonic
from uuid import UUID

from fastapi import HTTPException
from starlette.requests import HTTPConnection

from clozflow_brain.kernel.security import Principal


class AccessControl:
    def __init__(self, sessions) -> None:
        self.sessions = sessions
        self.mode = os.getenv("CEB_AUTH_MODE", "local")
        self.key = ""
        self._limits: OrderedDict[tuple[str, str], tuple[float, int]] = OrderedDict()
        self._lock = Lock()
        if self.mode == "jwt":
            self.key = Path(os.environ["CEB_JWT_PUBLIC_KEY_FILE"]).read_text(encoding="utf-8")
            self.issuer = os.environ["CEB_JWT_ISSUER"]
            self.audience = os.environ["CEB_JWT_AUDIENCE"]
        elif self.mode != "local":
            raise ValueError("CEB_AUTH_MODE must be local or jwt")
        if os.getenv("CEB_ENVIRONMENT") == "production" and self.mode != "jwt":
            raise ValueError("Production requires JWT authentication")

    def check_rate(self, connection: HTTPConnection) -> None:
        principal = self.authenticate(connection)
        identity = str(principal.tenant_id) if principal else "local"
        category = "sessions" if connection.url.path == "/v1/sessions" else "events"
        limit = int(os.getenv("CEB_SESSION_STARTS_PER_HOUR", "100")) if category == "sessions" else int(os.getenv("CEB_EVENTS_PER_MINUTE", "10000"))
        window = 3600 if category == "sessions" else 60
        now = monotonic()
        with self._lock:
            key = (identity, category)
            start, count = self._limits.get(key, (now, 0))
            if now - start >= window:
                start, count = now, 0
            if count >= limit:
                raise HTTPException(429, "Tenant request limit exceeded")
            if len(self._limits) >= 10000 and key not in self._limits:
                for expired in [k for k, (t, _) in self._limits.items() if now - t >= 3600]:
                    del self._limits[expired]
                if len(self._limits) >= 10000:
                    raise HTTPException(503, "Rate limit capacity reached")
            self._limits[key] = (start, count + 1)

    def authenticate(self, connection: HTTPConnection) -> Principal | None:
        if self.mode == "local":
            host = connection.client.host if connection.client else ""
            if host not in {"127.0.0.1", "::1", "testclient"}:
                raise HTTPException(403, "Local mode accepts loopback clients only")
            # Prevent cross-origin browser requests to an unauthenticated localhost API.
            origin = connection.headers.get("origin")
            if origin:
                from urllib.parse import urlsplit
                if urlsplit(origin).netloc != connection.headers.get("host"):
                    raise HTTPException(403, "Cross-origin local access denied")
            return None
        import jwt
        authorization = connection.headers.get("authorization", "")
        if not authorization.startswith("Bearer "):
            raise HTTPException(401, "Bearer token required")
        try:
            claims = jwt.decode(
                authorization[7:], self.key, algorithms=["RS256"],
                audience=self.audience, issuer=self.issuer,
                options={"require": ["exp", "iat", "sub", "tenant_id"]},
            )
            if claims["exp"] - claims["iat"] > 3600:
                raise ValueError("Token lifetime exceeds one hour")
            return Principal(UUID(claims["tenant_id"]), claims["sub"],
                             frozenset(str(claims.get("scope", "")).split()))
        except (jwt.PyJWTError, ValueError, TypeError, KeyError) as exc:
            raise HTTPException(401, "Invalid or expired token") from exc

    def authorize(self, connection: HTTPConnection, *, tenant_id: UUID | None = None,
                  session_id: UUID | None = None, scope: str = "brain:read") -> None:
        principal = self.authenticate(connection)
        if session_id is not None:
            try:
                session = self.sessions.get(session_id)
            except KeyError as exc:
                raise HTTPException(404, "Session not found") from exc
            if tenant_id is not None and session.tenant_id != tenant_id:
                raise HTTPException(403, "Tenant mismatch")
            tenant_id = session.tenant_id
        if principal is not None:
            if tenant_id is not None and principal.tenant_id != tenant_id:
                raise HTTPException(403, "Tenant mismatch")
            if scope not in principal.scopes:
                raise HTTPException(403, "Required scope missing")
