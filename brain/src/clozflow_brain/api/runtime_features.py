"""Local operations exposed through the same tenant-authorized Brain API."""
from __future__ import annotations

from typing import Literal
from uuid import UUID, uuid5

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from clozflow_brain.application.runtime_service import BrainPolicy
from clozflow_brain.contracts.knowledge import KnowledgeArtifact, KnowledgeKind


class FeedbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    recommendation_id: UUID
    helpful: bool | None = None
    used: bool | None = None
    comment: str = Field(default="", max_length=2000)
    @model_validator(mode="after")
    def measured(self):
        if self.helpful is None and self.used is None:
            raise ValueError("Provide measured helpfulness or whether the recommendation was used")
        return self


class PolicyRequest(BaseModel):
    policy: BrainPolicy
    expected_version: int = Field(ge=0)


class TaskRequest(BaseModel):
    status: Literal["approved", "done", "dismissed"]
    expected_version: int = Field(ge=1)


class KnowledgeImport(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=200000)
    source: str = Field(min_length=1, max_length=500)
    kind: KnowledgeKind = KnowledgeKind.PRODUCT


class BusinessContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    call_context: dict = Field(default_factory=dict)
    crm: dict = Field(default_factory=dict)
    organization: dict = Field(default_factory=dict)


class ProposalRequest(BaseModel):
    policy: BrainPolicy
    reason: str = Field(min_length=1, max_length=2000)


def install_runtime_routes(app, kernel, sessions, memory, knowledge):
    runtime = kernel.runtime

    @app.get("/v1/runtime")
    def runtime_info():
        import os
        return {"mode": "local", "speech": "owned_by_main_app",
                "model": os.getenv("GEMINI_MODEL", ""), "default_engine_config": os.getenv("CEB_ENGINES_CONFIG", "configs/engines.yaml"),
                "encrypted_payloads": bool(os.getenv("CEB_DATA_KEY_FILE")), "profiles": ["compact", "full"]}

    @app.get("/v1/sessions/{session_id}/worlds")
    def worlds(session_id: UUID):
        session = kernel.session_repository.get(session_id)
        return runtime.worlds(session, kernel.world_model_repository.get(session_id))

    @app.get("/v1/tenants/{tenant_id}/sessions")
    def list_sessions(tenant_id: UUID):
        return [session.model_dump(mode="json") for session in sorted(
            kernel.session_repository.list_for_tenant(tenant_id), key=lambda session: session.updated_at_utc, reverse=True)]

    @app.get("/v1/sessions/{session_id}/audit")
    def audit(session_id: UUID):
        session = kernel.session_repository.get(session_id)
        return {"events": runtime.store.journal(session.tenant_id, session_id),
                "cycles": runtime.store.list(session.tenant_id, "cycle", session_id=session_id),
                "actions": runtime.store.list(session.tenant_id, "audit", session_id=session_id)}

    @app.post('/v1/sessions/{session_id}/reflect')
    def retry_reflection(session_id: UUID):
        session = kernel.session_repository.get(session_id)
        try:
            return sessions.retry_reflection(tenant_id=session.tenant_id, session_id=session_id).model_dump(mode='json')
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.post("/v1/sessions/{session_id}/feedback")
    def feedback(session_id: UUID, body: FeedbackRequest):
        session = kernel.session_repository.get(session_id)
        try:
            return runtime.feedback(session, body.recommendation_id, body.model_dump(exclude={"recommendation_id"}, exclude_unset=True), memory)
        except KeyError as exc:
            raise HTTPException(404, "Recommendation does not belong to this session") from exc

    @app.get("/v1/tenants/{tenant_id}/learning")
    def learning(tenant_id: UUID):
        return runtime.learning(tenant_id)

    @app.get("/v1/tenants/{tenant_id}/policy")
    def get_policy(tenant_id: UUID):
        current = runtime.store.get(tenant_id, "policy", "active")
        return current or {"policy": BrainPolicy().model_dump(), "version": 0}

    @app.put("/v1/tenants/{tenant_id}/policy")
    def put_policy(tenant_id: UUID, body: PolicyRequest):
        try:
            return runtime.update_policy(tenant_id, body.policy, body.expected_version)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.post("/v1/tenants/{tenant_id}/learning/proposals", status_code=201)
    def propose(tenant_id: UUID, body: ProposalRequest):
        active = runtime.store.get(tenant_id, "policy", "active")
        return runtime.store.put(tenant_id, "proposal", {"status": "pending", "policy": body.policy.model_dump(),
            "reason": body.reason, "base_version": active["version"] if active else 0,
            "measurements": runtime.learning(tenant_id)})

    @app.get("/v1/tenants/{tenant_id}/learning/proposals")
    def proposals(tenant_id: UUID):
        return runtime.store.list(tenant_id, "proposal")

    @app.post("/v1/tenants/{tenant_id}/learning/proposals/{proposal_id}/approve")
    def approve(tenant_id: UUID, proposal_id: UUID):
        proposal = runtime.store.get(tenant_id, "proposal", str(proposal_id))
        if not proposal:
            raise HTTPException(404, "Proposal not found")
        if proposal["status"] != "pending":
            raise HTTPException(409, "Proposal already reviewed")
        try:
            runtime.update_policy(tenant_id, BrainPolicy.model_validate(proposal["policy"]), proposal["base_version"])
            return runtime.store.put(tenant_id, "proposal", {**proposal, "status": "approved"},
                                     record_id=proposal_id, expected_version=proposal["version"])
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc

    @app.get("/v1/sessions/{session_id}/tasks")
    def tasks(session_id: UUID):
        session = kernel.session_repository.get(session_id)
        return runtime.store.list(session.tenant_id, "task", session_id=session_id)

    @app.post("/v1/tenants/{tenant_id}/learning/proposals/{proposal_id}/reject")
    def reject(tenant_id: UUID, proposal_id: UUID):
        proposal = runtime.store.get(tenant_id, "proposal", str(proposal_id))
        if not proposal:
            raise HTTPException(404, "Proposal not found")
        if proposal["status"] != "pending":
            raise HTTPException(409, "Proposal already reviewed")
        return runtime.store.put(tenant_id, "proposal", {**proposal, "status": "rejected"},
                                 record_id=proposal_id, expected_version=proposal["version"])

    @app.patch("/v1/sessions/{session_id}/tasks/{task_id}")
    def update_task(session_id: UUID, task_id: UUID, body: TaskRequest):
        session = kernel.session_repository.get(session_id)
        records = {item["id"]: item for item in runtime.store.list(session.tenant_id, "task", session_id=session_id)}
        task = records.get(str(task_id))
        if not task:
            raise HTTPException(404, "Task not found")
        allowed = {"proposed": {"approved", "dismissed"}, "approved": {"done", "dismissed"}}
        if body.status not in allowed.get(task["status"], set()):
            raise HTTPException(409, "Invalid task transition")
        try:
            updated = runtime.store.put(session.tenant_id, "task", {**task, "status": body.status},
                record_id=task_id, session_id=session_id, expected_version=body.expected_version)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        runtime.audit(session.tenant_id, "task.updated", {"task_id": str(task_id), "status": body.status}, session_id=session_id)
        return updated

    @app.patch("/v1/sessions/{session_id}/business-context")
    def business_context(session_id: UUID, body: BusinessContext):
        session = kernel.session_repository.get(session_id)
        if session.status.value != "ACTIVE":
            raise HTTPException(409, "Session must be active")
        metadata = dict(session.metadata)
        for key, values in body.model_dump(exclude_unset=True).items():
            metadata[key] = {**metadata.get(key, {}), **values}
        updated = sessions.update_session(tenant_id=session.tenant_id, session_id=session_id, metadata=metadata)
        runtime.audit(session.tenant_id, "business_context.updated", {"fields": list(body.model_fields_set)}, session_id=session_id)
        return updated.model_dump(mode="json")

    @app.post("/v1/tenants/{tenant_id}/knowledge/import", status_code=201)
    def import_knowledge(tenant_id: UUID, body: KnowledgeImport):
        text = body.text.strip()
        if not text:
            raise HTTPException(422, "Knowledge text is blank")
        chunks = [text[offset:offset + 1800] for offset in range(0, len(text), 1600)]
        from clozflow_brain.contracts.persistence import ArtifactLifecycleState
        for existing in knowledge.list_for_tenant(tenant_id):
            if existing.metadata.get("source") == body.source and existing.metadata.get("chunk_index", 0) >= len(chunks):
                knowledge.store(existing.model_copy(update={"lifecycle_state": ArtifactLifecycleState.RETIRED}))
        saved = []
        for index, chunk in enumerate(chunks):
            artifact = KnowledgeArtifact(knowledge_id=uuid5(tenant_id, f"{body.source}:{index}"),
                tenant_id=tenant_id, kind=body.kind, title=f"{body.title} ({index + 1})", body=chunk,
                concepts=body.title.lower().split(), provenance=body.source, confidence=1,
                metadata={"source": body.source, "chunk_index": index, "imported_by": "user"})
            saved.append(knowledge.store(artifact).model_dump(mode="json"))
        runtime.audit(tenant_id, "knowledge.imported", {"source": body.source, "chunks": len(chunks)})
        return {"artifacts": saved}

    @app.get("/v1/tenants/{tenant_id}/export")
    def export(tenant_id: UUID):
        from clozflow_brain.application.data_lifecycle import export_tenant
        return export_tenant(kernel, tenant_id)

    @app.get("/v1/tenants/{tenant_id}/retention/preview")
    def retention_preview(tenant_id: UUID):
        from clozflow_brain.application.data_lifecycle import retention_candidates
        return retention_candidates(kernel, tenant_id)

    @app.delete("/v1/tenants/{tenant_id}/data")
    def erase(tenant_id: UUID, request: Request, confirm_tenant_id: UUID):
        app.state.access.authorize(request, tenant_id=tenant_id, scope="brain:admin")
        if confirm_tenant_id != tenant_id:
            raise HTTPException(400, "Confirmation must match the tenant being erased")
        from clozflow_brain.application.data_lifecycle import erase_tenant
        try:
            return erase_tenant(kernel, tenant_id)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
