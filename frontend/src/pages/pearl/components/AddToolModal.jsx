import React, { useEffect } from 'react';
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
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="tool-modal-backdrop" onClick={onClose}>
      <div className="tool-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="tool-modal-header">
          <div>
            <div className="tool-modal-badge">
              <Sparkles size={12} />
              <span>Tool Library</span>
            </div>
            <h2 className="tool-modal-title">Add a Tool</h2>
            <p className="tool-modal-subtitle">
              Equip your agent with real-time external actions, input format verification, and customer record matching.
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

        {/* Clean Minimalist Cards Grid */}
        <div className="tool-cards-grid">
          {TOOL_TEMPLATES.map((tmpl) => {
            const Icon = tmpl.icon || ICON_MAP[tmpl.type] || Globe;
            return (
              <div 
                key={tmpl.type}
                className="tool-selection-card"
                onClick={() => onSelectToolType(tmpl)}
              >
                <div className="tool-card-top">
                  <div className="tool-card-icon-wrap">
                    <Icon size={19} />
                  </div>
                  {tmpl.badge && (
                    <span className="tool-card-micro-badge">
                      {tmpl.badge}
                    </span>
                  )}
                </div>

                <div className="tool-card-text">
                  <h3 className="tool-card-title">{tmpl.title}</h3>
                  <div className="tool-card-subheading">{tmpl.subtitle}</div>
                  <p className="tool-card-desc">{tmpl.description}</p>
                </div>

                <div className="tool-card-footer">
                  <span className="tool-card-select-label">Configure Tool</span>
                  <div className="tool-card-arrow">
                    <ArrowRight size={13} />
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
