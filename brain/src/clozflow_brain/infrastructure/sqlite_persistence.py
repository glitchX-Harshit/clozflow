"""SQLite implementation of canonical artifact persistence for local durability."""

from __future__ import annotations

import json
from clozflow_brain.infrastructure.data_codec import encode, decode
import sqlite3
from contextlib import closing
from pathlib import Path
from uuid import UUID

from clozflow_brain.contracts.persistence import (
    ArtifactLifecycleState,
    ArtifactRelationship,
    CognitiveArtifact,
)


class SQLitePersistenceRepository:
    """Durable local CCPA adapter.

    Production deployments should replace this with PostgreSQL plus graph/vector/search
    stores as needed. The contract remains the same.
    """

    def __init__(self, db_path: str | Path) -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with closing(self._connect()) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS cognitive_artifacts (
                    tenant_id TEXT NOT NULL,
                    artifact_id TEXT NOT NULL,
                    artifact_json TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    lifecycle_state TEXT NOT NULL,
                    updated_at_utc TEXT NOT NULL,
                    PRIMARY KEY (tenant_id, artifact_id)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS artifact_versions (
                    tenant_id TEXT NOT NULL,
                    artifact_id TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    artifact_json TEXT NOT NULL,
                    created_at_utc TEXT NOT NULL,
                    PRIMARY KEY (tenant_id, artifact_id, version)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS artifact_relationships (
                    tenant_id TEXT NOT NULL,
                    relationship_id TEXT PRIMARY KEY,
                    relationship_json TEXT NOT NULL,
                    created_at_utc TEXT NOT NULL
                )
                """
            )
            conn.commit()

    def save_artifact(self, artifact: CognitiveArtifact) -> CognitiveArtifact:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT version FROM cognitive_artifacts WHERE tenant_id = ? AND artifact_id = ?",
                (str(artifact.tenant_id), str(artifact.artifact_id)),
            ).fetchone()
            if row is not None:
                artifact = artifact.model_copy(update={"version": int(row["version"]) + 1})
            data = encode(artifact.model_dump_json())
            conn.execute(
                """
                INSERT INTO cognitive_artifacts
                    (tenant_id, artifact_id, artifact_json, version, lifecycle_state, updated_at_utc)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(tenant_id, artifact_id) DO UPDATE SET
                    artifact_json = excluded.artifact_json,
                    version = excluded.version,
                    lifecycle_state = excluded.lifecycle_state,
                    updated_at_utc = excluded.updated_at_utc
                """,
                (
                    str(artifact.tenant_id),
                    str(artifact.artifact_id),
                    data,
                    artifact.version,
                    artifact.lifecycle_state.value,
                    artifact.updated_at_utc.isoformat(),
                ),
            )
            conn.execute(
                """
                INSERT OR REPLACE INTO artifact_versions
                    (tenant_id, artifact_id, version, artifact_json, created_at_utc)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    str(artifact.tenant_id),
                    str(artifact.artifact_id),
                    artifact.version,
                    data,
                    artifact.updated_at_utc.isoformat(),
                ),
            )
            conn.commit()
        return artifact

    def get_artifact(self, tenant_id: UUID, artifact_id: UUID) -> CognitiveArtifact:
        with closing(self._connect()) as conn:
            row = conn.execute(
                "SELECT artifact_json FROM cognitive_artifacts WHERE tenant_id = ? AND artifact_id = ?",
                (str(tenant_id), str(artifact_id)),
            ).fetchone()
            if row is None:
                raise KeyError(f"artifact not found: {artifact_id}")
            return CognitiveArtifact.model_validate(json.loads(decode(row["artifact_json"])))

    def list_artifacts(
        self,
        tenant_id: UUID,
        lifecycle_state: ArtifactLifecycleState | None = None,
    ) -> list[CognitiveArtifact]:
        sql = "SELECT artifact_json FROM cognitive_artifacts WHERE tenant_id = ?"
        params: tuple[str, ...]
        if lifecycle_state is None:
            params = (str(tenant_id),)
        else:
            sql += " AND lifecycle_state = ?"
            params = (str(tenant_id), lifecycle_state.value)
        with closing(self._connect()) as conn:
            rows = conn.execute(sql, params).fetchall()
        return [CognitiveArtifact.model_validate(json.loads(decode(row["artifact_json"]))) for row in rows]

    def save_relationship(self, relationship: ArtifactRelationship) -> ArtifactRelationship:
        with closing(self._connect()) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO artifact_relationships
                    (tenant_id, relationship_id, relationship_json, created_at_utc)
                VALUES (?, ?, ?, ?)
                """,
                (
                    str(relationship.tenant_id),
                    str(relationship.relationship_id),
                    encode(relationship.model_dump_json()),
                    relationship.created_at_utc.isoformat(),
                ),
            )
            conn.commit()
        return relationship
