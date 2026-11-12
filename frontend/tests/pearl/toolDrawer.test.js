import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    authForType,
    describeToolTestResult,
    initialToolConfig,
    isSavedAgentId,
    normalizeVerifierNormalization,
    resolveInitialRunMode,
    serverToolId,
    toolFormFingerprint,
    toolTestPath,
    verifierTestConfig,
    DEFAULT_MOCK_RESPONSE_BODY,
} from '../../src/pages/pearl/lib/toolDrawer.js';

test('unsaved agents test on the agent-less route; saved agents on their own', () => {
    for (const id of [null, undefined, '', 'draft', 'new']) {
        assert.equal(isSavedAgentId(id), false, String(id));
        assert.equal(toolTestPath(id), '/api/pearl/tools/test');
    }
    assert.equal(toolTestPath('a1b2'), '/api/pearl/agents/a1b2/tools/test');
    assert.equal(toolTestPath('a/b'), '/api/pearl/agents/a%2Fb/tools/test');
});

test('draft tool ids are never sent as server tool ids', () => {
    assert.equal(serverToolId('tool_draft_123'), null);
    assert.equal(serverToolId(null), null);
    assert.equal(serverToolId(''), null);
    assert.equal(serverToolId('t-42'), 't-42');
});

test('legacy normalisation values map to the dropdown options', () => {
    assert.equal(normalizeVerifierNormalization('strip_phone_formatting'), 'phone');
    assert.equal(normalizeVerifierNormalization('lowercase'), 'text');
    assert.equal(normalizeVerifierNormalization('PHONE'), 'phone');
    assert.equal(normalizeVerifierNormalization('date'), 'date');
    assert.equal(normalizeVerifierNormalization(undefined), 'none');
    assert.equal(normalizeVerifierNormalization('something_else'), 'none');
});

test('run mode comes from the record, then config, then the name', () => {
    assert.equal(resolveInitialRunMode({ run_mode: 'read' }), 'read');
    assert.equal(resolveInitialRunMode({ config: { run_mode: 'write' }, name: 'get_x' }), 'write');
    assert.equal(resolveInitialRunMode({ is_read_tool: true }), 'read');
    assert.equal(resolveInitialRunMode({ name: 'lookup_order' }), 'read');
    assert.equal(resolveInitialRunMode({ name: 'send_whatsapp' }), 'write');
    assert.equal(resolveInitialRunMode(null), 'write');
});

test('mock tools get the sample body once; other configs are copied unchanged', () => {
    const mock = initialToolConfig({ tool_type: 'mock_api', config: {} });
    assert.equal(mock.mock_response_body, DEFAULT_MOCK_RESPONSE_BODY);
    // An explicitly cleared body stays cleared.
    assert.equal(initialToolConfig({ tool_type: 'mock_api', config: { mock_response_body: '' } }).mock_response_body, '');
    const original = { url: 'https://x', method: 'GET' };
    const copy = initialToolConfig({ tool_type: 'api_tool', config: original });
    assert.deepEqual(copy, original);
    assert.notEqual(copy, original);
    assert.deepEqual(initialToolConfig({ tool_type: 'api_tool', config: 'garbage' }), {});
});

test('verifier test config drops an empty fixed input so the simulator input is used', () => {
    const cfg = { input_source: 'fixed_value', input_value: '   ', match_mode: 'last_n' };
    assert.deepEqual(verifierTestConfig(cfg), { input_source: 'fixed_value', match_mode: 'last_n' });
    const fixed = { input_source: 'fixed_value', input_value: '560001' };
    assert.equal(verifierTestConfig(fixed), fixed);
    const variable = { input_source: 'agent_variable', input_value: '' };
    assert.equal(verifierTestConfig(variable), variable);
});

test('API-key auth starts with the standard header name, which can then be cleared', () => {
    assert.deepEqual(authForType({ type: 'none' }, 'apiKey'), { type: 'apiKey', headerName: 'X-API-Key' });
    assert.deepEqual(authForType({ type: 'apiKey', headerName: '' }, 'apiKey'), { type: 'apiKey', headerName: '' });
    assert.deepEqual(authForType({ type: 'apiKey', headerName: 'X-Key' }, 'bearer'), { type: 'bearer', headerName: 'X-Key' });
});

test('request failures read "Request failed", never "No match" or an invented status', () => {
    const failed = describeToolTestResult({ success: false, request_failed: true, error: 'Your session expired — sign in again.' }, 'data_verifier');
    assert.equal(failed.label, 'Request failed');
    assert.equal(failed.tone, 'error');
    assert.match(failed.error, /session expired/);

    const engineError = describeToolTestResult({ success: false, error: 'boom' }, 'data_verifier');
    assert.equal(engineError.label, 'Request failed');

    assert.equal(describeToolTestResult({ success: true, is_match: true, latency_ms: 12.4 }, 'data_verifier').label, 'Matched • 12 ms');
    assert.equal(describeToolTestResult({ success: true, is_match: false }, 'data_verifier').label, 'No match');
});

test('API results show the real status and latency only when present', () => {
    assert.equal(describeToolTestResult({ success: true, status_code: 201, latency_ms: 88 }, 'api_tool').label, '201 OK • 88 ms');
    assert.equal(describeToolTestResult({ success: true }, 'mock_api').label, 'OK');
    assert.equal(describeToolTestResult({ success: false, status_code: 404, latency_ms: 40 }, 'api_tool').label, 'Failed • 404 • 40 ms');
    assert.equal(describeToolTestResult({ success: false, status_code: 0, latency_ms: 0, error: 'timeout' }, 'api_tool').label, 'Failed');
    assert.equal(describeToolTestResult(null, 'api_tool').label, 'No result');
});

test('form fingerprints are stable and detect edits', () => {
    const a = toolFormFingerprint({ name: 'x', config: { url: 'u' } });
    assert.equal(a, toolFormFingerprint({ name: 'x', config: { url: 'u' } }));
    assert.notEqual(a, toolFormFingerprint({ name: 'x', config: { url: 'v' } }));
    const circular = {};
    circular.self = circular;
    assert.equal(typeof toolFormFingerprint(circular), 'string');
});
