import React, { useState } from 'react';
import { ChevronRight, Terminal, BookOpen, Sparkles, Shield, Cpu, Webhook, AlertTriangle, History } from 'lucide-react';
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
    if (category.includes('Started')) return <BookOpen size={15} className="text-emerald-400" />;
    if (category.includes('Models')) return <Sparkles size={15} className="text-amber-400" />;
    if (category.includes('Agents')) return <Cpu size={15} className="text-cyan-400" />;
    if (category.includes('Dialer')) return <Terminal size={15} className="text-sky-400" />;
    if (category.includes('API')) return <Terminal size={15} className="text-blue-400" />;
    if (category.includes('SDKs')) return <Shield size={15} className="text-indigo-400" />;
    if (category.includes('Webhooks')) return <Webhook size={15} className="text-pink-400" />;
    if (category.includes('Errors')) return <AlertTriangle size={15} className="text-rose-400" />;
    if (category.includes('Changelog')) return <History size={15} className="text-violet-400" />;
    return <BookOpen size={15} />;
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
      {/* Mobile backdrop: lg:hidden ensures backdrop covers properly on all screen widths < 1024px */}
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
            placeholder="Filter sections..."
            value={sidebarFilter}
            onChange={(e) => setSidebarFilter(e.target.value)}
          />
        </div>

        <nav className="docs-sidebar__nav" aria-label="Sidebar navigation">
          {filteredSections.map((sec) => {
            const hasActiveItem = sec.items.some((item) => item.id === activeTopicId);
            // If the category contains the active item, keep it expanded
            const isCollapsed = !sidebarFilter && !!collapsedCategories[sec.category] && !hasActiveItem;

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
                    <span className="docs-sidebar__category-label">{sec.category}</span>
                  </div>
                  <ChevronRight
                    size={14}
                    className={`docs-sidebar__chevron ${isCollapsed ? '' : 'expanded rotate-90'}`}
                  />
                </button>

                {!isCollapsed && (
                  <ul className="docs-sidebar__items-list">
                    {sec.items.map((item) => {
                      const isActive = activeTopicId === item.id;
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            className={`docs-sidebar__item-link ${isActive ? 'active' : ''}`}
                            onClick={() => {
                              onSelectTopic(item.id);
                              if (onCloseMobile) onCloseMobile();
                            }}
                          >
                            <span className="docs-sidebar__item-title truncate">
                              {item.title}
                            </span>

                            {item.method ? (
                              <span className={getMethodBadgeClass(item.method)}>
                                {item.method}
                              </span>
                            ) : item.tag ? (
                              <span className="docs-sidebar__item-tag truncate">
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
          <div className="docs-sidebar__footer-card">
            <span className="text-xs font-semibold text-slate-200">Need Enterprise SIP?</span>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Dedicated PRI trunks with 500+ concurrent channels in Mumbai/Bangalore.
            </p>
            <a
              href="mailto:enterprise@clozflow.in"
              className="docs-sidebar__footer-link"
            >
              Contact Solutions Eng →
            </a>
          </div>
        </div>
      </aside>
    </>
  );
}
