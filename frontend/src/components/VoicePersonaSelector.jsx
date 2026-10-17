import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Check, Search, X } from 'lucide-react';
import gsap from 'gsap';
import './VoicePersonaSelector.css';

export const CLOZFLOW_VOICE_LIST = [
  { id: 'shubh_enhi_ads', name: 'Shubh', gender: 'Male', language: 'Hinglish', category: 'Sales & Ads', style: 'Hinglish · Outbound Pitch & High-Energy Ads' },
  { id: 'ritu_hi_customer', name: 'Ritu', gender: 'Female', language: 'Hindi', category: 'Support & Care', style: 'Hindi · Customer Support & Advisory' },
  { id: 'simran_en_customer', name: 'Simran', gender: 'Female', language: 'Indian English', category: 'Support & Care', style: 'English · Customer Care & Qualification' },
  { id: 'priya_hi_recovery', name: 'Priya', gender: 'Female', language: 'Hindi', category: 'Debt & Recovery', style: 'Hindi · Debt Recovery & Direct Follow-up' },
  { id: 'rohan_en_recovery', name: 'Rohan', gender: 'Male', language: 'Indian English', category: 'Debt & Recovery', style: 'English · Enterprise Recovery & Sales' },
  { id: 'kavya_en_conversational', name: 'Kavya', gender: 'Female', language: 'Indian English', category: 'Conversational', style: 'English · Warm Conversational & Discovery' },
  { id: 'rahul_en_conversational', name: 'Rahul', gender: 'Male', language: 'Hinglish/English', category: 'B2B Sales', style: 'Hinglish/English · B2B Sales & Demo Booking' },
  { id: 'aditya_en_conversational', name: 'Aditya', gender: 'Male', language: 'Indian English', category: 'Executive', style: 'English · Executive Gravitas & Strategy' },
  { id: 'ishita_en_customer', name: 'Ishita', gender: 'Female', language: 'Indian English', category: 'Support & Care', style: 'English · Empathetic Support & Care' },
  { id: 'dev_en_recovery', name: 'Dev', gender: 'Male', language: 'Indian English', category: 'Closing & Recovery', style: 'English · Assertive Challenge & Closing' },
  { id: 'anand_hi_news', name: 'Anand', gender: 'Male', language: 'Hindi', category: 'Executive', style: 'Hindi · Formal & Operational Presentation' },
  { id: 'neha_hi_customer', name: 'Neha', gender: 'Female', language: 'Hindi', category: 'Support & Care', style: 'Hindi · Warm Retention & Relationship' },
  { id: 'pooja_hi_conversational', name: 'Pooja', gender: 'Female', language: 'Hindi', category: 'Conversational', style: 'Hindi · Gentle & Persuasive Conversation' },
  { id: 'tarun_en_conversational', name: 'Tarun', gender: 'Male', language: 'Indian English', category: 'Conversational', style: 'English · Polished & Focused Discovery' },
  { id: 'sumit_enhi_ads', name: 'Sumit', gender: 'Male', language: 'Hinglish', category: 'Sales & Ads', style: 'Hinglish · Calm Professional Pitch' },
  { id: 'kabir_enhi_ads', name: 'Kabir', gender: 'Male', language: 'Hinglish', category: 'Sales & Ads', style: 'Hinglish · Bold & Dynamic Campaign' },
  { id: 'aayan_en_conversational', name: 'Aayan', gender: 'Male', language: 'Indian English', category: 'Conversational', style: 'English · Natural & Confident Dialogue' },
  { id: 'shreya_en_conversational', name: 'Shreya', gender: 'Female', language: 'Indian English', category: 'Conversational', style: 'English · Dynamic & Fast-Paced Closer' },
  { id: 'varun_en_conversational', name: 'Varun', gender: 'Male', language: 'Indian English', category: 'Consulting', style: 'English · Strategic & Composed Consultation' },
  { id: 'shruti_hi_customer', name: 'Shruti', gender: 'Female', language: 'Hindi', category: 'Support & Care', style: 'Hindi · Bright & Explanatory Support' },
  { id: 'mohit_hi_recovery', name: 'Mohit', gender: 'Male', language: 'Hindi', category: 'Debt & Recovery', style: 'Hindi · Resilient & Paced Reminders' },
  { id: 'suhani_hi_conversational', name: 'Suhani', gender: 'Female', language: 'Hindi', category: 'Conversational', style: 'Hindi · Engaging & Conversational Partner' },
  { id: 'rehan_en_conversational', name: 'Rehan', gender: 'Male', language: 'Indian English', category: 'B2B Sales', style: 'English · Smooth & Strategic Closer' },
  { id: 'rupali_hi_customer', name: 'Rupali', gender: 'Female', language: 'Hindi', category: 'Support & Care', style: 'Hindi · Trustworthy & Reassuring Support' }
];

export const SARVAM_VOICE_LIST = CLOZFLOW_VOICE_LIST;

const VoicePersonaSelector = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | female | male
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const containerRef = useRef(null);
  const dropdownRef = useRef(null);
  const chevronRef = useRef(null);
  const inputRef = useRef(null);

  // Active voice
  const activeVoice = useMemo(() => {
    if (!value) return CLOZFLOW_VOICE_LIST[0];
    const valLower = value.toLowerCase().trim();
    const exact = CLOZFLOW_VOICE_LIST.find(v => v.id.toLowerCase() === valLower);
    if (exact) return exact;
    const prefixMatch = CLOZFLOW_VOICE_LIST.find(v => v.id.toLowerCase().startsWith(valLower + '_'));
    if (prefixMatch) return prefixMatch;
    const nameMatch = CLOZFLOW_VOICE_LIST.find(v => v.name.toLowerCase() === valLower);
    if (nameMatch) return nameMatch;
    return CLOZFLOW_VOICE_LIST[0];
  }, [value]);

  // Filtered voice list
  const filtered = useMemo(() => {
    return CLOZFLOW_VOICE_LIST.filter(v => {
      if (filter === 'female' && v.gender !== 'Female') return false;
      if (filter === 'male' && v.gender !== 'Male') return false;
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        return (
          v.name.toLowerCase().includes(q) ||
          v.style.toLowerCase().includes(q) ||
          v.gender.toLowerCase().includes(q) ||
          (v.language && v.language.toLowerCase().includes(q)) ||
          (v.category && v.category.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [filter, search]);

  // GSAP animation for dropdown toggle
  useEffect(() => {
    if (chevronRef.current) {
      gsap.to(chevronRef.current, {
        rotate: isOpen ? 180 : 0,
        duration: 0.24,
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

  const handleSelect = (voiceId) => {
    onChange(voiceId);
    setIsOpen(false);
    setSearch('');
  };

  return (
    <div className="aw-voice-select-wrap" ref={containerRef}>
      {/* ── MINIMAL TRIGGER ── */}
      <button
        type="button"
        className={`aw-voice-trigger ${isOpen ? 'is-open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <div className="aw-trigger-left">
          <span className="aw-voice-name">{activeVoice.name}</span>
          <span className="aw-voice-sep">·</span>
          <span className="aw-voice-meta">{activeVoice.gender}</span>
          <span className="aw-voice-sep">·</span>
          <span style={{ fontSize: '0.78rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '240px' }}>
            {activeVoice.style}
          </span>
        </div>

        <div className="aw-trigger-right">
          <span ref={chevronRef} className="aw-chevron-wrap">
            <ChevronDown size={14} strokeWidth={2} />
          </span>
        </div>
      </button>

      {/* ── MINIMAL DROPDOWN ── */}
      {isOpen && (
        <div 
          className="aw-voice-dropdown" 
          ref={dropdownRef} 
          role="listbox"
          data-lenis-prevent
        >
          {/* Search & Filter Header */}
          <div className="aw-dropdown-header">
            <div className="aw-search-row">
              <Search size={13} className="aw-search-icon" />
              <input
                ref={inputRef}
                type="text"
                className="aw-search-field"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search ? (
                <button 
                  type="button" 
                  className="aw-clear-search" 
                  onClick={() => setSearch('')}
                >
                  <X size={12} />
                </button>
              ) : (
                <span className="aw-search-shortcut">ESC</span>
              )}
            </div>

            {/* Filter Pills */}
            <div className="aw-filter-row">
              {[
                { key: 'all', label: 'All' },
                { key: 'female', label: 'Female' },
                { key: 'male', label: 'Male' }
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`aw-filter-tab ${filter === tab.key ? 'active' : ''}`}
                  onClick={() => setFilter(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Options List */}
          <div 
            className="aw-options-container" 
            data-lenis-prevent
            onWheel={(e) => e.stopPropagation()}
          >
            {filtered.length === 0 ? (
              <div className="aw-empty-row">
                <span>No results</span>
              </div>
            ) : (
              filtered.map((voice) => {
                const isSelected = voice.id.toLowerCase() === activeVoice.id.toLowerCase();
                return (
                  <div
                    key={voice.id}
                    role="option"
                    aria-selected={isSelected}
                    className={`aw-voice-option ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => handleSelect(voice.id)}
                  >
                    <div className="aw-option-left">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'left' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="aw-option-name">{voice.name}</span>
                          <span className="aw-option-gender">{voice.gender}</span>
                          <span style={{ fontSize: '0.68rem', padding: '1px 5px', borderRadius: '4px', background: '#f1f5f9', color: '#475569', fontWeight: 600 }}>
                            {voice.language}
                          </span>
                        </div>
                        <span style={{ fontSize: '0.73rem', color: '#64748b', fontWeight: 400 }}>
                          {voice.style}
                        </span>
                      </div>
                    </div>

                    <div className="aw-option-right">
                      {isSelected && (
                        <span className="aw-option-check">
                          <Check size={13} strokeWidth={2.5} />
                        </span>
                      )}
                    </div>
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

export default VoicePersonaSelector;
