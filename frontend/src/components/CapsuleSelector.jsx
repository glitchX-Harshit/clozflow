import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Check, Search, X, Database, Sparkles, Tag, ShieldCheck } from 'lucide-react';
import gsap from 'gsap';
import './CapsuleSelector.css';

const CapsuleSelector = ({ 
  capsules = [], 
  value, 
  onChange, 
  placeholder = 'Select Product Knowledge Capsule...' 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);
  const chevronRef = useRef(null);
  const inputRef = useRef(null);

  // Active Capsule resolution
  const activeCapsule = useMemo(() => {
    if (!value) return null;
    return capsules.find(c => String(c.id) === String(value)) || null;
  }, [capsules, value]);

  // Filtered capsules
  const filtered = useMemo(() => {
    if (!search.trim()) return capsules;
    const q = search.toLowerCase().trim();
    return capsules.filter(c => 
      c.name?.toLowerCase().includes(q) ||
      c.product_name?.toLowerCase().includes(q) ||
      c.target_audience?.toLowerCase().includes(q) ||
      c.product_price?.toLowerCase().includes(q)
    );
  }, [capsules, search]);

  // GSAP animation for dropdown toggle
  useEffect(() => {
    if (chevronRef.current) {
      gsap.to(chevronRef.current, {
        rotate: isOpen ? 180 : 0,
        duration: 0.22,
        ease: 'power2.out'
      });
    }

    if (isOpen && dropdownRef.current) {
      gsap.fromTo(dropdownRef.current,
        { opacity: 0, y: -6, scale: 0.99 },
        { opacity: 1, y: 0, scale: 1, duration: 0.22, ease: 'power2.out' }
      );
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  }, [isOpen]);

  // Outside click & keyboard dismiss
  useEffect(() => {
    const handleOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleOutside);
      document.addEventListener('keydown', handleKey);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  const handleSelect = (id) => {
    onChange(id);
    setIsOpen(false);
    setSearch('');
  };

  return (
    <div className="capsule-select-wrap" ref={containerRef}>
      {/* ── LUXURY TRIGGER ── */}
      <button
        type="button"
        className={`capsule-select-trigger ${isOpen ? 'is-open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <div className="capsule-trigger-left">
          <div className="capsule-trigger-icon-box">
            <Database size={15} />
          </div>

          {activeCapsule ? (
            <div className="capsule-trigger-info">
              <div className="capsule-trigger-title-row">
                <span className="capsule-trigger-name">{activeCapsule.name}</span>
                {activeCapsule.is_default && (
                  <span className="capsule-pill-default">Default</span>
                )}
                {activeCapsule.product_price && (
                  <span className="capsule-pill-price">{activeCapsule.product_price}</span>
                )}
              </div>
              <span className="capsule-trigger-sub">
                {activeCapsule.product_name} &bull; {activeCapsule.target_audience || 'Zero-hallucination verified'}
              </span>
            </div>
          ) : (
            <div className="capsule-trigger-info">
              <span className="capsule-trigger-placeholder">
                No Knowledge Capsule (Generic Outbound Script)
              </span>
              <span className="capsule-trigger-sub">
                Click to attach factual product knowledge, specs, and battlecards
              </span>
            </div>
          )}
        </div>

        <div className="capsule-trigger-right">
          {activeCapsule && (
            <span className="capsule-verified-tag">
              <ShieldCheck size={12} />
              <span>Grounded</span>
            </span>
          )}
          <span ref={chevronRef} className="capsule-chevron-wrap">
            <ChevronDown size={14} strokeWidth={2} />
          </span>
        </div>
      </button>

      {/* ── DROPDOWN MENU ── */}
      {isOpen && (
        <div 
          className="capsule-dropdown-panel" 
          ref={dropdownRef} 
          role="listbox"
          data-lenis-prevent
        >
          {/* Search Header */}
          <div className="capsule-search-header">
            <div className="capsule-search-box">
              <Search size={13} className="capsule-search-icon" />
              <input
                ref={inputRef}
                type="text"
                className="capsule-search-input"
                placeholder="Search capsules by product, audience, or price..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search ? (
                <button 
                  type="button" 
                  className="capsule-clear-search" 
                  onClick={() => setSearch('')}
                >
                  <X size={12} />
                </button>
              ) : (
                <span className="capsule-kbd-hint">ESC</span>
              )}
            </div>
          </div>

          {/* Options Container */}
          <div 
            className="capsule-options-container" 
            data-lenis-prevent
            onWheel={(e) => e.stopPropagation()}
          >
            {/* "None" Option */}
            <div
              role="option"
              aria-selected={!value}
              className={`capsule-option-row ${!value ? 'is-selected' : ''}`}
              onClick={() => handleSelect('')}
            >
              <div className="capsule-option-left">
                <div className="capsule-option-icon-box off">
                  <Database size={13} />
                </div>
                <div className="capsule-option-details">
                  <span className="capsule-option-name">No Capsule Attached</span>
                  <span className="capsule-option-desc">Uses generic prompt directives without specific product grounding</span>
                </div>
              </div>
              {!value && (
                <span className="capsule-check-badge">
                  <Check size={13} strokeWidth={2.5} />
                </span>
              )}
            </div>

            {/* Separator */}
            <div className="capsule-options-sep" />

            {/* Capsule List */}
            {filtered.length === 0 ? (
              <div className="capsule-empty-state">
                <span>No matching capsules found</span>
              </div>
            ) : (
              filtered.map((cap) => {
                const isSelected = String(cap.id) === String(value);
                return (
                  <div
                    key={cap.id}
                    role="option"
                    aria-selected={isSelected}
                    className={`capsule-option-row ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => handleSelect(cap.id)}
                  >
                    <div className="capsule-option-left">
                      <div className="capsule-option-icon-box active">
                        <Database size={13} />
                      </div>
                      <div className="capsule-option-details">
                        <div className="capsule-option-heading">
                          <span className="capsule-option-name">{cap.name}</span>
                          {cap.is_default && (
                            <span className="capsule-pill-default">Default</span>
                          )}
                          {cap.product_price && (
                            <span className="capsule-pill-price">{cap.product_price}</span>
                          )}
                        </div>
                        <span className="capsule-option-desc">
                          {cap.product_name} &bull; {cap.target_audience || 'Audience not set'}
                        </span>
                        {cap.pain_points_solved && (
                          <span className="capsule-option-snippet">
                            Key Pain: {cap.pain_points_solved.slice(0, 85)}...
                          </span>
                        )}
                      </div>
                    </div>

                    {isSelected && (
                      <span className="capsule-check-badge">
                        <Check size={13} strokeWidth={2.5} />
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CapsuleSelector;
