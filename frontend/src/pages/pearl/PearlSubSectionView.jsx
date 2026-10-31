import React, { useState, useMemo, useEffect } from 'react';
import { 
  Bot, Phone, Workflow, BookOpen, Megaphone, Code, 
  BarChart3, Kanban, List, Sparkles, Plus, ArrowRight, ArrowLeft,
  ShieldCheck, Activity, Copy, Check, ExternalLink, Play,
  Search, Settings, Layers, CircleDot, CreditCard, FileText,
  ChevronDown, ChevronLeft, ChevronRight, PhoneIncoming
} from 'lucide-react';
import Pearl from '../Pearl';
import AgentWorkspace from './AgentWorkspace';
import CampaignWorkspace from './CampaignWorkspace';
import KnowledgeBaseView from './KnowledgeBaseView';
import { ClozFlowTelephonyNode, BringYourOwnTrunkNode } from '../../components/PearlTelephony3DIcon';
import './PearlSubSectionView.css';

// Retro Pixel Avatar Component matching Image 1 & 2
const PixelAvatar = ({ color = 'blue' }) => {
  const colorMap = {
    blue:   { bg: '#eff6ff', border: '#dbeafe', icon: '#2563eb', dot: '#3b82f6' },
    green:  { bg: '#f0fdf4', border: '#dcfce7', icon: '#16a34a', dot: '#22c55e' },
    amber:  { bg: '#fffbeb', border: '#fef3c7', icon: '#d97706', dot: '#f59e0b' },
    indigo: { bg: '#eef2ff', border: '#e0e7ff', icon: '#4f46e5', dot: '#6366f1' },
    coral:  { bg: '#fff7ed', border: '#ffedd5', icon: '#ea580c', dot: '#f97316' },
    red:    { bg: '#fef2f2', border: '#fee2e2', icon: '#dc2626', dot: '#ef4444' }
  };
  const theme = colorMap[color] || colorMap.blue;

  return (
    <div 
      className="pixel-avatar-box"
      style={{
        width: 36,
        height: 36,
        borderRadius: 8,
        background: theme.bg,
        border: `1px solid ${theme.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: theme.icon,
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0
      }}
    >
      <div 
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 8,
          height: 8,
          background: theme.dot,
          opacity: 0.4
        }} 
      />
      <div 
        style={{
          position: 'absolute',
          bottom: 2,
          left: 2,
          width: 6,
          height: 6,
          background: theme.dot,
          opacity: 0.3
        }} 
      />
      <Phone size={16} strokeWidth={2.2} />
    </div>
  );
};

// Terracotta Mosaic Icon matching Phone Numbers reference screenshot
const TerracottaMosaicIcon = () => (
  <svg width="42" height="42" viewBox="0 0 42 42" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="42" height="42" rx="10" fill="#FFF7ED" stroke="#FED7AA" strokeWidth="1" />
    <rect x="11" y="13" width="7" height="7" rx="1.5" fill="#EA580C" opacity="0.85" />
    <rect x="20" y="13" width="7" height="7" rx="1.5" fill="#C2410C" />
    <rect x="11" y="22" width="7" height="7" rx="1.5" fill="#9A3412" />
    <rect x="20" y="22" width="7" height="7" rx="1.5" fill="#EA580C" opacity="0.75" />
    {/* Micro details */}
    <rect x="17" y="9" width="4" height="3" rx="0.75" fill="#EA580C" />
    <rect x="29" y="16" width="3" height="10" rx="0.75" fill="#FB923C" opacity="0.6" />
  </svg>
);

// Green Mosaic Icon matching Phone Numbers reference screenshot
const GreenMosaicIcon = () => (
  <svg width="42" height="42" viewBox="0 0 42 42" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="42" height="42" rx="10" fill="#F0FDF4" stroke="#BBF7D0" strokeWidth="1" />
    <rect x="11" y="13" width="7" height="7" rx="1.5" fill="#16A34A" />
    <rect x="20" y="13" width="7" height="7" rx="1.5" fill="#15803D" opacity="0.8" />
    <rect x="11" y="22" width="7" height="7" rx="1.5" fill="#15803D" />
    <rect x="20" y="22" width="7" height="7" rx="1.5" fill="#22C55E" opacity="0.9" />
    {/* Micro details */}
    <rect x="13" y="9" width="4" height="3" rx="0.75" fill="#16A34A" />
    <rect x="25" y="9" width="4" height="3" rx="0.75" fill="#16A34A" />
    <rect x="29" y="16" width="3" height="10" rx="0.75" fill="#4ADE80" opacity="0.6" />
  </svg>
);

export const PearlSubSectionView = ({ section = 'agents', onNavigateSection, user }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTemplateTab, setActiveTemplateTab] = useState('All');
  const [pageSize, setPageSize] = useState(3);
  const [currentPage, setCurrentPage] = useState(1);
  const [copiedCode, setCopiedCode] = useState(false);

  // Phone Numbers Modal States & 3D WebGL Hover States
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showKycModal, setShowKycModal] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState('exotel');
  const [connectSuccess, setConnectSuccess] = useState(false);
  const [phoneCard1Hovered, setPhoneCard1Hovered] = useState(false);
  const [phoneCard2Hovered, setPhoneCard2Hovered] = useState(false);

  if (section === 'agents') {
    return <AgentWorkspace onNavigateSection={onNavigateSection} />;
  }

  // Greeting helper for Home tab
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const displayName = user?.name || user?.username || 'Harshit Chaudhary';

  // 1. Home / Overview — Exactly matching the user's reference images
  if (section === 'home') {
    const hours = [
      '12AM', '1AM', '2AM', '3AM', '4AM', '5AM', '6AM', '7AM', 
      '8AM', '9AM', '10AM', '12PM', '1PM', '2PM', '3PM', '4PM', 
      '5PM', '6PM', '7PM', '8PM', '9PM', '10PM', '11PM'
    ];

    // Bars at: 12AM (0), 8AM (8), 9AM (9), 10PM (21), 11PM (22)
    const activeBarIndices = new Set([0, 8, 9, 21, 22]);

    const allRecentAgents = [
      {
        id: 'agent-1',
        name: 'harshit_011122',
        email: 'hc5764802@gmail.com',
        color: 'blue',
        lastEdited: '2h ago'
      },
      {
        id: 'agent-2',
        name: 'harshit_011122',
        email: 'hc5764802@gmail.com',
        color: 'blue',
        lastEdited: '3h ago'
      },
      {
        id: 'agent-3',
        name: 'Oatish Cafe Outreach',
        email: 'hc5764802@gmail.com',
        color: 'amber',
        lastEdited: '1d ago'
      },
      {
        id: 'agent-4',
        name: 'B2B Demo Booker',
        email: 'hc5764802@gmail.com',
        color: 'green',
        lastEdited: '2d ago'
      },
      {
        id: 'agent-5',
        name: 'EMI Recovery Desk',
        email: 'hc5764802@gmail.com',
        color: 'indigo',
        lastEdited: '3d ago'
      },
      {
        id: 'agent-6',
        name: 'SaaS Inbound Reception',
        email: 'hc5764802@gmail.com',
        color: 'coral',
        lastEdited: '4d ago'
      }
    ];

    const filteredAgents = allRecentAgents.filter(a => 
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      a.email.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const totalPages = Math.ceil(filteredAgents.length / pageSize) || 1;
    const paginatedAgents = filteredAgents.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    // Template Cards Grid from Image 2
    const templates = [
      {
        id: 'tpl-1',
        category: 'Lead qualification',
        color: 'blue',
        title: 'Appointment management',
        desc: 'Turn customer calls into instant bookings, reschedules, and confirmations with an AI voice agent.'
      },
      {
        id: 'tpl-2',
        category: 'Lead qualification',
        color: 'green',
        title: 'Sales discovery',
        desc: 'Meet Ananya: the AI voice agent that turns warm leads into booked meetings.'
      },
      {
        id: 'tpl-3',
        category: 'Recovery',
        color: 'indigo',
        title: 'EMI Collection',
        desc: 'An AI collections agent that manages EMI reminders and simplifies customer payments'
      },
      {
        id: 'tpl-4',
        category: 'Collections',
        color: 'amber',
        title: 'Inbound customer care',
        desc: 'Resolve common FAQs, process order status inquiries, and escalate complex requests.'
      },
      {
        id: 'tpl-5',
        category: 'Reminder',
        color: 'coral',
        title: 'Feedback & Survey collector',
        desc: 'Gather authentic NPS and post-call feedback with human-like conversation.'
      },
      {
        id: 'tpl-6',
        category: 'Lead qualification',
        color: 'red',
        title: 'Lead qualification closer',
        desc: 'Autonomous qualification agent for high-velocity SDR outbound pipeline.'
      }
    ];

    const filteredTemplates = activeTemplateTab === 'All' 
      ? templates 
      : templates.filter(t => t.category.toLowerCase() === activeTemplateTab.toLowerCase());

    return (
      <div className="pearl-home-root animate-fade-in">
        {/* Top Breadcrumb Bar matching Image 1 */}
        <div className="pearl-top-breadcrumb-bar">
          <span className="breadcrumb-title">Home</span>
        </div>

        {/* Main Content Area */}
        <div className="pearl-home-canvas">
          {/* Editorial Greeting matching main web app serif font */}
          <h1 className="pearl-home-greeting">
            {getGreeting()}, {displayName}
          </h1>

          {/* Telemetry Chart Card */}
          <div className="pearl-home-chart-card">
            <div className="pearl-home-chart-meta">
              <span className="pearl-home-chart-title">Total Live calls</span>
              <div className="pearl-home-chart-metric">11</div>
            </div>

            {/* Bar Chart Container */}
            <div className="pearl-chart-wrapper">
              <div className="pearl-chart-y-axis-title">Connectivity Rate (%)</div>

              <div className="pearl-chart-body">
                {/* Y-Axis Ticks */}
                <div className="pearl-chart-y-ticks">
                  <span>105</span>
                  <span>60</span>
                  <span>30</span>
                  <span>0</span>
                </div>

                {/* Grid Lines & Bars Area */}
                <div className="pearl-chart-plot-area">
                  <div className="pearl-chart-grid-line line-105" />
                  <div className="pearl-chart-grid-line line-60" />
                  <div className="pearl-chart-grid-line line-30" />
                  <div className="pearl-chart-grid-line line-0" />

                  {/* Bars Column Flex */}
                  <div className="pearl-chart-bars-row">
                    {hours.map((hour, idx) => {
                      const isActive = activeBarIndices.has(idx);
                      return (
                        <div key={hour} className="pearl-chart-col">
                          <div className="pearl-chart-bar-slot">
                            {isActive && (
                              <div 
                                className="pearl-chart-bar-fill" 
                                title={`Connectivity Rate: 105% at ${hour}`}
                              />
                            )}
                          </div>
                          <span className="pearl-chart-x-label">{hour}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="pearl-chart-x-axis-subtitle">Hour of Day</div>
            </div>
          </div>

          {/* Recents Section */}
          <div className="pearl-home-recents-section">
            <h2 className="pearl-home-recents-title">Recents</h2>

            {/* Pill Search Input */}
            <div className="pearl-home-search-pill">
              <Search size={14} className="pearl-home-search-icon" />
              <input 
                type="text" 
                placeholder="Search" 
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                className="pearl-home-search-input"
              />
            </div>

            {/* Recents Table / List */}
            <div className="pearl-home-table-wrap">
              <div className="pearl-home-table-header">
                <span className="col-agent">Agent</span>
                <span className="col-edited">Last edited</span>
              </div>

              <div className="pearl-home-table-list">
                {paginatedAgents.length === 0 ? (
                  <div className="pearl-home-empty">No matching agents found.</div>
                ) : (
                  paginatedAgents.map((item) => (
                    <div 
                      key={item.id} 
                      className="pearl-home-agent-row"
                      onClick={() => onNavigateSection('agents')}
                      title="Click to launch Agent Cockpit"
                    >
                      <div className="agent-info-cell">
                        <PixelAvatar color={item.color} />
                        <div className="agent-name-group">
                          <span className="agent-name">{item.name}</span>
                          <span className="agent-sub">{item.email}</span>
                        </div>
                      </div>

                      <div className="agent-edited-cell">
                        <span>{item.lastEdited}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Table Pagination Footer matching Image 2 */}
              <div className="pearl-table-pagination-footer">
                <div className="pagination-page-size">
                  <span>Show</span>
                  <select 
                    value={pageSize} 
                    onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                    className="pagination-select"
                  >
                    <option value={3}>3</option>
                    <option value={6}>6</option>
                  </select>
                  <span>Per page</span>
                </div>

                <div className="pagination-arrows-group">
                  <button 
                    type="button" 
                    className="pagination-nav-btn"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="pagination-count-text">
                    {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, filteredAgents.length)} of {filteredAgents.length}
                  </span>
                  <button 
                    type="button" 
                    className="pagination-nav-btn"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Agent Templates Section matching Image 2 */}
          <div className="pearl-home-templates-section">
            <div className="templates-header-row">
              <h2 className="pearl-templates-title">Agent templates</h2>
              
              {/* Category Filter Pills */}
              <div className="templates-filter-pills">
                {['All', 'Collections', 'Reminder', 'Recovery', 'Lead qualification'].map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={`template-filter-pill ${activeTemplateTab === tab ? 'active' : ''}`}
                    onClick={() => setActiveTemplateTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {/* Template Cards 3-column Grid */}
            <div className="pearl-templates-grid">
              {filteredTemplates.map((tpl) => (
                <div 
                  key={tpl.id} 
                  className="pearl-template-card"
                  onClick={() => onNavigateSection('agents')}
                  title={`Launch ${tpl.title} template in Agent Cockpit`}
                >
                  <div className="template-card-top">
                    <PixelAvatar color={tpl.color} />
                  </div>
                  <h3 className="template-card-title">{tpl.title}</h3>
                  <p className="template-card-desc">{tpl.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2. Workflows
  if (section === 'workflows') {
    return (
      <div className="pearl-home-root animate-fade-in">
        <div className="pearl-top-breadcrumb-bar">
          <span className="breadcrumb-title">Workflows</span>
        </div>
        <div className="pearl-subview-wrap">
          <div className="pearl-subview-header">
            <div>
              <h1 className="pearl-subview-title">Workflows</h1>
              <p className="pearl-subview-desc">
                Define the conversational branches, objection handling sequences, and meeting booking triggers.
              </p>
            </div>
            <button type="button" className="pearl-subview-cta">
              <Plus size={15} />
              <span>New Workflow</span>
            </button>
          </div>

          <div className="pearl-cards-list">
            <div className="pearl-list-card">
              <div className="card-top-row">
                <span className="pearl-clean-badge active">Operational</span>
                <span className="card-spec">Updated 2h ago</span>
              </div>
              <h3>Outbound Enterprise Qualification V1</h3>
              <p>Pitch introduction &rarr; Role qualification &rarr; Pain diagnosis &rarr; Calendar booking.</p>
              <div className="card-tags">
                <span>4 Logic Nodes</span>
                <span>Objection Bypass Enabled</span>
                <span>Instant Google Calendar Link</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3. Knowledge Base — Automated Ingestion & Business Intelligence
  if (section === 'knowledge') {
    return <KnowledgeBaseView user={user} onNavigateSection={onNavigateSection} />;
  }

  // 4. Phone Numbers — Exactly matching reference screenshot
  if (section === 'phone_numbers') {
    return (
      <div className="pearl-home-root phone-numbers-root animate-fade-in">
        {/* Top Breadcrumb Bar */}
        <div className="pearl-top-breadcrumb-bar">
          <span className="breadcrumb-title">Phone numbers</span>
        </div>

        <div className="pearl-phone-viewport">
          <div className="pearl-phone-header">
            <h1 className="pearl-phone-hero-title">Take your agent live</h1>
            <p className="pearl-phone-hero-subtitle">
              Provision managed virtual numbers or integrate your existing carrier trunks
            </p>
          </div>

          {/* Two Cards Grid */}
          <div className="pearl-phone-grid">
            {/* Card 1: Rent from ClozFlow */}
            <div className="pearl-phone-card">
              <div className="phone-card-top-icon">
                <ClozFlowTelephonyNode />
              </div>

              <div className="phone-card-title-row">
                <h3 className="phone-card-title">Rent from ClozFlow</h3>
                <span className="phone-kyc-pill">KYC in progress</span>
              </div>

              <p className="phone-card-desc">
                Pick up where you left off and finish verification to buy numbers.
              </p>

              <ul className="phone-card-checklist">
                <li>
                  <Check size={14} className="check-mark" strokeWidth={2.5} />
                  <span>Add or release numbers anytime</span>
                </li>
                <li>
                  <Check size={14} className="check-mark" strokeWidth={2.5} />
                  <span>Buy numbers directly, billed through ClozFlow Credits</span>
                </li>
                <li>
                  <Check size={14} className="check-mark" strokeWidth={2.5} />
                  <span>Set up fully managed telephony infra in 2 minutes</span>
                </li>
              </ul>

              <div className="phone-pricing-row">
                <span>Usage-based pricing &middot; </span>
                <button 
                  type="button" 
                  onClick={() => setShowPricingModal(true)} 
                  className="phone-link-btn"
                >
                  View details
                </button>
              </div>

              <div className="phone-card-footer">
                <button 
                  type="button" 
                  className="phone-btn-dark"
                  onClick={() => setShowKycModal(true)}
                >
                  <span>Resume KYC</span>
                  <ArrowRight size={13} />
                </button>
                <span className="phone-powered-by">Powered by Vobiz</span>
              </div>
            </div>

            {/* Card 2: Bring your own telephony */}
            <div className="pearl-phone-card">
              <div className="phone-card-top-icon">
                <BringYourOwnTrunkNode />
              </div>

              <div className="phone-card-title-row">
                <h3 className="phone-card-title">Bring your own telephony</h3>
              </div>

              <p className="phone-card-desc">
                Connect a telephony provider you already use and import your phone numbers.
              </p>

              <ul className="phone-card-checklist">
                <li>
                  <Check size={14} className="check-mark" strokeWidth={2.5} />
                  <span>Works with 6 leading providers</span>
                </li>
                <li>
                  <Check size={14} className="check-mark" strokeWidth={2.5} />
                  <span>Integrate your existing telephony instantly</span>
                </li>
                <li>
                  <Check size={14} className="check-mark" strokeWidth={2.5} />
                  <span>Keep your current numbers and rates</span>
                </li>
              </ul>

              {/* Provider Badges */}
              <div className="phone-providers-grid">
                <div className="telephony-pill">
                  <span className="prov-dot exotel">&times;</span>
                  <span>Exotel</span>
                </div>
                <div className="telephony-pill">
                  <span className="prov-dot smartflo">&bull;</span>
                  <span>Smartflo</span>
                </div>
                <div className="telephony-pill">
                  <Activity size={11} className="prov-pulse-icon" />
                  <span>Pulse</span>
                </div>
                <div className="telephony-pill">
                  <span className="prov-dot intalk">intalk</span>
                  <span>InTalk</span>
                </div>
                <div className="telephony-pill">
                  <span className="prov-dot vobiz">Y</span>
                  <span>Vobiz</span>
                </div>
                <div className="telephony-pill">
                  <span className="prov-dot twilio">::</span>
                  <span>Twilio</span>
                </div>
              </div>

              <div className="phone-card-footer">
                <button 
                  type="button" 
                  className="phone-btn-outline"
                  onClick={() => setShowConnectModal(true)}
                >
                  <span>Connect</span>
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Modal 1: KYC Verification ── */}
        {showKycModal && (
          <div className="pearl-phone-modal-backdrop" onClick={() => setShowKycModal(false)}>
            <div className="pearl-phone-modal-box" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <h3 className="modal-title">ClozFlow Telephony KYC</h3>
                  <p className="modal-sub">DoT & TRAI Telephony Regulatory Compliance</p>
                </div>
                <button type="button" className="modal-close-btn" onClick={() => setShowKycModal(false)}>✕</button>
              </div>

              <div className="modal-body">
                <div className="kyc-status-banner">
                  <div className="status-orb" />
                  <div>
                    <span className="status-label">Carrier Verification In Progress</span>
                    <p className="status-desc">Estimated completion: ~2 hours. Your enterprise documents are being verified by Vobiz telecom gateway.</p>
                  </div>
                </div>

                <div className="modal-form-grid">
                  <div className="form-field">
                    <label>Enterprise Legal Entity</label>
                    <input type="text" readOnly value="ClozFlow Technologies Pvt Ltd" className="modal-input read-only" />
                  </div>
                  <div className="form-field">
                    <label>GSTIN / Corporate Identification</label>
                    <input type="text" readOnly value="27AABCU9603R1ZM" className="modal-input read-only" />
                  </div>
                  <div className="form-field">
                    <label>Authorized Signatory</label>
                    <input type="text" readOnly value={displayName} className="modal-input read-only" />
                  </div>
                  <div className="form-field">
                    <label>Assigned Trunk Route</label>
                    <input type="text" readOnly value="National E.164 +91 Mobile & PSTN" className="modal-input read-only" />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="phone-btn-dark" onClick={() => setShowKycModal(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Modal 2: Connect BYOT Telephony ── */}
        {showConnectModal && (
          <div className="pearl-phone-modal-backdrop" onClick={() => setShowConnectModal(false)}>
            <div className="pearl-phone-modal-box" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <h3 className="modal-title">Connect Telephony Provider</h3>
                  <p className="modal-sub">Import your existing carrier numbers and SIP trunks</p>
                </div>
                <button type="button" className="modal-close-btn" onClick={() => setShowConnectModal(false)}>✕</button>
              </div>

              <div className="modal-body">
                {connectSuccess ? (
                  <div className="modal-success-state">
                    <div className="success-icon-wrap">✓</div>
                    <h4>Telephony Trunk Connected!</h4>
                    <p>Your Exotel PRI line (+91 98765 43210) is active and assigned to Pearl.</p>
                  </div>
                ) : (
                  <div className="modal-form-grid">
                    <div className="form-field">
                      <label>Select Telephony Provider</label>
                      <select 
                        value={selectedProvider} 
                        onChange={e => setSelectedProvider(e.target.value)}
                        className="modal-select"
                      >
                        <option value="exotel">Exotel (Recommended for India)</option>
                        <option value="twilio">Twilio (Global SIP Trunk)</option>
                        <option value="smartflo">Tata Smartflo</option>
                        <option value="pulse">Pulse</option>
                        <option value="intalk">InTalk</option>
                        <option value="vobiz">Vobiz</option>
                      </select>
                    </div>
                    <div className="form-field">
                      <label>Account SID / API Key</label>
                      <input type="text" placeholder="e.g. exo_acc_89a7f3..." className="modal-input" />
                    </div>
                    <div className="form-field">
                      <label>API Secret / Auth Token</label>
                      <input type="password" placeholder="••••••••••••••••••••" className="modal-input" />
                    </div>
                    <div className="form-field">
                      <label>Caller ID Number (E.164)</label>
                      <input type="text" placeholder="+91 98765 43210" className="modal-input" />
                    </div>
                  </div>
                )}
              </div>

              <div className="modal-footer">
                {connectSuccess ? (
                  <button type="button" className="phone-btn-dark" onClick={() => { setConnectSuccess(false); setShowConnectModal(false); }}>
                    Done
                  </button>
                ) : (
                  <button type="button" className="phone-btn-dark" onClick={() => setConnectSuccess(true)}>
                    Connect Provider
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Modal 3: Pricing Details ── */}
        {showPricingModal && (
          <div className="pearl-phone-modal-backdrop" onClick={() => setShowPricingModal(false)}>
            <div className="pearl-phone-modal-box" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <h3 className="modal-title">ClozFlow Telephony Pricing</h3>
                  <p className="modal-sub">Transparent usage-based rates billed directly via ClozFlow Credits</p>
                </div>
                <button type="button" className="modal-close-btn" onClick={() => setShowPricingModal(false)}>✕</button>
              </div>

              <div className="modal-body">
                <div className="pricing-table">
                  <div className="pricing-row">
                    <span className="p-item">Inbound Calls (All India)</span>
                    <span className="p-rate">₹0.40 / minute</span>
                  </div>
                  <div className="pricing-row">
                    <span className="p-item">Outbound Calls (Mobile / Landline)</span>
                    <span className="p-rate">₹0.85 / minute</span>
                  </div>
                  <div className="pricing-row">
                    <span className="p-item">Dedicated Virtual Indian DID</span>
                    <span className="p-rate">₹499 / month</span>
                  </div>
                  <div className="pricing-row">
                    <span className="p-item">Telephony Setup Fee</span>
                    <span className="p-rate" style={{ color: '#059669', fontWeight: 600 }}>₹0 (Free)</span>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="phone-btn-dark" onClick={() => setShowPricingModal(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 5. Inbound Calls
  if (section === 'inbound') {
    return (
      <div className="pearl-home-root animate-fade-in">
        <div className="pearl-top-breadcrumb-bar">
          <span className="breadcrumb-title">Inbound calls</span>
        </div>
        <div className="pearl-subview-wrap">
          <div className="pearl-subview-header">
            <div>
              <h1 className="pearl-subview-title">Inbound calls</h1>
              <p className="pearl-subview-desc">
                Direct incoming customer inquiries to Pearl for instant sub-second qualification and call triage.
              </p>
            </div>
          </div>
          <div className="pearl-list-card">
            <div className="card-top-row">
              <span className="pearl-clean-badge active">Enabled</span>
              <span className="card-spec">Sub-450ms Answer</span>
            </div>
            <h3>24/7 Virtual Receptionist Flow</h3>
            <p>Instant greeting &rarr; Caller inquiry recognition &rarr; Knowledge lookup &rarr; Rep handoff.</p>
            <div className="card-tags">
              <span>Business Hours Override</span>
              <span>SMS Follow-up</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (section === 'outbound') {
    return <CampaignWorkspace onNavigateSection={onNavigateSection} />;
  }

  // 7. Deploy with Code
  if (section === 'deploy_code') {
    const handleCopy = () => {
      navigator.clipboard?.writeText(`curl -X POST "${window.location.origin}/api/pearl/deploy" \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer YOUR_API_TOKEN" \\\n  -d '{\n    "phone_number": "+919876543210",\n    "objective": "Qualify & Book Demo",\n    "voice_speaker": "ritu"\n  }'`);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    };

    return (
      <div className="pearl-home-root animate-fade-in">
        <div className="pearl-top-breadcrumb-bar">
          <span className="breadcrumb-title">Deploy with code</span>
        </div>
        <div className="pearl-subview-wrap">
          <div className="pearl-subview-header">
            <div>
              <h1 className="pearl-subview-title">Deploy with code</h1>
              <p className="pearl-subview-desc">
                Trigger autonomous outbound sales calls programmatically via REST API or WebSocket stream.
              </p>
            </div>
          </div>

          <div className="pearl-code-block">
            <div className="code-header">
              <span>cURL Outbound Trigger</span>
              <button type="button" onClick={handleCopy} className="code-copy-btn">
                {copiedCode ? <Check size={14} /> : <Copy size={14} />}
                <span>{copiedCode ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre>
{`curl -X POST "${window.location.origin}/api/pearl/deploy" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  -d '{
    "phone_number": "+919876543210",
    "objective": "Qualify & Book Demo",
    "voice_speaker": "ritu",
    "voice_language": "Auto",
    "voice_pace": 1.0
  }'`}
            </pre>
          </div>
        </div>
      </div>
    );
  }

  // 8. Agent Analytics
  if (section === 'agent_analytics') {
    return (
      <div className="pearl-home-root animate-fade-in">
        <div className="pearl-top-breadcrumb-bar">
          <span className="breadcrumb-title">Agent analytics</span>
        </div>
        <div className="pearl-subview-wrap">
          <div className="pearl-subview-header">
            <div>
              <h1 className="pearl-subview-title">Agent analytics</h1>
              <p className="pearl-subview-desc">
                Voice turnaround latency, objection recovery percentage, and demo conversion metrics.
              </p>
            </div>
          </div>

          <div className="pearl-subview-grid">
            <div className="pearl-kpi-card">
              <span className="kpi-label">Speech-To-Speech Latency</span>
              <div className="kpi-val">420ms</div>
              <span className="kpi-note">ClozFlow Neural Voice WebSocket Pipeline</span>
            </div>
            <div className="pearl-kpi-card">
              <span className="kpi-label">Objection Recovery</span>
              <div className="kpi-val">74.2%</div>
              <span className="kpi-note">Price & Timing Objections Handled</span>
            </div>
            <div className="pearl-kpi-card">
              <span className="kpi-label">Meeting Booking Rate</span>
              <div className="kpi-val">38.5%</div>
              <span className="kpi-note">Average on Cold Calls</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 9. Boards
  if (section === 'boards') {
    return (
      <div className="pearl-home-root animate-fade-in">
        <div className="pearl-top-breadcrumb-bar">
          <span className="breadcrumb-title">Boards</span>
        </div>
        <div className="pearl-subview-wrap">
          <div className="pearl-subview-header">
            <div>
              <h1 className="pearl-subview-title">Boards</h1>
              <p className="pearl-subview-desc">
                Pipeline Kanban tracking prospect stages qualified autonomously by Pearl.
              </p>
            </div>
          </div>

          <div className="pearl-subview-grid">
            <div className="pearl-kpi-card">
              <span className="kpi-label">Meeting Secured</span>
              <div className="kpi-val" style={{ color: '#059669' }}>18 Prospects</div>
              <span className="kpi-note">Ready for Closer Demo</span>
            </div>
            <div className="pearl-kpi-card">
              <span className="kpi-label">Warm Callback</span>
              <div className="kpi-val">12 Prospects</div>
              <span className="kpi-note">Requested Callback Call</span>
            </div>
            <div className="pearl-kpi-card">
              <span className="kpi-label">Disqualified</span>
              <div className="kpi-val">7 Prospects</div>
              <span className="kpi-note">Budget / Tech Mismatch</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 10. Call Logs
  if (section === 'call_logs') {
    return (
      <div className="pearl-home-root animate-fade-in">
        <div className="pearl-top-breadcrumb-bar">
          <span className="breadcrumb-title">Call logs</span>
        </div>
        <div className="pearl-subview-wrap">
          <div className="pearl-subview-header">
            <div>
              <h1 className="pearl-subview-title">Call logs</h1>
              <p className="pearl-subview-desc">
                Review full audio recordings, conversation transcripts, and qualification outcomes.
              </p>
            </div>
          </div>

          <div className="pearl-table-card">
            <table className="pearl-subview-table">
              <thead>
                <tr>
                  <th>TARGET</th>
                  <th>VOICE PERSONA</th>
                  <th>DURATION</th>
                  <th>OUTCOME</th>
                  <th>LATENCY</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>+91 99999 88888</strong></td>
                  <td>Ritu (ClozFlow Voice)</td>
                  <td>2m 14s</td>
                  <td><span className="pearl-clean-badge active">Demo Booked</span></td>
                  <td>412ms</td>
                </tr>
                <tr>
                  <td><strong>+91 98888 77777</strong></td>
                  <td>Aditya (ClozFlow Voice)</td>
                  <td>1m 45s</td>
                  <td><span className="pearl-clean-badge active">Callback Agreed</span></td>
                  <td>435ms</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // 11. Utilities (What's new, Settings, MCP, Usage, Pricing, Documentation)
  if (section === 'whats_new') {
    return (
      <div className="pearl-home-root animate-fade-in">
        <div className="pearl-top-breadcrumb-bar">
          <span className="breadcrumb-title">What's new</span>
        </div>
        <div className="pearl-subview-wrap">
          <div className="pearl-subview-header">
            <div>
              <h1 className="pearl-subview-title">What's new</h1>
              <p className="pearl-subview-desc">Latest improvements, engine upgrades, and release highlights.</p>
            </div>
          </div>
          <div className="pearl-list-card">
            <div className="card-top-row">
              <span className="pearl-clean-badge active">Version 3.2</span>
              <span className="card-spec">Today</span>
            </div>
            <h3>ClozFlow Neural Voice Engine & Minimal Persona Selector</h3>
            <p>Integrated all Indian voice identities (Ritu, Aditya, Pooja, Rohan, etc.) with sub-500ms real-time conversational streaming and smooth dropdown navigation.</p>
          </div>
        </div>
      </div>
    );
  }

  if (section === 'settings') {
    return (
      <div className="pearl-home-root animate-fade-in">
        <div className="pearl-top-breadcrumb-bar">
          <span className="breadcrumb-title">Settings</span>
        </div>
        <div className="pearl-subview-wrap">
          <div className="pearl-subview-header">
            <div>
              <h1 className="pearl-subview-title">Settings</h1>
              <p className="pearl-subview-desc">Configure carrier SIP trunks, Exotel API keys, and voice latency parameters.</p>
            </div>
          </div>
          <div className="pearl-list-card">
            <h3>Exotel Telephony Configuration</h3>
            <p>Trunk status: Connected · Audio Format: 8kHz PCM linear · Sub-second WebSocket streaming.</p>
          </div>
        </div>
      </div>
    );
  }

  if (section === 'mcp') {
    return (
      <div className="pearl-home-root animate-fade-in">
        <div className="pearl-top-breadcrumb-bar">
          <span className="breadcrumb-title">MCP</span>
        </div>
        <div className="pearl-subview-wrap">
          <div className="pearl-subview-header">
            <div>
              <h1 className="pearl-subview-title">MCP (Model Context Protocol)</h1>
              <p className="pearl-subview-desc">Connect external MCP tool servers for live database lookups and CRM actions.</p>
            </div>
          </div>
          <div className="pearl-list-card">
            <div className="card-top-row">
              <span className="pearl-clean-badge active">Connected</span>
            </div>
            <h3>ClozFlow CRM MCP Server</h3>
            <p>Provides live lead enrichment, deal status sync, and real-time meeting booking tools to Pearl.</p>
          </div>
        </div>
      </div>
    );
  }

  if (section === 'usage') {
    return (
      <div className="pearl-home-root animate-fade-in">
        <div className="pearl-top-breadcrumb-bar">
          <span className="breadcrumb-title">Usage</span>
        </div>
        <div className="pearl-subview-wrap">
          <div className="pearl-subview-header">
            <div>
              <h1 className="pearl-subview-title">Usage & Quotas</h1>
              <p className="pearl-subview-desc">Track telephony minutes, voice synthesis tokens, and concurrent lines.</p>
            </div>
          </div>
          <div className="pearl-subview-grid">
            <div className="pearl-kpi-card">
              <span className="kpi-label">Minutes Used</span>
              <div className="kpi-val">142 / 10,000</div>
              <span className="kpi-note">Refreshes next billing cycle</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (section === 'pricing') {
    return (
      <div className="pearl-home-root animate-fade-in">
        <div className="pearl-top-breadcrumb-bar">
          <span className="breadcrumb-title">Pricing</span>
        </div>
        <div className="pearl-subview-wrap">
          <div className="pearl-subview-header">
            <div>
              <h1 className="pearl-subview-title">Pricing & Subscriptions</h1>
              <p className="pearl-subview-desc">Flexible plans for high-growth sales teams and autonomous caller fleets.</p>
            </div>
          </div>
          <div className="pearl-list-card">
            <div className="card-top-row">
              <span className="pearl-clean-badge active">Active Tier</span>
            </div>
            <h3>Enterprise Fleet Plan</h3>
            <p>Unlimited concurrent outbound lines, dedicated Exotel PRI trunk, and custom voice persona fine-tuning.</p>
          </div>
        </div>
      </div>
    );
  }

  if (section === 'documentation') {
    return (
      <div className="pearl-home-root animate-fade-in">
        <div className="pearl-top-breadcrumb-bar">
          <span className="breadcrumb-title">Documentation</span>
        </div>
        <div className="pearl-subview-wrap">
          <div className="pearl-subview-header">
            <div>
              <h1 className="pearl-subview-title">Documentation</h1>
              <p className="pearl-subview-desc">Developer guides, WebSocket specifications, and sales objection playbooks.</p>
            </div>
          </div>
          <div className="pearl-list-card">
            <h3>Pearl Autonomous Agent Architecture Guide</h3>
            <p>Read about state machines, interruption detection (VAD), and ClozFlow Neural Voice text-to-speech integration.</p>
          </div>
        </div>
      </div>
    );
  }

  return <Pearl />;
};

export default PearlSubSectionView;
