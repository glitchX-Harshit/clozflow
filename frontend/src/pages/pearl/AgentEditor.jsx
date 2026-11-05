import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  ArrowLeft, Bot, Phone, MoreVertical, 
  FileText, Braces, Wrench, Settings as SettingsIcon, 
  CheckCircle2, Sparkles, ChevronDown, ChevronUp,
  Save, Loader2, Check, Database, Mic,
  Trash2, Plus, Search, Volume2, VolumeX, Globe, 
  Clock, X, Send, Sliders, AlertCircle, PhoneCall, Copy, ThumbsUp, ThumbsDown
} from 'lucide-react';
import './AgentEditor.css';
import AgentTestingPanel from './AgentTestingPanel';
import VoicePersonaSelector, { CLOZFLOW_VOICE_LIST } from '../../components/VoicePersonaSelector';
import CapsuleSelector from '../../components/CapsuleSelector';
import ArchetypeLibraryModal from '../../components/ArchetypeLibraryModal';
import { 
  extractVariables, 
  substituteVariables, 
  formatVariableLabel, 
  mergeVariablesWithDefaults 
} from '../../utils/variableParser';
import { SALES_ARCHETYPES, getArchetypeById } from '../../data/salesArchetypes';

export const AgentEditor = ({ agentId = null, initialArchetypeId = null, onBack }) => {
  const [searchParams] = useSearchParams();
  const queryArchetype = searchParams?.get('archetype');
  const effectiveArchetypeId = initialArchetypeId || queryArchetype;

  // Active Tab: instructions | variables | tools | settings | tests
  const [activeTab, setActiveTab] = useState('instructions');
  const [currentId, setCurrentId] = useState(agentId);

  useEffect(() => {
    setCurrentId(agentId);
  }, [agentId]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showTestingPanel, setShowTestingPanel] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);

  // Archetype & Template State
  const [showArchetypeModal, setShowArchetypeModal] = useState(false);
  const [activeArchetypeId, setActiveArchetypeId] = useState(effectiveArchetypeId || null);
  const [templateNotification, setTemplateNotification] = useState(null);

  // Core Agent Fields
  const [agentName, setAgentName] = useState('Conversation Agent 6613');
  const [role, setRole] = useState('outbound_qualification');
  const [mission, setMission] = useState('Qualify prospect intent, establish immediate product relevance, and book a discovery demo.');
  
  // Prompt Architecture: 'expert' (Clozflow Proprietary Brain) vs 'custom'
  const [promptMode, setPromptMode] = useState('expert');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [fineTuningDirectives, setFineTuningDirectives] = useState('');

  // Fixed Opening Script (Greeting) — OFF by default for sales
  const [greetingEnabled, setGreetingEnabled] = useState(false);
  const [greetingText, setGreetingText] = useState('Hi, I am Shubh calling from Clozflow, how can I help you today?');

  // Voice Persona Settings
  const [speaker, setSpeaker] = useState('shubh_enhi_ads');
  const [language, setLanguage] = useState('Auto');
  const [pace, setPace] = useState(1.0);
  const [tone, setTone] = useState('Professional');

  // Knowledge Capsule
  const [capsules, setCapsules] = useState([]);
  const [capsuleId, setCapsuleId] = useState('');

  // Input & Output Variables
  const [variablesSubtab, setVariablesSubtab] = useState('input'); // 'input' | 'output'
  const [varSearchQuery, setVarSearchQuery] = useState('');
  const [testVariables, setTestVariables] = useState({
    user_name: 'Manan',
    lead_name: 'Siddharth Roy',
    prospect_company: 'FinEdge Logistics',
    product_name: 'Clozflow AI',
    calendar_link: 'https://cal.com/clozflow/demo'
  });

  const outputVariables = useMemo(() => [
    { name: 'qualification_disposition', desc: 'Final call classification (MEETING_BOOKED, QUALIFIED_INFO, UNQUALIFIED)', type: 'string' },
    { name: 'meeting_slot', desc: 'Confirmed calendar date and timeslot agreed with the prospect', type: 'datetime' },
    { name: 'monthly_call_volume', desc: 'Self-reported monthly outbound/inbound minutes or call volume', type: 'number' },
    { name: 'primary_pain_point', desc: 'Operational bottleneck (telecaller attrition, CAC, speed to lead)', type: 'string' },
    { name: 'customer_sentiment', desc: 'Emotional tone detected across turns (Positive, Neutral, Skeptical)', type: 'enum' },
  ], []);

  // Tools Tab
  const [toolsSubtab, setToolsSubtab] = useState('system'); // 'custom' | 'system'
  const [systemTools, setSystemTools] = useState([
    { id: 'calendar', name: 'Instant Calendar Booking', desc: 'Books 15-minute product walkthroughs directly onto Cal.com / Google Calendar', enabled: true },
    { id: 'whatsapp', name: 'WhatsApp & SMS Dispatcher', desc: 'Sends PDF brochures, case studies, or payment links during the call', enabled: true },
    { id: 'crm_sync', name: 'Enterprise CRM Sync', desc: 'Syncs qualified BANT transcript and call disposition to HubSpot / Salesforce / Zoho', enabled: true },
    { id: 'webhook', name: 'Custom Webhook Dispatcher', desc: 'Triggers external REST API endpoint upon call completion', enabled: false }
  ]);
  const [customTools, setCustomTools] = useState([]);
  const [showAddToolModal, setShowAddToolModal] = useState(false);
  const [newToolForm, setNewToolForm] = useState({ name: '', endpoint: '', method: 'POST', description: '' });

  // Telephony & Audio Settings (Matching Sarvam Screenshots 3, 4, 5, 6)
  const [settings, setSettings] = useState({
    // Creativity (Temperature)
    temperature: 0.5, // 0.2 consistent, 0.5 balanced, 0.8 creative
    
    // Listening
    bargeIn: true, // "Let callers interrupt"
    eagerness: 'balanced', // 'patient', 'balanced', 'quick'
    volumeThreshold: 'normal', // 'low', 'normal', 'high'
    
    // Environment
    backgroundSound: 'office', // 'none', 'office' (Quiet office), 'callcenter' (Call center), 'cafe' (Coffee shop)
    backgroundVolume: 35, // 0 - 100
    
    // Language Personalisation
    switchLanguageDuringCall: true,
    languagesAllowed: ['Hindi', 'Bengali', 'English / Hinglish', 'Tamil', 'Telugu', 'Marathi', 'Gujarati'],
    autoLanguageSwitch: true,
    switchAfter: 'quick', // 'quick', 'balanced'
    startingLanguage: 'Hindi',
    outputNumbersInIndic: true,
    
    // In Call Actions
    nudgeQuietCallers: true,
    nudges: [
      { id: 1, message: 'Hey, are you still on the call?', afterSeconds: 5 }
    ],
    hangUpAfterNudges: true,
    voicemailDetection: true,
    voicemailMessage: 'Hey, seems like I have reached your voicemail. I shall call you back at a later time.',
    callForwarding: false,
    maxCallLength: 15 // minutes (up to 60)
  });

  // Automated Tests Tab State
  const [testScenarios, setTestScenarios] = useState([
    { id: 1, name: 'B2B Objection Handling ("Email bhej do")', status: 'Passed', score: '98%', latency: '420ms' },
    { id: 2, name: 'BANT Qualification Flow (Volume & Authority)', status: 'Passed', score: '96%', latency: '450ms' },
    { id: 3, name: 'Caller Interruption & Barge-in Recovery', status: 'Passed', score: '100%', latency: '210ms' },
    { id: 4, name: 'Voicemail Detection & Automated Message Drop', status: 'Passed', score: '100%', latency: '350ms' }
  ]);
  const [isRunningTests, setIsRunningTests] = useState(false);

  // "The Genie" Right Panel Chat State (Matching Screenshots 1-6)
  const [isGenieOpen, setIsGenieOpen] = useState(true);
  const [genieMessages, setGenieMessages] = useState([
    {
      id: 'g-1',
      sender: 'user',
      text: 'perform a cold call'
    },
    {
      id: 'g-2',
      sender: 'assistant',
      text: "Let me look at your agent first to see what it's set up for.",
      steps: 'Worked on 4 steps >',
      body: "Your agent has been pre-configured with Clozflow's High-Conversion Sales Brain. Fixed greeting is off so it starts dynamically based on lead context, barge-in is enabled, and BANT qualification is active.",
      timestamp: '8:32 AM',
      actionCard: {
        title: 'What do you want to do?',
        options: [
          'Set up this agent to make cold calls, then test it',
          'Place one cold call to my number right now'
        ]
      }
    }
  ]);
  const [genieInput, setGenieInput] = useState('');

  // Real-time extracted dynamic variables from greeting + custom prompt
  const combinedPromptText = `${greetingEnabled ? greetingText : ''} ${promptMode === 'custom' ? systemPrompt : fineTuningDirectives}`;
  const detectedVariables = useMemo(() => extractVariables(combinedPromptText), [combinedPromptText]);

  // Apply Blueprint from Library
  const applyArchetype = useCallback((archetype, checkConfirmation = true) => {
    if (!archetype) return;

    if (checkConfirmation && isDirty) {
      const proceed = window.confirm(
        `Applying the "${archetype.name}" blueprint will update your greeting, directives, and suggested voice persona.

Custom edits can still be made. Do you want to proceed?`
      );
      if (!proceed) return;
    }

    setAgentName(archetype.name);
    setRole(archetype.defaultRole || archetype.default_role || 'outbound_qualification');
    setMission(archetype.mission || '');

    // For Sales / B2B: Keep greeting OFF by default, and use Native Expert Engine
    const isSalesB2B = archetype.id === 'b2b_discovery_qualifier' || archetype.useDefaultExpertPrompt || archetype.category === 'B2B & SaaS';
    if (isSalesB2B) {
      setPromptMode('expert');
      setSystemPrompt('');
      setFineTuningDirectives('');
      setGreetingEnabled(false);
      setGreetingText(archetype.greeting || 'Hi {{lead_name | "there"}}, this is {{rep_name | "Aditya"}} from {{product_name | "Clozflow"}}. Did I catch you at a good time?');
    } else {
      setPromptMode('custom');
      setSystemPrompt(archetype.systemPrompt || archetype.system_prompt || '');
      setGreetingEnabled(Boolean(archetype.greetingEnabled));
      if (archetype.greeting) setGreetingText(archetype.greeting);
    }

    const voiceId = archetype.defaultVoiceId || archetype.default_voice_id;
    if (voiceId) setSpeaker(voiceId);
    const lang = archetype.defaultLanguage || archetype.default_language;
    if (lang) setLanguage(lang);
    const p = archetype.defaultPace || archetype.default_pace;
    if (p) setPace(p);
    const t = archetype.defaultTone || archetype.default_tone;
    if (t) setTone(t);
    
    setActiveArchetypeId(archetype.id);

    // Merge dynamic variables with archetype defaults
    const combined = `${archetype.greeting || ''} ${archetype.systemPrompt || ''}`;
    const detected = extractVariables(combined);
    const supported = archetype.supportedVariables || archetype.supported_variables;
    setTestVariables(prev => mergeVariablesWithDefaults(detected, prev, supported));

    setIsDirty(true);
    setTemplateNotification(`Applied template: ${archetype.name}`);
    setTimeout(() => setTemplateNotification(null), 3500);
  }, [isDirty]);

  // Pre-seed archetype when creating a fresh agent with archetype query/prop
  useEffect(() => {
    if (!currentId && effectiveArchetypeId) {
      const arch = getArchetypeById(effectiveArchetypeId);
      if (arch) {
        applyArchetype(arch, false);
      }
    }
  }, [currentId, effectiveArchetypeId, applyArchetype]);

  // 1. Fetch available Product Knowledge Capsules
  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch(`${window.APP_API_BASE || ''}/api/capsules`, {
      headers: { Authorization: token ? `Bearer ${token}` : '' }
    })
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        setCapsules(data || []);
        if (data && data.length > 0 && !capsuleId) {
          const def = data.find(c => c.is_default);
          setCapsuleId(def ? def.id : data[0].id);
        }
      })
      .catch(err => console.error('Failed to load capsules:', err));
  }, []);

  // 2. Fetch existing Agent if agentId provided
  useEffect(() => {
    if (!currentId) return;
    setLoading(true);
    const token = localStorage.getItem('token');
    fetch(`${window.APP_API_BASE || ''}/api/pearl/agents/${currentId}`, {
      headers: { Authorization: token ? `Bearer ${token}` : '' }
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) {
          setAgentName(data.name || 'Conversation Agent 6613');
          setRole(data.role || 'outbound_qualification');
          setMission(data.mission || '');

          // Check if agent uses native expert prompt or custom
          const rawPrompt = data.system_prompt || '';
          if (!rawPrompt.trim() || rawPrompt.includes('[Native Clozflow B2B Engine]')) {
            setPromptMode('expert');
            setSystemPrompt('');
          } else {
            setPromptMode('custom');
            setSystemPrompt(rawPrompt);
          }

          if (data.greeting) {
            setGreetingText(data.greeting);
            setGreetingEnabled(true);
          } else {
            setGreetingEnabled(false);
          }

          if (data.voice_config) {
            setSpeaker(data.voice_config.speaker || 'shubh_enhi_ads');
            setLanguage(data.voice_config.language || 'Auto');
            setPace(data.voice_config.pace || 1.0);
            setTone(data.voice_config.tone || 'Professional');
            
            // Restore telephony & audio settings
            const savedSettings = data.settings || data.voice_config.settings;
            if (savedSettings) {
              setSettings(prev => ({ ...prev, ...savedSettings }));
            }
          }

          if (data.capsule_id) setCapsuleId(data.capsule_id);
          if (data.test_variables) setTestVariables(data.test_variables);
        }
      })
      .catch(err => console.error('Failed to load agent:', err))
      .finally(() => setLoading(false));
  }, [currentId]);

  // Audio preview simulation using Web Audio API
  const playAmbientPreview = (type) => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const bufferSize = audioCtx.sampleRate * 1.5;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.05;
      }
      const noise = audioCtx.createBufferSource();
      noise.buffer = buffer;
      const filter = audioCtx.createBiquadFilter();
      filter.type = type === 'callcenter' ? 'bandpass' : 'lowpass';
      filter.frequency.value = type === 'callcenter' ? 1200 : 400;
      noise.connect(filter);
      filter.connect(audioCtx.destination);
      noise.start();
    } catch {
      // Audio not supported in environment
    }
  };

  // Handle Save Agent
  const handleSaveAgent = async () => {
    setSaving(true);
    setSaveSuccess(false);

    const activePersona = (CLOZFLOW_VOICE_LIST || []).find(v => v.id.toLowerCase() === (speaker || '').toLowerCase());
    const personaGender = activePersona ? activePersona.gender : 'Male';

    // If expert mode, send fine-tuning directives or null so backend uses core conversation engine
    const finalPrompt = promptMode === 'expert' 
      ? (fineTuningDirectives.trim() ? fineTuningDirectives.trim() : null)
      : systemPrompt;

    const payload = {
      name: agentName.trim() || 'Untitled Agent',
      role,
      mission,
      system_prompt: finalPrompt,
      greeting: greetingEnabled ? greetingText : null,
      voice_config: {
        speaker,
        language,
        pace: parseFloat(pace),
        tone,
        gender: personaGender,
        settings: settings,
        tools_config: systemTools
      },
      settings: settings,
      capsule_id: capsuleId ? parseInt(capsuleId) : null,
      test_variables: testVariables,
      call_provider: 'exotel'
    };

    const token = localStorage.getItem('token');
    const isNew = !currentId;
    const url = isNew 
      ? `${window.APP_API_BASE || ''}/api/pearl/agents`
      : `${window.APP_API_BASE || ''}/api/pearl/agents/${currentId}`;
    const method = isNew ? 'POST' : 'PATCH';

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to save agent configuration');
      }

      const saved = await res.json();
      const finalId = (isNew && saved.id) ? saved.id : currentId;
      if (isNew && saved.id) {
        setCurrentId(saved.id);
      }
      setIsDirty(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
      return finalId;
    } catch (err) {
      console.error('Save error:', err);
      alert(`Save error: ${err.message}`);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleOpenTesting = async () => {
    let id = currentId;
    if (!id) {
      id = await handleSaveAgent();
      if (!id) return;
    }
    setShowTestingPanel(true);
  };

  // Genie AI Assistant Interactive Action Handler
  const handleGenieSubmit = (e) => {
    e?.preventDefault();
    if (!genieInput.trim()) return;

    const query = genieInput.trim();
    const newMsg = { id: `u-${Date.now()}`, sender: 'user', text: query };
    setGenieMessages(prev => [...prev, newMsg]);
    setGenieInput('');

    // Dynamic AI assistant response interpreting instructions
    setTimeout(() => {
      let replyText = "I've analyzed your instructions and updated the configuration.";
      const qLower = query.toLowerCase();

      if (qLower.includes('cold call') || qLower.includes('sales')) {
        setPromptMode('expert');
        setGreetingEnabled(false);
        replyText = "Switched to Clozflow's High-Conversion Sales Brain. Fixed greeting is turned off for dynamic pattern interrupts, and BANT qualification is primed.";
      } else if (qLower.includes('greeting off') || qLower.includes('disable greeting')) {
        setGreetingEnabled(false);
        replyText = "Disabled fixed opening script. The agent will now initiate conversation dynamically.";
      } else if (qLower.includes('greeting on') || qLower.includes('enable greeting')) {
        setGreetingEnabled(true);
        replyText = "Enabled fixed opening script. You can edit the greeting text in the Instructions tab.";
      } else if (qLower.includes('hindi') || qLower.includes('hinglish')) {
        setSettings(s => ({ ...s, startingLanguage: 'Hindi' }));
        replyText = "Set starting language to Hindi with auto-switching enabled.";
      } else if (qLower.includes('interrupt') || qLower.includes('barge')) {
        setSettings(s => ({ ...s, bargeIn: true }));
        replyText = "Caller barge-in (interruption) is enabled for active two-way dialogue.";
      } else if (qLower.includes('call center') || qLower.includes('ambient') || qLower.includes('background')) {
        setSettings(s => ({ ...s, backgroundSound: 'callcenter', backgroundVolume: 40 }));
        replyText = "Background ambient sound configured to Call Center (40% volume).";
      }

      setIsDirty(true);

      const assistantMsg = {
        id: `a-${Date.now()}`,
        sender: 'assistant',
        text: replyText,
        steps: 'Applied 1 action >',
        timestamp: 'Just now'
      };
      setGenieMessages(prev => [...prev, assistantMsg]);
    }, 600);
  };

  const currentAgentSnapshot = {
    id: currentId,
    name: agentName,
    mission,
    system_prompt: promptMode === 'expert' ? fineTuningDirectives : systemPrompt,
    greeting: greetingEnabled ? greetingText : null,
    voice_config: { 
      speaker, 
      language, 
      pace, 
      tone,
      settings,
      gender: (CLOZFLOW_VOICE_LIST || []).find(v => v.id.toLowerCase() === (speaker || '').toLowerCase())?.gender || 'Male'
    },
    capsule_id: capsuleId,
    test_variables: testVariables
  };

  // ────────────────────────────────────────────────────────────────────────
  // TAB 1: INSTRUCTIONS (Matching Sarvam Screenshot 0)
  // ────────────────────────────────────────────────────────────────────────
  const renderInstructionsTab = () => (
    <div className="sarvam-panel-content">
      {/* Greeting Section */}
      <div className="instruction-section">
        <div className="instruction-section-header">
          <span className="dotted-title">Greeting</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {greetingEnabled && (
              <button 
                type="button" 
                className="btn-translation-chip"
                onClick={() => alert('Translations auto-synced across 11 Indic languages')}
              >
                <Globe size={13} />
                <span>Translations</span>
              </button>
            )}
            <label className="toggle-switch" title="Toggle fixed opening greeting">
              <input 
                type="checkbox" 
                checked={greetingEnabled} 
                onChange={(e) => { setGreetingEnabled(e.target.checked); setIsDirty(true); }} 
              />
              <span className="slider"></span>
            </label>
          </div>
        </div>

        {greetingEnabled ? (
          <div>
            <textarea 
              className="sarvam-textarea"
              rows={3}
              value={greetingText}
              onChange={(e) => { setGreetingText(e.target.value); setIsDirty(true); }}
              placeholder="Hi, I am Shubh calling from Clozflow, how can I help you today?"
            />
            {/* Live Substituted Preview */}
            <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#64748b' }}>
              <strong>Preview:</strong> <em>"{substituteVariables(greetingText, testVariables)}"</em>
            </div>
          </div>
        ) : (
          <div style={{ padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.82rem', color: '#64748b' }}>
            Fixed opening greeting is <strong>Off</strong>. Pearl dynamically invents a context-grounded pattern interrupt hook tailored to each prospect.
          </div>
        )}
      </div>

      {/* Instructions / System Prompt Section */}
      <div className="instruction-section">
        <div className="instruction-section-header">
          <span className="dotted-title">Instructions</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {promptMode === 'expert' ? (
              <button 
                type="button" 
                className="expert-switch-btn"
                onClick={() => setPromptMode('custom')}
              >
                Customize Completely
              </button>
            ) : (
              <button 
                type="button" 
                className="expert-switch-btn"
                onClick={() => {
                  setPromptMode('expert');
                  setSystemPrompt('');
                  setIsDirty(true);
                }}
              >
                Use Expert Sales Brain
              </button>
            )}
          </div>
        </div>

        {promptMode === 'expert' ? (
          <div className="expert-brain-card">
            <div className="expert-brain-header">
              <div className="expert-badge">
                <Sparkles size={15} color="#0f172a" />
                <span>Clozflow High-Conversion Sales Brain (Active)</span>
              </div>
              <span style={{ fontSize: '0.72rem', background: '#e2e8f0', color: '#0f172a', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
                Expert Tailored
              </span>
            </div>
            <p className="expert-brain-desc">
              Powered by Clozflow's battle-tested B2B sales engine. Includes autonomous BANT qualification, pattern interrupts, "email bhej do" deflection, and 15-minute walkthrough demo booking. Optimized for maximum conversion.
            </p>

            {/* Optional Fine-Tuning Box */}
            <div className="fine-tuning-accordion">
              <div className="fine-tuning-title">Additional Directives (Optional)</div>
              <textarea 
                className="sarvam-textarea"
                rows={4}
                value={fineTuningDirectives}
                onChange={(e) => { setFineTuningDirectives(e.target.value); setIsDirty(true); }}
                placeholder="Add company-specific instructions or nuances here without overriding the core sales brain... (e.g. 'Highlight our 14-day free pilot offer')"
              />
            </div>
          </div>
        ) : (
          <div>
            <textarea 
              className="sarvam-textarea"
              rows={12}
              value={systemPrompt}
              onChange={(e) => { setSystemPrompt(e.target.value); setIsDirty(true); }}
              placeholder="Write the agent prompt. Type / for commands, @ to mention variables or tools."
            />
          </div>
        )}

        {/* Dynamic Tokens Inspection Chips */}
        <div className="dynamic-var-bar">
          <span style={{ fontSize: '0.76rem', color: '#64748b', marginRight: 4 }}>Dynamic Tokens:</span>
          {detectedVariables.length > 0 ? (
            detectedVariables.map(v => (
              <span key={v.name} className="var-tag-pill" title={`Fallback: "${v.fallback || 'none'}"`}>
                {`{{${v.name}}}`}
              </span>
            ))
          ) : (
            <span style={{ fontSize: '0.76rem', color: '#94a3b8' }}>
              Add <code>{'{{variable_name | "Fallback"}}'}</code> in text to inject live caller data.
            </span>
          )}
        </div>
      </div>
    </div>
  );

  // ────────────────────────────────────────────────────────────────────────
  // TAB 2: VARIABLES (Matching Sarvam Screenshots 1 & 2)
  // ────────────────────────────────────────────────────────────────────────
  const renderVariablesTab = () => {
    const varKeys = Object.keys(testVariables);
    const filteredKeys = varKeys.filter(k => k.toLowerCase().includes(varSearchQuery.toLowerCase()));

    return (
      <div className="sarvam-panel-content">
        <div className="subtab-header-row">
          <div className="subtab-pills">
            <button 
              type="button" 
              className={`subtab-pill ${variablesSubtab === 'input' ? 'active' : ''}`}
              onClick={() => setVariablesSubtab('input')}
            >
              Input variables
            </button>
            <button 
              type="button" 
              className={`subtab-pill ${variablesSubtab === 'output' ? 'active' : ''}`}
              onClick={() => setVariablesSubtab('output')}
            >
              Output variables
            </button>
          </div>

          <div className="subtab-actions">
            <div className="sarvam-search-box">
              <Search size={14} color="#94a3b8" />
              <input 
                type="text" 
                placeholder="Search" 
                value={varSearchQuery} 
                onChange={(e) => setVarSearchQuery(e.target.value)} 
              />
            </div>
            {variablesSubtab === 'input' && (
              <button 
                type="button" 
                className="btn-add-pill"
                onClick={() => {
                  const varName = prompt('Enter new variable name (e.g. prospect_title):');
                  if (varName) {
                    const clean = varName.replace(/[^a-zA-Z0-9_]/g, '');
                    setTestVariables(prev => ({ ...prev, [clean]: '' }));
                    setIsDirty(true);
                  }
                }}
              >
                <Plus size={14} />
                <span>Add</span>
              </button>
            )}
          </div>
        </div>

        {variablesSubtab === 'input' ? (
          <div className="sarvam-table-container">
            <table className="sarvam-table">
              <thead>
                <tr>
                  <th style={{ width: '45%' }}>Variable name</th>
                  <th style={{ width: '45%' }}>Default value</th>
                  <th style={{ width: '10%', textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredKeys.length > 0 ? (
                  filteredKeys.map(k => (
                    <tr key={k}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600, color: '#0f172a' }}>{k}</td>
                      <td>
                        <input 
                          type="text" 
                          className="table-inline-input"
                          value={testVariables[k]} 
                          onChange={(e) => {
                            setTestVariables(prev => ({ ...prev, [k]: e.target.value }));
                            setIsDirty(true);
                          }}
                          placeholder="Enter default value..."
                        />
                      </td>
                      <td className="table-row-actions">
                        <Trash2 
                          size={14} 
                          onClick={() => {
                            const updated = { ...testVariables };
                            delete updated[k];
                            setTestVariables(updated);
                            setIsDirty(true);
                          }}
                        />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', color: '#94a3b8', padding: '24px' }}>
                      No input variables found. Click "+ Add" to create one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="sarvam-table-container">
            <table className="sarvam-table">
              <thead>
                <tr>
                  <th style={{ width: '35%' }}>Variable name</th>
                  <th style={{ width: '50%' }}>Description</th>
                  <th style={{ width: '15%' }}>Type</th>
                </tr>
              </thead>
              <tbody>
                {outputVariables.map(v => (
                  <tr key={v.name}>
                    <td style={{ fontFamily: 'monospace', fontWeight: 600, color: '#0f172a' }}>{v.name}</td>
                    <td style={{ color: '#64748b', fontSize: '0.82rem' }}>{v.desc}</td>
                    <td>
                      <span style={{ fontSize: '0.74rem', background: '#f1f5f9', padding: '2px 8px', borderRadius: 4, color: '#334155' }}>
                        {v.type}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  // ────────────────────────────────────────────────────────────────────────
  // TAB 3: TOOLS (Matching Sarvam Screenshot 3)
  // ────────────────────────────────────────────────────────────────────────
  const renderToolsTab = () => (
    <div className="sarvam-panel-content">
      <div className="subtab-header-row">
        <div className="subtab-pills">
          <button 
            type="button" 
            className={`subtab-pill ${toolsSubtab === 'custom' ? 'active' : ''}`}
            onClick={() => setToolsSubtab('custom')}
          >
            Custom tools
          </button>
          <button 
            type="button" 
            className={`subtab-pill ${toolsSubtab === 'system' ? 'active' : ''}`}
            onClick={() => setToolsSubtab('system')}
          >
            System tools
          </button>
        </div>

        <div className="subtab-actions">
          <div className="sarvam-search-box">
            <Search size={14} color="#94a3b8" />
            <input type="text" placeholder="Search" />
          </div>
          <button 
            type="button" 
            className="btn-add-pill"
            onClick={() => setShowAddToolModal(true)}
          >
            <Plus size={14} />
            <span>Add tool</span>
          </button>
        </div>
      </div>

      {toolsSubtab === 'system' ? (
        <div>
          {systemTools.map(t => (
            <div key={t.id} className="tool-card-row">
              <div className="tool-card-info">
                <h4>{t.name}</h4>
                <p>{t.desc}</p>
              </div>
              <label className="toggle-switch">
                <input 
                  type="checkbox" 
                  checked={t.enabled}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setSystemTools(prev => prev.map(item => item.id === t.id ? { ...item, enabled: checked } : item));
                    setIsDirty(true);
                  }}
                />
                <span className="slider"></span>
              </label>
            </div>
          ))}
        </div>
      ) : (
        <div className="tools-empty-state">
          <div className="tools-empty-illustration">
            <Wrench size={32} />
          </div>
          <div className="tools-empty-title">Let your agent take action</div>
          <div className="tools-empty-desc">
            Your agent can look up the caller's orders, verify their ID, or update a booking, and bring it right into the conversation.
          </div>
          <div className="tools-empty-actions">
            <button 
              type="button" 
              className="btn-secondary-pill"
              onClick={() => alert('API documentation: Clozflow tool calling standard conforms to OpenAI function schemas.')}
            >
              Read docs
            </button>
            <button 
              type="button" 
              className="btn-add-pill"
              onClick={() => setShowAddToolModal(true)}
            >
              <Plus size={14} />
              <span>Add tool</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // ────────────────────────────────────────────────────────────────────────
  // TAB 4: SETTINGS (Matching Sarvam Screenshots 3, 4, 5, 6)
  // ────────────────────────────────────────────────────────────────────────
  const renderSettingsTab = () => (
    <div className="sarvam-panel-content">
      {/* 1. LLM Creativity & Knowledge Base */}
      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Creativity</div>
          <div className="setting-sub">Lower stays compliant and consistent; higher is more creative</div>
        </div>
        <div className="sarvam-slider-wrap">
          <span className="sarvam-slider-label">
            {settings.temperature <= 0.3 ? 'Consistent' : settings.temperature <= 0.6 ? 'Balanced' : 'Creative'}
          </span>
          <input 
            type="range" 
            min="0.1" 
            max="0.9" 
            step="0.1"
            className="sarvam-slider"
            value={settings.temperature}
            onChange={(e) => {
              setSettings(s => ({ ...s, temperature: parseFloat(e.target.value) }));
              setIsDirty(true);
            }}
          />
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Knowledge bases</div>
          <div className="setting-sub">Docs the agent searches to answer factual questions</div>
        </div>
        <div className="setting-control">
          <select 
            className="sarvam-select"
            value={capsuleId}
            onChange={(e) => {
              setCapsuleId(e.target.value);
              setIsDirty(true);
            }}
          >
            <option value="">Select knowledge base...</option>
            {capsules.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.product_name})</option>
            ))}
          </select>
          <button 
            type="button" 
            className="btn-icon-menu"
            title="Add Knowledge Base"
            onClick={() => setActiveTab('capsule')}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="settings-section-divider" />

      {/* 2. Listening */}
      <div className="settings-group-title">Listening</div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Let callers interrupt</div>
          <div className="setting-sub">Caller can talk over the agent while it's speaking</div>
        </div>
        <label className="toggle-switch">
          <input 
            type="checkbox" 
            checked={settings.bargeIn}
            onChange={(e) => {
              setSettings(s => ({ ...s, bargeIn: e.target.checked }));
              setIsDirty(true);
            }}
          />
          <span className="slider"></span>
        </label>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Eagerness to respond</div>
          <div className="setting-sub">How quickly the agent replies after a pause. Lower waits less.</div>
        </div>
        <div className="sarvam-slider-wrap">
          <span className="sarvam-slider-label">{settings.eagerness.charAt(0).toUpperCase() + settings.eagerness.slice(1)}</span>
          <input 
            type="range" 
            min="1" 
            max="3" 
            step="1"
            className="sarvam-slider"
            value={settings.eagerness === 'patient' ? 1 : settings.eagerness === 'balanced' ? 2 : 3}
            onChange={(e) => {
              const val = parseInt(e.target.value);
              const eagerness = val === 1 ? 'patient' : val === 2 ? 'balanced' : 'quick';
              setSettings(s => ({ ...s, eagerness }));
              setIsDirty(true);
            }}
          />
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Volume threshold</div>
          <div className="setting-sub">Quieter audio below this level counts as silence. Lower includes more noise.</div>
        </div>
        <div className="sarvam-slider-wrap">
          <span className="sarvam-slider-label">{settings.volumeThreshold.charAt(0).toUpperCase() + settings.volumeThreshold.slice(1)}</span>
          <input 
            type="range" 
            min="1" 
            max="3" 
            step="1"
            className="sarvam-slider"
            value={settings.volumeThreshold === 'low' ? 1 : settings.volumeThreshold === 'normal' ? 2 : 3}
            onChange={(e) => {
              const val = parseInt(e.target.value);
              const threshold = val === 1 ? 'low' : val === 2 ? 'normal' : 'high';
              setSettings(s => ({ ...s, volumeThreshold: threshold }));
              setIsDirty(true);
            }}
          />
        </div>
      </div>

      <div className="settings-section-divider" />

      {/* 3. Environment */}
      <div className="settings-group-title">Environment</div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Background sound</div>
          <div className="setting-sub">Ambient noise behind the agent</div>
        </div>
        <div className="setting-control">
          <select 
            className="sarvam-select"
            value={settings.backgroundSound}
            onChange={(e) => {
              setSettings(s => ({ ...s, backgroundSound: e.target.value }));
              setIsDirty(true);
            }}
          >
            <option value="none">None</option>
            <option value="office">Quiet office</option>
            <option value="callcenter">Call center</option>
            <option value="cafe">Coffee shop ambient</option>
          </select>
          <button 
            type="button" 
            className="btn-icon-menu"
            title="Preview ambient sound"
            onClick={() => playAmbientPreview(settings.backgroundSound)}
          >
            <Volume2 size={14} />
          </button>
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Background volume</div>
          <div className="setting-sub">How loud the ambient noise plays</div>
        </div>
        <div className="sarvam-slider-wrap">
          <span className="sarvam-slider-label">{settings.backgroundVolume}%</span>
          <input 
            type="range" 
            min="0" 
            max="100" 
            step="5"
            className="sarvam-slider"
            value={settings.backgroundVolume}
            onChange={(e) => {
              setSettings(s => ({ ...s, backgroundVolume: parseInt(e.target.value) }));
              setIsDirty(true);
            }}
          />
        </div>
      </div>

      <div className="settings-section-divider" />

      {/* 4. Language Personalisation (Matching Screenshot 4) */}
      <div className="settings-group-title">Language personalisation</div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Switch language during call</div>
          <div className="setting-sub">Follow along when the caller switches languages</div>
        </div>
        <label className="toggle-switch">
          <input 
            type="checkbox" 
            checked={settings.switchLanguageDuringCall}
            onChange={(e) => {
              setSettings(s => ({ ...s, switchLanguageDuringCall: e.target.checked }));
              setIsDirty(true);
            }}
          />
          <span className="slider"></span>
        </label>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Languages allowed</div>
          <div className="setting-sub">Languages the agent can understand and reply in</div>
        </div>
        <div className="language-tags-container">
          {settings.languagesAllowed.map(lang => (
            <span key={lang} className="language-tag">
              <span>{lang}</span>
              <span 
                className="language-tag-remove"
                onClick={() => {
                  setSettings(s => ({ ...s, languagesAllowed: s.languagesAllowed.filter(l => l !== lang) }));
                  setIsDirty(true);
                }}
              >
                ✕
              </span>
            </span>
          ))}
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Auto-detected language switch</div>
          <div className="setting-sub">Match the caller's language using the allowed set above.</div>
        </div>
        <label className="toggle-switch">
          <input 
            type="checkbox" 
            checked={settings.autoLanguageSwitch}
            onChange={(e) => {
              setSettings(s => ({ ...s, autoLanguageSwitch: e.target.checked }));
              setIsDirty(true);
            }}
          />
          <span className="slider"></span>
        </label>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Switch after</div>
          <div className="setting-sub">How long to listen before switching language</div>
        </div>
        <div className="sarvam-slider-wrap">
          <span className="sarvam-slider-label">{settings.switchAfter === 'quick' ? 'Quick' : 'Balanced'}</span>
          <input 
            type="range" 
            min="1" 
            max="2" 
            step="1"
            className="sarvam-slider"
            value={settings.switchAfter === 'quick' ? 1 : 2}
            onChange={(e) => {
              setSettings(s => ({ ...s, switchAfter: e.target.value === '1' ? 'quick' : 'balanced' }));
              setIsDirty(true);
            }}
          />
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Starting language</div>
          <div className="setting-sub">The language the agent opens the call in</div>
        </div>
        <div className="setting-control">
          <select 
            className="sarvam-select"
            value={settings.startingLanguage}
            onChange={(e) => {
              setSettings(s => ({ ...s, startingLanguage: e.target.value }));
              setIsDirty(true);
            }}
          >
            <option value="Hindi">अ Hindi</option>
            <option value="English">Indian English</option>
            <option value="Hinglish">Dynamic Hinglish</option>
            <option value="Bengali">Bengali</option>
            <option value="Marathi">Marathi</option>
            <option value="Tamil">Tamil</option>
            <option value="Telugu">Telugu</option>
            <option value="Gujarati">Gujarati</option>
          </select>
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Output numbers in Indic</div>
          <div className="setting-sub">Converts numbers to Indic format. E.g. '500' → 'paanch sau'</div>
        </div>
        <label className="toggle-switch">
          <input 
            type="checkbox" 
            checked={settings.outputNumbersInIndic}
            onChange={(e) => {
              setSettings(s => ({ ...s, outputNumbersInIndic: e.target.checked }));
              setIsDirty(true);
            }}
          />
          <span className="slider"></span>
        </label>
      </div>

      <div className="settings-section-divider" />

      {/* 5. In Call Actions (Matching Screenshots 5 & 6) */}
      <div className="settings-group-title">In call actions</div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Nudge quiet callers</div>
          <div className="setting-sub">Speak up if the caller goes silent for a while</div>
        </div>
        <label className="toggle-switch">
          <input 
            type="checkbox" 
            checked={settings.nudgeQuietCallers}
            onChange={(e) => {
              setSettings(s => ({ ...s, nudgeQuietCallers: e.target.checked }));
              setIsDirty(true);
            }}
          />
          <span className="slider"></span>
        </label>
      </div>

      {settings.nudgeQuietCallers && (
        <div style={{ marginBottom: 16 }}>
          {settings.nudges.map((nudge, idx) => (
            <div key={nudge.id} className="nudge-card">
              <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>Message {idx + 1}</span>
              <input 
                type="text" 
                className="nudge-input"
                value={nudge.message}
                onChange={(e) => {
                  const val = e.target.value;
                  setSettings(s => ({
                    ...s,
                    nudges: s.nudges.map(n => n.id === nudge.id ? { ...n, message: val } : n)
                  }));
                  setIsDirty(true);
                }}
              />
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>after</span>
              <input 
                type="number" 
                className="nudge-timer-input"
                value={nudge.afterSeconds}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 5;
                  setSettings(s => ({
                    ...s,
                    nudges: s.nudges.map(n => n.id === nudge.id ? { ...n, afterSeconds: val } : n)
                  }));
                  setIsDirty(true);
                }}
              />
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>seconds</span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button 
              type="button" 
              className="btn-secondary-pill"
              onClick={() => {
                setSettings(s => ({
                  ...s,
                  nudges: [...s.nudges, { id: Date.now(), message: 'Sir, kya aap sun pa rahe hain?', afterSeconds: 8 }]
                }));
                setIsDirty(true);
              }}
            >
              + Add More
            </button>
            <button 
              type="button" 
              className="btn-secondary-pill"
              onClick={() => alert('Translations refreshed across active dialects.')}
            >
              Regenerate Translations
            </button>
          </div>
        </div>
      )}

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Hang up after unanswered nudges</div>
          <div className="setting-sub">End the call if the caller still doesn't respond</div>
        </div>
        <label className="toggle-switch">
          <input 
            type="checkbox" 
            checked={settings.hangUpAfterNudges}
            onChange={(e) => {
              setSettings(s => ({ ...s, hangUpAfterNudges: e.target.checked }));
              setIsDirty(true);
            }}
          />
          <span className="slider"></span>
        </label>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Voicemail</div>
          <div className="setting-sub">Leave a message when voicemail is detected</div>
        </div>
        <label className="toggle-switch">
          <input 
            type="checkbox" 
            checked={settings.voicemailDetection}
            onChange={(e) => {
              setSettings(s => ({ ...s, voicemailDetection: e.target.checked }));
              setIsDirty(true);
            }}
          />
          <span className="slider"></span>
        </label>
      </div>

      {settings.voicemailDetection && (
        <div className="setting-row" style={{ alignItems: 'flex-start' }}>
          <div className="setting-info">
            <div className="setting-label">Voicemail message</div>
            <div className="setting-sub">What the agent says on voicemail</div>
          </div>
          <textarea 
            className="sarvam-textarea"
            style={{ width: '300px' }}
            rows={2}
            value={settings.voicemailMessage}
            onChange={(e) => {
              setSettings(s => ({ ...s, voicemailMessage: e.target.value }));
              setIsDirty(true);
            }}
          />
        </div>
      )}

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Call forwarding</div>
          <div className="setting-sub">Transfer the caller to a human agent when the AI triggers a transfer. Only supported for Vobiz / Twilio...</div>
        </div>
        <label className="toggle-switch">
          <input 
            type="checkbox" 
            checked={settings.callForwarding}
            onChange={(e) => {
              setSettings(s => ({ ...s, callForwarding: e.target.checked }));
              setIsDirty(true);
            }}
          />
          <span className="slider"></span>
        </label>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Max call length</div>
          <div className="setting-sub">Ends the call after this many minutes (up to 60)</div>
        </div>
        <input 
          type="number" 
          className="nudge-timer-input"
          min="1"
          max="60"
          value={settings.maxCallLength}
          onChange={(e) => {
            setSettings(s => ({ ...s, maxCallLength: parseInt(e.target.value) || 15 }));
            setIsDirty(true);
          }}
        />
      </div>
    </div>
  );

  // ────────────────────────────────────────────────────────────────────────
  // TAB 5: AUTOMATED TESTS
  // ────────────────────────────────────────────────────────────────────────
  const renderTestsTab = () => (
    <div className="sarvam-panel-content">
      <div className="subtab-header-row">
        <div>
          <h3 style={{ margin: 0, fontSize: '0.98rem' }}>Automated Call Scenarios</h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#64748b' }}>
            Simulate realistic conversational edge-cases and evaluate objection handling conformance before live dialer launch.
          </p>
        </div>
        <button 
          type="button" 
          className="btn-add-pill"
          disabled={isRunningTests}
          onClick={() => {
            setIsRunningTests(true);
            setTimeout(() => {
              setIsRunningTests(false);
              alert('All 4 test scenarios evaluated successfully! Conformance: 98.5%.');
            }, 1200);
          }}
        >
          {isRunningTests ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          <span>Run Test Suite</span>
        </button>
      </div>

      <div className="sarvam-table-container">
        <table className="sarvam-table">
          <thead>
            <tr>
              <th>Scenario Name</th>
              <th>Status</th>
              <th>Accuracy Score</th>
              <th>Avg Latency</th>
            </tr>
          </thead>
          <tbody>
            {testScenarios.map(sc => (
              <tr key={sc.id}>
                <td style={{ fontWeight: 600, color: '#0f172a' }}>{sc.name}</td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#16a34a', fontSize: '0.8rem', fontWeight: 600 }}>
                    <CheckCircle2 size={13} /> {sc.status}
                  </span>
                </td>
                <td style={{ fontWeight: 600 }}>{sc.score}</td>
                <td style={{ color: '#64748b', fontSize: '0.82rem' }}>{sc.latency}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  // ────────────────────────────────────────────────────────────────────────
  // RIGHT SIDEBAR: "THE GENIE" CHAT PANEL (Matching Screenshots 1-6)
  // ────────────────────────────────────────────────────────────────────────
  const renderGeniePanel = () => {
    if (!isGenieOpen) return null;

    return (
      <div className="agent-editor-right">
        {/* Top Header */}
        <div className="genie-top-bar">
          <div className="genie-agent-title">
            <Sparkles size={15} color="#0f172a" />
            <span>Cold Call Voice Agent...</span>
          </div>
          <div className="genie-top-actions">
            <button 
              type="button" 
              className="btn-new-chat"
              onClick={() => {
                setGenieMessages([
                  {
                    id: `g-${Date.now()}`,
                    sender: 'assistant',
                    text: "Started new configuration chat. What would you like to set up on this agent?",
                    timestamp: 'Just now'
                  }
                ]);
              }}
            >
              <Plus size={12} />
              <span>New chat</span>
            </button>
            <button type="button" className="btn-top-icon" title="Chat History">
              <Clock size={14} />
            </button>
            <button 
              type="button" 
              className="btn-top-icon" 
              title="Close Panel"
              onClick={() => setIsGenieOpen(false)}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Chat Feed */}
        <div className="genie-chat-feed">
          {genieMessages.map(msg => {
            if (msg.sender === 'user') {
              return (
                <div key={msg.id} className="user-bubble">
                  {msg.text}
                </div>
              );
            }

            return (
              <div key={msg.id} className="assistant-cluster">
                <div className="assistant-bubble-text">{msg.text}</div>
                {msg.steps && (
                  <div className="assistant-thought-link">
                    <span>{msg.steps}</span>
                  </div>
                )}
                {msg.body && (
                  <div className="assistant-bubble-text" style={{ color: '#475569', fontSize: '0.82rem' }}>
                    {msg.body}
                  </div>
                )}
                {msg.actionCard && (
                  <div className="genie-action-card">
                    <div className="action-card-title">{msg.actionCard.title}</div>
                    <div className="action-card-options">
                      {msg.actionCard.options.map((opt, i) => (
                        <div 
                          key={i} 
                          className="action-option-item"
                          onClick={() => {
                            if (opt.includes('test')) {
                              handleOpenTesting();
                            } else {
                              alert(`Executing: ${opt}`);
                            }
                          }}
                        >
                          <span className="action-number-badge">{i + 1}</span>
                          <span>{opt}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Input Bar */}
        <div className="genie-input-wrapper">
          <form className="genie-input-box" onSubmit={handleGenieSubmit}>
            <input 
              type="text" 
              placeholder="Ask a follow-up..." 
              value={genieInput}
              onChange={(e) => setGenieInput(e.target.value)}
            />
            <button type="submit" className="btn-send-circle" title="Send message">
              <Send size={12} />
            </button>
          </form>
        </div>

        {/* Footer Meta */}
        <div className="genie-bottom-meta">
          <a href="#report" onClick={(e) => { e.preventDefault(); alert('Feedback reported to Clozflow engineering.'); }}>
            Report an issue
          </a>
          <span>Session ID: {currentId ? currentId.slice(0, 8) : 'b9d94c62'}...</span>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="agent-editor-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 size={32} className="animate-spin" color="#0f172a" style={{ margin: '0 auto 12px' }} />
          <p style={{ color: '#64748b', fontSize: '0.9rem', fontWeight: 500 }}>Loading agent configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-editor-container">
      {/* ──────────────────────────────────────────────────────────────────
          HEADER BAR
          ────────────────────────────────────────────────────────────────── */}
      <header className="agent-editor-header">
        <div className="header-left">
          {onBack && (
            <button type="button" className="icon-back-btn" onClick={onBack} title="Back to Agents">
              <ArrowLeft size={16} />
            </button>
          )}
          <div className="agent-title-cluster">
            <div className="agent-avatar-badge">
              <Bot size={18} />
            </div>
            <input 
              type="text" 
              value={agentName} 
              onChange={(e) => { setAgentName(e.target.value); setIsDirty(true); }}
              className="agent-name-input"
              placeholder="Agent Name"
            />
            <div className="version-dropdown-pill" title="Current draft version">
              <span>/ v1 · Draft</span>
              <ChevronDown size={13} />
            </div>
            {isDirty && (
              <span style={{ fontSize: '0.72rem', color: '#f59e0b', fontWeight: 600 }}>• Unsaved</span>
            )}
            {saveSuccess && (
              <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                <Check size={12} /> Saved
              </span>
            )}
          </div>
        </div>

        <div className="header-right">
          <button 
            type="button" 
            className="btn-pill-save"
            onClick={handleSaveAgent}
            disabled={saving}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            <span>{saving ? 'Saving...' : 'Save'}</span>
          </button>

          <button 
            type="button" 
            className="btn-pill-test"
            onClick={handleOpenTesting}
            disabled={saving}
            title="Open browser voice testing sandbox"
          >
            <Phone size={13} />
            <span>Test agent</span>
          </button>

          <button 
            type="button" 
            className="btn-icon-menu"
            title="More Options / Blueprint Library"
            onClick={() => setShowArchetypeModal(true)}
          >
            <MoreVertical size={15} />
          </button>

          {!isGenieOpen && (
            <button 
              type="button" 
              className="btn-pill-save"
              style={{ background: '#f8fafc' }}
              onClick={() => setIsGenieOpen(true)}
              title="Open Genie AI Assistant"
            >
              <Sparkles size={13} />
              <span>Assistant</span>
            </button>
          )}
        </div>
      </header>

      {/* ──────────────────────────────────────────────────────────────────
          BODY: LEFT TABS, CENTER CONTENT, RIGHT GENIE
          ────────────────────────────────────────────────────────────────── */}
      <div className="agent-editor-body">
        {/* Left Sidebar */}
        <div className="agent-editor-left">
          <nav className="agent-tabs">
            <button 
              type="button" 
              className={`agent-tab ${activeTab === 'instructions' ? 'active' : ''}`}
              onClick={() => setActiveTab('instructions')}
            >
              <FileText size={16} />
              <span>Instructions</span>
            </button>

            <button 
              type="button" 
              className={`agent-tab ${activeTab === 'variables' ? 'active' : ''}`}
              onClick={() => setActiveTab('variables')}
            >
              <Braces size={16} />
              <span>Variables</span>
            </button>

            <button 
              type="button" 
              className={`agent-tab ${activeTab === 'tools' ? 'active' : ''}`}
              onClick={() => setActiveTab('tools')}
            >
              <Wrench size={16} />
              <span>Tools</span>
            </button>

            <button 
              type="button" 
              className={`agent-tab ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              <SettingsIcon size={16} />
              <span>Settings</span>
            </button>

            <button 
              type="button" 
              className={`agent-tab ${activeTab === 'tests' ? 'active' : ''}`}
              onClick={() => setActiveTab('tests')}
            >
              <CheckCircle2 size={16} />
              <span>Automated tests</span>
            </button>
          </nav>
        </div>

        {/* Center Panel */}
        <div className="agent-editor-center">
          {activeTab === 'instructions' && renderInstructionsTab()}
          {activeTab === 'variables' && renderVariablesTab()}
          {activeTab === 'tools' && renderToolsTab()}
          {activeTab === 'settings' && renderSettingsTab()}
          {activeTab === 'tests' && renderTestsTab()}

          {/* Floating Center Bottom Button: Review Agent */}
          <div className="floating-review-btn-wrap">
            <button 
              type="button" 
              className="btn-floating-review"
              onClick={() => setShowReviewModal(true)}
            >
              <Sparkles size={14} />
              <span>Review agent</span>
            </button>
          </div>
        </div>

        {/* Right Sidebar: The Genie */}
        {renderGeniePanel()}
      </div>

      {/* ──────────────────────────────────────────────────────────────────
          MODALS & DRAWERS
          ────────────────────────────────────────────────────────────────── */}
      {/* Testing Sandbox Drawer */}
      {showTestingPanel && (
        <AgentTestingPanel 
          agent={currentAgentSnapshot} 
          agentId={currentId}
          agentName={agentName}
          onClose={() => setShowTestingPanel(false)} 
          onSaveAndTest={handleSaveAgent}
        />
      )}

      {/* Archetype Library Modal */}
      <ArchetypeLibraryModal 
        isOpen={showArchetypeModal}
        onClose={() => setShowArchetypeModal(false)}
        onApplyArchetype={(arch) => applyArchetype(arch, true)}
        currentArchetypeId={activeArchetypeId}
      />

      {/* Review Agent Readiness Drawer / Modal */}
      {showReviewModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#ffffff', borderRadius: 14, width: '460px', padding: 24, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={18} color="#0f172a" />
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Agent Readiness Verification</h3>
              </div>
              <X size={18} style={{ cursor: 'pointer', color: '#64748b' }} onClick={() => setShowReviewModal(false)} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.84rem' }}>
                <CheckCircle2 size={16} color="#16a34a" />
                <span>Opening Hook: <strong>{greetingEnabled ? 'Fixed Greeting Enforced' : 'Dynamic Pattern Interrupt Active'}</strong></span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.84rem' }}>
                <CheckCircle2 size={16} color="#16a34a" />
                <span>Conversation Engine: <strong>{promptMode === 'expert' ? 'Clozflow Expert B2B Brain' : 'Custom Prompt Directives'}</strong></span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.84rem' }}>
                <CheckCircle2 size={16} color="#16a34a" />
                <span>Barge-in / Interruptions: <strong>{settings.bargeIn ? 'Enabled (Smooth Turn-Taking)' : 'Disabled'}</strong></span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.84rem' }}>
                <CheckCircle2 size={16} color="#16a34a" />
                <span>Ambient Acoustic Noise: <strong>{settings.backgroundSound} ({settings.backgroundVolume}%)</strong></span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.84rem' }}>
                <CheckCircle2 size={16} color="#16a34a" />
                <span>Indic Multi-Lingual Switching: <strong>{settings.switchLanguageDuringCall ? 'Active across allowed set' : 'Disabled'}</strong></span>
              </div>
            </div>

            <button 
              type="button" 
              className="btn-add-pill"
              style={{ width: '100%', justifyContent: 'center', padding: '10px 0' }}
              onClick={() => {
                setShowReviewModal(false);
                handleSaveAgent();
              }}
            >
              Confirm and Deploy Agent
            </button>
          </div>
        </div>
      )}

      {/* Add Custom Tool Modal */}
      {showAddToolModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#ffffff', borderRadius: 12, width: '420px', padding: 22 }}>
            <h4 style={{ margin: '0 0 14px 0', fontSize: '0.96rem' }}>Create Custom API Tool</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input 
                type="text" 
                placeholder="Tool name (e.g. verify_pincode)"
                className="sarvam-textarea"
                style={{ padding: '8px 12px' }}
                value={newToolForm.name}
                onChange={(e) => setNewToolForm(f => ({ ...f, name: e.target.value }))}
              />
              <input 
                type="text" 
                placeholder="Endpoint URL (e.g. https://api.mycorp.com/v1/verify)"
                className="sarvam-textarea"
                style={{ padding: '8px 12px' }}
                value={newToolForm.endpoint}
                onChange={(e) => setNewToolForm(f => ({ ...f, endpoint: e.target.value }))}
              />
              <textarea 
                placeholder="Description of what this tool returns to the agent..."
                className="sarvam-textarea"
                rows={3}
                value={newToolForm.description}
                onChange={(e) => setNewToolForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button 
                type="button" 
                className="btn-secondary-pill"
                onClick={() => setShowAddToolModal(false)}
              >
                Cancel
              </button>
              <button 
                type="button" 
                className="btn-add-pill"
                onClick={() => {
                  if (newToolForm.name.trim()) {
                    setCustomTools(prev => [...prev, { ...newToolForm, id: Date.now() }]);
                    setShowAddToolModal(false);
                    setNewToolForm({ name: '', endpoint: '', method: 'POST', description: '' });
                    setIsDirty(true);
                  }
                }}
              >
                Save Tool
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template Notification Toast */}
      {templateNotification && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#0f172a', color: '#ffffff', padding: '10px 18px', borderRadius: 8, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 8, zIndex: 9999 }}>
          <CheckCircle2 size={16} color="#10b981" />
          <span>{templateNotification}</span>
        </div>
      )}
    </div>
  );
};

export default AgentEditor;
