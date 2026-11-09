/**
 * Clozflow Agent Tool Blueprints & Configuration Schemas
 * Defines the 5 core tool archetypes matching Tier-1 standard:
 * 1. API Tool (External REST API)
 * 2. Data Validator (Format & Regex checks)
 * 3. Data Verifier (Match spoken against records on file)
 * 4. Mock API (Pre-production simulator with latency & @field extraction)
 * 5. MCP (Model Context Protocol server bindings)
 */

export const TOOL_TEMPLATES = [
  {
    type: 'api_tool',
    name: 'API Tool',
    title: 'API Tool',
    subtitle: 'Call external REST endpoints',
    description: "Call your API to fetch or update data, such as a caller's booking details.",
    badge: 'REST API',
    tags: ['REST API', 'Webhooks', 'CRM Actions'],
    defaultTiming: 'conversation',
    defaultRunMode: 'write', // 'write' (Pattern A: async non-blocking) | 'read' (Pattern B: filler + live lookup)
    defaultConfig: {
      run_mode: 'write',
      is_read_tool: false,
      is_async_write: true,
      method: 'POST',
      url: 'https://api.example.com/v1/orders/lookup',
      params: [{ key: 'format', value: 'json', enabled: true }],
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
      auth: { type: 'bearer', token: '' },
      body: { type: 'json', content: '{\n  "order_id": "{{order_id}}"\n}' },
      response_mapping: [
        { path: 'order.status', variable: 'order_status', description: 'Current shipment status' },
        { path: 'order.eta', variable: 'delivery_eta', description: 'Estimated delivery timeline' }
      ],
      timeout_seconds: 10,
      fallback_response: "I'm having trouble retrieving that order right now. Let's proceed with your other queries."
    }
  },
  {
    type: 'data_validator',
    name: 'Data Validator',
    title: 'Data Validator',
    subtitle: 'Inspect formats with regular expressions',
    description: "Check a value's format and validity, such as an email or phone number.",
    badge: 'Validation',
    tags: ['Indian Phone', 'PIN Code', 'Email'],
    defaultTiming: 'conversation',
    defaultRunMode: 'read',
    defaultConfig: {
      run_mode: 'read',
      is_read_tool: true,
      is_async_write: false,
      data_type: 'string',
      preset: 'indian_phone',
      input_source: 'caller_phone_number',
      regex_pattern: '^(?:\\+91|0)?[6-9]\\d{9}$',
      spoken_on_success: 'Got it, that looks like a valid 10-digit mobile number.',
      spoken_on_fail: "That doesn't seem to be a valid 10-digit number. Could you please repeat it?",
      spoken_on_error: 'I had trouble checking that format, please say it again.',
      include_in_context: true
    }
  },
  {
    type: 'data_verifier',
    name: 'Data Verifier',
    title: 'Data Verifier',
    subtitle: 'Cross-reference caller details against records',
    description: 'Verify caller information against records on file, such as account numbers or last digits of phone.',
    badge: 'Verification',
    tags: ['Customer Record', 'Exact Match', 'Phone Normalizer'],
    defaultTiming: 'conversation',
    defaultRunMode: 'read',
    defaultConfig: {
      run_mode: 'read',
      is_read_tool: true,
      is_async_write: false,
      input_source: 'fixed_value',
      input_value: '',
      input_variable: 'lead.phone',
      normalization: 'strip_phone_formatting',
      normalize_as: 'strip_phone_formatting',
      match_mode: 'exact_match',
      match_n: 4,
      reference_source: 'fixed_value',
      reference_value: '',
      spoken_responses: {
        on_match: 'Thanks — that matches our records on file.',
        on_no_match: "That doesn't match what we have on record. Could you please double-check?",
        on_error: "I'm experiencing an issue checking those details right now. Let's try again in a moment."
      },
      spoken_on_match: 'Thanks — that matches our records on file.',
      spoken_on_mismatch: "That doesn't match what we have on record. Could you please double-check?",
      spoken_on_error: "I'm experiencing an issue checking those details right now. Let's try again in a moment.",
      include_in_context: true
    }
  },
  {
    type: 'mock_api',
    name: 'Mock API',
    title: 'Mock API',
    subtitle: 'Sandbox testing with simulated latency',
    description: 'Test tool calls before your API exists.',
    badge: 'Sandbox',
    tags: ['Simulated Latency', 'Mock JSON', 'Sandbox'],
    defaultTiming: 'conversation',
    defaultRunMode: 'write',
    defaultConfig: {
      run_mode: 'write',
      is_read_tool: false,
      is_async_write: true,
      method: 'POST',
      url: 'https://mock.clozflow.ai/api/v1/orders/status',
      simulated_latency_ms: 180,
      mock_response_body: JSON.stringify({
        order_status: 'Out for delivery',
        delivery_partner: 'BlueDart Express',
        expected_eta: 'Today before 6 PM',
        cod_amount_due: '0'
      }, null, 2),
      response_mapping: [
        { path: 'order_status', variable: 'order_status', description: 'Current shipment status' },
        { path: 'expected_eta', variable: 'delivery_eta', description: 'Estimated delivery timeline' }
      ],
      timeout_seconds: 5,
      fallback_response: 'Mock service is temporarily unavailable.'
    }
  },
  {
    type: 'mcp',
    name: 'MCP Tool',
    title: 'MCP',
    subtitle: 'Model Context Protocol bindings',
    description: 'Bind tools from a connected MCP server.',
    badge: 'Protocol',
    tags: ['MCP Server', 'Protocol Tools', 'Dynamic Actions'],
    defaultTiming: 'conversation',
    defaultRunMode: 'write',
    defaultConfig: {
      run_mode: 'write',
      is_read_tool: false,
      is_async_write: true,
      server_id: '',
      server_tool_name: '',
      parameters: {},
      timeout_seconds: 15,
      fallback_response: 'Unable to communicate with MCP integration service.'
    }
  }
];

export function getToolTemplateByType(type) {
  return TOOL_TEMPLATES.find(t => t.type === type) || null;
}
