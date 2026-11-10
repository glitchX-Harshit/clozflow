import React, { useState } from 'react';
import { ThumbsUp, ThumbsDown, MessageSquare, ExternalLink, Radio, CheckCircle2, X } from 'lucide-react';

export default function DocsTOC({
  toc = [],
  activeHeadingId,
  onSelectHeading
}) {
  const [feedbackGiven, setFeedbackGiven] = useState(null);
  const [showStatusModal, setShowStatusModal] = useState(false);

  return (
    <aside className="docs-toc" aria-label="Table of Contents">
      <div className="docs-toc__inner">
        <span className="docs-toc__heading">On this page</span>

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
          <p className="text-xs text-zinc-500 mt-2">Overview section</p>
        )}

        {/* Microfeedback widget */}
        <div className="docs-toc__feedback">
          <span className="text-xs text-zinc-400">Was this page helpful?</span>
          {feedbackGiven ? (
            <p className="text-xs text-zinc-300 mt-1">Thank you for your feedback!</p>
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
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
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
                <MessageSquare size={13} className="text-zinc-400" />
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
                <Radio size={13} className="text-zinc-400" />
                <span>Status & Incidents</span>
                <span className="text-[10px] text-zinc-400 font-mono ml-auto">99.98%</span>
              </button>
            </li>
          </ul>
        </div>

        {/* Non-blocking Status Popover Modal */}
        {showStatusModal && (
          <div className="mt-3 p-3 rounded-lg bg-[#14161C] border border-white/10 text-xs">
            <div className="flex items-center justify-between pb-1.5 border-b border-zinc-800">
              <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                <CheckCircle2 size={13} className="text-zinc-300" />
                All Systems Normal
              </span>
              <button
                type="button"
                onClick={() => setShowStatusModal(false)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                <X size={12} />
              </button>
            </div>
            <div className="mt-2 space-y-1 text-[11px] text-zinc-400">
              <div className="flex justify-between">
                <span>Mumbai Cluster (ap-south-1)</span>
                <span className="text-zinc-300 font-mono">18ms</span>
              </div>
              <div className="flex justify-between">
                <span>Delhi NCR Telecom Node</span>
                <span className="text-zinc-300 font-mono">22ms</span>
              </div>
              <div className="flex justify-between">
                <span>Bengaluru SIP Gateway</span>
                <span className="text-zinc-300 font-mono">16ms</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-zinc-800 text-zinc-300">
                <span>30-Day Platform SLA</span>
                <span className="font-mono text-zinc-200">99.98%</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
