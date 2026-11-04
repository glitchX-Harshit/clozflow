from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from cryptography.fernet import InvalidToken
from fastapi.testclient import TestClient
from sqlalchemy import text

from clozflow_brain.api.main import create_app
from clozflow_brain.application.runtime_service import BrainPolicy
from clozflow_brain.contracts.common import utc_now
from clozflow_brain.infrastructure.data_codec import decode, encode, _cipher
from clozflow_brain.infrastructure.runtime_store import RuntimeStore
from clozflow_brain.infrastructure.sqlalchemy_repositories import create_repository_engine
from test_runtime_integration import transcript


def start(client, tenant=None, **metadata):
    tenant = tenant or str(uuid4())
    response = client.post('/v1/sessions', json={'tenant_id': tenant, 'salesperson_id': 'rep', 'metadata': metadata})
    assert response.status_code == 201, response.text
    return tenant, response.json()['session_id']


def test_payload_encryption_survives_restart_and_rejects_tampering(monkeypatch, tmp_path):
    monkeypatch.setenv('CEB_DATA_KEY_FILE', str(tmp_path / 'key'))
    url = f'sqlite:///{tmp_path / "encrypted.sqlite"}'
    engine = create_repository_engine(url)
    tenant = uuid4()
    store = RuntimeStore(engine)
    store.put(tenant, 'test', {'transcript': 'private conversation'}, record_id='one')
    with engine.connect() as conn:
        raw = conn.execute(text('select data_json from runtime_documents')).scalar_one()
    assert 'private conversation' not in raw and raw.startswith('cfenc1:')
    _cipher.cache_clear()
    assert RuntimeStore(create_repository_engine(url)).get(tenant, 'test', 'one')['transcript'] == 'private conversation'
    with pytest.raises(InvalidToken):
        decode(raw[:-5] + 'AAAAA')
    assert decode('legacy plaintext') == 'legacy plaintext'
    assert decode(encode('हिन्दी')) == 'हिन्दी'


def test_policy_feedback_worlds_and_tasks(local_env):
    app = create_app()
    with TestClient(app) as client:
        tenant, sid = start(client)
        result = client.post(f'/v1/sessions/{sid}/transcripts', json={'text': 'Can we discuss implementation?', 'sequence_num': 1}).json()
        rec = result['recommendations'][0]['rec_id']
        path = f'/v1/sessions/{sid}/feedback'
        assert client.post(path, json={'recommendation_id': rec, 'helpful': True}).status_code == 200
        saved = client.post(path, json={'recommendation_id': rec, 'used': True}).json()
        assert saved['helpful'] is True and saved['used'] is True
        measured = client.get(f'/v1/tenants/{tenant}/learning').json()
        assert measured['helpfulness_rate'] == 1 and measured['adherence_rate'] == 1
        assert measured['model_weights_trained'] is False
        _, other = start(client, tenant)
        assert client.post(f'/v1/sessions/{other}/feedback', json={'recommendation_id': rec, 'helpful': True}).status_code == 404
        assert len(client.get(f'/v1/sessions/{sid}/worlds').json()) == 7
        policy = BrainPolicy(forbidden_phrases=['test_string']).model_dump()
        path = f'/v1/tenants/{tenant}/policy'
        assert client.put(path, json={'policy': policy, 'expected_version': 0}).status_code == 200
        assert client.put(path, json={'policy': policy, 'expected_version': 0}).status_code == 409
        withheld = client.post(f'/v1/sessions/{sid}/transcripts', json={'text': 'Explain the plan.', 'sequence_num': 2}).json()
        assert withheld['recommendations'] == [] and withheld['status'] == 'withheld'
        client.delete(f'/v1/sessions/{sid}', params={'tenant_id': tenant})
        tasks = client.get(f'/v1/sessions/{sid}/tasks').json()
        assert tasks
        task = tasks[0]
        path = f'/v1/sessions/{sid}/tasks/{task["id"]}'
        assert client.patch(path, json={'status': 'done', 'expected_version': task['version']}).status_code == 409
        task = client.patch(path, json={'status': 'approved', 'expected_version': task['version']}).json()
        assert client.patch(path, json={'status': 'done', 'expected_version': task['version']}).status_code == 200


def test_knowledge_reimport_retires_old_chunks_and_proposals_need_review(local_env):
    app = create_app()
    with TestClient(app) as client:
        tenant, _ = start(client)
        path = f'/v1/tenants/{tenant}/knowledge/import'
        body = {'title': 'Terms', 'text': 'Legacy pricing ' * 400, 'source': 'approved-terms'}
        assert client.post(path, json=body).status_code == 201
        body['text'] = 'Current pricing is 1000 INR.'
        assert client.post(path, json=body).status_code == 201
        records = app.state.kernel.knowledge_service.list_for_tenant(UUID(tenant))
        assert len([r for r in records if r.lifecycle_state.value != 'RETIRED']) == 1
        path = f'/v1/tenants/{tenant}/learning/proposals'
        proposal = client.post(path, json={'policy': BrainPolicy(min_confidence=.85).model_dump(), 'reason': 'Measured review'}).json()
        assert client.get(f'/v1/tenants/{tenant}/policy').json()['policy']['min_confidence'] == .7
        assert client.post(f'{path}/{proposal["id"]}/approve').status_code == 200
        assert client.post(f'{path}/{proposal["id"]}/approve').status_code == 409
        assert client.get(f'/v1/tenants/{tenant}/policy').json()['policy']['min_confidence'] == .85


def test_journal_recovery_and_reused_event_identity(local_env):
    app = create_app()
    with TestClient(app) as client:
        tenant, sid = start(client)
        kernel = app.state.kernel
        session = kernel.session_repository.get(UUID(sid))
        event = transcript(session)
        kernel.runtime.store.accept([event])
        kernel.recover_pending()
        assert kernel.world_model_repository.get(UUID(sid)).conversation_state.turn_count == 1
        kernel.runtime.store.mark([event.event_id], 'pending')
        kernel.recover_pending()
        assert kernel.world_model_repository.get(UUID(sid)).conversation_state.turn_count == 1
        assert not kernel.runtime.store.pending()
        with pytest.raises(ValueError, match='different content'):
            kernel.runtime.store.accept([event.model_copy(update={'payload': {**event.payload, 'text': 'Changed'}})])
        assert all(e['status'] == 'complete' for e in client.get(f'/v1/sessions/{sid}/audit').json()['events'])


def test_reflection_failure_is_visible_and_retry_is_idempotent(local_env, monkeypatch):
    app = create_app()
    from clozflow_brain.engines.reflection import ReflectionEngine
    from clozflow_brain.contracts.engines import EngineExecutionOutput, EngineStatus
    original = ReflectionEngine.execute
    def failed(self, request):
        return EngineExecutionOutput(engine_id=self.registration.engine_id, cycle_id=request.cycle_id,
            status=EngineStatus.ERROR, confidence=0, duration_ms=0, reasoning_trace='Synthetic provider failure')
    with TestClient(app) as client:
        tenant, sid = start(client)
        client.post(f'/v1/sessions/{sid}/transcripts', json={'text': 'We need reporting.', 'sequence_num': 1})
        monkeypatch.setattr(ReflectionEngine, 'execute', failed)
        client.delete(f'/v1/sessions/{sid}', params={'tenant_id': tenant})
        assert client.get(f'/v1/sessions/{sid}', params={'tenant_id': tenant}).json()['metadata']['reflection_status'] == 'failed'
        monkeypatch.setattr(ReflectionEngine, 'execute', original)
        assert client.post(f'/v1/sessions/{sid}/reflect').json()['metadata']['reflection_status'] == 'complete'
        before = len(app.state.kernel.runtime.store.journal(UUID(tenant), UUID(sid)))
        assert client.post(f'/v1/sessions/{sid}/reflect').status_code == 200
        assert len(app.state.kernel.runtime.store.journal(UUID(tenant), UUID(sid))) == before


def test_concurrent_session_resume_preserves_single_world(local_env):
    from concurrent.futures import ThreadPoolExecutor
    from clozflow_brain.api.main import build_kernel
    kernel, sessions, *_ = build_kernel()
    sid, tenant = uuid4(), uuid4()
    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: sessions.create_session(tenant_id=tenant, session_id=sid, salesperson_id='rep'), range(8)))
        assert all(result.session_id == sid for result in results)
        assert len(kernel.runtime.store.journal(tenant, sid)) == 1
    finally:
        kernel.close()


def test_durable_encrypted_export_retention_and_tenant_erasure(local_env, monkeypatch, tmp_path):
    for name in ('SESSION', 'WORLD_MODEL', 'MEMORY', 'CONTEXT', 'KNOWLEDGE', 'PERSISTENCE', 'CHECKPOINT'):
        monkeypatch.setenv(f'CEB_{name}_REPOSITORY', 'sqlalchemy')
    monkeypatch.setenv('CEB_STORAGE_PROFILE', 'durable')
    monkeypatch.setenv('CEB_DATABASE_URL', f'sqlite:///{tmp_path / "runtime.sqlite"}')
    monkeypatch.setenv('CEB_DATA_KEY_FILE', str(tmp_path / 'key'))
    app = create_app()
    with TestClient(app) as client:
        tenant, sid = start(client)
        other, other_sid = start(client)
        path = f'/v1/tenants/{tenant}/data'
        assert client.delete(path, params={'confirm_tenant_id': tenant}).status_code == 409
        client.delete(f'/v1/sessions/{sid}', params={'tenant_id': tenant})
        session = app.state.kernel.session_repository.get(UUID(sid))
        app.state.kernel.session_repository.save(session.model_copy(update={'updated_at_utc': utc_now() - timedelta(days=5)}))
        app.state.kernel.runtime.update_policy(UUID(tenant), BrainPolicy(retention_days=1), 0)
        preview = client.get(f'/v1/tenants/{tenant}/retention/preview').json()
        assert preview['session_ids'] == [sid]
        exported = client.get(f'/v1/tenants/{tenant}/export').json()
        assert len(exported['sessions']) == 1
        from clozflow_brain.application.data_lifecycle import run_retention
        run_retention(app.state.kernel)
        assert client.get(f'/v1/tenants/{tenant}/export').json()['sessions'] == []
        assert client.get(f'/v1/sessions/{other_sid}', params={'tenant_id': other}).status_code == 200
        assert client.delete(path, params={'confirm_tenant_id': tenant}).status_code == 200
