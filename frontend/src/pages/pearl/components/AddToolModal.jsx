import React, { useId } from 'react';
import {
  X, Link2, Check, Shield, Layers, Cable
} from 'lucide-react';
import './ToolsStudio.css';
import { TOOL_TEMPLATES } from '../../../data/toolTemplates.js';
import { buttonRoleProps, useBackdropDismiss, useDialogA11y } from '../lib/a11y.js';

const ICON_MAP = {
  api_tool: Link2,
  data_validator: Check,
  data_verifier: Shield,
  mock_api: Layers,
  mcp: Cable
};

export const AddToolModal = React.memo(({ isOpen, onClose, onSelectToolType }) => {
  const titleId = useId();
  // Dialog semantics: focus moves in and is trapped, Esc closes, focus returns to the opener.
  const { ref: dialogRef, dialogProps } = useDialogA11y(Boolean(isOpen), onClose);
  const backdropProps = useBackdropDismiss(onClose);

  if (!isOpen) return null;

  return (
    <div className="tool-modal-backdrop" {...backdropProps}>
      <div
        className="tool-modal-card"
        ref={dialogRef}
        {...dialogProps}
        aria-labelledby={titleId}
      >
        {/* Header - Minimalist, no artificial badges or clutter */}
        <div className="tool-modal-header">
          <h2 className="tool-modal-title" id={titleId}>Add a tool</h2>
          <button
            type="button"
            className="tool-btn-close"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
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
                {...buttonRoleProps(() => onSelectToolType(tmpl), { label: `${tmpl.title}: ${tmpl.description}` })}
              >
                <div className="tool-card-icon-squircle" aria-hidden="true">
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
