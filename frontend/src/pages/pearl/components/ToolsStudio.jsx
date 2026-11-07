import React, { useState, useMemo } from 'react';
import { 
  Plus, Search, Wrench, Globe, ShieldCheck, Database, 
  Sliders, Cpu, Play, CheckCircle2, Trash2, Edit3, 
  ChevronRight, ExternalLink, Sparkles, AlertCircle
} from 'lucide-react';
import './ToolsStudio.css';

export const ToolsStudio = ({
  tools = [],
  systemTools = [],
  onAddToolClick,
  onEditTool,
  onDeleteTool,
  onToggleToolActive,
  onToggleSystemTool,
  onOpenDocs
}) => {
  const [subtab, setSubtab] = useState('agent'); // 'agent' | 'system'
  const [searchQuery, setSearchQuery] = useState('');

  // Filter tools by search query
  const filteredTools = useMemo(() => {
    if (!searchQuery.trim()) return tools;
    const q = searchQuery.toLowerCase();
    return tools.filter(t => 
      (t.name || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q) ||
      (t.tool_type || '').toLowerCase().includes(q)
    );
  }, [tools, searchQuery]);

  const filteredSystemTools = useMemo(() => {
    if (!searchQuery.trim()) return systemTools;
    const q = searchQuery.toLowerCase();
    return systemTools.filter(t => 
      (t.name || '').toLowerCase().includes(q) ||
      (t.desc || '').toLowerCase().includes(q)
    );
  }, [systemTools, searchQuery]);

  const getToolIcon = (type) => {
    switch (type) {
      case 'api_tool': return <Globe size={16} />;
      case 'data_validator': return <ShieldCheck size={16} />;
      case 'data_verifier': return <Database size={16} />;
      case 'mock_api': return <Sliders size={16} />;
      case 'mcp': return <Cpu size={16} />;
      default: return <Wrench size={16} />;
    }
  };

  const getMethodBadge = (tool) => {
    if (tool.tool_type === 'api_tool') {
      const m = (tool.config?.method || 'GET').toUpperCase();
      return <span className={`badge-method method-${m.toLowerCase()}`}>{m}</span>;
    }
    if (tool.tool_type === 'mock_api') {
      return <span className="badge-method method-mock">MOCK</span>;
    }
    if (tool.tool_type === 'data_validator') {
      const preset = tool.config?.preset || 'validator';
      const cleanLabel = preset === 'indian_phone' ? 'PHONE' 
        : preset === 'pan_card' ? 'PAN' 
        : preset === 'pincode' ? 'PINCODE' 
        : preset === 'email' ? 'EMAIL' 
        : preset === 'aadhaar_last4' ? 'AADHAAR' 
        : 'VALIDATOR';
      return <span className="badge-method method-validator">{cleanLabel}</span>;
    }
    if (tool.tool_type === 'data_verifier') {
      return <span className="badge-method method-verifier">VERIFIER</span>;
    }
    if (tool.tool_type === 'mcp') {
      return <span className="badge-method method-mcp">MCP</span>;
    }
    return <span className="badge-method method-custom">TOOL</span>;
  };

  const getTimingLabel = (timing) => {
    switch (timing) {
      case 'call_start': return 'Call Start';
      case 'call_end': return 'Call End';
      default: return 'In-Call';
    }
  };

  const getToolFriendlySummary = (tool) => {
    if (tool.description && tool.description.trim()) return tool.description;
    if (tool.tool_type === 'api_tool') {
      return tool.config?.url ? `Connects to ${tool.config.method || 'POST'} ${tool.config.url}` : 'Connects to an external REST endpoint';
    }
    if (tool.tool_type === 'mock_api') return 'Simulated mock response with visual return fields';
    if (tool.tool_type === 'data_validator') {
      const preset = tool.config?.preset || 'indian_phone';
      const names = {
        indian_phone: 'Indian Phone Number',
        email: 'Email Address',
        pincode: '6-digit PIN Code',
        pan_card: 'PAN Card Number',
        aadhaar_last4: 'Aadhaar Last 4'
      };
      return `Validates format for ${names[preset] || 'input data'}`;
    }
    if (tool.tool_type === 'data_verifier') {
      return `Matches caller response against record on file (${tool.config?.reference_source || 'lead.phone'})`;
    }
    if (tool.tool_type === 'mcp') return 'Model Context Protocol integration';
    return 'Custom agent tool';
  };

  return (
    <div className="sarvam-panel-content tools-studio-container">
      {/* Subtab Header Navigation */}
      <div className="subtab-header-row">
        <div className="subtab-pills">
          <button 
            type="button" 
            className={`subtab-pill ${subtab === 'agent' ? 'active' : ''}`}
            onClick={() => setSubtab('agent')}
          >
            <span>Agent tools</span>
            <span className="subtab-count-badge">{tools.length}</span>
          </button>
          <button 
            type="button" 
            className={`subtab-pill ${subtab === 'system' ? 'active' : ''}`}
            onClick={() => setSubtab('system')}
          >
            <span>System tools</span>
            <span className="subtab-count-badge">{systemTools.length}</span>
          </button>
        </div>

        <div className="subtab-actions">
          <div className="sarvam-search-box">
            <Search size={14} color="#94a3b8" />
            <input 
              type="text" 
              placeholder="Search tools..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <button 
            type="button" 
            className="btn-add-pill"
            onClick={onAddToolClick}
          >
            <Plus size={14} />
            <span>Add tool</span>
          </button>
        </div>
      </div>

      {/* AGENT TOOLS TAB */}
      {subtab === 'agent' && (
        <>
          {filteredTools.length > 0 ? (
            <div className="tools-list-wrap">
              {filteredTools.map((t) => (
                <div 
                  key={t.id || t.name} 
                  className={`tool-card-row-interactive ${t.is_active === false ? 'is-disabled' : ''}`}
                  onClick={() => onEditTool(t)}
                >
                  <div className="tool-row-left">
                    <div className={`tool-type-icon-box type-${t.tool_type}`}>
                      {getToolIcon(t.tool_type)}
                    </div>
                    <div className="tool-row-info">
                      <div className="tool-row-title-bar">
                        {getMethodBadge(t)}
                        <h4 className="tool-row-name">{t.name}</h4>
                        <span className={`tool-timing-chip timing-${t.run_timing || 'conversation'}`}>
                          {getTimingLabel(t.run_timing)}
                        </span>
                      </div>
                      <p className="tool-row-desc">
                        {getToolFriendlySummary(t)}
                      </p>
                    </div>
                  </div>

                  <div className="tool-row-right" onClick={(e) => e.stopPropagation()}>
                    {/* Live Test Shortcut */}
                    <button 
                      type="button" 
                      className="btn-row-test"
                      title="Test this tool"
                      onClick={() => onEditTool(t)}
                    >
                      <Play size={12} />
                      <span>Test</span>
                    </button>

                    {/* Active Toggle Switch */}
                    <label className="toggle-switch" title={t.is_active !== false ? 'Disable tool' : 'Enable tool'}>
                      <input 
                        type="checkbox" 
                        checked={t.is_active !== false}
                        onChange={(e) => onToggleToolActive(t.id, e.target.checked)}
                      />
                      <span className="slider"></span>
                    </label>

                    {/* Delete Icon */}
                    <button 
                      type="button" 
                      className="btn-row-action-icon"
                      title="Delete tool"
                      onClick={() => {
                        if (window.confirm(`Delete tool "${t.name}"?`)) {
                          onDeleteTool(t.id);
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Empty State */
            <div className="tools-empty-state-card">
              <div className="tools-empty-illustration-wrap">
                <div className="tools-empty-glow" />
                <div className="tools-empty-illustration">
                  <Wrench size={30} />
                </div>
              </div>
              <h3 className="tools-empty-title">Let your agent take action</h3>
              <p className="tools-empty-desc">
                Your agent can look up caller orders via REST APIs, verify customer phone and PAN numbers against CRM records, or format pincodes, and bring results directly into conversational turns.
              </p>
              <div className="tools-empty-actions">
                <button 
                  type="button" 
                  className="btn-secondary-pill"
                  onClick={onOpenDocs}
                >
                  <ExternalLink size={13} />
                  <span>Read Tool Guide</span>
                </button>
                <button 
                  type="button" 
                  className="btn-add-pill"
                  onClick={onAddToolClick}
                >
                  <Plus size={14} />
                  <span>Add First Tool</span>
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* SYSTEM TOOLS TAB */}
      {subtab === 'system' && (
        <div className="system-tools-list">
          {filteredSystemTools.map((t) => (
            <div key={t.id} className="tool-card-row system-card-row">
              <div className="tool-card-info">
                <h4>{t.name}</h4>
                <p>{t.desc}</p>
              </div>
              <label className="toggle-switch">
                <input 
                  type="checkbox" 
                  checked={t.enabled}
                  onChange={(e) => onToggleSystemTool(t.id, e.target.checked)}
                />
                <span className="slider"></span>
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ToolsStudio;
