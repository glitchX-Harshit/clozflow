import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { 
  X, Link2, Check, Shield, Layers, Cable, 
  Play, Plus, Trash2, AlertCircle, RefreshCw, Sparkles,
  ChevronDown, ChevronUp, Code2, Phone, Calendar, Type, Braces, Search
} from 'lucide-react';
import './ToolsStudio.css';

const AiBadgeIcon = ({ size = 15, className }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="1.8" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M8 16l2.5-7 2.5 7" />
    <path d="M9 13.5h3" />
    <path d="M16 9v7" />
  </svg>
);

const ARCHETYPE_META = {
  api_tool: {
    title: 'API Tool',
    subtitle: "Call your API to fetch or update data, such as a caller's booking details.",
    step2Title: 'Set up the API call',
    step3Title: 'Send fields from the API response to the agent',
    defaultName: 'get_order_status',
    namePlaceholder: 'e.g. get_order_status',
    nameHint: 'Use lowercase letters separated by underscores, such as get_order_status.',
    defaultDesc: 'Creates a support ticket from a problem the caller reports.',
    descPlaceholder: 'Creates a support ticket from a problem the caller reports.'
  },
  data_validator: {
    title: 'Data Validator',
    subtitle: "Check a value's format and validity, such as an email or phone number.",
    step2Title: 'Validation settings',
    step3Title: 'Test validator',
    defaultName: 'validate_phone_number',
    namePlaceholder: 'e.g. validate_phone_number',
    nameHint: 'Use snake_case — e.g. validate_phone_number, check_pincode. No spaces.',
    defaultDesc: 'Validates that the customer provided a valid 10-digit Indian mobile number.',
    descPlaceholder: 'Validates that the customer provided a valid 10-digit Indian mobile number.'
  },
  data_verifier: {
    title: 'Data Verifier',
    subtitle: 'Cross-reference caller details against records on file (e.g. verifying the last 4 digits of a phone or PIN).',
    step2Title: 'How to verify',
    step3Title: 'What the agent says',
    defaultName: 'verify_last4',
    namePlaceholder: 'e.g. verify_last4',
    nameHint: 'Use snake_case format (e.g. verify_last4, check_identity_pin) with no spaces.',
    defaultDesc: 'Matches caller input against verified customer records on file before disclosing sensitive account details.',
    descPlaceholder: 'Verifies caller identity by comparing spoken details against stored customer records.'
  },
  mock_api: {
    title: 'Mock API',
    subtitle: 'Test tool calls before your API exists.',
    step2Title: 'Mock responses & test latency',
    step3Title: 'Send fields from mock response to the agent',
    defaultName: 'mock_order_lookup',
    namePlaceholder: 'e.g. mock_order_lookup',
    nameHint: 'Use snake_case format without spaces.',
    defaultDesc: 'Returns simulated delivery status and carrier details for testing conversations.',
    descPlaceholder: 'Returns simulated delivery status and carrier details for testing conversations.'
  },
  mcp: {
    title: 'MCP',
    subtitle: 'Bind tools from a connected MCP server.',
    step2Title: 'Server integration',
    step3Title: 'Test MCP tool',
    defaultName: 'mcp_integration_tool',
    namePlaceholder: 'e.g. mcp_integration_tool',
    nameHint: 'Use snake_case format without spaces.',
    defaultDesc: 'Dispatches actions to a connected MCP server and returns structured data to the agent.',
    descPlaceholder: 'Dispatches actions to a connected MCP server and returns structured data to the agent.'
  }
};

const PRESETS = [
  {
    id: 'indian_phone',
    label: 'Indian Mobile Number',
    rule: 'Validates 10-digit Indian phone numbers (starting with 6-9).',
    pattern: '^(?:\\+91|0)?[6-9]\\d{9}$',
    example: '+91 98765 43210'
  },
  {
    id: 'email',
    label: 'Email Address',
    rule: 'Validates standard email format with @ symbol and domain extension.',
    pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
    example: 'alex@example.com'
  },
  {
    id: 'pincode',
    label: '6-digit PIN Code',
    rule: 'Validates standard 6-digit Indian postal code format (e.g. 560001).',
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
    rule: 'Validates exactly 4 numeric digits for customer verification.',
    pattern: '^[0-9]{4}$',
    example: '4321'
  },
  {
    id: 'custom',
    label: 'Custom Regex Rule',
    rule: 'Define custom regular expression rules for domain-specific codes.',
    pattern: '',
    example: 'Custom regex pattern'
  }
];

// Helper to extract JSON path keys recursively
const extractJsonKeys = (obj, prefix = '') => {
  let keys = [];
  if (!obj || typeof obj !== 'object') return keys;
  if (Array.isArray(obj)) {
    if (obj.length > 0 && typeof obj[0] === 'object' && obj[0] !== null) {
      keys = keys.concat(extractJsonKeys(obj[0], `${prefix}[0].`));
    }
  } else {
    Object.keys(obj).forEach(k => {
      const fullKey = prefix ? `${prefix}${k}` : k;
      keys.push(fullKey);
      if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
        keys = keys.concat(extractJsonKeys(obj[k], `${fullKey}.`));
      }
    });
  }
  return keys;
};

// ── Clean Reusable Dropdown Component (Matches Pixel-Perfect Figma / Sarvam UI) ──
const CleanDropdown = React.memo(({ label, helper, options, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation();
        e.preventDefault();
        setOpen(false);
      }
    } else if (e.key === 'Tab') {
      if (open) {
        setOpen(false);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
      } else {
        const currIdx = options.findIndex(o => o.value === value);
        const nextIdx = (currIdx + 1) % options.length;
        onChange(options[nextIdx].value);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
      } else {
        const currIdx = options.findIndex(o => o.value === value);
        const prevIdx = (currIdx - 1 + options.length) % options.length;
        onChange(options[prevIdx].value);
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(prev => !prev);
    }
  };

  const selectedOption = options.find(o => o.value === value) || options[0];
  const SelectedIcon = selectedOption?.icon;

  return (
    <div className="drawer-field-block" ref={containerRef} onKeyDown={handleKeyDown}>
      {label && <label className="drawer-field-label">{label}</label>}
      <div className={`clean-dropdown-container ${open ? 'is-open' : ''}`}>
        <button
          type="button"
          className="clean-dropdown-trigger"
          onClick={() => setOpen(prev => !prev)}
          aria-expanded={open}
          aria-haspopup="listbox"
          role="combobox"
        >
          <div className="clean-dropdown-value">
            {SelectedIcon && <SelectedIcon size={15} className="clean-dropdown-icon" />}
            <span>{selectedOption?.label}</span>
          </div>
          <ChevronDown size={15} className={`clean-dropdown-chevron ${open ? 'open' : ''}`} />
        </button>

        {open && (
          <div className="clean-dropdown-menu" role="listbox">
            {options.map((opt) => {
              const Icon = opt.icon;
              const isSelected = opt.value === value;
              return (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  className={`clean-dropdown-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onChange(opt.value);
                      setOpen(false);
                    }
                  }}
                >
                  <div className="clean-dropdown-item-left">
                    {Icon && <Icon size={15} className="clean-dropdown-item-icon" />}
                    <span>{opt.label}</span>
                  </div>
                  {isSelected && <Check size={14} className="clean-dropdown-check" />}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {helper && <p className="drawer-field-hint">{helper}</p>}
    </div>
  );
});

export const ToolDrawer = React.memo(({
  isOpen,
  onClose,
  tool,
  agentId,
  onSaveTool,
  onDeleteTool,
  testVariables = {}
}) => {
  const toolType = tool?.tool_type || 'api_tool';
  const meta = ARCHETYPE_META[toolType] || ARCHETYPE_META.api_tool;

  const resolveInitialRunMode = (t) => {
    if (!t) return 'write';
    if (t.run_mode === 'read' || t.run_mode === 'write') return t.run_mode;
    if (t.is_read_tool === true) return 'read';
    if (t.is_async_write === true) return 'write';
    const cfg = t.config || {};
    if (cfg.run_mode === 'read' || cfg.run_mode === 'write') return cfg.run_mode;
    if (cfg.is_read_tool === true) return 'read';
    if (cfg.is_async_write === true) return 'write';
    if (meta.defaultRunMode) return meta.defaultRunMode;
    const n = (t.name || '').toLowerCase();
    if (n.startsWith('get_') || n.startsWith('check_') || n.startsWith('fetch_') || n.startsWith('lookup_') || n.startsWith('verify_') || n.includes('pincode') || n.includes('inventory')) {
      return 'read';
    }
    return 'write';
  };

  // Active form state
  const [name, setName] = useState(tool?.name || meta.defaultName);
  const [description, setDescription] = useState(tool?.description || meta.defaultDesc);
  const [runTiming, setRunTiming] = useState(tool?.run_timing || 'conversation');
  const [runMode, setRunMode] = useState(() => resolveInitialRunMode(tool));
  const [isActive, setIsActive] = useState(tool?.is_active !== false);
  const [fallbackResponse, setFallbackResponse] = useState(
    tool?.fallback_response || tool?.config?.fallback_response || "I'm having trouble retrieving that information right now. Let's proceed."
  );
  const [timeoutSeconds, setTimeoutSeconds] = useState(tool?.timeout_seconds || tool?.config?.timeout_seconds || 10);
  const [config, setConfig] = useState(tool?.config || {});
  const [responseTemplate, setResponseTemplate] = useState(
    tool?.config?.response_template || (tool?.config?.response_mapping && tool?.config?.response_mapping.length > 0 
      ? tool.config.response_mapping.map(m => `@${m.path}`).join(', ')
      : '')
  );

  // Data Verifier state
  const [inputSource, setInputSource] = useState(tool?.config?.input_source || 'fixed_value');
  const [inputValue, setInputValue] = useState(tool?.config?.input_value || '');
  const [inputVariable, setInputVariable] = useState(tool?.config?.input_variable || 'lead.phone');
  const [normalizeAs, setNormalizeAs] = useState(tool?.config?.normalize_as || tool?.config?.normalization || 'none');
  const [matchMode, setMatchMode] = useState(tool?.config?.match_mode || 'exact_match');
  const [matchN, setMatchN] = useState(() => {
    const raw = parseInt(tool?.config?.match_n);
    return isNaN(raw) || raw <= 0 ? 4 : raw;
  });
  const [referenceSource, setReferenceSource] = useState(tool?.config?.reference_source || 'fixed_value');
  const [referenceValue, setReferenceValue] = useState(tool?.config?.reference_value || '');
  const [spokenOnMatch, setSpokenOnMatch] = useState(
    tool?.config?.spoken_responses?.on_match ?? tool?.config?.spoken_on_match ?? 'Thanks — that matches our records on file.'
  );
  const [spokenOnNoMatch, setSpokenOnNoMatch] = useState(
    tool?.config?.spoken_responses?.on_no_match ?? tool?.config?.spoken_on_mismatch ?? "That doesn't match what we have on record. Could you please double-check?"
  );
  const [spokenOnError, setSpokenOnError] = useState(
    tool?.config?.spoken_responses?.on_error ?? tool?.config?.spoken_on_error ?? "I'm experiencing an issue checking those details right now. Let's try again in a moment."
  );

  // Verifier live testing inputs
  const [testVerifierInput, setTestVerifierInput] = useState('3210');
  const [testVerifierRef, setTestVerifierRef] = useState('+91 98765 43210');

  // Subtabs for Step 2
  const [activeSubtab, setActiveSubtab] = useState('Path'); // 'Path' | 'Params' | 'Headers' | 'Auth' | 'Body'
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [isImproving, setIsImproving] = useState(false);

  // cURL modal state
  const [showCurlModal, setShowCurlModal] = useState(false);
  const [curlInput, setCurlInput] = useState('');
  const [curlParsing, setCurlParsing] = useState(false);
  const [curlError, setCurlError] = useState(null);

  // Path parameters state
  const [pathParams, setPathParams] = useState(tool?.config?.path_params || {});

  // Live Test State
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showRawTestOutput, setShowRawTestOutput] = useState(false);
  const [testInputs, setTestInputs] = useState(() => ({
    order_id: 'ORD-8821',
    test_value: '9876543210',
    spoken_value: '+91 98765-43210',
    reference_value: '+91 98765 43210',
    ...testVariables
  }));

  // Detect path parameters {token} or {{token}} in URL path portion only (before query or hash)
  const detectedPathTokens = useMemo(() => {
    const rawUrl = (config.url || '').split('?')[0].split('#')[0];
    const matches = rawUrl.match(/\{+([a-zA-Z0-9_\-.]+)\}+/g) || [];
    return [...new Set(matches.map(m => m.replace(/^\{+|\}+$/g, '')))];
  }, [config.url]);

  // Detected fields from test response JSON
  const detectedResponseFields = useMemo(() => {
    if (!testResult || !testResult.response_data || typeof testResult.response_data !== 'object') {
      return [];
    }
    return extractJsonKeys(testResult.response_data).slice(0, 12);
  }, [testResult]);

  // Sync state on tool change or drawer open to avoid cross-tool state leakage
  useEffect(() => {
    if (isOpen && tool) {
      setName(tool.name || meta.defaultName);
      setDescription(tool.description || meta.defaultDesc);
      setRunTiming(tool.run_timing || 'conversation');
      setRunMode(resolveInitialRunMode(tool));
      setIsActive(tool.is_active !== false);
      const toolTimeout = tool.timeout_seconds || tool.config?.timeout_seconds || 10;
      setTimeoutSeconds(toolTimeout);
      const toolFallback = tool.fallback_response || tool.config?.fallback_response || tool.config?.spoken_responses?.on_error || tool.config?.spoken_on_error || "I'm having trouble retrieving that information right now. Let's proceed.";
      setFallbackResponse(toolFallback);
      setConfig(tool.config || {});
      setResponseTemplate(
        tool.config?.response_template || (tool.config?.response_mapping && tool.config.response_mapping.length > 0 
          ? tool.config.response_mapping.map(m => `@${m.path}`).join(', ')
          : '')
      );
      setInputSource(tool.config?.input_source || 'fixed_value');
      setInputValue(tool.config?.input_value || '');
      setInputVariable(tool.config?.input_variable || 'lead.phone');
      setNormalizeAs(tool.config?.normalize_as || tool.config?.normalization || 'none');
      setMatchMode(tool.config?.match_mode || 'exact_match');
      const initialN = parseInt(tool.config?.match_n, 10);
      setMatchN(isNaN(initialN) || initialN <= 0 ? 4 : Math.min(initialN, 100));
      setReferenceSource(tool.config?.reference_source || 'fixed_value');
      setReferenceValue(tool.config?.reference_value || '');
      setSpokenOnMatch(
        tool.config?.spoken_responses?.on_match ?? tool.config?.spoken_on_match ?? 'Thanks — that matches our records on file.'
      );
      setSpokenOnNoMatch(
        tool.config?.spoken_responses?.on_no_match ?? tool.config?.spoken_on_mismatch ?? "That doesn't match what we have on record. Could you please double-check?"
      );
      setSpokenOnError(
        tool.config?.spoken_responses?.on_error ?? tool.config?.spoken_on_error ?? toolFallback
      );
      setPathParams(tool.config?.path_params || {});
      setTestResult(null);
      setActiveSubtab('Path');
      setShowAdvancedSettings(false);
      setShowRawTestOutput(false);
      setShowCurlModal(false);
      setCurlError(null);
      setCurlInput('');
      setCurlParsing(false);
      setIsTesting(false);
      setIsImproving(false);
      setTestVerifierInput('3210');
      setTestVerifierRef('+91 98765 43210');
      setTestInputs({
        order_id: 'ORD-8821',
        test_value: '9876543210',
        spoken_value: '+91 98765-43210',
        reference_value: '+91 98765 43210',
        ...testVariables
      });
    }
  }, [tool, isOpen]);

  // Keyboard shortcut listener for Esc
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showCurlModal) {
          setShowCurlModal(false);
          setCurlError(null);
        } else if (isOpen) {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showCurlModal, onClose]);

  const updateConfig = useCallback((key, val) => {
    setConfig(prev => ({ ...prev, [key]: val }));
  }, []);

  const batchUpdateConfig = useCallback((updates) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  // Sparkle / Sage Improve Description Action
  const handleImproveDescription = useCallback(async () => {
    setIsImproving(true);
    const trimmedDesc = description.trim();
    const trimmedName = name.trim();

    try {
      const token = localStorage.getItem('token');
      const prompt = `Rewrite this voice agent tool description in 1-2 clear, concise sentences for LLM tool calling. Explain what it does and when to call it.\nTool: ${trimmedName}\nDescription: ${trimmedDesc}`;

      const res = await fetch(`${window.APP_API_BASE || ''}/api/pearl/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ message: prompt })
      });

      if (res.ok) {
        const data = await res.json();
        const aiReply = (data.response || data.message || '').trim().replace(/^["']|["']$/g, '');
        if (aiReply && aiReply.length > 10) {
          setDescription(aiReply);
          setIsImproving(false);
          return;
        }
      }
    } catch (e) {
      // Fallback to deterministic prompt improver
    }

    const n = trimmedName.toLowerCase();
    let enhanced = '';
    if (n.includes('order') || n.includes('status') || n.includes('track')) {
      enhanced = 'Retrieves real-time order status, fulfillment stage, and estimated delivery timeline for the customer.';
    } else if (n.includes('book') || n.includes('calendar') || n.includes('schedule') || n.includes('appointment')) {
      enhanced = 'Checks calendar slot availability and schedules a confirmed appointment for the requested date and time.';
    } else if (n.includes('phone') || n.includes('mobile')) {
      enhanced = 'Validates that the caller provided a valid 10-digit Indian mobile number before proceeding.';
    } else if (n.includes('verify') || n.includes('identity')) {
      enhanced = 'Matches spoken customer details against lead records on file to authenticate identity.';
    } else if (n.includes('cancel') || n.includes('refund')) {
      enhanced = 'Processes cancellation or refund requests for an existing order or booking in the backend system.';
    } else if (trimmedDesc) {
      enhanced = `${trimmedDesc.charAt(0).toUpperCase() + trimmedDesc.slice(1).replace(/\.$/, '')}. The agent calls this tool when the prospect inquires about this action.`;
    } else {
      enhanced = 'Calls external endpoint to fetch or update details, bringing retrieved data into conversational turns.';
    }

    setDescription(enhanced);
    setIsImproving(false);
  }, [description, name]);

  // cURL Parser
  const handleParseCurl = useCallback(async () => {
    if (!curlInput.trim()) {
      setCurlError('Please paste a cURL command to import.');
      return;
    }
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

      if (res.ok) {
        const parsed = await res.json();
        const d = parsed.data || parsed;
        if (d && (d.url || d.method)) {
          if (!d.url) {
            setCurlError('No valid endpoint URL found in the cURL command.');
            setCurlParsing(false);
            return;
          }
          batchUpdateConfig({
            method: d.method || 'GET',
            url: d.url || '',
            headers: Array.isArray(d.headers) ? d.headers : (d.headers && typeof d.headers === 'object') ? Object.entries(d.headers).map(([k, v]) => ({ key: k, value: String(v), enabled: true })) : [],
            params: Array.isArray(d.params) ? d.params : (d.params && typeof d.params === 'object') ? Object.entries(d.params).map(([k, v]) => ({ key: k, value: String(v), enabled: true })) : [],
            auth: d.auth || { type: 'none' },
            body: d.body ? { type: d.body_type || 'json', content: typeof d.body === 'string' ? d.body : JSON.stringify(d.body, null, 2) } : { type: 'json', content: '' }
          });
          setShowCurlModal(false);
          setCurlInput('');
          setCurlError(null);
          return;
        }
      }
      throw new Error('Failed to parse cURL command');
    } catch (err) {
      // Local regex parser fallback
      try {
        const raw = curlInput.trim();
        let m = 'GET';
        if (raw.includes('-X POST') || raw.includes('--request POST') || raw.includes('-d ') || raw.includes('--data')) m = 'POST';
        else if (raw.includes('-X PUT') || raw.includes('--request PUT')) m = 'PUT';
        else if (raw.includes('-X DELETE') || raw.includes('--request DELETE')) m = 'DELETE';
        else if (raw.includes('-X PATCH') || raw.includes('--request PATCH')) m = 'PATCH';

        const urlMatch = raw.match(/https?:\/\/[^\s"']+/);
        if (urlMatch) {
          batchUpdateConfig({ method: m, url: urlMatch[0] });
          setShowCurlModal(false);
          setCurlInput('');
          setCurlError(null);
          return;
        }
      } catch (clientErr) {
        // ignore
      }
      setCurlError(err.message || 'Unable to parse cURL command');
    } finally {
      setCurlParsing(false);
    }
  }, [curlInput, batchUpdateConfig]);

  // Live Test Handler (▷ Send or Test Verifier)
  const handleRunLiveTest = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);

    const finalTimeout = parseInt(timeoutSeconds, 10) || 10;
    const finalFallback = (fallbackResponse || '').trim();
    const isVerifier = toolType === 'data_verifier';
    const parsedN = parseInt(matchN, 10);
    const safeMatchN = isNaN(parsedN) || parsedN <= 0 ? 4 : Math.min(parsedN, 100);

    const mergedConfig = {
      ...config,
      ...(isVerifier ? {
        input_source: inputSource,
        input_value: inputSource === 'fixed_value' ? inputValue : '',
        input_variable: inputSource === 'agent_variable' ? inputVariable : '',
        normalize_as: normalizeAs,
        normalization: normalizeAs,
        match_mode: matchMode,
        match_n: safeMatchN,
        reference_source: referenceSource,
        reference_value: referenceValue,
        spoken_responses: {
          on_match: spokenOnMatch,
          on_no_match: spokenOnNoMatch,
          on_error: spokenOnError
        },
        spoken_on_match: spokenOnMatch,
        spoken_on_mismatch: spokenOnNoMatch,
        spoken_on_error: spokenOnError
      } : {
        url: (config.url || '').trim(),
        path_params: pathParams,
        response_template: responseTemplate
      }),
      timeout_seconds: finalTimeout,
      fallback_response: isVerifier ? (spokenOnError || finalFallback) : finalFallback
    };

    let testInputPayload = {
      ...testInputs,
      ...pathParams
    };

    if (isVerifier) {
      const activeTestSpoken = (inputSource === 'fixed_value' ? (inputValue || testVerifierInput) : testVerifierInput) || '3210';
      const activeTestRef = (referenceSource === 'fixed_value' ? (referenceValue || testVerifierRef) : testVerifierRef) || '+91 98765 43210';

      testInputPayload.spoken_value = activeTestSpoken;
      testInputPayload.reference_value = activeTestRef;
      testInputPayload.input_value = activeTestSpoken;

      if (inputSource === 'agent_variable' && inputVariable) {
        testInputPayload[inputVariable] = activeTestSpoken;
        if (inputVariable.includes('.')) {
          const parts = inputVariable.split('.');
          let curr = testInputPayload;
          for (let p = 0; p < parts.length - 1; p++) {
            curr[parts[p]] = curr[parts[p]] || {};
            curr = curr[parts[p]];
          }
          curr[parts[parts.length - 1]] = activeTestSpoken;
        }
      }

      if (referenceSource === 'agent_variable' && referenceValue) {
        testInputPayload[referenceValue] = activeTestRef;
        if (referenceValue.includes('.')) {
          const parts = referenceValue.split('.');
          let curr = testInputPayload;
          for (let p = 0; p < parts.length - 1; p++) {
            curr[parts[p]] = curr[parts[p]] || {};
            curr = curr[parts[p]];
          }
          curr[parts[parts.length - 1]] = activeTestRef;
        }
      }
    }

    const payload = {
      tool_id: tool?.id || null,
      tool_type: toolType,
      config: mergedConfig,
      test_input: testInputPayload,
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
      const errData = await res.json().catch(() => null);
      throw new Error(errData?.detail || `Server returned ${res.status}`);
    } catch (err) {
      setTestResult({
        success: false,
        status_code: 500,
        latency_ms: 24,
        error: `Test execution failed: ${err.message || 'Endpoint unreachable'}`
      });
    } finally {
      setIsTesting(false);
    }
  }, [
    timeoutSeconds, fallbackResponse, toolType, matchN, config, inputSource,
    inputValue, inputVariable, normalizeAs, matchMode, referenceSource,
    referenceValue, spokenOnMatch, spokenOnNoMatch, spokenOnError,
    pathParams, responseTemplate, testInputs, testVerifierInput, testVerifierRef,
    tool?.id, agentId
  ]);

  // Helper to append/insert field into response template
  const insertFieldIntoTemplate = useCallback((fieldName) => {
    const token = `@${fieldName}`;
    if (!responseTemplate.trim()) {
      setResponseTemplate(`The response is ${token}`);
    } else if (!responseTemplate.includes(token)) {
      setResponseTemplate(prev => `${prev} ${token}`);
    }
  }, [responseTemplate]);

  // Submit Save
  const handleSave = useCallback(() => {
    if (!name.trim()) {
      alert('Please enter a tool name');
      return;
    }

    const isVerifier = toolType === 'data_verifier';
    if (isVerifier && !referenceValue.trim()) {
      alert('Please specify a reference record or variable (e.g. lead.phone) to verify against.');
      return;
    }

    const finalTimeout = parseInt(timeoutSeconds, 10) || 10;
    const finalFallback = (fallbackResponse || '').trim();
    const parsedN = parseInt(matchN, 10);
    const safeMatchN = isNaN(parsedN) || parsedN <= 0 ? 4 : Math.min(parsedN, 100);

    // Parse all @tokens from responseTemplate to maintain backwards-compatible response_mapping
    const detectedTokens = [
      ...new Set(
        (responseTemplate.match(/@([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)/g) || []).map(t => t.slice(1))
      )
    ];

    const generatedMapping = detectedTokens.map(token => ({
      path: token,
      variable: token.replace(/\./g, '_'),
      description: `Extracted from API response @${token}`
    }));

    const finalConfig = {
      ...config,
      ...(isVerifier ? {
        input_source: inputSource,
        input_value: inputSource === 'fixed_value' ? inputValue : '',
        input_variable: inputSource === 'agent_variable' ? inputVariable : '',
        normalize_as: normalizeAs,
        normalization: normalizeAs,
        match_mode: matchMode,
        match_n: safeMatchN,
        reference_source: referenceSource,
        reference_value: referenceValue,
        spoken_responses: {
          on_match: spokenOnMatch,
          on_no_match: spokenOnNoMatch,
          on_error: spokenOnError
        },
        spoken_on_match: spokenOnMatch,
        spoken_on_mismatch: spokenOnNoMatch,
        spoken_on_error: spokenOnError
      } : {
        path_params: pathParams,
        response_template: responseTemplate,
        response_mapping: generatedMapping.length > 0 ? generatedMapping : (config.response_mapping || [])
      }),
      timeout_seconds: finalTimeout,
      fallback_response: isVerifier ? (spokenOnError || finalFallback) : finalFallback,
      run_mode: runMode,
      is_read_tool: runMode === 'read',
      is_async_write: runMode === 'write'
    };

    const payload = {
      id: tool?.id,
      name: name.trim(),
      tool_type: toolType,
      description: description.trim(),
      run_timing: runTiming,
      run_mode: runMode,
      is_read_tool: runMode === 'read',
      is_async_write: runMode === 'write',
      timeout_seconds: finalTimeout,
      fallback_response: isVerifier ? (spokenOnError || finalFallback) : finalFallback,
      config: finalConfig,
      is_active: isActive
    };

    onSaveTool(payload);
  }, [
    name, toolType, referenceValue, timeoutSeconds, fallbackResponse,
    matchN, responseTemplate, config, inputSource, inputValue, inputVariable,
    normalizeAs, matchMode, referenceSource, spokenOnMatch, spokenOnNoMatch,
    spokenOnError, pathParams, tool?.id, description, runTiming, runMode, isActive, onSaveTool
  ]);

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 2 RENDERS
  // ──────────────────────────────────────────────────────────────────────────

  const renderApiToolForm = () => {
    const method = config.method || 'POST';
    const url = config.url || '';
    const params = config.params || [];
    const headers = config.headers || [];
    const auth = config.auth || { type: 'none' };
    const bodyObj = typeof config.body === 'object' && config.body !== null 
      ? config.body 
      : { type: 'json', content: typeof config.body === 'string' ? config.body : '{\n  "order_id": "{{order_id}}"\n}' };

    return (
      <div>
        {/* Main API Card Container */}
        <div className="api-setup-card">
          {/* Top Endpoint Row: Method + URL + Send Button */}
          <div className="api-endpoint-row">
            <div className="method-select-wrap">
              <select 
                className="method-select-clean"
                value={method}
                onChange={(e) => updateConfig('method', e.target.value)}
              >
                <option value="POST">POST</option>
                <option value="GET">GET</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
                <option value="PATCH">PATCH</option>
              </select>
              <ChevronDown size={14} className="method-select-chevron" />
            </div>

            <input 
              type="text" 
              className="api-url-input-clean"
              placeholder="https://api.example.com/v1/send"
              value={url}
              onChange={(e) => updateConfig('url', e.target.value)}
            />

            <button 
              type="button" 
              className="btn-send-pill"
              onClick={handleRunLiveTest}
              disabled={isTesting}
            >
              {isTesting ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <Play size={12} fill="currentColor" strokeWidth={0} />
              )}
              <span>{isTesting ? 'Sending...' : 'Send'}</span>
            </button>
          </div>

          {/* Subtabs Bar: Path | Params | Headers | Auth | Body */}
          <div className="api-subtabs-bar">
            {['Path', 'Params', 'Headers', 'Auth', 'Body'].map(tab => (
              <button 
                key={tab}
                type="button" 
                className={`api-subtab-btn ${activeSubtab === tab ? 'active' : ''}`}
                onClick={() => setActiveSubtab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Subtab Content Area */}
          <div className="api-subtab-content">
            {activeSubtab === 'Path' && (
              <div>
                {detectedPathTokens.length === 0 ? (
                  <div className="path-empty-hint">
                    Put a {`{token}`} in the URL above to create a path parameter.
                  </div>
                ) : (
                  <div>
                    <div className="table-header-flex">
                      <span className="table-header-title">Detected Path Parameters</span>
                    </div>
                    <div className="clean-mapping-table">
                      {detectedPathTokens.map(token => (
                        <div key={token} className="mapping-row">
                          <span className="code-input" style={{ width: 120, fontWeight: 600, color: '#111' }}>
                            {`{${token}}`}
                          </span>
                          <input 
                            type="text" 
                            className="drawer-input code-input"
                            placeholder={`Test value for ${token}`}
                            value={pathParams[token] || ''}
                            onChange={(e) => setPathParams(prev => ({ ...prev, [token]: e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeSubtab === 'Params' && (
              <div>
                <div className="table-header-flex">
                  <span className="table-header-title">Query Parameters</span>
                  <button 
                    type="button" 
                    className="btn-add-table-row"
                    onClick={() => updateConfig('params', [...params, { key: '', value: '', enabled: true }])}
                  >
                    <Plus size={13} /> Add Param
                  </button>
                </div>
                {params.length === 0 ? (
                  <div className="path-empty-hint">No query parameters configured. Click "+ Add Param" to add one.</div>
                ) : (
                  <div className="clean-mapping-table">
                    {params.map((p, idx) => (
                      <div key={idx} className="mapping-row">
                        <input 
                          type="text" 
                          placeholder="Key" 
                          className="drawer-input code-input"
                          value={p.key || ''} 
                          onChange={(e) => {
                            const copy = [...params];
                            copy[idx] = { ...copy[idx], key: e.target.value };
                            updateConfig('params', copy);
                          }}
                        />
                        <input 
                          type="text" 
                          placeholder="Value" 
                          className="drawer-input code-input"
                          value={p.value || ''} 
                          onChange={(e) => {
                            const copy = [...params];
                            copy[idx] = { ...copy[idx], value: e.target.value };
                            updateConfig('params', copy);
                          }}
                        />
                        <button 
                          type="button" 
                          className="btn-delete-row"
                          onClick={() => updateConfig('params', params.filter((_, i) => i !== idx))}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeSubtab === 'Headers' && (
              <div>
                <div className="table-header-flex">
                  <span className="table-header-title">Request Headers</span>
                  <button 
                    type="button" 
                    className="btn-add-table-row"
                    onClick={() => updateConfig('headers', [...headers, { key: '', value: '', enabled: true }])}
                  >
                    <Plus size={13} /> Add Header
                  </button>
                </div>
                {headers.length === 0 ? (
                  <div className="path-empty-hint">No custom headers configured. Click "+ Add Header" to add.</div>
                ) : (
                  <div className="clean-mapping-table">
                    {headers.map((h, idx) => (
                      <div key={idx} className="mapping-row">
                        <input 
                          type="text" 
                          placeholder="Header (e.g. Authorization)" 
                          className="drawer-input code-input"
                          value={h.key || ''} 
                          onChange={(e) => {
                            const copy = [...headers];
                            copy[idx] = { ...copy[idx], key: e.target.value };
                            updateConfig('headers', copy);
                          }}
                        />
                        <input 
                          type="text" 
                          placeholder="Value" 
                          className="drawer-input code-input"
                          value={h.value || ''} 
                          onChange={(e) => {
                            const copy = [...headers];
                            copy[idx] = { ...copy[idx], value: e.target.value };
                            updateConfig('headers', copy);
                          }}
                        />
                        <button 
                          type="button" 
                          className="btn-delete-row"
                          onClick={() => updateConfig('headers', headers.filter((_, i) => i !== idx))}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeSubtab === 'Auth' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label className="drawer-field-label">Authentication Type</label>
                  <select 
                    className="drawer-select-clean"
                    value={auth.type || 'none'}
                    onChange={(e) => updateConfig('auth', { ...auth, type: e.target.value })}
                  >
                    <option value="none">No Auth</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="apiKey">API Key (Header)</option>
                    <option value="basic">Basic Auth</option>
                  </select>
                </div>

                {auth.type === 'bearer' && (
                  <div>
                    <label className="drawer-field-label">Bearer Token</label>
                    <input 
                      type="text" 
                      className="drawer-input code-input"
                      placeholder="sk_test_..."
                      value={auth.token || ''}
                      onChange={(e) => updateConfig('auth', { ...auth, token: e.target.value })}
                    />
                  </div>
                )}

                {auth.type === 'apiKey' && (
                  <div className="two-col-clean-grid">
                    <div>
                      <label className="drawer-field-label">Header Name</label>
                      <input 
                        type="text" 
                        className="drawer-input code-input"
                        placeholder="X-API-Key"
                        value={auth.headerName || 'X-API-Key'}
                        onChange={(e) => updateConfig('auth', { ...auth, headerName: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="drawer-field-label">Key Value</label>
                      <input 
                        type="text" 
                        className="drawer-input code-input"
                        placeholder="api_key_..."
                        value={auth.apiKey || ''}
                        onChange={(e) => updateConfig('auth', { ...auth, apiKey: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                {auth.type === 'basic' && (
                  <div className="two-col-clean-grid">
                    <div>
                      <label className="drawer-field-label">Username</label>
                      <input 
                        type="text" 
                        className="drawer-input"
                        placeholder="admin"
                        value={auth.username || ''}
                        onChange={(e) => updateConfig('auth', { ...auth, username: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="drawer-field-label">Password</label>
                      <input 
                        type="password" 
                        className="drawer-input"
                        placeholder="••••••••"
                        value={auth.password || ''}
                        onChange={(e) => updateConfig('auth', { ...auth, password: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeSubtab === 'Body' && (
              <div>
                <label className="drawer-field-label">JSON Request Body</label>
                <textarea 
                  rows={5}
                  className="drawer-textarea code-input"
                  value={bodyObj.content || ''}
                  onChange={(e) => updateConfig('body', { ...bodyObj, content: e.target.value })}
                  placeholder={'{\n  "order_id": "{{order_id}}"\n}'}
                />
              </div>
            )}
          </div>
        </div>

        {/* cURL command auto-fill link */}
        <div className="curl-link-row">
          <span>Have a cURL command?</span>
          <button 
            type="button" 
            className="btn-curl-link"
            onClick={() => setShowCurlModal(true)}
          >
            Paste it to auto-fill the form →
          </button>
        </div>

        {/* Live Test Result Banner */}
        {testResult && (
          <div className="inline-test-feedback">
            <div className="test-badge-row">
              <span className={`status-badge ${testResult.success ? 'success' : 'error'}`}>
                {testResult.success 
                  ? `${testResult.status_code || 200} OK • ${testResult.latency_ms || 18} ms` 
                  : `Failed • ${testResult.status_code || 500}`}
              </span>
              <button 
                type="button" 
                className="btn-toggle-raw"
                style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '0.78rem' }}
                onClick={() => setShowRawTestOutput(prev => !prev)}
              >
                {showRawTestOutput ? 'Hide raw JSON' : 'View response JSON'}
              </button>
            </div>

            {testResult.error && (
              <div style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: 4 }}>
                {testResult.error}
              </div>
            )}

            {testResult.spoken_feedback && (
              <div style={{ fontSize: '0.82rem', color: '#1f2937', marginTop: 4, fontStyle: 'italic' }}>
                Voice Output: "{testResult.spoken_feedback}"
              </div>
            )}

            {detectedResponseFields.length > 0 && (
              <div className="test-fields-chips">
                <span className="chips-label">Available response fields (click to insert into Step 3):</span>
                <div className="chips-list">
                  {detectedResponseFields.map(f => (
                    <button 
                      key={f}
                      type="button"
                      className="chip-token-btn"
                      onClick={() => insertFieldIntoTemplate(f)}
                    >
                      @{f}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {showRawTestOutput && testResult.response_data && (
              <pre className="test-raw-pre" style={{ marginTop: 8 }}>
                {JSON.stringify(testResult.response_data, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderDataValidatorForm = () => {
    const preset = config.preset || 'indian_phone';
    const customRegex = config.regex_pattern || '';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="drawer-field-block">
          <label className="drawer-field-label">Validation Type</label>
          <div className="clean-preset-grid">
            {PRESETS.map(pr => (
              <button 
                key={pr.id}
                type="button" 
                className={`clean-preset-card ${preset === pr.id ? 'active' : ''}`}
                onClick={() => {
                  updateConfig('preset', pr.id);
                  if (pr.id !== 'custom') updateConfig('regex_pattern', pr.pattern);
                }}
              >
                <div className="preset-card-title">{pr.label}</div>
                <div className="preset-card-example">e.g. {pr.example}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="drawer-field-block">
          <label className="drawer-field-label">Spoken confirmation when valid</label>
          <input 
            type="text" 
            className="drawer-input"
            placeholder="Got it, that looks like a valid 10-digit mobile number."
            value={config.spoken_on_success || ''}
            onChange={(e) => updateConfig('spoken_on_success', e.target.value)}
          />
        </div>

        <div className="drawer-field-block">
          <label className="drawer-field-label">Spoken reprompt if invalid</label>
          <input 
            type="text" 
            className="drawer-input"
            placeholder="That doesn't seem to be a valid 10-digit number. Could you please repeat it?"
            value={config.spoken_on_fail || ''}
            onChange={(e) => updateConfig('spoken_on_fail', e.target.value)}
          />
        </div>

        {preset === 'custom' && (
          <div className="drawer-field-block">
            <label className="drawer-field-label">Custom Regular Expression Pattern</label>
            <input 
              type="text" 
              className="drawer-input code-input"
              placeholder="^[A-Z0-9]{8}$"
              value={customRegex}
              onChange={(e) => updateConfig('regex_pattern', e.target.value)}
            />
          </div>
        )}
      </div>
    );
  };

  const renderDataVerifierForm = () => {
    const inputSourceOptions = [
      { value: 'fixed_value', label: 'Fixed value', icon: Type },
      { value: 'agent_variable', label: 'Agent variable', icon: Braces },
      { value: 'let_agent_decide', label: 'Let the agent decide', icon: Sparkles }
    ];

    const normalizeOptions = [
      { value: 'none', label: 'None', icon: Type },
      { value: 'phone', label: 'Phone', icon: Phone },
      { value: 'date', label: 'Date', icon: Calendar },
      { value: 'text', label: 'Text', icon: Type }
    ];

    const matchModeOptions = [
      { value: 'exact_match', label: 'Exact match', icon: Check },
      { value: 'last_n', label: 'Last N characters', icon: Type },
      { value: 'first_n', label: 'First N characters', icon: Type },
      { value: 'contains', label: 'Contains', icon: AiBadgeIcon },
      { value: 'date_equals', label: 'Date equals', icon: Calendar }
    ];

    const referenceSourceOptions = [
      { value: 'fixed_value', label: 'Fixed value', icon: Type },
      { value: 'agent_variable', label: 'Agent variable', icon: Braces }
    ];

    return (
      <div className="verifier-form-container">
        {/* (2) Verification rules: Input source dropdown */}
        <CleanDropdown
          label="Input source"
          helper="Select where the verification value originates during the live interaction."
          options={inputSourceOptions}
          value={inputSource}
          onChange={(val) => setInputSource(val)}
        />

        {/* Conditional Input Source field */}
        {inputSource === 'fixed_value' && (
          <div className="drawer-field-block">
            <label className="drawer-field-label">Fixed value</label>
            <input
              type="text"
              className="drawer-input"
              placeholder="e.g. 560001"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
          </div>
        )}

        {inputSource === 'agent_variable' && (
          <div className="drawer-field-block">
            <label className="drawer-field-label">Agent variable</label>
            <input
              type="text"
              className="drawer-input code-input"
              placeholder="e.g. lead.phone"
              value={inputVariable}
              onChange={(e) => setInputVariable(e.target.value)}
            />
            <p className="drawer-field-hint">Variable from conversation memory to verify against records.</p>
          </div>
        )}

        {inputSource === 'let_agent_decide' && (
          <div className="verifier-agent-decide-box">
            <Sparkles size={15} style={{ color: '#000000', flexShrink: 0 }} />
            <span>Pearl dynamically listens and extracts this value from the caller's spoken dialogue during the conversation.</span>
          </div>
        )}

        {/* Normalize as dropdown */}
        <CleanDropdown
          label="Normalize as"
          helper="Standardize both values before matching (e.g. strip phone formatting and country codes)."
          options={normalizeOptions}
          value={normalizeAs}
          onChange={(val) => setNormalizeAs(val)}
        />

        {/* Match mode dropdown */}
        <CleanDropdown
          label="Match mode"
          options={matchModeOptions}
          value={matchMode}
          onChange={(val) => setMatchMode(val)}
        />

        {/* If Last N or First N is selected */}
        {(matchMode === 'last_n' || matchMode === 'first_n') && (
          <div className="drawer-field-block">
            <label className="drawer-field-label">Number of characters (N)</label>
            <input
              type="number"
              min={1}
              max={50}
              className="drawer-input code-input"
              placeholder="4"
              value={matchN}
              onChange={(e) => setMatchN(e.target.value)}
              onBlur={() => {
                const p = parseInt(matchN, 10);
                if (isNaN(p) || p <= 0) setMatchN(4);
              }}
            />
            <p className="drawer-field-hint">
              {matchMode === 'last_n' 
                ? 'Compares the trailing N characters (e.g. last 4 digits of phone or account number).'
                : 'Compares the leading N characters (e.g. first 4 digits of pincode or routing code).'}
            </p>
          </div>
        )}

        {/* Reference source dropdown */}
        <CleanDropdown
          label="Reference source"
          helper="The authoritative record on file to evaluate caller input against."
          options={referenceSourceOptions}
          value={referenceSource}
          onChange={(val) => setReferenceSource(val)}
        />

        {/* Reference value input */}
        <div className="drawer-field-block">
          <label className="drawer-field-label">Reference value</label>
          <input
            type="text"
            className={`drawer-input ${referenceSource === 'agent_variable' ? 'code-input' : ''}`}
            placeholder={referenceSource === 'fixed_value' ? 'e.g. last 4 digits on file' : 'e.g. lead.phone'}
            value={referenceValue}
            onChange={(e) => setReferenceValue(e.target.value)}
          />
          <p className="drawer-field-hint">
            {referenceSource === 'agent_variable'
              ? 'Specify the variable path containing the reference record (e.g. lead.phone).'
              : 'The static ground truth value to check against.'}
          </p>
        </div>

        {/* Live Test Sandbox Section */}
        <div className="drawer-field-block" style={{ marginTop: 6, paddingTop: 12, borderTop: '1px dashed #e5e7eb' }}>
          <label className="drawer-field-label" style={{ fontSize: '0.82rem', color: '#4b5563', marginBottom: 8 }}>
            Live Test Simulation
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <span style={{ display: 'block', fontSize: '0.74rem', color: '#6b7280', marginBottom: 4 }}>
                {inputSource === 'let_agent_decide' ? "Simulated caller speech" : inputSource === 'agent_variable' ? `Sample ${inputVariable || 'var'}` : "Test input"}
              </span>
              <input
                type="text"
                className="drawer-input"
                style={{ padding: '7px 10px', fontSize: '0.82rem' }}
                placeholder={inputSource === 'fixed_value' ? (inputValue || '560001') : '3210'}
                value={testVerifierInput}
                onChange={(e) => setTestVerifierInput(e.target.value)}
              />
            </div>
            <div>
              <span style={{ display: 'block', fontSize: '0.74rem', color: '#6b7280', marginBottom: 4 }}>
                {referenceSource === 'agent_variable' ? `Sample ${referenceValue || 'lead.phone'}` : 'Reference target'}
              </span>
              <input
                type="text"
                className="drawer-input"
                style={{ padding: '7px 10px', fontSize: '0.82rem' }}
                placeholder={referenceSource === 'fixed_value' ? (referenceValue || '560001') : '+91 98765 43210'}
                value={testVerifierRef}
                onChange={(e) => setTestVerifierRef(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
            <button
              type="button"
              className="btn-send-pill"
              style={{ width: 'auto', padding: '7px 16px' }}
              onClick={handleRunLiveTest}
              disabled={isTesting}
            >
              {isTesting ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <Play size={12} fill="currentColor" strokeWidth={0} />
              )}
              <span>{isTesting ? 'Verifying...' : 'Test verification'}</span>
            </button>
          </div>
        </div>

        {/* Inline Test Result */}
        {testResult && (
          <div className="inline-test-feedback" style={{ marginTop: 2 }}>
            <div className="test-badge-row">
              <span className={`status-badge ${testResult.is_match ? 'success' : 'error'}`}>
                {testResult.is_match
                  ? `Matched • ${testResult.latency_ms || 0} ms`
                  : `No match • ${testResult.latency_ms || 0} ms`}
              </span>
            </div>

            {testResult.spoken_feedback && (
              <div style={{ fontSize: '0.82rem', color: '#1f2937', marginTop: 4, fontStyle: 'italic' }}>
                Voice output: "{testResult.spoken_feedback}"
              </div>
            )}

            <div style={{ fontSize: '0.76rem', color: '#6b7280', marginTop: 4 }}>
              Normalized input: <code>"{testResult.normalized_spoken}"</code> | Reference: <code>"{testResult.normalized_reference}"</code>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderMockApiForm = () => {
    const rawMock = config.mock_response_body || '{\n  "status": "out_for_delivery",\n  "delivery_partner": "BlueDart Express"\n}';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="drawer-field-block">
          <label className="drawer-field-label">Simulated Return Payload (JSON)</label>
          <textarea 
            rows={5}
            className="drawer-textarea code-input"
            value={rawMock}
            onChange={(e) => updateConfig('mock_response_body', e.target.value)}
            placeholder={'{\n  "status": "delivered"\n}'}
          />
        </div>
      </div>
    );
  };

  const renderMcpForm = () => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="drawer-field-block">
          <label className="drawer-field-label">Server Connection ID / URL</label>
          <input 
            type="text" 
            className="drawer-input code-input"
            placeholder="mcp://localhost:8080/servers/sales"
            value={config.server_id || ''}
            onChange={(e) => updateConfig('server_id', e.target.value)}
          />
        </div>
        <div className="drawer-field-block">
          <label className="drawer-field-label">Tool Name on MCP Server</label>
          <input 
            type="text" 
            className="drawer-input code-input"
            placeholder="query_customer_order"
            value={config.server_tool_name || ''}
            onChange={(e) => updateConfig('server_tool_name', e.target.value)}
          />
        </div>
      </div>
    );
  };

  if (!isOpen || !tool) return null;

  return (
    <>
      <div className="tool-drawer-backdrop" onClick={onClose}>
        <div className="tool-drawer-container" onClick={(e) => e.stopPropagation()}>
          {/* Top Header */}
          <div className="tool-drawer-header">
            <div>
              <h2 className="tool-drawer-title">{meta.title}</h2>
              <p className="tool-drawer-subtitle">{meta.subtitle}</p>
            </div>
            <button 
              type="button" 
              className="drawer-close-btn"
              onClick={onClose}
              title="Close (Esc)"
            >
              <X size={18} />
            </button>
          </div>

          {/* Stepper Timeline Body */}
          <div className="tool-drawer-body">
            <div className="drawer-stepper">
              {/* STEP 1: Name & describe the tool */}
              <div className="stepper-step">
                <div className="stepper-rail">
                  <div className="stepper-circle">1</div>
                  <div className="stepper-line" />
                </div>
                <div className="stepper-content">
                  <h3 className="stepper-title">Name & describe the tool</h3>

                  <div className="drawer-field-block">
                    <label className="drawer-field-label">Tool name</label>
                    <input 
                      type="text" 
                      className="drawer-input"
                      placeholder={meta.namePlaceholder || "e.g. tool_name"}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                    <p className="drawer-field-hint">
                      {meta.nameHint || "Use lowercase letters separated by underscores without spaces."}
                    </p>
                  </div>

                  <div className="drawer-field-block">
                    <div className="drawer-field-label-row">
                      <label className="drawer-field-label">What does this tool do? *</label>
                      <button 
                        type="button" 
                        className="btn-sparkle-improve"
                        onClick={handleImproveDescription}
                        disabled={isImproving}
                        title="AI Prompt Improver"
                      >
                        <Sparkles size={13} className={isImproving ? 'animate-spin' : ''} />
                        <span>{isImproving ? 'Improving...' : 'Improve'}</span>
                      </button>
                    </div>
                    <textarea 
                      rows={3}
                      className="drawer-textarea"
                      placeholder={meta.descPlaceholder || "Describe what this tool does..."}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                    <p className="drawer-field-hint">
                      {toolType === 'data_verifier' 
                        ? "Pearl relies on this tool name and description to intelligently invoke verification during the call."
                        : "The agent uses the name and description of the tool to decide when to call it."}
                    </p>
                  </div>

                  <div className="drawer-field-block">
                    <label className="drawer-field-label">When should this tool run?</label>
                    <div className="clean-radio-group">
                      <label className="clean-radio-label">
                        <input 
                          type="radio" 
                          name="runTiming" 
                          value="call_start"
                          checked={runTiming === 'call_start'}
                          onChange={() => setRunTiming('call_start')}
                        />
                        <span>When the call starts</span>
                      </label>

                      <label className="clean-radio-label">
                        <input 
                          type="radio" 
                          name="runTiming" 
                          value="conversation"
                          checked={runTiming === 'conversation'}
                          onChange={() => setRunTiming('conversation')}
                        />
                        <span>During the conversation</span>
                      </label>

                      <label className="clean-radio-label">
                        <input 
                          type="radio" 
                          name="runTiming" 
                          value="call_end"
                          checked={runTiming === 'call_end'}
                          onChange={() => setRunTiming('call_end')}
                        />
                        <span>When the call ends</span>
                      </label>
                    </div>
                  </div>

                  <div className="drawer-field-block">
                    <label className="drawer-field-label">Tool Execution Architecture (Zero Dead Air)</label>
                    <div className="clean-radio-group">
                      <label className="clean-radio-label" style={{ alignItems: 'flex-start' }}>
                        <input 
                          type="radio" 
                          name="runMode" 
                          value="write"
                          checked={runMode === 'write'}
                          onChange={() => setRunMode('write')}
                          style={{ marginTop: 3 }}
                        />
                        <div>
                          <span style={{ fontWeight: 600, display: 'block', color: '#18181b', fontSize: '0.84rem' }}>
                            Pattern A: Action / Write Tool (Async Background Task)
                          </span>
                          <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block', marginTop: 2 }}>
                            Agent streams spoken dialogue immediately to TTS (~230ms TTFT, zero dead air). Tool executes asynchronously in background (e.g. WhatsApp, CRM, DNC, Calendar).
                          </span>
                        </div>
                      </label>

                      <label className="clean-radio-label" style={{ alignItems: 'flex-start' }}>
                        <input 
                          type="radio" 
                          name="runMode" 
                          value="read"
                          checked={runMode === 'read'}
                          onChange={() => setRunMode('read')}
                          style={{ marginTop: 3 }}
                        />
                        <div>
                          <span style={{ fontWeight: 600, display: 'block', color: '#18181b', fontSize: '0.84rem' }}>
                            Pattern B: Lookup / Read Tool (Conversational Filler)
                          </span>
                          <span style={{ fontSize: '0.74rem', color: '#64748b', display: 'block', marginTop: 2 }}>
                            Plays natural Hinglish filler (e.g. "Ek second rukiye, main check kar leti hoon...") to eliminate dead air while parallel API fetches live data before agent speaks verified answer.
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              {/* STEP 2: Set up the API call */}
              <div className="stepper-step">
                <div className="stepper-rail">
                  <div className="stepper-circle">2</div>
                  <div className="stepper-line" />
                </div>
                <div className="stepper-content">
                  <h3 className="stepper-title">{meta.step2Title}</h3>

                  {toolType === 'api_tool' && renderApiToolForm()}
                  {toolType === 'data_validator' && renderDataValidatorForm()}
                  {toolType === 'data_verifier' && renderDataVerifierForm()}
                  {toolType === 'mock_api' && renderMockApiForm()}
                  {toolType === 'mcp' && renderMcpForm()}
                </div>
              </div>

              {/* STEP 3: Send fields from the API response to the agent */}
              <div className="stepper-step">
                <div className="stepper-rail">
                  <div className="stepper-circle">3</div>
                </div>
                <div className="stepper-content">
                  <h3 className="stepper-title">{meta.step3Title}</h3>

                  {toolType === 'data_verifier' ? (
                    <div>
                      <p className="stepper-subtitle-hint">
                        Configurable dialogue responses Pearl delivers after verification. Leave blank to let the agent prompt respond autonomously.
                      </p>

                      <div className="drawer-field-block">
                        <label className="drawer-field-label">On match</label>
                        <textarea 
                          rows={2}
                          className="drawer-textarea"
                          placeholder="e.g. Thanks — that matches our records on file."
                          value={spokenOnMatch}
                          onChange={(e) => setSpokenOnMatch(e.target.value)}
                        />
                      </div>

                      <div className="drawer-field-block">
                        <label className="drawer-field-label">On no match</label>
                        <textarea 
                          rows={2}
                          className="drawer-textarea"
                          placeholder="e.g. That doesn't match what we have on record. Could you please double-check?"
                          value={spokenOnNoMatch}
                          onChange={(e) => setSpokenOnNoMatch(e.target.value)}
                        />
                      </div>

                      <div className="drawer-field-block">
                        <label className="drawer-field-label">On error</label>
                        <textarea 
                          rows={2}
                          className="drawer-textarea"
                          placeholder="e.g. I'm experiencing an issue checking those details right now. Let's try again in a moment."
                          value={spokenOnError}
                          onChange={(e) => {
                            setSpokenOnError(e.target.value);
                            setFallbackResponse(e.target.value);
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="drawer-field-block">
                      <textarea 
                        rows={3}
                        className="drawer-textarea field-response-textarea"
                        placeholder="Type @ to insert a field, like 'The account balance is @balance.'"
                        value={responseTemplate}
                        onChange={(e) => setResponseTemplate(e.target.value)}
                      />
                      <p className="drawer-field-hint">
                        Type @ to insert a field from the API response.
                      </p>

                      {detectedResponseFields.length > 0 && (
                        <div className="test-fields-chips" style={{ marginTop: 10 }}>
                          <span className="chips-label">Insert response field:</span>
                          <div className="chips-list">
                            {detectedResponseFields.map(f => (
                              <button 
                                key={f}
                                type="button" 
                                className="chip-token-btn"
                                onClick={() => insertFieldIntoTemplate(f)}
                              >
                                @{f}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Advanced Clean Accordion */}
            <div className="advanced-clean-card">
              <button 
                type="button" 
                className="advanced-clean-header"
                onClick={() => setShowAdvancedSettings(prev => !prev)}
              >
                <span>Advanced</span>
                <ChevronDown 
                  size={16} 
                  className={`advanced-clean-chevron ${showAdvancedSettings ? 'open' : ''}`} 
                />
              </button>

              {showAdvancedSettings && (
                <div className="advanced-clean-body">
                  <div className="drawer-field-block">
                    <div className="table-header-flex">
                      <label className="drawer-field-label">Timeout (Seconds)</label>
                      <span className="code-input" style={{ fontSize: '0.8rem', color: '#111', fontWeight: 600 }}>
                        {timeoutSeconds}s
                      </span>
                    </div>
                    <input 
                      type="range" 
                      min={2} 
                      max={30} 
                      step={1}
                      style={{ width: '100%', accentColor: '#000000', cursor: 'pointer' }}
                      value={timeoutSeconds}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setTimeoutSeconds(val);
                        updateConfig('timeout_seconds', val);
                      }}
                    />
                    <p className="drawer-field-hint">
                      If the endpoint does not respond within {timeoutSeconds}s, the agent delivers the fallback response.
                    </p>
                  </div>

                  <div className="drawer-field-block">
                    <label className="drawer-field-label">Fallback spoken line</label>
                    <textarea 
                      rows={2}
                      className="drawer-textarea"
                      placeholder="I'm having trouble retrieving that information right now. Let's proceed."
                      value={fallbackResponse}
                      onChange={(e) => {
                        setFallbackResponse(e.target.value);
                        if (toolType === 'data_verifier') {
                          setSpokenOnError(e.target.value);
                        }
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sticky Drawer Footer */}
          <div className="tool-drawer-footer">
            <div className="footer-left">
              {tool?.id && onDeleteTool && (
                <button 
                  type="button" 
                  className="btn-footer-delete"
                  onClick={() => {
                    if (window.confirm(`Delete the "${name}" tool?`)) {
                      onDeleteTool(tool.id);
                    }
                  }}
                >
                  <Trash2 size={13} />
                  <span>Delete</span>
                </button>
              )}
            </div>

            <div className="footer-right">
              <button 
                type="button" 
                className="btn-footer-cancel"
                onClick={onClose}
              >
                Cancel
              </button>
              <button 
                type="button" 
                className="btn-footer-save"
                onClick={handleSave}
              >
                <span>{tool?.id ? 'Save changes' : 'Add tool'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* cURL Import Modal */}
      {showCurlModal && (
        <div className="curl-modal-backdrop" onClick={() => { setShowCurlModal(false); setCurlError(null); }}>
          <div className="curl-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="curl-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Code2 size={16} />
                <h4 style={{ margin: 0, fontSize: '0.94rem', fontWeight: 600 }}>Import from cURL Command</h4>
              </div>
              <button 
                type="button" 
                className="drawer-close-btn" 
                onClick={() => { setShowCurlModal(false); setCurlError(null); }}
              >
                <X size={15} />
              </button>
            </div>

            <div className="curl-modal-body">
              <p style={{ margin: '0 0 10px 0', fontSize: '0.82rem', color: '#6b7280' }}>
                Paste any standard cURL command. Clozflow will extract the URL, HTTP method, headers, parameters, and payload body.
              </p>
              <textarea 
                rows={6}
                className="drawer-textarea code-input"
                placeholder={'curl -X POST https://api.crm.io/v1/leads \\\n  -H "Authorization: Bearer my_token" \\\n  -d \'{"lead_id": "100"}\''}
                value={curlInput}
                onChange={(e) => {
                  setCurlInput(e.target.value);
                  if (curlError) setCurlError(null);
                }}
                autoFocus
              />
              {curlError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#dc2626', fontSize: '0.8rem', marginTop: 8 }}>
                  <AlertCircle size={13} />
                  <span>{curlError}</span>
                </div>
              )}
            </div>

            <div className="curl-modal-footer">
              <button 
                type="button" 
                className="btn-footer-cancel"
                onClick={() => { setShowCurlModal(false); setCurlError(null); }}
              >
                Cancel
              </button>
              <button 
                type="button" 
                className="btn-footer-save"
                disabled={curlParsing || !curlInput.trim()}
                onClick={handleParseCurl}
              >
                {curlParsing ? 'Parsing...' : 'Parse & Apply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

export default ToolDrawer;
