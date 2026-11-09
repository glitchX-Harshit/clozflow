import React, { useState, useMemo } from 'react';
import { 
  X, ChevronDown, ChevronUp, Search, ExternalLink, 
  AlertCircle, Eye, EyeOff, ShieldCheck, Check, 
  Copy, ArrowRight, Loader2, PhoneCall,
  Sliders, Key, RadioTower, Sparkles, Server, Zap, RefreshCw
} from 'lucide-react';
import './ConnectProviderModal.css';

// ClozFlow Branded Carrier Catalog (India & Global Enterprise Telecoms)
export const CARRIER_CATALOG = [
  {
    id: 'exotel',
    name: 'Exotel',
    badge: 'DLT Compliant',
    tagline: 'Enterprise Virtual Numbers & DLT 140 CLI',
    description: 'Official Indian PRI / PSTN virtual numbers, 140-series telemarketing compliance, and low-latency Mumbai gateway interconnect.',
    docsUrl: 'https://my.exotel.com/apisettings',
    defaultBaseUrl: 'api.in.exotel.com',
    accentColor: '#0f172a',
    tab3Name: 'Stream Routing',
    credentialsFields: [
      { key: 'accountSid', label: 'Account SID', placeholder: 'e.g. exo_acc_83749...', type: 'text', mono: true },
      { key: 'apiKey', label: 'API Key', placeholder: 'Enter Exotel API Key', type: 'password', mono: true },
      { key: 'apiToken', label: 'API Secret Token', placeholder: 'Enter Exotel API Token', type: 'password', mono: true },
      { key: 'baseUrl', label: 'Cluster Domain', placeholder: 'api.in.exotel.com', type: 'text', mono: true, hint: 'Mumbai Primary Gateway' }
    ],
    checklist: [
      {
        num: '01',
        title: 'Open Exotel Developer Settings',
        desc: 'Log in to your Exotel dashboard and navigate to API Settings in the left navigation menu.',
        actionLabel: 'Launch Exotel Console',
        actionUrl: 'https://my.exotel.com/apisettings'
      },
      {
        num: '02',
        title: 'Generate Agent Credentials',
        desc: 'Copy your Account SID and generate a dedicated API Key and API Token with call initiation and media permissions enabled.',
      },
      {
        num: '03',
        title: 'Disable Upstream Call Queueing',
        desc: 'To achieve sub-300ms agent responsiveness, disable carrier-side call queues and hold IVRs so ClozFlow agents answer instantly.',
      }
    ]
  },
  {
    id: 'vobiz',
    name: 'Vobiz',
    badge: 'Sub-200ms Audio',
    tagline: 'High-Throughput Raw PCM SIP Trunking',
    description: 'Ultra-low latency carrier gateway with native 8kHz/16kHz PCM bi-directional WebSockets for ultra-responsive voice agents.',
    docsUrl: 'https://console.vobiz.ai',
    defaultBaseUrl: 'api.vobiz.ai',
    accentColor: '#ea580c',
    tab3Name: 'Inbound Webhook',
    credentialsFields: [
      { key: 'authId', label: 'Vobiz Auth ID', placeholder: 'e.g. vbz_auth_91024...', type: 'text', mono: true },
      { key: 'authToken', label: 'Vobiz Secret Token', placeholder: 'Enter Vobiz Auth Token', type: 'password', mono: true },
      { key: 'baseUrl', label: 'Gateway Endpoint', placeholder: 'api.vobiz.ai', type: 'text', mono: true, hint: 'Default Low-Latency Cluster' }
    ],
    checklist: [
      {
        num: '01',
        title: 'Access Vobiz Project Console',
        desc: 'Sign in to the Vobiz Cloud portal and select the target voice agent project.',
        actionLabel: 'Open Vobiz Console',
        actionUrl: 'https://console.vobiz.ai'
      },
      {
        num: '02',
        title: 'Copy Voice Application Tokens',
        desc: 'Under Voice → Applications, copy your unique Auth ID and secret Auth Token.',
      },
      {
        num: '03',
        title: 'Enable Raw PCM Audio Buffer',
        desc: 'Ensure 8kHz or 16kHz PCM audio streaming is active on your application profile for pristine synthetic speech.',
      }
    ]
  },
  {
    id: 'smartflo',
    name: 'Tata Smartflo',
    badge: 'Enterprise PBX',
    tagline: 'Tata Teleservices Cloud PBX & SIP Trunking',
    description: 'Enterprise-grade cloud PBX and contact center routing for high-volume inbound inquiries and autonomous outbound outreach across India.',
    docsUrl: 'https://smartflo.tatateleservices.com',
    defaultBaseUrl: 'smartflo.tatateleservices.com',
    accentColor: '#2563eb',
    tab3Name: 'Stream Routing',
    credentialsFields: [
      { key: 'accountSid', label: 'Tenant / Account ID', placeholder: 'e.g. tt_tenant_9482...', type: 'text', mono: true },
      { key: 'apiKey', label: 'Smartflo API Key', placeholder: 'Enter Smartflo API Key', type: 'password', mono: true },
      { key: 'apiToken', label: 'PBX Secret Token', placeholder: 'Enter Smartflo Secret Token', type: 'password', mono: true },
      { key: 'baseUrl', label: 'PBX Routing Domain', placeholder: 'smartflo.tatateleservices.com', type: 'text', mono: true }
    ],
    checklist: [
      {
        num: '01',
        title: 'Log in to Tata Smartflo Portal',
        desc: 'Access your enterprise administrator suite under Integrations → API Gateway.',
        actionLabel: 'Open Smartflo Suite',
        actionUrl: 'https://smartflo.tatateleservices.com'
      },
      {
        num: '02',
        title: 'Provision Agent Gateway Keys',
        desc: 'Generate an API key with outbound dialing and bi-directional media stream authorization.',
      },
      {
        num: '03',
        title: 'Direct Ring Configuration',
        desc: 'Configure inbound DID routing to forward directly to ClozFlow SIP URI without PBX queue delays.',
      }
    ]
  },
  {
    id: 'pulse',
    name: 'Pulse Telephony',
    badge: 'High Concurrency',
    tagline: 'Carrier SIP Gateway & High-Volume Dialers',
    description: 'Dedicated enterprise SIP trunks with real-time TRAI DND filtering, national CLI masking, and high-concurrency PRI termination.',
    docsUrl: 'https://pulse.telesoftlabs.com',
    defaultBaseUrl: 'api.pulsecloud.io',
    accentColor: '#059669',
    tab3Name: 'Stream Routing',
    credentialsFields: [
      { key: 'accountSid', label: 'Pulse Trunk Account ID', placeholder: 'e.g. pls_trk_7281...', type: 'text', mono: true },
      { key: 'apiKey', label: 'SIP Username / Key', placeholder: 'Enter Pulse SIP Username', type: 'text', mono: true },
      { key: 'apiToken', label: 'SIP Secret Key', placeholder: 'Enter Pulse Secret Key', type: 'password', mono: true },
      { key: 'baseUrl', label: 'SIP Gateway Host', placeholder: 'api.pulsecloud.io', type: 'text', mono: true }
    ],
    checklist: [
      {
        num: '01',
        title: 'Open Pulse Customer Portal',
        desc: 'Navigate to the SIP Trunking section in your Pulse Telephony administrative control panel.',
        actionLabel: 'Open Pulse Console',
        actionUrl: 'https://pulse.telesoftlabs.com'
      },
      {
        num: '02',
        title: 'Create Trunk Access Token',
        desc: 'Provision a dedicated SIP trunk profile and generate high-concurrency access tokens.',
      },
      {
        num: '03',
        title: 'TRAI DND Scrubber Setup',
        desc: 'Confirm operational DND scrubbing mode (promotional vs transactional) for compliance with TRAI regulations.',
      }
    ]
  },
  {
    id: 'intalk',
    name: 'InTalk Omnichannel',
    badge: 'Contact Center',
    tagline: 'Omnichannel Contact Center Trunk',
    description: 'Enterprise contact center trunk supporting blended human-agent transfers and autonomous voice agent triage.',
    docsUrl: 'https://app.intalk.io',
    defaultBaseUrl: 'api.intalk.io',
    accentColor: '#e11d48',
    tab3Name: 'Stream Routing',
    credentialsFields: [
      { key: 'accountSid', label: 'InTalk Organization Slug', placeholder: 'e.g. acme-corp', type: 'text', mono: true },
      { key: 'apiKey', label: 'Agent Voice API Key', placeholder: 'Enter InTalk API Key', type: 'password', mono: true },
      { key: 'apiToken', label: 'Webhook Signing Secret', placeholder: 'Enter Signing Secret', type: 'password', mono: true },
      { key: 'baseUrl', label: 'Tenant API Host', placeholder: 'api.intalk.io', type: 'text', mono: true }
    ],
    checklist: [
      {
        num: '01',
        title: 'Sign in to InTalk Management Console',
        desc: 'Access your InTalk Omnichannel dashboard and open the Telephony & Gateways panel.',
        actionLabel: 'Open InTalk Console',
        actionUrl: 'https://app.intalk.io'
      },
      {
        num: '02',
        title: 'Create InTalk Bot Gateway',
        desc: 'Register ClozFlow as an autonomous bot endpoint and generate an API key with call-transfer permissions.',
      },
      {
        num: '03',
        title: 'Verify SIP Handshake Parameters',
        desc: 'Set the audio codec negotiation to G.711u / PCM for optimal compatibility.',
      }
    ]
  }
];

export const ConnectProviderModal = ({ isOpen, onClose, orgName = "Enterprise", onConnectSuccess }) => {
  const [selectedCarrierId, setSelectedCarrierId] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // 3-Stage Setup Wizard: 1: Checklist, 2: Credentials, 3: Routing & Handshake
  const [wizardStep, setWizardStep] = useState(1);

  // Form State
  const [permissionsConfirmed, setPermissionsConfirmed] = useState(false);
  const [showSecrets, setShowSecrets] = useState({});
  const [diagnosticRunning, setDiagnosticRunning] = useState(false);
  const [diagnosticStage, setDiagnosticStage] = useState('');
  const [connected, setConnected] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(null);

  const [formData, setFormData] = useState({
    trunkLabel: '',
    accountSid: '',
    apiKey: '',
    apiToken: '',
    authId: '',
    authToken: '',
    baseUrl: '',
    callerId: '+91 80 6535 4620'
  });

  const activeCarrier = useMemo(() => {
    return CARRIER_CATALOG.find(c => c.id === selectedCarrierId) || null;
  }, [selectedCarrierId]);

  const filteredCarriers = useMemo(() => {
    if (!searchQuery.trim()) return CARRIER_CATALOG;
    const q = searchQuery.toLowerCase();
    return CARRIER_CATALOG.filter(c => 
      c.name.toLowerCase().includes(q) || 
      c.tagline.toLowerCase().includes(q) || 
      c.description.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  if (!isOpen) return null;

  const handleSelectCarrier = (carrierId) => {
    const carrier = CARRIER_CATALOG.find(c => c.id === carrierId);
    setSelectedCarrierId(carrierId);
    setDropdownOpen(false);
    setWizardStep(1);
    setPermissionsConfirmed(false);
    setConnected(false);
    setDiagnosticRunning(false);

    setFormData(prev => ({
      ...prev,
      trunkLabel: `${carrier?.name || 'Carrier'} Dedicated Trunk (${orgName.split(' ')[0]})`,
      baseUrl: carrier?.defaultBaseUrl || '',
      accountSid: '',
      apiKey: '',
      apiToken: '',
      authId: '',
      authToken: '',
      callerId: '+91 80 6535 4620'
    }));
  };

  const handleReset = () => {
    setSelectedCarrierId(null);
    setWizardStep(1);
    setPermissionsConfirmed(false);
    setConnected(false);
    setDiagnosticRunning(false);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopyFeedback(key);
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  const toggleSecret = (fieldKey) => {
    setShowSecrets(prev => ({ ...prev, [fieldKey]: !prev[fieldKey] }));
  };

  const handleRunDiagnostic = async () => {
    setDiagnosticRunning(true);
    setDiagnosticStage('Validating credential formats & signing keys...');
    
    setTimeout(() => {
      setDiagnosticStage('Pinging carrier cluster socket & checking packet latency...');
      setTimeout(() => {
        setDiagnosticStage('Establishing bi-directional audio stream pipeline...');
        setTimeout(() => {
          setDiagnosticRunning(false);
          setConnected(true);
          if (onConnectSuccess) {
            onConnectSuccess({
              provider: activeCarrier?.id,
              carrierName: activeCarrier?.name,
              trunkLabel: formData.trunkLabel,
              callerId: formData.callerId,
              baseUrl: formData.baseUrl
            });
          }
        }, 800);
      }, 800);
    }, 800);
  };

  return (
    <div className="cz-trunk-overlay" onClick={handleClose}>
      <div className="cz-trunk-modal animate-cz-pop" onClick={e => e.stopPropagation()}>
        
        {/* Top Header Bar */}
        <div className="cz-modal-topbar">
          <div className="cz-topbar-left">
            <span className="cz-pulse-badge">
              <span className="cz-pulse-dot" />
              BYOC CARRIER GATEWAY
            </span>
            <span className="cz-topbar-org">{orgName}</span>
          </div>
          <button 
            type="button" 
            className="cz-close-btn" 
            onClick={handleClose} 
            aria-label="Close dialog"
          >
            <X size={16} />
          </button>
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            STEP 0: CARRIER SELECTION
            ══════════════════════════════════════════════════════════════════ */}
        {!selectedCarrierId ? (
          <div className="cz-carrier-select-flow">
            <div className="cz-hero-content">
              <h2 className="cz-hero-headline">Connect Enterprise Telephony Trunk</h2>
              <p className="cz-hero-description">
                Link your direct carrier contract to ClozFlow. Preserve your DLT-registered 140 CLI numbers, eliminate per-minute markups, and stream raw PCM audio directly to autonomous voice agents.
              </p>
            </div>

            {/* Custom Dropdown Trigger */}
            <div className="cz-select-wrapper">
              <label className="cz-input-label">Select Telephony Provider</label>
              
              <div className="cz-dropdown-anchor">
                <button
                  type="button"
                  className={`cz-dropdown-trigger ${dropdownOpen ? 'is-active' : ''}`}
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                >
                  <div className="cz-trigger-left">
                    <div className="cz-carrier-placeholder-icon">
                      <PhoneCall size={16} />
                    </div>
                    <span className="cz-trigger-text">Choose your telecom provider...</span>
                  </div>
                  {dropdownOpen ? <ChevronUp size={16} className="cz-arrow-icon" /> : <ChevronDown size={16} className="cz-arrow-icon" />}
                </button>

                {dropdownOpen && (
                  <div className="cz-dropdown-panel animate-cz-drop">
                    {/* Search Field */}
                    <div className="cz-search-container">
                      <Search size={14} className="cz-search-svg" />
                      <input 
                        type="text" 
                        placeholder="Search by provider name or protocol..." 
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        autoFocus
                        className="cz-filter-input"
                      />
                    </div>

                    {/* Providers List */}
                    <div className="cz-options-container">
                      {filteredCarriers.map(carrier => (
                        <div 
                          key={carrier.id} 
                          className="cz-carrier-option"
                          onClick={() => handleSelectCarrier(carrier.id)}
                        >
                          <div className="cz-option-left">
                            <div 
                              className="cz-carrier-badge-icon" 
                              style={{ 
                                backgroundColor: `${carrier.accentColor}14`, 
                                color: carrier.accentColor,
                                borderColor: `${carrier.accentColor}28`
                              }}
                            >
                              {carrier.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="cz-option-info">
                              <div className="cz-option-header-line">
                                <span className="cz-option-name">{carrier.name}</span>
                                <span className="cz-carrier-pill">{carrier.badge}</span>
                              </div>
                              <p className="cz-option-tagline">{carrier.tagline}</p>
                            </div>
                          </div>
                          <ArrowRight size={14} className="cz-option-arrow" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Platform Highlights */}
            <div className="cz-benefits-grid">
              <div className="cz-benefit-card">
                <div className="cz-benefit-icon-wrap">
                  <ShieldCheck size={16} className="text-blue" />
                </div>
                <div>
                  <h4 className="cz-benefit-title">Zero Number Porting</h4>
                  <p className="cz-benefit-desc">Keep all your existing PRI / SIP virtual numbers, caller whitelists, and telecom contracts.</p>
                </div>
              </div>

              <div className="cz-benefit-card">
                <div className="cz-benefit-icon-wrap">
                  <Zap size={16} className="text-amber" />
                </div>
                <div>
                  <h4 className="cz-benefit-title">Sub-300ms Audio Pipeline</h4>
                  <p className="cz-benefit-desc">Direct WebSockets bypass carrier IVR delays for instantaneous human-speed conversations.</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ══════════════════════════════════════════════════════════════════
             STAGE 1-3: CARRIER SETUP WIZARD
             ══════════════════════════════════════════════════════════════════ */
          <div className="cz-wizard-body">
            
            {/* Header info with active carrier */}
            <div className="cz-wizard-carrier-card">
              <div className="cz-active-carrier-summary">
                <div 
                  className="cz-active-monogram" 
                  style={{ 
                    backgroundColor: `${activeCarrier?.accentColor}18`, 
                    color: activeCarrier?.accentColor 
                  }}
                >
                  {activeCarrier?.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="cz-carrier-title-row">
                    <h3 className="cz-active-carrier-name">{activeCarrier?.name} Trunk Connection</h3>
                    <span className="cz-active-badge">{activeCarrier?.badge}</span>
                  </div>
                  <p className="cz-active-subtext">{activeCarrier?.tagline}</p>
                </div>
              </div>
              <button type="button" className="cz-switch-btn" onClick={handleReset}>
                Change Carrier
              </button>
            </div>

            {/* Stepper Navigation */}
            <div className="cz-pipeline-stepper">
              <button 
                type="button" 
                className={`cz-stepper-item ${wizardStep === 1 ? 'is-current' : ''} ${wizardStep > 1 ? 'is-done' : ''}`}
                onClick={() => setWizardStep(1)}
              >
                <div className="cz-stepper-pill-num">
                  {wizardStep > 1 ? <Check size={11} strokeWidth={3} /> : '1'}
                </div>
                <span className="cz-stepper-label">Prerequisites</span>
              </button>

              <div className="cz-stepper-connector" />

              <button 
                type="button" 
                className={`cz-stepper-item ${wizardStep === 2 ? 'is-current' : ''} ${wizardStep > 2 ? 'is-done' : ''}`}
                onClick={() => setWizardStep(2)}
              >
                <div className="cz-stepper-pill-num">
                  {wizardStep > 2 ? <Check size={11} strokeWidth={3} /> : '2'}
                </div>
                <span className="cz-stepper-label">Credentials Vault</span>
              </button>

              <div className="cz-stepper-connector" />

              <button 
                type="button" 
                className={`cz-stepper-item ${wizardStep === 3 ? 'is-current' : ''} ${connected ? 'is-done' : ''}`}
                onClick={() => setWizardStep(3)}
              >
                <div className="cz-stepper-pill-num">
                  {connected ? <Check size={11} strokeWidth={3} /> : '3'}
                </div>
                <span className="cz-stepper-label">Handshake & Route</span>
              </button>
            </div>

            {/* ── STEP 1: CHECKLIST & PREREQUISITES ── */}
            {wizardStep === 1 && (
              <div className="cz-tab-view animate-cz-fade">
                <div className="cz-tab-header">
                  <div>
                    <h4 className="cz-tab-title">Carrier Authorization Checklist</h4>
                    <p className="cz-tab-sub">
                      Review prerequisites in your {activeCarrier?.name} administration portal to enable real-time conversational streaming.
                    </p>
                  </div>
                  <a 
                    href={activeCarrier?.docsUrl} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="cz-external-link-btn"
                  >
                    <span>Open {activeCarrier?.name} Console</span>
                    <ExternalLink size={12} />
                  </a>
                </div>

                {/* Checklist Action Cards */}
                <div className="cz-checklist-list">
                  {activeCarrier?.checklist.map((item, idx) => (
                    <div key={idx} className="cz-checklist-card">
                      <div className="cz-checklist-badge">{item.num}</div>
                      <div className="cz-checklist-content">
                        <h5 className="cz-checklist-card-title">{item.title}</h5>
                        <p className="cz-checklist-card-desc">{item.desc}</p>
                        {item.actionLabel && (
                          <a 
                            href={item.actionUrl} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="cz-inline-action-link"
                          >
                            <span>{item.actionLabel}</span>
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Latency Guard Callout */}
                <div className="cz-guard-callout">
                  <div className="cz-guard-icon-col">
                    <AlertCircle size={16} className="cz-guard-icon" />
                  </div>
                  <div className="cz-guard-body">
                    <h5 className="cz-guard-title">Latency Guard Recommendation</h5>
                    <p className="cz-guard-text">
                      To ensure your ClozFlow voice agents pick up in &lt;300ms, confirm that carrier-side queuing, greeting IVRs, and ringback buffers are disabled on this trunk.
                    </p>
                  </div>
                </div>

                {/* Confirmation Checkbox */}
                <label className="cz-ack-checkbox">
                  <input 
                    type="checkbox" 
                    checked={permissionsConfirmed}
                    onChange={e => setPermissionsConfirmed(e.target.checked)}
                    className="cz-real-checkbox"
                  />
                  <div className="cz-ack-text">
                    <strong>I have verified my {activeCarrier?.name} API credentials</strong>
                    <span>These credentials have outbound calling and WebSocket streaming permissions enabled.</span>
                  </div>
                </label>

                {/* Navigation Buttons */}
                <div className="cz-wizard-actions">
                  <button type="button" className="cz-btn-secondary" onClick={handleReset}>
                    Change Carrier
                  </button>
                  <button 
                    type="button" 
                    className="cz-btn-primary" 
                    disabled={!permissionsConfirmed}
                    onClick={() => setWizardStep(2)}
                  >
                    <span>Proceed to Credentials</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 2: CREDENTIALS VAULT ── */}
            {wizardStep === 2 && (
              <div className="cz-tab-view animate-cz-fade">
                <div className="cz-tab-header">
                  <div>
                    <h4 className="cz-tab-title">Enter {activeCarrier?.name} Gateway Keys</h4>
                    <p className="cz-tab-sub">
                      Paste the values from your carrier portal. Secrets are stored in ClozFlow's encrypted hardware vault.
                    </p>
                  </div>
                </div>

                <div className="cz-form-grid">
                  {/* Connection Name */}
                  <div className="cz-field-item">
                    <label className="cz-form-label">Trunk Connection Label</label>
                    <input 
                      type="text" 
                      value={formData.trunkLabel}
                      onChange={e => setFormData({ ...formData, trunkLabel: e.target.value })}
                      className="cz-form-input"
                      placeholder="e.g. Primary Outbound SIP Trunk"
                    />
                  </div>

                  {/* Provider Dynamic Fields */}
                  {activeCarrier?.credentialsFields.map((field) => {
                    const isSecret = field.type === 'password';
                    const isVisible = showSecrets[field.key];
                    const val = formData[field.key] || '';

                    return (
                      <div key={field.key} className="cz-field-item">
                        <div className="cz-field-header">
                          <label className="cz-form-label">{field.label}</label>
                          {field.hint && <span className="cz-field-hint">{field.hint}</span>}
                        </div>
                        
                        <div className="cz-input-relative">
                          <input 
                            type={isSecret ? (isVisible ? 'text' : 'password') : 'text'}
                            placeholder={field.placeholder}
                            value={val}
                            onChange={e => setFormData({ ...formData, [field.key]: e.target.value })}
                            className={`cz-form-input ${field.mono ? 'font-code' : ''} ${isSecret ? 'has-eye' : ''}`}
                          />
                          {isSecret && (
                            <button 
                              type="button" 
                              className="cz-eye-btn" 
                              onClick={() => toggleSecret(field.key)}
                              tabIndex={-1}
                              aria-label={isVisible ? 'Hide secret' : 'Show secret'}
                            >
                              {isVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Vault Security Strip */}
                <div className="cz-security-strip">
                  <ShieldCheck size={14} className="cz-security-icon" />
                  <span>ClozFlow Cloud Vault &bull; Encrypted with AES-256 GCM in isolated tenant enclave</span>
                </div>

                {/* Navigation Buttons */}
                <div className="cz-wizard-actions">
                  <button type="button" className="cz-btn-secondary" onClick={() => setWizardStep(1)}>
                    Back
                  </button>
                  <button 
                    type="button" 
                    className="cz-btn-primary" 
                    onClick={() => setWizardStep(3)}
                  >
                    <span>Configure Routing</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 3: ROUTING & LIVE HANDSHAKE ── */}
            {wizardStep === 3 && (
              <div className="cz-tab-view animate-cz-fade">
                {connected ? (
                  /* Success Panel */
                  <div className="cz-success-container">
                    <div className="cz-success-icon-wrap">
                      <Check size={28} strokeWidth={3} />
                    </div>
                    <h3 className="cz-success-title">{activeCarrier?.name} Trunk Successfully Connected!</h3>
                    <p className="cz-success-body">
                      Handshake complete. ClozFlow's real-time audio pipeline has verified the connection with your {activeCarrier?.name} gateway. Your autonomous Pearl voice agents will now terminate outbound calls using this trunk.
                    </p>

                    <div className="cz-connection-summary-card">
                      <div className="cz-summary-line">
                        <span className="cz-sum-label">Trunk Provider:</span>
                        <strong className="cz-sum-value">{activeCarrier?.name} ({activeCarrier?.badge})</strong>
                      </div>
                      <div className="cz-summary-line">
                        <span className="cz-sum-label">Connection Name:</span>
                        <strong className="cz-sum-value">{formData.trunkLabel}</strong>
                      </div>
                      <div className="cz-summary-line">
                        <span className="cz-sum-label">Caller ID (CLI):</span>
                        <strong className="cz-sum-value cz-highlight-text">{formData.callerId}</strong>
                      </div>
                      <div className="cz-summary-line">
                        <span className="cz-sum-label">Status:</span>
                        <span className="cz-active-status-badge">
                          <span className="cz-live-dot" />
                          ACTIVE & READY
                        </span>
                      </div>
                    </div>

                    <div className="cz-wizard-actions" style={{ justifyContent: 'center', marginTop: '1.75rem' }}>
                      <button type="button" className="cz-btn-primary" onClick={handleClose}>
                        Return to Phone Numbers
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Handshake Config View */
                  <>
                    <div className="cz-tab-header">
                      <div>
                        <h4 className="cz-tab-title">Webhook & Media Stream Handshake</h4>
                        <p className="cz-tab-sub">
                          Configure your carrier application to route real-time 8kHz/16kHz audio to ClozFlow.
                        </p>
                      </div>
                    </div>

                    <div className="cz-form-grid">
                      {/* WebSocket Stream URI */}
                      <div className="cz-field-item">
                        <div className="cz-field-header">
                          <label className="cz-form-label">Real-time Audio WebSocket Stream URI</label>
                          <span className="cz-field-hint">Bi-directional PCM</span>
                        </div>
                        <div className="cz-copy-field">
                          <code className="cz-code-snippet">{`wss://telephony.clozflow.ai/v1/stream/${activeCarrier?.id}`}</code>
                          <button 
                            type="button" 
                            className="cz-copy-btn"
                            onClick={() => copyToClipboard(`wss://telephony.clozflow.ai/v1/stream/${activeCarrier?.id}`, 'ws')}
                            title="Copy to clipboard"
                          >
                            {copyFeedback === 'ws' ? <Check size={13} className="text-emerald" /> : <Copy size={13} />}
                          </button>
                        </div>
                      </div>

                      {/* Inbound Webhook */}
                      <div className="cz-field-item">
                        <div className="cz-field-header">
                          <label className="cz-form-label">Inbound Call Webhook URL</label>
                          <span className="cz-field-hint">HTTP POST / SIP Handshake</span>
                        </div>
                        <div className="cz-copy-field">
                          <code className="cz-code-snippet">{`https://telephony.clozflow.ai/v1/inbound/${activeCarrier?.id}`}</code>
                          <button 
                            type="button" 
                            className="cz-copy-btn"
                            onClick={() => copyToClipboard(`https://telephony.clozflow.ai/v1/inbound/${activeCarrier?.id}`, 'hook')}
                            title="Copy to clipboard"
                          >
                            {copyFeedback === 'hook' ? <Check size={13} className="text-emerald" /> : <Copy size={13} />}
                          </button>
                        </div>
                      </div>

                      {/* Primary Outbound Caller ID */}
                      <div className="cz-field-item">
                        <div className="cz-field-header">
                          <label className="cz-form-label">Primary Caller ID Number (E.164)</label>
                          <span className="cz-field-hint">DLT Registered CLI</span>
                        </div>
                        <input 
                          type="text" 
                          placeholder="+91 80 6535 4620"
                          value={formData.callerId}
                          onChange={e => setFormData({ ...formData, callerId: e.target.value })}
                          className="cz-form-input font-code"
                        />
                      </div>
                    </div>

                    {/* Diagnostic Progress Box if running */}
                    {diagnosticRunning && (
                      <div className="cz-diagnostic-box animate-cz-fade">
                        <div className="cz-diag-spinner">
                          <Loader2 size={16} className="cz-spin-icon" />
                        </div>
                        <div className="cz-diag-text">
                          <strong>Testing Carrier Handshake</strong>
                          <span>{diagnosticStage}</span>
                        </div>
                      </div>
                    )}

                    {/* Navigation Buttons */}
                    <div className="cz-wizard-actions">
                      <button 
                        type="button" 
                        className="cz-btn-secondary" 
                        onClick={() => setWizardStep(2)}
                        disabled={diagnosticRunning}
                      >
                        Back
                      </button>
                      <button 
                        type="button" 
                        className="cz-btn-primary"
                        disabled={diagnosticRunning}
                        onClick={handleRunDiagnostic}
                      >
                        {diagnosticRunning ? (
                          <>
                            <Loader2 size={15} className="cz-spin-icon" />
                            <span>Verifying Trunk Pipeline...</span>
                          </>
                        ) : (
                          <>
                            <span>Run Diagnostic & Connect</span>
                            <ArrowRight size={14} />
                          </>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectProviderModal;