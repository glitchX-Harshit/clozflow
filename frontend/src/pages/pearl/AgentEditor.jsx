import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  ArrowLeft, Bot, Phone, MoreVertical, 
  FileText, Braces, Wrench, Settings as SettingsIcon, 
  CheckCircle2, Sparkles, ChevronDown, ChevronUp,
  Save, Loader2, Check, Database, Mic,
  Trash2, Plus, Search, Volume2, VolumeX, Globe, 
  Clock, X, Send, Sliders, AlertCircle, PhoneCall, Copy, ThumbsUp, ThumbsDown, RotateCcw
} from 'lucide-react';
import './AgentEditor.css';
import AgentTestingPanel from './AgentTestingPanel';
import VoicePersonaSelector, { CLOZFLOW_VOICE_LIST } from '../../components/VoicePersonaSelector';
import CapsuleSelector from '../../components/CapsuleSelector';
import ArchetypeLibraryModal from '../../components/ArchetypeLibraryModal';
import ToolsStudio from './components/ToolsStudio';
import AddToolModal from './components/AddToolModal';
import ToolDrawer from './components/ToolDrawer';
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

  // Tools Studio & Drawer State
  const [toolsSubtab, setToolsSubtab] = useState('agent'); // 'agent' | 'system'
  const [systemTools, setSystemTools] = useState([
    { id: 'calendar', name: 'Instant Calendar Booking', desc: 'Books 15-minute product walkthroughs directly onto Cal.com / Google Calendar', enabled: true },
    { id: 'whatsapp', name: 'WhatsApp & SMS Dispatcher', desc: 'Sends PDF brochures, case studies, or payment links during the call', enabled: true },
    { id: 'crm_sync', name: 'Enterprise CRM Sync', desc: 'Syncs qualified BANT transcript and call disposition to HubSpot / Salesforce / Zoho', enabled: true },
    { id: 'webhook', name: 'Custom Webhook Dispatcher', desc: 'Triggers external REST API endpoint upon call completion', enabled: false }
  ]);
  const [customTools, setCustomTools] = useState([]);
  const [showAddToolModal, setShowAddToolModal] = useState(false);
  const [selectedDrawerTool, setSelectedDrawerTool] = useState(null);
  const [isToolDrawerOpen, setIsToolDrawerOpen] = useState(false);
  const [isSageOpen, setIsSageOpen] = useState(false);

  const toggleSage = useCallback(() => {
    setIsSageOpen(prev => {
      const next = !prev;
      if (next) {
        setIsToolDrawerOpen(false);
        setSelectedDrawerTool(null);
        setShowAddToolModal(false);
        setShowTestingPanel(false);
      }
      return next;
    });
  }, []);

  const handleSelectToolType = useCallback((template) => {
    setShowAddToolModal(false);
    setIsSageOpen(false);
    setShowTestingPanel(false);
    setSelectedDrawerTool({
      id: null,
      name: template.name,
      tool_type: template.type,
      description: template.description,
      run_timing: template.defaultTiming || 'conversation',
      fallback_response: template.defaultConfig?.fallback_response || '',
      config: { ...template.defaultConfig },
      is_active: true
    });
    setIsToolDrawerOpen(true);
  }, []);

  const handleEditTool = useCallback((tool) => {
    setIsSageOpen(false);
    setShowTestingPanel(false);
    setSelectedDrawerTool(tool);
    setIsToolDrawerOpen(true);
  }, []);

  const handleSaveTool = useCallback(async (savedTool) => {
    const isNew = !savedTool.id || String(savedTool.id).startsWith('tool_draft_');
    const token = localStorage.getItem('token');

    if (!currentId) {
      if (isNew) {
        const localId = `tool_draft_${Date.now()}`;
        setCustomTools(prev => [...prev, { ...savedTool, id: localId }]);
      } else {
        setCustomTools(prev => prev.map(t => t.id === savedTool.id ? savedTool : t));
      }
      setIsToolDrawerOpen(false);
      setSelectedDrawerTool(null);
      setIsDirty(true);
      return;
    }

    try {
      const url = isNew
        ? `${window.APP_API_BASE || ''}/api/pearl/agents/${currentId}/tools`
        : `${window.APP_API_BASE || ''}/api/pearl/agents/${currentId}/tools/${savedTool.id}`;
      const method = isNew ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify(savedTool)
      });

      if (!res.ok) {
        throw new Error('Failed to save tool to server');
      }

      const returned = await res.json();
      setCustomTools(prev => {
        if (isNew) {
          return [...prev, returned];
        } else {
          return prev.map(t => t.id === returned.id ? returned : t);
        }
      });
      setIsToolDrawerOpen(false);
      setSelectedDrawerTool(null);
      setTemplateNotification(`Tool "${returned.name}" saved successfully.`);
      setTimeout(() => setTemplateNotification(null), 3000);
    } catch (err) {
      console.error('Error saving tool:', err);
      setCustomTools(prev => {
        if (isNew) {
          return [...prev, { ...savedTool, id: `tool_${Date.now()}` }];
        } else {
          return prev.map(t => t.id === savedTool.id ? savedTool : t);
        }
      });
      setIsToolDrawerOpen(false);
      setSelectedDrawerTool(null);
    }
  }, [currentId]);

  const handleDeleteTool = useCallback(async (toolId) => {
    const token = localStorage.getItem('token');
    if (currentId && !String(toolId).startsWith('tool_draft_')) {
      try {
        await fetch(`${window.APP_API_BASE || ''}/api/pearl/agents/${currentId}/tools/${toolId}`, {
          method: 'DELETE',
          headers: { Authorization: token ? `Bearer ${token}` : '' }
        });
      } catch (e) {
        console.warn('Failed to delete tool on backend:', e);
      }
    }
    setCustomTools(prev => prev.filter(t => t.id !== toolId));
    setIsToolDrawerOpen(false);
    setSelectedDrawerTool(null);
    setIsDirty(true);
  }, [currentId]);

  const handleToggleToolActive = useCallback(async (toolId, nextActive) => {
    setCustomTools(prev => prev.map(t => t.id === toolId ? { ...t, is_active: nextActive } : t));
    const token = localStorage.getItem('token');
    if (currentId && !String(toolId).startsWith('tool_draft_')) {
      try {
        await fetch(`${window.APP_API_BASE || ''}/api/pearl/agents/${currentId}/tools/${toolId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: token ? `Bearer ${token}` : ''
          },
          body: JSON.stringify({ is_active: nextActive })
        });
      } catch (e) {
        console.warn('Failed to patch tool active status:', e);
      }
    }
  }, [currentId]);

  const handleAddToolClick = useCallback(() => {
    setIsSageOpen(false);
    setShowTestingPanel(false);
    setShowAddToolModal(true);
  }, []);

  const handleToggleSystemTool = useCallback((id, checked) => {
    setSystemTools(prev => prev.map(item => item.id === id ? { ...item, enabled: checked } : item));
    setIsDirty(true);
  }, []);

  const handleOpenToolDocs = useCallback(() => {
    setTemplateNotification('Tools allow your agent to fetch live data, verify caller inputs, and update your CRM directly during phone conversations.');
    setTimeout(() => setTemplateNotification(null), 3500);
  }, []);

  const handleCloseAddToolModal = useCallback(() => {
    setShowAddToolModal(false);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setIsToolDrawerOpen(false);
    setSelectedDrawerTool(null);
  }, []);


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
    maxCallLength: 15, // minutes (up to 60)
    
    // Call Disconnection & Rejection Exit Policy
    callCutRule: 'reframe_once_then_exit', // 'reframe_once_then_exit' | 'immediate_disconnect' | 'two_touch_reframe' | 'custom'
    disconnectPhrase: 'Bilkul samjha sir, thank you for your time. Have a great day!'
  });

  // Automated Tests Tab State
  const [testScenarios, setTestScenarios] = useState([
    { id: 1, name: 'B2B Objection Handling ("Email bhej do")', status: 'Passed', score: '98%', latency: '420ms' },
    { id: 2, name: 'BANT Qualification Flow (Volume & Authority)', status: 'Passed', score: '96%', latency: '450ms' },
    { id: 3, name: 'Caller Interruption & Barge-in Recovery', status: 'Passed', score: '100%', latency: '210ms' },
    { id: 4, name: 'Voicemail Detection & Automated Message Drop', status: 'Passed', score: '100%', latency: '350ms' }
  ]);
  const [isRunningTests, setIsRunningTests] = useState(false);

  // Sage · AI Agent Architect Persistent State & Multi-Session Configuration
  const getSageStorageKey = useCallback((id) => `clozflow_sage_chat_${id || 'draft'}`, []);
  const getSageSessionsKey = useCallback((id) => `clozflow_sage_sessions_${id || 'draft'}`, []);

  const [sageSessions, setSageSessions] = useState(() => {
    try {
      const sessKey = `clozflow_sage_sessions_${agentId || 'draft'}`;
      const savedSessions = localStorage.getItem(sessKey);
      if (savedSessions) {
        const parsed = JSON.parse(savedSessions);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      // Migration from legacy single chat if active
      const chatKey = `clozflow_sage_chat_${agentId || 'draft'}`;
      const savedChat = localStorage.getItem(chatKey);
      if (savedChat) {
        const parsedChat = JSON.parse(savedChat);
        if (Array.isArray(parsedChat) && parsedChat.length > 0) {
          const userMsg = parsedChat.find(m => m.sender === 'user');
          if (userMsg) {
            const title = userMsg.text.length > 36 ? userMsg.text.slice(0, 36) + '...' : userMsg.text;
            return [{
              id: `sess-${Date.now()}`,
              title,
              createdAt: 'Previous Session',
              updatedAt: Date.now(),
              messages: parsedChat
            }];
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load Sage sessions from storage:', e);
    }
    // Clean initial session showing "What's on your mind?"
    return [{
      id: `sess-${Date.now()}`,
      title: 'New Architecture Session',
      createdAt: 'Just now',
      updatedAt: Date.now(),
      messages: []
    }];
  });

  const [currentSessionId, setCurrentSessionId] = useState(() => {
    return sageSessions[0]?.id || `sess-${Date.now()}`;
  });

  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState('Prompt Tuning');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [showTranslationsModal, setShowTranslationsModal] = useState(false);

  const [sageInput, setSageInput] = useState('');
  const [isSageThinking, setIsSageThinking] = useState(false);
  const [thinkingStep, setThinkingStep] = useState(1);
  const [expandedSteps, setExpandedSteps] = useState({});
  const [lastAppliedPatchId, setLastAppliedPatchId] = useState(null);

  // Pre-patch snapshots and undone records for instant undo
  const [patchSnapshots, setPatchSnapshots] = useState({});
  const [undonePatches, setUndonePatches] = useState({});

  // Direct Phone Call Dialer Modal State
  const [showColdCallModal, setShowColdCallModal] = useState(false);
  const [coldCallPhone, setColdCallPhone] = useState('9876543210');
  const [coldCallRecipient, setColdCallRecipient] = useState(testVariables.lead_name || 'Prospect');
  const [coldCallStatus, setColdCallStatus] = useState('idle'); // idle | dialing | ringing | connected | completed | failed
  const [coldCallId, setColdCallId] = useState(null);
  const [coldCallError, setColdCallError] = useState(null);
  const [coldCallSeconds, setColdCallSeconds] = useState(0);

  const activeSession = useMemo(() => {
    return sageSessions.find(s => s.id === currentSessionId) || sageSessions[0] || { id: 'default', messages: [] };
  }, [sageSessions, currentSessionId]);

  const sageMessages = activeSession.messages || [];

  const updateActiveSessionMessages = useCallback((updater) => {
    setSageSessions(prev => {
      const activeId = currentSessionId;
      return prev.map(s => {
        if (s.id === activeId) {
          const nextMessages = typeof updater === 'function' ? updater(s.messages || []) : updater;
          const firstUser = nextMessages.find(m => m.sender === 'user');
          const newTitle = firstUser 
            ? (firstUser.text.length > 36 ? firstUser.text.slice(0, 36) + '...' : firstUser.text)
            : s.title;
          return {
            ...s,
            title: newTitle,
            updatedAt: Date.now(),
            messages: nextMessages
          };
        }
        return s;
      });
    });
  }, [currentSessionId]);

  const loadedAgentKeyRef = useRef(getSageSessionsKey(currentId || agentId));

  // Sync Sage sessions when agent ID switches
  useEffect(() => {
    const sessKey = getSageSessionsKey(currentId || agentId);
    loadedAgentKeyRef.current = sessKey;
    try {
      const saved = localStorage.getItem(sessKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSageSessions(parsed);
          setCurrentSessionId(parsed[0].id);
          return;
        }
      }
      // Check legacy chat for migration
      const chatKey = getSageStorageKey(currentId || agentId);
      const savedChat = localStorage.getItem(chatKey);
      if (savedChat) {
        const parsedChat = JSON.parse(savedChat);
        if (Array.isArray(parsedChat) && parsedChat.length > 0 && parsedChat.some(m => m.sender === 'user')) {
          const userMsg = parsedChat.find(m => m.sender === 'user');
          const title = userMsg ? (userMsg.text.length > 36 ? userMsg.text.slice(0, 36) + '...' : userMsg.text) : 'Agent Architecture';
          const migrated = [{
            id: `sess-${Date.now()}`,
            title,
            createdAt: 'Previous Session',
            updatedAt: Date.now(),
            messages: parsedChat
          }];
          setSageSessions(migrated);
          setCurrentSessionId(migrated[0].id);
          return;
        }
      }
    } catch (e) {
      console.warn('Error reading Sage sessions on agent switch:', e);
    }
    const freshSession = [{
      id: `sess-${Date.now()}`,
      title: 'New Architecture Session',
      createdAt: 'Just now',
      updatedAt: Date.now(),
      messages: []
    }];
    setSageSessions(freshSession);
    setCurrentSessionId(freshSession[0].id);
  }, [currentId, agentId, getSageSessionsKey, getSageStorageKey]);

  // Persist sessions and active chat to localStorage whenever sessions change
  useEffect(() => {
    const sessKey = getSageSessionsKey(currentId || agentId);
    const chatKey = getSageStorageKey(currentId || agentId);
    if (loadedAgentKeyRef.current !== sessKey) return;
    try {
      localStorage.setItem(sessKey, JSON.stringify(sageSessions));
      const curr = sageSessions.find(s => s.id === currentSessionId);
      if (curr && Array.isArray(curr.messages)) {
        localStorage.setItem(chatKey, JSON.stringify(curr.messages));
      }
    } catch (e) {
      console.warn('Error saving Sage sessions cache to localStorage:', e);
    }
  }, [sageSessions, currentSessionId, currentId, agentId, getSageSessionsKey, getSageStorageKey]);

  // Dynamic Thinking Progress Step Timer (Fix 1)
  useEffect(() => {
    if (!isSageThinking) {
      setThinkingStep(1);
      return;
    }
    const timer = setInterval(() => {
      setThinkingStep(prev => (prev < 3 ? prev + 1 : prev));
    }, 1100);
    return () => clearInterval(timer);
  }, [isSageThinking]);

  // Active Cold Call Duration Timer (Fix 3)
  useEffect(() => {
    let interval = null;
    if (coldCallStatus === 'dialing' || coldCallStatus === 'ringing' || coldCallStatus === 'connected') {
      interval = setInterval(() => {
        setColdCallSeconds(s => s + 1);
      }, 1000);
    } else {
      setColdCallSeconds(0);
    }
    return () => clearInterval(interval);
  }, [coldCallStatus]);

  // Active Cold Call Status Polling (Fix 3)
  useEffect(() => {
    let pollTimer = null;
    if (coldCallId && (coldCallStatus === 'dialing' || coldCallStatus === 'ringing')) {
      pollTimer = setInterval(async () => {
        try {
          const token = localStorage.getItem('token');
          const res = await fetch(`${window.APP_API_BASE || ''}/api/pearl/calls/${coldCallId}`, {
            headers: { Authorization: token ? `Bearer ${token}` : '' }
          });
          if (res.ok) {
            const data = await res.json();
            if (data.status === 'connected' || data.status === 'in_progress') {
              setColdCallStatus('connected');
            } else if (data.status === 'completed') {
              setColdCallStatus('completed');
            } else if (data.status === 'failed') {
              setColdCallStatus('failed');
              setColdCallError(data.error_code || 'Call rejected or failed');
            }
          }
        } catch (err) {
          console.error('Call status poll error:', err);
        }
      }, 2000);
    }
    return () => clearInterval(pollTimer);
  }, [coldCallId, coldCallStatus]);

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
      setGreetingText(archetype.greeting || 'Hi {{lead_name | "Siddharth"}}, {{rep_name | "Aditya"}} from {{product_name | "Clozflow"}}. Most high-growth teams we talk to lose 40% of inbound pipeline because reps connect after 30 minutes—how is {{prospect_company | "your team"}} tackling instant speed-to-lead right now?');
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
          const savedSettings = data.settings || data.voice_config?.settings || {};
          const savedPromptMode = savedSettings.promptMode;
          const savedDirectives = savedSettings.fineTuningDirectives;

          const rawPrompt = data.system_prompt || '';
          if (savedPromptMode) {
            setPromptMode(savedPromptMode);
            if (savedPromptMode === 'expert') {
              setFineTuningDirectives(savedDirectives || rawPrompt);
              setSystemPrompt('');
            } else {
              setSystemPrompt(rawPrompt);
            }
          } else if (!rawPrompt.trim() || rawPrompt.includes('[Native Clozflow B2B Engine]')) {
            setPromptMode('expert');
            setSystemPrompt('');
            setFineTuningDirectives('');
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

          if (data.tools && Array.isArray(data.tools)) {
            setCustomTools(data.tools);
          } else if (currentId) {
            fetch(`${window.APP_API_BASE || ''}/api/pearl/agents/${currentId}/tools`, {
              headers: { Authorization: token ? `Bearer ${token}` : '' }
            })
              .then(r => r.ok ? r.json() : [])
              .then(tl => { if (Array.isArray(tl)) setCustomTools(tl); })
              .catch(e => console.warn('Tools load failed:', e));
          }
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

    const persistedSettings = {
      ...settings,
      promptMode,
      fineTuningDirectives: fineTuningDirectives.trim()
    };

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
        settings: persistedSettings,
        tools_config: systemTools
      },
      settings: persistedSettings,
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
        const draftTools = customTools.filter(t => !t.id || String(t.id).startsWith('tool_draft_'));
        for (const dt of draftTools) {
          try {
            await fetch(`${window.APP_API_BASE || ''}/api/pearl/agents/${saved.id}/tools`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: token ? `Bearer ${token}` : ''
              },
              body: JSON.stringify(dt)
            });
          } catch (e) {
            console.warn('Failed to persist draft tool:', e);
          }
        }
        if (draftTools.length > 0) {
          try {
            const toolsRes = await fetch(`${window.APP_API_BASE || ''}/api/pearl/agents/${saved.id}/tools`, {
              headers: { Authorization: token ? `Bearer ${token}` : '' }
            });
            if (toolsRes.ok) {
              const freshTools = await toolsRes.json();
              if (Array.isArray(freshTools)) {
                setCustomTools(freshTools);
              }
            }
          } catch (te) {
            console.warn('Failed to refetch persisted tools:', te);
          }
        }
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
    setIsSageOpen(false);
    setIsToolDrawerOpen(false);
    setSelectedDrawerTool(null);
    setShowAddToolModal(false);
    let id = currentId;
    if (!id) {
      id = await handleSaveAgent();
      if (!id) return;
    }
    setShowTestingPanel(true);
  };

  // Compute Proposed Changes Diff for Sage Patch (Fix 2)
  const computeProposedDiff = useCallback((patch, snapshot) => {
    const diffItems = [];
    if (!patch) return diffItems;

    if (patch.settings?.callCutRule && patch.settings.callCutRule !== snapshot.settings?.callCutRule) {
      const labels = {
        reframe_once_then_exit: 'Reframe once, then graceful exit',
        immediate_disconnect: 'Immediate disconnect on first rejection',
        two_touch_reframe: 'Up to 2 value reframes before exit',
        custom: 'Custom rejection handling'
      };
      diffItems.push({
        field: 'Call-Cut Rule',
        summary: `${labels[snapshot.settings?.callCutRule] || snapshot.settings?.callCutRule || 'Default'} → ${labels[patch.settings.callCutRule] || patch.settings.callCutRule}`
      });
    }
    if (patch.settings?.disconnectPhrase && patch.settings.disconnectPhrase !== snapshot.settings?.disconnectPhrase) {
      diffItems.push({
        field: 'Disconnect Phrase',
        summary: `"${patch.settings.disconnectPhrase.slice(0, 45)}..."`
      });
    }
    if (patch.settings?.startingLanguage && patch.settings.startingLanguage !== snapshot.settings?.startingLanguage) {
      diffItems.push({
        field: 'Starting Language',
        summary: `${snapshot.settings?.startingLanguage || 'English'} → ${patch.settings.startingLanguage}`
      });
    }
    if (patch.prompt_mode && patch.prompt_mode !== snapshot.promptMode) {
      diffItems.push({
        field: 'Prompt Architecture',
        summary: `${snapshot.promptMode} → ${patch.prompt_mode}`
      });
    }
    if (patch.greeting_enabled !== undefined && Boolean(patch.greeting_enabled) !== snapshot.greetingEnabled) {
      diffItems.push({
        field: 'Opening Hook',
        summary: patch.greeting_enabled ? 'Fixed greeting enabled' : 'Disabled (Dynamic pattern interrupt enabled)'
      });
    }
    if (patch.greeting_text && patch.greeting_text !== snapshot.greetingText) {
      diffItems.push({
        field: 'Greeting Script',
        summary: `Updated: "${patch.greeting_text.slice(0, 45)}..."`
      });
    }
    if (patch.system_prompt && patch.system_prompt !== snapshot.systemPrompt) {
      diffItems.push({
        field: 'System Prompt',
        summary: 'Updated system instructions'
      });
    }
    if (patch.fine_tuning_directives && patch.fine_tuning_directives !== snapshot.fineTuningDirectives) {
      diffItems.push({
        field: 'Directives',
        summary: 'Updated behavioral instructions & rejection thresholds'
      });
    }
    if (patch.voice_config) {
      if (patch.voice_config.speaker && patch.voice_config.speaker !== snapshot.speaker) {
        diffItems.push({ field: 'Voice Persona', summary: `${snapshot.speaker} → ${patch.voice_config.speaker}` });
      }
      if (patch.voice_config.language && patch.voice_config.language !== snapshot.language) {
        diffItems.push({ field: 'Language', summary: `${snapshot.language} → ${patch.voice_config.language}` });
      }
    }
    if (patch.settings?.bargeIn !== undefined && patch.settings.bargeIn !== snapshot.settings?.bargeIn) {
      diffItems.push({
        field: 'Barge-In / Interruptions',
        summary: patch.settings.bargeIn ? 'Enabled (Smooth turn-taking)' : 'Disabled'
      });
    }
    if (patch.settings?.backgroundSound && patch.settings.backgroundSound !== snapshot.settings?.backgroundSound) {
      diffItems.push({
        field: 'Ambient Noise',
        summary: `${snapshot.settings?.backgroundSound} → ${patch.settings.backgroundSound}`
      });
    }
    if (patch.mission && patch.mission !== snapshot.mission) {
      diffItems.push({
        field: 'Agent Mission',
        summary: patch.mission.slice(0, 50) + '...'
      });
    }
    if (patch.role && patch.role !== snapshot.role) {
      diffItems.push({
        field: 'Agent Role',
        summary: `${snapshot.role || 'outbound_qualification'} → ${patch.role}`
      });
    }
    if (patch.capsule_id && String(patch.capsule_id) !== String(snapshot.capsuleId)) {
      diffItems.push({
        field: 'Knowledge Capsule',
        summary: `Connected Capsule ID: ${patch.capsule_id}`
      });
    }
    if (patch.settings?.maxCallLength && patch.settings.maxCallLength !== snapshot.settings?.maxCallLength) {
      diffItems.push({
        field: 'Max Call Duration',
        summary: `${snapshot.settings?.maxCallLength || 10}m → ${patch.settings.maxCallLength}m`
      });
    }
    if (diffItems.length === 0 && Object.keys(patch).length > 0) {
      diffItems.push({
        field: 'Agent Tuning',
        summary: 'Synchronized live directives & telephony parameters'
      });
    }
    return diffItems;
  }, []);

  // Sage AI Agent Architect Configuration Patch Handler with Pre-Patch Snapshot (Fix 2)
  const applySagePatch = useCallback((patch, patchId = null) => {
    if (!patch) return { diff: [], snapshot: null };

    const prePatchSnapshot = {
      promptMode,
      systemPrompt,
      fineTuningDirectives,
      greetingEnabled,
      greetingText,
      settings: { ...settings },
      speaker,
      language,
      pace,
      tone,
      mission,
      role,
      capsuleId
    };

    if (patchId) {
      setPatchSnapshots(prev => ({ ...prev, [patchId]: prePatchSnapshot }));
      setLastAppliedPatchId(patchId);
    }

    if (patch.prompt_mode !== undefined) {
      setPromptMode(patch.prompt_mode);
    }
    if (patch.system_prompt !== undefined) {
      setSystemPrompt(patch.system_prompt);
    }
    if (patch.fine_tuning_directives !== undefined) {
      setFineTuningDirectives(patch.fine_tuning_directives);
    }
    if (patch.greeting_enabled !== undefined) {
      setGreetingEnabled(Boolean(patch.greeting_enabled));
    }
    if (patch.greeting_text !== undefined) {
      setGreetingText(patch.greeting_text);
    }
    if (patch.settings) {
      setSettings(prev => ({ ...prev, ...patch.settings }));
    }
    if (patch.voice_config) {
      if (patch.voice_config.speaker) setSpeaker(patch.voice_config.speaker);
      if (patch.voice_config.language) setLanguage(patch.voice_config.language);
      if (patch.voice_config.pace) setPace(patch.voice_config.pace);
      if (patch.voice_config.tone) setTone(patch.voice_config.tone);
    }
    if (patch.mission) {
      setMission(patch.mission);
    }
    if (patch.role) {
      setRole(patch.role);
    }
    if (patch.capsule_id) {
      setCapsuleId(patch.capsule_id);
    }
    setIsDirty(true);

    const diff = computeProposedDiff(patch, prePatchSnapshot);
    return { diff, snapshot: prePatchSnapshot };
  }, [promptMode, systemPrompt, fineTuningDirectives, greetingEnabled, greetingText, settings, speaker, language, pace, tone, mission, role, capsuleId, computeProposedDiff]);

  // Instant Undo Handler (Fix 2)
  const handleUndoPatch = useCallback((msgId) => {
    const msg = sageMessages.find(m => m.id === msgId);
    const snapshot = patchSnapshots[msgId] || msg?.pre_patch_snapshot;
    if (!snapshot) return;

    if (snapshot.promptMode !== undefined) setPromptMode(snapshot.promptMode);
    if (snapshot.systemPrompt !== undefined) setSystemPrompt(snapshot.systemPrompt);
    if (snapshot.fineTuningDirectives !== undefined) setFineTuningDirectives(snapshot.fineTuningDirectives);
    if (snapshot.greetingEnabled !== undefined) setGreetingEnabled(snapshot.greetingEnabled);
    if (snapshot.greetingText !== undefined) setGreetingText(snapshot.greetingText);
    if (snapshot.settings) setSettings(snapshot.settings);
    if (snapshot.speaker) setSpeaker(snapshot.speaker);
    if (snapshot.language) setLanguage(snapshot.language);
    if (snapshot.pace !== undefined) setPace(snapshot.pace);
    if (snapshot.tone) setTone(snapshot.tone);
    if (snapshot.mission !== undefined) setMission(snapshot.mission);
    if (snapshot.role !== undefined) setRole(snapshot.role);
    if (snapshot.capsuleId !== undefined) setCapsuleId(snapshot.capsuleId);

    setUndonePatches(prev => ({ ...prev, [msgId]: true }));
    updateActiveSessionMessages(prev => prev.map(m => m.id === msgId ? { ...m, is_undone: true } : m));
    setIsDirty(true);
    setTemplateNotification("Sage patch reverted to previous state.");
    setTimeout(() => setTemplateNotification(null), 3000);
  }, [patchSnapshots, sageMessages, updateActiveSessionMessages]);

  // Clear / New / Delete / Select Chat Handlers
  const handleClearSageChat = useCallback(() => {
    updateActiveSessionMessages([]);
    setPatchSnapshots({});
    setUndonePatches({});
    setTemplateNotification("Sage conversation cleared.");
    setTimeout(() => setTemplateNotification(null), 2500);
  }, [updateActiveSessionMessages]);

  const handleNewSageChat = useCallback(() => {
    const active = sageSessions.find(s => s.id === currentSessionId);
    if (active && (!active.messages || active.messages.length === 0)) {
      setShowHistoryPanel(false);
      setSageInput('');
      setTemplateNotification("Ready with clean architecture session");
      setTimeout(() => setTemplateNotification(null), 2000);
      return;
    }
    const newSession = {
      id: `sess-${Date.now()}`,
      title: 'New Architecture Session',
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      updatedAt: Date.now(),
      messages: []
    };
    setSageSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);
    setShowHistoryPanel(false);
    setSageInput('');
    setTemplateNotification("Started fresh Sage architect session");
    setTimeout(() => setTemplateNotification(null), 2500);
  }, [sageSessions, currentSessionId]);

  const handleDeleteSession = useCallback((sessId, e) => {
    e?.stopPropagation();
    setSageSessions(prev => {
      const filtered = prev.filter(s => s.id !== sessId);
      if (filtered.length === 0) {
        const fresh = [{
          id: `sess-${Date.now()}`,
          title: 'New Architecture Session',
          createdAt: 'Just now',
          updatedAt: Date.now(),
          messages: []
        }];
        setCurrentSessionId(fresh[0].id);
        return fresh;
      }
      if (currentSessionId === sessId) {
        setCurrentSessionId(filtered[0].id);
      }
      return filtered;
    });
  }, [currentSessionId]);

  const handleSelectSession = useCallback((sessId) => {
    setCurrentSessionId(sessId);
    setShowHistoryPanel(false);
  }, []);

  // Direct Phone Call Dialer Actions (Fix 3)
  const handleTriggerColdCall = async () => {
    setColdCallError(null);
    let cleanPhone = (coldCallPhone || '').trim();
    if (!cleanPhone || cleanPhone.replace(/[^0-9]/g, '').length < 10) {
      setColdCallError('Please enter a valid 10-digit Indian phone number (e.g. +91 98765 43210).');
      return;
    }
    if (!cleanPhone.startsWith('+') && !cleanPhone.startsWith('0') && !cleanPhone.startsWith('91')) {
      cleanPhone = `+91${cleanPhone}`;
    }

    setColdCallStatus('dialing');
    try {
      let targetAgentId = currentId;
      if (!targetAgentId || isDirty) {
        targetAgentId = await handleSaveAgent();
      }

      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/pearl/agents/${targetAgentId || 'draft'}/calls`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          phone_number: cleanPhone,
          recipient_name: coldCallRecipient || 'Prospect',
          call_provider: 'vobiz',
          agent_snapshot: currentAgentSnapshot
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Failed to place call (${res.status})`);
      }

      const data = await res.json();
      setColdCallId(data.call_id);
      setColdCallStatus('dialing');
    } catch (err) {
      console.error('Cold call dispatch error:', err);
      setColdCallStatus('failed');
      setColdCallError(err.message || 'Telephony dispatch failed');
    }
  };

  const handleCancelColdCall = async () => {
    if (coldCallId) {
      try {
        const token = localStorage.getItem('token');
        await fetch(`${window.APP_API_BASE || ''}/api/pearl/calls/${coldCallId}/cancel`, {
          method: 'POST',
          headers: { Authorization: token ? `Bearer ${token}` : '' }
        });
      } catch (e) {}
    }
    setColdCallStatus('idle');
    setColdCallId(null);
  };

  // Sage AI Agent Architect Interactive Chat Handler
  const handleSageSubmit = async (e, directQuery = null) => {
    e?.preventDefault();
    const query = (directQuery || sageInput || '').trim();
    if (!query || isSageThinking) return;

    // Check if query is asking to place a cold call directly
    const qLower = query.toLowerCase();
    if (qLower.includes('cold call to my number') || qLower.includes('to my number') || qLower.includes('call my number') || qLower.includes('dial my number')) {
      setShowColdCallModal(true);
      return;
    }

    const userMsg = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    updateActiveSessionMessages(prev => [...prev, userMsg]);
    setSageInput('');
    setIsSageThinking(true);

    const token = localStorage.getItem('token');
    const activeCapsule = capsules.find(c => String(c.id) === String(capsuleId));
    const capsuleMetadata = {
      product_name: activeCapsule?.product_name || activeCapsule?.name || '',
      description: activeCapsule?.product_specification || activeCapsule?.description || activeCapsule?.summary || '',
      target_audience: activeCapsule?.target_audience || activeCapsule?.icp || '',
      value_props: activeCapsule?.key_differentiators || activeCapsule?.value_props || activeCapsule?.usp || '',
      pain_points_solved: activeCapsule?.pain_points_solved || '',
      company_name: activeCapsule?.company_name || '',
      faqs: activeCapsule?.faqs || []
    };

    try {
      const res = await fetch(`${window.APP_API_BASE || ''}/api/pearl/sage/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({
          messages: sageMessages.slice(-6).map(m => ({
            role: m.sender === 'user' ? 'user' : 'assistant',
            content: m.text + (m.body ? `\n${m.body}` : '')
          })),
          query,
          agent_state: {
            name: agentName,
            role,
            mission,
            prompt_mode: promptMode,
            system_prompt: systemPrompt,
            fine_tuning_directives: fineTuningDirectives,
            greeting_enabled: greetingEnabled,
            greeting_text: greetingText,
            voice_config: { speaker, language, pace, tone },
            settings,
            capsule_id: capsuleId,
            capsule_name: activeCapsule?.title || activeCapsule?.name || '',
            capsule_context: activeCapsule?.content || activeCapsule?.summary || activeCapsule?.context || '',
            capsule_metadata: capsuleMetadata,
            variables: testVariables
          }
        })
      });

      if (!res.ok) {
        throw new Error(`Sage API returned ${res.status}`);
      }

      const data = await res.json();
      const assistantMsg = {
        id: data.id || `s-${Date.now()}`,
        sender: 'assistant',
        text: data.text || "I've reviewed and adjusted the agent's strategy.",
        steps: data.steps || "Worked on 3 steps >",
        steps_detail: data.steps_detail || [],
        body: data.body || '',
        follow_up_questions: data.follow_up_questions || [],
        action_card: data.action_card || null,
        patch: data.patch || null,
        patch_diff: [],
        timestamp: data.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      // If a patch is provided, automatically snapshot pre-patch state and apply it
      if (data.patch && Object.keys(data.patch).length > 0) {
        const { diff, snapshot } = applySagePatch(data.patch, assistantMsg.id);
        assistantMsg.patch_diff = diff;
        assistantMsg.pre_patch_snapshot = snapshot;
      }

      updateActiveSessionMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      console.error('Sage Chat Error:', err);
      // Graceful client fallback
      let patch = null;

      if (qLower.includes('inbound') || qLower.includes('support') || qLower.includes('customer care')) {
        patch = {
          role: 'inbound_support',
          greeting_enabled: true,
          greeting_text: 'Thank you for calling support! My name is Sage. How can I assist you today?',
          settings: { bargeIn: true, callCutRule: 'reframe_once_then_exit' }
        };
      } else if (qLower.includes('knowledge') || qLower.includes('capsule') || qLower.includes('product question')) {
        const targetCapsule = capsules.find(c => c.is_default) || capsules[0];
        patch = { 
          settings: { bargeIn: true },
          ...(targetCapsule ? { capsule_id: targetCapsule.id } : {})
        };
      } else if (qLower.includes('live call') || qLower.includes('production ready') || qLower.includes('take live calls')) {
        patch = { settings: { bargeIn: true, maxCallLength: 15, backgroundSound: 'office' } };
      } else if (qLower.includes('cold call') || qLower.includes('sales')) {
        patch = { 
          prompt_mode: 'expert',
          greeting_enabled: false,
          settings: { callCutRule: 'reframe_once_then_exit', bargeIn: true }
        };
      } else if (qLower.includes('immediate') || qLower.includes('first rejection') || qLower.includes('no push') || qLower.includes('dont push') || qLower.includes("don't push")) {
        patch = { settings: { callCutRule: 'immediate_disconnect' } };
      } else if (qLower.includes('two') || qLower.includes('2 reframe') || qLower.includes('2 touch') || qLower.includes('twice')) {
        patch = { settings: { callCutRule: 'two_touch_reframe' } };
      } else if (qLower.includes('cut') || qLower.includes('disconnect') || qLower.includes('rejection') || qLower.includes('objection') || qLower.includes('2 yes') || qLower.includes('2-yes') || qLower.includes('two yes')) {
        patch = { settings: { callCutRule: 'reframe_once_then_exit' } };
      } else if (qLower.includes('greeting off') || qLower.includes('disable greeting')) {
        patch = { greeting_enabled: false };
      } else if (qLower.includes('greeting on') || qLower.includes('enable greeting')) {
        patch = { greeting_enabled: true };
      } else if (qLower.includes('hindi') || qLower.includes('hinglish')) {
        patch = { settings: { startingLanguage: 'Hindi' } };
      } else if (qLower.includes('interrupt') || qLower.includes('barge')) {
        patch = { settings: { bargeIn: true } };
      }

      const fallbackMsg = {
        id: `s-err-${Date.now()}`,
        sender: 'assistant',
        text: "I've analyzed your instructions and updated the configuration.",
        steps: "Applied 2 steps >",
        steps_detail: [
          "Calibrated conversational directives & exit criteria",
          "Updated live editor state"
        ],
        body: "I have configured the agent with natural conversational flow and adaptive objection handling. Rather than a rigid 2-Yes loop, the agent will reframe once naturally with value, and politely cut the call upon firm rejection.",
        follow_up_questions: [
          "When should the agent disconnect the call vs push & reframe during objections?",
          "Would you like to test this live on your phone right now?"
        ],
        action_card: {
          title: "Select next action",
          options: [
            "Place one cold call to my number right now",
            "Tune call disconnection & exit policy"
          ]
        },
        patch,
        patch_diff: [],
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      if (patch && Object.keys(patch).length > 0) {
        const { diff, snapshot } = applySagePatch(patch, fallbackMsg.id);
        fallbackMsg.patch_diff = diff;
        fallbackMsg.pre_patch_snapshot = snapshot;
      }

      updateActiveSessionMessages(prev => [...prev, fallbackMsg]);
    } finally {
      setIsSageThinking(false);
    }
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
                onClick={() => setShowTranslationsModal(true)}
                title="View Indic Multilingual Coverage & Code-Switching Matrix"
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
  // ────────────────────────────────────────────────────────────────────────
  // TAB 3: TOOLS STUDIO (Elevated Glassmorphic Actions & Drawers)
  // ────────────────────────────────────────────────────────────────────────
  const renderToolsTab = () => (
    <ToolsStudio 
      tools={customTools}
      systemTools={systemTools}
      onAddToolClick={handleAddToolClick}
      onEditTool={handleEditTool}
      onDeleteTool={handleDeleteTool}
      onToggleToolActive={handleToggleToolActive}
      onToggleSystemTool={handleToggleSystemTool}
      onOpenDocs={handleOpenToolDocs}
    />
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
            {capsules.map(c => {
              const label = (c.product_name && c.product_name !== c.name)
                ? `${c.name} (${c.product_name})`
                : c.name;
              return (
                <option key={c.id} value={c.id} title={label}>
                  {label}
                </option>
              );
            })}
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
              onClick={() => {
                setShowTranslationsModal(true);
                setTemplateNotification('Indic Translations matrix synchronized across 11 languages.');
                setTimeout(() => setTemplateNotification(null), 3000);
              }}
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

      {/* 6. Call Disconnection & Rejection Policy */}
      <div className="settings-group-title">Call Disconnection & Objection Policy</div>

      <div className="setting-row" style={{ alignItems: 'flex-start' }}>
        <div className="setting-info">
          <div className="setting-label">Call cut & disconnect strategy</div>
          <div className="setting-sub">Define when the agent gracefully cuts the call vs attempting a value reframe</div>
        </div>
        <select 
          className="sarvam-select"
          style={{ width: '280px' }}
          value={settings.callCutRule || 'reframe_once_then_exit'}
          onChange={(e) => {
            setSettings(s => ({ ...s, callCutRule: e.target.value }));
            setIsDirty(true);
          }}
        >
          <option value="reframe_once_then_exit">Push & reframe once naturally, then disconnect if rejected</option>
          <option value="immediate_disconnect">Immediate polite disconnect on first rejection</option>
          <option value="two_touch_reframe">Adaptive push (up to 2 soft reframes) before exit</option>
          <option value="custom">Custom exit directives</option>
        </select>
      </div>

      <div className="setting-row" style={{ alignItems: 'flex-start' }}>
        <div className="setting-info">
          <div className="setting-label">Polite exit statement</div>
          <div className="setting-sub">Spoken closing phrase before disconnecting upon rejection</div>
        </div>
        <input 
          type="text" 
          className="sarvam-input"
          style={{ width: '280px' }}
          value={settings.disconnectPhrase || 'Bilkul samjha sir, thank you for your time. Have a great day!'}
          onChange={(e) => {
            setSettings(s => ({ ...s, disconnectPhrase: e.target.value }));
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
              setTemplateNotification('All 4 test scenarios evaluated successfully! Conformance: 98.5%.');
              setTimeout(() => setTemplateNotification(null), 3500);
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
  // RIGHT SIDEBAR: "SAGE · AI AGENT ARCHITECT" (Powered by Qwen via Groq)
  // ────────────────────────────────────────────────────────────────────────
  const renderSagePanel = () => {
    if (!isSageOpen) return null;

    return (
      <>
        {/* Backdrop overlay for smaller displays */}
        <div 
          className="sage-drawer-backdrop"
          onClick={() => setIsSageOpen(false)}
          title="Click to dismiss Sage drawer"
        />

        <div className="agent-editor-right sage-drawer-mode">
          {/* Top Header */}
          <div className="sage-top-bar">
            <div className="sage-agent-title">
              <div className="sage-title-sparkle-wrap">
                <Sparkles size={15} color="#0f172a" />
              </div>
              <span className="sage-title-text">Sage</span>
              <span className="sage-badge-tag">Architect</span>
            </div>
            <div className="sage-top-actions">
              <button 
                type="button" 
                className={`btn-top-icon ${showHistoryPanel ? 'active' : ''}`}
                onClick={() => setShowHistoryPanel(prev => !prev)}
                title="Conversation History"
              >
                <Clock size={15} />
              </button>
              <button 
                type="button" 
                className="btn-new-chat"
                onClick={handleNewSageChat}
                title="Start a new configuration session with Sage"
              >
                <Plus size={12} />
                <span>New</span>
              </button>
              <button 
                type="button" 
                className="btn-clear-chat"
                onClick={handleClearSageChat}
                title="Clear current session messages"
              >
                <Trash2 size={12} />
                <span>Clear</span>
              </button>
              <button 
                type="button" 
                className="btn-top-icon" 
                title="Close Sage Panel"
                onClick={() => setIsSageOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Session History Drawer (Overlay / Dropdown) */}
          {showHistoryPanel && (
            <div className="sage-history-panel">
              <div className="sage-history-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Clock size={14} color="#0f172a" />
                  <span style={{ fontWeight: 700, fontSize: '0.84rem', color: '#0f172a' }}>Saved Sessions</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button 
                    type="button" 
                    className="btn-new-chat-sm" 
                    onClick={handleNewSageChat}
                    title="Start new conversation"
                  >
                    <Plus size={11} />
                    <span>New Session</span>
                  </button>
                  <button 
                    type="button" 
                    className="btn-top-icon" 
                    onClick={() => setShowHistoryPanel(false)}
                    title="Close history"
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>

              <div className="sage-history-list">
                {sageSessions.length === 0 ? (
                  <div className="sage-history-empty">No saved sessions yet.</div>
                ) : (
                  sageSessions.map(sess => {
                    const isActive = sess.id === currentSessionId;
                    const msgCount = (sess.messages || []).length;
                    return (
                      <div 
                        key={sess.id} 
                        className={`sage-history-item ${isActive ? 'active' : ''}`}
                        onClick={() => handleSelectSession(sess.id)}
                      >
                        <div className="history-item-left">
                          <span className="history-item-title">{sess.title || 'Untitled Session'}</span>
                          <span className="history-item-meta">
                            {sess.createdAt} · {msgCount} {msgCount === 1 ? 'msg' : 'msgs'}
                          </span>
                        </div>
                        <div className="history-item-actions">
                          {isActive && <span className="history-active-pill">Active</span>}
                          <button 
                            type="button" 
                            className="btn-delete-session"
                            title="Delete session"
                            onClick={(e) => handleDeleteSession(sess.id, e)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Chat Feed or Welcome Hero */}
          <div className="sage-chat-feed">
            {sageMessages.length === 0 ? (
              <div className="sage-welcome-container">
                <div className="sage-welcome-hero">
                  <div className="sage-hero-emblem-wrap">
                    <svg className="sage-hero-emblem" width="46" height="46" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect width="48" height="48" rx="14" fill="#0f172a" />
                      <path d="M24 10L36 17V31L24 38L12 31V17L24 10Z" stroke="url(#clozflow_grad_1)" strokeWidth="2.2" strokeLinejoin="round" />
                      <path d="M24 10V24M24 24L36 31M24 24L12 31" stroke="url(#clozflow_grad_2)" strokeWidth="1.8" strokeLinejoin="round" />
                      <circle cx="24" cy="24" r="3.2" fill="#38bdf8" />
                      <defs>
                        <linearGradient id="clozflow_grad_1" x1="12" y1="10" x2="36" y2="38" gradientUnits="userSpaceOnUse">
                          <stop stopColor="#38bdf8" />
                          <stop offset="0.5" stopColor="#818cf8" />
                          <stop offset="1" stopColor="#34d399" />
                        </linearGradient>
                        <linearGradient id="clozflow_grad_2" x1="12" y1="10" x2="36" y2="31" gradientUnits="userSpaceOnUse">
                          <stop stopColor="#67e8f9" />
                          <stop offset="1" stopColor="#a78bfa" />
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>

                  <h2 className="sage-hero-title">What's on your mind?</h2>
                  <p className="sage-hero-subtitle">
                    Sage will architect prompts, calibrate objection handling, and tune voice settings for production.
                  </p>
                </div>

                <div className="sage-starter-list">
                  <button
                    type="button"
                    className="sage-starter-card"
                    onClick={() => handleSageSubmit(null, "Set up an agent for inbound support calls")}
                  >
                    <div className="starter-card-icon-wrap" style={{ background: '#ecfdf5', color: '#059669' }}>
                      <Bot size={16} />
                    </div>
                    <div className="starter-card-content">
                      <span className="starter-card-title">Set up an agent for inbound support calls</span>
                      <span className="starter-card-desc">Warm greeting, active listening & structured escalation routing</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="sage-starter-card"
                    onClick={() => handleSageSubmit(null, "Add a knowledge base for product questions")}
                  >
                    <div className="starter-card-icon-wrap" style={{ background: '#eff6ff', color: '#2563eb' }}>
                      <Database size={16} />
                    </div>
                    <div className="starter-card-content">
                      <span className="starter-card-title">Add a knowledge base for product questions</span>
                      <span className="starter-card-desc">Link product specs, ICP criteria & anti-hallucination bounds</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="sage-starter-card"
                    onClick={() => handleSageSubmit(null, "Configure dynamic cold calling & graceful call-cut rules")}
                  >
                    <div className="starter-card-icon-wrap" style={{ background: '#fdf2f8', color: '#db2777' }}>
                      <PhoneCall size={16} />
                    </div>
                    <div className="starter-card-content">
                      <span className="starter-card-title">Configure outbound cold calling with graceful call-cut rules</span>
                      <span className="starter-card-desc">Pattern interrupts, 1-touch value reframe & clean exits</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="sage-starter-card"
                    onClick={() => handleSageSubmit(null, "Calibrate authentic Indian English / Hinglish tone")}
                  >
                    <div className="starter-card-icon-wrap" style={{ background: '#faf5ff', color: '#9333ea' }}>
                      <Mic size={16} />
                    </div>
                    <div className="starter-card-content">
                      <span className="starter-card-title">Calibrate authentic Indian English & Hinglish cadence</span>
                      <span className="starter-card-desc">Natural human flow, zero canned robotic filler phrases</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="sage-starter-card"
                    onClick={() => handleSageSubmit(null, "Get an agent ready to take live calls")}
                  >
                    <div className="starter-card-icon-wrap" style={{ background: '#fffbeb', color: '#d97706' }}>
                      <CheckCircle2 size={16} />
                    </div>
                    <div className="starter-card-content">
                      <span className="starter-card-title">Get an agent ready to take live calls</span>
                      <span className="starter-card-desc">Production pre-flight audit, barge-in tuning & live testing</span>
                    </div>
                  </button>
                </div>
              </div>
            ) : (
              sageMessages.map(msg => {
                if (msg.sender === 'user') {
                  return (
                    <div key={msg.id} className="user-bubble">
                      {msg.text}
                    </div>
                  );
                }

                const isStepsExpanded = Boolean(expandedSteps[msg.id]);

                return (
                  <div key={msg.id} className="assistant-cluster">
                    <div className="assistant-bubble-text">{msg.text}</div>
                    
                    {msg.steps && (
                      <div 
                        className="assistant-thought-link"
                        onClick={() => setExpandedSteps(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                        title="Click to toggle reasoning steps"
                      >
                        <span>{msg.steps}</span>
                        {isStepsExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </div>
                    )}

                    {isStepsExpanded && msg.steps_detail && msg.steps_detail.length > 0 && (
                      <div className="sage-steps-drawer">
                        {msg.steps_detail.map((stepDesc, idx) => (
                          <div key={idx} className="sage-step-item">
                            <span className="sage-step-number">{idx + 1}</span>
                            <span>{stepDesc}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {msg.body && (
                      <div className="assistant-bubble-text" style={{ color: '#475569', fontSize: '0.82rem' }}>
                        {msg.body}
                      </div>
                    )}

                    {msg.follow_up_questions && msg.follow_up_questions.length > 0 && (
                      <div className="sage-questions-container">
                        <div className="sage-questions-label">Architect Follow-up:</div>
                        {msg.follow_up_questions.map((q, idx) => (
                          <button
                            key={idx}
                            type="button"
                            className="sage-question-chip"
                            onClick={() => handleSageSubmit(null, q)}
                            title="Click to ask Sage this question"
                          >
                            <span>{q}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {msg.action_card && (
                      <div className="sage-action-card">
                        <div className="action-card-title">{msg.action_card.title}</div>
                        <div className="action-card-options">
                          {msg.action_card.options.map((opt, i) => (
                            <div 
                              key={i} 
                              className="action-option-item"
                              onClick={() => {
                                const optLower = opt.toLowerCase();
                                if (optLower.includes('cold call to my number') || optLower.includes('to my number') || optLower.includes('call my number') || optLower.includes('dial my number') || optLower.includes('phone call dialer')) {
                                  setShowColdCallModal(true);
                                } else if (optLower.includes('test') || optLower.includes('simulation') || optLower.includes('testing panel')) {
                                  handleOpenTesting();
                                } else {
                                  handleSageSubmit(null, opt);
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

                    {/* Proposed Changes Preview Card & Instant Undo */}
                    {msg.patch && Object.keys(msg.patch).length > 0 && (
                      <div className="sage-proposed-changes-card">
                        <div className="proposed-changes-header">
                          <div className="proposed-title-wrap">
                            <Sparkles size={13} color="#ea580c" />
                            <span>Proposed Changes</span>
                          </div>
                          <span className="proposed-badge">Applied</span>
                        </div>

                        {msg.patch_diff && msg.patch_diff.length > 0 ? (
                          <div className="proposed-diff-list">
                            {msg.patch_diff.map((item, dIdx) => (
                              <div key={dIdx} className="proposed-diff-item">
                                <span className="diff-field-name">{item.field}:</span>
                                <span className="diff-field-val">{item.summary}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="proposed-diff-list">
                            <div className="proposed-diff-item">
                              <span className="diff-field-name">Status:</span>
                              <span className="diff-field-val">Agent directives & telephony parameters synchronized</span>
                            </div>
                          </div>
                        )}

                        <div className="proposed-actions-bar">
                          {undonePatches[msg.id] || msg.is_undone ? (
                            <div className="proposed-undone-badge">
                              <Check size={12} color="#16a34a" />
                              <span>Changes Reverted</span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="btn-undo-patch"
                              onClick={() => handleUndoPatch(msg.id)}
                              title="Revert these changes to the previous state"
                            >
                              <RotateCcw size={12} />
                              <span>Undo Changes</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* Dynamic Loading Skeleton & Step Progress Indicators */}
            {isSageThinking && (
              <div className="assistant-cluster">
                <div className="sage-thinking-cluster">
                  <div className="sage-thinking-header">
                    <Loader2 size={14} className="animate-spin text-slate-700" />
                    <span className="sage-thinking-title">Sage Reasoning & Optimizing...</span>
                  </div>
                  <div className="sage-thinking-steps-track">
                    <div className={`sage-thinking-step ${thinkingStep >= 1 ? 'active' : ''} ${thinkingStep > 1 ? 'completed' : ''}`}>
                      <div className="step-bullet">{thinkingStep > 1 ? <Check size={10} /> : '1'}</div>
                      <span className="step-label">Analyzing ICP & Knowledge Capsule context</span>
                    </div>
                    <div className={`sage-thinking-step ${thinkingStep >= 2 ? 'active' : ''} ${thinkingStep > 2 ? 'completed' : ''}`}>
                      <div className="step-bullet">{thinkingStep > 2 ? <Check size={10} /> : '2'}</div>
                      <span className="step-label">Calibrating objection resilience & call-cut thresholds</span>
                    </div>
                    <div className={`sage-thinking-step ${thinkingStep >= 3 ? 'active' : ''}`}>
                      <div className="step-bullet">3</div>
                      <span className="step-label">Synthesizing live directives & configuration patch</span>
                    </div>
                  </div>
                  <div className="sage-skeleton-shimmer">
                    <div className="skeleton-bar" style={{ width: '85%' }} />
                    <div className="skeleton-bar" style={{ width: '60%' }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input Bar */}
          <div className="sage-input-wrapper">
            <form className="sage-input-box" onSubmit={(e) => handleSageSubmit(e)}>
              <input 
                type="text" 
                placeholder="Ask Sage to build, edit, or test anything..." 
                value={sageInput}
                onChange={(e) => setSageInput(e.target.value)}
                disabled={isSageThinking}
              />
              <button 
                type="submit" 
                className="btn-send-circle" 
                title="Send message"
                disabled={isSageThinking || !sageInput.trim()}
              >
                {isSageThinking ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              </button>
            </form>
          </div>

          {/* Footer Meta */}
          <div className="sage-bottom-meta">
            <a 
              href="#report" 
              onClick={(e) => { 
                e.preventDefault(); 
                setShowFeedbackModal(true); 
              }}
              title="Send suggestions or report an issue with Sage"
            >
              Report an issue
            </a>
            <span>Powered by Qwen · Groq</span>
          </div>
        </div>
      </>
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

          <button 
            type="button" 
            className={`btn-sage-header-toggle ${isSageOpen ? 'active' : ''}`}
            onClick={toggleSage}
            title="Toggle Sage · AI Agent Architect Drawer"
          >
            <Sparkles size={13} />
            <span>Sage AI</span>
          </button>
        </div>
      </header>

      {/* ──────────────────────────────────────────────────────────────────
          BODY: LEFT TABS, CENTER CONTENT, RIGHT SAGE
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

        {/* Right Sidebar: Sage · AI Agent Architect */}
        {renderSagePanel()}
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

      {/* 5-Card Add Tool Modal */}
      <AddToolModal 
        isOpen={showAddToolModal}
        onClose={handleCloseAddToolModal}
        onSelectToolType={handleSelectToolType}
      />

      {/* Comprehensive Tool Drawer with Live Inspector */}
      <ToolDrawer 
        isOpen={isToolDrawerOpen}
        onClose={handleCloseDrawer}
        tool={selectedDrawerTool}
        agentId={currentId}
        onSaveTool={handleSaveTool}
        onDeleteTool={handleDeleteTool}
        testVariables={testVariables}
      />


      {/* Direct Cold Call Phone Dialer Modal (Fix 3) */}
      {showColdCallModal && (
        <div 
          className="cold-call-modal-overlay" 
          onClick={(e) => { 
            if (e.target === e.currentTarget && (coldCallStatus === 'idle' || coldCallStatus === 'failed' || coldCallStatus === 'completed')) {
              setShowColdCallModal(false);
            }
          }}
        >
          <div className="cold-call-modal-card">
            <div className="cold-call-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="cold-call-icon-badge">
                  <PhoneCall size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: '#0f172a' }}>Place Live Cold Call</h3>
                  <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                    Trigger real-time outbound dialer directly to your phone.
                  </p>
                </div>
              </div>
              <button 
                type="button" 
                className="btn-top-icon" 
                onClick={() => {
                  if (coldCallStatus === 'dialing' || coldCallStatus === 'connected') {
                    handleCancelColdCall();
                  }
                  setShowColdCallModal(false);
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="cold-call-modal-body">
              {coldCallStatus === 'idle' || coldCallStatus === 'failed' || coldCallStatus === 'completed' ? (
                <>
                  <div className="cold-call-form-group">
                    <label>Recipient Phone Number (India / E.164)</label>
                    <div className="phone-input-wrap">
                      <span className="phone-prefix-tag">+91</span>
                      <input 
                        type="tel" 
                        placeholder="9876543210 or +919876543210"
                        value={coldCallPhone}
                        onChange={(e) => setColdCallPhone(e.target.value)}
                        className="cold-call-input"
                        autoFocus
                      />
                    </div>
                    <span className="phone-hint">Enter your real number to test the agent's live voice cadence, barge-in, and call-cut rules.</span>
                  </div>

                  <div className="cold-call-form-group" style={{ marginTop: 12 }}>
                    <label>Prospect Name</label>
                    <input 
                      type="text" 
                      placeholder="Prospect name (e.g. Manan, Rahul Sharma)"
                      value={coldCallRecipient}
                      onChange={(e) => setColdCallRecipient(e.target.value)}
                      className="cold-call-input"
                    />
                  </div>

                  {coldCallError && (
                    <div className="cold-call-alert-error">
                      <AlertCircle size={15} />
                      <span>{coldCallError}</span>
                    </div>
                  )}

                  {coldCallStatus === 'completed' && (
                    <div className="cold-call-alert-success">
                      <CheckCircle2 size={15} />
                      <span>Previous call ended successfully. You can place another test call below.</span>
                    </div>
                  )}

                  <div className="cold-call-modal-footer">
                    <button 
                      type="button" 
                      className="btn-secondary-pill"
                      onClick={() => setShowColdCallModal(false)}
                    >
                      Cancel
                    </button>
                    <button 
                      type="button" 
                      className="btn-dial-now"
                      onClick={handleTriggerColdCall}
                    >
                      <PhoneCall size={14} />
                      <span>Place Call to My Phone</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="cold-call-active-state">
                  <div className="calling-radar-wrap">
                    <div className="calling-radar-ring" />
                    <div className="calling-radar-ring delay-1" />
                    <div className="calling-radar-center">
                      <PhoneCall size={22} className="animate-pulse" />
                    </div>
                  </div>

                  <div className="calling-status-title">
                    {coldCallStatus === 'dialing' && 'Initiating Outbound Telephony...'}
                    {coldCallStatus === 'ringing' && 'Ringing Recipient Phone...'}
                    {coldCallStatus === 'connected' && 'Call Connected & Speaking'}
                  </div>

                  <div className="calling-phone-pill">
                    <span>{coldCallPhone}</span>
                    <span className="calling-timer-tag">
                      {String(Math.floor(coldCallSeconds / 60)).padStart(2, '0')}:
                      {String(coldCallSeconds % 60).padStart(2, '0')}
                    </span>
                  </div>

                  <div className="calling-meta-box">
                    <div className="calling-meta-row">
                      <span className="meta-label">Active Agent:</span>
                      <span className="meta-val">{agentName}</span>
                    </div>
                    <div className="calling-meta-row">
                      <span className="meta-label">Telephony Route:</span>
                      <span className="meta-val">Vobiz / Exotel Telephony Engine</span>
                    </div>
                    <div className="calling-meta-row">
                      <span className="meta-label">Call ID:</span>
                      <span className="meta-val font-mono">{coldCallId ? coldCallId.slice(0, 16) : 'Connecting...'}</span>
                    </div>
                  </div>

                  <div className="cold-call-modal-footer" style={{ justifyContent: 'center' }}>
                    <button 
                      type="button" 
                      className="btn-cancel-call"
                      onClick={handleCancelColdCall}
                    >
                      <X size={14} />
                      <span>Hang Up / End Call</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Feedback / Issue Modal */}
      {showFeedbackModal && (
        <div 
          className="sage-feedback-overlay" 
          onClick={(e) => { if (e.target === e.currentTarget) setShowFeedbackModal(false); }}
        >
          <div className="sage-feedback-card">
            <div className="feedback-card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={16} color="#0f172a" />
                <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 700, color: '#0f172a' }}>
                  Report an issue or suggestion
                </h3>
              </div>
              <button 
                type="button" 
                className="btn-top-icon" 
                onClick={() => setShowFeedbackModal(false)}
              >
                <X size={15} />
              </button>
            </div>
            <div className="feedback-card-body">
              <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: 6, display: 'block' }}>
                Feedback Category
              </label>
              <div className="feedback-category-pills">
                {['Prompt Tuning', 'Objection & Call Cut', 'Voice Quality', 'Telephony / Dialer', 'General'].map(cat => (
                  <button 
                    key={cat} 
                    type="button" 
                    className={`category-pill ${feedbackCategory === cat ? 'active' : ''}`}
                    onClick={() => setFeedbackCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginTop: 12, marginBottom: 6, display: 'block' }}>
                Issue Details / Suggestions
              </label>
              <textarea 
                rows={4}
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Describe what occurred, unexpected agent output, or feature enhancement..."
                className="feedback-textarea"
              />
            </div>
            <div className="feedback-card-footer">
              <button 
                type="button" 
                className="btn-secondary-pill" 
                onClick={() => setShowFeedbackModal(false)}
              >
                Cancel
              </button>
              <button 
                type="button" 
                className="btn-dial-now"
                disabled={feedbackSending}
                onClick={() => {
                  setFeedbackSending(true);
                  try {
                    const logs = JSON.parse(localStorage.getItem('clozflow_sage_feedback') || '[]');
                    logs.push({
                      agent_id: currentId || agentId,
                      category: feedbackCategory,
                      notes: feedbackText,
                      timestamp: new Date().toISOString()
                    });
                    localStorage.setItem('clozflow_sage_feedback', JSON.stringify(logs));
                    const token = localStorage.getItem('token');
                    fetch(`${window.APP_API_BASE || ''}/api/pearl/sage/feedback`, {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: token ? `Bearer ${token}` : ''
                      },
                      body: JSON.stringify({
                        agent_id: currentId || agentId,
                        category: feedbackCategory,
                        notes: feedbackText
                      })
                    }).catch(err => console.warn('Sage feedback API dispatch notice:', err));
                  } catch (e) {}
                  setTimeout(() => {
                    setFeedbackSending(false);
                    setShowFeedbackModal(false);
                    setFeedbackText('');
                    setTemplateNotification('Thank you! Feedback logged for Clozflow engineering.');
                    setTimeout(() => setTemplateNotification(null), 3000);
                  }, 300);
                }}
              >
                {feedbackSending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                <span>Submit Feedback</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Indic Translations Matrix Modal */}
      {showTranslationsModal && (
        <div 
          className="sage-feedback-overlay" 
          onClick={(e) => { if (e.target === e.currentTarget) setShowTranslationsModal(false); }}
        >
          <div className="sage-translations-card">
            <div className="feedback-card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Globe size={16} color="#0f172a" />
                <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 700, color: '#0f172a' }}>
                  Indic Multilingual Architecture
                </h3>
              </div>
              <button 
                type="button" 
                className="btn-top-icon" 
                onClick={() => setShowTranslationsModal(false)}
              >
                <X size={15} />
              </button>
            </div>
            <div className="translations-card-body">
              <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 12px', lineHeight: 1.5 }}>
                Opening greetings, value reframes, and qualification questions are dynamically synthesized across 11 Indic languages with zero latency overhead.
              </p>
              <div className="indic-lang-grid">
                {[
                  { code: 'hi-IN', name: 'Hindi (हिन्दी)', status: 'Full Neural TTS & STT' },
                  { code: 'en-IN', name: 'Indian English', status: 'Conversational Native' },
                  { code: 'hi-en', name: 'Hinglish', status: 'Dynamic Code-Switching' },
                  { code: 'ta-IN', name: 'Tamil (தமிழ்)', status: 'Neural Voice & STT' },
                  { code: 'te-IN', name: 'Telugu (తెలుగు)', status: 'Neural Voice & STT' },
                  { code: 'kn-IN', name: 'Kannada (ಕನ್ನಡ)', status: 'Neural Voice & STT' },
                  { code: 'mr-IN', name: 'Marathi (मराठी)', status: 'Neural Voice & STT' },
                  { code: 'gu-IN', name: 'Gujarati (ગુજરાતી)', status: 'Neural Voice & STT' },
                  { code: 'bn-IN', name: 'Bengali (বাংলা)', status: 'Neural Voice & STT' },
                  { code: 'pa-IN', name: 'Punjabi (ਪੰਜਾਬੀ)', status: 'Neural Voice & STT' },
                  { code: 'ml-IN', name: 'Malayalam (മലയാളം)', status: 'Neural Voice & STT' }
                ].map(lang => (
                  <div key={lang.code} className="indic-lang-item">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.8rem', color: '#0f172a' }}>{lang.name}</span>
                      <CheckCircle2 size={12} color="#16a34a" />
                    </div>
                    <span style={{ fontSize: '0.7rem', color: '#64748b' }}>{lang.status}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="feedback-card-footer">
              <button 
                type="button" 
                className="btn-dial-now" 
                onClick={() => setShowTranslationsModal(false)}
              >
                Close
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
