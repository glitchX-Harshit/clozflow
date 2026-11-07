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

  // cURL parser drawer/popover state
  const [showCurlModal, setShowCurlModal] = useState(false);
  const [curlInput, setCurlInput] = useState('');
  const [curlParsing, setCurlParsing] = useState(false);
  const [curlError, setCurlError] = useState(null);

  // Live Test State
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testInputs, setTestInputs] = useState(() => ({ ...testVariables }));

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
      setTestResult(null);
    }
  }, [tool]);

  // Handle configuration updates
  const updateConfig = (key, val) => {
    setConfig(prev => ({ ...prev, [key]: val }));
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

      const data = await res.json();
      setTestResult(data);
    } catch (err) {
      console.error('Test execution failed:', err);
      setTestResult({
        success: false,
        error: err.message || 'Execution error'
      });
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
        {/* cURL Import Banner */}
        <div className="curl-import-banner">
          <div className="curl-banner-left">
            <Code2 size={16} />
            <span>Have a cURL command? Paste it to auto-fill the form</span>
          </div>
          <button 
            type="button" 
            className="btn-curl-trigger"
            onClick={() => setShowCurlModal(true)}
          >
            Paste cURL →
          </button>
        </div>

        {/* Endpoint Row (Method + URL) */}
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
          Use <code>{`{{variable}}`}</code> syntax to dynamically interpolate conversational parameters.
        </div>

        {/* API Subtabs */}
        <div className="api-subtabs-bar">
          <button 
            type="button" 
            className={`api-subtab-btn ${apiSubtab === 'path' ? 'active' : ''}`}
            onClick={() => setApiSubtab('path')}
          >
            Path & Params ({params.length})
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
            className={`api-subtab-btn ${apiSubtab === 'body' ? 'active' : ''}`}
            onClick={() => setApiSubtab('body')}
          >
            Body
          </button>
          <button 
            type="button" 
            className={`api-subtab-btn ${apiSubtab === 'mapping' ? 'active' : ''}`}
            onClick={() => setApiSubtab('mapping')}
          >
            @field Mapping ({mapping.length})
          </button>
          <button 
            type="button" 
            className={`api-subtab-btn ${apiSubtab === 'timing' ? 'active' : ''}`}
            onClick={() => setApiSubtab('timing')}
          >
            Timing & Fallback
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

        {/* Subtab 5: Response Mapping */}
        {apiSubtab === 'mapping' && (
          <div className="subtab-panel">
            <div className="panel-table-header">
              <div>
                <span style={{ fontWeight: 600 }}>@field Response Mapping</span>
                <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                  Extract values from the JSON response and bind them directly into conversation variables for the agent to reference.
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
                <Plus size={13} /> Add Mapping
              </button>
            </div>

            {mapping.length === 0 ? (
              <div className="panel-empty-text">
                No response fields mapped. Click "+ Add Mapping" to store attributes into variables.
              </div>
            ) : (
              <div className="mapping-table-wrap">
                <table className="mapping-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40%' }}>JSON Field Path (e.g. data.status)</th>
                      <th style={{ width: '35%' }}>Target Variable Name</th>
                      <th style={{ width: '20%' }}>Description</th>
                      <th style={{ width: '5%' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapping.map((m, idx) => (
                      <tr key={idx}>
                        <td>
                          <input 
                            type="text" 
                            className="drawer-input table-field-input code-font"
                            placeholder="data.order.status"
                            value={m.path || ''}
                            onChange={(e) => {
                              const copy = [...mapping];
                              copy[idx] = { ...copy[idx], path: e.target.value };
                              updateConfig('response_mapping', copy);
                            }}
                          />
                        </td>
                        <td>
                          <input 
                            type="text" 
                            className="drawer-input table-field-input code-font"
                            placeholder="order_status"
                            value={m.variable || ''}
                            onChange={(e) => {
                              const copy = [...mapping];
                              copy[idx] = { ...copy[idx], variable: e.target.value };
                              updateConfig('response_mapping', copy);
                            }}
                          />
                        </td>
                        <td>
                          <input 
                            type="text" 
                            className="drawer-input table-field-input"
                            placeholder="Order status"
                            value={m.description || ''}
                            onChange={(e) => {
                              const copy = [...mapping];
                              copy[idx] = { ...copy[idx], description: e.target.value };
                              updateConfig('response_mapping', copy);
                            }}
                          />
                        </td>
                        <td>
                          <button 
                            type="button" 
                            className="btn-row-delete"
                            onClick={() => {
                              const copy = mapping.filter((_, i) => i !== idx);
                              updateConfig('response_mapping', copy);
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Subtab 6: Timing & Fallback */}
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
                onChange={(e) => updateConfig('timeout_seconds', parseInt(e.target.value))}
              />
              <span className="field-hint-text">If the endpoint does not reply within this timeout, the fallback line will be spoken.</span>
            </div>

            <div className="form-group-field" style={{ marginTop: 16 }}>
              <label>Fallback spoken line if tool fails or times out</label>
              <textarea 
                rows={2}
                className="drawer-textarea"
                placeholder="I'm having trouble retrieving that record right now, let's continue with your questions."
                value={fallbackResponse}
                onChange={(e) => setFallbackResponse(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER: DATA VALIDATOR CONFIGURATION
  // ──────────────────────────────────────────────────────────────────────────
  const renderDataValidatorForm = () => {
    const dataType = config.data_type || 'string';
    const preset = config.preset || 'indian_phone';
    const customRegex = config.regex_pattern || '';
    const inputSource = config.input_source || 'spoken_input';
    const includeInContext = config.include_in_context !== false;

    const PRESET_PATTERNS = {
      indian_phone: '^(?:\\+91|0)?[6-9]\\d{9}$',
      pan_card: '^[A-Z]{5}[0-9]{4}[A-Z]$',
      pincode: '^[1-9][0-9]{5}$',
      email: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
      aadhaar_last4: '^[0-9]{4}$'
    };

    const handleSelectPreset = (p) => {
      updateConfig('preset', p);
      if (p !== 'custom' && PRESET_PATTERNS[p]) {
        updateConfig('regex_pattern', PRESET_PATTERNS[p]);
      }
    };

    return (
      <div className="drawer-tool-section">
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
            <label>Input Source</label>
            <input 
              type="text" 
              className="drawer-input"
              placeholder="e.g. caller_mobile, pan_card"
              value={inputSource}
              onChange={(e) => updateConfig('input_source', e.target.value)}
            />
          </div>
        </div>

        <div className="form-group-field" style={{ marginTop: 14 }}>
          <label>Validation Preset</label>
          <div className="preset-chips-grid">
            {[
              { id: 'indian_phone', label: 'Indian Phone (10 digits)' },
              { id: 'pan_card', label: 'PAN Card (ABCDE1234F)' },
              { id: 'pincode', label: '6-digit Pincode' },
              { id: 'email', label: 'Email Address' },
              { id: 'aadhaar_last4', label: 'Aadhaar Last 4' },
              { id: 'custom', label: 'Custom Regex Pattern' }
            ].map(pr => (
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

        <div className="form-group-field" style={{ marginTop: 14 }}>
          <label>Regular Expression Pattern</label>
          <input 
            type="text" 
            className="drawer-input code-font"
            placeholder="^[0-9]{10}$"
            value={customRegex}
            onChange={(e) => {
              updateConfig('preset', 'custom');
              updateConfig('regex_pattern', e.target.value);
            }}
          />
          <span className="field-hint-text">Engine tests incoming spoken turn against this regex syntax in real-time.</span>
        </div>

        <div className="form-group-field" style={{ marginTop: 16 }}>
          <label>Spoken feedback on successful format match</label>
          <input 
            type="text" 
            className="drawer-input"
            placeholder="Got it, that looks valid."
            value={config.spoken_on_success || ''}
            onChange={(e) => updateConfig('spoken_on_success', e.target.value)}
          />
        </div>

        <div className="form-group-field" style={{ marginTop: 12 }}>
          <label>Spoken feedback on failed validation</label>
          <input 
            type="text" 
            className="drawer-input"
            placeholder="That doesn't seem like a valid number, could you please repeat it?"
            value={config.spoken_on_fail || ''}
            onChange={(e) => updateConfig('spoken_on_fail', e.target.value)}
          />
        </div>

        <div className="form-group-field" style={{ marginTop: 12 }}>
          <label>Spoken feedback on unexpected error</label>
          <input 
            type="text" 
            className="drawer-input"
            placeholder="I had trouble verifying that format."
            value={config.spoken_on_error || ''}
            onChange={(e) => updateConfig('spoken_on_error', e.target.value)}
          />
        </div>

        <div className="toggle-setting-row" style={{ marginTop: 16 }}>
          <div className="toggle-setting-info">
            <div className="toggle-setting-label">Include in context</div>
            <div className="toggle-setting-sub">Pass validation outcome into LLM prompt so agent knows whether it passed</div>
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
            <label>Reference Source on File</label>
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
            <label>Match Mode</label>
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

        <div className="form-group-field" style={{ marginTop: 14 }}>
          <label>Sample Reference Value on File (for Testing)</label>
          <input 
            type="text" 
            className="drawer-input"
            placeholder="+91 98765-43210 or 560001"
            value={referenceValue}
            onChange={(e) => updateConfig('reference_value', e.target.value)}
          />
        </div>

        <div className="form-group-field" style={{ marginTop: 16 }}>
          <label>Spoken feedback on successful match</label>
          <input 
            type="text" 
            className="drawer-input"
            placeholder="Thank you, that matches our records."
            value={config.spoken_on_match || ''}
            onChange={(e) => updateConfig('spoken_on_match', e.target.value)}
          />
        </div>

        <div className="form-group-field" style={{ marginTop: 12 }}>
          <label>Spoken feedback on mismatch</label>
          <input 
            type="text" 
            className="drawer-input"
            placeholder="I'm sorry, that doesn't match what we have on file."
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

        <div className="toggle-setting-row" style={{ marginTop: 16 }}>
          <div className="toggle-setting-info">
            <div className="toggle-setting-label">Include in context</div>
            <div className="toggle-setting-sub">Provide verified / unverified status in LLM agent conversation prompt</div>
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
    );
  };

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER: MOCK API CONFIGURATION
  // ──────────────────────────────────────────────────────────────────────────
  const renderMockApiForm = () => {
    const latency = config.simulated_latency_ms || 180;
    const mockBody = config.mock_response_body || '{\n  "status": "confirmed"\n}';
    const mapping = config.response_mapping || [];
    const headers = config.headers || [];

    return (
      <div className="drawer-tool-section">
        <div className="two-col-grid">
          <div className="form-group-field">
            <label>Mock URL</label>
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

        <div className="form-group-field" style={{ marginTop: 14 }}>
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

        {/* Mock Headers */}
        <div className="form-group-field" style={{ marginTop: 14 }}>
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

        <div className="form-group-field" style={{ marginTop: 14 }}>
          <label>Mock Response Body (JSON)</label>
          <textarea 
            rows={6}
            className="drawer-textarea code-font"
            value={mockBody}
            onChange={(e) => updateConfig('mock_response_body', e.target.value)}
          />
        </div>

        <div className="form-group-field" style={{ marginTop: 14 }}>
          <div className="panel-table-header">
            <span>Response Field Mapping</span>
            <button 
              type="button" 
              className="btn-text-action"
              onClick={() => {
                const updated = [...mapping, { path: '', variable: '', description: '' }];
                updateConfig('response_mapping', updated);
              }}
            >
              <Plus size={13} /> Add Mapping
            </button>
          </div>
          {mapping.map((m, idx) => (
            <div key={idx} className="key-value-row" style={{ marginTop: 6 }}>
              <input 
                type="text" 
                placeholder="Field path (e.g. status)"
                className="drawer-input row-input-key code-font"
                value={m.path || ''}
                onChange={(e) => {
                  const copy = [...mapping];
                  copy[idx] = { ...copy[idx], path: e.target.value };
                  updateConfig('response_mapping', copy);
                }}
              />
              <input 
                type="text" 
                placeholder="Variable (e.g. order_status)"
                className="drawer-input row-input-val code-font"
                value={m.variable || ''}
                onChange={(e) => {
                  const copy = [...mapping];
                  copy[idx] = { ...copy[idx], variable: e.target.value };
                  updateConfig('response_mapping', copy);
                }}
              />
              <button 
                type="button" 
                className="btn-row-delete"
                onClick={() => {
                  const copy = mapping.filter((_, i) => i !== idx);
                  updateConfig('response_mapping', copy);
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
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

        {/* Fallback response */}
        <div className="form-group-field" style={{ marginTop: 16 }}>
          <label>Fallback spoken line if mock service fails or times out</label>
          <textarea 
            rows={2}
            className="drawer-textarea"
            placeholder="I am having trouble checking that right now."
            value={fallbackResponse}
            onChange={(e) => setFallbackResponse(e.target.value)}
          />
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
                        value={testInputs.lead_name || 'Siddharth Roy'}
                        onChange={(e) => setTestInputs(prev => ({ ...prev, lead_name: e.target.value }))}
                      />
                    </div>
                    <div className="test-input-item">
                      <span>order_id:</span>
                      <input 
                        type="text" 
                        className="drawer-input test-field"
                        value={testInputs.order_id || 'ORD-8821'}
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

                {/* Raw Response Data Viewer */}
                {testResult.response_data && (
                  <div className="response-data-viewer">
                    <span className="response-viewer-label">Response Payload:</span>
                    <pre className="response-pre code-font">
                      {typeof testResult.response_data === 'object'
                        ? JSON.stringify(testResult.response_data, null, 2)
                        : String(testResult.response_data)}
                    </pre>
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
