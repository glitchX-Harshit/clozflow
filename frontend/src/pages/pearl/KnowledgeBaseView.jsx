import React, { useState, useEffect, useRef } from 'react';
import { 
  Globe, FileText, Plus, ArrowRight, Check, Loader2, RefreshCw, 
  Trash2, Edit3, ShieldCheck, Sparkles, ExternalLink, ChevronRight,
  Database, UploadCloud, AlertCircle, Eye, CheckCircle2, XCircle, ArrowLeft
} from 'lucide-react';
import './KnowledgeBaseView.css';

const DEFAULT_STAGES = [
  { stage: 1, title: 'Connecting to your website', detail: 'Validating host security and SSL certificates' },
  { stage: 2, title: 'Discovering relevant pages', detail: 'Inspecting sitemap and navigation hierarchy' },
  { stage: 3, title: 'Reading business information', detail: 'Parsing company overview, vision, and core mission' },
  { stage: 4, title: 'Understanding products and services', detail: 'Mapping product architecture and capabilities' },
  { stage: 5, title: 'Extracting features and pricing', detail: 'Analyzing pricing tiers, specifications, and plans' },
  { stage: 6, title: 'Identifying target customer segments', detail: 'Profiling ICP, buyer personas, and decision makers' },
  { stage: 7, title: 'Analyzing customer pain points and objections', detail: 'Synthesizing objection battlecards and value pivots' },
  { stage: 8, title: 'Building your Knowledge Capsules', detail: 'Structuring company-wide and product-level intelligence' },
  { stage: 9, title: 'Preparing knowledge for review', detail: 'Finalizing version draft for operator approval' }
];

export const KnowledgeBaseView = ({ user, onNavigateSection }) => {
  // Main view modes: 'landing' | 'analyzing' | 'dashboard'
  const [viewMode, setViewMode] = useState('loading');
  const [activeTab, setActiveTab] = useState('company'); // company | products | customer | sales | pages | versions

  // Landing form states
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [showWebsiteForm, setShowWebsiteForm] = useState(false);
  const [showDocForm, setShowDocForm] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadError, setUploadError] = useState(null);

  // Analysis / Job states
  const [activeJobId, setActiveJobId] = useState(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [currentStage, setCurrentStage] = useState(1);
  const [jobTickerMessage, setJobTickerMessage] = useState('Connecting to source...');
  const [jobError, setJobError] = useState(null);

  // Overview / Dashboard data
  const [overviewData, setOverviewData] = useState(null);
  const [sourcePages, setSourcePages] = useState([]);
  const [editingFactId, setEditingFactId] = useState(null);
  const [editFactValue, setEditFactValue] = useState('');
  const [loadingAction, setLoadingAction] = useState(false);
  const [evidenceModal, setEvidenceModal] = useState(null);

  // Load existing Knowledge Base data
  const loadOverview = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/knowledge/overview`, {
        headers: { Authorization: token ? `Bearer ${token}` : '' }
      });
      if (res.ok) {
        const data = await res.json();
        setOverviewData(data);
        if (data.stats.total_capsules > 0 || data.stats.total_sources > 0) {
          setViewMode('dashboard');
        } else {
          setViewMode('landing');
        }
      } else {
        setViewMode('landing');
      }
    } catch (err) {
      console.error('Failed to load knowledge overview:', err);
      setViewMode('landing');
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  // ── Real-Time SSE Stream Listener ──────────────────────────────────────────
  useEffect(() => {
    if (viewMode !== 'analyzing' || !activeJobId) return;

    let eventSource = null;
    let pollInterval = null;

    try {
      const token = localStorage.getItem('token');
      const streamUrl = `${window.APP_API_BASE || ''}/api/knowledge/jobs/${activeJobId}/stream`;
      
      eventSource = new EventSource(streamUrl);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.progress !== undefined) setJobProgress(data.progress);
          if (data.stage !== undefined) setCurrentStage(data.stage);
          if (data.message) setJobTickerMessage(data.message);

          if (data.status === 'completed') {
            eventSource.close();
            setTimeout(() => {
              loadOverview();
            }, 1200);
          } else if (data.status === 'failed') {
            setJobError(data.error || 'Ingestion encountered an error.');
            eventSource.close();
          }
        } catch (e) {}
      };

      eventSource.onerror = () => {
        // Fallback to polling if SSE fails
        if (eventSource) eventSource.close();
        pollInterval = setInterval(async () => {
          try {
            const res = await fetch(`${window.APP_API_BASE || ''}/api/knowledge/jobs/${activeJobId}`, {
              headers: { Authorization: token ? `Bearer ${token}` : '' }
            });
            if (res.ok) {
              const jdata = await res.json();
              if (jdata.progress) setJobProgress(jdata.progress);
              if (jdata.stage) setCurrentStage(jdata.stage);
              if (jdata.message) setJobTickerMessage(jdata.message);

              if (jdata.status === 'completed') {
                clearInterval(pollInterval);
                loadOverview();
              } else if (jdata.status === 'failed') {
                setJobError(jdata.error || 'Ingestion failed.');
                clearInterval(pollInterval);
              }
            }
          } catch (e) {}
        }, 1500);
      };
    } catch (e) {}

    return () => {
      if (eventSource) eventSource.close();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [viewMode, activeJobId]);

  // ── Trigger Website Crawl ──────────────────────────────────────────────────
  const handleStartWebsiteCrawl = async (e) => {
    e?.preventDefault();
    if (!websiteUrl.trim()) return;

    setUploadError(null);
    setJobError(null);

    let cleanUrl = websiteUrl.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/knowledge/crawl`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ url: cleanUrl })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to start website crawl');
      }

      const data = await res.json();
      setActiveJobId(data.job_id);
      setCurrentStage(1);
      setJobProgress(10);
      setJobTickerMessage(`Connecting to ${cleanUrl}...`);
      setViewMode('analyzing');

    } catch (err) {
      setUploadError(err.message);
    }
  };

  // ── Trigger Document Upload ────────────────────────────────────────────────
  const handleUploadDocuments = async () => {
    if (selectedFiles.length === 0) return;
    setUploadError(null);

    const formData = new FormData();
    for (const f of selectedFiles) {
      formData.append('files', f);
    }

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/knowledge/upload`, {
        method: 'POST',
        headers: { Authorization: token ? `Bearer ${token}` : '' },
        body: formData
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Upload failed');
      }

      const data = await res.json();
      setActiveJobId(data.job_id);
      setCurrentStage(1);
      setJobProgress(15);
      setJobTickerMessage(`Parsing ${selectedFiles.length} business documents...`);
      setViewMode('analyzing');

    } catch (err) {
      setUploadError(err.message);
    }
  };

  // ── Fact Editing & Approval ────────────────────────────────────────────────
  const handleSaveFactEdit = async (factId) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/knowledge/facts/${factId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ value: editFactValue })
      });
      if (res.ok) {
        setEditingFactId(null);
        loadOverview();
      }
    } catch (e) {}
  };

  const handleToggleFactApproval = async (factId, currentStatus) => {
    const nextStatus = currentStatus === 'approved' ? 'rejected' : 'approved';
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/knowledge/facts/${factId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ approval_status: nextStatus })
      });
      if (res.ok) {
        loadOverview();
      }
    } catch (e) {}
  };

  // ── Publish Capsule ────────────────────────────────────────────────────────
  const handlePublishCapsule = async (capsuleId) => {
    setLoadingAction(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/knowledge/capsules/${capsuleId}/publish`, {
        method: 'POST',
        headers: { Authorization: token ? `Bearer ${token}` : '' }
      });
      if (res.ok) {
        loadOverview();
      }
    } catch (e) {
    } finally {
      setLoadingAction(false);
    }
  };

  // ── RENDER: LOADING STATE ──────────────────────────────────────────────────
  if (viewMode === 'loading') {
    return (
      <div className="kb-root" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Loader2 size={24} className="animate-spin" color="#09090b" />
      </div>
    );
  }

  // ── RENDER: REAL-TIME 9-STAGE ANALYSIS (SECTION 8) ─────────────────────────
  if (viewMode === 'analyzing') {
    return (
      <div className="kb-root animate-fade-in">
        <div className="kb-top-bar">
          <div className="kb-breadcrumb">
            <span>Pearl</span>
            <span>/</span>
            <span className="kb-breadcrumb-title">Knowledge Ingestion</span>
          </div>
          <button 
            type="button" 
            className="kb-btn-mini"
            onClick={() => setViewMode('dashboard')}
          >
            Skip to Dashboard &rarr;
          </button>
        </div>

        <div className="kb-analysis-canvas">
          <div className="kb-analysis-hero">
            <div className="kb-analysis-orb">
              <div className="kb-analysis-orb-ripple" />
              <Sparkles size={32} color="#ffffff" />
            </div>

            <h2 className="kb-analysis-title">
              {jobProgress >= 100 ? 'Knowledge Synthesis Complete' : 'Pearl is Learning Your Business'}
            </h2>
            <p className="kb-analysis-ticker">
              {jobTickerMessage}
            </p>

            <div className="kb-progress-bar-wrap">
              <div className="kb-progress-bar-fill" style={{ width: `${jobProgress}%` }} />
            </div>
          </div>

          {jobError && (
            <div style={{ background: '#fef2f2', border: '1px solid #fee2e2', padding: '12px 18px', borderRadius: 10, color: '#b91c1c', marginBottom: '1.5rem', width: '100%' }}>
              <strong>Analysis paused:</strong> {jobError}
            </div>
          )}

          {/* 9 Progressive Stages Card */}
          <div className="kb-stages-card">
            <div className="kb-stages-list">
              {DEFAULT_STAGES.map((s) => {
                const isCompleted = currentStage > s.stage || jobProgress >= 100;
                const isActive = currentStage === s.stage && jobProgress < 100;

                return (
                  <div key={s.stage} className={`kb-stage-row ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}`}>
                    <div className="kb-stage-icon-box">
                      {isCompleted ? <Check size={14} strokeWidth={2.5} /> : isActive ? <Loader2 size={13} className="animate-spin" /> : s.stage}
                    </div>
                    <div className="kb-stage-text-wrap">
                      <span className="kb-stage-title">{s.title}</span>
                      <span className="kb-stage-detail">{s.detail}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {jobProgress >= 100 && (
            <button 
              type="button" 
              className="kb-card-btn primary" 
              style={{ marginTop: '2rem', maxWidth: 280 }}
              onClick={() => setViewMode('dashboard')}
            >
              <span>Review Knowledge Capsules</span>
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── RENDER: LANDING / TEACH PEARL (SECTION 4) ──────────────────────────────
  if (viewMode === 'landing') {
    const extractedDomain = websiteUrl ? websiteUrl.replace(/^https?:\/\//, '').split('/')[0] : '';

    return (
      <div className="kb-root animate-fade-in">
        <div className="kb-top-bar">
          <div className="kb-breadcrumb">
            <span>Pearl</span>
            <span>/</span>
            <span className="kb-breadcrumb-title">Knowledge base</span>
          </div>
          {overviewData?.stats?.total_capsules > 0 && (
            <button 
              type="button" 
              className="kb-btn-mini"
              onClick={() => setViewMode('dashboard')}
            >
              &larr; View Existing Capsules ({overviewData.stats.total_capsules})
            </button>
          )}
        </div>

        <div className="kb-hero-header">
          <h1 className="kb-hero-title">Teach Pearl about your business.</h1>
          <p className="kb-hero-subtitle">
            Connect your website or upload your business documents. Pearl will learn your products, understand your audience and prepare its sales knowledge.
          </p>
        </div>

        {uploadError && (
          <div style={{ maxWidth: 880, margin: '0 auto 1.5rem auto', background: '#fef2f2', border: '1px solid #fee2e2', padding: '10px 16px', borderRadius: 10, color: '#b91c1c', fontSize: '0.88rem' }}>
            <AlertCircle size={15} style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />
            {uploadError}
          </div>
        )}

        <div className="kb-entry-grid">
          {/* OPTION A: IMPORT FROM WEBSITE (RECOMMENDED) */}
          <div className="kb-entry-card recommended">
            <span className="kb-card-badge">Recommended</span>
            <div>
              <div className="kb-card-icon-box">
                <Globe size={24} />
              </div>
              <h3 className="kb-card-title">Import from website</h3>
              <p className="kb-card-desc">
                Let Pearl explore your website and understand your business automatically.
              </p>
            </div>

            {!showWebsiteForm ? (
              <button 
                type="button" 
                className="kb-card-btn primary"
                onClick={() => setShowWebsiteForm(true)}
              >
                <span>Add website</span>
                <ArrowRight size={16} />
              </button>
            ) : (
              <form className="kb-card-form" onSubmit={handleStartWebsiteCrawl}>
                <div className="kb-url-input-wrap">
                  <span className="kb-url-prefix">https://</span>
                  <input 
                    type="text" 
                    className="kb-url-input" 
                    placeholder="example.com"
                    value={websiteUrl.replace(/^https?:\/\//, '')}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    autoFocus
                  />
                </div>

                {extractedDomain && (
                  <div className="kb-domain-badge">
                    <Globe size={12} />
                    <span>Domain: <strong>{extractedDomain}</strong></span>
                  </div>
                )}

                <button 
                  type="submit" 
                  className="kb-card-btn primary"
                  disabled={!websiteUrl.trim()}
                >
                  <span>Start Analysis</span>
                  <ArrowRight size={16} />
                </button>
              </form>
            )}
          </div>

          {/* OPTION B: UPLOAD DOCUMENTS */}
          <div className="kb-entry-card">
            <div>
              <div className="kb-card-icon-box">
                <FileText size={24} />
              </div>
              <h3 className="kb-card-title">Upload documents</h3>
              <p className="kb-card-desc">
                Give Pearl your existing product documents, brochures and business information.
              </p>
            </div>

            {!showDocForm ? (
              <button 
                type="button" 
                className="kb-card-btn secondary"
                onClick={() => setShowDocForm(true)}
              >
                <span>Upload files</span>
                <UploadCloud size={16} />
              </button>
            ) : (
              <div className="kb-card-form">
                <label className="kb-dropzone">
                  <input 
                    type="file" 
                    multiple 
                    accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.json,.txt,.md" 
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files) {
                        setSelectedFiles(Array.from(e.target.files));
                      }
                    }}
                  />
                  <UploadCloud size={24} color="#71717a" style={{ margin: '0 auto 6px auto' }} />
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#09090b' }}>Click or drag files here</div>
                  <div style={{ fontSize: '0.74rem', color: '#71717a', marginTop: 2 }}>
                    PDF, DOCX, XLSX, CSV, JSON, TXT, MD
                  </div>
                </label>

                {selectedFiles.length > 0 && (
                  <div className="kb-files-list">
                    {selectedFiles.map((file, i) => (
                      <div key={i} className="kb-file-item">
                        <span>{file.name}</span>
                        <span style={{ color: '#71717a' }}>{(file.size / 1024).toFixed(0)} KB</span>
                      </div>
                    ))}
                  </div>
                )}

                <button 
                  type="button" 
                  className="kb-card-btn primary"
                  disabled={selectedFiles.length === 0}
                  onClick={handleUploadDocuments}
                >
                  <span>Start Document Processing ({selectedFiles.length})</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── RENDER: DASHBOARD VIEW (SECTION 10) ────────────────────────────────────
  const company = overviewData?.company_capsule;
  const products = overviewData?.product_capsules || [];
  const sources = overviewData?.sources || [];
  const facts = overviewData?.facts || [];

  return (
    <div className="kb-root animate-fade-in">
      <div className="kb-top-bar">
        <div className="kb-breadcrumb">
          <span>Pearl</span>
          <span>/</span>
          <span className="kb-breadcrumb-title">Knowledge Base</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            type="button" 
            className="kb-btn-mini"
            onClick={() => setViewMode('landing')}
          >
            <Plus size={13} style={{ display: 'inline', verticalAlign: -2 }} />
            <span>Add Source</span>
          </button>
          {company && (
            <button 
              type="button" 
              className="kb-card-btn primary"
              style={{ padding: '5px 12px', fontSize: '0.78rem', borderRadius: 6, width: 'auto' }}
              onClick={() => handlePublishCapsule(company.id)}
              disabled={loadingAction}
            >
              <CheckCircle2 size={13} />
              <span>Publish v{company.version || 1}</span>
            </button>
          )}
        </div>
      </div>

      <div className="kb-dashboard-wrap">
        {/* Top Banner with Key Metrics */}
        <div className="kb-dash-banner">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ fontSize: '1.45rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
                {company?.company_name || 'Business Knowledge Base'}
              </h2>
              <span className="kb-pill-badge confirmed">Published</span>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#71717a' }}>
              {sources[0]?.url ? `Connected to ${sources[0].url}` : 'Multi-source business knowledge'} • Last synced: {overviewData?.stats?.last_synced_at ? new Date(overviewData.stats.last_synced_at).toLocaleDateString() : 'Today'}
            </p>
          </div>

          <div className="kb-dash-metrics">
            <div className="kb-metric-item">
              <span className="kb-metric-val">{overviewData?.stats?.total_capsules || 0}</span>
              <span className="kb-metric-label">Capsules</span>
            </div>
            <div className="kb-metric-item">
              <span className="kb-metric-val">{products.length}</span>
              <span className="kb-metric-label">Products</span>
            </div>
            <div className="kb-metric-item">
              <span className="kb-metric-val">{overviewData?.stats?.total_pages || 0}</span>
              <span className="kb-metric-label">Pages Crawled</span>
            </div>
            <div className="kb-metric-item">
              <span className="kb-metric-val">{facts.length}</span>
              <span className="kb-metric-label">Extracted Facts</span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="kb-dash-tabs">
          <button 
            type="button" 
            className={`kb-dash-tab ${activeTab === 'company' ? 'active' : ''}`}
            onClick={() => setActiveTab('company')}
          >
            Company Capsule
          </button>
          <button 
            type="button" 
            className={`kb-dash-tab ${activeTab === 'products' ? 'active' : ''}`}
            onClick={() => setActiveTab('products')}
          >
            Product Capsules ({products.length})
          </button>
          <button 
            type="button" 
            className={`kb-dash-tab ${activeTab === 'customer' ? 'active' : ''}`}
            onClick={() => setActiveTab('customer')}
          >
            Buyer Intelligence
          </button>
          <button 
            type="button" 
            className={`kb-dash-tab ${activeTab === 'sales' ? 'active' : ''}`}
            onClick={() => setActiveTab('sales')}
          >
            Sales Objections
          </button>
          <button 
            type="button" 
            className={`kb-dash-tab ${activeTab === 'sources' ? 'active' : ''}`}
            onClick={() => setActiveTab('sources')}
          >
            Connected Sources ({sources.length})
          </button>
        </div>

        {/* TAB 1: COMPANY CAPSULE */}
        {activeTab === 'company' && company && (
          <div className="kb-section-card">
            <div className="kb-section-title-row">
              <h3 className="kb-section-title">Company-Wide Shared Context</h3>
              <span style={{ fontSize: '0.78rem', color: '#71717a' }}>Version {company.version || 1} • Inherited by all Pearl Agents</span>
            </div>

            <div className="kb-fact-row">
              <span className="kb-fact-field">Company Name</span>
              <span className="kb-fact-value">{company.company_name}</span>
            </div>
            <div className="kb-fact-row">
              <span className="kb-fact-field">Brand Voice Tone</span>
              <span className="kb-fact-value">{company.brand_tone || 'Consultative & Professional'}</span>
            </div>
            <div className="kb-fact-row">
              <span className="kb-fact-field">Business Overview</span>
              <span className="kb-fact-value">{company.overview || 'Enterprise business platform'}</span>
            </div>
            <div className="kb-fact-row">
              <span className="kb-fact-field">Target Audience</span>
              <span className="kb-fact-value">{company.target_audience || 'B2B Buyers'}</span>
            </div>
            <div className="kb-fact-row">
              <span className="kb-fact-field">Key Differentiators</span>
              <span className="kb-fact-value">{company.key_differentiators || 'Proprietary execution'}</span>
            </div>
            <div className="kb-fact-row">
              <span className="kb-fact-field">Pain Points Solved</span>
              <span className="kb-fact-value">{company.pain_points || 'Operational bottlenecks'}</span>
            </div>
          </div>
        )}

        {/* TAB 2: PRODUCT CAPSULES */}
        {activeTab === 'products' && (
          <div className="kb-prods-grid">
            {products.map((p) => (
              <div key={p.id} className="kb-prod-card">
                <div>
                  <div className="kb-prod-header">
                    <h4 className="kb-prod-title">{p.product_name || p.name}</h4>
                    <span className="kb-prod-price">{p.price || 'Custom Quote'}</span>
                  </div>
                  <div className="kb-prod-specs">
                    {p.specs || 'Product specifications & features indexed.'}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #f4f4f5', paddingTop: 10, marginTop: 10 }}>
                  <span style={{ fontSize: '0.72rem', color: '#71717a' }}>v{p.version || 1} • {p.status}</span>
                  <button 
                    type="button" 
                    className="kb-btn-mini"
                    onClick={() => handlePublishCapsule(p.id)}
                  >
                    Publish
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TAB 3: BUYER INTELLIGENCE */}
        {activeTab === 'customer' && (
          <div className="kb-section-card">
            <div className="kb-section-title-row">
              <h3 className="kb-section-title">Verified Customer & Buyer Intelligence</h3>
              <span style={{ fontSize: '0.78rem', color: '#71717a' }}>Fact-checked against source data</span>
            </div>

            {facts.filter(f => f.category === 'business' || f.category === 'customer').map((fact) => (
              <div key={fact.id} className="kb-fact-row">
                <span className="kb-fact-field">{fact.field_name}</span>
                
                {editingFactId === fact.id ? (
                  <div style={{ flex: 1, display: 'flex', gap: 6 }}>
                    <input 
                      type="text" 
                      value={editFactValue} 
                      onChange={e => setEditFactValue(e.target.value)} 
                      style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid #09090b', fontSize: '0.86rem' }} 
                    />
                    <button type="button" className="kb-btn-mini" onClick={() => handleSaveFactEdit(fact.id)}>Save</button>
                    <button type="button" className="kb-btn-mini" onClick={() => setEditingFactId(null)}>Cancel</button>
                  </div>
                ) : (
                  <span className="kb-fact-value">{fact.value}</span>
                )}

                <div className="kb-fact-badges">
                  <span className={`kb-pill-badge ${fact.inference_type === 'observed_fact' ? 'observed' : 'inference'}`}>
                    {fact.inference_type === 'observed_fact' ? 'Observed Fact' : 'AI Inference'}
                  </span>

                  <button 
                    type="button" 
                    className="kb-btn-mini"
                    onClick={() => {
                      setEditingFactId(fact.id);
                      setEditFactValue(fact.value);
                    }}
                  >
                    Edit
                  </button>

                  {fact.source_excerpt && (
                    <button 
                      type="button" 
                      className="kb-btn-mini"
                      onClick={() => setEvidenceModal(fact)}
                      title="Inspect Evidence"
                    >
                      <Eye size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TAB 4: SALES OBJECTIONS */}
        {activeTab === 'sales' && (
          <div className="kb-section-card">
            <div className="kb-section-title-row">
              <h3 className="kb-section-title">Evidence-Backed Objection Handlers & Pivots</h3>
              <span style={{ fontSize: '0.78rem', color: '#71717a' }}>Synthesized for real-time Pearl call execution</span>
            </div>

            {facts.filter(f => f.category === 'sales').map((fact) => (
              <div key={fact.id} className="kb-fact-row">
                <span className="kb-fact-field">{fact.field_name}</span>
                <span className="kb-fact-value">{fact.value}</span>
                <div className="kb-fact-badges">
                  <span className={`kb-pill-badge ${fact.approval_status === 'approved' ? 'confirmed' : 'inference'}`}>
                    {fact.approval_status}
                  </span>
                  <button 
                    type="button" 
                    className="kb-btn-mini"
                    onClick={() => handleToggleFactApproval(fact.id, fact.approval_status)}
                  >
                    {fact.approval_status === 'approved' ? 'Reject' : 'Approve'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TAB 5: CONNECTED SOURCES */}
        {activeTab === 'sources' && (
          <div className="kb-section-card">
            <div className="kb-section-title-row">
              <h3 className="kb-section-title">Connected Ingestion Sources</h3>
              <button 
                type="button" 
                className="kb-btn-mini"
                onClick={() => setViewMode('landing')}
              >
                + Connect Another Source
              </button>
            </div>

            {sources.map((s) => (
              <div key={s.id} className="kb-fact-row" style={{ alignItems: 'center' }}>
                <span className="kb-fact-field" style={{ textTransform: 'uppercase' }}>{s.type}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{s.title}</div>
                  <div style={{ fontSize: '0.76rem', color: '#71717a' }}>{s.url || 'Document Bundle'} • {s.pages_processed || 0} pages indexed</div>
                </div>
                <div className="kb-fact-badges">
                  <span className="kb-pill-badge confirmed">{s.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>

      {/* EVIDENCE INSPECTION MODAL */}
      {evidenceModal && (
        <div 
          style={{ position: 'fixed', inset: 0, background: 'rgba(9,9,11,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999 }}
          onClick={() => setEvidenceModal(null)}
        >
          <div 
            style={{ background: '#ffffff', borderRadius: 14, padding: '1.75rem', maxWidth: 500, width: '90%', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Source Evidence Excerpt</h4>
              <button type="button" className="kb-btn-mini" onClick={() => setEvidenceModal(null)}>Close</button>
            </div>
            <p style={{ fontSize: '0.88rem', color: '#52525b', lineHeight: 1.5, background: '#f4f4f5', padding: '12px', borderRadius: 8, fontStyle: 'italic' }}>
              "{evidenceModal.source_excerpt}"
            </p>
            {evidenceModal.source_url && (
              <a 
                href={evidenceModal.source_url} 
                target="_blank" 
                rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', color: '#09090b', fontWeight: 600, textDecoration: 'none', marginTop: 10 }}
              >
                <span>View Source URL</span>
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default KnowledgeBaseView;
