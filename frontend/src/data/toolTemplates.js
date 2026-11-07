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
    subtitle: 'Connect live web services and databases',
    description: 'Fetch real-time data or trigger external actions during conversations. Easily map API response fields to conversational variables.',
    badge: 'REST API',
    badgeColor: 'slate',
    tags: ['Live Endpoints', 'Variables'],
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
    subtitle: 'Verify customer phone, email, or PIN code format',
    description: 'Ensure spoken inputs conform to expected standards such as Indian 10-digit mobile numbers, postal PIN codes, or email addresses.',
    badge: 'Validation',
    badgeColor: 'slate',
    tags: ['Indian Phone', 'PIN Code', 'Email'],
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
    subtitle: 'Confirm caller details against record on file',
    description: 'Match customer responses against lead records (e.g. phone number, date of birth, order ID) with automatic normalization.',
    badge: 'Verification',
    badgeColor: 'slate',
    tags: ['Customer Record', 'Exact Match'],
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
    subtitle: 'Test tool workflows with simulated data',
    description: 'Simulate API responses and latency with visual test fields before integrating your live production systems.',
    badge: 'Sandbox',
    badgeColor: 'slate',
    tags: ['Simulated Latency', 'Test Data'],
    defaultTiming: 'conversation',
    defaultConfig: {
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
        { path: 'expected_eta', variable: 'expected_eta', description: 'Delivery ETA' }
      ],
      timeout_seconds: 5,
      fallback_response: 'Mock service is temporarily unreachable.'
    }
  },
  {
    type: 'mcp',
    name: 'MCP Integration',
    title: 'MCP Server',
    subtitle: 'Connect dynamic Model Context Protocol servers',
    description: 'Expose internal databases, CRM tools, and enterprise capabilities via standard Model Context Protocol servers.',
    badge: 'Integration',
    badgeColor: 'slate',
    tags: ['External Server', 'Dynamic Actions'],
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
