import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Check, Search, X } from 'lucide-react';
import gsap from 'gsap';
import './VoicePersonaSelector.css';

export const CLOZFLOW_VOICE_LIST = [
  { id: 'ritu', name: 'Ritu', gender: 'Female', style: 'Closer · High Energy' },
  { id: 'aditya', name: 'Aditya', gender: 'Male', style: 'Executive · Deep Gravitas' },
  { id: 'priya', name: 'Priya', gender: 'Female', style: 'Consultative · Warm' },
  { id: 'rahul', name: 'Rahul', gender: 'Male', style: 'Pragmatic · Technical' },
  { id: 'shreya', name: 'Shreya', gender: 'Female', style: 'Dynamic · Fast-Paced' },
  { id: 'varun', name: 'Varun', gender: 'Male', style: 'Strategic · Composed' },
  { id: 'ashutosh', name: 'Ashutosh', gender: 'Male', style: 'Corporate · Formal' },
  { id: 'neha', name: 'Neha', gender: 'Female', style: 'Retention · Empathetic' },
  { id: 'pooja', name: 'Pooja', gender: 'Female', style: 'Gentle · Persuasive' },
  { id: 'rohan', name: 'Rohan', gender: 'Male', style: 'Upbeat · Direct' },
  { id: 'simran', name: 'Simran', gender: 'Female', style: 'Refined · Articulate' },
  { id: 'kavya', name: 'Kavya', gender: 'Female', style: 'Lucid · Solution-focused' },
  { id: 'amit', name: 'Amit', gender: 'Male', style: 'Clear · Relatable' },
  { id: 'dev', name: 'Dev', gender: 'Male', style: 'Punchy · Direct' },
  { id: 'ishita', name: 'Ishita', gender: 'Female', style: 'Poised · Executive' },
  { id: 'ratan', name: 'Ratan', gender: 'Male', style: 'Commanding · Seasoned' },
  { id: 'manan', name: 'Manan', gender: 'Male', style: 'Analytical · Sharp' },
  { id: 'sumit', name: 'Sumit', gender: 'Male', style: 'Calm · Professional' },
  { id: 'roopa', name: 'Roopa', gender: 'Female', style: 'Patient · Empathetic' },
  { id: 'kabir', name: 'Kabir', gender: 'Male', style: 'Bold · Provocative' },
  { id: 'aayan', name: 'Aayan', gender: 'Male', style: 'Natural · Confident' },
  { id: 'shubh', name: 'Shubh', gender: 'Male', style: 'Tenacious · Upbeat' },
  { id: 'advait', name: 'Advait', gender: 'Male', style: 'Meticulous · High-Touch' },
  { id: 'anand', name: 'Anand', gender: 'Male', style: 'Seasoned · Operational' },
  { id: 'tanya', name: 'Tanya', gender: 'Female', style: 'Quick-Witted · Direct' },
  { id: 'tarun', name: 'Tarun', gender: 'Male', style: 'Polished · Focused' },
  { id: 'sunny', name: 'Sunny', gender: 'Male', style: 'Warm · Charismatic' },
  { id: 'mani', name: 'Mani', gender: 'Male', style: 'Technical · Insightful' },
  { id: 'gokul', name: 'Gokul', gender: 'Male', style: 'Grounded · Direct' },
  { id: 'vijay', name: 'Vijay', gender: 'Male', style: 'Resonant · Authority' },
  { id: 'shruti', name: 'Shruti', gender: 'Female', style: 'Bright · Explanatory' },
  { id: 'suhani', name: 'Suhani', gender: 'Female', style: 'Engaging · Conversational' },
  { id: 'mohit', name: 'Mohit', gender: 'Male', style: 'Resilient · Paced' },
  { id: 'kavitha', name: 'Kavitha', gender: 'Female', style: 'Steady · Advisory' },
  { id: 'rehan', name: 'Rehan', gender: 'Male', style: 'Smooth · Strategic' },
  { id: 'soham', name: 'Soham', gender: 'Male', style: 'Analytical · Calm' },
  { id: 'rupali', name: 'Rupali', gender: 'Female', style: 'Suave · Trustworthy' }
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
    return CLOZFLOW_VOICE_LIST.find(v => v.id.toLowerCase() === (value || 'ritu').toLowerCase()) || CLOZFLOW_VOICE_LIST[0];
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
          v.gender.toLowerCase().includes(q)
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
                      <span className="aw-option-name">{voice.name}</span>
                      <span className="aw-option-gender">{voice.gender}</span>
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
