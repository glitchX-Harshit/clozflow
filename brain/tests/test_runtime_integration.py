"""Behavioral regressions for the complete cognitive path and API boundaries."""
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from clozflow_brain.api.main import build_kernel, create_app
from clozflow_brain.contracts.events import CognitiveEvent, EventType
from clozflow_brain.contracts.world_model import WorldModelMutation, WorldModelMutationType




def transcript(session, sequence=1):
    return CognitiveEvent.create(
        event_type=EventType.TRANSCRIPT_SEGMENT, session_id=session.session_id,
        tenant_id=session.tenant_id, sequence_num=sequence, source="test", confidence=1,
        payload={"text": "Our team needs a clear implementation plan before approval.",
                 "speaker_id": "buyer", "speaker_role": "BUYER", "start_ms": 0,
                 "end_ms": 1000, "is_final": True},
    )


def test_complete_cycle_and_reflection(local_env):
    kernel, sessions, ingestion, _, memory, _ = build_kernel()
    try:
        session = sessions.create_session(tenant_id=uuid4(), salesperson_id="rep")
        result = ingestion.ingest(transcript(session))
        assert [o.engine_id for o in result.engine_outputs] == [
            f"{name}.concrete" for name in (
                "perception", "understanding", "interpretation", "prediction", "evaluation",
                "planning", "decision", "verification", "recommendation")]
        assert all(o.status.value == "SUCCESS" for o in result.engine_outputs)
        beliefs = {b.belief_type: b.value for b in result.world_model.crm_beliefs}
        assert beliefs["EVALUATED_STRATEGY"]["scores"]["integrity"] == 8
        assert beliefs["EXECUTABLE_PLAN"]["strategy_id"] == beliefs["EVALUATED_STRATEGY"]["strategy_id"]
        assert beliefs["EXECUTIVE_DECISION"]["selected_plan"]["playbook_name"] == beliefs["EXECUTABLE_PLAN"]["playbook_name"]
        assert beliefs["VERIFICATION_STATUS"]["is_verified"] is True
        assert len(result.world_model.pending_recommendations) == 1
        sessions.terminate_session(tenant_id=session.tenant_id, session_id=session.session_id)
        assert kernel.session_repository.get(session.session_id).status.value == "TERMINATED"
        assert memory.list_for_tenant(session.tenant_id)
        sessions.terminate_session(tenant_id=session.tenant_id, session_id=session.session_id)
    finally:
        kernel.scheduler.close()


def test_event_replay_does_not_repeat_cognition(local_env):
    kernel, sessions, ingestion, *_ = build_kernel()
    try:
        session = sessions.create_session(tenant_id=uuid4(), salesperson_id="rep")
        event = transcript(session)
        first = ingestion.ingest(event)
        second = ingestion.ingest(event)
        assert second.engine_outputs == []
        assert second.world_model.version == first.world_model.version
        assert second.world_model.conversation_state.turn_count == 1
    finally:
        kernel.scheduler.close()


def test_cross_session_mutation_rejected(local_env):
    from clozflow_brain.infrastructure.world_model_mutations import apply_world_model_mutations
    from clozflow_brain.contracts.world_model import WorldModel
    world = WorldModel(session_id=uuid4(), tenant_id=uuid4())
    mutation = WorldModelMutation(mutation_type=WorldModelMutationType.APPEND_CONTEXT,
                                 session_id=uuid4(), tenant_id=world.tenant_id, payload={"text": "x"})
    with pytest.raises(PermissionError):
        apply_world_model_mutations(world, [mutation])
    assert world.context_window == []


def test_durable_world_model_survives_restart(tmp_path):
    from clozflow_brain.infrastructure.sqlalchemy_repositories import (
        SQLAlchemyWorldModelRepository, create_repository_engine,
    )
    from clozflow_brain.contracts.sessions import BrainSession
    url = f"sqlite:///{tmp_path / 'runtime.sqlite'}"
    engine = create_repository_engine(url)
    repo = SQLAlchemyWorldModelRepository(engine)
    session = BrainSession(tenant_id=uuid4(), salesperson_id="rep")
    repo.create(session)
    repo.apply_mutations(session.session_id, [WorldModelMutation(
        mutation_type=WorldModelMutationType.APPEND_CONTEXT, session_id=session.session_id,
        tenant_id=session.tenant_id, payload={"text": "durable transcript"},
    )])
    engine.dispose()
    second_engine = create_repository_engine(url)
    assert SQLAlchemyWorldModelRepository(second_engine).get(session.session_id).context_window == ["durable transcript"]
    second_engine.dispose()


def test_http_and_websocket_delivery(local_env):
    with TestClient(create_app()) as client:
        assert client.get("/health").status_code == 200
        tenant = str(uuid4())
        result = client.post("/v1/sessions", json={"tenant_id": tenant, "salesperson_id": "rep"})
        assert result.status_code == 201
        from clozflow_brain.contracts.sessions import BrainSession
        session = BrainSession.model_validate(result.json())
        event = transcript(session)
        with client.websocket_connect(f"/v1/sessions/{session.session_id}/recommendations/stream") as stream:
            result = client.post(f"/v1/sessions/{session.session_id}/events", json=event.model_dump(mode="json"))
            assert result.status_code == 200
            assert stream.receive_json()["msg_type"] == "RECOMMENDATION"
        assert client.delete(f"/v1/sessions/{session.session_id}", params={"tenant_id": tenant}).status_code == 204


def test_local_api_rejects_cross_origin(local_env):
    with TestClient(create_app()) as client:
        response = client.post("/v1/sessions", headers={"Origin": "https://untrusted.example"},
                               json={"tenant_id": str(uuid4()), "salesperson_id": "rep"})
        assert response.status_code == 403


def test_production_refuses_unauthenticated_mode(local_env, monkeypatch):
    monkeypatch.setenv("CEB_ENVIRONMENT", "production")
    with pytest.raises(ValueError, match="JWT"):
        create_app()


def test_full_application_restart_restores_session_and_memories(local_env, monkeypatch, tmp_path):
    for name in ("SESSION", "WORLD_MODEL", "MEMORY", "CONTEXT", "KNOWLEDGE", "CHECKPOINT"):
        monkeypatch.setenv(f"CEB_{name}_REPOSITORY", "sqlalchemy")
    monkeypatch.setenv("CEB_DATABASE_URL", f"sqlite:///{tmp_path / 'brain.sqlite'}")
    tenant = str(uuid4())
    from clozflow_brain.contracts.sessions import BrainSession
    with TestClient(create_app()) as client:
        session = BrainSession.model_validate(client.post("/v1/sessions", json={
            "tenant_id": tenant, "salesperson_id": "rep"}).json())
        event = transcript(session)
        assert client.post(f"/v1/sessions/{session.session_id}/events", json=event.model_dump(mode="json")).status_code == 200
        assert client.delete(f"/v1/sessions/{session.session_id}", params={"tenant_id": tenant}).status_code == 204
    with TestClient(create_app()) as client:
        restored = client.get(f"/v1/sessions/{session.session_id}", params={"tenant_id": tenant}).json()
        assert restored["status"] == "TERMINATED"
        world = client.get(f"/v1/sessions/{session.session_id}/wm").json()
        assert world["context_window"]
        assert str(event.event_id) in world["processed_event_ids"]
        assert client.get(f"/v1/tenants/{tenant}/memory").json()
        assert client.patch(f"/v1/sessions/{session.session_id}", json={
            "tenant_id": tenant, "status": "ACTIVE"}).status_code == 409


def test_local_rate_limit(local_env, monkeypatch):
    monkeypatch.setenv("CEB_SESSION_STARTS_PER_HOUR", "1")
    with TestClient(create_app()) as client:
        body = {"tenant_id": str(uuid4()), "salesperson_id": "rep"}
        assert client.post("/v1/sessions", json=body).status_code == 201
        assert client.post("/v1/sessions", json=body).status_code == 429
