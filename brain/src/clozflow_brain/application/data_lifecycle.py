"""Tenant export, explicit erasure and configured closed-session retention."""
from __future__ import annotations

from sqlalchemy import MetaData, Table, inspect, select

from clozflow_brain.contracts.common import utc_now
from clozflow_brain.infrastructure.data_codec import decode


def export_tenant(kernel, tenant_id):
    sessions = kernel.session_repository.list_for_tenant(tenant_id)
    return {"schema_version": 1, "tenant_id": str(tenant_id), "exported_at": utc_now().isoformat(),
            "sessions": [session.model_dump(mode="json") for session in sessions],
            "world_models": [kernel.world_model_repository.get(session.session_id).model_dump(mode="json") for session in sessions],
            "memories": [memory.model_dump(mode="json") for memory in kernel.memory_service.list_for_tenant(tenant_id)],
            "knowledge": [artifact.model_dump(mode="json") for artifact in kernel.knowledge_service.list_for_tenant(tenant_id)],
            "events": [item for session in sessions for item in kernel.runtime.store.journal(tenant_id, session.session_id)],
            "records": {kind: kernel.runtime.store.list(tenant_id, kind, limit=100000) for kind in
                        ("policy", "feedback", "proposal", "cycle", "audit", "task")}}


def retention_candidates(kernel, tenant_id):
    days = kernel.runtime.policy(tenant_id).retention_days
    sessions = kernel.session_repository.list_for_tenant(tenant_id)
    expired = [session for session in sessions if days and session.status.value == "TERMINATED"
               and (utc_now() - session.updated_at_utc).total_seconds() > days * 86400]
    return {"enabled": days > 0, "retention_days": days,
            "session_ids": [str(session.session_id) for session in expired]}


def _repositories(kernel):
    result = [kernel.session_repository, kernel.world_model_repository]
    for service in (kernel.context_service, kernel.memory_service, kernel.knowledge_service):
        if service:
            result.append(service._repository)
    if kernel.context_service and kernel.context_service._persistence:
        result.append(kernel.context_service._persistence._repository)
    if getattr(kernel, "checkpoint_repository", None):
        result.append(kernel.checkpoint_repository)
    return result


def _erase(kernel, tenant_id, session_ids=None):
    counts = {}
    engines = {str(kernel.runtime.store.engine.url): kernel.runtime.store.engine}
    for repo in _repositories(kernel):
        if hasattr(repo, "_engine"):
            engines[str(repo._engine.url)] = repo._engine
        elif hasattr(repo, "_db_path"):
            from clozflow_brain.infrastructure.sqlalchemy_repositories import create_repository_engine
            url = f"sqlite:///{repo._db_path}"
            engines[url] = create_repository_engine(url)
        else:
            # Volatile adapters are used by offline tests/development only.
            for attribute, values in vars(repo).items():
                if not isinstance(values, dict):
                    continue
                for key, value in list(values.items()):
                    items = value if isinstance(value, list) else [value]
                    keep = [item for item in items if not (
                        getattr(item, "tenant_id", None) == tenant_id and
                        (session_ids is None or any(sid in str(item) for sid in session_ids)))]
                    if len(keep) != len(items):
                        if keep and isinstance(value, list):
                            values[key] = keep
                        else:
                            del values[key]
    allowed = {"brain_sessions", "runtime_world_models", "world_model_checkpoints", "cognitive_contexts",
               "cognitive_memories", "memory_activations", "semantic_knowledge", "cognitive_artifacts",
               "artifact_versions", "artifact_relationships", "runtime_documents", "runtime_events"}
    for engine in engines.values():
        for name in set(inspect(engine).get_table_names()).intersection(allowed):
            table = Table(name, MetaData(), autoload_with=engine)
            if "tenant_id" not in table.c:
                continue
            clause = table.c.tenant_id == str(tenant_id)
            with engine.begin() as conn:
                if session_ids is None:
                    result = conn.execute(table.delete().where(clause))
                    counts[name] = counts.get(name, 0) + result.rowcount
                    continue
                rows = conn.execute(select(table).where(clause)).mappings().all()
                for row in rows:
                    text = " ".join(decode(str(value)) if column.endswith("_json") else str(value)
                                    for column, value in row.items())
                    if not any(sid in text for sid in session_ids):
                        continue
                    key_clause = clause
                    for column in table.primary_key:
                        key_clause &= column == row[column.name]
                    if not list(table.primary_key):
                        continue
                    result = conn.execute(table.delete().where(key_clause))
                    counts[name] = counts.get(name, 0) + result.rowcount
    if hasattr(kernel.event_bus, "purge"):
        kernel.event_bus.purge(tenant_id, session_ids)
    return counts


def erase_tenant(kernel, tenant_id):
    if any(session.status.value != "TERMINATED" for session in kernel.session_repository.list_for_tenant(tenant_id)):
        raise ValueError("End all tenant sessions before erasing their data")
    with kernel.runtime.store._lock:
        return {"tenant_id": str(tenant_id), "deleted": _erase(kernel, tenant_id)}


def run_retention(kernel):
    from clozflow_brain.infrastructure.runtime_store import documents
    with kernel.runtime.store.engine.connect() as conn:
        tenants = conn.execute(select(documents.c.tenant_id).where(documents.c.kind == "policy")).scalars().all()
    from uuid import UUID
    for identifier in tenants:
        tenant = UUID(identifier)
        session_ids = retention_candidates(kernel, tenant)["session_ids"]
        if session_ids:
            with kernel.runtime.store._lock:
                counts = _erase(kernel, tenant, session_ids)
                kernel.runtime.audit(tenant, "retention.executed", {"session_count": len(session_ids), "deleted": counts})
