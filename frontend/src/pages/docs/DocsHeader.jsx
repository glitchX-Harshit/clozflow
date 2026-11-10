import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ExternalLink, Menu, X, ArrowLeft } from 'lucide-react';
import ClozFlowLogo from '../../components/ClozFlowLogo';

export default function DocsHeader({
  activeTopicId,
  onSelectTopic,
  onOpenSearch,
  mobileSidebarOpen,
  onToggleMobileSidebar
}) {
  const navigate = useNavigate();

  // Top Nav Items mapping to primary documentation sections
  const topNavTabs = [
    { label: 'Overview', targetId: 'overview' },
    { label: 'Model APIs', targetId: 'models-overview' },
    { label: 'Voice Agents', targetId: 'voice-agents' },
    { label: 'API Reference', targetId: 'api-voice-synthesize' },
    { label: 'Changelog', targetId: 'changelog' }
  ];

  return (
    <header className="docs-header">
      <div className="docs-header__left">
        {/* Mobile menu toggle: lg:hidden ensures tablet/iPad users (768px-1024px) have menu control */}
        <button
          type="button"
          className="docs-header__mobile-toggle lg:hidden"
          onClick={onToggleMobileSidebar}
          aria-label="Toggle navigation menu"
        >
          {mobileSidebarOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        {/* ClozFlow Brand & Docs Version */}
        <div className="docs-header__brand-wrap">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
            className="flex items-center gap-2"
          >
            <ClozFlowLogo size={22} className="docs-logo" />
          </a>
          <span className="docs-header__version-pill">Docs v2.4</span>
        </div>

        {/* Top Categorical Nav Tabs (Sarvam AI style) */}
        <nav className="docs-header__nav-tabs hidden lg:flex" aria-label="Documentation Sections">
          {topNavTabs.map((tab) => {
            const isActive =
              (tab.targetId === 'overview' && ['overview', 'quickstart', 'auth', 'architecture'].includes(activeTopicId)) ||
              (tab.targetId === 'models-overview' && ['models-overview', 'kiki-v1-flash', 'kiki-v2-pro', 'language-matrix', 'latency-benchmarks'].includes(activeTopicId)) ||
              (tab.targetId === 'voice-agents' && ['voice-agents', 'sales-capsules', 'interruption-vad', 'dynamic-variables', 'campaigns-dialer', 'telephony-setup'].includes(activeTopicId)) ||
              (tab.targetId === 'api-voice-synthesize' && (
                activeTopicId.startsWith('api-') ||
                activeTopicId.startsWith('sdks-') ||
                activeTopicId === 'webhooks' ||
                activeTopicId === 'errors-limits'
              )) ||
              (tab.targetId === 'changelog' && activeTopicId === 'changelog');

            return (
              <button
                key={tab.label}
                type="button"
                className={`docs-header__nav-tab ${isActive ? 'active' : ''}`}
                onClick={() => onSelectTopic(tab.targetId)}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="docs-header__right">
        {/* Search trigger button (Ctrl + K) */}
        <button
          type="button"
          className="docs-header__search-trigger"
          onClick={onOpenSearch}
          aria-label="Search documentation (Press Ctrl + K)"
        >
          <Search size={14} className="docs-header__search-icon" />
          <span className="docs-header__search-placeholder">Search docs...</span>
          <kbd className="docs-header__search-kbd">
            <span className="text-[10px]">Ctrl</span> K
          </kbd>
        </button>

        {/* Live Status indicator */}
        <div className="docs-header__status-badge hidden sm:flex" title="All voice models & telecom clusters operating normally">
          <span className="docs-header__status-dot" />
          <span className="text-xs font-mono text-emerald-400">99.98% Uptime</span>
        </div>

        {/* Quick App Actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="docs-header__btn-secondary hidden sm:inline-flex"
            onClick={() => navigate('/')}
          >
            <ArrowLeft size={13} />
            <span>Home</span>
          </button>

          <button
            type="button"
            className="docs-header__btn-primary"
            onClick={() => navigate('/dashboard')}
          >
            <span>Console</span>
            <ExternalLink size={13} />
          </button>
        </div>
      </div>
    </header>
  );
}
