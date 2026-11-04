import React, { useState } from 'react';
import { 
  X, Landmark, ShieldCheck, ShoppingCart, Building2, Truck, 
  Sparkles, Check, ArrowRight, Mic, Braces, MessageSquare, Shield,
  Search, CheckCircle2, ChevronRight
} from 'lucide-react';
import { SALES_ARCHETYPES } from '../data/salesArchetypes';
import { parseVariableSegments } from '../utils/variableParser';
import './ArchetypeLibraryModal.css';

const ICON_MAP = {
  Landmark: Landmark,
  ShieldCheck: ShieldCheck,
  ShoppingCart: ShoppingCart,
  Building2: Building2,
  Truck: Truck
};

export const ArchetypeLibraryModal = ({ isOpen, onClose, onApplyArchetype, currentArchetypeId }) => {
  const [selectedId, setSelectedId] = useState(currentArchetypeId || SALES_ARCHETYPES[0].id);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('All');

  if (!isOpen) return null;

  const categories = ['All', 'Fintech & Lending', 'D2C & E-Commerce', 'High-Ticket E-Commerce', 'B2B & SaaS', 'Logistics & 3PL'];

  const filtered = SALES_ARCHETYPES.filter(a => {
    const matchesCat = filterCategory === 'All' || a.category === filterCategory;
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch = !q || 
      a.name.toLowerCase().includes(q) ||
      (a.shortName && a.shortName.toLowerCase().includes(q)) ||
      (a.badge && a.badge.toLowerCase().includes(q)) ||
      a.vertical.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q) ||
      (a.mission && a.mission.toLowerCase().includes(q));
    return matchesCat && matchesSearch;
  });

  const activeArchetype = SALES_ARCHETYPES.find(a => a.id === selectedId) || SALES_ARCHETYPES[0];
  const IconComponent = ICON_MAP[activeArchetype.icon] || Landmark;
  const greetingSegments = parseVariableSegments(activeArchetype.greeting);

  const handleApply = () => {
    onApplyArchetype(activeArchetype);
    onClose();
  };

  return (
    <div className="archetype-modal-backdrop" onClick={onClose}>
      <div className="archetype-modal-window" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="archetype-modal-header">
          <div className="archetype-modal-header-left">
            <div className="archetype-modal-icon-orb">
              <Sparkles size={18} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 className="archetype-modal-title">Sales Archetype Library</h3>
                <span className="archetype-header-badge">Production Ready</span>
              </div>
              <p className="archetype-modal-sub">
                Pre-configured conversational sales blueprints for high-velocity Indian business models.
              </p>
            </div>
          </div>
          <button type="button" className="archetype-modal-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Content Body: Sidebar list + Detail View */}
        <div className="archetype-modal-body">
          {/* Left Sidebar List */}
          <div className="archetype-modal-sidebar">
            {/* Search & Filter */}
            <div className="archetype-sidebar-search">
              <Search size={14} color="#94a3b8" />
              <input 
                type="text" 
                placeholder="Search archetypes..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="archetype-sidebar-pills">
              {categories.map(cat => (
                <button
                  key={cat}
                  type="button"
                  className={`archetype-sidebar-pill ${filterCategory === cat ? 'active' : ''}`}
                  onClick={() => setFilterCategory(cat)}
                >
                  {cat === 'High-Ticket E-Commerce' ? 'High-Ticket' : cat}
                </button>
              ))}
            </div>

            {/* List */}
            <div className="archetype-sidebar-list">
              {filtered.map(arch => {
                const ItemIcon = ICON_MAP[arch.icon] || Landmark;
                const isSelected = arch.id === selectedId;

                return (
                  <div 
                    key={arch.id}
                    className={`archetype-sidebar-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedId(arch.id)}
                  >
                    <div className="archetype-item-icon-box" style={{ background: isSelected ? '#0f172a' : '#f1f5f9', color: isSelected ? '#ffffff' : arch.accentColor }}>
                      <ItemIcon size={16} />
                    </div>
                    <div className="archetype-item-info">
                      <div className="archetype-item-top">
                        <span className="archetype-item-name">{arch.name}</span>
                      </div>
                      <span className="archetype-item-badge">{arch.badge}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Detail Pane */}
          <div className="archetype-modal-detail">
            <div className="archetype-detail-top">
              <div className="archetype-detail-crest">
                <div className="archetype-detail-icon-wrap" style={{ background: `${activeArchetype.accentColor}15`, color: activeArchetype.accentColor }}>
                  <IconComponent size={24} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="archetype-detail-badge" style={{ color: activeArchetype.accentColor, borderColor: `${activeArchetype.accentColor}33`, background: `${activeArchetype.accentColor}10` }}>
                      {activeArchetype.badge}
                    </span>
                    <span className="archetype-detail-cat">{activeArchetype.category}</span>
                  </div>
                  <h2 className="archetype-detail-title">{activeArchetype.name}</h2>
                </div>
              </div>

              <button 
                type="button" 
                className="archetype-btn-apply"
                onClick={handleApply}
              >
                <Check size={16} />
                <span>Apply Archetype</span>
              </button>
            </div>

            <p className="archetype-detail-mission">
              <strong>Mission:</strong> {activeArchetype.mission}
            </p>

            {/* Target Verticals & Recommended Voices */}
            <div className="archetype-detail-grid">
              <div className="archetype-detail-box">
                <span className="detail-box-label">Target Industry & Verticals</span>
                <p className="detail-box-val">{activeArchetype.vertical}</p>
              </div>

              <div className="archetype-detail-box">
                <span className="detail-box-label">Recommended Voice Engine</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <Mic size={14} color="#2563eb" />
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', color: '#0f172a' }}>
                    {activeArchetype.recommendedVoices?.[0]?.name || 'Ritu'}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    ({activeArchetype.defaultLanguage} · Bulbul v4)
                  </span>
                </div>
              </div>
            </div>

            {/* Opening Greeting Preview with Variable Highlighting */}
            <div className="archetype-preview-section">
              <div className="preview-section-title">
                <MessageSquare size={14} color="#0f172a" />
                <span>2-Yes Fixed Opening Script Preview</span>
              </div>
              <div className="archetype-greeting-box">
                {greetingSegments.map((seg, idx) => {
                  if (seg.type === 'variable') {
                    return (
                      <span key={idx} className="archetype-var-token" title={`Fallback: "${seg.fallback}"`}>
                        {seg.name}
                        {seg.fallback && <span className="token-fallback">| "{seg.fallback}"</span>}
                      </span>
                    );
                  }
                  return <span key={idx}>{seg.content}</span>;
                })}
              </div>
            </div>

            {/* Supported Dynamic Variables */}
            <div className="archetype-preview-section">
              <div className="preview-section-title">
                <Braces size={14} color="#0f172a" />
                <span>Supported Dynamic Variables ({activeArchetype.supportedVariables?.length || 0})</span>
              </div>
              <div className="archetype-vars-grid">
                {activeArchetype.supportedVariables?.map(v => (
                  <div key={v.name} className="archetype-var-card">
                    <span className="var-card-name">{`{{${v.name}}}`}</span>
                    <span className="var-card-sample">Sample: {v.sampleValue}</span>
                    <span className="var-card-fallback">Fallback: "{v.fallback}"</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Objection Playbooks */}
            <div className="archetype-preview-section">
              <div className="preview-section-title">
                <Shield size={14} color="#0f172a" />
                <span>Pre-Trained Objection Handlers</span>
              </div>
              <div className="archetype-objections-list">
                {activeArchetype.objectionPlaybooks?.map((obj, i) => (
                  <div key={i} className="archetype-obj-item">
                    <div className="obj-header">
                      <span className="obj-q">Objection: "{obj.objection}"</span>
                    </div>
                    <p className="obj-script">{obj.script}</p>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

export default ArchetypeLibraryModal;
