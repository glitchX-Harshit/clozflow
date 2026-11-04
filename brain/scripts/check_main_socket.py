"""Verify real main-app WebSocket auth, transcript handoff and reconnect."""
from pathlib import Path
import json
from uuid import uuid4
import httpx
import websocket

ROOT = Path(__file__).resolve().parents[1]


def receive_analysis(socket):
    for _ in range(10):
        message = json.loads(socket.recv())
        if message.get('type') == 'aiAnalysis':
            return message['payload']
    raise AssertionError('No analysis frame')


def main():
    with httpx.Client(base_url='http://127.0.0.1:8100', trust_env=False, timeout=180) as client:
        credentials = {'email': 'brain-local-qa-20261104@example.invalid', 'password': 'ClozFlow-Test-Only-6472'}
        auth = client.post('/auth/login', json=credentials)
        auth.raise_for_status()
        token = auth.json()['access_token']
        client.headers['Authorization'] = 'Bearer ' + token
        context = client.post('/call/start', json={'client_name': 'Synthetic buyer', 'client_industry': 'QA', 'client_role': 'Tester',
            'product_name': 'ClozFlow QA CRM', 'product_price': '1000 INR per month',
            'product_specification': 'Contact management and reporting. No discounts are approved.', 'call_goal': 'Clarify needs'})
        context.raise_for_status()
        cid = context.json()['context_id']
        url = 'ws://127.0.0.1:8100/ws?context_id=' + cid
        try:
            websocket.create_connection(url, timeout=5, suppress_origin=True).close()
            raise AssertionError('Unauthenticated socket was accepted')
        except websocket.WebSocketBadStatusException as error:
            assert error.status_code == 403
        second = client.post('/auth/register', json={'email': f'qa-isolation-{uuid4()}@example.invalid', 'password': 'ClozFlow-Test-Only-6472'}).json()
        other_headers = {'Authorization': 'Bearer ' + second['access_token']}
        assert client.get('/call/context/' + cid, headers=other_headers).status_code == 404
        try:
            websocket.create_connection(url, header=other_headers, timeout=5, suppress_origin=True).close()
            raise AssertionError('Another user accessed the call context')
        except websocket.WebSocketBadStatusException as error:
            assert error.status_code == 403
        socket = websocket.create_connection(url, subprotocols=['clozflow', 'clozflow-auth.' + token], timeout=180, origin='http://127.0.0.1:5273')
        assert socket.getsubprotocol() == 'clozflow'
        socket.send(json.dumps({'type': 'transcriptUpdate', 'text': 'The product includes reporting.', 'speaker': 'salesperson', 'is_final': True}))
        first = receive_analysis(socket)
        assert first['brain_status'] == 'recorded'
        socket.close()
        socket = websocket.create_connection(url, header={'Authorization': 'Bearer ' + token}, timeout=180, suppress_origin=True)
        socket.send(json.dumps({'type': 'transcriptUpdate', 'text': 'What is the monthly price?', 'speaker': 'buyer', 'is_final': True}))
        second = receive_analysis(socket)
        assert first['brain_session_id'] == second['brain_session_id']
        sid = second['brain_session_id']
        world = client.get(f'/api/brain/sessions/{sid}/wm').json()
        assert world['conversation_state']['turn_count'] == 2
        socket.send(json.dumps({'type': 'end_session'}))
        ended = json.loads(socket.recv())
        assert ended['type'] == 'session_ended'
        socket.close()
        session = client.get(f'/api/brain/sessions/{sid}').json()
        assert session['status'] == 'TERMINATED'
        report = {'checks': ['unauthenticated socket rejected', 'cross-user context rejected', 'cross-user socket rejected',
            'salesperson transcript recorded', 'same session after reconnect', 'two turns retained', 'explicit session closure'],
            'context_id': cid, 'session_id': sid, 'buyer_result': second, 'reflection_status': session['metadata'].get('reflection_status')}
        (ROOT / 'logs/main-socket-check.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps({'checks_passed': len(report['checks']), 'buyer_status': second['brain_status'], 'reflection': report['reflection_status']}))


if __name__ == '__main__':
    main()
