"""Durable local event journal, decision audit and versioned control records."""
from __future__ import annotations

import json
from threading import RLock
from uuid import uuid4

from sqlalchemy import Column, Integer, MetaData, String, Table, select

from clozflow_brain.contracts.common import utc_now
from clozflow_brain.infrastructure.data_codec import SecureText

metadata = MetaData()
documents = Table("runtime_documents", metadata,
    Column("tenant_id", String(36), primary_key=True),
    Column("kind", String(40), primary_key=True),
    Column("id", String(100), primary_key=True),
    Column("session_id", String(36), index=True),
    Column("version", Integer, nullable=False),
    Column("data_json", SecureText, nullable=False),
    Column("updated_at", String(64), nullable=False))
events = Table("runtime_events", metadata,
    Column("event_id", String(36), primary_key=True),
    Column("tenant_id", String(36), index=True), Column("session_id", String(36), index=True),
    Column("status", String(24), index=True), Column("sequence_num", Integer),
    Column("event_json", SecureText, nullable=False), Column("updated_at", String(64)))


class RuntimeStore:
    def __init__(self, engine):
        self.engine = engine
        self._lock = RLock()
        metadata.create_all(engine)

    def get(self, tenant_id, kind, record_id):
        with self._lock, self.engine.connect() as conn:
            row = conn.execute(select(documents).where(documents.c.tenant_id == str(tenant_id),
                documents.c.kind == kind, documents.c.id == str(record_id))).mappings().first()
        return self._document(row) if row else None

    @staticmethod
    def _document(row):
        return {**json.loads(row["data_json"]), "id": row["id"], "version": row["version"],
                "updated_at": row["updated_at"]}

    def put(self, tenant_id, kind, data, *, record_id=None, session_id=None, expected_version=None):
        record_id = str(record_id or uuid4())
        with self._lock, self.engine.begin() as conn:
            clause = (documents.c.tenant_id == str(tenant_id)) & (documents.c.kind == kind) & (documents.c.id == record_id)
            version = conn.execute(select(documents.c.version).where(clause)).scalar_one_or_none() or 0
            if expected_version is not None and version != expected_version:
                raise ValueError("Record version changed; reload before updating")
            updated = utc_now().isoformat()
            values = dict(tenant_id=str(tenant_id), kind=kind, id=record_id,
                session_id=str(session_id) if session_id else None, version=version + 1,
                data_json=json.dumps(data, default=str), updated_at=updated)
            if version:
                conn.execute(documents.update().where(clause).values(**values))
            else:
                conn.execute(documents.insert().values(**values))
        return {**data, "id": record_id, "version": version + 1, "updated_at": updated}

    def list(self, tenant_id, kind, *, session_id=None, limit=500):
        query = select(documents).where(documents.c.tenant_id == str(tenant_id), documents.c.kind == kind)
        if session_id:
            query = query.where(documents.c.session_id == str(session_id))
        with self._lock, self.engine.connect() as conn:
            rows = conn.execute(query.order_by(documents.c.updated_at.desc()).limit(limit)).mappings().all()
        return [self._document(row) for row in rows]

    def accept(self, batch):
        # A whole batch enters the journal in one transaction before publication.
        with self._lock, self.engine.begin() as conn:
            for event in batch:
                existing = conn.execute(select(events.c.event_json).where(events.c.event_id == str(event.event_id))).scalar_one_or_none()
                raw = event.model_dump_json()
                if existing:
                    original, incoming = json.loads(existing), json.loads(raw)
                    original.pop("timestamp_utc", None)
                    incoming.pop("timestamp_utc", None)
                    if original != incoming:
                        raise ValueError("Event ID was reused with different content")
                    continue
                conn.execute(events.insert().values(event_id=str(event.event_id), tenant_id=str(event.tenant_id),
                    session_id=str(event.session_id), status="pending", sequence_num=event.sequence_num,
                    event_json=raw, updated_at=utc_now().isoformat()))

    def mark(self, event_ids, status):
        with self._lock, self.engine.begin() as conn:
            conn.execute(events.update().where(events.c.event_id.in_([str(x) for x in event_ids])).values(
                status=status, updated_at=utc_now().isoformat()))

    def pending(self):
        with self._lock, self.engine.connect() as conn:
            rows = conn.execute(select(events.c.event_json).where(events.c.status == "pending").order_by(
                events.c.session_id, events.c.sequence_num).limit(1000)).scalars().all()
        from clozflow_brain.contracts.events import CognitiveEvent
        return [CognitiveEvent.model_validate_json(row) for row in rows]

    def journal(self, tenant_id, session_id):
        with self._lock, self.engine.connect() as conn:
            rows = conn.execute(select(events).where(events.c.tenant_id == str(tenant_id),
                events.c.session_id == str(session_id)).order_by(events.c.sequence_num)).mappings().all()
        return [{"status": row["status"], "event": json.loads(row["event_json"])} for row in rows]
