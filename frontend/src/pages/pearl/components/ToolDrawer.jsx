import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, Globe, ShieldCheck, Database, Sliders, Cpu, 
  Play, Plus, Trash2, CheckCircle2, AlertCircle, Clock, 
  Code2, ExternalLink, RefreshCw, Send, Sparkles, Check,
  ChevronDown, ChevronUp, Copy, HelpCircle
} from 'lucide-react';
import './ToolsStudio.css';

export const ToolDrawer = ({
  isOpen,
  onClose,
  tool,
  agentId,
  onSaveTool,
  onDeleteTool,
  testVariables = {}
}) => {
  if (!isOpen || !tool) return null;

  // Active form state
  const [name, setName] = useState(tool.name || '');
  const [toolType, setToolType] = useState(tool.tool_type || 'api_tool');
  const [description, setDescription] = useState(tool.description || '');
  const [runTiming, setRunTiming] = useState(tool.run_timing || 'conversation');
  const [isActive, setIsActive] = useState(tool.is_active !== false);
  const [fallbackResponse, setFallbackResponse] = useState(tool.fallback_response || tool.config?.fallback_response || '');
  const [timeoutSeconds, setTimeoutSeconds] = useState(tool.timeout_seconds || tool.config?.timeout_seconds || 10);
  const [config, setConfig] = useState(tool.config || {});

  // API Tool Subtabs
  const [apiSubtab, setApiSubtab] = useState('path'); // 'path' | 'headers' | 'auth' | 'body' | 'mapping' | 'timing'

  // Visual Mock Response fields state (user-oriented key-value rows)
  const parseMockBodyToFields = (rawBody) => {
    try {
      if (rawBody) {
        const parsed = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const entries = Object.entries(parsed);
          if (entries.length > 0) {
            return entries.map(([k, v], idx) => ({
              id: String(idx + 1),
              key: k,
              value: typeof v === 'object' ? JSON.stringify(v) : String(v)
            }));
          }
        }
      }
    } catch (e) {
      // not valid json object
    }
    return [
      { id: '1', key: 'order_status', value: 'Out for delivery' },
      { id: '2', key: 'delivery_partner', value: 'BlueDart Express' },
      { id: '3', key: 'expected_eta', value: 'Today before 6 PM' }
    ];
  };

  const [mockFields, setMockFields] = useState(() => parseMockBodyToFields(tool?.config?.mock_response_body));
  const [showAdvancedMock, setShowAdvancedMock] = useState(false);
  const [showRawJsonMock, setShowRawJsonMock] = useState(false);
  const [showAdvancedValidator, setShowAdvancedValidator] = useState(false);
  const [showAdvancedVerifier, setShowAdvancedVerifier] = useState(false);
  const [showAdvancedApi, setShowAdvancedApi] = useState(false);
  const [showRawTestOutput, setShowRawTestOutput] = useState(false);

  // cURL parser drawer/popover state
  const [showCurlModal, setShowCurlModal] = useState(false);
  const [curlInput, setCurlInput] = useState('');
  const [curlParsing, setCurlParsing] = useState(false);
  const [curlError, setCurlError] = useState(null);

  // Live Test State
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testInputs, setTestInputs] = useState(() => ({
    lead_name: 'Siddharth Roy',
    order_id: 'ORD-8821',
    test_value: '9876543210',
    spoken_value: '+91 98765-43210',
    reference_value: '+91 98765 43210',
    ...testVariables
  }));

  // Keyboard shortcut listener for Esc
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showCurlModal) {
          setShowCurlModal(false);
        } else if (isOpen) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showCurlModal, onClose]);

  // Keep state synced when tool prop updates
  useEffect(() => {
    if (tool) {
      setName(tool.name || '');
      setToolType(tool.tool_type || 'api_tool');
      setDescription(tool.description || '');
      setRunTiming(tool.run_timing || 'conversation');
      setIsActive(tool.is_active !== false);
      const toolTimeout = tool.timeout_seconds || tool.config?.timeout_seconds || 10;
      setTimeoutSeconds(toolTimeout);
      const toolFallback = tool.fallback_response || tool.config?.fallback_response || '';
      setFallbackResponse(toolFallback);
      setConfig(tool.config ? { ...tool.config, timeout_seconds: toolTimeout, fallback_response: toolFallback } : { timeout_seconds: toolTimeout, fallback_response: toolFallback });
      setMockFields(parseMockBodyToFields(tool.config?.mock_response_body));
      setTestResult(null);
    }
  }, [tool]);

  // Handle configuration updates
  const updateConfig = (key, val) => {
    setConfig(prev => ({ ...prev, [key]: val }));
  };

  // Synchronize mock fields array to mock_response_body JSON
  const updateMockFields = (newFields) => {
    setMockFields(newFields);
    const obj = {};
    newFields.forEach(f => {
      const k = (f.key || '').trim();
      if (k) {
        const val = f.value !== undefined ? f.value : '';
        const trimmed = String(val).trim();
        if (trimmed === 'true') obj[k] = true;
        else if (trimmed === 'false') obj[k] = false;
        else if (!isNaN(Number(trimmed)) && trimmed !== '') obj[k] = Number(trimmed);
        else obj[k] = val;
      }
    });
    updateConfig('mock_response_body', JSON.stringify(obj, null, 2));
  };

  // ──────────────────────────────────────────────────────────────────────────
  // cURL PARSER HANDLER
  // ──────────────────────────────────────────────────────────────────────────
  const handleParseCurl = async () => {
    if (!curlInput.trim()) return;
    setCurlParsing(true);
    setCurlError(null);

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/pearl/tools/parse-curl`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ curl_command: curlInput })
      });

      if (!res.ok) {
        throw new Error('Failed to parse cURL command');
      }

      const parsed = await res.json();
      setConfig(prev => ({
        ...prev,
        method: parsed.method || 'GET',
        url: parsed.url || prev.url || '',
        headers: parsed.headers && parsed.headers.length > 0 ? parsed.headers : prev.headers,
        params: parsed.params && parsed.params.length > 0 ? parsed.params : prev.params,
        auth: parsed.auth || prev.auth,
        body: {
          type: parsed.body_type || 'json',
          content: parsed.body || ''
        }
      }));

      setShowCurlModal(false);
      setCurlInput('');
    } catch (err) {
      console.error('Curl parse error:', err);
      setCurlError(err.message || 'Invalid cURL command syntax');
    } finally {
      setCurlParsing(false);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // LIVE TEST HANDLER (POST /api/pearl/agents/{agent_id}/tools/test)
  // ──────────────────────────────────────────────────────────────────────────
  const handleRunLiveTest = async () => {
    setIsTesting(true);
    setTestResult(null);

    const finalTimeout = parseInt(timeoutSeconds) || 10;
    const finalFallback = (fallbackResponse || '').trim();
    const mergedConfig = {
      ...config,
      timeout_seconds: finalTimeout,
      fallback_response: finalFallback
    };

    const payload = {
      tool_id: tool.id || null,
      tool_type: toolType,
      config: mergedConfig,
      test_input: testInputs,
      timeout_seconds: finalTimeout
    };

    try {
      const token = localStorage.getItem('token');
      const targetAgentId = agentId || 'test_sandbox';
      const res = await fetch(`${window.APP_API_BASE || ''}/api/pearl/agents/${targetAgentId}/tools/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        setTestResult(data);
        return;
      }
      throw new Error(`Server returned ${res.status}`);
    } catch (err) {
      // Provide intelligent fallback testing for client-side tools if backend is unreachable
      if (toolType === 'mock_api') {
        let parsedMock = {};
        try {
          parsedMock = JSON.parse(config.mock_response_body || '{}');
        } catch (e) {
          mockFields.forEach(f => {
            if (f.key && f.key.trim()) parsedMock[f.key.trim()] = f.value;
          });
        }
        const extracted = {};
        (config.response_mapping || []).forEach(m => {
          if (m.variable && parsedMock[m.path] !== undefined) {
            extracted[m.variable] = parsedMock[m.path];
          }
        });
        setTestResult({
          success: true,
          status_code: 200,
          latency_ms: config.simulated_latency_ms || 180,
          response_data: parsedMock,
          extracted_variables: extracted,
          spoken_feedback: Object.keys(extracted).length > 0 
            ? `Successfully retrieved: ${Object.entries(extracted).map(([k, v]) => `${k} = ${v}`).join(', ')}`
            : 'Mock response executed successfully.'
        });
      } else if (toolType === 'data_validator') {
        const testVal = String(testInputs.test_value || '').trim();
        const pattern = config.regex_pattern || '^(?:\\+91|0)?[6-9]\\d{9}$';
        let isValid = false;
        try {
          const reg = new RegExp(pattern);
          isValid = reg.test(testVal);
        } catch (e) {
          isValid = false;
        }
        setTestResult({
          success: true,
          status_code: 200,
          latency_ms: 12,
          is_valid: isValid,
          reason: isValid ? 'Matched validation pattern' : 'Does not match pattern format',
          spoken_feedback: isValid 
            ? (config.spoken_on_success || 'Got it, that looks valid.')
            : (config.spoken_on_fail || "That doesn't seem to be a valid format. Could you please repeat it?")
        });
      } else if (toolType === 'data_verifier') {
        const spoken = String(testInputs.spoken_value || '').trim();
        const ref = String(testInputs.reference_value || config.reference_value || '').trim();
        const norm = config.normalization || 'strip_phone_formatting';
        const clean = (str) => {
          if (norm === 'strip_phone_formatting') return str.replace(/[\s\-\(\)\+]|^(?:91|0)/g, '');
          if (norm === 'lowercase') return str.toLowerCase().trim();
          return str;
        };
        const normSpoken = clean(spoken);
        const normRef = clean(ref);
        const matchMode = config.match_mode || 'exact_match';
        const isMatch = matchMode === 'contains' 
          ? (normRef.includes(normSpoken) || normSpoken.includes(normRef))
          : (normSpoken === normRef);
        setTestResult({
          success: true,
          status_code: 200,
          latency_ms: 15,
          is_match: isMatch,
          normalized_spoken: normSpoken,
          normalized_reference: normRef,
          spoken_feedback: isMatch
            ? (config.spoken_on_match || 'Thank you, that matches our records perfectly.')
            : (config.spoken_on_mismatch || "I'm sorry, that does not match what we have on file.")
        });
      } else {
        setTestResult({
          success: false,
          error: `Test execution: ${err.message || 'Endpoint unreachable'}`
        });
      }
    } finally {
      setIsTesting(false);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // SUBMIT SAVE
  // ──────────────────────────────────────────────────────────────────────────
  const handleSave = () => {
    if (!name.trim()) {
      alert('Please enter a tool name');
      return;
    }

    const finalTimeout = parseInt(timeoutSeconds) || 10;
    const finalFallback = (fallbackResponse || '').trim();
    const finalConfig = {
      ...config,
      timeout_seconds: finalTimeout,
      fallback_response: finalFallback
    };

    const payload = {
      id: tool.id,
      name: name.trim(),
      tool_type: toolType,
      description: description.trim(),
      run_timing: runTiming,
      timeout_seconds: finalTimeout,
      fallback_response: finalFallback,
      config: finalConfig,
      is_active: isActive
    };

    onSaveTool(payload);
  };

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER: API TOOL CONFIGURATION
  // ──────────────────────────────────────────────────────────────────────────
  const renderApiToolForm = () => {
    const method = config.method || 'POST';
    const url = config.url || '';
    const params = config.params || [];
    const headers = config.headers || [];
    const auth = config.auth || { type: 'none' };
    const bodyObj = config.body || { type: 'json', content: '' };
    const mapping = config.response_mapping || [];
    const timeoutSeconds = config.timeout_seconds || 10;

    return (
      <div className="drawer-tool-section">
        {/* Endpoint Row */}
        <div className="form-group-field">
          <label>API Endpoint Web Address</label>
          <div className="endpoint-config-row">
            <div className="method-select-wrap">
              <select 
                className={`method-dropdown method-${method.toLowerCase()}`}
                value={method}
                onChange={(e) => updateConfig('method', e.target.value)}
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
                <option value="PATCH">PATCH</option>
              </select>
            </div>
            <div className="url-input-wrap">
              <input 
                type="text" 
                className="drawer-input endpoint-url-field"
                placeholder="https://api.mycorp.com/v1/orders/{{order_id}}"
                value={url}
                onChange={(e) => updateConfig('url', e.target.value)}
              />
            </div>
          </div>
          <div className="field-hint-text">
            Use <code>{`{{variable}}`}</code> syntax to dynamically interpolate conversational parameters into the URL.
          </div>
        </div>

        {/* Save Output to Conversation Variables (Primary Business View) */}
        <div className="form-group-field" style={{ marginTop: 18 }}>
          <div className="panel-table-header">
            <div>
              <span style={{ fontWeight: 600 }}>Save Output to Conversation Variables</span>
              <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                Values returned from this endpoint will be stored into agent memory for use in prompt turns.
              </p>
            </div>
            <button 
              type="button" 
              className="btn-text-action"
              onClick={() => {
                const updated = [...mapping, { path: '', variable: '', description: '' }];
                updateConfig('response_mapping', updated);
              }}
            >
              <Plus size={13} /> Add Variable
            </button>
          </div>

          {mapping.length === 0 ? (
            <div className="panel-empty-text">
              No variables mapped yet. Click "+ Add Variable" to store API response fields into agent memory.
            </div>
          ) : (
            <div className="visual-field-rows">
              {mapping.map((m, idx) => (
                <div key={idx} className="visual-field-row">
                  <div className="visual-row-cell key-cell">
                    <label className="visual-input-label">Response Field</label>
                    <input 
                      type="text" 
                      placeholder="e.g. order.status"
                      className="drawer-input code-font"
                      value={m.path || ''}
                      onChange={(e) => {
                        const copy = [...mapping];
                        copy[idx] = { ...copy[idx], path: e.target.value };
                        updateConfig('response_mapping', copy);
                      }}
                    />
                  </div>
                  <div className="visual-row-cell val-cell">
                    <label className="visual-input-label">Agent Variable</label>
                    <input 
                      type="text" 
                      placeholder="e.g. order_status"
                      className="drawer-input code-font"
                      value={m.variable || ''}
                      onChange={(e) => {
                        const copy = [...mapping];
                        copy[idx] = { ...copy[idx], variable: e.target.value };
                        updateConfig('response_mapping', copy);
                      }}
                    />
                  </div>
                  <div className="visual-row-cell val-cell" style={{ flex: 1.2 }}>
                    <label className="visual-input-label">Description</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Current shipment status"
                      className="drawer-input"
                      value={m.description || ''}
                      onChange={(e) => {
                        const copy = [...mapping];
                        copy[idx] = { ...copy[idx], description: e.target.value };
                        updateConfig('response_mapping', copy);
                      }}
                    />
                  </div>
                  <button 
                    type="button" 
                    className="btn-row-delete"
                    title="Remove variable mapping"
                    onClick={() => {
                      const copy = mapping.filter((_, i) => i !== idx);
                      updateConfig('response_mapping', copy);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Fallback Spoken Line */}
        <div className="form-group-field" style={{ marginTop: 18 }}>
          <label>Fallback spoken line if tool fails or times out</label>
          <textarea 
            rows={2}
            className="drawer-textarea"
            placeholder="I'm having trouble retrieving that record right now. Let's proceed with your other queries."
            value={fallbackResponse}
            onChange={(e) => setFallbackResponse(e.target.value)}
          />
        </div>

        {/* Advanced Developer Settings Accordion */}
        <div className="advanced-accordion-wrap">
          <button 
            type="button" 
            className="advanced-accordion-toggle"
            onClick={() => setShowAdvancedApi(prev => !prev)}
          >
            <span>Advanced Developer Settings (cURL, Payload Body, Headers, Auth, Timeout)</span>
            {showAdvancedApi ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {showAdvancedApi && (
            <div className="advanced-accordion-content">
              {/* cURL Import Action Card */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#0f172a' }}>Import from cURL Command</div>
                  <div style={{ fontSize: '0.74rem', color: '#64748b' }}>Paste a cURL snippet to auto-populate endpoint, headers, auth, and request body</div>
                </div>
                <button 
                  type="button" 
                  className="btn-text-action"
                  style={{ fontSize: '0.76rem', background: '#ffffff', border: '1px solid #e2e8f0', padding: '5px 12px', borderRadius: 6 }}
                  onClick={() => setShowCurlModal(true)}
                  title="Import parameters and headers from a cURL command"
                >
                  <Code2 size={13} /> Import cURL
                </button>
              </div>

              {/* API Subtabs */}
              <div className="api-subtabs-bar">
                <button 
                  type="button" 
                  className={`api-subtab-btn ${apiSubtab === 'path' ? 'active' : ''}`}
                  onClick={() => setApiSubtab('path')}
                >
                  Parameters ({params.length})
                </button>
                <button 
                  type="button" 
                  className={`api-subtab-btn ${apiSubtab === 'body' ? 'active' : ''}`}
                  onClick={() => setApiSubtab('body')}
                >
                  Payload (Body)
                </button>
                <button 
                  type="button" 
                  className={`api-subtab-btn ${apiSubtab === 'headers' ? 'active' : ''}`}
                  onClick={() => setApiSubtab('headers')}
                >
                  Headers ({headers.length})
                </button>
                <button 
                  type="button" 
                  className={`api-subtab-btn ${apiSubtab === 'auth' ? 'active' : ''}`}
                  onClick={() => setApiSubtab('auth')}
                >
                  Authentication {auth.type !== 'none' && '•'}
                </button>
                <button 
                  type="button" 
                  className={`api-subtab-btn ${apiSubtab === 'timing' ? 'active' : ''}`}
                  onClick={() => setApiSubtab('timing')}
                >
                  Timing & Timeout
                </button>
              </div>

        {/* Subtab 1: Params */}
        {apiSubtab === 'path' && (
          <div className="subtab-panel">
            <div className="panel-table-header">
              <span>Query Parameters</span>
              <button 
                type="button" 
                className="btn-text-action"
                onClick={() => {
                  const updated = [...params, { key: '', value: '', enabled: true }];
                  updateConfig('params', updated);
                }}
              >
                <Plus size={13} /> Add Parameter
              </button>
            </div>
            {params.length === 0 ? (
              <div className="panel-empty-text">No query parameters configured. Click "+ Add Parameter" above.</div>
            ) : (
              <div className="key-value-rows">
                {params.map((p, idx) => (
                  <div key={idx} className="key-value-row">
                    <input 
                      type="checkbox" 
                      checked={p.enabled !== false}
                      onChange={(e) => {
                        const copy = [...params];
                        copy[idx] = { ...copy[idx], enabled: e.target.checked };
                        updateConfig('params', copy);
                      }}
                    />
                    <input 
                      type="text" 
                      placeholder="Key (e.g. status)"
                      className="drawer-input row-input-key"
                      value={p.key || ''}
                      onChange={(e) => {
                        const copy = [...params];
                        copy[idx] = { ...copy[idx], key: e.target.value };
                        updateConfig('params', copy);
                      }}
                    />
                    <input 
                      type="text" 
                      placeholder="Value (e.g. {{lead_id}})"
                      className="drawer-input row-input-val"
                      value={p.value || ''}
                      onChange={(e) => {
                        const copy = [...params];
                        copy[idx] = { ...copy[idx], value: e.target.value };
                        updateConfig('params', copy);
                      }}
                    />
                    <button 
                      type="button" 
                      className="btn-row-delete"
                      onClick={() => {
                        const copy = params.filter((_, i) => i !== idx);
                        updateConfig('params', copy);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Subtab 2: Headers */}
        {apiSubtab === 'headers' && (
          <div className="subtab-panel">
            <div className="panel-table-header">
              <span>Request Headers</span>
              <button 
                type="button" 
                className="btn-text-action"
                onClick={() => {
                  const updated = [...headers, { key: '', value: '', enabled: true }];
                  updateConfig('headers', updated);
                }}
              >
                <Plus size={13} /> Add Header
              </button>
            </div>
            {headers.length === 0 ? (
              <div className="panel-empty-text">No custom headers configured.</div>
            ) : (
              <div className="key-value-rows">
                {headers.map((h, idx) => (
                  <div key={idx} className="key-value-row">
                    <input 
                      type="checkbox" 
                      checked={h.enabled !== false}
                      onChange={(e) => {
                        const copy = [...headers];
                        copy[idx] = { ...copy[idx], enabled: e.target.checked };
                        updateConfig('headers', copy);
                      }}
                    />
                    <input 
                      type="text" 
                      placeholder="Header Name"
                      className="drawer-input row-input-key"
                      value={h.key || ''}
                      onChange={(e) => {
                        const copy = [...headers];
                        copy[idx] = { ...copy[idx], key: e.target.value };
                        updateConfig('headers', copy);
                      }}
                    />
                    <input 
                      type="text" 
                      placeholder="Header Value"
                      className="drawer-input row-input-val"
                      value={h.value || ''}
                      onChange={(e) => {
                        const copy = [...headers];
                        copy[idx] = { ...copy[idx], value: e.target.value };
                        updateConfig('headers', copy);
                      }}
                    />
                    <button 
                      type="button" 
                      className="btn-row-delete"
                      onClick={() => {
                        const copy = headers.filter((_, i) => i !== idx);
                        updateConfig('headers', copy);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Subtab 3: Authentication */}
        {apiSubtab === 'auth' && (
          <div className="subtab-panel">
            <div className="form-group-field">
              <label>Authentication Type</label>
              <select 
                className="drawer-select"
                value={auth.type || 'none'}
                onChange={(e) => updateConfig('auth', { ...auth, type: e.target.value })}
              >
                <option value="none">No Authentication</option>
                <option value="bearer">Bearer Token</option>
                <option value="apiKey">API Key (Header)</option>
                <option value="basic">Basic Auth (Username / Password)</option>
              </select>
            </div>

            {auth.type === 'bearer' && (
              <div className="form-group-field" style={{ marginTop: 12 }}>
                <label>Bearer Token</label>
                <input 
                  type="password" 
                  placeholder="e.g. eyJhbGciOi..."
                  className="drawer-input"
                  value={auth.token || ''}
                  onChange={(e) => updateConfig('auth', { ...auth, token: e.target.value })}
                />
              </div>
            )}

            {auth.type === 'apiKey' && (
              <div className="auth-split-fields" style={{ marginTop: 12 }}>
                <div className="form-group-field">
                  <label>Header Name</label>
                  <input 
                    type="text" 
                    placeholder="X-API-Key"
                    className="drawer-input"
                    value={auth.headerName || 'X-API-Key'}
                    onChange={(e) => updateConfig('auth', { ...auth, headerName: e.target.value })}
                  />
                </div>
                <div className="form-group-field">
                  <label>API Key Value</label>
                  <input 
                    type="password" 
                    placeholder="sk_live_..."
                    className="drawer-input"
                    value={auth.apiKey || ''}
                    onChange={(e) => updateConfig('auth', { ...auth, apiKey: e.target.value })}
                  />
                </div>
              </div>
            )}

            {auth.type === 'basic' && (
              <div className="auth-split-fields" style={{ marginTop: 12 }}>
                <div className="form-group-field">
                  <label>Username</label>
                  <input 
                    type="text" 
                    placeholder="admin"
                    className="drawer-input"
                    value={auth.username || ''}
                    onChange={(e) => updateConfig('auth', { ...auth, username: e.target.value })}
                  />
                </div>
                <div className="form-group-field">
                  <label>Password</label>
                  <input 
                    type="password" 
                    placeholder="••••••••"
                    className="drawer-input"
                    value={auth.password || ''}
                    onChange={(e) => updateConfig('auth', { ...auth, password: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Subtab 4: Body */}
        {apiSubtab === 'body' && (
          <div className="subtab-panel">
            <div className="form-group-field">
              <label>Body Type</label>
              <div className="pill-radio-group">
                {['json', 'raw', 'form_data'].map((bType) => (
                  <button 
                    key={bType}
                    type="button" 
                    className={`pill-radio-btn ${(bodyObj.type || 'json') === bType ? 'active' : ''}`}
                    onClick={() => updateConfig('body', { ...bodyObj, type: bType })}
                  >
                    {bType === 'json' ? 'JSON' : bType === 'raw' ? 'Raw Text' : 'Form Data'}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group-field" style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ margin: 0 }}>Payload Content</label>
                <span className="code-hint">Supports {`{{variables}}`}</span>
              </div>
              <textarea 
                rows={7}
                className="drawer-textarea code-font"
                placeholder={'{\n  "lead_id": "{{lead_id}}",\n  "query": "balance"\n}'}
                value={bodyObj.content || ''}
                onChange={(e) => updateConfig('body', { ...bodyObj, content: e.target.value })}
              />
            </div>
          </div>
        )}

        {/* Subtab 5: Timing & Timeout */}
        {apiSubtab === 'timing' && (
          <div className="subtab-panel">
            <div className="form-group-field">
              <label>When should this tool execute?</label>
              <div className="timing-radios-vertical">
                {[
                  { id: 'call_start', label: 'When the call starts', sub: 'Runs silently before speaking greeting' },
                  { id: 'conversation', label: 'During the conversation', sub: 'Triggered adaptively based on caller intent' },
                  { id: 'call_end', label: 'When the call ends', sub: 'Runs after hangup to log outcomes to CRM' }
                ].map((t) => (
                  <label key={t.id} className={`timing-card-option ${runTiming === t.id ? 'active' : ''}`}>
                    <input 
                      type="radio" 
                      name="apiRunTiming"
                      checked={runTiming === t.id}
                      onChange={() => setRunTiming(t.id)}
                    />
                    <div className="timing-text-wrap">
                      <div className="timing-label">{t.label}</div>
                      <div className="timing-sub">{t.sub}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group-field" style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ margin: 0 }}>Max Wait Timeout (Seconds)</label>
                <span className="slider-val-tag">{timeoutSeconds}s</span>
              </div>
              <input 
                type="range" 
                min={2} 
                max={30} 
                step={1}
                className="drawer-slider"
                value={timeoutSeconds}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  setTimeoutSeconds(val);
                  updateConfig('timeout_seconds', val);
                }}
              />
              <span className="field-hint-text">If the endpoint does not reply within this timeout, the fallback line will be spoken.</span>
            </div>
          </div>
        )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER: DATA VALIDATOR CONFIGURATION (User-Oriented Presets)
  // ──────────────────────────────────────────────────────────────────────────
  const renderDataValidatorForm = () => {
    const dataType = config.data_type || 'string';
    const preset = config.preset || 'indian_phone';
    const customRegex = config.regex_pattern || '';
    const inputSource = config.input_source || 'caller_phone_number';
    const includeInContext = config.include_in_context !== false;

    const PRESETS = [
      {
        id: 'indian_phone',
        label: 'Indian Mobile Number',
        rule: 'Validates 10-digit Indian phone numbers (starting with 6-9). Automatically normalizes +91 prefixes, spaces, and dashes.',
        pattern: '^(?:\\+91|0)?[6-9]\\d{9}$',
        example: '+91 98765 43210'
      },
      {
        id: 'email',
        label: 'Email Address',
        rule: 'Validates standard email format with username, @ symbol, and domain extension.',
        pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
        example: 'alex@example.com'
      },
      {
        id: 'pincode',
        label: '6-digit PIN Code',
        rule: 'Validates standard 6-digit Indian postal code format (e.g. 560001, 110001).',
        pattern: '^[1-9][0-9]{5}$',
        example: '560001'
      },
      {
        id: 'pan_card',
        label: 'PAN Card Number',
        rule: 'Validates 10-character Indian Income Tax PAN card format (5 letters, 4 numbers, 1 letter).',
        pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$',
        example: 'ABCDE1234F'
      },
      {
        id: 'aadhaar_last4',
        label: 'Aadhaar Last 4',
        rule: 'Validates exactly 4 numeric digits for customer identity confirmation.',
        pattern: '^[0-9]{4}$',
        example: '4321'
      },
      {
        id: 'custom',
        label: 'Custom Regex Rule',
        rule: 'Define custom regular expression rules for domain-specific codes.',
        pattern: customRegex,
        example: 'Custom regex pattern'
      }
    ];

    const currentPresetObj = PRESETS.find(p => p.id === preset) || PRESETS[0];

    const handleSelectPreset = (pId) => {
      updateConfig('preset', pId);
      const matched = PRESETS.find(p => p.id === pId);
      if (matched && pId !== 'custom') {
        updateConfig('regex_pattern', matched.pattern);
      }
    };

    return (
      <div className="drawer-tool-section">
        {/* Preset Selection Grid */}
        <div className="form-group-field">
          <label>Choose Validation Standard</label>
          <div className="preset-chips-grid">
            {PRESETS.map(pr => (
              <button 
                key={pr.id}
                type="button" 
                className={`preset-chip-btn ${preset === pr.id ? 'active' : ''}`}
                onClick={() => handleSelectPreset(pr.id)}
              >
                {pr.label}
              </button>
            ))}
          </div>
        </div>

        {/* User-friendly Format Rule Card (No Raw Regex in User's Face!) */}
        {preset !== 'custom' ? (
          <div className="format-guarantee-card">
            <div className="format-card-header">
              <ShieldCheck size={16} color="#0f172a" />
              <span className="format-card-title">{currentPresetObj.label} Format</span>
            </div>
            <p className="format-card-desc">{currentPresetObj.rule}</p>
            <div className="format-card-meta">
              <span className="format-sample-label">Accepted format:</span>
              <span className="format-sample-pill">{currentPresetObj.example}</span>
            </div>
          </div>
        ) : (
          <div className="form-group-field" style={{ marginTop: 14 }}>
            <label>Custom Regular Expression</label>
            <input 
              type="text" 
              className="drawer-input code-font"
              placeholder="^[0-9]{10}$"
              value={customRegex}
              onChange={(e) => updateConfig('regex_pattern', e.target.value)}
            />
            <span className="field-hint-text">Tests incoming spoken turn against this regex syntax in real-time.</span>
          </div>
        )}

        {/* Spoken Voice Responses */}
        <div className="form-group-field" style={{ marginTop: 16 }}>
          <label>Spoken message when format is valid</label>
          <input 
            type="text" 
            className="drawer-input"
            placeholder="Got it, that looks valid."
            value={config.spoken_on_success || ''}
            onChange={(e) => updateConfig('spoken_on_success', e.target.value)}
          />
        </div>

        <div className="form-group-field" style={{ marginTop: 12 }}>
          <label>Spoken message when format is invalid (retry prompt)</label>
          <input 
            type="text" 
            className="drawer-input"
            placeholder="That doesn't seem like a valid number, could you please repeat it?"
            value={config.spoken_on_fail || ''}
            onChange={(e) => updateConfig('spoken_on_fail', e.target.value)}
          />
        </div>

        <div className="form-group-field" style={{ marginTop: 12 }}>
          <label>Spoken message on system error</label>
          <input 
            type="text" 
            className="drawer-input"
            placeholder="I had trouble verifying that format."
            value={config.spoken_on_error || ''}
            onChange={(e) => updateConfig('spoken_on_error', e.target.value)}
          />
        </div>

        {/* Advanced Accordion Toggle */}
        <div className="advanced-accordion-wrap">
          <button 
            type="button" 
            className="advanced-accordion-toggle"
            onClick={() => setShowAdvancedValidator(prev => !prev)}
          >
            <span>Advanced Pattern & Variable Settings</span>
            {showAdvancedValidator ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {showAdvancedValidator && (
            <div className="advanced-accordion-content">
              <div className="two-col-grid">
                <div className="form-group-field">
                  <label>Data Type</label>
                  <select 
                    className="drawer-select"
                    value={dataType}
                    onChange={(e) => updateConfig('data_type', e.target.value)}
                  >
                    <option value="string">String</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                    <option value="time">Time</option>
                    <option value="datetime">Date & time</option>
                  </select>
                </div>

                <div className="form-group-field">
                  <label>Input Source Variable</label>
                  <input 
                    type="text" 
                    className="drawer-input"
                    placeholder="caller_phone_number"
                    value={inputSource}
                    onChange={(e) => updateConfig('input_source', e.target.value)}
                  />
                </div>
              </div>

              {preset !== 'custom' && (
                <div className="form-group-field" style={{ marginTop: 12 }}>
                  <label>Underlying Regular Expression Pattern</label>
                  <input 
                    type="text" 
                    className="drawer-input code-font"
                    value={config.regex_pattern || currentPresetObj.pattern}
                    onChange={(e) => updateConfig('regex_pattern', e.target.value)}
                  />
                </div>
              )}

              <div className="toggle-setting-row" style={{ marginTop: 14 }}>
                <div className="toggle-setting-info">
                  <div className="toggle-setting-label">Include outcome in prompt context</div>
                  <div className="toggle-setting-sub">Provide validation pass/fail status to the agent model</div>
                </div>
                <label className="toggle-switch">
                  <input 
                    type="checkbox" 
                    checked={includeInContext}
                    onChange={(e) => updateConfig('include_in_context', e.target.checked)}
                  />
                  <span className="slider"></span>
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER: DATA VERIFIER CONFIGURATION
  // ──────────────────────────────────────────────────────────────────────────
  const renderDataVerifierForm = () => {
    const referenceSource = config.reference_source || 'lead.phone';
    const matchMode = config.match_mode || 'exact_match';
    const normalization = config.normalization || 'strip_phone_formatting';
    const referenceValue = config.reference_value || '';
    const includeInContext = config.include_in_context !== false;

    return (
      <div className="drawer-tool-section">
        <div className="two-col-grid">
          <div className="form-group-field">
            <label>Customer Record to Verify</label>
            <select 
              className="drawer-select"
              value={referenceSource}
              onChange={(e) => updateConfig('reference_source', e.target.value)}
            >
              <option value="lead.phone">Lead Phone (lead.phone)</option>
              <option value="lead.order_id">Order ID (lead.order_id)</option>
              <option value="lead.dob">Date of Birth (lead.dob)</option>
              <option value="lead.last4">Last 4 digits (lead.last4)</option>
              <option value="custom">Custom Variable</option>
            </select>
          </div>

          <div className="form-group-field">
            <label>Comparison Rule</label>
            <select 
              className="drawer-select"
              value={matchMode}
              onChange={(e) => updateConfig('match_mode', e.target.value)}
            >
              <option value="exact_match">Exact match (100% equivalence)</option>
              <option value="contains">Contains match (e.g. last 4 digits)</option>
            </select>
          </div>
        </div>

        <div className="form-group-field" style={{ marginTop: 14 }}>
          <label>Sample Record on File (for preview & testing)</label>
          <input 
            type="text" 
            className="drawer-input"
            placeholder="+91 98765 43210 or ORD-8821"
            value={referenceValue}
            onChange={(e) => updateConfig('reference_value', e.target.value)}
          />
        </div>

        <div className="form-group-field" style={{ marginTop: 16 }}>
          <label>Spoken feedback when verified</label>
          <input 
            type="text" 
            className="drawer-input"
            placeholder="Thank you, that matches our records perfectly."
            value={config.spoken_on_match || ''}
            onChange={(e) => updateConfig('spoken_on_match', e.target.value)}
          />
        </div>

        <div className="form-group-field" style={{ marginTop: 12 }}>
          <label>Spoken feedback on mismatch</label>
          <input 
            type="text" 
            className="drawer-input"
            placeholder="I'm sorry, that does not match what we have on file. Could you please double check?"
            value={config.spoken_on_mismatch || ''}
            onChange={(e) => updateConfig('spoken_on_mismatch', e.target.value)}
          />
        </div>

        <div className="form-group-field" style={{ marginTop: 12 }}>
          <label>Spoken feedback on error</label>
          <input 
            type="text" 
            className="drawer-input"
            placeholder="I had trouble verifying that information right now."
            value={config.spoken_on_error || ''}
            onChange={(e) => updateConfig('spoken_on_error', e.target.value)}
          />
        </div>

        {/* Advanced Accordion Toggle */}
        <div className="advanced-accordion-wrap">
          <button 
            type="button" 
            className="advanced-accordion-toggle"
            onClick={() => setShowAdvancedVerifier(prev => !prev)}
          >
            <span>Advanced Match & Normalization Settings</span>
            {showAdvancedVerifier ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {showAdvancedVerifier && (
            <div className="advanced-accordion-content">
              <div className="form-group-field">
                <label>Normalization Strategy</label>
                <div className="timing-radios-vertical">
                  {[
                    { id: 'strip_phone_formatting', label: 'Strip phone formatting', sub: 'Removes +91, leading 0, spaces, dashes & parentheses' },
                    { id: 'lowercase', label: 'Lowercase & trim whitespace', sub: 'Case-insensitive comparison for names, codes, emails' },
                    { id: 'none', label: 'None (Exact character literal)', sub: 'Case-sensitive exact byte comparison' }
                  ].map(norm => (
                    <label key={norm.id} className={`timing-card-option ${normalization === norm.id ? 'active' : ''}`}>
                      <input 
                        type="radio" 
                        name="normalizationOption"
                        checked={normalization === norm.id}
                        onChange={() => updateConfig('normalization', norm.id)}
                      />
                      <div className="timing-text-wrap">
                        <div className="timing-label">{norm.label}</div>
                        <div className="timing-sub">{norm.sub}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="toggle-setting-row" style={{ marginTop: 14 }}>
                <div className="toggle-setting-info">
                  <div className="toggle-setting-label">Include in agent prompt context</div>
                  <div className="toggle-setting-sub">Provide verified / unverified status in conversation turn</div>
                </div>
                <label className="toggle-switch">
                  <input 
                    type="checkbox" 
                    checked={includeInContext}
                    onChange={(e) => updateConfig('include_in_context', e.target.checked)}
                  />
                  <span className="slider"></span>
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER: MOCK API CONFIGURATION (User-Oriented Visual Fields)
  // ──────────────────────────────────────────────────────────────────────────
  const renderMockApiForm = () => {
    const latency = config.simulated_latency_ms || 180;
    const mockBody = config.mock_response_body || '{\n  "order_status": "Out for delivery"\n}';
    const mapping = config.response_mapping || [];
    const headers = config.headers || [];

    const MOCK_PRESETS = [
      {
        id: 'delivery',
        label: 'Order Delivery',
        fields: [
          { id: '1', key: 'order_status', value: 'Out for delivery' },
          { id: '2', key: 'delivery_partner', value: 'BlueDart Express' },
          { id: '3', key: 'expected_eta', value: 'Today before 6 PM' }
        ],
        mapping: [
          { path: 'order_status', variable: 'order_status', description: 'Current shipment status' },
          { path: 'expected_eta', variable: 'expected_eta', description: 'Delivery ETA' }
        ]
      },
      {
        id: 'appointment',
        label: 'Appointment Booking',
        fields: [
          { id: '1', key: 'booking_status', value: 'Confirmed' },
          { id: '2', key: 'appointment_slot', value: 'Tomorrow at 2:30 PM' },
          { id: '3', key: 'doctor_name', value: 'Dr. Siddharth Roy' }
        ],
        mapping: [
          { path: 'booking_status', variable: 'booking_status', description: 'Appointment status' },
          { path: 'appointment_slot', variable: 'appointment_slot', description: 'Confirmed slot' }
        ]
      },
      {
        id: 'balance',
        label: 'Account & Balance',
        fields: [
          { id: '1', key: 'account_status', value: 'Active' },
          { id: '2', key: 'available_balance', value: '₹18,500' },
          { id: '3', key: 'due_date', value: '15th November' }
        ],
        mapping: [
          { path: 'account_status', variable: 'account_status', description: 'Account status' },
          { path: 'available_balance', variable: 'available_balance', description: 'Current balance' }
        ]
      }
    ];

    const applyMockPreset = (preset) => {
      updateMockFields(preset.fields);
      if (preset.mapping) {
        updateConfig('response_mapping', preset.mapping);
      }
    };

    return (
      <div className="drawer-tool-section">
        {/* Preset Quick Chips */}
        <div className="form-group-field">
          <div className="panel-table-header">
            <span>Sample Business Presets</span>
          </div>
          <div className="preset-chips-grid">
            {MOCK_PRESETS.map(pr => (
              <button 
                key={pr.id}
                type="button" 
                className="preset-chip-btn"
                onClick={() => applyMockPreset(pr)}
              >
                + {pr.label}
              </button>
            ))}
          </div>
        </div>

        {/* Visual Return Data (Field Name & Return Value) */}
        <div className="form-group-field" style={{ marginTop: 16 }}>
          <div className="panel-table-header">
            <div>
              <span style={{ fontWeight: 600 }}>Simulated Return Data</span>
              <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                Values this mock tool will return to your agent when triggered.
              </p>
            </div>
            <button 
              type="button" 
              className="btn-text-action"
              onClick={() => {
                const nextId = String(Date.now());
                updateMockFields([...mockFields, { id: nextId, key: '', value: '' }]);
              }}
            >
              <Plus size={13} /> Add Field
            </button>
          </div>

          <div className="visual-field-rows">
            {mockFields.map((f, idx) => (
              <div key={f.id || idx} className="visual-field-row">
                <div className="visual-row-cell key-cell">
                  <label className="visual-input-label">Field Name</label>
                  <input 
                    type="text" 
                    placeholder="e.g. order_status"
                    className="drawer-input"
                    value={f.key || ''}
                    onChange={(e) => {
                      const copy = [...mockFields];
                      copy[idx] = { ...copy[idx], key: e.target.value };
                      updateMockFields(copy);
                    }}
                  />
                </div>
                <div className="visual-row-cell val-cell">
                  <label className="visual-input-label">Return Value</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Out for delivery"
                    className="drawer-input"
                    value={f.value || ''}
                    onChange={(e) => {
                      const copy = [...mockFields];
                      copy[idx] = { ...copy[idx], value: e.target.value };
                      updateMockFields(copy);
                    }}
                  />
                </div>
                <button 
                  type="button" 
                  className="btn-row-delete"
                  title="Remove this return field"
                  onClick={() => {
                    const copy = mockFields.filter((_, i) => i !== idx);
                    updateMockFields(copy);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Save Output to Conversation Variables */}
        <div className="form-group-field" style={{ marginTop: 18 }}>
          <div className="panel-table-header">
            <div>
              <span style={{ fontWeight: 600 }}>Save Output to Conversation Variables</span>
              <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                Store these return fields into agent memory so the agent can speak them to callers.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button 
                type="button" 
                className="btn-text-action"
                onClick={() => {
                  const existing = new Set(mapping.map(m => (m.path || '').trim()));
                  const toAdd = [];
                  mockFields.forEach(f => {
                    const k = (f.key || '').trim();
                    if (k && !existing.has(k)) {
                      toAdd.push({ path: k, variable: k, description: `Simulated ${k}` });
                      existing.add(k);
                    }
                  });
                  if (toAdd.length > 0) {
                    updateConfig('response_mapping', [...mapping, ...toAdd]);
                  }
                }}
                title="Automatically map all simulated fields to variables"
              >
                <Sparkles size={12} /> Auto-map fields
              </button>
              <button 
                type="button" 
                className="btn-text-action"
                onClick={() => {
                  const updated = [...mapping, { path: '', variable: '', description: '' }];
                  updateConfig('response_mapping', updated);
                }}
              >
                <Plus size={13} /> Add Variable
              </button>
            </div>
          </div>

          {mapping.length === 0 ? (
            <div className="panel-empty-text">
              No variables mapped yet. Click "+ Add Variable" to store outputs in agent memory.
            </div>
          ) : (
            <div className="visual-field-rows">
              {mapping.map((m, idx) => (
                <div key={idx} className="visual-field-row">
                  <div className="visual-row-cell key-cell">
                    <label className="visual-input-label">Return Field</label>
                    <input 
                      type="text" 
                      placeholder="e.g. order_status"
                      className="drawer-input"
                      value={m.path || ''}
                      onChange={(e) => {
                        const copy = [...mapping];
                        copy[idx] = { ...copy[idx], path: e.target.value };
                        updateConfig('response_mapping', copy);
                      }}
                    />
                  </div>
                  <div className="visual-row-cell val-cell">
                    <label className="visual-input-label">Agent Variable</label>
                    <input 
                      type="text" 
                      placeholder="e.g. order_status"
                      className="drawer-input"
                      value={m.variable || ''}
                      onChange={(e) => {
                        const copy = [...mapping];
                        copy[idx] = { ...copy[idx], variable: e.target.value };
                        updateConfig('response_mapping', copy);
                      }}
                    />
                  </div>
                  <button 
                    type="button" 
                    className="btn-row-delete"
                    title="Remove variable mapping"
                    onClick={() => {
                      const copy = mapping.filter((_, i) => i !== idx);
                      updateConfig('response_mapping', copy);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Voice Fallback */}
        <div className="form-group-field" style={{ marginTop: 18 }}>
          <label>Spoken line if tool cannot be reached</label>
          <input 
            type="text" 
            className="drawer-input"
            placeholder="I am having trouble checking that right now. Let me help you with something else."
            value={fallbackResponse}
            onChange={(e) => setFallbackResponse(e.target.value)}
          />
        </div>

        {/* Advanced Developer Settings Accordion */}
        <div className="advanced-accordion-wrap">
          <button 
            type="button" 
            className="advanced-accordion-toggle"
            onClick={() => setShowAdvancedMock(prev => !prev)}
          >
            <span>Advanced Developer Settings (Raw JSON, Headers, Latency)</span>
            {showAdvancedMock ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {showAdvancedMock && (
            <div className="advanced-accordion-content">
              {/* Simulated Latency */}
              <div className="form-group-field">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ margin: 0 }}>Simulated Network Latency</label>
                  <span className="slider-val-tag">{latency} ms</span>
                </div>
                <input 
                  type="range" 
                  min={30} 
                  max={2000} 
                  step={10}
                  className="drawer-slider"
                  value={latency}
                  onChange={(e) => updateConfig('simulated_latency_ms', parseInt(e.target.value))}
                />
                <span className="field-hint-text">Simulates realistic speech turn delay during conversational testing.</span>
              </div>

              {/* Raw JSON toggle */}
              <div className="form-group-field" style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ margin: 0 }}>Raw Response Payload (JSON)</label>
                  <button 
                    type="button" 
                    className="btn-text-action"
                    onClick={() => setShowRawJsonMock(prev => !prev)}
                  >
                    {showRawJsonMock ? 'Hide Raw Editor' : 'Show Raw JSON Editor'}
                  </button>
                </div>
                {showRawJsonMock && (
                  <textarea 
                    rows={6}
                    className="drawer-textarea code-font"
                    value={mockBody}
                    onChange={(e) => {
                      updateConfig('mock_response_body', e.target.value);
                      try {
                        const parsed = JSON.parse(e.target.value);
                        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                          setMockFields(Object.entries(parsed).map(([k, v], idx) => ({
                            id: String(idx + 1),
                            key: k,
                            value: typeof v === 'object' ? JSON.stringify(v) : String(v)
                          })));
                        }
                      } catch (err) {}
                    }}
                  />
                )}
              </div>

              {/* Endpoint overrides */}
              <div className="two-col-grid" style={{ marginTop: 14 }}>
                <div className="form-group-field">
                  <label>Mock Endpoint URL</label>
                  <input 
                    type="text" 
                    className="drawer-input"
                    value={config.url || 'https://mock.clozflow.ai/api/v1/orders'}
                    onChange={(e) => updateConfig('url', e.target.value)}
                  />
                </div>
                <div className="form-group-field">
                  <label>HTTP Method</label>
                  <select 
                    className="drawer-select"
                    value={config.method || 'POST'}
                    onChange={(e) => updateConfig('method', e.target.value)}
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="DELETE">DELETE</option>
                  </select>
                </div>
              </div>

              {/* Headers */}
              <div className="form-group-field" style={{ marginTop: 14 }}>
                <div className="panel-table-header">
                  <span>Custom Headers</span>
                  <button 
                    type="button" 
                    className="btn-text-action"
                    onClick={() => {
                      const updated = [...headers, { key: '', value: '', enabled: true }];
                      updateConfig('headers', updated);
                    }}
                  >
                    <Plus size={13} /> Add Header
                  </button>
                </div>
                {headers.length > 0 && (
                  <div className="key-value-rows">
                    {headers.map((h, idx) => (
                      <div key={idx} className="key-value-row">
                        <input 
                          type="checkbox" 
                          checked={h.enabled !== false}
                          onChange={(e) => {
                            const copy = [...headers];
                            copy[idx] = { ...copy[idx], enabled: e.target.checked };
                            updateConfig('headers', copy);
                          }}
                        />
                        <input 
                          type="text" 
                          placeholder="Header Key"
                          className="drawer-input row-input-key"
                          value={h.key || ''}
                          onChange={(e) => {
                            const copy = [...headers];
                            copy[idx] = { ...copy[idx], key: e.target.value };
                            updateConfig('headers', copy);
                          }}
                        />
                        <input 
                          type="text" 
                          placeholder="Header Value"
                          className="drawer-input row-input-val"
                          value={h.value || ''}
                          onChange={(e) => {
                            const copy = [...headers];
                            copy[idx] = { ...copy[idx], value: e.target.value };
                            updateConfig('headers', copy);
                          }}
                        />
                        <button 
                          type="button" 
                          className="btn-row-delete"
                          onClick={() => {
                            const copy = headers.filter((_, i) => i !== idx);
                            updateConfig('headers', copy);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Max wait timeout */}
              <div className="form-group-field" style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ margin: 0 }}>Max Wait Timeout (Seconds)</label>
                  <span className="slider-val-tag">{timeoutSeconds}s</span>
                </div>
                <input 
                  type="range" 
                  min={2} 
                  max={30} 
                  step={1}
                  className="drawer-slider"
                  value={timeoutSeconds}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setTimeoutSeconds(val);
                    updateConfig('timeout_seconds', val);
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER: MCP CONFIGURATION
  // ──────────────────────────────────────────────────────────────────────────
  const renderMcpForm = () => {
    return (
      <div className="drawer-tool-section">
        <div className="mcp-empty-state-card">
          <div className="mcp-empty-icon-wrap">
            <Cpu size={32} />
          </div>
          <h3 className="mcp-empty-title">No integrations connected</h3>
          <p className="mcp-empty-desc">
            No integrations connected - Connect a server, then pick its tools
          </p>
          <div className="mcp-empty-actions">
            <button 
              type="button" 
              className="btn-mcp-connect"
              onClick={() => alert('Connect MCP Server: Navigate to Settings > Integrations to connect an MCP server.')}
            >
              <Plus size={14} /> Add Integration
            </button>
          </div>
        </div>

        <div className="form-group-field" style={{ marginTop: 20 }}>
          <label>Manual Server ID / URL</label>
          <input 
            type="text" 
            className="drawer-input"
            placeholder="mcp://localhost:8080/servers/sales"
            value={config.server_id || ''}
            onChange={(e) => updateConfig('server_id', e.target.value)}
          />
        </div>
        <div className="form-group-field" style={{ marginTop: 12 }}>
          <label>Tool Name on MCP Server</label>
          <input 
            type="text" 
            className="drawer-input"
            placeholder="query_customer_order"
            value={config.server_tool_name || ''}
            onChange={(e) => updateConfig('server_tool_name', e.target.value)}
          />
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Backdrop */}
      <div className="tool-drawer-backdrop" onClick={onClose} />

      {/* Main Drawer Panel */}
      <div className="tool-drawer-container">
        {/* Drawer Header */}
        <div className="tool-drawer-header">
          <div className="drawer-header-left">
            <div className="drawer-title-row">
              <input 
                type="text" 
                className="drawer-name-input"
                placeholder="Tool Name (e.g. Fetch Order Status)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <span className={`drawer-type-badge type-${toolType}`}>
                {toolType === 'api_tool' && 'REST API'}
                {toolType === 'data_validator' && 'Validator'}
                {toolType === 'data_verifier' && 'Verifier'}
                {toolType === 'mock_api' && 'Mock API'}
                {toolType === 'mcp' && 'MCP'}
              </span>
            </div>
            <div className="drawer-subtitle-row">
              <input 
                type="text" 
                className="drawer-desc-input"
                placeholder="Add a short description of what this tool does..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <div className="drawer-header-actions">
            {/* Active Toggle Switch */}
            <div className="drawer-active-toggle-wrap" title={isActive ? 'Tool is active' : 'Tool is paused'}>
              <span className="drawer-toggle-label">{isActive ? 'Active' : 'Disabled'}</span>
              <label className="toggle-switch">
                <input 
                  type="checkbox" 
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                <span className="slider"></span>
              </label>
            </div>

            <button 
              type="button" 
              className="drawer-close-btn"
              onClick={onClose}
              title="Close drawer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Drawer Scrollable Body */}
        <div className="tool-drawer-body">
          {toolType === 'api_tool' && renderApiToolForm()}
          {toolType === 'data_validator' && renderDataValidatorForm()}
          {toolType === 'data_verifier' && renderDataVerifierForm()}
          {toolType === 'mock_api' && renderMockApiForm()}
          {toolType === 'mcp' && renderMcpForm()}

          {/* ──────────────────────────────────────────────────────────────
              LIVE TEST INSPECTOR & RUNNER (Common to all tools)
              ────────────────────────────────────────────────────────────── */}
          <div className="live-tester-card">
            <div className="tester-header">
              <div className="tester-title-cluster">
                <Play size={14} className="text-emerald-500" />
                <span className="tester-title">Live Test Inspector</span>
              </div>
              <button 
                type="button" 
                className="btn-send-test"
                disabled={isTesting}
                onClick={handleRunLiveTest}
              >
                {isTesting ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
                <span>{isTesting ? 'Sending...' : '▷ Send / Test Tool'}</span>
              </button>
            </div>

            {/* Test Inputs section */}
            <div className="tester-inputs-section">
              <div className="tester-inputs-label">Test Input Parameters:</div>
              <div className="tester-inputs-grid">
                {toolType === 'data_validator' ? (
                  <div className="test-input-item">
                    <span>Sample Spoken Input:</span>
                    <input 
                      type="text" 
                      placeholder="e.g. 9876543210"
                      className="drawer-input test-field"
                      value={testInputs.test_value || ''}
                      onChange={(e) => setTestInputs(prev => ({ ...prev, test_value: e.target.value }))}
                    />
                  </div>
                ) : toolType === 'data_verifier' ? (
                  <>
                    <div className="test-input-item">
                      <span>Caller Spoken:</span>
                      <input 
                        type="text" 
                        placeholder="+91 98765-43210"
                        className="drawer-input test-field"
                        value={testInputs.spoken_value || ''}
                        onChange={(e) => setTestInputs(prev => ({ ...prev, spoken_value: e.target.value }))}
                      />
                    </div>
                    <div className="test-input-item">
                      <span>Record on File:</span>
                      <input 
                        type="text" 
                        placeholder="09876543210"
                        className="drawer-input test-field"
                        value={testInputs.reference_value || config.reference_value || ''}
                        onChange={(e) => setTestInputs(prev => ({ ...prev, reference_value: e.target.value }))}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="test-input-item">
                      <span>lead_name:</span>
                      <input 
                        type="text" 
                        className="drawer-input test-field"
                        placeholder="Siddharth Roy"
                        value={testInputs.lead_name ?? ''}
                        onChange={(e) => setTestInputs(prev => ({ ...prev, lead_name: e.target.value }))}
                      />
                    </div>
                    <div className="test-input-item">
                      <span>order_id:</span>
                      <input 
                        type="text" 
                        className="drawer-input test-field"
                        placeholder="ORD-8821"
                        value={testInputs.order_id ?? ''}
                        onChange={(e) => setTestInputs(prev => ({ ...prev, order_id: e.target.value }))}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Test Output Panel */}
            {testResult && (
              <div className="tester-output-panel">
                <div className="tester-output-header">
                  <div className="output-status-pills">
                    {testResult.success ? (
                      <span className="status-badge success">
                        <CheckCircle2 size={12} /> {testResult.status_code ? `${testResult.status_code} OK` : 'Passed'}
                      </span>
                    ) : (
                      <span className="status-badge error">
                        <AlertCircle size={12} /> {testResult.status_code ? `${testResult.status_code} Error` : 'Failed'}
                      </span>
                    )}
                    {testResult.latency_ms !== undefined && (
                      <span className="status-badge latency">
                        <Clock size={11} /> {testResult.latency_ms} ms
                      </span>
                    )}
                  </div>
                </div>

                {/* Validation / Verification specific results */}
                {testResult.is_valid !== undefined && (
                  <div className="result-metric-row">
                    <span>Validation Status:</span>
                    <strong style={{ color: testResult.is_valid ? '#16a34a' : '#dc2626' }}>
                      {testResult.is_valid ? 'Valid Match' : 'Invalid Format'}
                    </strong>
                    {testResult.reason && <span className="result-reason">({testResult.reason})</span>}
                  </div>
                )}

                {testResult.is_match !== undefined && (
                  <div className="result-metric-row">
                    <span>Record Match:</span>
                    <strong style={{ color: testResult.is_match ? '#16a34a' : '#dc2626' }}>
                      {testResult.is_match ? '100% Equivalence Match' : 'Mismatch'}
                    </strong>
                    <div className="norm-values-pair">
                      <span>Normalized Spoken: <code>{testResult.normalized_spoken || '(empty)'}</code></span>
                      <span>Normalized Record: <code>{testResult.normalized_reference || '(empty)'}</code></span>
                    </div>
                  </div>
                )}

                {/* Spoken Feedback preview */}
                {testResult.spoken_feedback && (
                  <div className="spoken-preview-box">
                    <span className="spoken-label">Agent Spoken Feedback:</span>
                    <p className="spoken-text">"{testResult.spoken_feedback}"</p>
                  </div>
                )}

                {/* Extracted Variables Chips */}
                {testResult.extracted_variables && Object.keys(testResult.extracted_variables).length > 0 && (
                  <div className="extracted-vars-box">
                    <span className="extracted-vars-title">Extracted @field Variables:</span>
                    <div className="extracted-chips-wrap">
                      {Object.entries(testResult.extracted_variables).map(([k, v]) => (
                        <div key={k} className="extracted-chip">
                          <span className="chip-key">@{k}</span>
                          <span className="chip-arrow">→</span>
                          <span className="chip-val">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Raw Response Data Viewer (Collapsible for Power Users) */}
                {testResult.response_data && (
                  <div className="response-data-viewer">
                    <button 
                      type="button" 
                      className="btn-text-action"
                      style={{ fontSize: '0.74rem', padding: 0, textDecoration: 'underline' }}
                      onClick={() => setShowRawTestOutput(prev => !prev)}
                    >
                      {showRawTestOutput ? 'Hide Raw Response Data' : 'View Raw Response Data (JSON)'}
                    </button>
                    {showRawTestOutput && (
                      <pre className="response-pre code-font" style={{ marginTop: 6 }}>
                        {typeof testResult.response_data === 'object'
                          ? JSON.stringify(testResult.response_data, null, 2)
                          : String(testResult.response_data)}
                      </pre>
                    )}
                  </div>
                )}

                {testResult.error && (
                  <div className="test-error-callout">
                    <AlertCircle size={14} />
                    <span>{testResult.error}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Drawer Footer */}
        <div className="tool-drawer-footer">
          <div className="drawer-footer-left">
            {tool.id && onDeleteTool && (
              <button 
                type="button" 
                className="btn-delete-tool"
                onClick={() => {
                  if (window.confirm(`Are you sure you want to delete the "${name}" tool?`)) {
                    onDeleteTool(tool.id);
                  }
                }}
              >
                <Trash2 size={13} />
                <span>Delete Tool</span>
              </button>
            )}
          </div>

          <div className="drawer-footer-right">
            <button 
              type="button" 
              className="btn-drawer-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button 
              type="button" 
              className="btn-drawer-save"
              onClick={handleSave}
            >
              <Check size={14} />
              <span>Save Changes</span>
            </button>
          </div>
        </div>
      </div>

      {/* cURL Command Parser Modal */}
      {showCurlModal && (
        <div className="curl-modal-backdrop" onClick={() => setShowCurlModal(false)}>
          <div className="curl-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="curl-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Code2 size={18} color="#2563eb" />
                <h4 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 600 }}>Import from cURL Command</h4>
              </div>
              <button 
                type="button" 
                className="tool-btn-close" 
                onClick={() => setShowCurlModal(false)}
              >
                <X size={15} />
              </button>
            </div>

            <div className="curl-modal-body">
              <p style={{ margin: '0 0 10px 0', fontSize: '0.82rem', color: '#64748b' }}>
                Paste any standard <code>curl</code> command. Clozflow will automatically extract the endpoint URL, HTTP method, headers, query parameters, authentication, and JSON body.
              </p>
              <textarea 
                rows={6}
                className="drawer-textarea code-font"
                placeholder={'curl -X POST https://api.crm.io/v1/leads \\\n  -H "Authorization: Bearer my_token" \\\n  -d \'{"lead_id": "100"}\''}
                value={curlInput}
                onChange={(e) => setCurlInput(e.target.value)}
                autoFocus
              />
              {curlError && (
                <div className="test-error-callout" style={{ marginTop: 8 }}>
                  <AlertCircle size={13} />
                  <span>{curlError}</span>
                </div>
              )}
            </div>

            <div className="curl-modal-footer">
              <button 
                type="button" 
                className="btn-drawer-cancel"
                onClick={() => setShowCurlModal(false)}
              >
                Cancel
              </button>
              <button 
                type="button" 
                className="btn-drawer-save"
                disabled={curlParsing || !curlInput.trim()}
                onClick={handleParseCurl}
              >
                {curlParsing ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
                <span>Parse & Apply to Form</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ToolDrawer;
