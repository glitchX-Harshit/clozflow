import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Bot, Phone, MoreVertical,
  FileText, Braces, Wrench, Settings as SettingsIcon,
  CheckCircle2, Sparkles, ChevronDown, ChevronUp,
  Save, Loader2, Check, Database, Mic,
  Trash2, Plus, Search, Volume2, Globe,
  Clock, X, Send, AlertCircle, PhoneCall, RotateCcw, RefreshCw
} from 'lucide-react';
import './AgentEditor.css';
import AgentTestingPanel from './AgentTestingPanel';
import VoicePersonaSelector from '../../components/VoicePersonaSelector';
import { CLOZFLOW_VOICE_LIST } from '../../components/voiceList';
import ArchetypeLibraryModal from '../../components/ArchetypeLibraryModal';
import ToolsStudio from './components/ToolsStudio';
import AddToolModal from './components/AddToolModal';
import ToolDrawer from './components/ToolDrawer';
import ErrorBoundary from '../../components/ErrorBoundary';
import { useAuth } from '../../context/AuthContext';
import { useDashboardStore } from '../../store/useDashboardStore';
import { extractVariables, substituteVariables } from '../../utils/variableParser';
import { getArchetypeById } from '../../data/salesArchetypes';
import { apiFetch, errorMessage, isAbortError, SESSION_EXPIRED_MESSAGE } from './lib/pearlApi.js';
import { mapCallStatus } from './lib/callStatus.js';
import { SIMULATED_CALL_MESSAGE, interpretColdCallResponse } from './lib/coldCall.js';
import { formatIndianPhone, normalizeIndianPhone } from './lib/phone.js';
import { formatDuration } from './lib/dates.js';
import { agentStatusMeta } from './lib/agentCard.js';
import { useBackdropDismiss, useDialogA11y } from './lib/a11y.js';
import {
  DEFAULT_DISCONNECT_PHRASE, DEFAULT_GREETING, DEFAULT_SPEAKER, DEFAULT_SYSTEM_TOOLS,
  LANGUAGE_OPTIONS, PACE_MAX, PACE_MIN, TONE_OPTIONS, VOICE_LANGUAGE_OPTIONS,
  archetypeChangeSummary, archetypeToEditorPartial, buildPersistedSettings, buildReadinessChecks,
  clampInt, clampPace, defaultSettings, defaultSystemTools, hasReplaceableContent, isDraftToolId,
  languageVoiceCounts, mergeSystemTools, pickSavedToolsConfig, restoreGreeting, restorePromptState,
  restoreSettings, splitSavedSettings, toolRequestBody, validateVariableName,
} from './lib/agentEditorState.js';
import {
  classifySageAction, clearDraftSageStorage, createSageSession, describePatch, loadSageSessions,
  mergeEditorState, normalizeSageMessage, patchToEditorPartial, sageStorageKeys, saveSageSessions,
  sessionTitleFrom, undoForPartial,
} from './lib/sageMessages.js';

const DEFAULT_AGENT_NAME = 'Conversation Agent 6613';
const DEFAULT_MISSION = 'Qualify prospect intent, establish immediate product relevance, and book a discovery demo.';

// Sample values used for previews and test calls until the user enters their own.
const DEFAULT_TEST_VARIABLES = Object.freeze({
  user_name: 'Manan',
  lead_name: 'Siddharth Roy',
  prospect_company: 'FinEdge Logistics',
  product_name: 'Clozflow AI',
  calendar_link: 'https://cal.com/clozflow/demo'
});

const OUTPUT_VARIABLES = [
  { name: 'qualification_disposition', desc: 'Final call classification (MEETING_BOOKED, QUALIFIED_INFO, UNQUALIFIED)', type: 'string' },
  { name: 'meeting_slot', desc: 'Confirmed calendar date and timeslot agreed with the prospect', type: 'datetime' },
  { name: 'monthly_call_volume', desc: 'Self-reported monthly outbound/inbound minutes or call volume', type: 'number' },
  { name: 'primary_pain_point', desc: 'Operational bottleneck (telecaller attrition, CAC, speed to lead)', type: 'string' },
  { name: 'customer_sentiment', desc: 'Emotional tone detected across turns (Positive, Neutral, Skeptical)', type: 'enum' },
];

const VOICE_IDS = CLOZFLOW_VOICE_LIST.map(v => v.id);
const VOICE_LANGUAGES = languageVoiceCounts(CLOZFLOW_VOICE_LIST);

const COLD_CALL_ACTIVE = ['saving', 'dispatching', 'dialing', 'ringing', 'connected'];
const COLD_CALL_POLLING = ['dialing', 'ringing', 'connected'];
const COLD_CALL_TITLES = {
  saving: 'Saving the agent…',
  dispatching: 'Placing the call…',
  dialing: 'Dialing…',
  ringing: 'Ringing the recipient…',
  connected: 'Connected — the agent is speaking',
};

const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const nowLabel = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function browserStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null; // storage blocked (private mode / sandboxed frame)
  }
}

/** Accessible on/off switch (keeps the existing .toggle-switch look). */
const ToggleSwitch = ({ checked, onChange, label, title }) => (
  <label className="toggle-switch" title={title}>
    <input
      type="checkbox"
      role="switch"
      aria-checked={Boolean(checked)}
      aria-label={label}
      checked={Boolean(checked)}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span className="slider" aria-hidden="true"></span>
  </label>
);

/** Number input that may be empty while typing; clamps and commits on blur / Enter. */
const NumberField = ({ value, min, max, fallback, onCommit, className, ariaLabel }) => {
  const [draft, setDraft] = useState(null);
  const shown = draft ?? (value === undefined || value === null ? '' : String(value));
  const commit = () => {
    if (draft === null) return;
    const next = clampInt(draft, { min, max, fallback });
    setDraft(null);
    if (next !== Number(value)) onCommit(next);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      className={className}
      min={min}
      max={max}
      value={shown}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
};

const RuntimeNote = () => (
  <span
    className="setting-runtime-note"
    title="Saved with the agent, but the live call pipeline does not use this setting yet."
  >
    Not applied to live calls yet
  </span>
);

const SageCrashFallback = ({ onRetry, onClear, onClose }) => (
  <div className="agent-editor-right sage-drawer-mode sage-crash-fallback" role="alert">
    <AlertCircle size={22} color="#dc2626" />
    <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#0f172a' }}>Sage couldn't display this conversation</h3>
    <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b', lineHeight: 1.5 }}>
      A saved Sage message could not be shown. You can try again, or clear this agent's Sage history.
    </p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
      <button type="button" className="btn-secondary-pill" onClick={onRetry}>Try again</button>
      <button type="button" className="btn-dial-now" onClick={onClear}>Clear Sage history</button>
      <button type="button" className="btn-secondary-pill" onClick={onClose}>Close</button>
    </div>
  </div>
);


export const AgentEditor = ({ agentId = null, initialArchetypeId = null, onBack, onCreated }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const auth = useAuth();
  const userKey = auth?.user?.id ?? auth?.user?.email ?? 'anon';
  const queryArchetype = searchParams?.get('archetype');
  const effectiveArchetypeId = initialArchetypeId || queryArchetype;

  // Blueprint picked when a NEW agent is opened (applied once, without a confirmation).
  const [seed] = useState(() => {
    if (agentId || !effectiveArchetypeId) return null;
    const archetype = getArchetypeById(effectiveArchetypeId);
    return archetype ? { archetype, fields: archetypeToEditorPartial(archetype, { testVariables: DEFAULT_TEST_VARIABLES }) } : null;
  });
  const seedFields = seed?.fields || {};

  // Active Tab: instructions | variables | tools | settings | tests
  const [activeTab, setActiveTab] = useState('instructions');
  const [createdId, setCreatedId] = useState(null);
  const currentId = agentId || createdId;
  const hydratedIdRef = useRef(null); // id whose state already matches the server (no reload)
  const createModeRef = useRef(!agentId);

  const [loadState, setLoadState] = useState(agentId ? 'loading' : 'ready'); // loading | ready | error
  const [loadError, setLoadError] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [agentMeta, setAgentMeta] = useState(null); // { status, version } of the saved record

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveNotice, setSaveNotice] = useState(null); // { tone: 'error' | 'warning', message }
  const saveInFlightRef = useRef(null);
  const saveSuccessTimerRef = useRef(null);
  const [showTestingPanel, setShowTestingPanel] = useState(false);
  const [isDirty, setIsDirty] = useState(Boolean(seed));
  const dirtyVersionRef = useRef(0);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewError, setReviewError] = useState(null);

  // Archetype & Template State
  const [showArchetypeModal, setShowArchetypeModal] = useState(false);
  const [activeArchetypeId, setActiveArchetypeId] = useState(seed?.archetype?.id || effectiveArchetypeId || null);

  // Toast (success / info / error, optional action)
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const notify = useCallback((message, { tone = 'success', action = null, duration } = {}) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    const id = `${Date.now()}-${Math.random()}`;
    setToast({ id, message, tone, action });
    toastTimerRef.current = setTimeout(() => {
      setToast(current => (current && current.id === id ? null : current));
    }, duration ?? (tone === 'error' || action ? 6500 : 3200));
  }, []);
  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(null);
  }, []);
  useEffect(() => {
    const toastTimer = toastTimerRef;
    const savedTimer = saveSuccessTimerRef;
    return () => {
      clearTimeout(toastTimer.current);
      clearTimeout(savedTimer.current);
    };
  }, []);

  const markDirty = useCallback(() => {
    dirtyVersionRef.current += 1;
    setIsDirty(true);
  }, []);

  // Core Agent Fields
  const [agentName, setAgentName] = useState(seedFields.agentName ?? DEFAULT_AGENT_NAME);
  const [role, setRole] = useState(seedFields.role ?? 'outbound_qualification');
  const [mission, setMission] = useState(seedFields.mission ?? DEFAULT_MISSION);

  // Prompt Architecture: 'expert' (Clozflow Proprietary Brain) vs 'custom'
  const [promptMode, setPromptMode] = useState(seedFields.promptMode ?? 'expert');
  const [systemPrompt, setSystemPrompt] = useState(seedFields.systemPrompt ?? '');
  const [fineTuningDirectives, setFineTuningDirectives] = useState(seedFields.fineTuningDirectives ?? '');

  // Fixed Opening Script (Greeting) — OFF by default for sales
  const [greetingEnabled, setGreetingEnabled] = useState(seedFields.greetingEnabled ?? false);
  const [greetingText, setGreetingText] = useState(seedFields.greetingText ?? DEFAULT_GREETING);

  // Voice Persona Settings
  const [speaker, setSpeaker] = useState(seedFields.speaker ?? DEFAULT_SPEAKER);
  const [language, setLanguage] = useState(seedFields.language ?? 'Auto');
  const [pace, setPace] = useState(seedFields.pace ?? 1.0);
  const [tone, setTone] = useState(seedFields.tone ?? 'Professional');

  // Knowledge Capsule
  const [capsules, setCapsules] = useState([]);
  const [capsulesError, setCapsulesError] = useState(null);
  const [capsulesAttempt, setCapsulesAttempt] = useState(0);
  const [capsuleId, setCapsuleId] = useState('');
  const capsuleTouchedRef = useRef(false);

  // Input & Output Variables
  const [variablesSubtab, setVariablesSubtab] = useState('input'); // 'input' | 'output'
  const [varSearchQuery, setVarSearchQuery] = useState('');
  const [testVariables, setTestVariables] = useState(seedFields.testVariables ?? DEFAULT_TEST_VARIABLES);
  const [newVarName, setNewVarName] = useState(null); // null = the add row is closed
  const [newVarError, setNewVarError] = useState(null);

  // Tools Studio & Drawer State
  const [systemTools, setSystemTools] = useState(defaultSystemTools);
  const [customTools, setCustomTools] = useState([]);
  const [showAddToolModal, setShowAddToolModal] = useState(false);
  const [selectedDrawerTool, setSelectedDrawerTool] = useState(null);
  const [isToolDrawerOpen, setIsToolDrawerOpen] = useState(false);
  const [isSageOpen, setIsSageOpen] = useState(false);
  const toolSaveRef = useRef(null);

  // Telephony & Audio Settings
  const [settings, setSettings] = useState(defaultSettings);

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

  /**
   * Save from the tool drawer. Resolves { ok, error? }; on failure nothing changes
   * locally and the drawer stays open with the error. Concurrent calls share one request.
   */
  const handleSaveTool = useCallback((savedTool) => {
    if (toolSaveRef.current) return toolSaveRef.current;
    const run = async () => {
      const tool = savedTool || {};
      const draftId = isDraftToolId(tool.id) ? tool.id : null;
      const isNew = !tool.id || Boolean(draftId);

      if (!currentId) {
        // Unsaved agent: keep the tool as a local draft; it is created with the agent's first save.
        if (draftId) {
          setCustomTools(prev => prev.map(t => (t.id === draftId ? { ...tool } : t)));
        } else if (isNew) {
          setCustomTools(prev => [...prev, { ...tool, id: `tool_draft_${Date.now()}` }]);
        } else {
          setCustomTools(prev => prev.map(t => (t.id === tool.id ? { ...tool } : t)));
        }
        setIsToolDrawerOpen(false);
        setSelectedDrawerTool(null);
        markDirty();
        notify(`Tool "${tool.name || 'Untitled'}" added — it is saved together with the agent.`, { tone: 'info' });
        return { ok: true };
      }

      try {
        const base = `/api/pearl/agents/${encodeURIComponent(currentId)}/tools`;
        const returned = await apiFetch(isNew ? base : `${base}/${encodeURIComponent(tool.id)}`, {
          method: isNew ? 'POST' : 'PUT',
          body: toolRequestBody(tool)
        });
        const savedRow = isPlainObject(returned) && returned.id ? returned : { ...tool };
        setCustomTools(prev => {
          if (draftId) return prev.map(t => (t.id === draftId ? savedRow : t));
          if (isNew) return [...prev, savedRow];
          return prev.map(t => (t.id === savedRow.id ? savedRow : t));
        });
        setIsToolDrawerOpen(false);
        setSelectedDrawerTool(null);
        notify(`Tool "${savedRow.name || tool.name || 'Untitled'}" saved.`);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errorMessage(err, 'The tool could not be saved. Please try again.') };
      }
    };
    const pending = run().finally(() => { toolSaveRef.current = null; });
    toolSaveRef.current = pending;
    return pending;
  }, [currentId, markDirty, notify]);

  const handleDeleteTool = useCallback(async (toolId) => {
    const removeLocal = () => setCustomTools(prev => prev.filter(t => t.id !== toolId));
    const closeDrawer = () => { setIsToolDrawerOpen(false); setSelectedDrawerTool(null); };

    if (!currentId || !toolId || isDraftToolId(toolId)) {
      removeLocal();
      closeDrawer();
      if (!currentId) markDirty(); // the tool list is part of the unsaved agent
      return { ok: true };
    }
    try {
      await apiFetch(`/api/pearl/agents/${encodeURIComponent(currentId)}/tools/${encodeURIComponent(toolId)}`, { method: 'DELETE' });
      removeLocal();
      closeDrawer();
      notify('Tool deleted.');
      return { ok: true };
    } catch (err) {
      if (err?.status === 404) {
        removeLocal();
        closeDrawer();
        notify('That tool had already been deleted.', { tone: 'info' });
        return { ok: true };
      }
      const error = errorMessage(err, 'The tool could not be deleted.');
      notify(`Couldn't delete the tool: ${error}`, { tone: 'error' });
      return { ok: false, error };
    }
  }, [currentId, markDirty, notify]);

  const handleToggleToolActive = useCallback(async (toolId, nextActive) => {
    setCustomTools(prev => prev.map(t => (t.id === toolId ? { ...t, is_active: nextActive } : t)));
    if (!currentId || isDraftToolId(toolId)) {
      markDirty();
      return;
    }
    try {
      await apiFetch(`/api/pearl/agents/${encodeURIComponent(currentId)}/tools/${encodeURIComponent(toolId)}`, {
        method: 'PATCH',
        body: { is_active: nextActive }
      });
    } catch (err) {
      setCustomTools(prev => prev.map(t => (t.id === toolId ? { ...t, is_active: !nextActive } : t)));
      notify(`Couldn't ${nextActive ? 'enable' : 'disable'} the tool: ${errorMessage(err, 'please try again.')}`, { tone: 'error' });
    }
  }, [currentId, markDirty, notify]);

  const handleAddToolClick = useCallback(() => {
    setIsSageOpen(false);
    setShowTestingPanel(false);
    setShowAddToolModal(true);
  }, []);

  const handleToggleSystemTool = useCallback((id, checked) => {
    setSystemTools(prev => prev.map(item => item.id === id ? { ...item, enabled: checked } : item));
    markDirty();
  }, [markDirty]);

  const handleOpenToolDocs = useCallback(() => {
    notify("Tools describe API lookups, input validators and record checks for your agent. They're saved with the agent and can be tried with the test in each tool's drawer; live calls and voice tests don't run them yet.", { tone: 'info', duration: 6000 });
  }, [notify]);

  const handleCloseAddToolModal = useCallback(() => {
    setShowAddToolModal(false);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setIsToolDrawerOpen(false);
    setSelectedDrawerTool(null);
  }, []);

  // ── Sage · AI Agent Architect sessions (namespaced by user + agent) ──────────
  const [sageSessions, setSageSessions] = useState(() => loadSageSessions(browserStorage(), { userKey, agentId }));
  const [currentSessionId, setCurrentSessionId] = useState(() => sageSessions[0]?.id || null);
  const sageKeys = useMemo(() => sageStorageKeys(userKey, currentId), [userKey, currentId]);

  useEffect(() => {
    const storage = browserStorage();
    if (sageSessions.some(s => (s.messages || []).length > 0)) {
      saveSageSessions(storage, sageKeys.sessions, sageSessions);
    } else {
      try {
        storage?.removeItem(sageKeys.sessions);
      } catch {
        // storage blocked: nothing to clean up
      }
    }
  }, [sageKeys, sageSessions]);

  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState('Prompt Tuning');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackError, setFeedbackError] = useState(null);
  const [showTranslationsModal, setShowTranslationsModal] = useState(false);

  const [sageInput, setSageInput] = useState('');
  const [isSageThinking, setIsSageThinking] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState({});
  // Only the latest Sage change of this page load can be undone (and only its own fields).
  const [lastPatch, setLastPatch] = useState(null); // { msgId, undo }
  const [sageBoundaryKey, setSageBoundaryKey] = useState(0);

  // Direct Phone Call Dialer Modal State
  const [showColdCallModal, setShowColdCallModal] = useState(false);
  const [coldCallPhone, setColdCallPhone] = useState('');
  const [coldCallRecipient, setColdCallRecipient] = useState('');
  // idle | saving | dispatching | dialing | ringing | connected | completed | cancelled | failed
  // | simulated (the server has no telephony: nothing was dialled, nothing to poll)
  const [coldCallStatus, setColdCallStatus] = useState('idle');
  const [coldCallLabel, setColdCallLabel] = useState('');
  const [coldCallId, setColdCallId] = useState(null);
  const [coldCallError, setColdCallError] = useState(null);
  const [coldCallNeedsTopUp, setColdCallNeedsTopUp] = useState(false);
  const [coldCallInfo, setColdCallInfo] = useState(null); // { number, provider, simulated, message, duration }
  const [coldCallPollNote, setColdCallPollNote] = useState(null);
  const [coldCallStartedAt, setColdCallStartedAt] = useState(0);
  const [coldCallNow, setColdCallNow] = useState(0);
  const coldCallBusyRef = useRef(false);
  const coldCallCancelRequestedRef = useRef(false);
  const isColdCallActive = COLD_CALL_ACTIVE.includes(coldCallStatus);

  const activeSession = useMemo(
    () => sageSessions.find(s => s.id === currentSessionId) || sageSessions[0] || null,
    [sageSessions, currentSessionId]
  );
  const sageMessages = useMemo(() => activeSession?.messages || [], [activeSession]);

  const updateActiveSessionMessages = useCallback((updater) => {
    setSageSessions(prev => {
      const activeId = prev.some(s => s.id === currentSessionId) ? currentSessionId : prev[0]?.id;
      return prev.map(s => {
        if (s.id !== activeId) return s;
        const nextMessages = typeof updater === 'function' ? updater(s.messages || []) : updater;
        return { ...s, title: sessionTitleFrom(nextMessages, s.title), updatedAt: Date.now(), messages: nextMessages };
      });
    });
  }, [currentSessionId]);

  // Active cold call elapsed-time ticker
  useEffect(() => {
    if (!isColdCallActive || !coldCallStartedAt) return undefined;
    const timer = setInterval(() => setColdCallNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isColdCallActive, coldCallStartedAt]);

  // Active cold call status polling (GET /api/pearl/calls/{id}) until a terminal status
  useEffect(() => {
    if (!coldCallId || !COLD_CALL_POLLING.includes(coldCallStatus)) return undefined;
    let stopped = false;
    const poll = async () => {
      try {
        const data = await apiFetch(`/api/pearl/calls/${encodeURIComponent(coldCallId)}`);
        if (stopped) return;
        setColdCallPollNote(null);
        const mapped = mapCallStatus(data?.status, { errorCode: data?.error_code });
        setColdCallLabel(mapped.label);
        if (mapped.terminal) {
          setColdCallInfo(prev => ({ ...(prev || {}), duration: data?.duration_seconds ?? null }));
          setColdCallError(mapped.phase === 'completed' ? null : mapped.reason);
        }
        setColdCallStatus(mapped.phase);
      } catch (err) {
        if (stopped) return;
        if (err?.status === 401 || err?.status === 404) {
          setColdCallStatus('failed');
          setColdCallError(err.status === 401 ? SESSION_EXPIRED_MESSAGE : 'This call could not be found any more.');
          return;
        }
        setColdCallPollNote(`Couldn't refresh the call status (${errorMessage(err, 'network error').replace(/\.$/, '')}). Retrying…`);
      }
    };
    const first = setTimeout(poll, 0);
    const timer = setInterval(poll, 2000);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [coldCallId, coldCallStatus]);

  // Real-time extracted dynamic variables from greeting + custom prompt
  const combinedPromptText = `${greetingEnabled ? greetingText : ''} ${promptMode === 'custom' ? systemPrompt : fineTuningDirectives}`;
  const detectedVariables = useMemo(() => extractVariables(combinedPromptText), [combinedPromptText]);

  // Editor values a Sage patch can touch (for describePatch / undo).
  const editorState = {
    promptMode, systemPrompt, fineTuningDirectives, greetingEnabled, greetingText,
    settings, speaker, language, pace, tone, mission, role, capsuleId
  };
  const latestEditorStateRef = useRef(editorState);
  useEffect(() => {
    latestEditorStateRef.current = editorState;
  });

  /** Set the editor fields present in `partial` (editor field names). */
  const applyEditorPartial = (partial) => {
    if (!partial) return;
    if (hasOwn(partial, 'agentName')) setAgentName(partial.agentName || DEFAULT_AGENT_NAME);
    if (hasOwn(partial, 'promptMode')) setPromptMode(partial.promptMode === 'custom' ? 'custom' : 'expert');
    if (hasOwn(partial, 'systemPrompt')) setSystemPrompt(partial.systemPrompt ?? '');
    if (hasOwn(partial, 'fineTuningDirectives')) setFineTuningDirectives(partial.fineTuningDirectives ?? '');
    if (hasOwn(partial, 'greetingEnabled')) setGreetingEnabled(Boolean(partial.greetingEnabled));
    if (hasOwn(partial, 'greetingText')) setGreetingText(partial.greetingText ?? '');
    if (hasOwn(partial, 'speaker')) setSpeaker(partial.speaker || DEFAULT_SPEAKER);
    if (hasOwn(partial, 'language')) setLanguage(partial.language || 'Auto');
    if (hasOwn(partial, 'pace')) setPace(clampPace(partial.pace ?? 1));
    if (hasOwn(partial, 'tone')) setTone(partial.tone || 'Professional');
    if (hasOwn(partial, 'mission')) setMission(partial.mission ?? '');
    if (hasOwn(partial, 'role')) setRole(partial.role || 'outbound_qualification');
    if (hasOwn(partial, 'capsuleId')) {
      capsuleTouchedRef.current = true;
      setCapsuleId(partial.capsuleId ?? '');
    }
    if (hasOwn(partial, 'testVariables') && isPlainObject(partial.testVariables)) setTestVariables(partial.testVariables);
    if (hasOwn(partial, 'settings')) {
      setSettings(prev => mergeEditorState({ settings: prev }, { settings: partial.settings }).settings);
    }
  };

  // Apply Blueprint from Library. Returns false when the user cancels (the library stays open).
  const applyArchetype = (archetype) => {
    if (!archetype) return false;
    const isExistingAgent = Boolean(currentId);
    const state = { agentName, role, mission, systemPrompt, fineTuningDirectives, greetingEnabled, greetingText, speaker, language, pace, tone };
    const changes = archetypeChangeSummary(archetype, state, { isExistingAgent });
    if (changes.length > 0 && hasReplaceableContent(state, { isExistingAgent, isDirty })) {
      const proceed = window.confirm(
        `Apply the "${archetype.name}" blueprint?\n\nThis replaces:\n${changes.map(c => `• ${c}`).join('\n')}\n\n`
        + `${isExistingAgent ? 'The agent keeps its name. ' : ''}Nothing is saved until you press Save.`
      );
      if (!proceed) return false;
    }
    applyEditorPartial(archetypeToEditorPartial(archetype, { testVariables, keepName: isExistingAgent }));
    setActiveArchetypeId(archetype.id);
    markDirty();
    notify(`Applied blueprint: ${archetype.name}`);
    return true;
  };

  // 1. Fetch available Product Knowledge Capsules
  useEffect(() => {
    let active = true;
    apiFetch('/api/capsules')
      .then(data => {
        if (!active) return;
        const list = Array.isArray(data) ? data : [];
        setCapsules(list);
        setCapsulesError(null);
        // Preselect the default knowledge base only for a brand-new agent the user hasn't touched.
        if (createModeRef.current && !capsuleTouchedRef.current && list.length > 0) {
          const def = list.find(c => c.is_default) || list[0];
          setCapsuleId(prev => prev || String(def.id));
        }
      })
      .catch(err => {
        if (active) setCapsulesError(errorMessage(err, "Couldn't load your knowledge bases."));
      });
    return () => { active = false; };
  }, [capsulesAttempt]);

  /** Copy a saved agent record into the editor. Returns its tools list (or null if absent). */
  const hydrateFromAgent = useCallback((data) => {
    const { settings: savedSettings, ui } = splitSavedSettings(data?.settings ?? data?.voice_config?.settings);
    setAgentName(data?.name || 'Untitled Agent');
    setRole(data?.role || 'outbound_qualification');
    setMission(data?.mission || '');

    const prompt = restorePromptState(data?.system_prompt, ui);
    setPromptMode(prompt.promptMode);
    setSystemPrompt(prompt.systemPrompt);
    setFineTuningDirectives(prompt.fineTuningDirectives);

    const greeting = restoreGreeting(data?.greeting, ui);
    setGreetingEnabled(greeting.greetingEnabled);
    setGreetingText(greeting.greetingText);

    const vc = isPlainObject(data?.voice_config) ? data.voice_config : {};
    setSpeaker(vc.speaker || DEFAULT_SPEAKER);
    setLanguage(vc.language || 'Auto');
    setPace(clampPace(vc.pace ?? 1));
    setTone(vc.tone || 'Professional');

    setSettings(restoreSettings(savedSettings));
    setSystemTools(mergeSystemTools(DEFAULT_SYSTEM_TOOLS, pickSavedToolsConfig(data)));
    setCapsuleId(data?.capsule_id !== null && data?.capsule_id !== undefined ? String(data.capsule_id) : '');
    if (isPlainObject(data?.test_variables)) setTestVariables(data.test_variables);
    setAgentMeta({ status: data?.status, version: data?.version });
    return Array.isArray(data?.tools) ? data.tools : null;
  }, []);

  // 2. Fetch the existing agent (blocking error state on failure — never an editable default form)
  useEffect(() => {
    if (!currentId || hydratedIdRef.current === currentId) return undefined;
    const controller = new AbortController();
    let active = true;
    apiFetch(`/api/pearl/agents/${encodeURIComponent(currentId)}`, { signal: controller.signal })
      .then(async (data) => {
        if (!active) return;
        const tools = hydrateFromAgent(isPlainObject(data) ? data : {});
        hydratedIdRef.current = currentId;
        if (tools) {
          setCustomTools(tools);
        } else {
          try {
            const list = await apiFetch(`/api/pearl/agents/${encodeURIComponent(currentId)}/tools`, { signal: controller.signal });
            if (active) setCustomTools(Array.isArray(list) ? list : []);
          } catch (err) {
            if (active && !isAbortError(err)) notify(`Couldn't load this agent's tools: ${errorMessage(err)}`, { tone: 'error' });
          }
        }
        if (!active) return;
        setIsDirty(false);
        setLoadState('ready');
      })
      .catch(err => {
        if (!active || isAbortError(err)) return;
        setLoadError({
          status: err?.status || 0,
          message: errorMessage(err, "Couldn't load this agent. Check your connection and try again.")
        });
        setLoadState('error');
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [currentId, loadAttempt, hydrateFromAgent, notify]);

  const retryLoad = () => {
    setLoadError(null);
    setLoadState('loading');
    setLoadAttempt(n => n + 1);
  };

  // Warn before closing / reloading the tab with unsaved edits.
  useEffect(() => {
    if (!isDirty) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  const confirmDiscardChanges = () => !isDirty || window.confirm('You have unsaved changes. Leave without saving?');

  const guardedBack = () => {
    if (!confirmDiscardChanges()) return;
    onBack?.();
  };

  // Opens Pearl → Knowledge base through the Dashboard deep link (`?tab=pearl&section=knowledge`).
  const handleOpenKnowledgeBase = () => {
    if (!confirmDiscardChanges()) return;
    try {
      const dashboard = useDashboardStore.getState();
      dashboard.setActiveTab('pearl');
      dashboard.setPearlSection?.('knowledge');
    } catch {
      // store unavailable: the deep link below still selects the section
    }
    navigate('/dashboard?tab=pearl&section=knowledge');
  };

  // Audio preview of the ambient sound option (generated noise, approximate)
  const playAmbientPreview = (type) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const audioCtx = new AudioCtx();
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
      noise.onended = () => { audioCtx.close().catch(() => {}); };
      noise.start();
    } catch {
      // Web Audio not supported in this browser
    }
  };

  /** Create the drafts of a just-created agent; returns a warning text when some failed. */
  const flushDraftTools = async (newAgentId) => {
    const drafts = customTools.filter(t => !t.id || isDraftToolId(t.id));
    if (drafts.length === 0) return null;
    const created = new Map();
    const failures = [];
    for (const draft of drafts) {
      try {
        const row = await apiFetch(`/api/pearl/agents/${encodeURIComponent(newAgentId)}/tools`, {
          method: 'POST',
          body: toolRequestBody(draft)
        });
        if (isPlainObject(row) && row.id) created.set(draft.id, row);
      } catch (err) {
        failures.push(`${draft.name || 'Untitled tool'} (${errorMessage(err, 'not saved').replace(/\.$/, '')})`);
      }
    }
    setCustomTools(prev => prev.map(t => created.get(t.id) || t));
    if (failures.length === 0) return null;
    return `${failures.length} tool${failures.length === 1 ? '' : 's'} could not be saved: ${failures.join('; ')}. They are still listed — open each one and save it again.`;
  };

  /**
   * Save the agent (POST for a new agent, PATCH otherwise).
   * Resolves { ok: true, id } or { ok: false, error }; never throws. Concurrent calls share one request.
   */
  const saveAgent = () => {
    if (saveInFlightRef.current) return saveInFlightRef.current;
    const run = async () => {
      setSaving(true);
      setSaveSuccess(false);
      setSaveNotice(null);
      const versionAtStart = dirtyVersionRef.current;

      // Expert mode stores the directives (or null so the backend uses the core engine).
      const finalPrompt = promptMode === 'expert'
        ? (fineTuningDirectives.trim() ? fineTuningDirectives.trim() : null)
        : systemPrompt;
      const persistedSettings = buildPersistedSettings({ settings, promptMode, fineTuningDirectives, greetingText, systemPrompt });

      const payload = {
        name: agentName.trim() || 'Untitled Agent',
        // Saved on create and on PATCH (a blank role is rejected on PATCH, so never send one).
        role: String(role || '').trim() || 'outbound_qualification',
        mission,
        system_prompt: finalPrompt,
        greeting: greetingEnabled && greetingText.trim() ? greetingText : null,
        voice_config: {
          speaker,
          language,
          pace: clampPace(pace),
          tone,
          settings: persistedSettings,
          tools_config: systemTools
        },
        settings: persistedSettings,
        tools_config: systemTools,
        capsule_id: capsuleId ? Number(capsuleId) : null,
        test_variables: testVariables
      };

      const isNew = !currentId;
      try {
        const saved = await apiFetch(
          isNew ? '/api/pearl/agents' : `/api/pearl/agents/${encodeURIComponent(currentId)}`,
          { method: isNew ? 'POST' : 'PATCH', body: payload }
        );
        const savedId = (isPlainObject(saved) && saved.id) || currentId;
        if (!savedId) {
          return { ok: false, error: 'The server did not return the saved agent.' };
        }
        if (isPlainObject(saved)) setAgentMeta({ status: saved.status, version: saved.version });

        let toolWarning = null;
        if (isNew) {
          hydratedIdRef.current = savedId; // state already matches what we just created
          createModeRef.current = false;
          clearDraftSageStorage(browserStorage(), userKey);
          setCreatedId(savedId);
          toolWarning = await flushDraftTools(savedId);
          onCreated?.(savedId);
        }

        if (dirtyVersionRef.current === versionAtStart) setIsDirty(false);
        setSaveSuccess(true);
        if (saveSuccessTimerRef.current) clearTimeout(saveSuccessTimerRef.current);
        saveSuccessTimerRef.current = setTimeout(() => setSaveSuccess(false), 2500);
        if (toolWarning) setSaveNotice({ tone: 'warning', message: toolWarning });
        return { ok: true, id: savedId };
      } catch (err) {
        const message = errorMessage(err, 'The agent could not be saved. Please try again.');
        setSaveNotice({ tone: 'error', message: `Save failed: ${message}` });
        return { ok: false, error: message };
      } finally {
        setSaving(false);
      }
    };
    const pending = run().finally(() => { saveInFlightRef.current = null; });
    saveInFlightRef.current = pending;
    return pending;
  };

  const handleSaveAgent = () => {
    saveAgent();
  };

  const handleOpenTesting = async () => {
    setIsSageOpen(false);
    setIsToolDrawerOpen(false);
    setSelectedDrawerTool(null);
    setShowAddToolModal(false);
    // Test sessions snapshot the SAVED agent, so save first when there are edits.
    if (!currentId || isDirty) {
      const result = await saveAgent();
      if (!result.ok) {
        setSaveNotice({ tone: 'error', message: `The agent wasn't saved, so the test was not started: ${result.error}` });
        return;
      }
    }
    setShowTestingPanel(true);
  };

  // ── Sage patches & undo ──────────────────────────────────────────────────────
  const applySagePatch = (patch, msgId) => {
    const current = latestEditorStateRef.current || editorState;
    const partial = patchToEditorPartial(patch);
    const undo = undoForPartial(partial, current);
    applyEditorPartial(partial);
    markDirty();
    setLastPatch({ msgId, undo });
  };

  const handleUndoPatch = (msgId) => {
    if (!lastPatch || lastPatch.msgId !== msgId) return;
    applyEditorPartial(lastPatch.undo);
    setLastPatch(null);
    updateActiveSessionMessages(prev => prev.map(m => (m.id === msgId ? { ...m, is_undone: true } : m)));
    markDirty();
    notify('Sage change reverted.');
  };

  // Clear / New / Delete / Select Chat Handlers
  const handleClearSageChat = () => {
    updateActiveSessionMessages([]);
    setLastPatch(null);
    notify('Sage conversation cleared.', { tone: 'info' });
  };

  const handleNewSageChat = () => {
    if (activeSession && (activeSession.messages || []).length === 0) {
      setShowHistoryPanel(false);
      setSageInput('');
      return;
    }
    const newSession = {
      ...createSageSession(Date.now()),
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setSageSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);
    setShowHistoryPanel(false);
    setSageInput('');
  };

  const handleDeleteSession = (sessId, e) => {
    e?.stopPropagation();
    const target = sageSessions.find(s => s.id === sessId);
    const remaining = sageSessions.filter(s => s.id !== sessId);
    const next = remaining.length > 0 ? remaining : [createSageSession(Date.now())];
    setSageSessions(next);
    if (currentSessionId === sessId || remaining.length === 0) setCurrentSessionId(next[0].id);
    if (lastPatch && target?.messages?.some(m => m.id === lastPatch.msgId)) setLastPatch(null);
  };

  const handleSelectSession = (sessId) => {
    setCurrentSessionId(sessId);
    setShowHistoryPanel(false);
  };

  const clearAllSageHistory = () => {
    const fresh = [createSageSession(Date.now())];
    setSageSessions(fresh);
    setCurrentSessionId(fresh[0].id);
    setLastPatch(null);
    setExpandedSteps({});
  };

  // ── Direct phone call dialer ─────────────────────────────────────────────────
  const openColdCallModal = () => {
    setColdCallRecipient(String(testVariables.lead_name || testVariables.prospect_name || '').trim());
    if (!isColdCallActive) {
      setColdCallError(null);
      setColdCallNeedsTopUp(false);
      setColdCallPollNote(null);
    }
    setShowColdCallModal(true);
  };

  const handleCancelColdCall = async () => {
    if (!coldCallId) {
      if (coldCallBusyRef.current) {
        // Still saving / dispatching: cancel as soon as the call id is known.
        coldCallCancelRequestedRef.current = true;
        setColdCallLabel('Cancelling…');
        return true;
      }
      setColdCallStatus('idle');
      return true;
    }
    try {
      await apiFetch(`/api/pearl/calls/${encodeURIComponent(coldCallId)}/cancel`, { method: 'POST' });
      setColdCallStatus('cancelled');
      setColdCallLabel('Cancelled');
      setColdCallError(null);
      return true;
    } catch (err) {
      if (err?.status === 400) {
        // Already finished — the next status check shows the real outcome.
        setColdCallPollNote('The call had already ended.');
        return true;
      }
      setColdCallError(`Couldn't hang up: ${errorMessage(err)}`);
      return false;
    }
  };

  const closeColdCallModal = async () => {
    if (isColdCallActive) {
      const ended = await handleCancelColdCall();
      if (!ended) return; // keep the dialog open so the error stays visible
    }
    setShowColdCallModal(false);
  };

  const closeColdCallIfIdle = () => {
    if (!isColdCallActive) setShowColdCallModal(false);
  };

  const handleTriggerColdCall = async () => {
    if (coldCallBusyRef.current || isColdCallActive) return;
    const phone = normalizeIndianPhone(coldCallPhone);
    if (!phone.valid) {
      setColdCallError(phone.error);
      return;
    }
    coldCallBusyRef.current = true;
    coldCallCancelRequestedRef.current = false;
    setColdCallError(null);
    setColdCallNeedsTopUp(false);
    setColdCallPollNote(null);
    setColdCallId(null);
    setColdCallInfo({ number: phone.e164, provider: null, simulated: false, duration: null });
    const startedAt = Date.now();
    setColdCallStartedAt(startedAt);
    setColdCallNow(startedAt);
    try {
      let targetId = currentId;
      if (!targetId || isDirty) {
        setColdCallStatus('saving');
        setColdCallLabel('Saving');
        const saved = await saveAgent();
        if (!saved.ok) {
          setColdCallStatus('failed');
          setColdCallError(`The agent could not be saved, so no call was placed: ${saved.error}`);
          return;
        }
        targetId = saved.id;
      }
      if (coldCallCancelRequestedRef.current) {
        setColdCallStatus('cancelled');
        setColdCallLabel('Cancelled');
        return;
      }

      setColdCallStatus('dispatching');
      setColdCallLabel('Placing call');
      const data = await apiFetch(`/api/pearl/agents/${encodeURIComponent(targetId)}/calls`, {
        method: 'POST',
        body: {
          phone_number: phone.e164,
          recipient_name: coldCallRecipient.trim() || 'Prospect',
          call_provider: 'vobiz'
        }
      });
      const result = interpretColdCallResponse(data, phone.e164);
      const callId = result.callId;
      if (!callId) {
        setColdCallStatus('failed');
        setColdCallError('The server did not return a call id, so the call status is unknown.');
        return;
      }
      setColdCallInfo({
        number: result.number,
        provider: result.provider,
        simulated: result.simulated,
        message: result.message,
        duration: null
      });
      setColdCallId(callId);

      if (coldCallCancelRequestedRef.current) {
        try {
          await apiFetch(`/api/pearl/calls/${encodeURIComponent(callId)}/cancel`, { method: 'POST' });
          setColdCallStatus('cancelled');
          setColdCallLabel('Cancelled');
        } catch (err) {
          if (result.simulated) {
            // Nothing was dialled, so there is nothing to hang up (and nothing to poll).
            setColdCallLabel('Simulated');
            setColdCallStatus('simulated');
            return;
          }
          setColdCallStatus('dialing');
          setColdCallError(`The call was placed but could not be cancelled: ${errorMessage(err)}`);
        }
        return;
      }
      if (result.simulated) {
        // Nothing was dialled and the call stays "initiating" on the server: don't poll it.
        setColdCallLabel('Simulated');
        setColdCallStatus('simulated');
        return;
      }
      const mapped = mapCallStatus(result.status);
      setColdCallLabel(mapped.label);
      setColdCallStatus(mapped.phase);
    } catch (err) {
      setColdCallStatus('failed');
      setColdCallNeedsTopUp(err?.status === 402);
      setColdCallError(errorMessage(err, 'The call could not be placed.'));
    } finally {
      coldCallBusyRef.current = false;
    }
  };

  const openWalletTab = () => {
    if (!confirmDiscardChanges()) return;
    try {
      useDashboardStore.getState().setActiveTab('wallet');
    } catch {
      // store unavailable: the dashboard opens on its default tab
    }
    navigate('/dashboard');
  };

  // ── Sage chat ────────────────────────────────────────────────────────────────
  const handleSageSubmit = async (e, directQuery = null, { excludeIds = [] } = {}) => {
    e?.preventDefault?.();
    const query = String(directQuery ?? sageInput ?? '').trim();
    if (!query || isSageThinking) return;

    const userMsg = { id: `u-${Date.now()}`, sender: 'user', text: query, timestamp: nowLabel() };
    const history = sageMessages
      .filter(m => !m.is_error && !excludeIds.includes(m.id))
      .slice(-6)
      .map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text + (m.body ? `\n${m.body}` : '')
      }));

    updateActiveSessionMessages(prev => [...prev.filter(m => !excludeIds.includes(m.id)), userMsg]);
    setSageInput('');
    setIsSageThinking(true);

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
      const data = await apiFetch('/api/pearl/sage/chat', {
        method: 'POST',
        body: {
          messages: history,
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
        }
      });

      const assistantMsg = normalizeSageMessage(
        { ...(isPlainObject(data) ? data : {}), sender: 'assistant', is_error: false, is_undone: false, patch_diff: [] },
        { fallbackId: `s-${Date.now()}` }
      );
      if (!assistantMsg.timestamp || assistantMsg.timestamp === 'Just now') assistantMsg.timestamp = nowLabel();
      if (sageMessages.some(m => m.id === assistantMsg.id)) assistantMsg.id = `${assistantMsg.id}-${Date.now()}`;

      // Apply the patch only when it actually changes something visible.
      if (assistantMsg.patch) {
        const diff = describePatch(assistantMsg.patch, latestEditorStateRef.current || editorState, { capsules });
        if (diff.length > 0) {
          applySagePatch(assistantMsg.patch, assistantMsg.id);
          assistantMsg.patch_diff = diff;
        } else {
          assistantMsg.patch = null;
        }
      }
      updateActiveSessionMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const reason = errorMessage(err, 'Could not reach Sage.').replace(/\.$/, '');
      updateActiveSessionMessages(prev => [...prev, normalizeSageMessage({
        id: `s-err-${Date.now()}`,
        sender: 'assistant',
        is_error: true,
        retry_query: query,
        retry_user_id: userMsg.id,
        text: `Sage is unavailable (${reason}). Nothing was changed.`,
        timestamp: nowLabel()
      })]);
    } finally {
      setIsSageThinking(false);
    }
  };

  const retrySage = (msg) => {
    if (!msg?.retry_query) return;
    handleSageSubmit(null, msg.retry_query, { excludeIds: [msg.id, msg.retry_user_id].filter(Boolean) });
  };

  // Action-card options are free text: only an explicit "call my number" option opens the dialer.
  const handleSageAction = (option) => {
    if (classifySageAction(option) === 'dial') {
      openColdCallModal();
      return;
    }
    handleSageSubmit(null, option);
  };

  const handleSubmitFeedback = async () => {
    const notes = feedbackText.trim();
    if (!notes || feedbackSending) return;
    setFeedbackSending(true);
    setFeedbackError(null);
    try {
      await apiFetch('/api/pearl/sage/feedback', {
        method: 'POST',
        body: { agent_id: currentId || null, category: feedbackCategory, notes }
      });
      setShowFeedbackModal(false);
      setFeedbackText('');
      notify('Thanks — your feedback was sent to the ClozFlow team.');
    } catch (err) {
      setFeedbackError(errorMessage(err, 'Your feedback could not be sent. Please try again.'));
    } finally {
      setFeedbackSending(false);
    }
  };

  // ── Variables ────────────────────────────────────────────────────────────────
  const handleAddVariable = () => {
    const result = validateVariableName(newVarName ?? '', Object.keys(testVariables));
    if (!result.ok) {
      setNewVarError(result.error);
      return;
    }
    setTestVariables(prev => ({ ...prev, [result.name]: '' }));
    setNewVarName(null);
    setNewVarError(null);
    markDirty();
  };

  const handleDeleteVariable = (name) => {
    const previous = testVariables[name];
    setTestVariables(prev => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    markDirty();
    notify(`Variable "${name}" removed.`, {
      tone: 'info',
      action: {
        label: 'Undo',
        onClick: () => {
          setTestVariables(prev => (hasOwn(prev, name) ? prev : { ...prev, [name]: previous }));
          markDirty();
        }
      }
    });
  };

  // ── Review ───────────────────────────────────────────────────────────────────
  const handleReviewSave = async () => {
    setReviewError(null);
    const result = await saveAgent();
    if (result.ok) {
      setShowReviewModal(false);
      notify('Agent saved.');
    } else {
      setReviewError(result.error);
    }
  };

  // Dialog accessibility (role=dialog, focus trap, Esc, backdrop)
  const reviewDialog = useDialogA11y(showReviewModal, () => setShowReviewModal(false));
  const reviewBackdrop = useBackdropDismiss(() => setShowReviewModal(false));
  const coldCallDialog = useDialogA11y(showColdCallModal, isColdCallActive ? null : closeColdCallIfIdle);
  const coldCallBackdrop = useBackdropDismiss(closeColdCallIfIdle);
  const feedbackDialog = useDialogA11y(showFeedbackModal, () => setShowFeedbackModal(false));
  const feedbackBackdrop = useBackdropDismiss(() => setShowFeedbackModal(false));
  const translationsDialog = useDialogA11y(showTranslationsModal, () => setShowTranslationsModal(false));
  const translationsBackdrop = useBackdropDismiss(() => setShowTranslationsModal(false));

  const coldPhone = normalizeIndianPhone(coldCallPhone);
  const coldCallElapsed = coldCallStartedAt ? Math.max(0, Math.floor((coldCallNow - coldCallStartedAt) / 1000)) : 0;
  const statusMeta = agentMeta ? agentStatusMeta(agentMeta.status) : null;
  const versionLabel = currentId
    ? `v${agentMeta?.version || 1} · ${statusMeta?.label || 'Draft'}`
    : 'New · not saved yet';
  const selectedCapsule = capsules.find(c => String(c.id) === String(capsuleId));
  const readinessChecks = showReviewModal
    ? buildReadinessChecks(
        {
          agentName, promptMode, systemPrompt, fineTuningDirectives, greetingEnabled, greetingText,
          speaker, language, pace, capsuleId, capsuleName: selectedCapsule?.name, testVariables
        },
        { voiceIds: VOICE_IDS, detectedVariables }
      )
    : [];
  const pendingChecks = readinessChecks.filter(c => !c.ok).length;
  const testingAgentSnapshot = useMemo(() => ({
    id: currentId,
    name: agentName,
    mission,
    system_prompt: promptMode === 'expert' ? fineTuningDirectives : systemPrompt,
    greeting: greetingEnabled ? greetingText : null,
    voice_config: { speaker, language, pace, tone, settings },
    capsule_id: capsuleId,
    test_variables: testVariables
  }), [currentId, agentName, mission, promptMode, fineTuningDirectives, systemPrompt, greetingEnabled, greetingText, speaker, language, pace, tone, settings, capsuleId, testVariables]);
  const missingLanguages = LANGUAGE_OPTIONS.filter(l => !(settings.languagesAllowed || []).includes(l));
  const testButtonLabel = !currentId || isDirty ? 'Save & test' : 'Test agent';

  // ────────────────────────────────────────────────────────────────────────
  // TAB 1: INSTRUCTIONS
  // ────────────────────────────────────────────────────────────────────────
  const renderInstructionsTab = () => (
    <div className="sarvam-panel-content">
      {/* Greeting Section */}
      <div className="instruction-section">
        <div className="instruction-section-header">
          <span className="dotted-title" id="greeting-title">Greeting</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {greetingEnabled && (
              <button
                type="button"
                className="btn-translation-chip"
                onClick={() => setShowTranslationsModal(true)}
                title="Which languages have voices, and how the fixed greeting is spoken"
              >
                <Globe size={13} />
                <span>Languages</span>
              </button>
            )}
            <ToggleSwitch
              checked={greetingEnabled}
              label="Fixed opening greeting"
              title="Toggle fixed opening greeting"
              onChange={(checked) => { setGreetingEnabled(checked); markDirty(); }}
            />
          </div>
        </div>

        {greetingEnabled ? (
          <div>
            <textarea
              className="sarvam-textarea"
              rows={3}
              aria-labelledby="greeting-title"
              value={greetingText}
              onChange={(e) => { setGreetingText(e.target.value); markDirty(); }}
              placeholder={DEFAULT_GREETING}
            />
            {/* Live Substituted Preview */}
            <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#64748b' }}>
              <strong>Preview:</strong> <em>"{substituteVariables(greetingText, testVariables)}"</em>
            </div>
          </div>
        ) : (
          <div style={{ padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.82rem', color: '#64748b' }}>
            Fixed opening greeting is <strong>Off</strong>. Pearl writes a context-grounded opening line for each prospect.
            {greetingText.trim() && greetingText !== DEFAULT_GREETING && ' Your greeting text is kept for when you switch it back on.'}
          </div>
        )}
      </div>

      {/* Instructions / System Prompt Section */}
      <div className="instruction-section">
        <div className="instruction-section-header">
          <span className="dotted-title" id="instructions-title">Instructions</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {promptMode === 'expert' ? (
              <button
                type="button"
                className="expert-switch-btn"
                onClick={() => { setPromptMode('custom'); markDirty(); }}
              >
                Customize Completely
              </button>
            ) : (
              <button
                type="button"
                className="expert-switch-btn"
                onClick={() => { setPromptMode('expert'); markDirty(); }}
                title="Switch to the built-in sales brain. Your custom prompt is kept as a draft."
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
            {systemPrompt.trim() && (
              <p className="editor-inline-note" style={{ marginTop: 10 }}>
                Your custom prompt is kept as a draft and is not used while the Expert Sales Brain is active. Choose “Customize Completely” to use it again.
              </p>
            )}

            {/* Optional Fine-Tuning Box */}
            <div className="fine-tuning-accordion">
              <div className="fine-tuning-title" id="directives-title">Additional Directives (Optional)</div>
              <textarea
                className="sarvam-textarea"
                rows={4}
                aria-labelledby="directives-title"
                value={fineTuningDirectives}
                onChange={(e) => { setFineTuningDirectives(e.target.value); markDirty(); }}
                placeholder="Add company-specific instructions or nuances here without overriding the core sales brain... (e.g. 'Highlight our 14-day free pilot offer')"
              />
            </div>
          </div>
        ) : (
          <div>
            <textarea
              className="sarvam-textarea"
              rows={12}
              aria-labelledby="instructions-title"
              value={systemPrompt}
              onChange={(e) => { setSystemPrompt(e.target.value); markDirty(); }}
              placeholder={'Write the agent prompt. Insert caller data with {{variable_name | "Fallback"}}.'}
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
  // TAB 2: VARIABLES
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
              aria-pressed={variablesSubtab === 'input'}
              onClick={() => setVariablesSubtab('input')}
            >
              Input variables
            </button>
            <button
              type="button"
              className={`subtab-pill ${variablesSubtab === 'output' ? 'active' : ''}`}
              aria-pressed={variablesSubtab === 'output'}
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
                aria-label="Search variables"
                value={varSearchQuery}
                onChange={(e) => setVarSearchQuery(e.target.value)}
              />
            </div>
            {variablesSubtab === 'input' && newVarName === null && (
              <button
                type="button"
                className="btn-add-pill"
                onClick={() => { setNewVarName(''); setNewVarError(null); }}
              >
                <Plus size={14} />
                <span>Add</span>
              </button>
            )}
          </div>
        </div>

        {variablesSubtab === 'input' ? (
          <>
            <p className="editor-inline-note">
              Default values are sample data used for previews and test calls when no live value is passed. Replace them with your own.
            </p>
            {newVarName !== null && (
              <div className="var-add-row">
                <input
                  type="text"
                  className="sarvam-input"
                  autoFocus
                  aria-label="New variable name"
                  placeholder="e.g. prospect_title"
                  value={newVarName}
                  onChange={(e) => { setNewVarName(e.target.value); setNewVarError(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); handleAddVariable(); }
                    if (e.key === 'Escape') { setNewVarName(null); setNewVarError(null); }
                  }}
                />
                <button type="button" className="btn-add-pill" onClick={handleAddVariable}>
                  <Plus size={14} />
                  <span>Add variable</span>
                </button>
                <button type="button" className="btn-secondary-pill" onClick={() => { setNewVarName(null); setNewVarError(null); }}>
                  Cancel
                </button>
                {newVarError && <span className="var-add-error" role="alert">{newVarError}</span>}
              </div>
            )}
            <div className="sarvam-table-container">
              <table className="sarvam-table">
                <thead>
                  <tr>
                    <th style={{ width: '45%' }}>Variable name</th>
                    <th style={{ width: '45%' }}>Default value</th>
                    <th style={{ width: '10%', textAlign: 'right' }}><span className="sr-only">Actions</span></th>
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
                            aria-label={`Default value for ${k}`}
                            value={testVariables[k] ?? ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setTestVariables(prev => ({ ...prev, [k]: val }));
                              markDirty();
                            }}
                            placeholder="Enter default value..."
                          />
                        </td>
                        <td className="table-row-actions">
                          <button
                            type="button"
                            className="icon-action-btn"
                            aria-label={`Delete variable ${k}`}
                            title={`Delete variable ${k}`}
                            onClick={() => handleDeleteVariable(k)}
                          >
                            <Trash2 size={14} />
                          </button>
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
          </>
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
                {OUTPUT_VARIABLES.map(v => (
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
  // TAB 3: TOOLS STUDIO
  // ────────────────────────────────────────────────────────────────────────
  const renderToolsTab = () => (
    <>
      <p className="editor-inline-note tools-system-note">
        Tools are saved with the agent and you can try each one with the test in its drawer, but live calls and browser voice tests don&apos;t run agent tools yet. The built-in system tool switches are saved too and don&apos;t change calls yet either.
      </p>
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
    </>
  );


  // ────────────────────────────────────────────────────────────────────────
  // TAB 4: SETTINGS
  // ────────────────────────────────────────────────────────────────────────
  const updateSetting = (key, value) => {
    setSettings(s => ({ ...s, [key]: value }));
    markDirty();
  };

  const renderSettingsTab = () => (
    <div className="sarvam-panel-content">
      {/* 0. Voice */}
      <div className="settings-group-title">Voice</div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Voice persona</div>
          <div className="setting-sub">The voice the agent speaks with on calls and tests</div>
        </div>
        <div className="voice-select-wrap">
          <VoicePersonaSelector
            value={speaker}
            onChange={(id) => { setSpeaker(id); markDirty(); }}
          />
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Language</div>
          <div className="setting-sub">The language the agent speaks in. Auto mirrors the caller (Hinglish by default).</div>
        </div>
        <div className="setting-control">
          <select
            className="sarvam-select"
            aria-label="Agent language"
            value={language}
            onChange={(e) => { setLanguage(e.target.value); markDirty(); }}
          >
            {!VOICE_LANGUAGE_OPTIONS.some(o => o.value === language) && <option value={language}>{language}</option>}
            {VOICE_LANGUAGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Speaking pace</div>
          <div className="setting-sub">Slower is clearer; faster sounds more energetic</div>
        </div>
        <div className="sarvam-slider-wrap">
          <span className="sarvam-slider-label">{Number(pace).toFixed(2)}x</span>
          <input
            type="range"
            min={PACE_MIN}
            max={PACE_MAX}
            step="0.05"
            className="sarvam-slider"
            aria-label="Speaking pace"
            value={pace}
            onChange={(e) => { setPace(clampPace(e.target.value)); markDirty(); }}
          />
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Tone <RuntimeNote /></div>
          <div className="setting-sub">The delivery style you want for this persona</div>
        </div>
        <div className="setting-control">
          <select
            className="sarvam-select"
            aria-label="Tone"
            value={tone}
            onChange={(e) => { setTone(e.target.value); markDirty(); }}
          >
            {!TONE_OPTIONS.includes(tone) && <option value={tone}>{tone}</option>}
            {TONE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div className="settings-section-divider" />

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
            aria-label="Creativity"
            value={settings.temperature}
            onChange={(e) => updateSetting('temperature', parseFloat(e.target.value))}
          />
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Knowledge bases</div>
          <div className="setting-sub">Docs the agent searches to answer factual questions</div>
          {capsulesError && (
            <div className="setting-sub" role="alert" style={{ color: '#b91c1c' }}>
              {capsulesError}{' '}
              <button type="button" className="link-btn" onClick={() => setCapsulesAttempt(n => n + 1)}>Retry</button>
            </div>
          )}
        </div>
        <div className="setting-control">
          <select
            className="sarvam-select"
            aria-label="Knowledge base"
            value={capsuleId}
            onChange={(e) => {
              capsuleTouchedRef.current = true;
              setCapsuleId(e.target.value);
              markDirty();
            }}
          >
            <option value="">Select knowledge base...</option>
            {capsuleId && !selectedCapsule && (
              <option value={capsuleId}>{`Knowledge base #${capsuleId}`}</option>
            )}
            {capsules.map(c => {
              const label = (c.product_name && c.product_name !== c.name)
                ? `${c.name} (${c.product_name})`
                : c.name;
              return (
                <option key={c.id} value={String(c.id)} title={label}>
                  {label}
                </option>
              );
            })}
          </select>
          <button
            type="button"
            className="btn-icon-menu"
            title="Manage knowledge bases (opens Pearl → Knowledge base)"
            aria-label="Manage knowledge bases"
            onClick={handleOpenKnowledgeBase}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="settings-section-divider" />

      {/* 2. Listening */}
      <div className="settings-group-title">Listening <RuntimeNote /></div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Let callers interrupt</div>
          <div className="setting-sub">Caller can talk over the agent while it's speaking</div>
        </div>
        <ToggleSwitch checked={settings.bargeIn} label="Let callers interrupt" onChange={(v) => updateSetting('bargeIn', v)} />
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Eagerness to respond</div>
          <div className="setting-sub">How quickly the agent replies after a pause. Lower waits less.</div>
        </div>
        <div className="sarvam-slider-wrap">
          <span className="sarvam-slider-label">{String(settings.eagerness || 'balanced').charAt(0).toUpperCase() + String(settings.eagerness || 'balanced').slice(1)}</span>
          <input
            type="range"
            min="1"
            max="3"
            step="1"
            className="sarvam-slider"
            aria-label="Eagerness to respond"
            value={settings.eagerness === 'patient' ? 1 : settings.eagerness === 'quick' ? 3 : 2}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              updateSetting('eagerness', val === 1 ? 'patient' : val === 2 ? 'balanced' : 'quick');
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
          <span className="sarvam-slider-label">{String(settings.volumeThreshold || 'normal').charAt(0).toUpperCase() + String(settings.volumeThreshold || 'normal').slice(1)}</span>
          <input
            type="range"
            min="1"
            max="3"
            step="1"
            className="sarvam-slider"
            aria-label="Volume threshold"
            value={settings.volumeThreshold === 'low' ? 1 : settings.volumeThreshold === 'high' ? 3 : 2}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              updateSetting('volumeThreshold', val === 1 ? 'low' : val === 2 ? 'normal' : 'high');
            }}
          />
        </div>
      </div>

      <div className="settings-section-divider" />

      {/* 3. Environment */}
      <div className="settings-group-title">Environment <RuntimeNote /></div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Background sound</div>
          <div className="setting-sub">Ambient noise behind the agent</div>
        </div>
        <div className="setting-control">
          <select
            className="sarvam-select"
            aria-label="Background sound"
            value={settings.backgroundSound}
            onChange={(e) => updateSetting('backgroundSound', e.target.value)}
          >
            <option value="none">None</option>
            <option value="office">Quiet office</option>
            <option value="callcenter">Call center</option>
            <option value="cafe">Coffee shop ambient</option>
          </select>
          <button
            type="button"
            className="btn-icon-menu"
            title="Preview an approximation of the ambient sound"
            aria-label="Preview ambient sound"
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
            aria-label="Background volume"
            value={settings.backgroundVolume}
            onChange={(e) => updateSetting('backgroundVolume', parseInt(e.target.value, 10))}
          />
        </div>
      </div>

      <div className="settings-section-divider" />

      {/* 4. Language Personalisation */}
      <div className="settings-group-title">Language personalisation <RuntimeNote /></div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Switch language during call</div>
          <div className="setting-sub">Follow along when the caller switches languages</div>
        </div>
        <ToggleSwitch checked={settings.switchLanguageDuringCall} label="Switch language during call" onChange={(v) => updateSetting('switchLanguageDuringCall', v)} />
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Languages allowed</div>
          <div className="setting-sub">Languages the agent can understand and reply in</div>
        </div>
        <div className="language-tags-container">
          {(settings.languagesAllowed || []).map(lang => (
            <span key={lang} className="language-tag">
              <span>{lang}</span>
              <button
                type="button"
                className="language-tag-remove"
                aria-label={`Remove ${lang}`}
                title={`Remove ${lang}`}
                onClick={() => updateSetting('languagesAllowed', (settings.languagesAllowed || []).filter(l => l !== lang))}
              >
                ✕
              </button>
            </span>
          ))}
          {missingLanguages.length > 0 && (
            <select
              className="sarvam-select language-add-select"
              aria-label="Add a language"
              value=""
              onChange={(e) => {
                const lang = e.target.value;
                if (lang) updateSetting('languagesAllowed', [...(settings.languagesAllowed || []), lang]);
              }}
            >
              <option value="">+ Add language</option>
              {missingLanguages.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Auto-detected language switch</div>
          <div className="setting-sub">Match the caller's language using the allowed set above.</div>
        </div>
        <ToggleSwitch checked={settings.autoLanguageSwitch} label="Auto-detected language switch" onChange={(v) => updateSetting('autoLanguageSwitch', v)} />
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
            aria-label="Switch language after"
            value={settings.switchAfter === 'quick' ? 1 : 2}
            onChange={(e) => updateSetting('switchAfter', e.target.value === '1' ? 'quick' : 'balanced')}
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
            aria-label="Starting language"
            value={settings.startingLanguage}
            onChange={(e) => updateSetting('startingLanguage', e.target.value)}
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
        <ToggleSwitch checked={settings.outputNumbersInIndic} label="Output numbers in Indic" onChange={(v) => updateSetting('outputNumbersInIndic', v)} />
      </div>

      <div className="settings-section-divider" />

      {/* 5. In Call Actions */}
      <div className="settings-group-title">In call actions</div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Nudge quiet callers <RuntimeNote /></div>
          <div className="setting-sub">Speak up if the caller goes silent for a while</div>
        </div>
        <ToggleSwitch checked={settings.nudgeQuietCallers} label="Nudge quiet callers" onChange={(v) => updateSetting('nudgeQuietCallers', v)} />
      </div>

      {settings.nudgeQuietCallers && (
        <div style={{ marginBottom: 16 }}>
          {(settings.nudges || []).map((nudge, idx) => (
            <div key={nudge.id} className="nudge-card">
              <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>Message {idx + 1}</span>
              <input
                type="text"
                className="nudge-input"
                aria-label={`Nudge message ${idx + 1}`}
                value={nudge.message}
                onChange={(e) => {
                  const val = e.target.value;
                  setSettings(s => ({
                    ...s,
                    nudges: s.nudges.map(n => n.id === nudge.id ? { ...n, message: val } : n)
                  }));
                  markDirty();
                }}
              />
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>after</span>
              <NumberField
                className="nudge-timer-input"
                min={1}
                max={120}
                fallback={5}
                value={nudge.afterSeconds}
                ariaLabel={`Seconds before nudge ${idx + 1}`}
                onCommit={(val) => {
                  setSettings(s => ({
                    ...s,
                    nudges: s.nudges.map(n => n.id === nudge.id ? { ...n, afterSeconds: val } : n)
                  }));
                  markDirty();
                }}
              />
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>seconds</span>
              {(settings.nudges || []).length > 1 && (
                <button
                  type="button"
                  className="icon-action-btn nudge-remove-btn"
                  aria-label={`Remove nudge message ${idx + 1}`}
                  title="Remove this message"
                  onClick={() => updateSetting('nudges', settings.nudges.filter(n => n.id !== nudge.id))}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              type="button"
              className="btn-secondary-pill"
              onClick={() => updateSetting('nudges', [...(settings.nudges || []), { id: `n-${Date.now()}`, message: 'Sir, kya aap sun pa rahe hain?', afterSeconds: 8 }])}
            >
              + Add More
            </button>
          </div>
        </div>
      )}

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Hang up after unanswered nudges <RuntimeNote /></div>
          <div className="setting-sub">End the call if the caller still doesn't respond</div>
        </div>
        <ToggleSwitch checked={settings.hangUpAfterNudges} label="Hang up after unanswered nudges" onChange={(v) => updateSetting('hangUpAfterNudges', v)} />
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Voicemail <RuntimeNote /></div>
          <div className="setting-sub">Leave a message when voicemail is detected</div>
        </div>
        <ToggleSwitch checked={settings.voicemailDetection} label="Voicemail detection" onChange={(v) => updateSetting('voicemailDetection', v)} />
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
            aria-label="Voicemail message"
            value={settings.voicemailMessage}
            onChange={(e) => updateSetting('voicemailMessage', e.target.value)}
          />
        </div>
      )}

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Call forwarding <RuntimeNote /></div>
          <div className="setting-sub">Transfer the caller to a human agent when the AI triggers a transfer.</div>
        </div>
        <ToggleSwitch checked={settings.callForwarding} label="Call forwarding" onChange={(v) => updateSetting('callForwarding', v)} />
      </div>

      <div className="setting-row">
        <div className="setting-info">
          <div className="setting-label">Max call length</div>
          <div className="setting-sub">Ends a live phone call after this many minutes (1–60) with the polite exit statement. Browser tests are not cut off.</div>
        </div>
        <NumberField
          className="nudge-timer-input"
          min={1}
          max={60}
          fallback={15}
          value={settings.maxCallLength}
          ariaLabel="Max call length in minutes"
          onCommit={(val) => updateSetting('maxCallLength', val)}
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
          aria-label="Call cut and disconnect strategy"
          value={settings.callCutRule || 'reframe_once_then_exit'}
          onChange={(e) => updateSetting('callCutRule', e.target.value)}
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
          <div className="setting-sub">Spoken closing phrase before disconnecting upon rejection. Left empty, the default line is used.</div>
        </div>
        <input
          type="text"
          className="sarvam-input"
          style={{ width: '280px' }}
          aria-label="Polite exit statement"
          value={settings.disconnectPhrase ?? ''}
          placeholder={DEFAULT_DISCONNECT_PHRASE}
          onChange={(e) => updateSetting('disconnectPhrase', e.target.value)}
        />
      </div>
    </div>
  );

  // ────────────────────────────────────────────────────────────────────────
  // TAB 5: AUTOMATED TESTS (not available yet — no fabricated results)
  // ────────────────────────────────────────────────────────────────────────
  const renderTestsTab = () => (
    <div className="sarvam-panel-content">
      <div className="subtab-header-row">
        <div>
          <h3 style={{ margin: 0, fontSize: '0.98rem' }}>Automated Call Scenarios</h3>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#64748b' }}>
            Scripted test scenarios aren't available yet.
          </p>
        </div>
      </div>
      <div className="tools-empty-state">
        <div className="tools-empty-illustration">
          <CheckCircle2 size={28} />
        </div>
        <div className="tools-empty-title">Coming soon</div>
        <p className="tools-empty-desc">
          Until automated scenarios ship, talk to your agent in the browser with “{testButtonLabel}”, or place a real test call to your own phone from Sage.
        </p>
        <div className="tools-empty-actions">
          <button type="button" className="btn-add-pill" onClick={handleOpenTesting} disabled={saving}>
            <Phone size={14} />
            <span>{testButtonLabel}</span>
          </button>
          <button type="button" className="btn-secondary-pill" onClick={openColdCallModal}>
            Call my phone
          </button>
        </div>
      </div>
    </div>
  );

  // ────────────────────────────────────────────────────────────────────────
  // RIGHT SIDEBAR: "SAGE · AI AGENT ARCHITECT"
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
          aria-hidden="true"
        />

        <aside className="agent-editor-right sage-drawer-mode" aria-label="Sage AI agent architect">
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
                aria-label="Conversation history"
                aria-expanded={showHistoryPanel}
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
                aria-label="Close Sage"
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
                    aria-label="Close history"
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
                        role="button"
                        tabIndex={0}
                        aria-current={isActive ? 'true' : undefined}
                        onClick={() => handleSelectSession(sess.id)}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleSelectSession(sess.id);
                          }
                        }}
                      >
                        <div className="history-item-left">
                          <span className="history-item-title">{sess.title || 'Untitled Session'}</span>
                          <span className="history-item-meta">
                            {sess.createdAt ? `${sess.createdAt} · ` : ''}{msgCount} {msgCount === 1 ? 'msg' : 'msgs'}
                          </span>
                        </div>
                        <div className="history-item-actions">
                          {isActive && <span className="history-active-pill">Active</span>}
                          <button
                            type="button"
                            className="btn-delete-session"
                            title="Delete session"
                            aria-label={`Delete session ${sess.title || ''}`.trim()}
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
          <div className="sage-chat-feed" aria-live="polite">
            {sageMessages.length === 0 ? (
              <div className="sage-welcome-container">
                <div className="sage-welcome-hero">
                  <div className="sage-hero-emblem-wrap">
                    <svg className="sage-hero-emblem" width="46" height="46" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
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

                if (msg.is_error) {
                  return (
                    <div key={msg.id} className="assistant-cluster" role="alert">
                      <div className="assistant-bubble-text sage-error-text">
                        <AlertCircle size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                        {msg.text}
                      </div>
                      {msg.retry_query && (
                        <button
                          type="button"
                          className="btn-sage-retry"
                          onClick={() => retrySage(msg)}
                          disabled={isSageThinking}
                        >
                          <RefreshCw size={12} />
                          <span>Retry</span>
                        </button>
                      )}
                    </div>
                  );
                }

                const isStepsExpanded = Boolean(expandedSteps[msg.id]);
                const canUndo = lastPatch?.msgId === msg.id && !msg.is_undone;

                return (
                  <div key={msg.id} className="assistant-cluster">
                    {msg.text && <div className="assistant-bubble-text">{msg.text}</div>}

                    {msg.steps && (
                      <button
                        type="button"
                        className="assistant-thought-link"
                        aria-expanded={isStepsExpanded}
                        onClick={() => setExpandedSteps(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                        title="Show or hide Sage's reasoning steps"
                      >
                        <span>{msg.steps}</span>
                        {isStepsExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    )}

                    {isStepsExpanded && msg.steps_detail.length > 0 && (
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

                    {msg.follow_up_questions.length > 0 && (
                      <div className="sage-questions-container">
                        <div className="sage-questions-label">Architect Follow-up:</div>
                        {msg.follow_up_questions.map((q, idx) => (
                          <button
                            key={idx}
                            type="button"
                            className="sage-question-chip"
                            onClick={() => handleSageSubmit(null, q)}
                            title="Click to ask Sage this question"
                            disabled={isSageThinking}
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
                          {msg.action_card.options.map((opt, i) => {
                            const isDial = classifySageAction(opt) === 'dial';
                            return (
                              <button
                                key={i}
                                type="button"
                                className="action-option-item"
                                onClick={() => handleSageAction(opt)}
                                disabled={!isDial && isSageThinking}
                                title={isDial ? 'Opens the dialer — you enter the number and confirm before any call is placed' : 'Ask Sage to do this'}
                              >
                                <span className="action-number-badge">{i + 1}</span>
                                <span>{opt}</span>
                                {isDial && (
                                  <span className="action-option-hint">
                                    <PhoneCall size={11} />
                                    Opens dialer
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Applied Changes Card & Undo (latest change only) */}
                    {msg.patch && (
                      <div className="sage-proposed-changes-card">
                        <div className="proposed-changes-header">
                          <div className="proposed-title-wrap">
                            <Sparkles size={13} color="#ea580c" />
                            <span>Proposed Changes</span>
                          </div>
                          <span className="proposed-badge">{msg.is_undone ? 'Reverted' : 'Applied'}</span>
                        </div>

                        {msg.patch_diff.length > 0 && (
                          <div className="proposed-diff-list">
                            {msg.patch_diff.map((item, dIdx) => (
                              <div key={dIdx} className="proposed-diff-item">
                                <span className="diff-field-name">{item.field}:</span>
                                <span className="diff-field-val">{item.summary}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="proposed-actions-bar">
                          {msg.is_undone ? (
                            <div className="proposed-undone-badge">
                              <Check size={12} color="#16a34a" />
                              <span>Changes Reverted</span>
                            </div>
                          ) : canUndo ? (
                            <button
                              type="button"
                              className="btn-undo-patch"
                              onClick={() => handleUndoPatch(msg.id)}
                              title="Revert only the fields this change touched"
                            >
                              <RotateCcw size={12} />
                              <span>Undo Changes</span>
                            </button>
                          ) : (
                            <span className="proposed-undo-hint">Undo is available for the latest change only.</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* Loading indicator (no simulated step progress) */}
            {isSageThinking && (
              <div className="assistant-cluster" role="status">
                <div className="sage-thinking-cluster">
                  <div className="sage-thinking-header">
                    <Loader2 size={14} className="animate-spin text-slate-700" />
                    <span className="sage-thinking-title">Sage is working on your request…</span>
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
                placeholder="Ask Sage to build or edit this agent..."
                aria-label="Message Sage"
                value={sageInput}
                onChange={(e) => setSageInput(e.target.value)}
                disabled={isSageThinking}
              />
              <button
                type="submit"
                className="btn-send-circle"
                title="Send message"
                aria-label="Send message"
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
                setFeedbackError(null);
                setShowFeedbackModal(true);
              }}
              title="Send suggestions or report an issue with Sage"
            >
              Report an issue
            </a>
            <span>Powered by Qwen · Groq</span>
          </div>
        </aside>
      </>
    );
  };

  // ────────────────────────────────────────────────────────────────────────
  // LOAD STATES (never an editable default form for an agent that didn't load)
  // ────────────────────────────────────────────────────────────────────────
  if (loadState === 'loading') {
    return (
      <div className="agent-editor-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
        <div style={{ textAlign: 'center' }} role="status">
          <Loader2 size={32} className="animate-spin" color="#0f172a" style={{ margin: '0 auto 12px' }} />
          <p style={{ color: '#64748b', fontSize: '0.9rem', fontWeight: 500 }}>Loading agent configuration...</p>
        </div>
      </div>
    );
  }

  if (loadState === 'error') {
    const status = loadError?.status;
    const title = status === 404 ? 'Agent not found' : status === 401 ? 'Your session expired' : "Couldn't load this agent";
    const message = status === 404
      ? "This agent doesn't exist or belongs to another account."
      : (loadError?.message || "Couldn't load this agent.");
    return (
      <div className="agent-editor-container agent-editor-state-screen">
        <div className="agent-editor-state-card" role="alert">
          <div className="state-card-icon">
            <AlertCircle size={22} />
          </div>
          <h2>{title}</h2>
          <p>{message}</p>
          <div className="state-card-actions">
            {status === 401 ? (
              <button type="button" className="btn-pill-test" onClick={() => navigate('/auth')}>
                <span>Sign in again</span>
              </button>
            ) : status !== 404 && (
              <button type="button" className="btn-pill-test" onClick={retryLoad}>
                <RefreshCw size={13} />
                <span>Retry</span>
              </button>
            )}
            {onBack && (
              <button type="button" className="btn-pill-save" onClick={onBack}>
                <ArrowLeft size={13} />
                <span>Back to Agents</span>
              </button>
            )}
          </div>
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
            <button type="button" className="icon-back-btn" onClick={guardedBack} title="Back to Agents" aria-label="Back to Agents">
              <ArrowLeft size={16} />
            </button>
          )}
          <div className="agent-title-cluster">
            <div className="agent-avatar-badge" aria-hidden="true">
              <Bot size={18} />
            </div>
            <input
              type="text"
              value={agentName}
              onChange={(e) => { setAgentName(e.target.value); markDirty(); }}
              className="agent-name-input"
              placeholder="Agent Name"
              aria-label="Agent name"
            />
            <div className="version-dropdown-pill is-static" title={currentId ? 'Saved version and status' : 'This agent has not been saved yet'}>
              <span>/ {versionLabel}</span>
            </div>
            {isDirty && (
              <span style={{ fontSize: '0.72rem', color: '#f59e0b', fontWeight: 600 }}>• Unsaved</span>
            )}
            {saveSuccess && (
              <span role="status" style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
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
            title={!currentId || isDirty ? 'Saves your changes, then opens the browser test panel' : 'Open browser voice testing sandbox'}
          >
            <Phone size={13} />
            <span>{testButtonLabel}</span>
          </button>

          <button
            type="button"
            className="btn-icon-menu"
            title="Blueprint library"
            aria-label="Open blueprint library"
            onClick={() => setShowArchetypeModal(true)}
          >
            <MoreVertical size={15} />
          </button>

          <button
            type="button"
            className={`btn-sage-header-toggle ${isSageOpen ? 'active' : ''}`}
            onClick={toggleSage}
            aria-pressed={isSageOpen}
            title="Toggle Sage · AI Agent Architect Drawer"
          >
            <Sparkles size={13} />
            <span>Sage AI</span>
          </button>
        </div>
      </header>

      {saveNotice && (
        <div className={`agent-editor-alert ${saveNotice.tone === 'warning' ? 'warning' : ''}`} role="alert">
          <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span className="alert-text">{saveNotice.message}</span>
          <button type="button" className="alert-dismiss" aria-label="Dismiss" onClick={() => setSaveNotice(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────
          BODY: LEFT TABS, CENTER CONTENT, RIGHT SAGE
          ────────────────────────────────────────────────────────────────── */}
      <div className="agent-editor-body">
        {/* Left Sidebar */}
        <div className="agent-editor-left">
          <nav className="agent-tabs" aria-label="Agent editor sections">
            <button
              type="button"
              className={`agent-tab ${activeTab === 'instructions' ? 'active' : ''}`}
              aria-current={activeTab === 'instructions' ? 'page' : undefined}
              onClick={() => setActiveTab('instructions')}
            >
              <FileText size={16} />
              <span>Instructions</span>
            </button>

            <button
              type="button"
              className={`agent-tab ${activeTab === 'variables' ? 'active' : ''}`}
              aria-current={activeTab === 'variables' ? 'page' : undefined}
              onClick={() => setActiveTab('variables')}
            >
              <Braces size={16} />
              <span>Variables</span>
            </button>

            <button
              type="button"
              className={`agent-tab ${activeTab === 'tools' ? 'active' : ''}`}
              aria-current={activeTab === 'tools' ? 'page' : undefined}
              onClick={() => setActiveTab('tools')}
            >
              <Wrench size={16} />
              <span>Tools</span>
            </button>

            <button
              type="button"
              className={`agent-tab ${activeTab === 'settings' ? 'active' : ''}`}
              aria-current={activeTab === 'settings' ? 'page' : undefined}
              onClick={() => setActiveTab('settings')}
            >
              <SettingsIcon size={16} />
              <span>Settings</span>
            </button>

            <button
              type="button"
              className={`agent-tab ${activeTab === 'tests' ? 'active' : ''}`}
              aria-current={activeTab === 'tests' ? 'page' : undefined}
              onClick={() => setActiveTab('tests')}
            >
              <CheckCircle2 size={16} />
              <span>Automated tests</span>
              <span className="agent-tab-soon">Soon</span>
            </button>
          </nav>
        </div>

        {/* Center Panel */}
        <div className="agent-editor-center">
          <ErrorBoundary title="Agent Editor Section Error">
            {activeTab === 'instructions' && renderInstructionsTab()}
            {activeTab === 'variables' && renderVariablesTab()}
            {activeTab === 'tools' && renderToolsTab()}
            {activeTab === 'settings' && renderSettingsTab()}
            {activeTab === 'tests' && renderTestsTab()}
          </ErrorBoundary>

          {/* Floating Center Bottom Button: Review Agent */}
          <div className="floating-review-btn-wrap">
            <button
              type="button"
              className="btn-floating-review"
              onClick={() => { setReviewError(null); setShowReviewModal(true); }}
            >
              <Sparkles size={14} />
              <span>Review agent</span>
            </button>
          </div>
        </div>

        {/* Right Sidebar: Sage · AI Agent Architect */}
        {isSageOpen && (
          <ErrorBoundary
            key={sageBoundaryKey}
            fallback={(
              <SageCrashFallback
                onRetry={() => setSageBoundaryKey(k => k + 1)}
                onClear={() => { clearAllSageHistory(); setSageBoundaryKey(k => k + 1); }}
                onClose={() => { setIsSageOpen(false); setSageBoundaryKey(k => k + 1); }}
              />
            )}
          >
            {renderSagePanel()}
          </ErrorBoundary>
        )}
      </div>

      {/* ──────────────────────────────────────────────────────────────────
          MODALS & DRAWERS
          ────────────────────────────────────────────────────────────────── */}
      {/* Testing Sandbox Drawer */}
      {showTestingPanel && (
        <AgentTestingPanel
          agent={testingAgentSnapshot}
          agentId={currentId}
          agentName={agentName}
          onClose={() => setShowTestingPanel(false)}
          onSaveAndTest={async () => {
            const result = await saveAgent();
            return result.ok ? result.id : null;
          }}
          // This page is outside the Dashboard: go there (unsaved edits are confirmed first).
          onOpenWallet={openWalletTab}
        />
      )}

      {/* Archetype Library Modal (closes only when the blueprint was applied) */}
      <ArchetypeLibraryModal
        isOpen={showArchetypeModal}
        onClose={() => setShowArchetypeModal(false)}
        onApplyArchetype={(arch) => applyArchetype(arch)}
        currentArchetypeId={activeArchetypeId}
      />

      {/* Review Agent Readiness Modal */}
      {showReviewModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} {...reviewBackdrop}>
          <div
            ref={reviewDialog.ref}
            {...reviewDialog.dialogProps}
            aria-labelledby="agent-review-title"
            style={{ background: '#ffffff', borderRadius: 14, width: '460px', maxWidth: '100%', padding: 24, boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', outline: 'none' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={18} color="#0f172a" />
                <h3 id="agent-review-title" style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Agent readiness check</h3>
              </div>
              <button type="button" className="btn-top-icon" aria-label="Close" onClick={() => setShowReviewModal(false)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
              {readinessChecks.map(check => (
                <div key={check.id} className="readiness-item">
                  {check.ok
                    ? <CheckCircle2 size={16} color="#16a34a" style={{ flexShrink: 0, marginTop: 1 }} aria-label="Ready" />
                    : <AlertCircle size={16} color="#d97706" style={{ flexShrink: 0, marginTop: 1 }} aria-label="Needs attention" />}
                  <span>
                    <strong>{check.label}</strong>
                    <span className="readiness-detail">{check.detail}</span>
                  </span>
                </div>
              ))}
            </div>

            <p style={{ margin: '0 0 16px', fontSize: '0.78rem', color: '#64748b' }}>
              {pendingChecks === 0
                ? 'Everything above looks ready.'
                : `${pendingChecks} item${pendingChecks === 1 ? ' needs' : 's need'} attention. You can still save.`}
              {isDirty ? ' Your unsaved changes will be saved.' : ''}
            </p>

            {reviewError && (
              <div className="cold-call-alert-error" role="alert" style={{ marginTop: 0, marginBottom: 12 }}>
                <AlertCircle size={15} />
                <span>{reviewError}</span>
              </div>
            )}

            <button
              type="button"
              className="btn-add-pill"
              style={{ width: '100%', justifyContent: 'center', padding: '10px 0' }}
              onClick={handleReviewSave}
              disabled={saving}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              <span>{saving ? 'Saving...' : 'Save agent'}</span>
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

      {/* Tool Drawer: onSaveTool / onDeleteTool resolve { ok, error } */}
      <ToolDrawer
        isOpen={isToolDrawerOpen}
        onClose={handleCloseDrawer}
        tool={selectedDrawerTool}
        agentId={currentId}
        onSaveTool={handleSaveTool}
        onDeleteTool={handleDeleteTool}
        testVariables={testVariables}
      />


      {/* Direct Cold Call Phone Dialer Modal */}
      {showColdCallModal && (
        <div className="cold-call-modal-overlay" {...coldCallBackdrop}>
          <div
            className="cold-call-modal-card"
            ref={coldCallDialog.ref}
            {...coldCallDialog.dialogProps}
            aria-labelledby="cold-call-title"
          >
            <div className="cold-call-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="cold-call-icon-badge" aria-hidden="true">
                  <PhoneCall size={18} />
                </div>
                <div>
                  <h3 id="cold-call-title" style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: '#0f172a' }}>Place Live Cold Call</h3>
                  <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                    Call your own phone with this agent to hear it live.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="btn-top-icon"
                aria-label={isColdCallActive ? 'Hang up and close' : 'Close'}
                title={isColdCallActive ? 'Hang up and close' : 'Close'}
                onClick={closeColdCallModal}
              >
                <X size={16} />
              </button>
            </div>

            <div className="cold-call-modal-body">
              {!isColdCallActive ? (
                <>
                  <div className="cold-call-form-group">
                    <label htmlFor="cold-call-phone">Recipient Phone Number (India)</label>
                    <div className="phone-input-wrap">
                      <span className="phone-prefix-tag" aria-hidden="true">+91</span>
                      <input
                        id="cold-call-phone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="98765 43210 or +91 98765 43210"
                        value={coldCallPhone}
                        onChange={(e) => { setColdCallPhone(e.target.value); setColdCallError(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && coldPhone.valid) handleTriggerColdCall(); }}
                        className="cold-call-input"
                        data-autofocus
                        aria-describedby="cold-call-phone-hint"
                      />
                    </div>
                    {coldCallPhone.trim() && (
                      <span className={`cold-call-dial-preview ${coldPhone.valid ? '' : 'invalid'}`} aria-live="polite">
                        {coldPhone.valid ? `Will dial ${formatIndianPhone(coldPhone.e164)}` : coldPhone.error}
                      </span>
                    )}
                    <span className="phone-hint" id="cold-call-phone-hint">
                      Enter your own number to hear the agent's live voice, barge-in and call-cut behaviour. Calls are billed per minute from your wallet.
                    </span>
                  </div>

                  <div className="cold-call-form-group" style={{ marginTop: 12 }}>
                    <label htmlFor="cold-call-recipient">Prospect Name</label>
                    <input
                      id="cold-call-recipient"
                      type="text"
                      placeholder="Prospect name (e.g. Manan, Rahul Sharma)"
                      value={coldCallRecipient}
                      onChange={(e) => setColdCallRecipient(e.target.value)}
                      className="cold-call-input"
                    />
                  </div>

                  {coldCallError && (
                    <div className="cold-call-alert-error" role="alert">
                      <AlertCircle size={15} />
                      <span>{coldCallError}</span>
                      {coldCallNeedsTopUp && (
                        <button type="button" className="link-btn" onClick={openWalletTab}>Top up wallet</button>
                      )}
                    </div>
                  )}

                  {coldCallStatus === 'completed' && (
                    <div className="cold-call-alert-success" role="status">
                      <CheckCircle2 size={15} />
                      <span>
                        The last call ended{coldCallInfo?.duration ? ` after ${formatDuration(coldCallInfo.duration)}` : ''}. You can place another test call below.
                      </span>
                    </div>
                  )}

                  {coldCallStatus === 'cancelled' && !coldCallError && (
                    <div className="cold-call-alert-warning" role="status">
                      <AlertCircle size={15} />
                      <span>The last call was cancelled.</span>
                    </div>
                  )}

                  {coldCallStatus === 'simulated' && (
                    <div className="cold-call-alert-warning" role="status">
                      <AlertCircle size={15} />
                      <span>{coldCallInfo?.message || SIMULATED_CALL_MESSAGE}</span>
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
                      disabled={!coldPhone.valid}
                    >
                      <PhoneCall size={14} />
                      <span>Place Call to My Phone</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="cold-call-active-state" role="status" aria-live="polite">
                  <div className="calling-radar-wrap" aria-hidden="true">
                    <div className="calling-radar-ring" />
                    <div className="calling-radar-ring delay-1" />
                    <div className="calling-radar-center">
                      <PhoneCall size={22} className="animate-pulse" />
                    </div>
                  </div>

                  <div className="calling-status-title">
                    {COLD_CALL_TITLES[coldCallStatus]}
                  </div>

                  <div className="calling-phone-pill">
                    <span>{formatIndianPhone(coldCallInfo?.number || '')}</span>
                    <span className="calling-timer-tag">{formatDuration(coldCallElapsed)}</span>
                  </div>

                  <div className="calling-meta-box">
                    <div className="calling-meta-row">
                      <span className="meta-label">Active Agent:</span>
                      <span className="meta-val">{agentName}</span>
                    </div>
                    <div className="calling-meta-row">
                      <span className="meta-label">Status:</span>
                      <span className="meta-val">{coldCallLabel || '—'}</span>
                    </div>
                    <div className="calling-meta-row">
                      <span className="meta-label">Carrier:</span>
                      <span className="meta-val">{coldCallInfo?.provider ? coldCallInfo.provider.charAt(0).toUpperCase() + coldCallInfo.provider.slice(1) : '—'}</span>
                    </div>
                    <div className="calling-meta-row">
                      <span className="meta-label">Call ID:</span>
                      <span className="meta-val font-mono">{coldCallId ? coldCallId.slice(0, 16) : 'Not placed yet'}</span>
                    </div>
                  </div>

                  {coldCallPollNote && (
                    <div className="cold-call-alert-warning">
                      <AlertCircle size={15} />
                      <span>{coldCallPollNote}</span>
                    </div>
                  )}
                  {coldCallError && (
                    <div className="cold-call-alert-error" role="alert">
                      <AlertCircle size={15} />
                      <span>{coldCallError}</span>
                    </div>
                  )}

                  <div className="cold-call-modal-footer" style={{ justifyContent: 'center' }}>
                    <button
                      type="button"
                      className="btn-cancel-call"
                      onClick={handleCancelColdCall}
                    >
                      <X size={14} />
                      <span>{coldCallId ? 'Hang Up / End Call' : 'Cancel'}</span>
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
        <div className="sage-feedback-overlay" {...feedbackBackdrop}>
          <div
            className="sage-feedback-card"
            ref={feedbackDialog.ref}
            {...feedbackDialog.dialogProps}
            aria-labelledby="sage-feedback-title"
          >
            <div className="feedback-card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={16} color="#0f172a" />
                <h3 id="sage-feedback-title" style={{ margin: 0, fontSize: '0.96rem', fontWeight: 700, color: '#0f172a' }}>
                  Report an issue or suggestion
                </h3>
              </div>
              <button
                type="button"
                className="btn-top-icon"
                aria-label="Close"
                onClick={() => setShowFeedbackModal(false)}
              >
                <X size={15} />
              </button>
            </div>
            <div className="feedback-card-body">
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: 6, display: 'block' }}>
                Feedback Category
              </span>
              <div className="feedback-category-pills" role="group" aria-label="Feedback category">
                {['Prompt Tuning', 'Objection & Call Cut', 'Voice Quality', 'Telephony / Dialer', 'General'].map(cat => (
                  <button
                    key={cat}
                    type="button"
                    className={`category-pill ${feedbackCategory === cat ? 'active' : ''}`}
                    aria-pressed={feedbackCategory === cat}
                    onClick={() => setFeedbackCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <label htmlFor="sage-feedback-text" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginTop: 12, marginBottom: 6, display: 'block' }}>
                Issue Details / Suggestions
              </label>
              <textarea
                id="sage-feedback-text"
                rows={4}
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Describe what occurred, unexpected agent output, or feature enhancement..."
                className="feedback-textarea"
                data-autofocus
              />
              {feedbackError && (
                <div className="cold-call-alert-error" role="alert">
                  <AlertCircle size={15} />
                  <span>{feedbackError}</span>
                </div>
              )}
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
                disabled={feedbackSending || !feedbackText.trim()}
                onClick={handleSubmitFeedback}
              >
                {feedbackSending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                <span>{feedbackSending ? 'Sending…' : 'Submit Feedback'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Voice Languages Modal (from the voice catalogue) */}
      {showTranslationsModal && (
        <div className="sage-feedback-overlay" {...translationsBackdrop}>
          <div
            className="sage-translations-card"
            ref={translationsDialog.ref}
            {...translationsDialog.dialogProps}
            aria-labelledby="voice-languages-title"
          >
            <div className="feedback-card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Globe size={16} color="#0f172a" />
                <h3 id="voice-languages-title" style={{ margin: 0, fontSize: '0.96rem', fontWeight: 700, color: '#0f172a' }}>
                  Voice languages
                </h3>
              </div>
              <button
                type="button"
                className="btn-top-icon"
                aria-label="Close"
                onClick={() => setShowTranslationsModal(false)}
              >
                <X size={15} />
              </button>
            </div>
            <div className="translations-card-body">
              <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 12px', lineHeight: 1.5 }}>
                The fixed greeting is spoken exactly as you write it — it isn't translated automatically, so write it in the language your callers expect.
                Set the agent's language under Settings → Voice. Voices are available in these languages:
              </p>
              <div className="indic-lang-grid">
                {VOICE_LANGUAGES.map(lang => (
                  <div key={lang.language} className="indic-lang-item">
                    <span style={{ fontWeight: 600, fontSize: '0.8rem', color: '#0f172a' }}>{lang.language}</span>
                    <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
                      {lang.count} voice{lang.count === 1 ? '' : 's'}
                    </span>
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

      {/* Toast */}
      {toast && (
        <div
          role={toast.tone === 'error' ? 'alert' : 'status'}
          aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
          style={{ position: 'fixed', bottom: 24, right: 24, maxWidth: 'min(440px, calc(100vw - 48px))', background: '#0f172a', color: '#ffffff', padding: '10px 14px 10px 18px', borderRadius: 8, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 8, zIndex: 10050 }}
        >
          {toast.tone === 'error'
            ? <AlertCircle size={16} color="#f87171" style={{ flexShrink: 0 }} />
            : <CheckCircle2 size={16} color={toast.tone === 'info' ? '#93c5fd' : '#10b981'} style={{ flexShrink: 0 }} />}
          <span>{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="toast-action-btn"
              onClick={() => { toast.action.onClick(); dismissToast(); }}
            >
              {toast.action.label}
            </button>
          )}
          <button type="button" className="toast-dismiss-btn" aria-label="Dismiss notification" onClick={dismissToast}>
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
};

export default AgentEditor;
