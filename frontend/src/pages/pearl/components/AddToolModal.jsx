import React from 'react';
import { 
  X, Globe, CheckCircle2, Database, Sliders, 
  Wrench, ArrowRight, ShieldCheck, Cpu, Code2, Sparkles
} from 'lucide-react';
import './ToolsStudio.css';
import { TOOL_TEMPLATES } from '../../../data/toolTemplates.js';

const ICON_MAP = {
  api_tool: Globe,
  data_validator: ShieldCheck,
  data_verifier: Database,
  mock_api: Sliders,
  mcp: Cpu
};


export const AddToolModal = ({ isOpen, onClose, onSelectToolType }) => {
  if (!isOpen) return null;

  return (
    <div className="tool-modal-backdrop" onClick={onClose}>
      <div className="tool-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="tool-modal-header">
          <div>
            <div className="tool-modal-badge">
              <Sparkles size={13} />
              <span>Agent Action Capabilities</span>
            </div>
            <h2 className="tool-modal-title">Add a Tool</h2>
            <p className="tool-modal-subtitle">
              Choose a tool module to equip your agent with real-time external actions, data validation, and database verification.
            </p>
          </div>
          <button 
            type="button" 
            className="tool-btn-close"
            onClick={onClose}
            title="Close modal (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* 5 Cards Grid */}
        <div className="tool-cards-grid">
          {TOOL_TEMPLATES.map((tmpl) => {
            const Icon = tmpl.icon || ICON_MAP[tmpl.type] || Globe;
            return (
              <div 
                key={tmpl.type}
                className={`tool-selection-card card-${tmpl.badgeColor}`}
                onClick={() => onSelectToolType(tmpl)}
              >
                <div className="tool-card-top">
                  <div className={`tool-card-icon-wrap icon-${tmpl.badgeColor}`}>
                    <Icon size={22} />
                  </div>
                  <span className={`tool-badge-pill pill-${tmpl.badgeColor}`}>
                    {tmpl.badge}
                  </span>
                </div>

                <div className="tool-card-text">
                  <h3 className="tool-card-title">{tmpl.title}</h3>
                  <div className="tool-card-subheading">{tmpl.subtitle}</div>
                  <p className="tool-card-desc">{tmpl.description}</p>
                </div>

                <div className="tool-card-tags">
                  {tmpl.tags.map((tag) => (
                    <span key={tag} className="tool-tag-chip">
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="tool-card-footer">
                  <span className="tool-card-select-label">Configure Tool</span>
                  <div className="tool-card-arrow">
                    <ArrowRight size={14} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default AddToolModal;
export { TOOL_TEMPLATES };
