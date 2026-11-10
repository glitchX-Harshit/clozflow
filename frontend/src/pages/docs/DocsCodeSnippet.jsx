import React, { useState, useEffect } from 'react';
import { Check, Copy } from 'lucide-react';

export default function DocsCodeSnippet({ tabs, singleSnippet, language = 'bash' }) {
  const tabKeys = tabs && typeof tabs === 'object' ? Object.keys(tabs) : [];
  const defaultTab = tabKeys[0] || language;

  const [activeTab, setActiveTab] = useState(defaultTab);
  const [copied, setCopied] = useState(false);

  // Synchronize activeTab whenever tabs prop updates to prevent blank display
  useEffect(() => {
    if (tabKeys.length > 0 && !tabKeys.includes(activeTab)) {
      setActiveTab(tabKeys[0]);
    }
  }, [tabs, activeTab, tabKeys]);

  const effectiveTab = (tabKeys.length > 0 && tabKeys.includes(activeTab)) ? activeTab : defaultTab;

  const getCodeContent = () => {
    if (tabs && typeof tabs === 'object') {
      return tabs[effectiveTab] || (tabKeys.length > 0 ? tabs[tabKeys[0]] : '');
    }
    if (singleSnippet) {
      if (typeof singleSnippet === 'object') {
        const firstKey = Object.keys(singleSnippet)[0];
        return singleSnippet[firstKey];
      }
      return singleSnippet;
    }
    return '';
  };

  const handleCopy = () => {
    const code = getCodeContent();
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const tabLabels = {
    curl: 'cURL',
    python: 'Python',
    node: 'Node.js',
    js: 'JavaScript',
    ts: 'TypeScript',
    bash: 'Terminal',
    json: 'JSON',
    response200: '200 OK'
  };

  const codeText = getCodeContent();

  return (
    <div className="docs-code-container">
      <div className="docs-code-header">
        <div className="docs-code-tabs">
          {tabKeys.length > 0 ? (
            tabKeys.map((tabKey) => (
              <button
                key={tabKey}
                type="button"
                className={`docs-code-tab ${effectiveTab === tabKey ? 'active' : ''}`}
                onClick={() => setActiveTab(tabKey)}
              >
                {tabLabels[tabKey] || tabKey}
              </button>
            ))
          ) : (
            <span className="docs-code-lang-label">
              {tabLabels[language] || language}
            </span>
          )}
        </div>
        <button
          type="button"
          className="docs-code-copy-btn"
          onClick={handleCopy}
          aria-label="Copy code to clipboard"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check size={14} className="text-zinc-200" />
              <span className="text-zinc-200">Copied!</span>
            </>
          ) : (
            <>
              <Copy size={14} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="docs-code-body">
        <pre className="docs-code-pre">
          <code>{codeText}</code>
        </pre>
      </div>
    </div>
  );
}
