"""Security primitives for tenant-scoped Brain operations."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True)
class Principal:
    tenant_id: UUID
    subject: str
    scopes: frozenset[str]

    def require_scope(self, scope: str) -> None:
        if scope not in self.scopes:
            raise PermissionError(f"missing scope: {scope}")


def assert_same_tenant(left: UUID, right: UUID) -> None:
    if left != right:
        raise PermissionError("cross-tenant operation rejected")

