import React, { useEffect } from 'react';
import { 
  X, Link2, Check, Shield, Layers, Cable
} from 'lucide-react';
import './ToolsStudio.css';
import { TOOL_TEMPLATES } from '../../../data/toolTemplates.js';

const ICON_MAP = {
  api_tool: Link2,
  data_validator: Check,
  data_verifier: Shield,
  mock_api: Layers,
  mcp: Cable
};

export const AddToolModal = React.memo(({ isOpen, onClose, onSelectToolType }) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="tool-modal-backdrop" onClick={onClose}>
      <div className="tool-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header - Minimalist, no artificial badges or clutter */}
        <div className="tool-modal-header">
          <h2 className="tool-modal-title">Add a tool</h2>
          <button 
            type="button" 
            className="tool-btn-close"
            onClick={onClose}
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Clean, Non-Technical Card Grid matching Tier-1 SaaS benchmark */}
        <div className="tool-cards-grid">
          {TOOL_TEMPLATES.map((tmpl) => {
            const Icon = ICON_MAP[tmpl.type] || Link2;
            return (
              <div 
                key={tmpl.type}
                className="tool-selection-card"
                onClick={() => onSelectToolType(tmpl)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectToolType(tmpl);
                  }
                }}
              >
                <div className="tool-card-icon-squircle">
                  <Icon size={18} strokeWidth={1.9} />
                </div>

                <div className="tool-card-content">
                  <h3 className="tool-card-title">{tmpl.title}</h3>
                  <p className="tool-card-desc">{tmpl.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

export default AddToolModal;
export { TOOL_TEMPLATES };
