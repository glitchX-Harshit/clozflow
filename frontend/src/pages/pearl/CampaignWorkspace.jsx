import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Play, Pause, RefreshCw, Plus, ArrowLeft, ArrowRight,
  CheckCircle2, AlertTriangle, AlertCircle, Upload, Search, Check, X,
  FileSpreadsheet, Eye, Trash2, Loader2, Sparkles, Megaphone, FileText,
  Info, ChevronLeft, ChevronRight, Clock
} from 'lucide-react';
import { apiFetch, ApiError, errorMessage } from './lib/pearlApi.js';
import { useDialogA11y, useBackdropDismiss } from './lib/a11y.js';
import { formatServerDate, formatServerDateTime, formatDuration } from './lib/dates.js';
import { formatAgentRole, voiceDisplayName } from './lib/agentCard.js';
import {
  RECIPIENTS_PAGE_SIZE, MONITOR_POLL_MS,
  toCount, pickCount, campaignListMetrics, summarizeCampaigns, monitorMetrics,
  shouldPollCampaign, monitorSignature, importFeedback, formatImportFeedback,
  manualAddFeedback, truncate, pageOffsetFor, pageInfo, statusLabel, outcomeLabel,
  describeRecipientFailure, selectableAgents, recipientsPage
} from './lib/campaignMetrics.js';
import {
  CALL_PROVIDERS, CONCURRENCY_OPTIONS, TIMEZONE_OPTIONS, DEFAULT_CALL_SETTINGS,
  normalizeCallSettings, buildCallSettingsPayload, checkCallingWindow, providerName,
  attemptOptions, attemptLabel, retryIntervalOptions, retryIntervalLabel, describeRetryPolicy,
  callSettingsNote, outsideWindowNote, windowPhrase, unsupportedProvider
} from './lib/campaignSettings.js';
import {
  campaignPolicy, policySummary, dialingNotice, retrySummary, isDialerDetached,
  recipientRetryText, attemptsText, recipientFilterOptions, recipientFilterStatus
} from './lib/campaignMonitor.js';
import { useDashboardStore } from '../../store/useDashboardStore';
import './CampaignWorkspace.css';

const NEW_CAMPAIGN_OBJECTIVE = 'Qualify sales interest, discover operational pain points, and book a discovery demo.';
const EMPTY_FORM = Object.freeze({ name: '', agent_id: '', objective: 'Outbound sales qualification and demo scheduling', description: '' });
const EMPTY_MANUAL_LEAD = Object.freeze({ name: '', business_name: '', phone_number: '', email: '', website: '' });
const WIZARD_STEPS = Object.freeze([
  { n: 1, label: 'Details & Agent' },
  { n: 2, label: 'Import & Validate' },
  { n: 3, label: 'Call Settings' },
  { n: 4, label: 'Review & Launch' }
]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const LIST_DATE_FORMAT = { day: '2-digit', month: '2-digit', year: 'numeric' };

const enc = (value) => encodeURIComponent(String(value));

/** One page of recipients; `status` (comma-separated) filters it, `counts` always covers the whole campaign. */
async function fetchRecipientsPage(campaignId, offset, status = '') {
  const filter = status ? `&status=${enc(status)}` : '';
  const data = await apiFetch(`/api/pearl/campaigns/${enc(campaignId)}/recipients?limit=${RECIPIENTS_PAGE_SIZE}&offset=${offset}${filter}`);
  return recipientsPage(data);
}

const leadHasPhone = (lead) => Boolean(String(lead?.phone_number || '').trim());

function agentSnapshotText(agent) {
  const mission = String(agent?.mission || '').trim();
  if (mission) return mission;
  const prompt = String(agent?.system_prompt || '').trim();
  return prompt ? truncate(prompt, 150) : 'No directives yet — open the agent to add a mission or instructions.';
}

const NOTICE_ICONS = { error: AlertCircle, warning: AlertTriangle, success: CheckCircle2, info: Info };

const Notice = ({ notice, onDismiss, action }) => {
  if (!notice?.text) return null;
  const tone = notice.tone || 'info';
  const Icon = NOTICE_ICONS[tone] || Info;
  return (
    <div className={`cw-notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={16} className="cw-notice-icon" aria-hidden="true" />
      <span className="cw-notice-text">{notice.text}</span>
      {action}
      {onDismiss && (
        <button type="button" className="cw-notice-close" onClick={onDismiss} aria-label="Dismiss message">
          <X size={14} />
        </button>
      )}
    </div>
  );
};

const CampaignDialog = ({ titleId, title, subtitle, onClose, maxWidth = 560, titleClassName = '', children, footer }) => {
  const { ref, dialogProps } = useDialogA11y(true, onClose);
  const backdrop = useBackdropDismiss(onClose);
  return (
    <div className="cw-modal-backdrop" {...backdrop}>
      <div className="cw-modal-box" ref={ref} {...dialogProps} aria-labelledby={titleId} style={{ maxWidth }}>
        <div className="cw-modal-header">
          <div>
            <h3 id={titleId} className={`cw-modal-title ${titleClassName}`}>{title}</h3>
            {subtitle && <p className="cw-modal-sub">{subtitle}</p>}
          </div>
          <button type="button" className="cw-modal-close-btn" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>
        <div className="cw-modal-body">{children}</div>
        {footer && <div className="cw-modal-footer">{footer}</div>}
      </div>
    </div>
  );
};

const Pager = ({ offset, shown, total, onPage, disabled }) => {
  const info = pageInfo(offset, shown, total);
  if (info.total === 0) return null;
  const paged = info.hasPrev || info.hasNext;
  return (
    <div className="cw-pager">
      <span className="cw-pager-label" aria-live="polite">{info.label}</span>
      {paged && (
        <div className="cw-pager-btns">
          <button
            type="button"
            className="cw-icon-btn"
            onClick={() => onPage(Math.max(0, offset - RECIPIENTS_PAGE_SIZE))}
            disabled={disabled || !info.hasPrev}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="cw-icon-btn"
            onClick={() => onPage(offset + RECIPIENTS_PAGE_SIZE)}
            disabled={disabled || !info.hasNext}
            aria-label="Next page"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
};

export const CampaignWorkspace = ({ onNavigateSection }) => {
  // Views: 'list' | 'wizard' | 'monitor'
  const [view, setView] = useState('list');
  const [campaigns, setCampaigns] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // The campaign being edited / monitored (row from the API) and its id.
  const [activeCampaignId, setActiveCampaignId] = useState(null);
  const [activeCampaign, setActiveCampaign] = useState(null);
  const activeIdRef = useRef(null);

  // Wizard state (Steps 1 to 4)
  const [wizardMode, setWizardMode] = useState('create'); // 'create' | 'edit'
  const [wizardStep, setWizardStep] = useState(1);
  const [availableAgents, setAvailableAgents] = useState([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState(null);
  const [campaignForm, setCampaignForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Step 2: Recipients state
  const [sourceTab, setSourceTab] = useState('finder'); // 'finder' | 'upload' | 'manual'
  const [savedLeads, setSavedLeads] = useState([]);
  const [selectedLeadIds, setSelectedLeadIds] = useState(() => new Set());
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [leadsError, setLeadsError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [recipients, setRecipients] = useState([]);
  const [recipientsOffset, setRecipientsOffset] = useState(0);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [recipientsError, setRecipientsError] = useState(null);
  const [counts, setCounts] = useState({ total: 0, eligible: 0 }); // server counts, never page counts
  const [busyRecipientId, setBusyRecipientId] = useState(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState(null); // { tone, text }
  const [manualLead, setManualLead] = useState(EMPTY_MANUAL_LEAD);
  const [addingManual, setAddingManual] = useState(false);

  // Step 3: Call settings (what the dialer enforces: gateway, window, time zone, attempts, concurrency)
  const [callSettings, setCallSettings] = useState(() => ({ ...DEFAULT_CALL_SETTINGS }));

  // Step 4 / Launch state
  const [launching, setLaunching] = useState(false);
  const [callRate, setCallRate] = useState(null);
  const [, setClockTick] = useState(0);

  // Monitor state
  const [monitorData, setMonitorData] = useState(null);
  const [monitorRecipients, setMonitorRecipients] = useState([]);
  const [monitorTotal, setMonitorTotal] = useState(0);
  const [monitorOffset, setMonitorOffset] = useState(0);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [monitorError, setMonitorError] = useState(null);
  const [monitorAction, setMonitorAction] = useState(null); // 'pause' | 'resume'
  const [pollGeneration, setPollGeneration] = useState(0);
  const [monitorFilter, setMonitorFilter] = useState('all'); // RECIPIENT_FILTERS id (GET /recipients?status=)
  const [monitorCounts, setMonitorCounts] = useState(null); // campaign-wide counts per recipient status
  const [monitorRetrying, setMonitorRetrying] = useState(0);
  const [dialerDetached, setDialerDetached] = useState(false); // running, but no dialer on the server
  const monitorSigRef = useRef('');
  const monitorOffsetRef = useRef(0);
  const monitorFilterRef = useRef('all');
  const monitorRequestRef = useRef(0); // the latest recipients request wins
  const dialerStartedAtRef = useRef({ id: null, at: 0 }); // the campaign this page last launched / resumed, and when
  const [selectedTranscript, setSelectedTranscript] = useState(null);
  const [selectedError, setSelectedError] = useState(null);

  const selectedAgent = availableAgents.find(a => String(a.id) === String(campaignForm.agent_id));
  const callableLeads = savedLeads.filter(leadHasPhone);
  const allCallableSelected = callableLeads.length > 0 && callableLeads.every(l => selectedLeadIds.has(l.id));
  const notCallable = Math.max(0, counts.total - counts.eligible);

  const selectCampaign = (id, row) => {
    activeIdRef.current = id;
    setActiveCampaignId(id);
    setActiveCampaign(row);
  };

  const showError = useCallback((err, fallback) => {
    setNotice({ tone: 'error', text: errorMessage(err, fallback) });
  }, []);

  // 1. Campaigns list
  const fetchCampaigns = useCallback(async () => {
    try {
      const data = await apiFetch('/api/pearl/campaigns');
      setCampaigns(Array.isArray(data) ? data : []);
      setListError(null);
    } catch (err) {
      setListError(errorMessage(err, 'Could not load your campaigns.'));
    } finally {
      setListLoading(false);
    }
  }, []);

  // 2. Saved agents (the implicit console / draft-dialer agents are not offered)
  const fetchAgents = useCallback(async () => {
    try {
      const data = await apiFetch('/api/pearl/agents');
      setAvailableAgents(selectableAgents(data));
      setAgentsError(null);
    } catch (err) {
      setAgentsError(errorMessage(err, 'Could not load your agents.'));
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  // 3. Saved leads from Lead Finder
  const loadSavedLeads = useCallback(async () => {
    try {
      const data = await apiFetch('/leads/saved');
      const list = Array.isArray(data)
        ? data
        : (Array.isArray(data?.leads) ? data.leads : (Array.isArray(data?.items) ? data.items : []));
      setSavedLeads(list);
      setLeadsError(null);
    } catch (err) {
      setLeadsError(errorMessage(err, 'Could not load your saved leads.'));
    } finally {
      setLoadingLeads(false);
    }
  }, []);

  // 4. One page of recipients for the wizard review table (callers set recipientsLoading first)
  const loadRecipients = useCallback(async (campaignId, offset = 0) => {
    try {
      let at = offset;
      let page = await fetchRecipientsPage(campaignId, at);
      if (page.list.length === 0 && at > 0 && page.total > 0) {
        // The page emptied (rows were removed): show the last page instead.
        at = pageOffsetFor(page.total - 1);
        page = await fetchRecipientsPage(campaignId, at);
      }
      if (activeIdRef.current !== campaignId) return;
      setRecipients(page.list);
      setRecipientsOffset(at);
      // Per-status counts of the whole campaign keep the chips exact after every change.
      setCounts(prev => (page.counts ? { total: page.counts.total, eligible: page.counts.valid } : { ...prev, total: page.total }));
      setRecipientsError(null);
    } catch (err) {
      if (activeIdRef.current === campaignId) setRecipientsError(errorMessage(err, 'Could not load the recipients.'));
    } finally {
      if (activeIdRef.current === campaignId) setRecipientsLoading(false);
    }
  }, []);

  // 5. Monitor: one page of recipients (status filter applied) + live status
  const loadMonitorRecipients = useCallback(async (campaignId, offset) => {
    const request = ++monitorRequestRef.current;
    const status = recipientFilterStatus(monitorFilterRef.current);
    let at = offset;
    let page = await fetchRecipientsPage(campaignId, at, status);
    if (page.list.length === 0 && at > 0 && page.total > 0) {
      // The page emptied (rows moved to another status): show the last page instead.
      at = pageOffsetFor(page.total - 1);
      page = await fetchRecipientsPage(campaignId, at, status);
    }
    if (activeIdRef.current !== campaignId || request !== monitorRequestRef.current) return;
    monitorOffsetRef.current = at;
    setMonitorOffset(at);
    setMonitorRecipients(page.list);
    setMonitorTotal(page.total);
    if (page.counts) setMonitorCounts(page.counts);
    setMonitorRetrying(page.retryScheduled);
  }, []);

  const pollMonitor = useCallback(async (campaignId) => {
    try {
      const status = await apiFetch(`/api/pearl/campaigns/${enc(campaignId)}/status`);
      if (activeIdRef.current !== campaignId) return { status: null, stale: true };
      setMonitorData(status);
      // Right after this page launched / resumed it, the server may not have started the dialer yet.
      const started = dialerStartedAtRef.current;
      setDialerDetached(isDialerDetached(status, { now: Date.now(), startedAt: started.id === campaignId ? started.at : 0 }));
      if (status?.status) {
        setActiveCampaign(prev => (prev && prev.id === campaignId ? { ...prev, status: status.status } : prev));
      }
      const signature = monitorSignature(status);
      if (signature !== monitorSigRef.current) {
        // Recipients only change when the counts change.
        await loadMonitorRecipients(campaignId, monitorOffsetRef.current);
        monitorSigRef.current = signature;
      }
      if (activeIdRef.current === campaignId) setMonitorError(null);
      return { status };
    } catch (err) {
      if (activeIdRef.current === campaignId) setMonitorError(errorMessage(err, 'Could not load the campaign status.'));
      const fatal = err instanceof ApiError && (err.status === 401 || err.status === 404);
      return { status: null, fatal };
    } finally {
      if (activeIdRef.current === campaignId) setMonitorLoading(false);
    }
  }, [loadMonitorRecipients]);

  useEffect(() => {
    fetchCampaigns();
    fetchAgents();
  }, [fetchCampaigns, fetchAgents]);

  // Monitor polling: stops when the campaign is finished / paused with no calls in flight,
  // skips while the tab is hidden and resumes when it becomes visible again.
  useEffect(() => {
    if (view !== 'monitor' || !activeCampaignId) return undefined;
    const campaignId = activeCampaignId;
    let cancelled = false;
    let stopped = false;
    let inFlight = false;
    let timer = null;

    const tick = async () => {
      timer = null;
      if (cancelled || stopped || inFlight) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      inFlight = true;
      const result = await pollMonitor(campaignId);
      inFlight = false;
      if (cancelled) return;
      if (result.stale || result.fatal || (result.status && !shouldPollCampaign(result.status))) {
        stopped = true;
        return;
      }
      timer = setTimeout(tick, MONITOR_POLL_MS);
    };

    const onVisibilityChange = () => {
      if (!document.hidden && !timer && !inFlight && !stopped && !cancelled) tick();
    };

    tick();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [view, activeCampaignId, pollGeneration, pollMonitor]);

  // Keep the calling-window status on the review step current.
  useEffect(() => {
    if (view !== 'wizard' || wizardStep !== 4) return undefined;
    const t = setInterval(() => setClockTick(n => n + 1), 30000);
    return () => clearInterval(t);
  }, [view, wizardStep]);

  const resetRecipientState = () => {
    setRecipients([]);
    setRecipientsOffset(0);
    setRecipientsError(null);
    setRecipientsLoading(false);
    setCounts({ total: 0, eligible: 0 });
    setSelectedLeadIds(new Set());
    setLeadsError(null);
    setSourceTab('finder');
    setUploadFeedback(null);
    setManualLead(EMPTY_MANUAL_LEAD);
    setDragActive(false);
  };

  const handleBackToList = () => {
    selectCampaign(null, null);
    setSelectedTranscript(null);
    setSelectedError(null);
    setNotice(null);
    setView('list');
    fetchCampaigns();
  };

  // Handle Wizard Start
  const handleStartNewCampaign = () => {
    selectCampaign(null, null);
    setWizardMode('create');
    setCampaignForm({
      name: `Outbound Campaign - ${new Date().toLocaleDateString('en-GB')}`,
      agent_id: availableAgents.length > 0 ? String(availableAgents[0].id) : '',
      objective: NEW_CAMPAIGN_OBJECTIVE,
      description: ''
    });
    setCallSettings({ ...DEFAULT_CALL_SETTINGS });
    resetRecipientState();
    setNotice(null);
    setWizardStep(1);
    setView('wizard');
  };

  // Open an existing draft in the wizard (settings come from that campaign only)
  const handleEditCampaign = (c) => {
    selectCampaign(c.id, c);
    setWizardMode('edit');
    setCampaignForm({
      name: c.name || '',
      agent_id: c.agent_id ? String(c.agent_id) : '',
      objective: c.objective || '',
      description: c.description || ''
    });
    setCallSettings(normalizeCallSettings(c.call_settings));
    resetRecipientState();
    const m = campaignListMetrics(c);
    setCounts({ total: m.total, eligible: m.eligible });
    setNotice(null);
    setRecipientsLoading(true);
    setLoadingLeads(true);
    loadRecipients(c.id, 0);
    loadSavedLeads();
    setWizardStep(c.agent_id ? 2 : 1);
    setView('wizard');
  };

  // Open a campaign in the monitor: name / status / gateway come from the row right away.
  const openMonitor = (c, message, tone = 'success') => {
    selectCampaign(c.id, c);
    setMonitorData(null);
    setMonitorRecipients([]);
    setMonitorTotal(0);
    setMonitorCounts(null);
    setMonitorRetrying(0);
    setDialerDetached(false);
    setMonitorError(null);
    setMonitorLoading(true);
    monitorSigRef.current = '';
    monitorOffsetRef.current = 0;
    setMonitorOffset(0);
    monitorFilterRef.current = 'all';
    setMonitorFilter('all');
    setSelectedTranscript(null);
    setSelectedError(null);
    setNotice(message ? { tone, text: message } : null);
    setView('monitor');
    setPollGeneration(g => g + 1);
  };

  // Step 1 -> Step 2: Save campaign draft
  const handleSaveDraftStep1 = async ({ advance = true } = {}) => {
    const name = campaignForm.name.trim();
    if (!name) {
      setNotice({ tone: 'warning', text: 'Enter a campaign name first.' });
      return false;
    }
    if (!selectedAgent) {
      setNotice({ tone: 'warning', text: 'Choose the Pearl agent that will make these calls.' });
      return false;
    }

    setSaving(true);
    setNotice(null);
    try {
      const existingId = activeIdRef.current;
      const payload = {
        name,
        agent_id: String(selectedAgent.id),
        objective: campaignForm.objective,
        description: campaignForm.description
      };
      const saved = existingId
        ? await apiFetch(`/api/pearl/campaigns/${enc(existingId)}`, { method: 'PATCH', body: payload })
        : await apiFetch('/api/pearl/campaigns', { method: 'POST', body: { ...payload, call_settings: buildCallSettingsPayload(callSettings) } });
      if (!saved?.id) throw new Error('The server did not return the saved campaign.');

      selectCampaign(saved.id, saved);
      const m = campaignListMetrics(saved);
      setCounts({ total: m.total, eligible: m.eligible });
      if (existingId) {
        setRecipientsLoading(true);
        loadRecipients(saved.id, recipientsOffset);
      }
      setLoadingLeads(true);
      loadSavedLeads();
      if (advance) setWizardStep(2);
      return true;
    } catch (err) {
      showError(err, 'Could not save the campaign draft.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Step 2: Import from Lead Finder
  const handleImportFromFinder = async () => {
    const campaignId = activeIdRef.current;
    if (!campaignId) return;
    const chosen = savedLeads.filter(l => selectedLeadIds.has(l.id));
    if (chosen.length === 0) {
      setUploadFeedback({ tone: 'warning', text: 'Select at least one lead with a phone number.' });
      return;
    }
    const leads = chosen.map(l => ({
      lead_id: l.id,
      name: l.business_name || 'Prospect',
      business_name: l.business_name,
      phone_number: l.phone_number,
      website: l.website,
      email: l.email || ''
    }));

    const prevTotal = counts.total;
    setImporting(true);
    setUploadFeedback(null);
    try {
      const result = await apiFetch(`/api/pearl/campaigns/${enc(campaignId)}/import-from-finder`, {
        method: 'POST',
        body: { leads }
      });
      const fb = importFeedback(result);
      setUploadFeedback(formatImportFeedback(fb, 'lead'));
      setCounts(prev => ({ total: pickCount(fb.totalRecipients, prev.total), eligible: pickCount(fb.eligible, prev.eligible) }));
      setSelectedLeadIds(new Set());
      setRecipientsLoading(true);
      await loadRecipients(campaignId, pageOffsetFor(prevTotal));
    } catch (err) {
      setUploadFeedback({ tone: 'error', text: `Import failed: ${errorMessage(err, 'the selected leads could not be imported.')}` });
    } finally {
      setImporting(false);
    }
  };

  // Step 2: File Upload (CSV or XLSX) — from the file picker or a drop
  const uploadLeadFile = async (file) => {
    const campaignId = activeIdRef.current;
    if (!file || !campaignId || uploadingFile) return;
    if (!/\.(csv|xlsx)$/i.test(file.name || '')) {
      setUploadFeedback({ tone: 'error', text: `"${file.name}" is not supported. Upload a .csv or .xlsx file.` });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadFeedback({ tone: 'error', text: `"${file.name}" is larger than 10 MB. Split it into smaller files and upload them one by one.` });
      return;
    }

    const prevTotal = counts.total;
    setUploadingFile(true);
    setUploadFeedback(null);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const result = await apiFetch(`/api/pearl/campaigns/${enc(campaignId)}/import-leads`, {
        method: 'POST',
        body: formData
      });
      const fb = importFeedback(result);
      setUploadFeedback(formatImportFeedback(fb, 'row'));
      setCounts(prev => ({ total: pickCount(fb.totalRecipients, prev.total), eligible: pickCount(fb.eligible, prev.eligible) }));
      setRecipientsLoading(true);
      await loadRecipients(campaignId, pageOffsetFor(prevTotal));
    } catch (err) {
      setUploadFeedback({ tone: 'error', text: `Upload failed: ${errorMessage(err, 'the file could not be imported.')}` });
    } finally {
      setUploadingFile(false);
    }
  };

  const handleFileInputChange = async (e) => {
    const input = e.target;
    const file = input.files?.[0];
    try {
      await uploadLeadFile(file);
    } finally {
      // Allow picking the same (corrected) file again.
      input.value = '';
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    if (!uploadingFile) setDragActive(true);
  };

  const handleDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) uploadLeadFile(file);
  };

  // Step 2: Manual Add Lead
  const handleAddManualLead = async (e) => {
    e.preventDefault();
    const campaignId = activeIdRef.current;
    if (!campaignId) return;
    if (!manualLead.phone_number.trim()) {
      setUploadFeedback({ tone: 'warning', text: 'Enter a phone number.' });
      return;
    }

    const prevTotal = counts.total;
    const body = Object.fromEntries(Object.entries(manualLead).map(([k, v]) => [k, String(v || '').trim()]));
    setAddingManual(true);
    setUploadFeedback(null);
    try {
      const result = await apiFetch(`/api/pearl/campaigns/${enc(campaignId)}/add-manual-recipient`, {
        method: 'POST',
        body
      });
      setUploadFeedback(manualAddFeedback(result));
      setCounts(prev => ({
        total: pickCount(result?.total_campaign_recipients, prev.total),
        eligible: pickCount(result?.eligible_count, prev.eligible)
      }));
      setManualLead(EMPTY_MANUAL_LEAD);
      setRecipientsLoading(true);
      await loadRecipients(campaignId, pageOffsetFor(prevTotal));
    } catch (err) {
      setUploadFeedback({ tone: 'error', text: `Could not add the recipient: ${errorMessage(err, 'please try again.')}` });
    } finally {
      setAddingManual(false);
    }
  };

  // Toggle recipient status (valid vs excluded)
  const handleToggleRecipientStatus = async (recipient) => {
    const campaignId = activeIdRef.current;
    if (!campaignId) return;
    const newStatus = recipient.status === 'excluded' ? 'valid' : 'excluded';
    setBusyRecipientId(recipient.id);
    try {
      const result = await apiFetch(`/api/pearl/campaigns/${enc(campaignId)}/recipients/${enc(recipient.id)}`, {
        method: 'PATCH',
        body: { status: newStatus }
      });
      if (activeIdRef.current !== campaignId) return;
      setRecipients(prev => prev.map(r => (r.id === recipient.id ? (result?.recipient || { ...r, status: newStatus }) : r)));
      setCounts(prev => ({ ...prev, eligible: pickCount(result?.eligible_count, prev.eligible) }));
    } catch (err) {
      showError(err, 'Could not update this recipient.');
    } finally {
      setBusyRecipientId(null);
    }
  };

  // Delete single recipient
  const handleDeleteRecipient = async (recipient) => {
    const campaignId = activeIdRef.current;
    if (!campaignId) return;
    setBusyRecipientId(recipient.id);
    try {
      const result = await apiFetch(`/api/pearl/campaigns/${enc(campaignId)}/recipients/${enc(recipient.id)}`, {
        method: 'DELETE'
      });
      setCounts(prev => ({
        total: pickCount(result?.total_recipients, Math.max(0, prev.total - 1)),
        eligible: pickCount(result?.eligible_count, prev.eligible)
      }));
      setRecipientsLoading(true);
      await loadRecipients(campaignId, recipientsOffset);
    } catch (err) {
      showError(err, 'Could not remove this recipient.');
    } finally {
      setBusyRecipientId(null);
    }
  };

  const goToRecipientsPage = (offset) => {
    const campaignId = activeIdRef.current;
    if (!campaignId) return;
    setRecipientsLoading(true);
    loadRecipients(campaignId, offset);
  };

  const handleRetryRecipients = () => goToRecipientsPage(recipientsOffset);

  // Step 2 -> Step 3: eligible recipients are required (server count)
  const handleProceedToStep3 = () => {
    if (counts.eligible === 0) {
      setNotice({ tone: 'warning', text: 'A campaign needs at least one valid, included recipient. Import or include a valid number first.' });
      return;
    }
    setWizardStep(3);
  };

  const saveCallSettings = async () => {
    const campaignId = activeIdRef.current;
    const payload = buildCallSettingsPayload(callSettings);
    const saved = await apiFetch(`/api/pearl/campaigns/${enc(campaignId)}`, {
      method: 'PATCH',
      body: { call_settings: payload }
    });
    if (activeIdRef.current === campaignId && saved?.id) {
      setActiveCampaign(saved);
      setCallSettings(normalizeCallSettings(saved.call_settings || payload));
    }
    return saved;
  };

  const refreshServerCounts = async () => {
    const campaignId = activeIdRef.current;
    const status = await apiFetch(`/api/pearl/campaigns/${enc(campaignId)}/status`);
    const next = { total: toCount(status?.total_recipients), eligible: toCount(status?.eligible_recipients) };
    if (activeIdRef.current === campaignId) setCounts(next);
    return next;
  };

  const loadCallRate = async () => {
    if (callRate !== null) return;
    try {
      const wallet = await apiFetch('/api/wallet/balance');
      const rate = Number(wallet?.rates?.pearl_call_per_minute);
      setCallRate(Number.isFinite(rate) && rate > 0 ? rate : null);
    } catch {
      // The per-minute rate is informational; the launch confirmation simply leaves it out.
      setCallRate(null);
    }
  };

  // Step 3 -> Step 4: Save call settings, then show the server's eligible count
  const handleProceedToStep4 = async () => {
    if (!activeIdRef.current) return;
    setSaving(true);
    setNotice(null);
    try {
      await saveCallSettings();
      await refreshServerCounts();
      setWizardStep(4);
      loadCallRate();
    } catch (err) {
      showError(err, 'Could not save the call settings.');
    } finally {
      setSaving(false);
    }
  };

  const canReachStep = (n) => {
    if (n === 1) return true;
    if (!activeCampaignId) return false;
    if (n === 2) return true;
    return counts.eligible > 0;
  };

  const goToStep = async (n) => {
    if (n === wizardStep || saving || !canReachStep(n)) return;
    if (wizardStep === 1 && n > 1) {
      const ok = await handleSaveDraftStep1({ advance: false });
      if (!ok) return;
    }
    if (n === 4) {
      await handleProceedToStep4();
      return;
    }
    setWizardStep(n);
  };

  // Step 4: Explicit Launch Campaign — settings are always saved first, counts re-read.
  // The dialer enforces the calling window itself: launching outside it is allowed and the
  // first calls start when the window opens.
  const handleLaunchCampaign = async () => {
    const campaignId = activeIdRef.current;
    if (!campaignId || launching) return;

    setLaunching(true);
    setNotice(null);
    try {
      const saved = await saveCallSettings();
      const { eligible } = await refreshServerCounts();
      if (eligible === 0) {
        setNotice({ tone: 'warning', text: 'This campaign has no eligible recipients. Import or include at least one valid number first.' });
        return;
      }
      const settings = normalizeCallSettings(saved?.call_settings || callSettings);
      const gateway = providerName(settings.call_provider);
      const windowCheck = checkCallingWindow(settings);
      const rateLine = callRate
        ? `Connected calls are billed at ₹${callRate.toFixed(2)} per minute from your wallet.`
        : 'Connected calls are billed per minute from your wallet.';
      const confirmed = window.confirm(
        `Launch "${saved?.name || campaignForm.name}" now?\n\n` +
        `Real outbound calls go to ${eligible} eligible recipient${eligible === 1 ? '' : 's'} through ${gateway}, ` +
        `up to ${settings.concurrency_limit} at a time, ${windowPhrase(windowCheck)}.` +
        `${windowCheck.ok ? '' : ` It is outside the window now, so the first calls start at ${windowCheck.opensAt}.`}\n\n` +
        `${describeRetryPolicy(settings)}. ${rateLine}`
      );
      if (!confirmed) return;

      const result = await apiFetch(`/api/pearl/campaigns/${enc(campaignId)}/launch`, { method: 'POST' });
      dialerStartedAtRef.current = { id: campaignId, at: Date.now() };
      fetchCampaigns();
      openMonitor(result?.campaign?.id ? result.campaign : { ...(saved || {}), id: campaignId, status: 'running' }, result?.message || 'Campaign launched.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Launched meanwhile (another tab or device): show it running.
        fetchCampaigns();
        openMonitor({ ...(activeCampaign || {}), id: campaignId, status: 'running' }, errorMessage(err), 'info');
        return;
      }
      // 400s carry the reason (unsupported gateway, invalid window / time zone, carrier not configured …).
      setNotice({ tone: 'error', text: `Couldn't launch the campaign: ${errorMessage(err, 'please try again.')}` });
    } finally {
      setLaunching(false);
    }
  };

  // Monitor actions: Pause / Resume / Refresh
  const handlePauseCampaign = async () => {
    const campaignId = activeIdRef.current;
    if (!campaignId || monitorAction) return;
    setMonitorAction('pause');
    setNotice(null);
    try {
      await apiFetch(`/api/pearl/campaigns/${enc(campaignId)}/pause`, { method: 'POST' });
      setActiveCampaign(prev => (prev ? { ...prev, status: 'paused' } : prev));
      setMonitorData(prev => (prev ? { ...prev, status: 'paused' } : prev));
      setDialerDetached(false);
      setNotice({ tone: 'info', text: 'Campaign paused. No new calls will start; calls already in progress will finish. Scheduled retries wait for Resume.' });
      monitorSigRef.current = '';
      setPollGeneration(g => g + 1);
    } catch (err) {
      setNotice({ tone: 'error', text: `Couldn't pause the campaign: ${errorMessage(err, 'please try again.')}` });
    } finally {
      setMonitorAction(null);
    }
  };

  // Resumes a paused campaign, or re-attaches the dialer of a running one that lost it (server restart).
  const handleResumeCampaign = async () => {
    const campaignId = activeIdRef.current;
    if (!campaignId || monitorAction) return;
    setMonitorAction('resume');
    setNotice(null);
    try {
      const result = await apiFetch(`/api/pearl/campaigns/${enc(campaignId)}/resume`, { method: 'POST' });
      dialerStartedAtRef.current = { id: campaignId, at: Date.now() };
      setActiveCampaign(prev => (prev ? { ...prev, status: 'running' } : prev));
      setMonitorData(prev => (prev ? { ...prev, status: 'running', dialer_active: true } : prev));
      setDialerDetached(false);
      setNotice({
        tone: 'success',
        text: result?.reattached
          ? 'Dialer restarted — it continues with the recipients still to call. Nobody is dialed twice.'
          : 'Campaign resumed — dialing the remaining eligible recipients.'
      });
      monitorSigRef.current = '';
      setPollGeneration(g => g + 1);
    } catch (err) {
      // 400s carry the reason (unsupported gateway, invalid settings, carrier not configured …).
      setNotice({ tone: 'error', text: `Couldn't resume the campaign: ${errorMessage(err, 'please try again.')}` });
    } finally {
      setMonitorAction(null);
    }
  };

  const handleRefreshMonitor = () => {
    monitorSigRef.current = '';
    setMonitorError(null);
    setPollGeneration(g => g + 1);
  };

  const goToMonitorPage = async (offset) => {
    const campaignId = activeIdRef.current;
    if (!campaignId) return;
    const previous = monitorOffsetRef.current;
    monitorOffsetRef.current = offset;
    setMonitorOffset(offset);
    try {
      await loadMonitorRecipients(campaignId, offset);
    } catch (err) {
      monitorOffsetRef.current = previous;
      setMonitorOffset(previous);
      showError(err, 'Could not load that page of recipients.');
    }
  };

  // Recipient table filter: the server filters by status, so a long campaign is never paged through.
  const handleMonitorFilterChange = async (filterId) => {
    const campaignId = activeIdRef.current;
    if (!campaignId || filterId === monitorFilterRef.current) return;
    const previous = { filter: monitorFilterRef.current, offset: monitorOffsetRef.current };
    monitorFilterRef.current = filterId;
    setMonitorFilter(filterId);
    monitorOffsetRef.current = 0;
    setMonitorOffset(0);
    try {
      await loadMonitorRecipients(campaignId, 0);
    } catch (err) {
      monitorFilterRef.current = previous.filter;
      setMonitorFilter(previous.filter);
      monitorOffsetRef.current = previous.offset;
      setMonitorOffset(previous.offset);
      showError(err, 'Could not load these recipients.');
    }
  };

  // Open existing campaign in monitor view
  const handleOpenMonitor = (c) => openMonitor(c);

  // Delete campaign (running campaigns must be paused first)
  const handleDeleteCampaign = async (c) => {
    if (c.status === 'running' || deletingId) return;
    const m = campaignListMetrics(c);
    if (!window.confirm(`Delete "${c.name}" and its ${m.total} recipient record${m.total === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setDeletingId(c.id);
    setNotice(null);
    try {
      await apiFetch(`/api/pearl/campaigns/${enc(c.id)}`, { method: 'DELETE' });
      setNotice({ tone: 'success', text: `Campaign "${c.name}" deleted.` });
      await fetchCampaigns();
    } catch (err) {
      showError(err, 'Could not delete the campaign.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleRetryList = () => {
    setListLoading(true);
    setListError(null);
    fetchCampaigns();
  };

  const handleRetryAgents = () => {
    setAgentsLoading(true);
    setAgentsError(null);
    fetchAgents();
  };

  const handleRetryLeads = () => {
    setLoadingLeads(true);
    setLeadsError(null);
    loadSavedLeads();
  };

  const goToLeadFinder = () => {
    useDashboardStore.getState().setActiveTab('leads');
  };

  // Toggle lead selection in Lead Finder tab
  const toggleSelectAllLeads = () => {
    setSelectedLeadIds(allCallableSelected ? new Set() : new Set(callableLeads.map(l => l.id)));
  };

  const toggleLeadSelection = (id) => {
    setSelectedLeadIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ─────────────────────────────────────────────────────────────
  // 1. MONITOR VIEW
  // ─────────────────────────────────────────────────────────────
  if (view === 'monitor') {
    const mm = monitorMetrics(monitorData);
    const status = monitorData?.status || activeCampaign?.status || 'running';
    const policy = campaignPolicy(activeCampaign);
    const gateway = policy.provider;
    const hasData = Boolean(monitorData);
    const kpi = (value) => (hasData ? value : '—');
    const startedAt = formatServerDateTime(monitorData?.started_at || activeCampaign?.started_at);
    const finishedAt = formatServerDateTime(monitorData?.completed_at || activeCampaign?.completed_at);
    const detached = status === 'running' && dialerDetached;
    const canResume = status === 'paused' || detached;
    const waitNotice = detached ? null : dialingNotice(monitorData, { timeZone: policy.timezone });
    const retryLine = hasData ? retrySummary(monitorData, { timeZone: policy.timezone }) : '';
    const filterOptions = recipientFilterOptions(monitorCounts, monitorRetrying);
    const errorDetails = selectedError ? describeRecipientFailure(selectedError, gateway) : null;

    return (
      <div className="cw-container animate-fade-in">
        <header className="cw-header">
          <div className="cw-header-left">
            <button type="button" className="cw-btn-back" onClick={handleBackToList}>
              <ArrowLeft size={16} />
              <span>All Campaigns</span>
            </button>
            <div className="cw-title-wrap">
              <h1>{activeCampaign?.name || 'Campaign monitor'}</h1>
              <p>{['Outbound monitor', ...policySummary(policy)].join(' • ')}</p>
            </div>
          </div>
          <div className="cw-header-actions">
            <span className={`cw-badge ${status}`}>
              {statusLabel(status)}
            </span>
            {status === 'running' && (
              <button type="button" className="cw-btn-back cw-btn-warn" onClick={handlePauseCampaign} disabled={Boolean(monitorAction)}>
                {monitorAction === 'pause' ? <Loader2 size={14} className="animate-spin" /> : <Pause size={14} />}
                <span>Pause</span>
              </button>
            )}
            {canResume && (
              <button
                type="button"
                className="cw-btn-primary"
                onClick={handleResumeCampaign}
                disabled={Boolean(monitorAction)}
                title={detached ? 'Restart the dialer of this running campaign' : undefined}
              >
                {monitorAction === 'resume' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                <span>Resume</span>
              </button>
            )}
            <button
              type="button"
              className="cw-btn-back"
              onClick={handleRefreshMonitor}
              title="Refresh status"
              aria-label="Refresh campaign status"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </header>

        <div className="cw-stage-wrap">
          <Notice notice={notice} onDismiss={() => setNotice(null)} />
          {detached && (
            <Notice
              notice={{
                tone: 'warning',
                text: 'This campaign is marked running, but its dialer is not active on the server (it stops when the server restarts), so no new calls are being placed. Resume to restart dialing — recipients already called are not dialed again.'
              }}
              action={(
                <button type="button" className="cw-notice-action" onClick={handleResumeCampaign} disabled={Boolean(monitorAction)}>
                  {monitorAction === 'resume' ? 'Resuming…' : 'Resume'}
                </button>
              )}
            />
          )}
          {waitNotice && <Notice notice={waitNotice} />}
          {monitorError && (
            <Notice
              notice={{ tone: 'error', text: hasData ? `Live updates paused: ${monitorError}` : monitorError }}
              action={(
                <button type="button" className="cw-notice-action" onClick={handleRefreshMonitor}>
                  Retry
                </button>
              )}
            />
          )}

          {/* KPI Grid */}
          <div className="cw-kpi-grid">
            <div className="cw-kpi-card">
              <span className="lbl">Total Recipients</span>
              <div className="val">{kpi(mm.total)}</div>
            </div>
            <div className="cw-kpi-card">
              <span className="lbl">Dialed / In-Progress</span>
              <div className="val" style={{ color: '#2563eb' }}>{kpi(mm.dialed)}</div>
              {hasData && mm.calling > 0 && <span className="cw-kpi-sub">{mm.calling} in progress now</span>}
            </div>
            <div className="cw-kpi-card">
              <span className="lbl">Connected</span>
              <div className="val" style={{ color: '#16a34a' }}>{kpi(mm.completed)}</div>
            </div>
            <div className="cw-kpi-card">
              <span className="lbl">Failed / Unreachable</span>
              <div className="val" style={{ color: '#dc2626' }}>{kpi(mm.failed)}</div>
              {retryLine && <span className="cw-kpi-sub">{retryLine}</span>}
            </div>
          </div>

          {/* Recipients Live Table */}
          <div className="cw-card">
            <div className="cw-card-header cw-card-header-row">
              <div>
                <h3 className="cw-card-title">Live Recipient Dispatch Queue</h3>
                <p className="cw-card-desc">
                  Call statuses, durations and outcomes
                  {startedAt && <> &bull; Started {startedAt}</>}
                  {finishedAt && <> &bull; Finished {finishedAt}</>}
                </p>
              </div>
              <div className="cw-monitor-tools">
                <label htmlFor="cw-monitor-filter" className="cw-monitor-filter-label">Show</label>
                <select
                  id="cw-monitor-filter"
                  className="cw-select cw-select-compact"
                  value={monitorFilter}
                  onChange={e => handleMonitorFilterChange(e.target.value)}
                >
                  {filterOptions.map(o => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
                {monitorLoading && <Loader2 size={18} className="animate-spin" aria-label="Loading" />}
              </div>
            </div>

            <div className="cw-table-wrap">
              <table className="cw-table">
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Business</th>
                    <th>Phone (E.164)</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Duration</th>
                    <th>Outcome</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {monitorRecipients.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="cw-table-empty">
                        {monitorLoading || !hasData
                          ? (monitorError ? 'Recipients could not be loaded.' : 'Loading recipients…')
                          : (monitorFilter === 'all' ? 'No recipients logged for this campaign.' : 'No recipients match this filter right now.')}
                      </td>
                    </tr>
                  ) : (
                    monitorRecipients.map((r) => {
                      const failure = r.status === 'failed' ? describeRecipientFailure(r, gateway) : null;
                      const outcome = outcomeLabel(r.outcome);
                      const retryText = recipientRetryText(r, { timeZone: policy.timezone });
                      return (
                        <tr key={r.id}>
                          <td style={{ fontWeight: 600 }}>{r.name || 'Prospect'}</td>
                          <td>{r.business_name || '—'}</td>
                          <td style={{ fontFamily: 'monospace' }}>{r.normalized_phone || r.phone_number || '—'}</td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                              <span className={`cw-badge ${r.status}`}>
                                {statusLabel(r.status)}
                              </span>
                              {failure && (r.error_reason || r.outcome) && (
                                <button
                                  type="button"
                                  className="cw-link-btn cw-error-link"
                                  title={r.error_reason || failure.title}
                                  onClick={() => setSelectedError(r)}
                                >
                                  {failure.short}
                                </button>
                              )}
                              {retryText && <span className="cw-retry-note">{retryText}</span>}
                            </div>
                          </td>
                          <td>{attemptsText(r.attempts, policy.maxAttempts)}</td>
                          <td>{r.duration_seconds ? formatDuration(r.duration_seconds) : '—'}</td>
                          <td>
                            {outcome ? (
                              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: r.outcome === 'completed' ? '#15803d' : '#475569' }}>
                                {outcome}
                              </span>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>
                                {r.status === 'calling' ? 'In progress' : (r.status === 'invalid' || r.status === 'excluded' ? 'Not called' : 'Pending')}
                              </span>
                            )}
                          </td>
                          <td>
                            {r.transcript ? (
                              <button
                                type="button"
                                className="cw-btn-back cw-btn-compact"
                                onClick={() => setSelectedTranscript(r)}
                              >
                                <FileText size={12} />
                                <span>Transcript</span>
                              </button>
                            ) : failure ? (
                              <button
                                type="button"
                                className="cw-btn-back cw-btn-compact cw-btn-danger"
                                onClick={() => setSelectedError(r)}
                              >
                                <AlertCircle size={12} />
                                <span>View Error</span>
                              </button>
                            ) : (
                              <span style={{ color: '#cbd5e1', fontSize: '0.78rem' }}>No log</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <Pager
              offset={monitorOffset}
              shown={monitorRecipients.length}
              total={monitorTotal}
              onPage={goToMonitorPage}
              disabled={monitorLoading}
            />
          </div>
        </div>

        {/* Transcript Modal */}
        {selectedTranscript && (
          <CampaignDialog
            titleId="cw-transcript-title"
            title="Call Transcript & Summary"
            subtitle={`${selectedTranscript.name || 'Prospect'} (${selectedTranscript.normalized_phone || selectedTranscript.phone_number || 'no number'})`}
            onClose={() => setSelectedTranscript(null)}
            maxWidth={640}
            footer={(
              <button type="button" className="cw-btn-primary" onClick={() => setSelectedTranscript(null)}>
                Close
              </button>
            )}
          >
            {selectedTranscript.summary && (
              <div className="cw-transcript-summary">
                <div className="cw-section-label">Call summary</div>
                <p>{selectedTranscript.summary}</p>
              </div>
            )}
            <div className="cw-section-label">Conversation Log</div>
            <pre className="cw-transcript-log">
              {selectedTranscript.transcript || 'No transcript text captured.'}
            </pre>
          </CampaignDialog>
        )}

        {/* Error Details Modal */}
        {selectedError && errorDetails && (
          <CampaignDialog
            titleId="cw-error-title"
            title={(
              <>
                <AlertTriangle size={18} color="#dc2626" aria-hidden="true" />
                <span>{errorDetails.title}</span>
              </>
            )}
            titleClassName="cw-modal-title-danger"
            subtitle={`${selectedError.name || 'Prospect'} (${selectedError.normalized_phone || selectedError.phone_number || 'no number'}) • ${gateway}`}
            onClose={() => setSelectedError(null)}
            footer={(
              <button type="button" className="cw-btn-primary" onClick={() => setSelectedError(null)}>
                Dismiss
              </button>
            )}
          >
            <div className="cw-error-box">
              <div className="cw-error-box-title">{errorDetails.title}</div>
              <div className="cw-error-box-text">{errorDetails.detail}</div>
            </div>
            {errorDetails.raw && errorDetails.raw !== errorDetails.detail && (
              <div className="cw-raw-error">
                <strong>Carrier / dialer response:</strong>
                <div style={{ marginTop: '4px' }}>{errorDetails.raw}</div>
              </div>
            )}
          </CampaignDialog>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // 2. WIZARD VIEW (STEPS 1 TO 4)
  // ─────────────────────────────────────────────────────────────
  if (view === 'wizard') {
    const isEditing = wizardMode === 'edit';
    const launchWindow = wizardStep === 4 ? checkCallingWindow(callSettings) : null;
    const launchWindowNote = launchWindow ? outsideWindowNote(launchWindow) : null;
    const gatewayName = providerName(callSettings.call_provider);
    const storedProvider = unsupportedProvider(activeCampaign?.call_settings?.call_provider);
    const retriesOn = callSettings.max_attempts > 1;
    const pageShown = recipients.length;

    return (
      <div className="cw-container animate-fade-in">
        <header className="cw-header">
          <div className="cw-header-left">
            <button type="button" className="cw-btn-back" onClick={handleBackToList}>
              <ArrowLeft size={16} />
              <span>Exit Wizard</span>
            </button>
            <div className="cw-title-wrap">
              <h1>{isEditing ? 'Edit Campaign' : 'New Outbound Campaign'}</h1>
              <p>
                {isEditing
                  ? 'Update the agent, recipients and call settings, then launch'
                  : 'Configure agent, validate lead list, and launch autonomous outreach'}
              </p>
            </div>
          </div>
        </header>

        {/* Stepper Bar */}
        <nav className="cw-stepper-bar" aria-label="Campaign setup steps">
          {WIZARD_STEPS.map((step, idx) => {
            const isActive = wizardStep === step.n;
            const state = isActive ? 'active' : wizardStep > step.n ? 'completed' : '';
            return (
              <React.Fragment key={step.n}>
                {idx > 0 && <div className="cw-step-divider" aria-hidden="true" />}
                <button
                  type="button"
                  className={`cw-step-item ${state}`}
                  onClick={() => goToStep(step.n)}
                  disabled={!isActive && (saving || !canReachStep(step.n))}
                  aria-current={isActive ? 'step' : undefined}
                >
                  <span className="cw-step-circle">{wizardStep > step.n ? <Check size={14} /> : step.n}</span>
                  <span className="cw-step-label">{step.label}</span>
                </button>
              </React.Fragment>
            );
          })}
        </nav>

        <div className="cw-stage-wrap">
          <Notice notice={notice} onDismiss={() => setNotice(null)} />

          {/* STEP 1: Details & Agent */}
          {wizardStep === 1 && (
            <div className="cw-card">
              <div className="cw-card-header">
                <h3 className="cw-card-title">1. Campaign Identity & Agent Assignment</h3>
                <p className="cw-card-desc">Select which reusable Pearl AI voice agent will conduct these calls</p>
              </div>

              <div className="cw-form-group">
                <label htmlFor="cw-campaign-name">Campaign Name</label>
                <input
                  id="cw-campaign-name"
                  type="text"
                  className="cw-input"
                  value={campaignForm.name}
                  onChange={e => setCampaignForm({ ...campaignForm, name: e.target.value })}
                  placeholder="e.g. Q4 B2B Healthcare Outreach"
                />
              </div>

              <div className="cw-form-group">
                <label htmlFor="cw-campaign-agent">Assigned Pearl AI Voice Agent</label>
                {agentsLoading && availableAgents.length === 0 ? (
                  <div className="cw-inline-state">
                    <Loader2 size={16} className="animate-spin" />
                    <span>Loading your agents…</span>
                  </div>
                ) : agentsError && availableAgents.length === 0 ? (
                  <div className="cw-inline-error" role="alert">
                    <span>{agentsError}</span>
                    <button type="button" className="cw-btn-back cw-btn-compact" onClick={handleRetryAgents}>
                      <RefreshCw size={12} />
                      <span>Retry</span>
                    </button>
                  </div>
                ) : availableAgents.length === 0 ? (
                  <div style={{ padding: '16px', background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: '8px', color: '#b91c1c', fontSize: '0.86rem' }}>
                    No saved agents found. Please create and save an agent in the <strong>Agents</strong> section first.
                    <button
                      type="button"
                      className="cw-btn-primary"
                      style={{ marginTop: '10px' }}
                      onClick={() => typeof onNavigateSection === 'function' && onNavigateSection('agents')}
                    >
                      Go to Agent Builder
                    </button>
                  </div>
                ) : (
                  <select
                    id="cw-campaign-agent"
                    className="cw-select"
                    value={selectedAgent ? String(selectedAgent.id) : ''}
                    onChange={e => setCampaignForm({ ...campaignForm, agent_id: e.target.value })}
                  >
                    {!selectedAgent && <option value="" disabled>Select an agent…</option>}
                    {availableAgents.map(a => (
                      <option key={a.id} value={String(a.id)}>
                        {a.name} ({formatAgentRole(a.role) || 'Agent'} &bull; Voice: {voiceDisplayName(a.voice_config?.speaker) || 'Default'})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {selectedAgent && (
                <div style={{ background: '#f8fafc', padding: '14px 18px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <Sparkles size={16} color="#2563eb" />
                    <span style={{ fontWeight: 600, fontSize: '0.86rem', color: '#0f172a' }}>Agent Directives Snapshot</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.82rem', color: '#475569', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
                    {agentSnapshotText(selectedAgent)}
                  </p>
                </div>
              )}

              <div className="cw-form-group">
                <label htmlFor="cw-campaign-objective">Primary Campaign Objective</label>
                <textarea
                  id="cw-campaign-objective"
                  className="cw-textarea"
                  value={campaignForm.objective}
                  onChange={e => setCampaignForm({ ...campaignForm, objective: e.target.value })}
                  placeholder="What is the goal of every outbound call? (e.g. Qualify decision maker, establish interest, book demo link)"
                />
              </div>

              <div className="cw-form-group">
                <label htmlFor="cw-campaign-notes">Campaign Description / Notes (Optional)</label>
                <input
                  id="cw-campaign-notes"
                  type="text"
                  className="cw-input"
                  value={campaignForm.description}
                  onChange={e => setCampaignForm({ ...campaignForm, description: e.target.value })}
                  placeholder="Internal notes regarding target sector, offer, or tier"
                />
              </div>

              <div className="cw-footer-actions">
                <div />
                <button
                  type="button"
                  className="cw-btn-primary"
                  disabled={saving || !campaignForm.name.trim() || !selectedAgent}
                  onClick={() => handleSaveDraftStep1()}
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                  <span>Save Draft & Proceed to Leads</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Import & Validate */}
          {wizardStep === 2 && (
            <div className="cw-card">
              <div className="cw-card-header">
                <h3 className="cw-card-title">2. Lead Ingestion & Mandatory Validation</h3>
                <p className="cw-card-desc">
                  Import real verified prospects. Every number is normalized to E.164 and validated before calling is permitted.
                </p>
              </div>

              {/* Source Tabs */}
              <div className="cw-source-tabs">
                <button
                  type="button"
                  className={`cw-source-tab-btn ${sourceTab === 'finder' ? 'active' : ''}`}
                  aria-pressed={sourceTab === 'finder'}
                  onClick={() => setSourceTab('finder')}
                >
                  <Search size={15} />
                  <span>Clozflow Lead Finder</span>
                </button>
                <button
                  type="button"
                  className={`cw-source-tab-btn ${sourceTab === 'upload' ? 'active' : ''}`}
                  aria-pressed={sourceTab === 'upload'}
                  onClick={() => setSourceTab('upload')}
                >
                  <FileSpreadsheet size={15} />
                  <span>Upload CSV / Excel (.xlsx)</span>
                </button>
                <button
                  type="button"
                  className={`cw-source-tab-btn ${sourceTab === 'manual' ? 'active' : ''}`}
                  aria-pressed={sourceTab === 'manual'}
                  onClick={() => setSourceTab('manual')}
                >
                  <Plus size={15} />
                  <span>Manual Lead Entry</span>
                </button>
              </div>

              <Notice notice={uploadFeedback} onDismiss={() => setUploadFeedback(null)} />

              {/* TAB 1: Lead Finder */}
              {sourceTab === 'finder' && (
                <div>
                  <div className="cw-row-between" style={{ marginBottom: '12px' }}>
                    <span style={{ fontSize: '0.84rem', color: '#64748b' }}>
                      {loadingLeads || leadsError
                        ? 'Your Clozflow saved leads'
                        : `${savedLeads.length} leads found in your Clozflow saved leads vault${callableLeads.length < savedLeads.length ? ` (${savedLeads.length - callableLeads.length} without a phone number)` : ''}`}
                    </span>
                    {callableLeads.length > 0 && (
                      <button
                        type="button"
                        className="cw-btn-back cw-btn-compact"
                        onClick={toggleSelectAllLeads}
                      >
                        {allCallableSelected ? 'Deselect All' : 'Select All'}
                      </button>
                    )}
                  </div>

                  {loadingLeads ? (
                    <div style={{ textAlign: 'center', padding: '32px' }}>
                      <Loader2 size={24} className="animate-spin" aria-label="Loading saved leads" />
                    </div>
                  ) : leadsError ? (
                    <div className="cw-empty-box cw-empty-box-error" role="alert">
                      <p>{leadsError}</p>
                      <button type="button" className="cw-btn-back" onClick={handleRetryLeads}>
                        <RefreshCw size={14} />
                        <span>Retry</span>
                      </button>
                    </div>
                  ) : savedLeads.length === 0 ? (
                    <div className="cw-empty-box">
                      <p>No saved leads available in Lead Finder.</p>
                      <button type="button" className="cw-btn-back" onClick={goToLeadFinder}>
                        Go to Lead Finder
                      </button>
                    </div>
                  ) : (
                    <div className="cw-lead-picker">
                      <table className="cw-table">
                        <thead>
                          <tr>
                            <th style={{ width: 40 }}>Select</th>
                            <th>Business Name</th>
                            <th>Category / City</th>
                            <th>Phone Number</th>
                            <th>Fit Score</th>
                          </tr>
                        </thead>
                        <tbody>
                          {savedLeads.map(l => {
                            const callable = leadHasPhone(l);
                            const selected = selectedLeadIds.has(l.id);
                            return (
                              <tr
                                key={l.id}
                                className={selected ? 'cw-row-selected' : ''}
                                onClick={(e) => {
                                  if (!callable || e.target.closest('input, button, a, label')) return;
                                  toggleLeadSelection(l.id);
                                }}
                                style={{ cursor: callable ? 'pointer' : 'default' }}
                              >
                                <td>
                                  <input
                                    type="checkbox"
                                    className="cw-checkbox"
                                    checked={selected}
                                    disabled={!callable}
                                    onChange={() => toggleLeadSelection(l.id)}
                                    aria-label={`Select ${l.business_name || 'lead'}`}
                                    title={callable ? undefined : 'This lead has no phone number'}
                                  />
                                </td>
                                <td style={{ fontWeight: 600 }}>{l.business_name || 'Unnamed lead'}</td>
                                <td>{l.category || l.city || '—'}</td>
                                <td style={{ fontFamily: 'monospace', color: callable ? undefined : '#b91c1c' }}>{l.phone_number || 'No phone'}</td>
                                <td>{l.lead_score ? `${l.lead_score}%` : '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {!loadingLeads && !leadsError && savedLeads.length > 0 && (
                    <button
                      type="button"
                      className="cw-btn-primary"
                      disabled={importing || selectedLeadIds.size === 0}
                      onClick={handleImportFromFinder}
                    >
                      {importing ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                      <span>Import {selectedLeadIds.size} Selected Lead{selectedLeadIds.size === 1 ? '' : 's'} into Campaign</span>
                    </button>
                  )}
                </div>
              )}

              {/* TAB 2: File Upload */}
              {sourceTab === 'upload' && (
                <div>
                  <label
                    className={`cw-dropzone ${dragActive ? 'drag-active' : ''} ${uploadingFile ? 'busy' : ''}`}
                    onDragEnter={handleDragOver}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <input
                      type="file"
                      accept=".csv,.xlsx"
                      className="cw-visually-hidden"
                      onChange={handleFileInputChange}
                      disabled={uploadingFile}
                    />
                    {uploadingFile
                      ? <Loader2 size={32} color="#2563eb" className="animate-spin" style={{ margin: '0 auto 12px auto' }} />
                      : <Upload size={32} color="#2563eb" style={{ margin: '0 auto 12px auto' }} />}
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '0.96rem', fontWeight: 600 }}>
                      {uploadingFile ? 'Uploading & validating leads…' : 'Click to choose, or drop a CSV or Excel (.xlsx) file here'}
                    </h4>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
                      Automatic header detection: Name, Phone, Company, Email, Website. Up to 10 MB. Duplicate numbers are kept as excluded.
                    </p>
                  </label>
                </div>
              )}

              {/* TAB 3: Manual Entry */}
              {sourceTab === 'manual' && (
                <form onSubmit={handleAddManualLead} style={{ background: '#f8fafc', padding: '18px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                  <div className="cw-grid-2">
                    <div className="cw-form-group">
                      <label htmlFor="cw-manual-name">Contact Name</label>
                      <input
                        id="cw-manual-name"
                        type="text"
                        className="cw-input"
                        value={manualLead.name}
                        onChange={e => setManualLead({ ...manualLead, name: e.target.value })}
                        placeholder="e.g. Rajesh Mehra"
                      />
                    </div>
                    <div className="cw-form-group">
                      <label htmlFor="cw-manual-business">Business / Company Name</label>
                      <input
                        id="cw-manual-business"
                        type="text"
                        className="cw-input"
                        value={manualLead.business_name}
                        onChange={e => setManualLead({ ...manualLead, business_name: e.target.value })}
                        placeholder="e.g. Apex Diagnostics"
                      />
                    </div>
                  </div>
                  <div className="cw-grid-2">
                    <div className="cw-form-group">
                      <label htmlFor="cw-manual-phone">Phone Number (required)</label>
                      <input
                        id="cw-manual-phone"
                        type="tel"
                        className="cw-input"
                        value={manualLead.phone_number}
                        onChange={e => setManualLead({ ...manualLead, phone_number: e.target.value })}
                        placeholder="e.g. +91 98765 43210"
                        required
                      />
                    </div>
                    <div className="cw-form-group">
                      <label htmlFor="cw-manual-email">Email Address (Optional)</label>
                      <input
                        id="cw-manual-email"
                        type="email"
                        className="cw-input"
                        value={manualLead.email}
                        onChange={e => setManualLead({ ...manualLead, email: e.target.value })}
                        placeholder="rajesh@apex.in"
                      />
                    </div>
                  </div>
                  <button type="submit" className="cw-btn-primary" disabled={addingManual}>
                    {addingManual ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                    <span>Add lead</span>
                  </button>
                </form>
              )}

              {/* MANDATORY REVIEW TABLE */}
              <div style={{ marginTop: '28px' }}>
                <div className="cw-row-between" style={{ marginBottom: '8px' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 700 }}>Recipient Validation Review</h4>
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      Review normalization results before campaign launch. Invalid numbers cannot be dialed.
                    </span>
                  </div>
                  <div className="cw-chip-row">
                    <span className="cw-badge valid">Valid: {counts.eligible}</span>
                    <span className="cw-badge excluded">Invalid / excluded: {notCallable}</span>
                    <span className="cw-badge total">Total: {counts.total}</span>
                  </div>
                </div>

                {recipientsError && (
                  <Notice
                    notice={{ tone: 'error', text: recipientsError }}
                    action={(
                      <button type="button" className="cw-notice-action" onClick={handleRetryRecipients}>
                        Retry
                      </button>
                    )}
                  />
                )}

                <div className="cw-table-wrap">
                  <table className="cw-table">
                    <thead>
                      <tr>
                        <th style={{ width: 60 }}>Include</th>
                        <th>Name</th>
                        <th>Business</th>
                        <th>Imported Phone</th>
                        <th>Normalized E.164</th>
                        <th>Status</th>
                        <th>Validation Reason</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipients.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="cw-table-empty">
                            {recipientsLoading
                              ? 'Loading recipients…'
                              : 'No recipients imported yet. Select from Lead Finder, upload a CSV/Excel file, or add manually above.'}
                          </td>
                        </tr>
                      ) : (
                        recipients.map(r => {
                          const busy = busyRecipientId === r.id;
                          const reason = r.validation_error
                            || (r.status === 'excluded' ? 'Excluded — will not be called' : (r.status === 'valid' ? 'Verified E.164 destination' : '—'));
                          return (
                            <tr key={r.id} className={busy ? 'cw-row-busy' : ''}>
                              <td>
                                <input
                                  type="checkbox"
                                  className="cw-checkbox"
                                  checked={r.status === 'valid'}
                                  disabled={r.status === 'invalid' || !r.normalized_phone || busy}
                                  onChange={() => handleToggleRecipientStatus(r)}
                                  aria-label={`Include ${r.name || r.business_name || 'recipient'} in the campaign`}
                                />
                              </td>
                              <td style={{ fontWeight: 600 }}>{r.name || 'Prospect'}</td>
                              <td>{r.business_name || '—'}</td>
                              <td style={{ color: '#64748b' }}>{r.phone_number || '—'}</td>
                              <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                                {r.normalized_phone || <span style={{ color: '#dc2626' }}>Invalid format</span>}
                              </td>
                              <td>
                                <span className={`cw-badge ${r.status}`}>
                                  {statusLabel(r.status)}
                                </span>
                              </td>
                              <td style={{ fontSize: '0.78rem', color: r.status === 'valid' ? '#15803d' : (r.status === 'invalid' ? '#b91c1c' : '#64748b') }}>
                                {reason}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="cw-icon-btn"
                                  onClick={() => handleDeleteRecipient(r)}
                                  disabled={busy}
                                  title="Remove recipient"
                                  aria-label={`Remove ${r.name || r.business_name || 'recipient'}`}
                                >
                                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                <Pager
                  offset={recipientsOffset}
                  shown={pageShown}
                  total={counts.total}
                  onPage={goToRecipientsPage}
                  disabled={recipientsLoading}
                />
              </div>

              <div className="cw-footer-actions">
                <button type="button" className="cw-btn-back" onClick={() => setWizardStep(1)}>
                  <ArrowLeft size={16} />
                  <span>Back to Details</span>
                </button>
                <button
                  type="button"
                  className="cw-btn-primary"
                  disabled={counts.eligible === 0}
                  onClick={handleProceedToStep3}
                >
                  <ArrowRight size={16} />
                  <span>Configure Calling Settings ({counts.eligible} Ready)</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Calling Settings */}
          {wizardStep === 3 && (
            <div className="cw-card">
              <div className="cw-card-header">
                <h3 className="cw-card-title">3. Telephony & Calling Configuration</h3>
                <p className="cw-card-desc">Choose the outbound telephony gateway, calling window, retries and call concurrency</p>
              </div>

              {storedProvider && (
                <Notice
                  notice={{
                    tone: 'warning',
                    text: `This campaign was set to the "${storedProvider}" gateway, which the dialer does not support (only Vobiz and Exotel), so launching would fail. ${gatewayName} is selected instead and is saved when you continue.`
                  }}
                />
              )}

              {/* Telephony Connection Selection (Dropdown Menu) */}
              <div className="cw-form-group" style={{ marginBottom: '22px' }}>
                <div className="cw-row-between" style={{ marginBottom: '8px' }}>
                  <label htmlFor="cw-call-provider" style={{ margin: 0, fontSize: '0.88rem', fontWeight: 700, color: '#1e293b' }}>
                    Outbound Telephony Gateway / Connection
                  </label>
                  <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                    Gateways the dialer supports today
                  </span>
                </div>

                <select
                  id="cw-call-provider"
                  className="cw-select cw-select-strong"
                  value={callSettings.call_provider}
                  onChange={e => setCallSettings({ ...callSettings, call_provider: e.target.value })}
                >
                  {CALL_PROVIDERS.map(p => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>

              <div className="cw-grid-2">
                <div className="cw-form-group">
                  <label htmlFor="cw-window-start">Calling Window Start</label>
                  <input
                    id="cw-window-start"
                    type="time"
                    className="cw-input"
                    value={callSettings.window_start}
                    onChange={e => setCallSettings({ ...callSettings, window_start: e.target.value })}
                  />
                </div>
                <div className="cw-form-group">
                  <label htmlFor="cw-window-end">Calling Window End</label>
                  <input
                    id="cw-window-end"
                    type="time"
                    className="cw-input"
                    value={callSettings.window_end}
                    onChange={e => setCallSettings({ ...callSettings, window_end: e.target.value })}
                  />
                </div>
              </div>

              <div className="cw-grid-2">
                <div className="cw-form-group">
                  <label htmlFor="cw-window-tz">Window Timezone</label>
                  <select
                    id="cw-window-tz"
                    className="cw-select"
                    value={callSettings.timezone}
                    onChange={e => setCallSettings({ ...callSettings, timezone: e.target.value })}
                  >
                    {TIMEZONE_OPTIONS.map(tz => (
                      <option key={tz.id} value={tz.id}>{tz.label}</option>
                    ))}
                  </select>
                </div>
                <div className="cw-form-group">
                  <label htmlFor="cw-concurrency">Concurrent Call Limit</label>
                  <select
                    id="cw-concurrency"
                    className="cw-select"
                    value={callSettings.concurrency_limit}
                    onChange={e => setCallSettings({ ...callSettings, concurrency_limit: Number.parseInt(e.target.value, 10) })}
                  >
                    {CONCURRENCY_OPTIONS.map(n => (
                      <option key={n} value={n}>
                        {n === 1 ? '1 Call at a time (Safe Pacing)' : `${n} Calls in parallel`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="cw-grid-2">
                <div className="cw-form-group">
                  <label htmlFor="cw-max-attempts">Attempts per Recipient</label>
                  <select
                    id="cw-max-attempts"
                    className="cw-select"
                    value={callSettings.max_attempts}
                    onChange={e => setCallSettings({ ...callSettings, max_attempts: Number.parseInt(e.target.value, 10) })}
                  >
                    {attemptOptions(callSettings.max_attempts).map(n => (
                      <option key={n} value={n}>{attemptLabel(n)}</option>
                    ))}
                  </select>
                </div>
                <div className="cw-form-group">
                  <label htmlFor="cw-retry-interval">Wait Between Attempts</label>
                  <select
                    id="cw-retry-interval"
                    className="cw-select"
                    value={callSettings.retry_interval}
                    disabled={!retriesOn}
                    title={retriesOn ? undefined : 'Choose more than one attempt to retry calls'}
                    onChange={e => setCallSettings({ ...callSettings, retry_interval: Number(e.target.value) })}
                  >
                    {retryIntervalOptions(callSettings.retry_interval).map(m => (
                      <option key={m} value={m}>{retryIntervalLabel(m)}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="cw-info-box">
                <Clock size={16} className="cw-info-icon" aria-hidden="true" />
                <span>{callSettingsNote(callSettings)}</span>
              </div>

              <div className="cw-footer-actions">
                <button type="button" className="cw-btn-back" onClick={() => setWizardStep(2)}>
                  <ArrowLeft size={16} />
                  <span>Back to Leads</span>
                </button>
                <button type="button" className="cw-btn-primary" onClick={handleProceedToStep4} disabled={saving}>
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                  <span>Proceed to Final Review</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: Review & Explicit Launch */}
          {wizardStep === 4 && launchWindow && (
            <div className="cw-card">
              <div className="cw-card-header">
                <h3 className="cw-card-title">4. Pre-Flight Verification & Campaign Launch</h3>
                <p className="cw-card-desc">Carefully review all campaign parameters before initiating real phone calls</p>
              </div>

              <div className="cw-review-grid">
                <div className="cw-review-tile">
                  <div className="cw-review-label">Campaign & Persona</div>
                  <h4 style={{ margin: '0 0 6px 0', fontSize: '1rem', color: '#0f172a' }}>{campaignForm.name}</h4>
                  <div style={{ fontSize: '0.84rem', color: '#475569' }}>
                    Agent: <strong>{selectedAgent?.name || 'No agent selected'}</strong>
                  </div>
                  <div style={{ fontSize: '0.84rem', color: '#475569', marginTop: '4px' }}>
                    Voice: {voiceDisplayName(selectedAgent?.voice_config?.speaker) || 'Default'} &bull; Speed: {selectedAgent?.voice_config?.pace || 1.0}x
                  </div>
                </div>

                <div className="cw-review-tile">
                  <div className="cw-review-label">Dispatch Queue</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#15803d' }}>
                    {counts.eligible} Eligible Lead{counts.eligible === 1 ? '' : 's'}
                  </div>
                  <div style={{ fontSize: '0.84rem', color: '#64748b', marginTop: '4px' }}>
                    Not callable (invalid / excluded): {notCallable}
                  </div>
                </div>

                <div className="cw-review-tile">
                  <div className="cw-review-label">Telephony & Window</div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                    {gatewayName}
                  </div>
                  <div style={{ fontSize: '0.84rem', color: '#475569' }}>
                    Calling window: {launchWindow.alwaysOpen ? 'any time of day' : launchWindow.windowLabel}
                  </div>
                  <div style={{ fontSize: '0.84rem', color: '#64748b', marginTop: '4px' }}>
                    Concurrency: {callSettings.concurrency_limit} &bull; {describeRetryPolicy(callSettings)}
                  </div>
                </div>
              </div>

              {launchWindowNote && <Notice notice={{ tone: 'info', text: launchWindowNote }} />}

              <div style={{ background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '8px', padding: '16px', display: 'flex', gap: '14px', alignItems: 'flex-start', marginBottom: '24px' }}>
                <AlertTriangle size={20} color="#d97706" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ fontSize: '0.84rem', color: '#92400e', lineHeight: 1.5 }}>
                  <strong>Explicit Launch Notice:</strong> Launching this campaign starts automated PSTN dialing to the {counts.eligible} eligible recipient{counts.eligible === 1 ? '' : 's'} through <strong>{gatewayName}</strong>, {windowPhrase(launchWindow)}. Each recipient talks to Pearl in real time using the selected agent's instructions.
                  {' '}{describeRetryPolicy(callSettings)}.
                  {' '}{callRate ? `Connected calls are billed at ₹${callRate.toFixed(2)} per minute from your wallet.` : 'Connected calls are billed per minute from your wallet.'}
                </div>
              </div>

              <div className="cw-footer-actions">
                <button type="button" className="cw-btn-back" onClick={() => setWizardStep(3)}>
                  <ArrowLeft size={16} />
                  <span>Back to Settings</span>
                </button>
                <button
                  type="button"
                  className="cw-btn-primary cw-btn-launch"
                  disabled={launching || counts.eligible === 0}
                  onClick={handleLaunchCampaign}
                >
                  {launching ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Launching Campaign...</span>
                    </>
                  ) : (
                    <>
                      <Play size={16} />
                      <span>Launch Campaign ({counts.eligible} Lead{counts.eligible === 1 ? '' : 's'})</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // 3. CAMPAIGN LIST / OVERVIEW (DEFAULT VIEW)
  // ─────────────────────────────────────────────────────────────
  const summary = summarizeCampaigns(campaigns);
  const hasCampaigns = campaigns.length > 0;
  const listReady = hasCampaigns || (!listLoading && !listError);
  const summaryValue = (value) => (listReady ? value : '—');

  return (
    <div className="cw-container animate-fade-in">
      <header className="cw-header">
        <div className="cw-header-left">
          <button
            type="button"
            className="cw-btn-back"
            onClick={() => {
              if (typeof onNavigateSection === 'function') onNavigateSection('agents');
            }}
            title="Back to Voice Agents"
          >
            <ArrowLeft size={16} />
            <span>Voice Agents</span>
          </button>
          <div className="cw-title-wrap">
            <h1>Outbound Campaigns</h1>
            <p>Automate high-converting outbound qualification calls powered by reusable Pearl AI agents</p>
          </div>
        </div>
        <button
          type="button"
          className="cw-btn-primary"
          onClick={handleStartNewCampaign}
        >
          <Plus size={16} />
          <span>New Campaign</span>
        </button>
      </header>

      <div className="cw-stage-wrap">
        <Notice notice={notice} onDismiss={() => setNotice(null)} />
        {listError && hasCampaigns && (
          <Notice
            notice={{ tone: 'error', text: `Couldn't refresh the campaigns: ${listError}` }}
            action={(
              <button type="button" className="cw-notice-action" onClick={handleRetryList}>
                Retry
              </button>
            )}
          />
        )}

        {/* Quick Aggregated KPIs */}
        <div className="cw-kpi-grid">
          <div className="cw-kpi-card">
            <span className="lbl">Total Campaigns</span>
            <div className="val">{summaryValue(summary.count)}</div>
          </div>
          <div className="cw-kpi-card">
            <span className="lbl">Active Campaigns</span>
            <div className="val" style={{ color: '#2563eb' }}>
              {summaryValue(summary.running)}
            </div>
          </div>
          <div className="cw-kpi-card">
            <span className="lbl">Total Leads Dialed</span>
            <div className="val" style={{ color: '#16a34a' }}>
              {summaryValue(summary.dialed)}
            </div>
          </div>
          <div className="cw-kpi-card">
            <span className="lbl">Connected Calls</span>
            <div className="val" style={{ color: '#9333ea' }}>
              {summaryValue(summary.connected)}
            </div>
          </div>
        </div>

        {/* Campaigns Table / Cards */}
        <div className="cw-card">
          <div className="cw-card-header">
            <h3 className="cw-card-title">All Campaigns</h3>
            <p className="cw-card-desc">Manage, review, monitor, and launch autonomous campaigns</p>
          </div>

          {listLoading && !hasCampaigns ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <Loader2 size={24} className="animate-spin" aria-label="Loading campaigns" />
            </div>
          ) : listError && !hasCampaigns ? (
            <div className="cw-empty-box cw-empty-box-error" role="alert">
              <AlertCircle size={32} color="#dc2626" style={{ margin: '0 auto 10px auto' }} />
              <h3>Couldn't load your campaigns</h3>
              <p>{listError}</p>
              <button type="button" className="cw-btn-primary" onClick={handleRetryList} style={{ margin: '0 auto' }}>
                <RefreshCw size={16} />
                <span>Retry</span>
              </button>
            </div>
          ) : !hasCampaigns ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', background: '#f8fafc', borderRadius: '10px', border: '1px dashed #cbd5e1' }}>
              <Megaphone size={36} color="#94a3b8" style={{ margin: '0 auto 12px auto' }} />
              <h3 style={{ margin: '0 0 6px 0', fontSize: '1.05rem', color: '#1e293b' }}>No Outbound Campaigns Yet</h3>
              <p style={{ margin: '0 0 18px 0', color: '#64748b', fontSize: '0.86rem' }}>
                Create your first outbound campaign, import leads from Clozflow Lead Finder, and deploy Pearl AI.
              </p>
              <button type="button" className="cw-btn-primary" onClick={handleStartNewCampaign} style={{ margin: '0 auto' }}>
                <Plus size={16} />
                <span>Create Campaign</span>
              </button>
            </div>
          ) : (
            <div className="cw-table-wrap">
              <table className="cw-table">
                <thead>
                  <tr>
                    <th>Campaign Name</th>
                    <th>Assigned Agent</th>
                    <th>Status</th>
                    <th>Recipients</th>
                    <th>Progress</th>
                    <th>Created</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map(c => {
                    const m = campaignListMetrics(c);
                    const isRunning = c.status === 'running';
                    const isDeleting = deletingId === c.id;

                    return (
                      <tr key={c.id}>
                        <td>
                          <div style={{ fontWeight: 600, color: '#0f172a' }}>{c.name}</div>
                          {c.objective && (
                            <div style={{ fontSize: '0.78rem', color: '#64748b' }} title={c.objective}>{truncate(c.objective, 50)}</div>
                          )}
                        </td>
                        <td>
                          <span style={{ fontWeight: 500, color: c.agent_name ? undefined : '#94a3b8' }}>{c.agent_name || 'No agent assigned'}</span>
                        </td>
                        <td>
                          <span className={`cw-badge ${c.status}`}>
                            {statusLabel(c.status)}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 600 }}>{m.total}</span> leads
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div
                              className="cw-progress-track"
                              role="progressbar"
                              aria-label={`${c.name} progress`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={m.pct}
                            >
                              <div className="cw-progress-fill" style={{ width: `${m.pct}%` }} />
                            </div>
                            <span style={{ fontSize: '0.76rem', color: '#64748b' }}>{m.dialed}/{m.target}</span>
                          </div>
                        </td>
                        <td style={{ fontSize: '0.8rem', color: '#64748b' }}>
                          {formatServerDate(c.created_at, LIST_DATE_FORMAT) || '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                            {c.status === 'draft' ? (
                              <button
                                type="button"
                                className="cw-btn-primary cw-btn-compact"
                                onClick={() => handleEditCampaign(c)}
                              >
                                <span>Configure & Launch</span>
                                <ChevronRight size={14} />
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="cw-btn-back cw-btn-compact"
                                onClick={() => handleOpenMonitor(c)}
                              >
                                <Eye size={14} />
                                <span>Monitor</span>
                              </button>
                            )}
                            <button
                              type="button"
                              className="cw-icon-btn"
                              onClick={() => handleDeleteCampaign(c)}
                              disabled={isRunning || Boolean(deletingId)}
                              title={isRunning ? 'Pause the campaign before deleting it' : 'Delete campaign'}
                              aria-label={`Delete campaign ${c.name}`}
                            >
                              {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CampaignWorkspace;
