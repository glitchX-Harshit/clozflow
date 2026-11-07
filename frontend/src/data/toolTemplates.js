/**
 * Clozflow Agent Tool Blueprints & Configuration Schemas
 * Defines the 5 core tool archetypes:
 * 1. API Tool (External REST API)
 * 2. Data Validator (Format & Regex checks)
 * 3. Data Verifier (Match spoken against records on file)
 * 4. Mock API (Pre-production simulator with latency & @field extraction)
 * 5. MCP (Model Context Protocol server bindings)
 */

export const TOOL_TEMPLATES = [
  {
    type: 'api_tool',
    name: 'REST API Tool',
    title: 'API Tool',
    subtitle: 'Call external REST API (GET/POST/PUT/DELETE)',
    description: 'Execute live HTTP endpoints during or at start/end of call. Parse cURL commands, authenticate, and map @fields into prompt variables.',
    badge: 'REST & Webhook',
    badgeColor: 'blue',
    tags: ['REST API', 'cURL Import', '@field Mapping', 'Live Send'],
    defaultTiming: 'conversation',
    defaultConfig: {
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
    name: 'Format Validator',
    title: 'Data Validator',
    subtitle: 'Format & validity check',
    description: 'Inspect spoken inputs against regular expressions (Indian phone, PAN card, 6-digit Pincode, Email, or custom regex) with tailored spoken replies.',
    badge: 'Regex & Integrity',
    badgeColor: 'emerald',
    tags: ['Indian Phone', 'PAN Card', 'Pincode', 'Context Aware'],
    defaultTiming: 'conversation',
    defaultConfig: {
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
    name: 'Identity Verifier',
    title: 'Data Verifier',
    subtitle: 'Match spoken value against lead data on file',
    description: 'Cross-reference spoken information against lead file records (last 4 digits of phone, DOB, order ID) with phone normalization & match modes.',
    badge: 'Lead Verification',
    badgeColor: 'violet',
    tags: ['Phone Normalizer', 'Exact Match', 'Contains Mode', 'Lead On File'],
    defaultTiming: 'conversation',
    defaultConfig: {
      reference_source: 'lead.phone',
      match_mode: 'exact_match',
      normalization: 'strip_phone_formatting',
      reference_value: '+91 98765 43210',
      spoken_on_match: 'Thank you, that matches our records perfectly.',
      spoken_on_mismatch: "I'm sorry, that does not match what we have on file. Could you please double check?",
      spoken_on_error: 'I am unable to verify that at this moment.',
      include_in_context: true
    }
  },
  {
    type: 'mock_api',
    name: 'Sandbox Mock Tool',
    title: 'Mock API',
    subtitle: 'Test tool calls before real API exists',
    description: 'Simulate external HTTP endpoints, test simulated latency, mock JSON payloads, and calibrate response mapping before the backend goes live.',
    badge: 'Latency & Sandbox',
    badgeColor: 'amber',
    tags: ['Simulated Latency', 'Mock JSON', 'Dry Run', 'Schema Map'],
    defaultTiming: 'conversation',
    defaultConfig: {
      method: 'POST',
      url: 'https://mock.clozflow.ai/api/v1/orders/status',
      simulated_latency_ms: 180,
      mock_response_body: JSON.stringify({
        status: 'out_for_delivery',
        delivery_partner: 'BlueDart Express',
        expected_delivery: 'Today before 6 PM',
        cod_amount_due: 0
      }, null, 2),
      response_mapping: [
        { path: 'status', variable: 'order_status', description: 'Current shipment status' },
        { path: 'expected_delivery', variable: 'expected_eta', description: 'Delivery ETA' }
      ],
      timeout_seconds: 5,
      fallback_response: 'Mock service is temporarily unreachable.'
    }
  },
  {
    type: 'mcp',
    name: 'MCP Integration Tool',
    title: 'MCP',
    subtitle: 'Bind tools dynamically from connected MCP servers',
    description: 'Connect standard Model Context Protocol servers to dynamically expose database queries, CRM lookups, and specialized internal tools to your agent.',
    badge: 'Protocol Standard',
    badgeColor: 'indigo',
    tags: ['Dynamic Schemas', 'External Servers', 'Enterprise Tools'],
    defaultTiming: 'conversation',
    defaultConfig: {
      server_id: '',
      server_name: '',
      server_tool_name: '',
      parameters_schema: {}
    }
  }
];

export function getToolTemplateByType(type) {
  return TOOL_TEMPLATES.find(t => t.type === type) || null;
}
