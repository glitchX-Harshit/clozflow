import React, { useState } from 'react';
import { 
  Landmark, ShieldCheck, ShoppingCart, Building2, Truck, 
  Sparkles, ArrowRight, Mic, Braces
} from 'lucide-react';
import { SALES_ARCHETYPES } from '../data/salesArchetypes';
import './ArchetypeShowcase.css';

const ICON_MAP = {
  Landmark: Landmark,
  ShieldCheck: ShieldCheck,
  ShoppingCart: ShoppingCart,
  Building2: Building2,
  Truck: Truck
};

export const ArchetypeShowcase = ({ onSelectArchetype }) => {
  const [selectedCategory, setSelectedCategory] = useState('All');

  const categories = ['All', 'Fintech & Lending', 'D2C & E-Commerce', 'High-Ticket E-Commerce', 'B2B & SaaS', 'Logistics & 3PL'];

  const filteredArchetypes = selectedCategory === 'All'
    ? SALES_ARCHETYPES
    : SALES_ARCHETYPES.filter(a => a.category === selectedCategory);

  return (
    <div className="archetype-showcase-container animate-fade-in">
      <div className="archetype-showcase-header">
        <div className="archetype-showcase-title-row">
          <div className="archetype-showcase-icon-badge">
            <Sparkles size={16} />
          </div>
          <div>
            <div className="archetype-showcase-headline">
              <h3>Explore Sales Archetypes</h3>
              <span className="archetype-verified-pill">5 Enterprise Blueprints</span>
            </div>
            <p className="archetype-showcase-subtitle">
              Launch revenue-generating conversational engines with adaptive objection handling, graceful call-cut rules, and native Indic voices.
            </p>
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="archetype-category-pills">
          {categories.map(cat => (
            <button
              key={cat}
              type="button"
              className={`archetype-category-pill ${selectedCategory === cat ? 'active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Cards Grid */}
      <div className="archetype-cards-grid">
        {filteredArchetypes.map(archetype => {
          const IconComp = ICON_MAP[archetype.icon] || Landmark;
          const varCount = (archetype.supportedVariables || []).length;
          const primaryVoice = archetype.recommendedVoices?.[0]?.name || 'Ritu';
          const voiceDialect = archetype.recommendedVoices?.[0]?.language || archetype.defaultLanguage;

          return (
            <div 
              key={archetype.id} 
              className="archetype-card"
            >
              <div className="archetype-card-badge-row">
                <span className="archetype-badge-pill">
                  {archetype.badge}
                </span>
                <span className="archetype-vertical-text">{archetype.category}</span>
              </div>

              <div className="archetype-card-body">
                <div className="archetype-icon-box">
                  <IconComp size={17} strokeWidth={1.8} />
                </div>
                <div className="archetype-card-content">
                  <h4 className="archetype-card-title">{archetype.name}</h4>
                  <p className="archetype-card-desc">{archetype.description}</p>
                </div>
              </div>

              <div className="archetype-card-meta-chips">
                <div className="archetype-meta-chip" title={`Recommended Voice: ${primaryVoice}`}>
                  <Mic size={11} className="chip-ico" />
                  <span>{primaryVoice}</span>
                  <span className="chip-sub">· {voiceDialect}</span>
                </div>
                <div className="archetype-meta-chip" title={`${varCount} Dynamic Variables Supported`}>
                  <Braces size={11} className="chip-ico" />
                  <span>{varCount} Tokens</span>
                </div>
              </div>

              <div className="archetype-card-footer">
                <button
                  type="button"
                  className="archetype-btn-use"
                  onClick={() => onSelectArchetype(archetype.id)}
                  title={`Initialize new agent with ${archetype.name} template`}
                >
                  <span>Use Template</span>
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ArchetypeShowcase;
