import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Play, Pause, RefreshCw, Plus, ArrowLeft, ArrowRight, 
  CheckCircle2, AlertTriangle, AlertCircle, Phone, Upload, 
  Search, Check, X, FileSpreadsheet, Users, Clock, 
  ShieldCheck, ChevronRight, Eye, Trash2, Loader2, Sparkles, 
  Sliders, BarChart3, Megaphone, FileText, CheckSquare, Square
} from 'lucide-react';
import './CampaignWorkspace.css';

const API_BASE = window.APP_API_BASE || '';

const getHeaders = (isJson = true) => {
  const token = localStorage.getItem('token');
  const headers = {};
  if (isJson) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

export const CampaignWorkspace = ({ onNavigateSection }) => {
  // Views: 'list' | 'wizard' | 'monitor'
  const [view, setView] = useState('list');
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeCampaignId, setActiveCampaignId] = useState(null);

  // Wizard state (Steps 1 to 4)
  const [wizardStep, setWizardStep] = useState(1);
  const [availableAgents, setAvailableAgents] = useState([]);
  const [campaignForm, setCampaignForm] = useState({
    name: '',
    agent_id: '',
    objective: 'Outbound sales qualification and demo scheduling',
    description: ''
  });
  
  // Step 2: Recipients state
  const [sourceTab, setSourceTab] = useState('finder'); // 'finder' | 'upload' | 'manual'
  const [savedLeads, setSavedLeads] = useState([]);
  const [selectedLeadIds, setSelectedLeadIds] = useState(new Set());
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [recipients, setRecipients] = useState([]);
  const [recipientsStats, setRecipientsStats] = useState({ total: 0, valid: 0, invalid: 0, excluded: 0 });
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState(null);
  
  // Manual Lead Form
  const [manualLead, setManualLead] = useState({
    name: '',
    business_name: '',
    phone_number: '',
    email: '',
    website: ''
  });

  // Step 3: Call settings
  const [callSettings, setCallSettings] = useState({
    window_start: '09:00',
    window_end: '19:00',
    timezone: 'Asia/Kolkata',
    max_retries: 2,
    retry_interval_minutes: 30,
    concurrency_limit: 1,
    call_provider: 'exotel'
  });

  // Step 4 / Launch state
  const [launching, setLaunching] = useState(false);

  // Monitor state
  const [monitorData, setMonitorData] = useState(null);
  const [monitorRecipients, setMonitorRecipients] = useState([]);
  const [selectedTranscript, setSelectedTranscript] = useState(null);
  const pollIntervalRef = useRef(null);

  // 1. Fetch campaigns list
  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/pearl/campaigns`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data || []);
      }
    } catch (err) {
      console.error('Failed to fetch campaigns:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 2. Fetch available agents
  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/pearl/agents`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setAvailableAgents(data || []);
        if (data && data.length > 0 && !campaignForm.agent_id) {
          setCampaignForm(prev => ({ ...prev, agent_id: data[0].id }));
        }
      }
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    }
  }, [campaignForm.agent_id]);

  // 3. Fetch saved leads from Lead Finder
  const fetchSavedLeads = useCallback(async () => {
    setLoadingLeads(true);
    try {
      const res = await fetch(`${API_BASE}/leads/saved`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data?.leads || data?.items || []);
        setSavedLeads(list);
      } else {
        setSavedLeads([]);
      }
    } catch (err) {
      console.error('Failed to fetch saved leads:', err);
      setSavedLeads([]);
    } finally {
      setLoadingLeads(false);
    }
  }, []);

  // 4. Fetch recipients for the active campaign
  const fetchRecipients = useCallback(async (campaignId) => {
    if (!campaignId) return;
    try {
      const res = await fetch(`${API_BASE}/api/pearl/campaigns/${campaignId}/recipients`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data?.recipients || []);
        setRecipients(list);
        
        let valid = 0, invalid = 0, excluded = 0;
        list.forEach(r => {
          if (r.status === 'valid') valid++;
          else if (r.status === 'invalid') invalid++;
          else if (r.status === 'excluded') excluded++;
        });
        setRecipientsStats({ total: list.length, valid, invalid, excluded });
      } else {
        setRecipients([]);
        setRecipientsStats({ total: 0, valid: 0, invalid: 0, excluded: 0 });
      }
    } catch (err) {
      console.error('Failed to fetch recipients:', err);
      setRecipients([]);
      setRecipientsStats({ total: 0, valid: 0, invalid: 0, excluded: 0 });
    }
  }, []);

  // 5. Monitor status fetch
  const fetchMonitorStatus = useCallback(async (campaignId) => {
    if (!campaignId) return;
    try {
      const [statusRes, recipRes] = await Promise.all([
        fetch(`${API_BASE}/api/pearl/campaigns/${campaignId}/status`, { headers: getHeaders() }),
        fetch(`${API_BASE}/api/pearl/campaigns/${campaignId}/recipients`, { headers: getHeaders() })
      ]);
      if (statusRes.ok) {
        const sData = await statusRes.json();
        setMonitorData(sData);
      }
      if (recipRes.ok) {
        const rData = await recipRes.json();
        const rList = Array.isArray(rData) ? rData : (rData?.recipients || []);
        setMonitorRecipients(rList);
      }
    } catch (err) {
      console.error('Monitor status fetch error:', err);
    }
  }, []);

  useEffect(() => {
    fetchCampaigns();
    fetchAgents();
  }, [fetchCampaigns, fetchAgents]);

  // Polling during monitor view
  useEffect(() => {
    if (view === 'monitor' && activeCampaignId) {
      fetchMonitorStatus(activeCampaignId);
      pollIntervalRef.current = setInterval(() => {
        fetchMonitorStatus(activeCampaignId);
      }, 4000);
    } else {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    }
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [view, activeCampaignId, fetchMonitorStatus]);

  // Handle Chrome & browser backward navigation inside Campaign Workspace
  useEffect(() => {
    // Push a distinct history state when view or step changes
    const currentState = window.history.state;
    if (!currentState || currentState.cw_view !== view || currentState.cw_step !== wizardStep) {
      window.history.pushState({ cw: true, cw_view: view, cw_step: wizardStep }, '', window.location.href);
    }

    const handlePopState = () => {
      if (view === 'wizard') {
        if (wizardStep > 1) {
          setWizardStep(prev => prev - 1);
        } else {
          setView('list');
          fetchCampaigns();
        }
      } else if (view === 'monitor') {
        setView('list');
        fetchCampaigns();
      } else if (view === 'list') {
        if (typeof onNavigateSection === 'function') {
          onNavigateSection('agents');
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [view, wizardStep, onNavigateSection, fetchCampaigns]);

  // Handle Wizard Start
  const handleStartNewCampaign = () => {
    setCampaignForm({
      name: `Outbound Campaign - ${new Date().toLocaleDateString('en-GB')}`,
      agent_id: availableAgents.length > 0 ? availableAgents[0].id : '',
      objective: 'Qualify sales interest, discover operational pain points, and book a discovery demo.',
      description: ''
    });
    setRecipients([]);
    setRecipientsStats({ total: 0, valid: 0, invalid: 0, excluded: 0 });
    setSelectedLeadIds(new Set());
    setActiveCampaignId(null);
    setWizardStep(1);
    setView('wizard');
  };

  // Step 1 -> Step 2: Save campaign draft
  const handleSaveDraftStep1 = async () => {
    if (!campaignForm.name.trim()) {
      alert('Please enter a campaign name');
      return;
    }
    if (!campaignForm.agent_id) {
      alert('Please select a saved Pearl AI agent');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        name: campaignForm.name.trim(),
        agent_id: String(campaignForm.agent_id),
        objective: campaignForm.objective,
        description: campaignForm.description
      };

      const url = activeCampaignId 
        ? `${API_BASE}/api/pearl/campaigns/${activeCampaignId}`
        : `${API_BASE}/api/pearl/campaigns`;
      const method = activeCampaignId ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: getHeaders(),
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to save campaign draft');
      }

      const saved = await res.json();
      setActiveCampaignId(saved.id);
      await fetchRecipients(saved.id);
      await fetchSavedLeads();
      setWizardStep(2);
    } catch (err) {
      alert(`Draft error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Import from Lead Finder
  const handleImportFromFinder = async () => {
    if (selectedLeadIds.size === 0) {
      alert('Please select at least one lead from the list.');
      return;
    }

    const list = Array.isArray(savedLeads) ? savedLeads : [];
    const leadsToImport = list
      .filter(l => selectedLeadIds.has(l.id))
      .map(l => ({
        lead_id: l.id,
        name: l.business_name || 'Prospect',
        business_name: l.business_name,
        phone_number: l.phone_number,
        website: l.website,
        email: ''
      }));

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/pearl/campaigns/${activeCampaignId}/import-from-finder`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ leads: leadsToImport })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to import leads');
      }

      const result = await res.json();
      setUploadFeedback(`Imported ${result.stats?.valid || 0} valid leads (${result.stats?.duplicates || 0} duplicates skipped).`);
      setSelectedLeadIds(new Set());
      await fetchRecipients(activeCampaignId);
    } catch (err) {
      alert(`Import error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: File Upload (CSV or XLSX)
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingFile(true);
    setUploadFeedback(null);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_BASE}/api/pearl/campaigns/${activeCampaignId}/import-leads`, {
        method: 'POST',
        headers: getHeaders(false),
        body: formData
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to upload leads file');
      }

      const data = await res.json();
      const s = data.stats || {};
      setUploadFeedback(`Import complete: ${s.valid || 0} valid recipients added, ${s.invalid || 0} invalid, ${s.duplicates || 0} duplicates skipped.`);
      await fetchRecipients(activeCampaignId);
    } catch (err) {
      setUploadFeedback(`Upload failed: ${err.message}`);
    } finally {
      setUploadingFile(false);
    }
  };

  // Step 2: Manual Add Lead
  const handleAddManualLead = async (e) => {
    e.preventDefault();
    if (!manualLead.phone_number.trim()) {
      alert('Phone number is required');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/pearl/campaigns/${activeCampaignId}/add-manual-recipient`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(manualLead)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to add manual recipient');
      }

      setManualLead({ name: '', business_name: '', phone_number: '', email: '', website: '' });
      await fetchRecipients(activeCampaignId);
      setUploadFeedback('Recipient added successfully.');
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Toggle recipient status (valid vs excluded)
  const handleToggleRecipientStatus = async (recipient) => {
    const newStatus = recipient.status === 'excluded' ? 'valid' : 'excluded';
    try {
      const res = await fetch(`${API_BASE}/api/pearl/campaigns/${activeCampaignId}/recipients/${recipient.id}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ status: newStatus })
      });
      if (res.ok) {
        await fetchRecipients(activeCampaignId);
      }
    } catch (err) {
      console.error('Failed to update recipient status:', err);
    }
  };

  // Delete single recipient
  const handleDeleteRecipient = async (recipientId) => {
    try {
      const res = await fetch(`${API_BASE}/api/pearl/campaigns/${activeCampaignId}/recipients/${recipientId}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      if (res.ok) {
        await fetchRecipients(activeCampaignId);
      }
    } catch (err) {
      console.error('Failed to delete recipient:', err);
    }
  };

  // Step 2 -> Step 3: Validate eligible recipients exist
  const handleProceedToStep3 = () => {
    if (recipientsStats.valid === 0) {
      alert('Cannot proceed: A campaign requires at least 1 validated, eligible recipient. Please import and review leads.');
      return;
    }
    setWizardStep(3);
  };

  // Step 3 -> Step 4: Save call settings
  const handleProceedToStep4 = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/pearl/campaigns/${activeCampaignId}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ call_settings: callSettings })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to save call settings');
      }
      setWizardStep(4);
    } catch (err) {
      alert(`Settings error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Step 4: Explicit Launch Campaign
  const handleLaunchCampaign = async () => {
    if (!window.confirm(`Are you sure you want to launch "${campaignForm.name}"? Real outbound calls will be initiated to ${recipientsStats.valid} eligible recipients.`)) {
      return;
    }

    setLaunching(true);
    try {
      const res = await fetch(`${API_BASE}/api/pearl/campaigns/${activeCampaignId}/launch`, {
        method: 'POST',
        headers: getHeaders()
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to launch campaign');
      }

      await fetchCampaigns();
      setView('monitor');
    } catch (err) {
      alert(`Launch error: ${err.message}`);
    } finally {
      setLaunching(false);
    }
  };

  // Monitor actions: Pause / Resume
  const handlePauseCampaign = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/pearl/campaigns/${activeCampaignId}/pause`, {
        method: 'POST',
        headers: getHeaders()
      });
      if (res.ok) fetchMonitorStatus(activeCampaignId);
    } catch (err) {
      console.error('Pause error:', err);
    }
  };

  const handleResumeCampaign = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/pearl/campaigns/${activeCampaignId}/resume`, {
        method: 'POST',
        headers: getHeaders()
      });
      if (res.ok) fetchMonitorStatus(activeCampaignId);
    } catch (err) {
      console.error('Resume error:', err);
    }
  };

  // Open existing campaign in monitor view
  const handleOpenMonitor = (cId) => {
    setActiveCampaignId(cId);
    setView('monitor');
  };

  // Open existing campaign draft in wizard
  const handleEditCampaign = async (c) => {
    setActiveCampaignId(c.id);
    setCampaignForm({
      name: c.name,
      agent_id: c.agent_id || '',
      objective: c.objective || '',
      description: c.description || ''
    });
    if (c.call_settings) {
      setCallSettings(prev => ({ ...prev, ...c.call_settings }));
    }
    await fetchRecipients(c.id);
    await fetchSavedLeads();
    setWizardStep(c.status === 'draft' ? 2 : 1);
    setView('wizard');
  };

  // Delete campaign
  const handleDeleteCampaign = async (cId, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this campaign and all associated recipient records?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/pearl/campaigns/${cId}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      if (res.ok) {
        fetchCampaigns();
      }
    } catch (err) {
      alert(`Delete error: ${err.message}`);
    }
  };

  const selectedAgent = availableAgents.find(a => String(a.id) === String(campaignForm.agent_id));

  // Toggle lead selection in Lead Finder tab
  const toggleSelectAllLeads = () => {
    const list = Array.isArray(savedLeads) ? savedLeads : [];
    if (selectedLeadIds.size === list.length) {
      setSelectedLeadIds(new Set());
    } else {
      setSelectedLeadIds(new Set(list.map(l => l.id)));
    }
  };

  const toggleLeadSelection = (id) => {
    const next = new Set(selectedLeadIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedLeadIds(next);
  };

  // ─────────────────────────────────────────────────────────────
  // 1. MONITOR VIEW
  // ─────────────────────────────────────────────────────────────
  if (view === 'monitor') {
    const metrics = monitorData?.metrics || {};
    const status = monitorData?.status || 'running';

    return (
      <div className="cw-container animate-fade-in">
        <header className="cw-header">
          <div className="cw-header-left">
            <button 
              type="button" 
              className="cw-btn-back" 
              onClick={() => { setView('list'); fetchCampaigns(); }}
            >
              <ArrowLeft size={16} />
              <span>All Campaigns</span>
            </button>
            <div className="cw-title-wrap">
              <h1>{monitorData?.name || campaignForm.name}</h1>
              <p>Autonomous Voice Outbound Monitor &bull; Pacing 1.0x &bull; Indian PSTN via Exotel</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span className={`cw-badge ${status}`}>
              {status}
            </span>
            {status === 'running' && (
              <button type="button" className="cw-btn-back" onClick={handlePauseCampaign} style={{ color: '#ea580c' }}>
                <Pause size={14} />
                <span>Pause</span>
              </button>
            )}
            {status === 'paused' && (
              <button type="button" className="cw-btn-primary" onClick={handleResumeCampaign}>
                <Play size={14} />
                <span>Resume</span>
              </button>
            )}
            <button 
              type="button" 
              className="cw-btn-back" 
              onClick={() => fetchMonitorStatus(activeCampaignId)}
              title="Refresh status"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </header>

        <div className="cw-stage-wrap">
          {/* KPI Grid */}
          <div className="cw-kpi-grid">
            <div className="cw-kpi-card">
              <span className="lbl">Total Recipients</span>
              <div className="val">{metrics.total_recipients || recipients.length || 0}</div>
            </div>
            <div className="cw-kpi-card">
              <span className="lbl">Dialed / In-Progress</span>
              <div className="val" style={{ color: '#2563eb' }}>{metrics.dialed || 0}</div>
            </div>
            <div className="cw-kpi-card">
              <span className="lbl">Qualified / Connected</span>
              <div className="val" style={{ color: '#16a34a' }}>{metrics.qualified || 0}</div>
            </div>
            <div className="cw-kpi-card">
              <span className="lbl">Failed / Unreachable</span>
              <div className="val" style={{ color: '#dc2626' }}>{metrics.failed || 0}</div>
            </div>
          </div>

          {/* Recipients Live Table */}
          <div className="cw-card">
            <div className="cw-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 className="cw-card-title">Live Recipient Dispatch Queue</h3>
                <p className="cw-card-desc">Call statuses, durations, and autonomous qualification outcomes</p>
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
                  {(Array.isArray(monitorRecipients) ? monitorRecipients : []).length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '32px', color: '#64748b' }}>
                        No recipients logged for this campaign.
                      </td>
                    </tr>
                  ) : (
                    (Array.isArray(monitorRecipients) ? monitorRecipients : []).map((r) => (
                      <tr key={r.id}>
                        <td style={{ fontWeight: 600 }}>{r.name || 'Prospect'}</td>
                        <td>{r.business_name || '—'}</td>
                        <td style={{ fontFamily: 'monospace' }}>{r.normalized_phone || r.phone_number}</td>
                        <td>
                          <span className={`cw-badge ${r.status}`}>
                            {r.status}
                          </span>
                        </td>
                        <td>{r.attempts || 0}</td>
                        <td>{r.duration_seconds ? `${r.duration_seconds}s` : '—'}</td>
                        <td>
                          {r.outcome ? (
                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: r.outcome === 'qualified' ? '#15803d' : '#475569' }}>
                              {r.outcome}
                            </span>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>Pending</span>
                          )}
                        </td>
                        <td>
                          {r.transcript ? (
                            <button 
                              type="button" 
                              className="cw-btn-back" 
                              style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                              onClick={() => setSelectedTranscript(r)}
                            >
                              <FileText size={12} />
                              <span>Transcript</span>
                            </button>
                          ) : (
                            <span style={{ color: '#cbd5e1', fontSize: '0.78rem' }}>No log</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Transcript Modal */}
        {selectedTranscript && (
          <div className="pearl-phone-modal-backdrop" onClick={() => setSelectedTranscript(null)}>
            <div className="pearl-phone-modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '640px' }}>
              <div className="modal-header">
                <div>
                  <h3 className="modal-title">Call Transcript & Summary</h3>
                  <p className="modal-sub">{selectedTranscript.name} ({selectedTranscript.normalized_phone})</p>
                </div>
                <button type="button" className="modal-close-btn" onClick={() => setSelectedTranscript(null)}>✕</button>
              </div>
              <div className="modal-body">
                {selectedTranscript.summary && (
                  <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '4px' }}>AI Executive Summary</div>
                    <p style={{ margin: 0, fontSize: '0.86rem', color: '#1e293b' }}>{selectedTranscript.summary}</p>
                  </div>
                )}
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '6px' }}>Conversation Log</div>
                <pre style={{ background: '#0f172a', color: '#f8fafc', padding: '14px', borderRadius: '8px', fontSize: '0.82rem', maxHeight: '300px', overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                  {selectedTranscript.transcript || 'No transcript text captured.'}
                </pre>
              </div>
              <div className="modal-footer">
                <button type="button" className="cw-btn-primary" onClick={() => setSelectedTranscript(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // 2. WIZARD VIEW (STEPS 1 TO 4)
  // ─────────────────────────────────────────────────────────────
  if (view === 'wizard') {
    return (
      <div className="cw-container animate-fade-in">
        <header className="cw-header">
          <div className="cw-header-left">
            <button 
              type="button" 
              className="cw-btn-back" 
              onClick={() => { setView('list'); fetchCampaigns(); }}
            >
              <ArrowLeft size={16} />
              <span>Exit Wizard</span>
            </button>
            <div className="cw-title-wrap">
              <h1>New Outbound Campaign</h1>
              <p>Configure agent, validate lead list, and launch autonomous outreach</p>
            </div>
          </div>
        </header>

        {/* Stepper Bar */}
        <div className="cw-stepper-bar">
          <div className={`cw-step-item ${wizardStep === 1 ? 'active' : wizardStep > 1 ? 'completed' : ''}`} onClick={() => setWizardStep(1)}>
            <div className="cw-step-circle">{wizardStep > 1 ? <Check size={14} /> : '1'}</div>
            <span className="cw-step-label">Details & Agent</span>
          </div>
          <div className="cw-step-divider" />
          <div className={`cw-step-item ${wizardStep === 2 ? 'active' : wizardStep > 2 ? 'completed' : ''}`} onClick={() => activeCampaignId && setWizardStep(2)}>
            <div className="cw-step-circle">{wizardStep > 2 ? <Check size={14} /> : '2'}</div>
            <span className="cw-step-label">Import & Validate</span>
          </div>
          <div className="cw-step-divider" />
          <div className={`cw-step-item ${wizardStep === 3 ? 'active' : wizardStep > 3 ? 'completed' : ''}`} onClick={() => activeCampaignId && recipientsStats.valid > 0 && setWizardStep(3)}>
            <div className="cw-step-circle">{wizardStep > 3 ? <Check size={14} /> : '3'}</div>
            <span className="cw-step-label">Call Settings</span>
          </div>
          <div className="cw-step-divider" />
          <div className={`cw-step-item ${wizardStep === 4 ? 'active' : ''}`} onClick={() => activeCampaignId && recipientsStats.valid > 0 && setWizardStep(4)}>
            <div className="cw-step-circle">4</div>
            <span className="cw-step-label">Review & Launch</span>
          </div>
        </div>

        <div className="cw-stage-wrap">
          {/* STEP 1: Details & Agent */}
          {wizardStep === 1 && (
            <div className="cw-card">
              <div className="cw-card-header">
                <h3 className="cw-card-title">1. Campaign Identity & Agent Assignment</h3>
                <p className="cw-card-desc">Select which reusable Pearl AI voice agent will conduct these calls</p>
              </div>

              <div className="cw-form-group">
                <label>Campaign Name</label>
                <input 
                  type="text" 
                  className="cw-input" 
                  value={campaignForm.name} 
                  onChange={e => setCampaignForm({ ...campaignForm, name: e.target.value })}
                  placeholder="e.g. Q4 B2B Healthcare Outreach"
                />
              </div>

              <div className="cw-form-group">
                <label>Assigned Pearl AI Voice Agent</label>
                {availableAgents.length === 0 ? (
                  <div style={{ padding: '16px', background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: '8px', color: '#b91c1c', fontSize: '0.86rem' }}>
                    No saved agents found. Please create and save an agent in the <strong>Agents</strong> section first.
                    <button 
                      type="button" 
                      className="cw-btn-primary" 
                      style={{ marginTop: '10px' }} 
                      onClick={() => onNavigateSection('agents')}
                    >
                      Go to Agent Builder
                    </button>
                  </div>
                ) : (
                  <select 
                    className="cw-select"
                    value={campaignForm.agent_id}
                    onChange={e => setCampaignForm({ ...campaignForm, agent_id: e.target.value })}
                  >
                    {availableAgents.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.role} &bull; Voice: {a.voice_config?.speaker ? a.voice_config.speaker.split('_')[0] : 'Shubh'})
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
                  <p style={{ margin: 0, fontSize: '0.82rem', color: '#475569', lineHeight: 1.5 }}>
                    {selectedAgent.mission || selectedAgent.system_prompt?.slice(0, 150) + '...'}
                  </p>
                </div>
              )}

              <div className="cw-form-group">
                <label>Primary Campaign Objective</label>
                <textarea 
                  className="cw-textarea"
                  value={campaignForm.objective}
                  onChange={e => setCampaignForm({ ...campaignForm, objective: e.target.value })}
                  placeholder="What is the goal of every outbound call? (e.g. Qualify decision maker, establish interest, book demo link)"
                />
              </div>

              <div className="cw-form-group">
                <label>Campaign Description / Notes (Optional)</label>
                <input 
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
                  disabled={loading || !campaignForm.name.trim() || !campaignForm.agent_id}
                  onClick={handleSaveDraftStep1}
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
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
                  onClick={() => setSourceTab('finder')}
                >
                  <Search size={15} />
                  <span>Clozflow Lead Finder</span>
                </button>
                <button 
                  type="button" 
                  className={`cw-source-tab-btn ${sourceTab === 'upload' ? 'active' : ''}`}
                  onClick={() => setSourceTab('upload')}
                >
                  <FileSpreadsheet size={15} />
                  <span>Upload CSV / Excel (.xlsx)</span>
                </button>
                <button 
                  type="button" 
                  className={`cw-source-tab-btn ${sourceTab === 'manual' ? 'active' : ''}`}
                  onClick={() => setSourceTab('manual')}
                >
                  <Plus size={15} />
                  <span>Manual Lead Entry</span>
                </button>
              </div>

              {uploadFeedback && (
                <div style={{ padding: '12px 16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', color: '#1e40af', fontSize: '0.84rem', marginBottom: '16px' }}>
                  {uploadFeedback}
                </div>
              )}

              {/* TAB 1: Lead Finder */}
              {sourceTab === 'finder' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <span style={{ fontSize: '0.84rem', color: '#64748b' }}>
                      {(Array.isArray(savedLeads) ? savedLeads : []).length} leads found in your Clozflow saved leads vault
                    </span>
                    <button 
                      type="button" 
                      className="cw-btn-back"
                      style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                      onClick={toggleSelectAllLeads}
                    >
                      {selectedLeadIds.size === (Array.isArray(savedLeads) ? savedLeads : []).length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>

                  {loadingLeads ? (
                    <div style={{ textAlign: 'center', padding: '32px' }}>
                      <Loader2 size={24} className="animate-spin" />
                    </div>
                  ) : (Array.isArray(savedLeads) ? savedLeads : []).length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '36px', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                      <p style={{ margin: '0 0 12px 0', color: '#64748b', fontSize: '0.88rem' }}>No saved leads available in Lead Finder.</p>
                      <button type="button" className="cw-btn-back" onClick={() => onNavigateSection && onNavigateSection('home')}>
                        Go to Lead Finder
                      </button>
                    </div>
                  ) : (
                    <div style={{ maxHeight: '280px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '14px' }}>
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
                          {(Array.isArray(savedLeads) ? savedLeads : []).map(l => (
                            <tr key={l.id} onClick={() => toggleLeadSelection(l.id)} style={{ cursor: 'pointer' }}>
                              <td>
                                {selectedLeadIds.has(l.id) ? (
                                  <CheckSquare size={16} color="#2563eb" />
                                ) : (
                                  <Square size={16} color="#94a3b8" />
                                )}
                              </td>
                              <td style={{ fontWeight: 600 }}>{l.business_name}</td>
                              <td>{l.category || l.city || '—'}</td>
                              <td style={{ fontFamily: 'monospace' }}>{l.phone_number || 'No Phone'}</td>
                              <td>{l.lead_score ? `${l.lead_score}%` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {(Array.isArray(savedLeads) ? savedLeads : []).length > 0 && (
                    <button 
                      type="button" 
                      className="cw-btn-primary"
                      disabled={loading || selectedLeadIds.size === 0}
                      onClick={handleImportFromFinder}
                    >
                      <Plus size={15} />
                      <span>Import {selectedLeadIds.size} Selected Leads into Campaign</span>
                    </button>
                  )}
                </div>
              )}

              {/* TAB 2: File Upload */}
              {sourceTab === 'upload' && (
                <div>
                  <label className="cw-dropzone">
                    <input 
                      type="file" 
                      accept=".csv, .xlsx" 
                      style={{ display: 'none' }} 
                      onChange={handleFileUpload}
                      disabled={uploadingFile}
                    />
                    <Upload size={32} color="#2563eb" style={{ margin: '0 auto 12px auto' }} />
                    <h4 style={{ margin: '0 0 4px 0', fontSize: '0.96rem', fontWeight: 600 }}>
                      {uploadingFile ? 'Parsing & Validating Leads...' : 'Click or Drag CSV or Excel (.xlsx) file'}
                    </h4>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748b' }}>
                      Automatic header detection: Name, Phone, Company, Email. Duplicate filtering enabled.
                    </p>
                  </label>
                </div>
              )}

              {/* TAB 3: Manual Entry */}
              {sourceTab === 'manual' && (
                <form onSubmit={handleAddManualLead} style={{ background: '#f8fafc', padding: '18px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                  <div className="cw-grid-2">
                    <div className="cw-form-group">
                      <label>Contact Name</label>
                      <input 
                        type="text" 
                        className="cw-input" 
                        value={manualLead.name}
                        onChange={e => setManualLead({ ...manualLead, name: e.target.value })}
                        placeholder="e.g. Rajesh Mehra"
                      />
                    </div>
                    <div className="cw-form-group">
                      <label>Business / Company Name</label>
                      <input 
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
                      <label>Phone Number (Mandatory E.164)</label>
                      <input 
                        type="text" 
                        className="cw-input" 
                        value={manualLead.phone_number}
                        onChange={e => setManualLead({ ...manualLead, phone_number: e.target.value })}
                        placeholder="e.g. +91 98765 43210"
                        required
                      />
                    </div>
                    <div className="cw-form-group">
                      <label>Email Address (Optional)</label>
                      <input 
                        type="email" 
                        className="cw-input" 
                        value={manualLead.email}
                        onChange={e => setManualLead({ ...manualLead, email: e.target.value })}
                        placeholder="rajesh@apex.in"
                      />
                    </div>
                  </div>
                  <button type="submit" className="cw-btn-primary" disabled={loading}>
                    <Plus size={15} />
                    <span>Add Verified Lead</span>
                  </button>
                </form>
              )}

              {/* MANDATORY REVIEW TABLE */}
              <div style={{ marginTop: '28px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 700 }}>Recipient Validation Review</h4>
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      Review normalization results before campaign launch. Invalid numbers cannot be dialed.
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <span className="cw-badge valid">Valid: {recipientsStats.valid}</span>
                    <span className="cw-badge invalid">Invalid: {recipientsStats.invalid}</span>
                    <span className="cw-badge excluded">Excluded: {recipientsStats.excluded}</span>
                  </div>
                </div>

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
                      {(Array.isArray(recipients) ? recipients : []).length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ textAlign: 'center', padding: '36px', color: '#64748b' }}>
                            No recipients imported yet. Select from Lead Finder, upload a CSV/Excel file, or add manually above.
                          </td>
                        </tr>
                      ) : (
                        (Array.isArray(recipients) ? recipients : []).map(r => (
                          <tr key={r.id}>
                            <td>
                              <input 
                                type="checkbox"
                                checked={r.status === 'valid'}
                                disabled={r.status === 'invalid'}
                                onChange={() => handleToggleRecipientStatus(r)}
                              />
                            </td>
                            <td style={{ fontWeight: 600 }}>{r.name || 'Prospect'}</td>
                            <td>{r.business_name || '—'}</td>
                            <td style={{ color: '#64748b' }}>{r.phone_number}</td>
                            <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                              {r.normalized_phone || <span style={{ color: '#dc2626' }}>Invalid format</span>}
                            </td>
                            <td>
                              <span className={`cw-badge ${r.status}`}>
                                {r.status}
                              </span>
                            </td>
                            <td style={{ fontSize: '0.78rem', color: r.validation_error ? '#b91c1c' : '#15803d' }}>
                              {r.validation_error || 'Verified E.164 destination'}
                            </td>
                            <td>
                              <button 
                                type="button" 
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                                onClick={() => handleDeleteRecipient(r.id)}
                                title="Remove recipient"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="cw-footer-actions">
                <button type="button" className="cw-btn-back" onClick={() => setWizardStep(1)}>
                  <ArrowLeft size={16} />
                  <span>Back to Details</span>
                </button>
                <button 
                  type="button" 
                  className="cw-btn-primary" 
                  disabled={recipientsStats.valid === 0}
                  onClick={handleProceedToStep3}
                >
                  <ArrowRight size={16} />
                  <span>Configure Calling Settings ({recipientsStats.valid} Ready)</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Calling Settings */}
          {wizardStep === 3 && (
            <div className="cw-card">
              <div className="cw-card-header">
                <h3 className="cw-card-title">3. Telephony & Calling Configuration</h3>
                <p className="cw-card-desc">Define calling window, retries, and pacing parameters</p>
              </div>

              <div className="cw-grid-2">
                <div className="cw-form-group">
                  <label>Calling Window Start (Local Time)</label>
                  <input 
                    type="time" 
                    className="cw-input" 
                    value={callSettings.window_start}
                    onChange={e => setCallSettings({ ...callSettings, window_start: e.target.value })}
                  />
                </div>
                <div className="cw-form-group">
                  <label>Calling Window End (Local Time)</label>
                  <input 
                    type="time" 
                    className="cw-input" 
                    value={callSettings.window_end}
                    onChange={e => setCallSettings({ ...callSettings, window_end: e.target.value })}
                  />
                </div>
              </div>

              <div className="cw-grid-2">
                <div className="cw-form-group">
                  <label>Target Timezone</label>
                  <select 
                    className="cw-select"
                    value={callSettings.timezone}
                    onChange={e => setCallSettings({ ...callSettings, timezone: e.target.value })}
                  >
                    <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                    <option value="America/New_York">America/New_York (EST)</option>
                    <option value="Europe/London">Europe/London (GMT)</option>
                    <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                  </select>
                </div>
                <div className="cw-form-group">
                  <label>Max Retry Attempts per Lead</label>
                  <select 
                    className="cw-select"
                    value={callSettings.max_retries}
                    onChange={e => setCallSettings({ ...callSettings, max_retries: parseInt(e.target.value) })}
                  >
                    <option value={1}>1 Attempt (No retries)</option>
                    <option value={2}>2 Attempts</option>
                    <option value={3}>3 Attempts</option>
                  </select>
                </div>
              </div>

              <div className="cw-grid-2">
                <div className="cw-form-group">
                  <label>Retry Interval</label>
                  <select 
                    className="cw-select"
                    value={callSettings.retry_interval_minutes}
                    onChange={e => setCallSettings({ ...callSettings, retry_interval_minutes: parseInt(e.target.value) })}
                  >
                    <option value={15}>15 Minutes</option>
                    <option value={30}>30 Minutes</option>
                    <option value={60}>60 Minutes</option>
                    <option value={120}>2 Hours</option>
                  </select>
                </div>
                <div className="cw-form-group">
                  <label>Concurrent Call Concurrency Limit</label>
                  <select 
                    className="cw-select"
                    value={callSettings.concurrency_limit}
                    onChange={e => setCallSettings({ ...callSettings, concurrency_limit: parseInt(e.target.value) })}
                  >
                    <option value={1}>1 Call at a time (Safe Pacing)</option>
                    <option value={2}>2 Calls in parallel</option>
                    <option value={3}>3 Calls in parallel</option>
                  </select>
                </div>
              </div>

              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '14px 18px', marginTop: '10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <ShieldCheck size={20} color="#16a34a" />
                <div style={{ fontSize: '0.84rem', color: '#15803d' }}>
                  <strong>Authorized Outbound Provider:</strong> Exotel Telephony Engine is verified and active for outbound dialing.
                </div>
              </div>

              <div className="cw-footer-actions">
                <button type="button" className="cw-btn-back" onClick={() => setWizardStep(2)}>
                  <ArrowLeft size={16} />
                  <span>Back to Leads</span>
                </button>
                <button type="button" className="cw-btn-primary" onClick={handleProceedToStep4}>
                  <ArrowRight size={16} />
                  <span>Proceed to Final Review</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: Review & Explicit Launch */}
          {wizardStep === 4 && (
            <div className="cw-card">
              <div className="cw-card-header">
                <h3 className="cw-card-title">4. Pre-Flight Verification & Campaign Launch</h3>
                <p className="cw-card-desc">Carefully review all campaign parameters before initiating real phone calls</p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px', marginBottom: '24px' }}>
                <div style={{ background: '#f8fafc', padding: '18px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, marginBottom: '6px' }}>Campaign & Persona</div>
                  <h4 style={{ margin: '0 0 6px 0', fontSize: '1rem', color: '#0f172a' }}>{campaignForm.name}</h4>
                  <div style={{ fontSize: '0.84rem', color: '#475569' }}>
                    Agent: <strong>{selectedAgent?.name || 'Pearl Agent'}</strong>
                  </div>
                  <div style={{ fontSize: '0.84rem', color: '#475569', marginTop: '4px' }}>
                    Voice: {selectedAgent?.voice_config?.speaker ? selectedAgent.voice_config.speaker.split('_')[0] : 'Shubh'} &bull; Speed: {selectedAgent?.voice_config?.pace || 1.0}x
                  </div>
                </div>

                <div style={{ background: '#f8fafc', padding: '18px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 700, marginBottom: '6px' }}>Dispatch Queue</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#15803d' }}>
                    {recipientsStats.valid} Eligible Leads
                  </div>
                  <div style={{ fontSize: '0.84rem', color: '#64748b', marginTop: '4px' }}>
                    Excluded / Invalid: {recipientsStats.excluded + recipientsStats.invalid} leads
                  </div>
                </div>
              </div>

              <div style={{ background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '8px', padding: '16px', display: 'flex', gap: '14px', alignItems: 'flex-start', marginBottom: '24px' }}>
                <AlertTriangle size={20} color="#d97706" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ fontSize: '0.84rem', color: '#92400e', lineHeight: 1.5 }}>
                  <strong>Explicit Launch Notice:</strong> Launching this campaign will begin automated PSTN dialing to the verified recipients above through the configured Exotel telephony trunk. Each recipient will interact in real-time with Pearl AI according to your selected agent instructions.
                </div>
              </div>

              <div className="cw-footer-actions">
                <button type="button" className="cw-btn-back" onClick={() => setWizardStep(3)}>
                  <ArrowLeft size={16} />
                  <span>Back to Settings</span>
                </button>
                <button 
                  type="button" 
                  className="cw-btn-primary" 
                  style={{ background: '#16a34a', padding: '12px 28px', fontSize: '0.94rem' }}
                  disabled={launching || recipientsStats.valid === 0}
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
                      <span>Launch Campaign ({recipientsStats.valid} Leads)</span>
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
  return (
    <div className="cw-container animate-fade-in">
      <header className="cw-header">
        <div className="cw-header-left" style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
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
        {/* Quick Aggregated KPIs */}
        <div className="cw-kpi-grid">
          <div className="cw-kpi-card">
            <span className="lbl">Total Campaigns</span>
            <div className="val">{campaigns.length}</div>
          </div>
          <div className="cw-kpi-card">
            <span className="lbl">Active Campaigns</span>
            <div className="val" style={{ color: '#2563eb' }}>
              {campaigns.filter(c => c.status === 'running').length}
            </div>
          </div>
          <div className="cw-kpi-card">
            <span className="lbl">Total Leads Dialed</span>
            <div className="val" style={{ color: '#16a34a' }}>
              {campaigns.reduce((acc, c) => acc + (c.metrics?.dialed || 0), 0)}
            </div>
          </div>
          <div className="cw-kpi-card">
            <span className="lbl">Qualified Meetings</span>
            <div className="val" style={{ color: '#9333ea' }}>
              {campaigns.reduce((acc, c) => acc + (c.metrics?.qualified || 0), 0)}
            </div>
          </div>
        </div>

        {/* Campaigns Table / Cards */}
        <div className="cw-card">
          <div className="cw-card-header">
            <h3 className="cw-card-title">All Campaigns</h3>
            <p className="cw-card-desc">Manage, review, monitor, and launch autonomous campaigns</p>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : campaigns.length === 0 ? (
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
                    const dialed = c.metrics?.dialed || 0;
                    const total = c.metrics?.total_recipients || 0;
                    const pct = total > 0 ? Math.round((dialed / total) * 100) : 0;

                    return (
                      <tr key={c.id}>
                        <td>
                          <div style={{ fontWeight: 600, color: '#0f172a' }}>{c.name}</div>
                          <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{c.objective?.slice(0, 50)}...</div>
                        </td>
                        <td>
                          <span style={{ fontWeight: 500 }}>{c.agent_name || 'Assigned Agent'}</span>
                        </td>
                        <td>
                          <span className={`cw-badge ${c.status}`}>
                            {c.status}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontWeight: 600 }}>{total}</span> leads
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '60px', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: '#2563eb' }} />
                            </div>
                            <span style={{ fontSize: '0.76rem', color: '#64748b' }}>{dialed}/{total}</span>
                          </div>
                        </td>
                        <td style={{ fontSize: '0.8rem', color: '#64748b' }}>
                          {c.created_at ? new Date(c.created_at).toLocaleDateString('en-GB') : '—'}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
                            {c.status === 'draft' ? (
                              <button 
                                type="button" 
                                className="cw-btn-primary" 
                                style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                onClick={() => handleEditCampaign(c)}
                              >
                                <span>Configure & Launch</span>
                                <ChevronRight size={14} />
                              </button>
                            ) : (
                              <button 
                                type="button" 
                                className="cw-btn-back" 
                                style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                onClick={() => handleOpenMonitor(c.id)}
                              >
                                <Eye size={14} />
                                <span>Monitor</span>
                              </button>
                            )}
                            <button 
                              type="button" 
                              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '6px' }}
                              onClick={(e) => handleDeleteCampaign(c.id, e)}
                              title="Delete campaign"
                            >
                              <Trash2 size={14} />
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
