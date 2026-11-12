import React, { useState, useEffect, useMemo, useRef, useCallback, useId } from 'react';
import {
  X, Check,
  Play, Plus, Trash2, AlertCircle, RefreshCw, Sparkles,
  ChevronDown, Code2, Phone, Calendar, Type, Braces
} from 'lucide-react';
import { apiFetch } from '../lib/pearlApi.js';
import { useBackdropDismiss, useDialogA11y } from '../lib/a11y.js';
import {
  authForType,
  describeToolTestResult,
  initialToolConfig,
  normalizeVerifierNormalization,
  resolveInitialRunMode,
  serverToolId,
  toolFormFingerprint,
  toolTestPath,
  verifierTestConfig,
} from '../lib/toolDrawer.js';
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
    step3Title: 'Send the validation result to the agent',
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
    step3Title: 'Send fields from the MCP result to the agent',
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
          aria-label={label ? `${label}: ${selectedOption?.label || ''}` : undefined}
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

/**
 * The drawer's form. It is mounted fresh for every tool and every opening (see the keyed
 * wrapper `ToolDrawer` below), so all fields are initialised from `tool` here and no
 * re-sync effect is needed.
 */
function ToolDrawerBody({
  onClose,
  tool,
  agentId,
  onSaveTool,
  onDeleteTool,
  testVariables = {}
}) {
  const toolType = tool?.tool_type || 'api_tool';
  const toolId = tool?.id ?? null;
  const meta = ARCHETYPE_META[toolType] || ARCHETYPE_META.api_tool;
  const titleId = useId();

  // Active form state
  const [name, setName] = useState(tool?.name || meta.defaultName);
  const [description, setDescription] = useState(tool?.description ?? meta.defaultDesc);
  const [runTiming, setRunTiming] = useState(tool?.run_timing || 'conversation');
  const [runMode, setRunMode] = useState(() => resolveInitialRunMode(tool));
  const [isActive] = useState(tool?.is_active !== false);
  const [fallbackResponse, setFallbackResponse] = useState(
    tool?.fallback_response || tool?.config?.fallback_response || tool?.config?.spoken_responses?.on_error || tool?.config?.spoken_on_error || "I'm having trouble retrieving that information right now. Let's proceed."
  );
  const [timeoutSeconds, setTimeoutSeconds] = useState(tool?.timeout_seconds || tool?.config?.timeout_seconds || 10);
  const [config, setConfig] = useState(() => initialToolConfig(tool));
  const [responseTemplate, setResponseTemplate] = useState(
    tool?.config?.response_template || (tool?.config?.response_mapping && tool?.config?.response_mapping.length > 0 
      ? tool.config.response_mapping.map(m => `@${m.path}`).join(', ')
      : '')
  );

  // Data Verifier state
  const [inputSource, setInputSource] = useState(tool?.config?.input_source || 'fixed_value');
  const [inputValue, setInputValue] = useState(tool?.config?.input_value || '');
  const [inputVariable, setInputVariable] = useState(tool?.config?.input_variable || 'lead.phone');
  // Tools saved from older templates may still carry legacy values (e.g. "strip_phone_formatting");
  // they are shown as the option they behave like.
  const [normalizeAs, setNormalizeAs] = useState(() => normalizeVerifierNormalization(tool?.config?.normalize_as || tool?.config?.normalization));
  const [matchMode, setMatchMode] = useState(tool?.config?.match_mode || 'exact_match');
  const [matchN, setMatchN] = useState(() => {
    const raw = parseInt(tool?.config?.match_n, 10);
    return isNaN(raw) || raw <= 0 ? 4 : Math.min(raw, 100);
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
    () => tool?.config?.spoken_responses?.on_error ?? tool?.config?.spoken_on_error ?? fallbackResponse
  );

  // Verifier live testing inputs (editable sample values for the simulator only)
  const [testVerifierInput, setTestVerifierInput] = useState('3210');
  const [testVerifierRef, setTestVerifierRef] = useState('+91 98765 43210');

  // Subtabs for Step 2
  const [activeSubtab, setActiveSubtab] = useState('Path'); // 'Path' | 'Params' | 'Headers' | 'Auth' | 'Body'
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  // Save / delete state (the parent resolves onSaveTool / onDeleteTool with { ok, error })
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const mountedRef = useRef(false);

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
  // Test inputs = the agent's own test variables (no hidden sample values are sent).
  const [testInputs] = useState(() => ({ ...(testVariables || {}) }));

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

  // Unsaved-edit detection: compare the editable fields with their values at open.
  const formFingerprint = toolFormFingerprint({
    name, description, runTiming, runMode, config, responseTemplate,
    inputSource, inputValue, inputVariable, normalizeAs, matchMode, matchN: String(matchN),
    referenceSource, referenceValue, spokenOnMatch, spokenOnNoMatch, spokenOnError,
    fallbackResponse, timeoutSeconds: String(timeoutSeconds), pathParams
  });
  const [initialFingerprint] = useState(formFingerprint);
  const isDirty = formFingerprint !== initialFingerprint;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Backdrop, Esc, Cancel and ✕ all go through here: nothing is discarded without asking.
  const requestClose = useCallback(() => {
    if (isSaving || isDeleting) return;
    if (isDirty && !window.confirm('Discard your unsaved changes to this tool?')) return;
    onClose();
  }, [isSaving, isDeleting, isDirty, onClose]);

  // Dialog semantics (focus in / trapped / restored). Esc is handled below in the bubble
  // phase so open dropdowns inside the drawer can consume Esc first.
  const { ref: drawerRef, dialogProps } = useDialogA11y(true, null);
  const backdropProps = useBackdropDismiss(requestClose);
  const requestCloseRef = useRef(requestClose);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  });
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const node = drawerRef.current;
      if (!node) return;
      const openDialogs = document.querySelectorAll('[data-pearl-dialog="open"]');
      if (openDialogs.length && openDialogs[openDialogs.length - 1] !== node) return; // the cURL dialog is on top
      event.preventDefault();
      requestCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [drawerRef]);

  const closeCurlModal = useCallback(() => {
    if (curlParsing) return;
    setShowCurlModal(false);
    setCurlError(null);
  }, [curlParsing]);
  const { ref: curlDialogRef, dialogProps: curlDialogProps } = useDialogA11y(showCurlModal, closeCurlModal);
  const curlBackdropProps = useBackdropDismiss(closeCurlModal);

  const updateConfig = useCallback((key, val) => {
    setConfig(prev => ({ ...prev, [key]: val }));
  }, []);

  const batchUpdateConfig = useCallback((updates) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  // cURL Parser
  const handleParseCurl = useCallback(async () => {
    if (!curlInput.trim()) {
      setCurlError('Please paste a cURL command to import.');
      return;
    }
    setCurlParsing(true);
    setCurlError(null);

    try {
      // Agent-less route: works before the agent is saved as well.
      const parsed = await apiFetch('/api/pearl/tools/parse-curl', {
        method: 'POST',
        body: { curl_command: curlInput }
      });
      const d = (parsed && (parsed.data || parsed)) || {};
      if (!d.url) {
        setCurlError('No valid endpoint URL found in the cURL command. Check the command and try again.');
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
    } catch (err) {
      setCurlError(`Could not parse the cURL command: ${err?.message || 'request failed'}`);
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
      // A configured fixed value is what the backend compares; otherwise the simulator inputs are used.
      const inputLocked = inputSource === 'fixed_value' && inputValue.trim() !== '';
      const refLocked = referenceSource === 'fixed_value' && referenceValue.trim() !== '';
      const activeTestSpoken = inputLocked ? inputValue : testVerifierInput;
      const activeTestRef = refLocked ? referenceValue : testVerifierRef;

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
      tool_id: serverToolId(toolId),
      tool_type: toolType,
      config: isVerifier ? verifierTestConfig(mergedConfig) : mergedConfig,
      test_input: testInputPayload,
      timeout_seconds: finalTimeout
    };

    try {
      // Saved agents test on their own route; an unsaved agent uses the agent-less route.
      const data = await apiFetch(toolTestPath(agentId), { method: 'POST', body: payload });
      if (mountedRef.current) setTestResult(data && typeof data === 'object' ? data : { request_failed: true, error: 'The server returned an empty test result.' });
    } catch (err) {
      // The request itself failed (auth, validation, server, network): say so — no invented status or latency.
      if (mountedRef.current) setTestResult({ success: false, request_failed: true, error: err?.message || 'The test request failed.' });
    } finally {
      if (mountedRef.current) setIsTesting(false);
    }
  }, [
    timeoutSeconds, fallbackResponse, toolType, matchN, config, inputSource,
    inputValue, inputVariable, normalizeAs, matchMode, referenceSource,
    referenceValue, spokenOnMatch, spokenOnNoMatch, spokenOnError,
    pathParams, responseTemplate, testInputs, testVerifierInput, testVerifierRef,
    toolId, agentId
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

  // Submit Save — waits for the parent ({ ok, error }); the drawer stays open on failure.
  const handleSave = useCallback(async () => {
    if (isSaving || isDeleting) return;
    setSaveError(null);
    if (!name.trim()) {
      setSaveError('Enter a tool name.');
      return;
    }

    const isVerifier = toolType === 'data_verifier';
    if (isVerifier && !referenceValue.trim()) {
      setSaveError('Specify a reference record or variable (e.g. lead.phone) to verify against.');
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
      id: toolId,
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

    setIsSaving(true);
    try {
      const result = await onSaveTool(payload);
      if (result && result.ok === false && mountedRef.current) {
        setSaveError(result.error || 'The tool could not be saved. Please try again.');
      }
    } catch (err) {
      if (mountedRef.current) setSaveError(err?.message || 'The tool could not be saved. Please try again.');
    } finally {
      if (mountedRef.current) setIsSaving(false);
    }
  }, [
    isSaving, isDeleting,
    name, toolType, referenceValue, timeoutSeconds, fallbackResponse,
    matchN, responseTemplate, config, inputSource, inputValue, inputVariable,
    normalizeAs, matchMode, referenceSource, spokenOnMatch, spokenOnNoMatch,
    spokenOnError, pathParams, toolId, description, runTiming, runMode, isActive, onSaveTool
  ]);

  // Delete from the footer — waits for the parent; failures stay visible here.
  const handleDelete = useCallback(async () => {
    if (!toolId || !onDeleteTool || isSaving || isDeleting) return;
    if (!window.confirm(`Delete the "${name}" tool?`)) return;
    setSaveError(null);
    setIsDeleting(true);
    try {
      const result = await onDeleteTool(toolId);
      if (result && result.ok === false && mountedRef.current) {
        setSaveError(result.error || 'The tool could not be deleted. Please try again.');
      }
    } catch (err) {
      if (mountedRef.current) setSaveError(err?.message || 'The tool could not be deleted. Please try again.');
    } finally {
      if (mountedRef.current) setIsDeleting(false);
    }
  }, [toolId, onDeleteTool, isSaving, isDeleting, name]);

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 2 RENDERS
  // ──────────────────────────────────────────────────────────────────────────

  const renderApiToolForm = () => {
    const method = config.method || 'POST';
    const url = config.url || '';
    const params = config.params || [];
    const headers = config.headers || [];
    const auth = config.auth || { type: 'none' };
    // No body configured → an empty field with an example placeholder (nothing unsaved is shown as if configured).
    const bodyObj = typeof config.body === 'object' && config.body !== null
      ? config.body
      : { type: 'json', content: typeof config.body === 'string' ? config.body : '' };
    const apiResult = testResult ? describeToolTestResult(testResult, toolType) : null;

    return (
      <div>
        {/* Main API Card Container */}
        <div className="api-setup-card">
          {/* Top Endpoint Row: Method + URL + Send Button */}
          <div className="api-endpoint-row">
            <div className="method-select-wrap">
              <select
                className="method-select-clean"
                aria-label="HTTP method"
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
              aria-label="Endpoint URL"
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
                          aria-label={`Remove query parameter ${p.key || idx + 1}`}
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
                          aria-label={`Remove header ${h.key || idx + 1}`}
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
                    aria-label="Authentication type"
                    value={auth.type || 'none'}
                    onChange={(e) => updateConfig('auth', authForType(auth, e.target.value))}
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
                        placeholder="X-API-Key (used when left blank)"
                        value={auth.headerName ?? ''}
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
        {testResult && apiResult && (
          <div className="inline-test-feedback" role="status">
            <div className="test-badge-row">
              <span className={`status-badge ${apiResult.tone}`}>
                {apiResult.label}
              </span>
              {testResult.response_data !== undefined && testResult.response_data !== null && (
                <button
                  type="button"
                  className="btn-toggle-raw"
                  style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '0.78rem' }}
                  onClick={() => setShowRawTestOutput(prev => !prev)}
                >
                  {showRawTestOutput ? 'Hide raw JSON' : 'View response JSON'}
                </button>
              )}
            </div>

            {apiResult.error && (
              <div style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: 4 }}>
                {apiResult.error}
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

    // With a configured fixed value the backend compares that value, so the simulator shows it read-only.
    const inputLocked = inputSource === 'fixed_value' && inputValue.trim() !== '';
    const refLocked = referenceSource === 'fixed_value' && referenceValue.trim() !== '';
    const verifierResult = testResult ? describeToolTestResult(testResult, 'data_verifier') : null;

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
            <span>Pearl takes this value from what the caller says in the conversation.</span>
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
                aria-label="Test input"
                placeholder="3210"
                value={inputLocked ? inputValue : testVerifierInput}
                readOnly={inputLocked}
                title={inputLocked ? 'Uses the fixed value configured above' : undefined}
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
                aria-label="Reference value for the test"
                placeholder="+91 98765 43210"
                value={refLocked ? referenceValue : testVerifierRef}
                readOnly={refLocked}
                title={refLocked ? 'Uses the reference value configured above' : undefined}
                onChange={(e) => setTestVerifierRef(e.target.value)}
              />
            </div>
          </div>
          {(inputLocked || refLocked) && (
            <p className="drawer-field-hint" style={{ marginTop: -4, marginBottom: 10 }}>
              Fields showing a configured fixed value are compared as configured; clear the fixed value to try other inputs.
            </p>
          )}

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
        {testResult && verifierResult && (
          <div className="inline-test-feedback" style={{ marginTop: 2 }} role="status">
            <div className="test-badge-row">
              <span className={`status-badge ${verifierResult.tone}`}>
                {verifierResult.label}
              </span>
            </div>

            {verifierResult.error && (
              <div style={{ color: '#dc2626', fontSize: '0.8rem', marginTop: 4 }}>
                {verifierResult.error}
              </div>
            )}

            {testResult.spoken_feedback && (
              <div style={{ fontSize: '0.82rem', color: '#1f2937', marginTop: 4, fontStyle: 'italic' }}>
                Voice output: "{testResult.spoken_feedback}"
              </div>
            )}

            {(testResult.normalized_spoken !== undefined || testResult.normalized_reference !== undefined) && (
              <div style={{ fontSize: '0.76rem', color: '#6b7280', marginTop: 4 }}>
                Normalized input: <code>"{testResult.normalized_spoken ?? ''}"</code> | Reference: <code>"{testResult.normalized_reference ?? ''}"</code>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderMockApiForm = () => {
    // Seeded once when the drawer opens (initialToolConfig); clearing the field really clears it.
    const rawMock = config.mock_response_body ?? '';
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

  const busy = isSaving || isDeleting;

  return (
    <>
      <div className="tool-drawer-backdrop" {...backdropProps}>
        <div
          className="tool-drawer-container"
          ref={drawerRef}
          {...dialogProps}
          aria-labelledby={titleId}
        >
          {/* Top Header */}
          <div className="tool-drawer-header">
            <div>
              <h2 className="tool-drawer-title" id={titleId}>{meta.title}</h2>
              <p className="tool-drawer-subtitle">{meta.subtitle}</p>
              <p className="drawer-field-hint">
                Saved with this agent and testable here. Live calls and browser voice tests don&apos;t run agent tools yet.
              </p>
            </div>
            <button
              type="button"
              className="drawer-close-btn"
              onClick={requestClose}
              disabled={busy}
              title="Close (Esc)"
              aria-label="Close tool editor"
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
                    <label className="drawer-field-label" htmlFor={`${titleId}-name`}>Tool name</label>
                    <input
                      id={`${titleId}-name`}
                      data-autofocus
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
                      <label className="drawer-field-label" htmlFor={`${titleId}-description`}>What does this tool do? *</label>
                    </div>
                    <textarea
                      id={`${titleId}-description`}
                      rows={3}
                      className="drawer-textarea"
                      placeholder={meta.descPlaceholder || "Describe what this tool does..."}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                    <p className="drawer-field-hint">
                      {toolType === 'data_verifier'
                        ? "The name and description tell Pearl when this verification should run."
                        : "The name and description tell the agent when to call this tool."}
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
                        Lines Pearl says after verification. Leave a line blank to use Pearl's default line.
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
                        aria-label={meta.step3Title}
                        placeholder="e.g. 'The account balance is @balance.'"
                        value={responseTemplate}
                        onChange={(e) => setResponseTemplate(e.target.value)}
                      />
                      <p className="drawer-field-hint">
                        Write @field_name to include a value from the result. Run a test to list the available fields.
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
                      aria-label="Timeout in seconds"
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

          {/* Save / delete failures stay visible in the drawer (it does not close on failure) */}
          {saveError && (
            <div className="tool-drawer-save-error" role="alert">
              <AlertCircle size={14} />
              <span>{saveError}</span>
            </div>
          )}

          {/* Sticky Drawer Footer */}
          <div className="tool-drawer-footer">
            <div className="footer-left">
              {toolId && onDeleteTool && (
                <button
                  type="button"
                  className="btn-footer-delete"
                  onClick={handleDelete}
                  disabled={busy}
                >
                  <Trash2 size={13} />
                  <span>{isDeleting ? 'Deleting…' : 'Delete'}</span>
                </button>
              )}
            </div>

            <div className="footer-right">
              <button
                type="button"
                className="btn-footer-cancel"
                onClick={requestClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-footer-save"
                onClick={handleSave}
                disabled={busy}
                aria-busy={isSaving}
              >
                <span>{isSaving ? 'Saving…' : (toolId ? 'Save changes' : 'Add tool')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* cURL Import Modal */}
      {showCurlModal && (
        <div className="curl-modal-backdrop" {...curlBackdropProps}>
          <div
            className="curl-modal-card"
            ref={curlDialogRef}
            {...curlDialogProps}
            aria-labelledby={`${titleId}-curl-title`}
          >
            <div className="curl-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Code2 size={16} aria-hidden="true" />
                <h4 id={`${titleId}-curl-title`} style={{ margin: 0, fontSize: '0.94rem', fontWeight: 600 }}>Import from cURL Command</h4>
              </div>
              <button
                type="button"
                className="drawer-close-btn"
                onClick={closeCurlModal}
                aria-label="Close cURL import"
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
                aria-label="cURL command"
                placeholder={'curl -X POST https://api.crm.io/v1/leads \\\n  -H "Authorization: Bearer my_token" \\\n  -d \'{"lead_id": "100"}\''}
                value={curlInput}
                onChange={(e) => {
                  setCurlInput(e.target.value);
                  if (curlError) setCurlError(null);
                }}
                autoFocus
              />
              {curlError && (
                <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#dc2626', fontSize: '0.8rem', marginTop: 8 }}>
                  <AlertCircle size={13} />
                  <span>{curlError}</span>
                </div>
              )}
            </div>

            <div className="curl-modal-footer">
              <button
                type="button"
                className="btn-footer-cancel"
                onClick={closeCurlModal}
                disabled={curlParsing}
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
}

/**
 * Tool editor drawer. The form body is keyed by tool and only mounted while open, so every
 * opening starts from the tool's saved values (no cross-tool leakage, no re-sync effect).
 * `onSaveTool(payload)` / `onDeleteTool(id)` may return `{ ok, error }` (or a promise of it);
 * on `ok: false` the drawer stays open and shows `error`.
 */
export const ToolDrawer = React.memo((props) => {
  const { isOpen, tool } = props;
  if (!isOpen || !tool) return null;
  return <ToolDrawerBody key={`${tool.id ?? 'new'}:${tool.tool_type || 'api_tool'}`} {...props} />;
});

export default ToolDrawer;
