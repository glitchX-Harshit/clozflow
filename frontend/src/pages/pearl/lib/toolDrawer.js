/**
 * Pure helpers for the Pearl tool editor drawer (ToolDrawer.jsx).
 */

/** Agent ids that are not saved agents (the editor passes null before the first save). */
const UNSAVED_AGENT_IDS = new Set(['', 'new', 'draft', 'null', 'undefined']);

export function isSavedAgentId(agentId) {
    if (agentId === null || agentId === undefined) return false;
    return !UNSAVED_AGENT_IDS.has(String(agentId).trim());
}

/** Tool test route: agent-scoped for saved agents, agent-less for unsaved ones. */
export function toolTestPath(agentId) {
    return isSavedAgentId(agentId)
        ? `/api/pearl/agents/${encodeURIComponent(String(agentId))}/tools/test`
        : '/api/pearl/tools/test';
}

/** A tool id the server knows (drafts of unsaved agents are `tool_draft_*`). */
export function serverToolId(id) {
    if (id === null || id === undefined || id === '') return null;
    return String(id).startsWith('tool_draft_') ? null : id;
}

const NORMALIZE_VALUES = ['none', 'phone', 'date', 'text'];
const LEGACY_NORMALIZE = { strip_phone_formatting: 'phone', phone_number: 'phone', lowercase: 'text' };

/**
 * Verifier "Normalize as" value for the dropdown. Legacy template values are
 * mapped to the options the dropdown offers (the backend treats them the same);
 * unknown values fall back to "none", which is also what the backend does.
 */
export function normalizeVerifierNormalization(value) {
    const key = String(value ?? '').trim().toLowerCase();
    if (NORMALIZE_VALUES.includes(key)) return key;
    return LEGACY_NORMALIZE[key] || 'none';
}

const READ_NAME_PREFIXES = ['get_', 'check_', 'fetch_', 'lookup_', 'verify_'];

/** Read (lookup) vs write (action) execution pattern for a tool record. */
export function resolveInitialRunMode(tool) {
    if (!tool) return 'write';
    if (tool.run_mode === 'read' || tool.run_mode === 'write') return tool.run_mode;
    if (tool.is_read_tool === true) return 'read';
    if (tool.is_async_write === true) return 'write';
    const cfg = tool.config || {};
    if (cfg.run_mode === 'read' || cfg.run_mode === 'write') return cfg.run_mode;
    if (cfg.is_read_tool === true) return 'read';
    if (cfg.is_async_write === true) return 'write';
    const n = String(tool.name || '').toLowerCase();
    if (READ_NAME_PREFIXES.some((p) => n.startsWith(p)) || n.includes('pincode') || n.includes('inventory')) {
        return 'read';
    }
    return 'write';
}

export const DEFAULT_MOCK_RESPONSE_BODY = '{\n  "status": "out_for_delivery",\n  "delivery_partner": "BlueDart Express"\n}';

/**
 * Initial editable config for a tool. A mock tool without a body gets the sample
 * body once (so clearing the field later really clears it instead of snapping back).
 */
export function initialToolConfig(tool) {
    const cfg = tool && tool.config && typeof tool.config === 'object' && !Array.isArray(tool.config) ? { ...tool.config } : {};
    if (tool?.tool_type === 'mock_api' && (cfg.mock_response_body === undefined || cfg.mock_response_body === null)) {
        cfg.mock_response_body = DEFAULT_MOCK_RESPONSE_BODY;
    }
    return cfg;
}

/**
 * Verifier test config: with "Fixed value" as the input source and an empty fixed
 * value, the backend would compare an empty string and ignore the simulator's
 * test input — leave `input_value` out so the test input is used.
 */
export function verifierTestConfig(config) {
    if (!config || typeof config !== 'object') return {};
    if (config.input_source === 'fixed_value' && !String(config.input_value ?? '').trim()) {
        const { input_value: _unusedInputValue, ...rest } = config;
        return rest;
    }
    return config;
}

/** Auth object after the auth type changes; API-key auth starts with the standard header name. */
export function authForType(auth, type) {
    const base = auth && typeof auth === 'object' ? auth : {};
    if (type === 'apiKey' && (base.headerName === undefined || base.headerName === null)) {
        return { ...base, type, headerName: 'X-API-Key' };
    }
    return { ...base, type };
}

const latencyText = (result) => {
    const ms = Number(result?.latency_ms);
    return Number.isFinite(ms) && ms > 0 ? ` • ${Math.round(ms)} ms` : '';
};

/**
 * Badge + error text for a tool test result. A request that never reached the
 * tool engine (network / auth / server error) is reported as "Request failed",
 * never as a verifier "No match" or an invented HTTP status.
 *
 * @returns {{ tone: 'success'|'error', label: string, error: string|null }}
 */
export function describeToolTestResult(result, toolType) {
    if (!result || typeof result !== 'object') return { tone: 'error', label: 'No result', error: null };
    const error = typeof result.error === 'string' && result.error.trim() ? result.error.trim() : null;
    if (result.request_failed) return { tone: 'error', label: 'Request failed', error };

    if (toolType === 'data_verifier') {
        if (typeof result.is_match !== 'boolean') {
            return { tone: 'error', label: error ? 'Request failed' : 'No result', error };
        }
        return {
            tone: result.is_match ? 'success' : 'error',
            label: `${result.is_match ? 'Matched' : 'No match'}${latencyText(result)}`,
            error,
        };
    }

    const code = Number(result.status_code);
    const hasCode = Number.isFinite(code) && code > 0;
    if (result.success) {
        return { tone: 'success', label: `${hasCode ? `${code} OK` : 'OK'}${latencyText(result)}`, error };
    }
    return { tone: 'error', label: `Failed${hasCode ? ` • ${code}` : ''}${latencyText(result)}`, error };
}

/** Stable text form of the editable fields, used to detect unsaved edits. */
export function toolFormFingerprint(fields) {
    try {
        return JSON.stringify(fields);
    } catch {
        // Unserialisable values cannot come from the form; never throw during render.
        return '__unserializable__';
    }
}
