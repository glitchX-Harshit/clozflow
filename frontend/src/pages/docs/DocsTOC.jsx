import React, { useState, useEffect } from 'react';
import { ExternalLink, ThumbsUp, ThumbsDown, MessageSquare, Radio, CheckCircle2, X } from 'lucide-react';

export default function DocsTOC({ toc = [], activeHeadingId, onSelectHeading }) {
  const [feedbackGiven, setFeedbackGiven] = useState(null);
  const [showStatusModal, setShowStatusModal] = useState(false);

  // Reset feedback state when TOC changes
  useEffect(() => {
    setFeedbackGiven(null);
  }, [toc]);

  return (
    <aside className="docs-toc hidden xl:block" aria-label="Table of contents">
      <div className="docs-toc__inner">
        <h3 className="docs-toc__title">On this page</h3>

        {toc.length > 0 ? (
          <ul className="docs-toc__list">
            {toc.map((item) => {
              const isActive = activeHeadingId === item.id;
              return (
                <li key={item.id} className="docs-toc__item">
                  <button
                    type="button"
                    className={`docs-toc__link ${isActive ? 'active' : ''}`}
                    onClick={() => onSelectHeading(item.id)}
                  >
                    {item.title}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-slate-500 italic">No sub-sections</p>
        )}

        <hr className="docs-toc__divider" />

        {/* Microfeedback widget */}
        <div className="docs-toc__feedback">
          <span className="text-xs text-slate-400">Was this page helpful?</span>
          {feedbackGiven ? (
            <p className="text-xs text-emerald-400 mt-1">Thank you for your feedback!</p>
          ) : (
            <div className="flex items-center gap-2 mt-1.5">
              <button
                type="button"
                className="docs-feedback-btn"
                onClick={() => setFeedbackGiven('yes')}
                title="Yes, helpful"
              >
                <ThumbsUp size={12} />
                <span>Yes</span>
              </button>
              <button
                type="button"
                className="docs-feedback-btn"
                onClick={() => setFeedbackGiven('no')}
                title="Could be improved"
              >
                <ThumbsDown size={12} />
                <span>No</span>
              </button>
            </div>
          )}
        </div>

        <hr className="docs-toc__divider" />

        {/* Community & Status Links */}
        <div className="docs-toc__resources">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Developer Resources
          </span>
          <ul className="docs-toc__resource-links">
            <li>
              <a
                href="https://discord.gg"
                target="_blank"
                rel="noreferrer"
                className="docs-toc__resource-link"
              >
                <MessageSquare size={13} className="text-indigo-400" />
                <span>Join Discord Community</span>
                <ExternalLink size={11} className="opacity-60" />
              </a>
            </li>
            <li>
              <button
                type="button"
                onClick={() => setShowStatusModal(true)}
                className="docs-toc__resource-link w-full text-left bg-transparent border-none cursor-pointer p-0"
              >
                <Radio size={13} className="text-emerald-400" />
                <span>Status & Incidents</span>
                <span className="text-[10px] text-emerald-400 font-mono ml-auto">99.98%</span>
              </button>
            </li>
          </ul>
        </div>

        {/* Non-blocking Status Popover Modal */}
        {showStatusModal && (
          <div className="mt-3 p-3 rounded-lg bg-[#0E131D] border border-emerald-500/30 text-xs">
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-700/50">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <CheckCircle2 size={13} className="text-emerald-400" />
                All Systems Normal
              </span>
              <button
                type="button"
                onClick={() => setShowStatusModal(false)}
                className="text-slate-400 hover:text-slate-200"
              >
                <X size={12} />
              </button>
            </div>
            <div className="mt-2 space-y-1 text-[11px] text-slate-400">
              <div className="flex justify-between">
                <span>Mumbai Cluster (ap-south-1)</span>
                <span className="text-emerald-400 font-mono">18ms</span>
              </div>
              <div className="flex justify-between">
                <span>Delhi NCR Telecom Node</span>
                <span className="text-emerald-400 font-mono">22ms</span>
              </div>
              <div className="flex justify-between">
                <span>Bengaluru SIP Gateway</span>
                <span className="text-emerald-400 font-mono">16ms</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-800 text-slate-300">
                <span>30-Day Platform SLA</span>
                <span className="font-mono text-emerald-400">99.98%</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
