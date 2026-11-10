import React, { useState } from 'react';
import { ChevronRight, Terminal, BookOpen, Sparkles, Shield, Cpu, Webhook, AlertTriangle, History, PhoneCall } from 'lucide-react';
import { DOCS_SECTIONS } from './docsData';

export default function DocsSidebar({
  activeTopicId,
  onSelectTopic,
  isMobileOpen,
  onCloseMobile
}) {
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [sidebarFilter, setSidebarFilter] = useState('');

  const toggleCategory = (catName) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [catName]: !prev[catName]
    }));
  };

  const getCategoryIcon = (category) => {
    if (category.includes('Started')) return <BookOpen size={14} className="text-zinc-400" />;
    if (category.includes('Models')) return <Sparkles size={14} className="text-zinc-400" />;
    if (category.includes('Agents')) return <Cpu size={14} className="text-zinc-400" />;
    if (category.includes('Dialer')) return <PhoneCall size={14} className="text-zinc-400" />;
    if (category.includes('API')) return <Terminal size={14} className="text-zinc-400" />;
    if (category.includes('SDKs')) return <Shield size={14} className="text-zinc-400" />;
    if (category.includes('Webhooks')) return <Webhook size={14} className="text-zinc-400" />;
    if (category.includes('Errors')) return <AlertTriangle size={14} className="text-zinc-400" />;
    if (category.includes('Changelog')) return <History size={14} className="text-zinc-400" />;
    return <BookOpen size={14} className="text-zinc-400" />;
  };

  const getMethodBadgeClass = (method) => {
    switch (method) {
      case 'POST':
        return 'docs-method-badge post';
      case 'GET':
        return 'docs-method-badge get';
      case 'WS':
        return 'docs-method-badge ws';
      default:
        return 'docs-method-badge';
    }
  };

  // Filter sections if user types in sidebar filter
  const filteredSections = DOCS_SECTIONS.map((sec) => {
    if (!sidebarFilter.trim()) return sec;
    const q = sidebarFilter.toLowerCase();
    const matchingItems = sec.items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        (item.tag && item.tag.toLowerCase().includes(q)) ||
        (item.method && item.method.toLowerCase().includes(q))
    );
    return {
      ...sec,
      items: matchingItems
    };
  }).filter((sec) => sec.items.length > 0);

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="docs-sidebar-backdrop lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside className={`docs-sidebar ${isMobileOpen ? 'open' : ''}`}>
        <div className="docs-sidebar__header">
          <input
            type="text"
            className="docs-sidebar__filter-input"
            placeholder="Search sections..."
            value={sidebarFilter}
            onChange={(e) => setSidebarFilter(e.target.value)}
          />
        </div>

        <nav className="docs-sidebar__nav" aria-label="Documentation Categories">
          {filteredSections.map((sec) => {
            const hasActiveTopic = sec.items.some((item) => item.id === activeTopicId);
            // Ensure category holding the active topic automatically stays uncollapsed
            const isCollapsed = collapsedCategories[sec.category] && !hasActiveTopic;

            return (
              <div key={sec.category} className="docs-sidebar__category-group">
                <button
                  type="button"
                  className="docs-sidebar__category-btn"
                  onClick={() => toggleCategory(sec.category)}
                  aria-expanded={!isCollapsed}
                >
                  <div className="flex items-center gap-2">
                    {getCategoryIcon(sec.category)}
                    <span>{sec.category}</span>
                  </div>
                  <ChevronRight
                    size={12}
                    className={`docs-sidebar__chevron ${!isCollapsed ? 'expanded' : ''}`}
                  />
                </button>

                {!isCollapsed && (
                  <ul className="docs-sidebar__items-list">
                    {sec.items.map((item) => {
                      const isActive = item.id === activeTopicId;
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            className={`docs-sidebar__item-link ${isActive ? 'active' : ''}`}
                            onClick={() => onSelectTopic(item.id)}
                          >
                            <span className="truncate">{item.title}</span>
                            {item.method ? (
                              <span className={getMethodBadgeClass(item.method)}>
                                {item.method}
                              </span>
                            ) : item.tag ? (
                              <span className="docs-sidebar__item-tag">
                                {item.tag}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        <div className="docs-sidebar__footer">
          <div className="docs-sidebar__telemetry-card">
            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span className="flex items-center gap-1.5 font-medium text-zinc-300">
                <span className="docs-status-dot-sm" /> Voice Engine
              </span>
              <span className="font-mono text-zinc-300">Kiki v2 Pro</span>
            </div>
            <div className="mt-1 text-[10px] text-zinc-500">
              Avg. TTFA streaming: 114ms
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
