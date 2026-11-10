import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, ArrowRight, BookOpen, Terminal, Sparkles, Hash } from 'lucide-react';
import { DOCS_SECTIONS, DOCS_PAGES } from './docsData';

export default function DocsSearchModal({ isOpen, onClose, onSelectTopic }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Global escape listener when modal is mounted
  useEffect(() => {
    if (!isOpen) return;
    const handleGlobalKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [isOpen, onClose]);

  // Index all search items across categories, subheadings, and section content keywords
  const searchableItems = useMemo(() => {
    const list = [];
    DOCS_SECTIONS.forEach((cat) => {
      cat.items.forEach((item) => {
        const pageData = DOCS_PAGES[item.id];
        // Add main page item
        list.push({
          type: 'page',
          id: item.id,
          category: cat.category,
          title: item.title,
          summary: pageData?.summary || '',
          tag: item.tag,
          method: item.method,
          keywords: pageData?.summary || ''
        });

        // Add subheadings from TOC with content excerpts
        if (pageData?.toc) {
          pageData.toc.forEach((tocItem) => {
            const sectionObj = pageData.content?.sections?.find((s) => s.id === tocItem.id);
            const bodySnippet = sectionObj?.body ? sectionObj.body.substring(0, 140).replace(/[\*\#\`]/g, '') : '';

            list.push({
              type: 'heading',
              id: item.id,
              headingId: tocItem.id,
              category: `${cat.category} > ${item.title}`,
              title: tocItem.title,
              summary: bodySnippet || `Jump to section in ${item.title}`,
              tag: 'Section',
              keywords: sectionObj?.body || ''
            });
          });
        }
      });
    });
    return list;
  }, []);

  const filteredItems = useMemo(() => {
    if (!query.trim()) {
      return searchableItems.slice(0, 8);
    }
    const q = query.toLowerCase();
    return searchableItems
      .filter((item) => {
        return (
          item.title.toLowerCase().includes(q) ||
          item.summary.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          (item.keywords && item.keywords.toLowerCase().includes(q)) ||
          (item.tag && item.tag.toLowerCase().includes(q)) ||
          (item.method && item.method.toLowerCase().includes(q))
        );
      })
      .slice(0, 10);
  }, [searchableItems, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard navigation
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev <= 0 ? filteredItems.length - 1 : prev - 1
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        const item = filteredItems[selectedIndex];
        onSelectTopic(item.id, item.headingId);
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="docs-search-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="docs-search-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="docs-search-input-wrap">
          <Search size={18} className="docs-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="docs-search-input"
            placeholder="Search docs, models, endpoints, codes... (e.g. Kiki, synthesize, ROI)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {query && (
            <button
              type="button"
              className="docs-search-clear"
              onClick={() => setQuery('')}
              aria-label="Clear search input"
            >
              <X size={14} />
            </button>
          )}
          <kbd className="docs-search-kbd">ESC</kbd>
        </div>

        <div className="docs-search-results">
          {filteredItems.length === 0 ? (
            <div className="docs-search-empty">
              <p>No documentation found matching &ldquo;{query}&rdquo;</p>
              <span className="text-xs text-slate-500">Try searching for &quot;Kiki&quot;, &quot;synthesize&quot;, &quot;Capsules&quot;, or &quot;Webhooks&quot;</span>
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={`${item.id}-${item.headingId || 'root'}-${idx}`}
                  className={`docs-search-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    onSelectTopic(item.id, item.headingId);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div className="docs-search-item-icon">
                    {item.type === 'heading' ? (
                      <Hash size={14} className="text-zinc-400" />
                    ) : item.method ? (
                      <Terminal size={14} className="text-zinc-400" />
                    ) : item.category.includes('Model') ? (
                      <Sparkles size={14} className="text-zinc-400" />
                    ) : (
                      <BookOpen size={14} className="text-zinc-400" />
                    )}
                  </div>

                  <div className="docs-search-item-content">
                    <div className="flex items-center gap-2">
                      <span className="docs-search-item-title">{item.title}</span>
                      {item.tag && (
                        <span className="docs-search-item-badge">{item.tag}</span>
                      )}
                    </div>
                    <span className="docs-search-item-category">
                      {item.category}
                    </span>
                  </div>

                  <ArrowRight size={14} className="docs-search-item-arrow" />
                </div>
              );
            })
          )}
        </div>

        <div className="docs-search-footer">
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span><kbd>↑</kbd> <kbd>↓</kbd> to navigate</span>
            <span><kbd>↵</kbd> to select</span>
            <span><kbd>esc</kbd> to close</span>
          </div>
          <span className="text-xs text-slate-500 font-mono">ClozFlow v2.4</span>
        </div>
      </div>
    </div>
  );
}
