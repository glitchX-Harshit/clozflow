"""Exercise real local main-app authentication and Brain requests with synthetic data."""
from pathlib import Path
from time import perf_counter
from uuid import uuid4
import json
import httpx

ROOT = Path(__file__).resolve().parents[1]
EMAIL = 'brain-local-qa-20261104@example.invalid'
PASSWORD = 'ClozFlow-Test-Only-6472'  # Synthetic local QA account; never a real credential.


def main():
    report = {'checks': [], 'turns': []}
    with httpx.Client(base_url='http://127.0.0.1:8100', timeout=300, trust_env=False) as client:
        auth = client.post('/auth/login', json={'email': EMAIL, 'password': PASSWORD})
        if auth.status_code == 401:
            auth = client.post('/auth/register', json={'email': EMAIL, 'password': PASSWORD})
        auth.raise_for_status()
        client.headers['Authorization'] = 'Bearer ' + auth.json()['access_token']
        assert client.get('/auth/me').json()['email'] == EMAIL
        report['checks'].append('Native local sign-in')
        assert httpx.get('http://127.0.0.1:8100/api/brain/policy', trust_env=False).status_code == 401
        report['checks'].append('Unauthenticated access rejected')
        import jwt
        forged = jwt.encode({'email': EMAIL, 'sub': str(auth.json()['user_id']), 'exp': 9999999999}, 'fake-test-key-that-is-not-the-configured-secret', algorithm='HS256')
        assert client.get('/auth/me', headers={'Authorization': 'Bearer ' + forged}).status_code == 401
        report['checks'].append('Tampered token rejected')
        facts = {'product_name': 'ClozFlow QA CRM', 'product_price': '1000 INR per month',
                 'product_specification': 'Includes contact management and reporting. No discount or free trial is approved. Implementation time is not confirmed.',
                 'call_goal': 'Understand requirements and agree a product demonstration.'}
        imported = client.post('/api/brain/knowledge', json={'title': 'QA CRM export', 'source': 'qa-approved-facts',
            'text': 'ClozFlow QA CRM supports CSV export of contacts. Data can be exported by the workspace administrator.', 'kind': 'PRODUCT'})
        imported.raise_for_status()
        report['checks'].append('Approved knowledge imported')
        for profile, questions in [('compact', ['What is the monthly price?', 'Can we export our contacts?', 'Can you guarantee a 90 percent discount?']),
                                   ('full', ['What does the monthly plan cost and what is included?'])]:
            session = client.post('/api/brain/sessions', json={'call_context': facts, 'reasoning_profile': profile, 'session_id': str(uuid4())})
            session.raise_for_status()
            sid = session.json()['session_id']
            for sequence, question in enumerate(questions, 1):
                started = perf_counter()
                response = client.post(f'/api/brain/sessions/{sid}/transcripts', json={'text': question, 'sequence_num': sequence,
                    'speaker_role': 'BUYER', 'is_final': True, 'event_id': str(uuid4())})
                response.raise_for_status()
                result = response.json()
                item = {'profile': profile, 'question': question, 'seconds': round(perf_counter()-started, 2), **result}
                report['turns'].append(item)
                audit = client.get(f'/api/brain/sessions/{sid}/audit').json()
                item['audit_graph'] = audit['cycles'][0]['graph']
                print(json.dumps({'profile': profile, 'status': result['status'], 'seconds': item['seconds'], 'suggestions': len(result['recommendations'])}), flush=True)
                if result['recommendations']:
                    rec = result['recommendations'][-1]
                    feedback = client.post(f'/api/brain/sessions/{sid}/feedback', json={'recommendation_id': rec['rec_id'], 'helpful': True, 'used': False, 'comment': 'Synthetic integration check; not sales-outcome evidence.'})
                    feedback.raise_for_status()
            ended = client.post(f'/api/brain/sessions/{sid}/close', json={})
            ended.raise_for_status()
            assert client.get(f'/api/brain/sessions/{sid}').json()['status'] == 'TERMINATED'
            worlds = client.get(f'/api/brain/sessions/{sid}/worlds').json()
            assert len(worlds) == 7
            report['checks'].append(profile + ' session closed and seven worlds readable')
            report.setdefault('sessions', []).append(sid)
        report['learning'] = client.get('/api/brain/learning').json()
        export = client.get('/api/brain/export')
        export.raise_for_status()
        assert export.json()['sessions']
        report['checks'].append('Authenticated export')
    (ROOT / 'logs/main-integration-check.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'{len(report["checks"])} integration checks completed; detailed report saved in logs/main-integration-check.json')
    if any(turn['status'] == 'degraded' for turn in report['turns']):
        for turn in report['turns']:
            for engine in turn['audit_graph']:
                if engine['status'] in {'ERROR', 'TIMEOUT'}:
                    print(engine['explanation'])
        raise SystemExit('Provider or reasoning failures recorded; this run is not an all-pass result.')


if __name__ == '__main__':
    main()
