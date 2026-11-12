import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Phone, Plus, ArrowRight, Check, Copy, Search, ChevronLeft, ChevronRight,
  Clock, RefreshCw, AlertCircle, Loader2
} from 'lucide-react';
import ConnectProviderModal from './components/ConnectProviderModal';
import { ClozFlowTelephonyNode, BringYourOwnTrunkNode } from '../../components/PearlTelephony3DIcon';
import { SALES_ARCHETYPES } from '../../data/salesArchetypes';
import { CLOZFLOW_VOICE_LIST } from '../../components/voiceList';
import { useDashboardStore } from '../../store/useDashboardStore';
import { apiFetch, isAbortError } from './lib/pearlApi';
import { mapCallStatus } from './lib/callStatus';
import { formatDuration, formatRelativeTime, formatServerDateTime } from './lib/dates';
import { agentStatusMeta, formatAgentRole, voiceDisplayName } from './lib/agentCard';
import { buttonRoleProps, useBackdropDismiss, useDialogA11y } from './lib/a11y';
import {
  HOUR_LABELS, agentPickerOptions, bucketCallsByHour, chartAxis,
  displayNameFor, filterAgents, greetingFor, paginate, recentAgents
} from './lib/homeData';
import {
  CALL_LOG_PAGE_SIZE, CALL_STATUS_FILTERS, MAX_CALLS_PAGE, MAX_TODAY_PAGES,
  callsPageInfo, callsQueryPath, fetchCallsSince, normalizeCallsPage, startOfLocalDay
} from './lib/callHistory';
import { filterByCategory, templateCategories } from './lib/homeTemplates';
import { BYOC_CARRIERS, carrierNamesText } from './lib/telephonyCarriers';
import { creditRuleText, formatRupees, pricingRows } from './lib/telephonyRates';
import { DEFAULT_PEARL_SECTION, isPearlSectionId } from './lib/subsectionNav';
import {
  EXAMPLE_CALL_RESPONSE, buildCallSnippet, buildStatusSnippet, copyToClipboard, snippetApiOrigin
} from './lib/subsectionCode';
import './PearlSubSectionView.css';

// Heavy sections load on demand (keeps them out of the Dashboard chunk).
const AgentWorkspace = React.lazy(() => import('./AgentWorkspace'));
const CampaignWorkspace = React.lazy(() => import('./CampaignWorkspace'));
const KnowledgeBaseView = React.lazy(() => import('./KnowledgeBaseView'));

const openDashboardTab = (tab) => useDashboardStore.getState().setActiveTab(tab);

/* ───────────────────────── Shared building blocks ───────────────────────── */

// Retro pixel avatar used by Home recents and templates.
const PIXEL_COLORS = {
  blue:   { bg: '#eff6ff', border: '#dbeafe', icon: '#2563eb', dot: '#3b82f6' },
  green:  { bg: '#f0fdf4', border: '#dcfce7', icon: '#16a34a', dot: '#22c55e' },
  amber:  { bg: '#fffbeb', border: '#fef3c7', icon: '#d97706', dot: '#f59e0b' },
  indigo: { bg: '#eef2ff', border: '#e0e7ff', icon: '#4f46e5', dot: '#6366f1' },
  coral:  { bg: '#fff7ed', border: '#ffedd5', icon: '#ea580c', dot: '#f97316' },
  red:    { bg: '#fef2f2', border: '#fee2e2', icon: '#dc2626', dot: '#ef4444' }
};
const TEMPLATE_COLORS = ['blue', 'green', 'indigo', 'amber', 'coral', 'red'];
const STATUS_TONE_COLOR = { slate: 'indigo', blue: 'blue', green: 'green', amber: 'amber', red: 'red' };

const PixelAvatar = ({ color = 'blue' }) => {
  const theme = PIXEL_COLORS[color] || PIXEL_COLORS.blue;
  return (
    <div
      className="pixel-avatar-box"
      aria-hidden="true"
      style={{
        width: 36, height: 36, borderRadius: 8, background: theme.bg, border: `1px solid ${theme.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.icon,
        position: 'relative', overflow: 'hidden', flexShrink: 0
      }}
    >
      <div style={{ position: 'absolute', top: 0, right: 0, width: 8, height: 8, background: theme.dot, opacity: 0.4 }} />
      <div style={{ position: 'absolute', bottom: 2, left: 2, width: 6, height: 6, background: theme.dot, opacity: 0.3 }} />
      <Phone size={16} strokeWidth={2.2} />
    </div>
  );
};

/** GET `path` (Bearer auth via apiFetch); `status` is loading / ready / error / idle (no path). */
function useApiResource(path) {
  const [nonce, setNonce] = useState(0);
  const key = path ? `${path}#${nonce}` : null;
  const [result, setResult] = useState({ key: null, data: null, error: null });

  useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    apiFetch(path, { signal: controller.signal }).then(
      (data) => setResult({ key, data, error: null }),
      (error) => {
        if (!isAbortError(error)) setResult({ key, data: null, error });
      }
    );
    return () => controller.abort();
  }, [key, path]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const current = key !== null && result.key === key;
  let status = 'idle';
  if (key) status = !current ? 'loading' : result.error ? 'error' : 'ready';
  return { status, data: current ? result.data : null, error: current ? result.error : null, reload };
}

const InlineState = ({ kind = 'info', title, children, onRetry, action }) => (
  <div className={`pearl-inline-state ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
    {kind === 'loading' && <Loader2 size={16} className="pearl-spin" aria-hidden="true" />}
    {(kind === 'error' || kind === 'warning') && <AlertCircle size={16} aria-hidden="true" />}
    <div className="pearl-inline-state-text">
      {title && <strong>{title}</strong>}
      {children && <span>{children}</span>}
    </div>
    {onRetry && (
      <button type="button" className="pearl-state-btn" onClick={onRetry}>
        <RefreshCw size={12} aria-hidden="true" />
        <span>Retry</span>
      </button>
    )}
    {action}
  </div>
);

const errorText = (error, fallback) => (error && typeof error.message === 'string' && error.message) || fallback;

const SectionPage = ({ title, description, actions, children }) => (
  <div className="pearl-home-root animate-fade-in">
    <div className="pearl-top-breadcrumb-bar">
      <span className="breadcrumb-title">{title}</span>
    </div>
    <div className="pearl-subview-wrap">
      <div className="pearl-subview-header">
        <div>
          <h1 className="pearl-subview-title">{title}</h1>
          {description && <p className="pearl-subview-desc">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  </div>
);

const SectionLoading = () => (
  <div className="pearl-section-loading" role="status">
    <Loader2 size={16} className="pearl-spin" aria-hidden="true" />
    <span>Loading…</span>
  </div>
);

class SectionBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('[Pearl] section failed to render:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="pearl-home-root">
        <div className="pearl-subview-wrap">
          <InlineState
            kind="error"
            title="This section couldn't be displayed."
            action={(
              <button type="button" className="pearl-state-btn" onClick={() => window.location.reload()}>
                <RefreshCw size={12} aria-hidden="true" />
                <span>Reload page</span>
              </button>
            )}
          >
            {errorText(this.state.error, 'An unexpected error occurred.')}
          </InlineState>
        </div>
      </div>
    );
  }
}

/* ───────────────────────────────── Home ───────────────────────────────── */

const NO_CALLS = [];

/**
 * Today's calls of all the user's agents (GET /api/pearl/calls, newest first): pages are
 * read until one reaches a call from before local midnight.
 */
function useTodayCalls() {
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState({ nonce: -1, calls: NO_CALLS, capped: false, error: null });

  useEffect(() => {
    const controller = new AbortController();
    const fetchPage = (offset, limit) => apiFetch(callsQueryPath({ limit, offset }), { signal: controller.signal });
    fetchCallsSince(fetchPage, startOfLocalDay()).then(
      ({ calls, capped }) => {
        if (!controller.signal.aborted) setResult({ nonce, calls, capped, error: null });
      },
      (error) => {
        if (!controller.signal.aborted && !isAbortError(error)) setResult({ nonce, calls: NO_CALLS, capped: false, error });
      }
    );
    return () => controller.abort();
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const current = result.nonce === nonce;
  let status = 'loading';
  if (current) status = result.error ? 'error' : 'ready';
  return {
    status,
    calls: current ? result.calls : NO_CALLS,
    capped: current && result.capped,
    error: current ? result.error : null,
    reload
  };
}

const CallsTodayChart = ({ callsState }) => {
  const { counts, total } = useMemo(() => bucketCallsByHour(callsState.calls), [callsState.calls]);
  const axis = chartAxis(counts);
  const ready = callsState.status === 'ready';
  const summary = total === 0
    ? 'No calls today'
    : `Calls today by hour: ${counts.map((n, i) => (n ? `${HOUR_LABELS[i]} ${n}` : null)).filter(Boolean).join(', ')}`;

  return (
    <div className="pearl-home-chart-card">
      <div className="pearl-home-chart-meta">
        <span className="pearl-home-chart-title">Calls today</span>
        <div className="pearl-home-chart-metric">{ready ? total : '—'}</div>
      </div>

      {callsState.status === 'error' && (
        <InlineState kind="error" title="Couldn't load today's calls." onRetry={callsState.reload}>
          {errorText(callsState.error, 'Please try again.')}
        </InlineState>
      )}
      {callsState.status === 'loading' && (
        <InlineState kind="loading">Loading today&apos;s calls…</InlineState>
      )}

      {ready && (
        <>
          <div className="pearl-chart-wrapper" role="img" aria-label={summary}>
            <div className="pearl-chart-y-axis-title" aria-hidden="true">Calls</div>
            <div className="pearl-chart-body" aria-hidden="true">
              <div className="pearl-chart-y-ticks">
                {axis.ticks.map((tick, i) => <span key={i}>{tick}</span>)}
              </div>
              <div className="pearl-chart-plot-area">
                {axis.ticks.map((_, i) => <div key={i} className={`pearl-chart-grid-line tick-${i}`} />)}
                <div className="pearl-chart-bars-row">
                  {HOUR_LABELS.map((hour, idx) => {
                    const count = counts[idx];
                    return (
                      <div key={hour} className="pearl-chart-col">
                        <div className="pearl-chart-bar-slot">
                          {count > 0 && (
                            <div
                              className="pearl-chart-bar-fill"
                              style={{ height: `${(count / axis.max) * 100}%` }}
                              title={`${count} call${count === 1 ? '' : 's'} at ${hour}`}
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
            <div className="pearl-chart-x-axis-subtitle" aria-hidden="true">Hour of day (your local time)</div>
          </div>
          {total === 0 && <p className="pearl-chart-note">No calls placed today yet.</p>}
          {callsState.capped && (
            <p className="pearl-chart-note">
              Counting only the latest {(MAX_TODAY_PAGES * MAX_CALLS_PAGE).toLocaleString('en-IN')} calls placed today.
            </p>
          )}
        </>
      )}
    </div>
  );
};

const HomeSection = ({ user }) => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [templateTab, setTemplateTab] = useState('All');
  const [pageSize, setPageSize] = useState(3);
  const [currentPage, setCurrentPage] = useState(1);

  const agentsRes = useApiResource('/api/pearl/agents');
  const agents = useMemo(() => recentAgents(agentsRes.data), [agentsRes.data]);
  const callsState = useTodayCalls();

  const filtered = useMemo(() => filterAgents(agents, searchQuery), [agents, searchQuery]);
  const page = paginate(filtered, currentPage, pageSize);
  const categories = useMemo(() => templateCategories(SALES_ARCHETYPES), []);
  const templates = filterByCategory(SALES_ARCHETYPES, templateTab);

  const openAgent = (id) => navigate(`/agent-editor/${encodeURIComponent(id)}`);
  const startFromTemplate = (id) => navigate(`/agent-editor/new?archetype=${encodeURIComponent(id)}`);

  let recentsBody;
  if (agentsRes.status === 'loading' || agentsRes.status === 'idle') {
    recentsBody = <div className="pearl-home-empty" role="status">Loading your agents…</div>;
  } else if (agentsRes.status === 'error') {
    recentsBody = (
      <InlineState kind="error" title="Couldn't load your agents." onRetry={agentsRes.reload}>
        {errorText(agentsRes.error, 'Please try again.')}
      </InlineState>
    );
  } else if (agents.length === 0) {
    recentsBody = (
      <div className="pearl-home-empty">
        <p className="pearl-home-empty-title">No agents yet.</p>
        <p>Create your first agent, or start from one of the templates below.</p>
        <button type="button" className="pearl-subview-cta pearl-home-empty-cta" onClick={() => navigate('/agent-editor/new')}>
          <Plus size={15} aria-hidden="true" />
          <span>New agent</span>
        </button>
      </div>
    );
  } else if (page.items.length === 0) {
    recentsBody = <div className="pearl-home-empty">No agents match &ldquo;{searchQuery.trim()}&rdquo;.</div>;
  } else {
    recentsBody = page.items.map((agent) => {
      const status = agentStatusMeta(agent.status);
      const voice = voiceDisplayName(agent.voice_config?.speaker);
      const name = (typeof agent.name === 'string' && agent.name.trim()) || 'Untitled agent';
      const subLine = [formatAgentRole(agent.role), voice ? `${voice} voice` : null, status.label].filter(Boolean).join(' · ');
      const touched = agent.updated_at || agent.created_at;
      return (
        <div
          key={agent.id}
          className="pearl-home-agent-row"
          title={`Open ${name} in the agent editor`}
          {...buttonRoleProps(() => openAgent(agent.id), { label: `Open ${name}` })}
        >
          <div className="agent-info-cell">
            <PixelAvatar color={STATUS_TONE_COLOR[status.tone] || 'blue'} />
            <div className="agent-name-group">
              <span className="agent-name">{name}</span>
              <span className="agent-sub">{subLine}</span>
            </div>
          </div>
          <div className="agent-edited-cell" title={formatServerDateTime(touched)}>
            <span>{formatRelativeTime(touched) || '—'}</span>
          </div>
        </div>
      );
    });
  }

  return (
    <div className="pearl-home-root animate-fade-in">
      <div className="pearl-top-breadcrumb-bar">
        <span className="breadcrumb-title">Home</span>
      </div>

      <div className="pearl-home-canvas">
        <h1 className="pearl-home-greeting">
          {greetingFor()}, {displayNameFor(user)}
        </h1>

        <CallsTodayChart callsState={callsState} />

        {/* Recents */}
        <div className="pearl-home-recents-section">
          <h2 className="pearl-home-recents-title">Recents</h2>

          <div className="pearl-home-search-pill">
            <Search size={14} className="pearl-home-search-icon" aria-hidden="true" />
            <input
              type="text"
              placeholder="Search"
              aria-label="Search your agents"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="pearl-home-search-input"
            />
          </div>

          <div className="pearl-home-table-wrap">
            <div className="pearl-home-table-header">
              <span className="col-agent">Agent</span>
              <span className="col-edited">Last edited</span>
            </div>

            <div className="pearl-home-table-list">{recentsBody}</div>

            {agentsRes.status === 'ready' && agents.length > 0 && (
              <div className="pearl-table-pagination-footer">
                <div className="pagination-page-size">
                  <span>Show</span>
                  <select
                    value={pageSize}
                    aria-label="Agents per page"
                    onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                    className="pagination-select"
                  >
                    <option value={3}>3</option>
                    <option value={6}>6</option>
                    <option value={12}>12</option>
                  </select>
                  <span>Per page</span>
                </div>

                <div className="pagination-arrows-group">
                  <button
                    type="button"
                    className="pagination-nav-btn"
                    aria-label="Previous page"
                    disabled={page.page <= 1}
                    onClick={() => setCurrentPage(Math.max(1, page.page - 1))}
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                  </button>
                  <span className="pagination-count-text">
                    {page.start}-{page.end} of {page.total}
                  </span>
                  <button
                    type="button"
                    className="pagination-nav-btn"
                    aria-label="Next page"
                    disabled={page.page >= page.totalPages}
                    onClick={() => setCurrentPage(Math.min(page.totalPages, page.page + 1))}
                  >
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Agent templates (sales archetypes) */}
        <div className="pearl-home-templates-section">
          <div className="templates-header-row">
            <h2 className="pearl-templates-title">Agent templates</h2>
            <div className="templates-filter-pills" role="group" aria-label="Filter templates by category">
              {categories.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  aria-pressed={templateTab === tab}
                  className={`template-filter-pill ${templateTab === tab ? 'active' : ''}`}
                  onClick={() => setTemplateTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="pearl-templates-grid">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="pearl-template-card"
                title={`Start a new agent from the ${tpl.name} template`}
                {...buttonRoleProps(() => startFromTemplate(tpl.id), { label: `Start a new agent from the ${tpl.name} template` })}
              >
                <div className="template-card-top">
                  <PixelAvatar color={TEMPLATE_COLORS[SALES_ARCHETYPES.indexOf(tpl) % TEMPLATE_COLORS.length]} />
                </div>
                <span className="template-card-category">{tpl.category}</span>
                <h3 className="template-card-title">{tpl.name}</h3>
                <p className="template-card-desc">{tpl.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ─────────────────────────── Phone numbers ─────────────────────────── */

const PricingModal = ({ open, onClose, wallet }) => {
  const { ref, dialogProps } = useDialogA11y(open, onClose);
  const backdrop = useBackdropDismiss(onClose);
  if (!open) return null;
  const rows = pricingRows(wallet.data);

  return (
    <div className="pearl-phone-modal-backdrop" {...backdrop}>
      <div className="pearl-phone-modal-box" ref={ref} {...dialogProps} aria-labelledby="pearl-pricing-title">
        <div className="modal-header">
          <div>
            <h3 className="modal-title" id="pearl-pricing-title">ClozFlow telephony pricing</h3>
            <p className="modal-sub">
              Current rates from your wallet · {creditRuleText(wallet.data)}
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close pricing">✕</button>
        </div>

        <div className="modal-body">
          {wallet.status === 'loading' && <InlineState kind="loading">Loading current rates…</InlineState>}
          {wallet.status === 'error' && (
            <InlineState kind="error" title="Couldn't load the current rates." onRetry={wallet.reload}>
              {errorText(wallet.error, 'Please try again.')}
            </InlineState>
          )}
          {wallet.status === 'ready' && rows.length === 0 && (
            <InlineState>The server didn&apos;t return any rates. Check your wallet for current pricing.</InlineState>
          )}
          {wallet.status === 'ready' && rows.length > 0 && (
            <div className="pricing-table">
              {rows.map((row) => (
                <div key={row.key} className="pricing-row">
                  <span className="p-item">
                    {row.label}
                    {row.note && <span className="p-note">{row.note}</span>}
                  </span>
                  <span className="p-rate">{row.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="phone-btn-dark" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

const PhoneNumbersSection = ({ user }) => {
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const wallet = useApiResource('/api/wallet/balance');
  const rentalAvailable = wallet.status === 'ready' && wallet.data?.phone_rental_available === true;
  const callRate = formatRupees(wallet.data?.rates?.pearl_call_per_minute);
  const fullName = typeof user?.full_name === 'string' ? user.full_name.trim() : '';
  const defaultOrgName = fullName ? `${fullName.split(/\s+/)[0]}'s Organisation` : '';

  return (
    <div className="pearl-home-root phone-numbers-root animate-fade-in">
      <div className="pearl-top-breadcrumb-bar">
        <span className="breadcrumb-title">Phone numbers</span>
      </div>

      <div className="pearl-phone-viewport">
        <div className="pearl-phone-header">
          <h1 className="pearl-phone-hero-title">Take your agent live</h1>
          <p className="pearl-phone-hero-subtitle">
            Pearl calls go out on ClozFlow&apos;s shared lines today. Dedicated numbers and your own carrier are on the way.
          </p>
        </div>

        <div className="pearl-phone-grid">
          {/* Card 1: Rent from ClozFlow */}
          <div className="pearl-phone-card">
            <div className="phone-card-top-icon">
              <ClozFlowTelephonyNode />
            </div>

            <div className="phone-card-title-row">
              <h3 className="phone-card-title">Rent from ClozFlow</h3>
              {wallet.status === 'ready' && !rentalAvailable && <span className="phone-status-pill">Coming soon</span>}
            </div>

            <p className="phone-card-desc">
              {rentalAvailable
                ? 'Dedicated ClozFlow numbers can be rented from your wallet.'
                : "Dedicated ClozFlow numbers aren't available yet. Outbound calls use the shared ClozFlow caller ID meanwhile."}
            </p>

            <ul className="phone-card-checklist">
              <li>
                <Check size={14} className="check-mark" strokeWidth={2.5} aria-hidden="true" />
                <span>Outbound calls work today on the shared ClozFlow caller ID</span>
              </li>
              <li>
                <Check size={14} className="check-mark" strokeWidth={2.5} aria-hidden="true" />
                <span>Billed from your ClozFlow credits{callRate ? ` (${callRate} / min)` : ''}</span>
              </li>
              {!rentalAvailable && (
                <li>
                  <Clock size={14} className="check-mark pending" strokeWidth={2.5} aria-hidden="true" />
                  <span>Dedicated numbers billed monthly — coming soon</span>
                </li>
              )}
            </ul>

            {wallet.status === 'error' && (
              <p className="phone-card-error" role="alert">
                Couldn&apos;t check number availability: {errorText(wallet.error, 'please try again.')}{' '}
                <button type="button" className="phone-link-btn" onClick={wallet.reload}>Retry</button>
              </p>
            )}

            <div className="phone-pricing-row">
              <span>Usage-based pricing &middot; </span>
              <button type="button" onClick={() => setShowPricingModal(true)} className="phone-link-btn">
                View details
              </button>
            </div>

            <div className="phone-card-footer">
              {rentalAvailable ? (
                <button type="button" className="phone-btn-dark" onClick={() => openDashboardTab('wallet')}>
                  <span>Open wallet</span>
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
              ) : (
                <button type="button" className="phone-btn-dark" disabled>
                  <span>Coming soon</span>
                </button>
              )}
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
              <span className="phone-status-pill">On request</span>
            </div>

            <p className="phone-card-desc">
              Already have an {carrierNamesText(BYOC_CARRIERS).replace(' and ', ' or ')} account? Ask our team to set Pearl up on it —
              self-serve setup isn&apos;t available yet.
            </p>

            <ul className="phone-card-checklist">
              <li>
                <Check size={14} className="check-mark" strokeWidth={2.5} aria-hidden="true" />
                <span>Supported carriers: {carrierNamesText(BYOC_CARRIERS)}</span>
              </li>
              <li>
                <Check size={14} className="check-mark" strokeWidth={2.5} aria-hidden="true" />
                <span>No credentials are collected here — we set it up with you</span>
              </li>
              <li>
                <Check size={14} className="check-mark" strokeWidth={2.5} aria-hidden="true" />
                <span>Calls keep using ClozFlow&apos;s lines until then</span>
              </li>
            </ul>

            <div className="phone-providers-grid" aria-label="Supported carriers">
              {BYOC_CARRIERS.map((carrier) => (
                <div key={carrier.id} className="telephony-pill">
                  <span className={`prov-dot ${carrier.id}`} aria-hidden="true">{carrier.dot}</span>
                  <span>{carrier.name}</span>
                </div>
              ))}
            </div>

            <div className="phone-card-footer">
              <button type="button" className="phone-btn-outline" onClick={() => setShowConnectModal(true)}>
                <span>Request setup</span>
                <ArrowRight size={13} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <ConnectProviderModal
        isOpen={showConnectModal}
        onClose={() => setShowConnectModal(false)}
        defaultOrgName={defaultOrgName}
        contactEmail={typeof user?.email === 'string' ? user.email : ''}
      />

      <PricingModal open={showPricingModal} onClose={() => setShowPricingModal(false)} wallet={wallet} />
    </div>
  );
};

/* ─────────────────────────── Deploy with code ─────────────────────────── */

const CodeBlock = ({ label, code, copyKey, copied, onCopy }) => {
  const state = copied?.key === copyKey ? (copied.ok ? 'Copied' : 'Copy failed') : 'Copy';
  return (
    <div className="pearl-code-block">
      <div className="code-header">
        <span>{label}</span>
        <button type="button" onClick={() => onCopy(copyKey, code)} className="code-copy-btn" aria-label={`Copy ${label}`}>
          {state === 'Copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span aria-live="polite">{state}</span>
        </button>
      </div>
      <pre>{code}</pre>
    </div>
  );
};

const DeployCodeSection = ({ onNavigateSection }) => {
  const agentsRes = useApiResource('/api/pearl/agents');
  const agents = useMemo(() => recentAgents(agentsRes.data), [agentsRes.data]);
  const [chosenId, setChosenId] = useState('');
  const [copied, setCopied] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const agentId = agents.some((a) => String(a.id) === chosenId) ? chosenId : (agents[0] ? String(agents[0].id) : '');
  const origin = snippetApiOrigin(window.APP_API_BASE, window.location.origin);
  const callSnippet = buildCallSnippet({ origin, agentId });
  const statusSnippet = buildStatusSnippet({ origin });

  const handleCopy = async (key, text) => {
    const ok = await copyToClipboard(text);
    setCopied({ key, ok });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(null), 2000);
  };

  return (
    <SectionPage
      title="Deploy with code"
      description="Start an outbound call from your own systems with one HTTP request to Pearl's call API."
    >
      <div className="pearl-agent-picker">
        <label htmlFor="pearl-code-agent">Agent</label>
        {agentsRes.status === 'loading' && <span role="status">Loading your agents…</span>}
        {agentsRes.status === 'error' && (
          <InlineState kind="error" title="Couldn't load your agents." onRetry={agentsRes.reload}>
            {errorText(agentsRes.error, 'The snippet below uses a placeholder agent id.')}
          </InlineState>
        )}
        {agentsRes.status === 'ready' && agents.length === 0 && (
          <span>
            You don&apos;t have an agent yet — the snippet uses a placeholder id.{' '}
            <button type="button" className="phone-link-btn" onClick={() => onNavigateSection('agents')}>Create an agent</button>
          </span>
        )}
        {agentsRes.status === 'ready' && agents.length > 0 && (
          <select
            id="pearl-code-agent"
            className="modal-select"
            value={agentId}
            onChange={(e) => setChosenId(e.target.value)}
          >
            {agents.map((a) => (
              <option key={a.id} value={String(a.id)}>
                {(typeof a.name === 'string' && a.name.trim()) || 'Untitled agent'}
              </option>
            ))}
          </select>
        )}
      </div>

      <CodeBlock label="Place a call (cURL)" code={callSnippet} copyKey="call" copied={copied} onCopy={handleCopy} />

      <ul className="pearl-code-notes">
        <li>
          <strong>Authentication:</strong> API keys aren&apos;t available yet. Send the session token of a signed-in
          ClozFlow user as a Bearer token. It expires, so don&apos;t embed it in public or long-running code.
        </li>
        <li>
          <strong>Body:</strong> <code>phone_number</code> is an Indian number (10 digits, with +91 or 0 prefix accepted);
          <code> recipient_name</code> is optional. Add <code>&quot;call_provider&quot;: &quot;vobiz&quot;</code> or
          <code> &quot;exotel&quot;</code> to choose the carrier (default Vobiz).
        </li>
        <li>
          <strong>Billing:</strong> calls are charged from your ClozFlow credits like calls placed in the app
          (402 when the balance is too low).
        </li>
      </ul>

      <p className="pearl-code-caption">Response</p>
      <div className="pearl-code-block">
        <pre>{EXAMPLE_CALL_RESPONSE}</pre>
      </div>
      <p className="pearl-code-hint">
        <code>&quot;simulated&quot;: true</code> (with a <code>provider_call_id</code> starting with <code>sim-</code>) means this
        server has no telephony configured: nothing was dialled and the call stays <code>initiating</code>, so don&apos;t poll it.
      </p>

      <CodeBlock label="Check the call status (cURL)" code={statusSnippet} copyKey="status" copied={copied} onCopy={handleCopy} />
      <p className="pearl-code-hint">
        <code>status</code> moves through <code>queued</code> → <code>initiating</code> → <code>ringing</code> →
        <code> active</code> (connected) and ends as <code>completed</code>, <code>busy</code>, <code>no_answer</code>,
        <code> failed</code> or <code>cancelled</code>. Cancel a call with <code>POST /api/pearl/calls/&lt;CALL_ID&gt;/cancel</code>.
      </p>
    </SectionPage>
  );
};

/* ──────────────────────────────── Call logs ──────────────────────────────── */

const PHASE_BADGE = { completed: 'active', failed: 'tone-red', cancelled: '', connected: 'tone-blue', ringing: 'tone-amber', dialing: 'tone-amber' };
const humanize = (value) => {
  const text = String(value ?? '').trim().replace(/[_-]+/g, ' ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
};

/** Every call of the user's agents, newest first, one server page at a time (GET /api/pearl/calls). */
const CallLogsSection = () => {
  const agentsRes = useApiResource('/api/pearl/agents');
  const options = useMemo(() => agentPickerOptions(agentsRes.data), [agentsRes.data]);
  const agentLabels = useMemo(() => new Map(options.map((o) => [o.id, o.label])), [options]);
  const [chosenId, setChosenId] = useState(''); // '' = all agents
  const [statusFilter, setStatusFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const agentId = options.some((o) => o.id === chosenId) ? chosenId : '';
  const callsRes = useApiResource(callsQueryPath({ limit: CALL_LOG_PAGE_SIZE, offset, agentId, status: statusFilter }));
  const page = normalizeCallsPage(callsRes.data);
  const info = callsPageInfo(page);
  const filtered = Boolean(agentId || statusFilter);

  const chooseAgent = (id) => {
    setChosenId(id);
    setOffset(0);
  };
  const chooseStatus = (id) => {
    setStatusFilter(id);
    setOffset(0);
  };

  let body;
  if (callsRes.status === 'loading' || callsRes.status === 'idle') {
    body = <InlineState kind="loading">Loading calls…</InlineState>;
  } else if (callsRes.status === 'error') {
    body = (
      <InlineState kind="error" title="Couldn't load your calls." onRetry={callsRes.reload}>
        {errorText(callsRes.error, 'Please try again.')}
      </InlineState>
    );
  } else if (page.calls.length === 0 && offset > 0 && page.total > 0) {
    body = (
      <InlineState
        action={(
          <button type="button" className="pearl-state-btn" onClick={() => setOffset(0)}>
            <span>First page</span>
          </button>
        )}
      >
        No calls on this page any more.
      </InlineState>
    );
  } else if (page.calls.length === 0) {
    body = (
      <InlineState>
        {filtered ? 'No calls match these filters.' : 'No calls yet — calls appear here once an agent has placed one.'}
      </InlineState>
    );
  } else {
    body = (
      <>
        <div className="pearl-table-card">
          <table className="pearl-subview-table">
            <thead>
              <tr>
                <th scope="col">WHEN</th>
                {!agentId && <th scope="col">AGENT</th>}
                <th scope="col">LEAD</th>
                <th scope="col">STATUS</th>
                <th scope="col">DURATION</th>
                <th scope="col">OUTCOME</th>
                <th scope="col">CARRIER</th>
                <th scope="col">BILLED</th>
              </tr>
            </thead>
            <tbody>
              {page.calls.map((call) => {
                const status = mapCallStatus(call.status, { errorCode: call.error_code });
                const billed = Number(call.revenue_billed);
                return (
                  <tr key={call.id}>
                    <td>{formatServerDateTime(call.created_at) || '—'}</td>
                    {!agentId && <td>{agentLabels.get(String(call.agent_id)) || call.agent_name || '—'}</td>}
                    <td>{call.lead_name || '—'}</td>
                    <td>
                      <span className={`pearl-clean-badge ${PHASE_BADGE[status.phase] || ''}`} title={status.reason || undefined}>
                        {status.label}
                      </span>
                    </td>
                    <td>{call.duration_seconds === null || call.duration_seconds === undefined ? '—' : formatDuration(call.duration_seconds)}</td>
                    <td>{humanize(call.outcome) || '—'}</td>
                    <td>{humanize(call.provider) || '—'}</td>
                    <td>{Number.isFinite(billed) && billed > 0 ? formatRupees(billed) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="pearl-table-pagination-footer">
          <span className="pagination-count-text" aria-live="polite">{info.label}</span>
          {(info.hasPrev || info.hasNext) && (
            <div className="pagination-arrows-group">
              <button
                type="button"
                className="pagination-nav-btn"
                aria-label="Previous page"
                disabled={!info.hasPrev}
                onClick={() => setOffset(Math.max(0, offset - CALL_LOG_PAGE_SIZE))}
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="pagination-nav-btn"
                aria-label="Next page"
                disabled={!info.hasNext}
                onClick={() => setOffset(offset + CALL_LOG_PAGE_SIZE)}
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <SectionPage
      title="Call logs"
      description="Status, duration, outcome and cost of every call your agents have placed, newest first."
    >
      <div className="pearl-agent-picker">
        <label htmlFor="pearl-calllog-agent">Agent</label>
        <select
          id="pearl-calllog-agent"
          className="modal-select"
          value={agentId}
          onChange={(e) => chooseAgent(e.target.value)}
        >
          <option value="">All agents</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <label htmlFor="pearl-calllog-status">Status</label>
        <select
          id="pearl-calllog-status"
          className="modal-select"
          value={statusFilter}
          onChange={(e) => chooseStatus(e.target.value)}
        >
          {CALL_STATUS_FILTERS.map((f) => <option key={f.id || 'all'} value={f.id}>{f.label}</option>)}
        </select>
        {callsRes.status === 'ready' && (
          <button type="button" className="pearl-state-btn neutral" onClick={callsRes.reload}>
            <RefreshCw size={12} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        )}
      </div>
      {agentsRes.status === 'error' && (
        <InlineState kind="warning" title="Couldn't load your agents." onRetry={agentsRes.reload}>
          Calls of all agents are listed; filtering by agent needs the agent list.
        </InlineState>
      )}
      {body}
    </SectionPage>
  );
};

/* ──────────────────────────────── Usage ──────────────────────────────── */

const UsageSection = () => {
  const wallet = useApiResource('/api/wallet/balance');
  const rates = wallet.data?.rates || {};
  const balance = wallet.data?.is_unlimited ? 'Unlimited' : formatRupees(wallet.data?.credit_balance);

  return (
    <SectionPage
      title="Usage & credits"
      description="Pearl calls and browser test sessions are paid from your ClozFlow wallet."
      actions={(
        <button type="button" className="pearl-subview-cta" onClick={() => openDashboardTab('wallet')}>
          <span>Open wallet</span>
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      )}
    >
      {wallet.status === 'loading' && <InlineState kind="loading">Loading your wallet…</InlineState>}
      {wallet.status === 'error' && (
        <InlineState kind="error" title="Couldn't load your wallet." onRetry={wallet.reload}>
          {errorText(wallet.error, 'Please try again.')}
        </InlineState>
      )}
      {wallet.status === 'ready' && (
        <>
          <div className="pearl-subview-grid">
            <div className="pearl-kpi-card">
              <span className="kpi-label">Credit balance</span>
              <div className="kpi-val">{balance || '—'}</div>
              <span className="kpi-note">{creditRuleText(wallet.data)}</span>
            </div>
            <div className="pearl-kpi-card">
              <span className="kpi-label">Pearl call rate</span>
              <div className="kpi-val">{formatRupees(rates.pearl_call_per_minute) || '—'}</div>
              <span className="kpi-note">per minute, all-inclusive</span>
            </div>
            <div className="pearl-kpi-card">
              <span className="kpi-label">Test session</span>
              <div className="kpi-val">{formatRupees(rates.test_simulation) || '—'}</div>
              <span className="kpi-note">per browser test session</span>
            </div>
          </div>
          <p className="pearl-chart-note">Every charge is listed in your wallet&apos;s transaction history.</p>
        </>
      )}
    </SectionPage>
  );
};

/* ───────────────────────── Informational sections ───────────────────────── */

const ComingSoonSection = ({ title, description, today, actionLabel, onAction }) => (
  <SectionPage title={title} description={description}>
    <div className="pearl-list-card">
      <div className="card-top-row">
        <span className="pearl-clean-badge soon">Coming soon</span>
      </div>
      <h3>Not available yet</h3>
      <p>{today}</p>
      {actionLabel && (
        <div className="pearl-card-actions">
          <button type="button" className="phone-btn-outline" onClick={onAction}>
            <span>{actionLabel}</span>
            <ArrowRight size={13} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  </SectionPage>
);

const InfoCard = ({ title, children, actions }) => (
  <div className="pearl-list-card">
    <h3>{title}</h3>
    <p>{children}</p>
    {actions && <div className="pearl-card-actions">{actions}</div>}
  </div>
);

const LinkButton = ({ label, onClick }) => (
  <button type="button" className="phone-btn-outline" onClick={onClick}>
    <span>{label}</span>
    <ArrowRight size={13} aria-hidden="true" />
  </button>
);

const SettingsSection = ({ go }) => (
  <SectionPage title="Settings" description="Where Pearl's settings live today.">
    <div className="pearl-cards-list">
      <InfoCard title="Agent behaviour" actions={<LinkButton label="Open agents" onClick={() => go('agents')} />}>
        Voice, language, call-cut rules and other behaviour are configured per agent in the agent editor.
      </InfoCard>
      <InfoCard
        title="Account & billing"
        actions={(
          <>
            <LinkButton label="Account settings" onClick={() => openDashboardTab('settings')} />
            <LinkButton label="Wallet" onClick={() => openDashboardTab('wallet')} />
          </>
        )}
      >
        Profile, notifications and credits are managed in your ClozFlow account.
      </InfoCard>
      <InfoCard title="Telephony" actions={<LinkButton label="Phone numbers" onClick={() => go('phone_numbers')} />}>
        Calls are placed through ClozFlow&apos;s own Vobiz and Exotel lines; carrier settings can&apos;t be changed here.
        To use your own carrier account, request a setup from Phone numbers.
      </InfoCard>
    </div>
  </SectionPage>
);

const McpSection = ({ go }) => (
  <SectionPage title="MCP (Model Context Protocol)" description="Give an agent tools served by an MCP server.">
    <div className="pearl-cards-list">
      <InfoCard title="Per-agent MCP tools" actions={<LinkButton label="Open agents" onClick={() => go('agents')} />}>
        Open an agent in the editor, go to Tools → Add tool and choose MCP to bind tools from your MCP server to that agent.
      </InfoCard>
      <div className="pearl-list-card">
        <div className="card-top-row">
          <span className="pearl-clean-badge soon">Coming soon</span>
        </div>
        <h3>Workspace MCP servers</h3>
        <p>A shared list of MCP servers for all your agents isn&apos;t available yet.</p>
      </div>
    </div>
  </SectionPage>
);

const WhatsNewSection = ({ go }) => (
  <SectionPage title="What's new" description="What you can do with Pearl today.">
    <div className="pearl-cards-list">
      <InfoCard title="Agent templates" actions={<LinkButton label="Browse templates" onClick={() => go('home')} />}>
        Start an agent from one of {SALES_ARCHETYPES.length} sales templates with greeting, variables and objection playbooks pre-filled.
      </InfoCard>
      <InfoCard title="Voice personas">
        Choose from {CLOZFLOW_VOICE_LIST.length} Indian voice personas across Hindi, English and regional languages.
      </InfoCard>
      <InfoCard title="Knowledge base" actions={<LinkButton label="Open knowledge base" onClick={() => go('knowledge')} />}>
        Teach Pearl about your business from your website or documents (PDF, DOCX, XLSX, CSV, JSON, TXT, Markdown, HTML).
      </InfoCard>
      <InfoCard title="Outbound campaigns" actions={<LinkButton label="Open campaigns" onClick={() => go('outbound')} />}>
        Import recipients from a CSV / Excel file or from Lead Finder and let an agent call them.
      </InfoCard>
    </div>
  </SectionPage>
);

const DocumentationSection = ({ go }) => (
  <SectionPage title="Documentation" description="Getting started with Pearl voice agents.">
    <ol className="pearl-doc-steps">
      <li>
        <strong>Create an agent.</strong> Agents → New agent, or start from a template on Home.
        <div className="pearl-card-actions"><LinkButton label="Agents" onClick={() => go('agents')} /></div>
      </li>
      <li>
        <strong>Add knowledge.</strong> Import your website or documents in Knowledge base, then pick it in the agent.
        <div className="pearl-card-actions"><LinkButton label="Knowledge base" onClick={() => go('knowledge')} /></div>
      </li>
      <li>
        <strong>Test in the browser.</strong> Use &ldquo;Test agent&rdquo; in the editor. Each test session is charged from your
        credits — see Usage for the current rate.
        <div className="pearl-card-actions"><LinkButton label="Usage" onClick={() => go('usage')} /></div>
      </li>
      <li>
        <strong>Place calls.</strong> One at a time from the Dialpad on the Agents page, many with Outbound campaigns, or from
        your own systems with the call API.
        <div className="pearl-card-actions">
          <LinkButton label="Outbound campaigns" onClick={() => go('outbound')} />
          <LinkButton label="Deploy with code" onClick={() => go('deploy_code')} />
        </div>
      </li>
    </ol>
  </SectionPage>
);

/* ──────────────────────────────── Router ──────────────────────────────── */

export const PearlSubSectionView = ({ section = DEFAULT_PEARL_SECTION, onNavigateSection, user }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = location.state;
  const requestedSection = routeState && typeof routeState === 'object' ? routeState.pearlSubTab : undefined;

  // Deep link: navigate('/dashboard', { state: { pearlSubTab: 'knowledge' } }) opens that section once.
  useEffect(() => {
    if (requestedSection === undefined) return;
    if (isPearlSectionId(requestedSection) && typeof onNavigateSection === 'function') {
      onNavigateSection(requestedSection);
    }
    const rest = { ...routeState };
    delete rest.pearlSubTab;
    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: Object.keys(rest).length ? rest : null
    });
  }, [requestedSection, routeState, location.pathname, location.search, location.hash, navigate, onNavigateSection]);

  const go = useCallback((id) => {
    if (typeof onNavigateSection === 'function') onNavigateSection(id);
  }, [onNavigateSection]);

  let content;
  switch (section) {
    case 'home':
      content = <HomeSection user={user} />;
      break;
    case 'knowledge':
      content = <KnowledgeBaseView user={user} onNavigateSection={onNavigateSection} />;
      break;
    case 'outbound':
      content = <CampaignWorkspace onNavigateSection={onNavigateSection} />;
      break;
    case 'phone_numbers':
      content = <PhoneNumbersSection user={user} />;
      break;
    case 'deploy_code':
      content = <DeployCodeSection onNavigateSection={go} />;
      break;
    case 'call_logs':
      content = <CallLogsSection />;
      break;
    case 'usage':
      content = <UsageSection />;
      break;
    case 'settings':
      content = <SettingsSection go={go} />;
      break;
    case 'mcp':
      content = <McpSection go={go} />;
      break;
    case 'whats_new':
      content = <WhatsNewSection go={go} />;
      break;
    case 'documentation':
      content = <DocumentationSection go={go} />;
      break;
    case 'workflows':
      content = (
        <ComingSoonSection
          title="Workflows"
          description="Reusable conversation flows: branches, objection-handling sequences and booking triggers."
          today="Today each agent's conversation is defined by its instructions and settings in the agent editor."
          actionLabel="Open agents"
          onAction={() => go('agents')}
        />
      );
      break;
    case 'inbound':
      content = (
        <ComingSoonSection
          title="Inbound calls"
          description="Let Pearl answer calls to your numbers and qualify callers."
          today="Pearl places outbound calls only for now — inbound answering and dedicated numbers aren't available yet."
          actionLabel="Outbound campaigns"
          onAction={() => go('outbound')}
        />
      );
      break;
    case 'agent_analytics':
      content = (
        <ComingSoonSection
          title="Agent analytics"
          description="Latency, objection-recovery and booking metrics per agent."
          today="Until analytics ship, every call's status, duration, outcome and cost is listed in Call logs."
          actionLabel="Open call logs"
          onAction={() => go('call_logs')}
        />
      );
      break;
    case 'boards':
      content = (
        <ComingSoonSection
          title="Boards"
          description="A pipeline board of the prospects your agents have qualified."
          today="Campaign results — each recipient's call status and outcome — are in Outbound campaigns."
          actionLabel="Open campaigns"
          onAction={() => go('outbound')}
        />
      );
      break;
    case 'agents':
    default:
      content = <AgentWorkspace onNavigateSection={onNavigateSection} />;
  }

  return (
    <SectionBoundary key={section}>
      <Suspense fallback={<SectionLoading />}>
        {content}
      </Suspense>
    </SectionBoundary>
  );
};

export default PearlSubSectionView;
