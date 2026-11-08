import React, { useState, useMemo, useCallback } from 'react';
import { 
  Plus, Search, Link2, Check, Shield, Layers, Cable,
  Play, Trash2, ExternalLink
} from 'lucide-react';
import './ToolsStudio.css';

const getToolIcon = (type) => {
  switch (type) {
    case 'api_tool': return <Link2 size={16} strokeWidth={1.9} />;
    case 'data_validator': return <Check size={16} strokeWidth={2} />;
    case 'data_verifier': return <Shield size={16} strokeWidth={1.9} />;
    case 'mock_api': return <Layers size={16} strokeWidth={1.9} />;
    case 'mcp': return <Cable size={16} strokeWidth={1.9} />;
    default: return <Link2 size={16} strokeWidth={1.9} />;
  }
};

const getMethodBadge = (tool) => {
  if (tool.tool_type === 'api_tool') {
    const m = (tool.config?.method || 'POST').toUpperCase();
    return <span className="badge-method">{m}</span>;
  }
  if (tool.tool_type === 'mock_api') {
    return <span className="badge-method">MOCK</span>;
  }
  if (tool.tool_type === 'data_validator') {
    const preset = tool.config?.preset || 'validator';
    const cleanLabel = preset === 'indian_phone' ? 'PHONE' 
      : preset === 'pan_card' ? 'PAN' 
      : preset === 'pincode' ? 'PINCODE' 
      : preset === 'email' ? 'EMAIL' 
      : preset === 'aadhaar_last4' ? 'AADHAAR' 
      : 'VALIDATOR';
    return <span className="badge-method">{cleanLabel}</span>;
  }
  if (tool.tool_type === 'data_verifier') {
    return <span className="badge-method">VERIFIER</span>;
  }
  if (tool.tool_type === 'mcp') {
    return <span className="badge-method">MCP</span>;
  }
  return <span className="badge-method">TOOL</span>;
};

const getTimingLabel = (timing) => {
  switch (timing) {
    case 'call_start': return 'Call Start';
    case 'call_end': return 'Call End';
    default: return 'In-Call';
  }
};

const VALIDATOR_PRESET_NAMES = {
  indian_phone: 'Indian Phone Number',
  email: 'Email Address',
  pincode: '6-digit PIN Code',
  pan_card: 'PAN Card Number',
  aadhaar_last4: 'Aadhaar Last 4'
};

const getToolFriendlySummary = (tool) => {
  if (tool.description && tool.description.trim()) return tool.description;
  if (tool.tool_type === 'api_tool') {
    return tool.config?.url ? `Connects to ${tool.config.method || 'POST'} ${tool.config.url}` : 'Connects to an external REST endpoint';
  }
  if (tool.tool_type === 'mock_api') return 'Simulated mock response with return fields';
  if (tool.tool_type === 'data_validator') {
    const preset = tool.config?.preset || 'indian_phone';
    return `Validates format for ${VALIDATOR_PRESET_NAMES[preset] || 'input data'}`;
  }
  if (tool.tool_type === 'data_verifier') {
    const mode = tool.config?.match_mode === 'last_n' ? `last ${tool.config?.match_n || 4} chars`
      : tool.config?.match_mode === 'first_n' ? `first ${tool.config?.match_n || 4} chars`
      : tool.config?.match_mode === 'contains' ? 'contains match'
      : tool.config?.match_mode === 'date_equals' ? 'date match'
      : 'exact match';
    const ref = tool.config?.reference_value || tool.config?.reference_source || 'record on file';
    return `Verifies caller input (${mode}) against ${ref}`;
  }
  if (tool.tool_type === 'mcp') return 'Model Context Protocol integration';
  return 'Custom agent tool';
};

const ToolCardRow = React.memo(({ tool, onEditTool, onToggleToolActive, onDeleteTool }) => {
  const handleCardClick = useCallback(() => {
    onEditTool(tool);
  }, [onEditTool, tool]);

  const handleTestClick = useCallback((e) => {
    e.stopPropagation();
    onEditTool(tool);
  }, [onEditTool, tool]);

  const handleToggle = useCallback((e) => {
    onToggleToolActive(tool.id, e.target.checked);
  }, [onToggleToolActive, tool.id]);

  const handleDelete = useCallback((e) => {
    e.stopPropagation();
    if (window.confirm(`Delete tool "${tool.name}"?`)) {
      onDeleteTool(tool.id);
    }
  }, [onDeleteTool, tool.id, tool.name]);

  return (
    <div 
      className={`tool-card-row-interactive ${tool.is_active === false ? 'is-disabled' : ''}`}
      onClick={handleCardClick}
    >
      <div className="tool-row-left">
        <div className="tool-type-icon-box">
          {getToolIcon(tool.tool_type)}
        </div>
        <div className="tool-row-info">
          <div className="tool-row-title-bar">
            {getMethodBadge(tool)}
            <h4 className="tool-row-name">{tool.name}</h4>
            <span className={`tool-mode-chip ${tool.run_mode === 'read' || tool.is_read_tool ? 'is-read' : 'is-write'}`}>
              {tool.run_mode === 'read' || tool.is_read_tool ? 'Pattern B (Read)' : 'Pattern A (Write)'}
            </span>
            <span className="tool-timing-chip">
              {getTimingLabel(tool.run_timing)}
            </span>
          </div>
          <p className="tool-row-desc">
            {getToolFriendlySummary(tool)}
          </p>
        </div>
      </div>

      <div className="tool-row-right" onClick={(e) => e.stopPropagation()}>
        <button 
          type="button" 
          className="btn-row-test"
          title="Test this tool"
          onClick={handleTestClick}
        >
          <Play size={12} />
          <span>Test</span>
        </button>

        <label className="toggle-switch" title={tool.is_active !== false ? 'Disable tool' : 'Enable tool'}>
          <input 
            type="checkbox" 
            checked={tool.is_active !== false}
            onChange={handleToggle}
          />
          <span className="slider"></span>
        </label>

        <button 
          type="button" 
          className="btn-row-action-icon"
          title="Delete tool"
          onClick={handleDelete}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
});

const SystemToolRow = React.memo(({ tool, onToggleSystemTool }) => {
  const handleToggle = useCallback((e) => {
    onToggleSystemTool(tool.id, e.target.checked);
  }, [onToggleSystemTool, tool.id]);

  return (
    <div className="tool-card-row system-card-row">
      <div className="tool-card-info">
        <h4>{tool.name}</h4>
        <p>{tool.desc}</p>
      </div>
      <label className="toggle-switch">
        <input 
          type="checkbox" 
          checked={tool.enabled}
          onChange={handleToggle}
        />
        <span className="slider"></span>
      </label>
    </div>
  );
});

export const ToolsStudio = React.memo(({
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
                <ToolCardRow
                  key={t.id || t.name}
                  tool={t}
                  onEditTool={onEditTool}
                  onToggleToolActive={onToggleToolActive}
                  onDeleteTool={onDeleteTool}
                />
              ))}
            </div>
          ) : (
            /* Empty State */
            <div className="tools-empty-state-card">
              <div className="tools-empty-illustration-wrap">
                <Link2 size={24} />
              </div>
              <h3 className="tools-empty-title">Let your agent take action</h3>
              <p className="tools-empty-desc">
                Your agent can look up caller orders via APIs, verify customer phone and PAN numbers against CRM records, and bring results directly into conversational turns.
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
            <SystemToolRow
              key={t.id}
              tool={t}
              onToggleSystemTool={onToggleSystemTool}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default ToolsStudio;
