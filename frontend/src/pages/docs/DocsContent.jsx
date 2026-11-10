import React, { useEffect, useMemo, useState } from 'react';
import { Hash, ArrowLeft, ArrowRight, ShieldCheck, Terminal, Copy, Check } from 'lucide-react';
import DocsCodeSnippet from './DocsCodeSnippet';
import InteractiveAudioPlayer from './InteractiveAudioPlayer';
import { DOCS_SECTIONS, DOCS_PAGES } from './docsData';

/**
 * Lightweight inline markdown parser for rendering **bold**, *italic*,
 * `code`, and [link](url) without external heavy dependencies.
 */
function renderMarkdownInline(text) {
  if (!text || typeof text !== 'string') return text;

  const tokenRegex = /(\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  const elements = [];
  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push(text.substring(lastIndex, match.index));
    }

    if (match[2] && match[3]) {
      // [text](url)
      const linkText = match[2];
      const linkUrl = match[3];
      const isExternal = linkUrl.startsWith('http') || linkUrl.startsWith('mailto:');
      elements.push(
        <a
          key={`link-${match.index}`}
          href={linkUrl}
          className="docs-inline-link"
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noreferrer' : undefined}
        >
          {linkText}
        </a>
      );
    } else if (match[4]) {
      // `code`
      elements.push(
        <code key={`code-${match.index}`} className="docs-inline-code">
          {match[4]}
        </code>
      );
    } else if (match[5]) {
      // **bold**
      elements.push(
        <strong key={`bold-${match.index}`} className="font-semibold text-slate-100">
          {match[5]}
        </strong>
      );
    } else if (match[6]) {
      // *italic*
      elements.push(
        <em key={`italic-${match.index}`} className="italic text-slate-300">
          {match[6]}
        </em>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    elements.push(text.substring(lastIndex));
  }

  return elements.length > 0 ? elements : text;
}

export default function DocsContent({ activeTopicId, onSelectTopic }) {
  const pageData = DOCS_PAGES[activeTopicId] || DOCS_PAGES.overview;

  // Flatten items to determine Previous and Next pages
  const allItems = useMemo(() => {
    const list = [];
    DOCS_SECTIONS.forEach((cat) => {
      cat.items.forEach((item) => {
        list.push({ ...item, category: cat.category });
      });
    });
    return list;
  }, []);

  const currentIndex = allItems.findIndex((item) => item.id === activeTopicId);
  const prevItem = currentIndex > 0 ? allItems[currentIndex - 1] : null;
  const nextItem = currentIndex < allItems.length - 1 && currentIndex >= 0 ? allItems[currentIndex + 1] : null;

  // Scroll to top only when there is NO hash anchor in the URL
  useEffect(() => {
    if (!window.location.hash) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [activeTopicId]);

  const [copiedEndpointUrl, setCopiedEndpointUrl] = useState('');

  const copyEndpointUrl = (url) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedEndpointUrl(url);
      setTimeout(() => setCopiedEndpointUrl(''), 2000);
    });
  };

  return (
    <article className="docs-content">
      {/* Breadcrumb & Metadata Header */}
      <div className="docs-content__header">
        <div className="docs-content__breadcrumb">
          <span>Docs</span>
          <span className="separator">/</span>
          <span className="category">{allItems[currentIndex]?.category || 'General'}</span>
          <span className="separator">/</span>
          <span className="current">{pageData.title}</span>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-3">
          <h1 className="docs-content__title">{pageData.title}</h1>
          {pageData.badge && (
            <span className="docs-content__badge">{pageData.badge}</span>
          )}
        </div>

        {pageData.summary && (
          <p className="docs-content__lead">{renderMarkdownInline(pageData.summary)}</p>
        )}

        <div className="flex items-center gap-4 mt-3 text-xs text-zinc-400">
          <span>Last updated: {pageData.lastUpdated}</span>
          <span>•</span>
          <span className="flex items-center gap-1 text-zinc-300">
            <ShieldCheck size={14} className="text-zinc-400" /> Production Verified
          </span>
        </div>
      </div>

      <hr className="docs-content__divider" />

      {/* Main Body Sections */}
      <div className="docs-content__body">
        {pageData.content?.sections?.map((section) => (
          <section
            key={section.id}
            id={section.id}
            className="docs-section"
          >
            {section.heading && (
              <h2 className="docs-section__heading group">
                <a href={`#${section.id}`} className="docs-section__anchor" title="Direct link to section">
                  <Hash size={15} className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400" />
                </a>
                <span>{section.heading}</span>
              </h2>
            )}

            {/* REST Endpoint Banner */}
            {section.endpoint && (
              <div className="docs-endpoint-banner">
                <span className={`docs-endpoint-method ${section.endpoint.method.toLowerCase()}`}>
                  {section.endpoint.method}
                </span>
                <span className="docs-endpoint-path font-mono">
                  {section.endpoint.path}
                </span>
                <button
                  type="button"
                  className="docs-endpoint-copy-btn"
                  onClick={() => copyEndpointUrl(section.endpoint.path)}
                  title="Copy endpoint URL"
                >
                  {copiedEndpointUrl === section.endpoint.path ? (
                    <Check size={14} className="text-zinc-200" />
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
              </div>
            )}

            {/* Markdown-style paragraphs */}
            {section.body && (
              <div className="docs-section__text">
                {section.body.split('\n\n').map((paragraph, pIdx) => {
                  const trimmed = paragraph.trim();
                  // Handle blockquotes / warnings
                  if (trimmed.startsWith('> ⚠️')) {
                    return (
                      <div key={pIdx} className="docs-callout warning">
                        <p>{renderMarkdownInline(trimmed.replace('> ⚠️', '').trim())}</p>
                      </div>
                    );
                  }
                  if (trimmed.startsWith('>')) {
                    return (
                      <div key={pIdx} className="docs-callout info">
                        <p>{renderMarkdownInline(trimmed.replace(/^>\s*/, '').trim())}</p>
                      </div>
                    );
                  }
                  // Handle bullet lists
                  if (trimmed.startsWith('* ') || trimmed.startsWith('- ') || /^\d+\.\s/.test(trimmed)) {
                    const lines = trimmed.split('\n').filter(Boolean);
                    return (
                      <ul key={pIdx} className="docs-bullet-list">
                        {lines.map((l, lIdx) => (
                          <li key={lIdx}>
                            {renderMarkdownInline(l.replace(/^[\*\-\d\.]+\s*/, ''))}
                          </li>
                        ))}
                      </ul>
                    );
                  }
                  return <p key={pIdx}>{renderMarkdownInline(trimmed)}</p>;
                })}
              </div>
            )}

            {/* Interactive Audio Player Demo */}
            {section.interactiveAudioDemo && (
              <InteractiveAudioPlayer />
            )}

            {/* Cards Grid */}
            {section.cards && (
              <div className="docs-cards-grid">
                {section.cards.map((card, cIdx) => (
                  <div key={cIdx} className="docs-feature-card">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-slate-100">{card.title}</h4>
                      {card.badge && (
                        <span className="docs-card-badge">{card.badge}</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                      {renderMarkdownInline(card.desc)}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Structured Table */}
            {section.table && (
              <div className="docs-table-wrap">
                <table className="docs-table">
                  <thead>
                    <tr>
                      {section.table.headers.map((h, hIdx) => (
                        <th key={hIdx}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.table.rows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        {row.map((cell, cIdx) => (
                          <td key={cIdx}>
                            {renderMarkdownInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Single Code Snippet */}
            {section.codeSnippet && (
              <DocsCodeSnippet
                singleSnippet={section.codeSnippet}
                language={typeof section.codeSnippet === 'object' ? Object.keys(section.codeSnippet)[0] : 'bash'}
              />
            )}

            {/* Multi-Tab Code Snippets (cURL, Python, Node) */}
            {section.codeTabs && (
              <DocsCodeSnippet tabs={section.codeTabs} />
            )}
          </section>
        ))}
      </div>

      {/* Pagination Footer */}
      <div className="docs-pagination">
        {prevItem ? (
          <button
            type="button"
            className="docs-pagination__btn prev"
            onClick={() => onSelectTopic(prevItem.id)}
          >
            <ArrowLeft size={16} />
            <div className="text-left">
              <span className="docs-pagination__sub">Previous</span>
              <span className="docs-pagination__title">{prevItem.title}</span>
            </div>
          </button>
        ) : <div />}

        {nextItem && (
          <button
            type="button"
            className="docs-pagination__btn next"
            onClick={() => onSelectTopic(nextItem.id)}
          >
            <div className="text-right">
              <span className="docs-pagination__sub">Next</span>
              <span className="docs-pagination__title">{nextItem.title}</span>
            </div>
            <ArrowRight size={16} />
          </button>
        )}
      </div>

      {/* Bottom Compliance & Security Disclaimer */}
      <div className="docs-footer-security">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Terminal size={14} className="text-zinc-500" />
          <span>Need custom high-concurrency capacity? Reach out to <a href="mailto:api@clozflow.in" className="text-zinc-200 underline hover:text-white">api@clozflow.in</a></span>
        </div>
        <p className="text-[11px] text-slate-500 mt-1">
          © 2026 ClozFlow AI Inc. All API keys shown in code snippets are dummy placeholders. Telephony compliant with TRAI NDNC and ISO/IEC 27001 standards.
        </p>
      </div>
    </article>
  );
}
