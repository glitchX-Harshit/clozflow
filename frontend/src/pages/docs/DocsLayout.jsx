import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { PhoneCall, Sparkles, X } from 'lucide-react';
import DocsHeader from './DocsHeader';
import DocsSidebar from './DocsSidebar';
import DocsContent from './DocsContent';
import DocsTOC from './DocsTOC';
import DocsSearchModal from './DocsSearchModal';
import { DOCS_PAGES } from './docsData';
import './DocsPage.css';

export default function DocsLayout() {
  const { sectionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [activeTopicId, setActiveTopicId] = useState(() => {
    if (sectionId && DOCS_PAGES[sectionId]) return sectionId;
    return 'overview';
  });
  const [activeHeadingId, setActiveHeadingId] = useState('');
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [assistantDismissed, setAssistantDismissed] = useState(false);

  // Synchronize route param with activeTopicId & gracefully redirect invalid paths
  useEffect(() => {
    if (sectionId) {
      if (DOCS_PAGES[sectionId]) {
        setActiveTopicId(sectionId);
      } else {
        setActiveTopicId('overview');
        navigate('/docs/overview', { replace: true });
      }
    } else {
      setActiveTopicId('overview');
    }
  }, [sectionId, navigate]);

  // Handle URL hash if provided
  useEffect(() => {
    if (location.hash) {
      const targetHash = location.hash.replace('#', '');
      setActiveHeadingId(targetHash);
      setTimeout(() => {
        const el = document.getElementById(targetHash);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth' });
        }
      }, 100);
    } else {
      setActiveHeadingId('');
    }
  }, [location.hash, activeTopicId]);

  // Global Ctrl + K / '/' listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchModalOpen((prev) => !prev);
      } else if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        setSearchModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSelectTopic = (topicId, headingId) => {
    setActiveTopicId(topicId);
    setMobileSidebarOpen(false);
    navigate(`/docs/${topicId}${headingId ? `#${headingId}` : ''}`);
    if (headingId) {
      setActiveHeadingId(headingId);
      setTimeout(() => {
        const el = document.getElementById(headingId);
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    } else {
      setActiveHeadingId('');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSelectHeading = (headingId) => {
    setActiveHeadingId(headingId);
    navigate(`${location.pathname}#${headingId}`);
    const el = document.getElementById(headingId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const currentPage = DOCS_PAGES[activeTopicId] || DOCS_PAGES.overview;

  return (
    <div className="docs-shell">
      {/* Sleek Top Navigation Header */}
      <DocsHeader
        activeTopicId={activeTopicId}
        onSelectTopic={handleSelectTopic}
        onOpenSearch={() => setSearchModalOpen(true)}
        mobileSidebarOpen={mobileSidebarOpen}
        onToggleMobileSidebar={() => setMobileSidebarOpen((prev) => !prev)}
      />

      {/* Main Documentation 3-Column Workspace */}
      <div className="docs-main-container">
        {/* Left Navigation Sidebar */}
        <DocsSidebar
          activeTopicId={activeTopicId}
          onSelectTopic={handleSelectTopic}
          isMobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        {/* Central Article Content Area */}
        <main className="docs-main-reading-area">
          <DocsContent
            activeTopicId={activeTopicId}
            onSelectTopic={handleSelectTopic}
          />
        </main>

        {/* Right Sticky Table of Contents */}
        <DocsTOC
          toc={currentPage.toc || []}
          activeHeadingId={activeHeadingId}
          onSelectHeading={handleSelectHeading}
        />
      </div>

      {/* Interactive Global Search Modal */}
      <DocsSearchModal
        isOpen={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
        onSelectTopic={handleSelectTopic}
      />

      {/* Floating Kiki Voice Assistant Widget (Sarvam AI style) */}
      {!assistantDismissed && (
        <div className="docs-floating-assistant" role="complementary" aria-label="Interactive voice tester">
          <button
            type="button"
            className="docs-floating-assistant__close"
            onClick={() => setAssistantDismissed(true)}
            aria-label="Dismiss assistant widget"
          >
            <X size={12} />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="docs-floating-assistant__avatar">
              <Sparkles size={14} className="text-white" />
            </div>
            <div>
              <div className="text-xs font-semibold text-white">Kiki Voice Assistant</div>
              <div className="text-[11px] text-zinc-400">11+ Indian Languages</div>
            </div>
          </div>
          <button
            type="button"
            className="docs-floating-assistant__action-btn"
            onClick={() => handleSelectTopic('models-overview', 'interactive-voice-tester')}
          >
            <PhoneCall size={13} />
            <span>Audition Kiki</span>
          </button>
        </div>
      )}
    </div>
  );
}
