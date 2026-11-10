import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ExternalLink, Menu, X, ArrowLeft, Sparkles, PhoneCall } from 'lucide-react';
import ClozFlowLogo from '../../components/ClozFlowLogo';

export default function DocsHeader({
  activeTopicId,
  onSelectTopic,
  onOpenSearch,
  mobileSidebarOpen,
  onToggleMobileSidebar
}) {
  const navigate = useNavigate();

  // Top Nav Items mapping to primary documentation sections (identical to Sarvam's top navbar)
  const topNavTabs = [
    { label: 'Model APIs', targetId: 'models-overview' },
    { label: 'Voice Agents', targetId: 'voice-agents' },
    { label: 'Dialer & Telecom', targetId: 'campaigns-dialer' },
    { label: 'API Reference', targetId: 'api-voice-synthesize' },
    { label: 'SDKs', targetId: 'sdks-python' },
    { label: 'Changelog', targetId: 'changelog' }
  ];

  return (
    <header className="docs-header">
      <div className="docs-header__left">
        {/* Mobile menu toggle for tablet/phone */}
        <button
          type="button"
          className="docs-header__mobile-toggle lg:hidden"
          onClick={onToggleMobileSidebar}
          aria-label="Toggle navigation menu"
        >
          {mobileSidebarOpen ? <X size={18} /> : <Menu size={18} />}
        </button>

        {/* ClozFlow Brand */}
        <div className="docs-header__brand-wrap">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
            className="flex items-center gap-2 group"
          >
            <ClozFlowLogo size={22} className="docs-logo" />
            <span className="docs-brand-text">clozflow</span>
          </a>
        </div>

        {/* Top Categorical Nav Tabs (Sarvam AI style) */}
        <nav className="docs-header__nav-tabs hidden lg:flex" aria-label="Documentation Sections">
          {topNavTabs.map((tab) => {
            const isActive =
              (tab.targetId === 'models-overview' && ['models-overview', 'kiki-v1-flash', 'kiki-v2-pro', 'language-matrix', 'latency-benchmarks', 'overview', 'quickstart', 'auth', 'architecture'].includes(activeTopicId)) ||
              (tab.targetId === 'voice-agents' && ['voice-agents', 'sales-capsules', 'interruption-vad', 'dynamic-variables'].includes(activeTopicId)) ||
              (tab.targetId === 'campaigns-dialer' && ['campaigns-dialer', 'telephony-setup'].includes(activeTopicId)) ||
              (tab.targetId === 'api-voice-synthesize' && (
                activeTopicId.startsWith('api-') ||
                activeTopicId === 'webhooks' ||
                activeTopicId === 'errors-limits'
              )) ||
              (tab.targetId === 'sdks-python' && activeTopicId.startsWith('sdks-')) ||
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
        {/* Search trigger button (Ctrl + K) - sleek Sarvam style */}
        <button
          type="button"
          className="docs-header__search-trigger"
          onClick={onOpenSearch}
          aria-label="Search documentation"
        >
          <Search size={14} className="docs-header__search-icon" />
          <span className="docs-header__search-placeholder">Search</span>
          <kbd className="docs-header__search-kbd">/</kbd>
        </button>

        {/* Ask AI button (Matches Sarvam's "Ask AI ✦") */}
        <button
          type="button"
          className="docs-header__ask-ai-btn hidden md:inline-flex"
          onClick={onOpenSearch}
        >
          <span>Ask AI</span>
          <Sparkles size={12} className="text-zinc-300" />
        </button>

        {/* Status indicator (Monochrome/subtle dot) */}
        <div className="docs-header__status-badge hidden xl:flex" title="All voice models & telecom clusters operating normally">
          <span className="docs-header__status-dot" />
          <span className="text-xs text-zinc-400">API Status</span>
        </div>

        {/* Quick Actions: Sign in / Dashboard in crisp solid white */}
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
            <span>Dashboard</span>
            <ExternalLink size={13} />
          </button>
        </div>
      </div>
    </header>
  );
}
