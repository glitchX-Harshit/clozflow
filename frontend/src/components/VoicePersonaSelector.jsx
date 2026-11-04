import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Check, Search, X, Play, Square, Volume2 } from 'lucide-react';
import gsap from 'gsap';
import { CLOZFLOW_VOICE_LIST } from './voiceList';
import './VoicePersonaSelector.css';

export { CLOZFLOW_VOICE_LIST };
export const SARVAM_VOICE_LIST = CLOZFLOW_VOICE_LIST;

const VoicePersonaSelector = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | female | male | hindi | english | regional
  const [playingId, setPlayingId] = useState(null);

  const containerRef = useRef(null);
  const dropdownRef = useRef(null);
  const chevronRef = useRef(null);
  const inputRef = useRef(null);
  const audioRef = useRef(null);

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

  // Audio preview toggle (Uses Bulbul v4 Flash with server-side caching)
  const togglePreview = (voiceId) => {
    if (playingId === voiceId) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingId(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const audioUrl = `/api/pearl/voice-preview/${encodeURIComponent(voiceId)}`;
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    setPlayingId(voiceId);

    audio.onended = () => {
      setPlayingId(null);
      audioRef.current = null;
    };
    audio.onerror = () => {
      setPlayingId(null);
      audioRef.current = null;
    };
    audio.play().catch(() => {
      setPlayingId(null);
      audioRef.current = null;
    });
  };

  // Cleanup audio on unmount or close
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Filtered voice list
  const filtered = useMemo(() => {
    return CLOZFLOW_VOICE_LIST.filter(v => {
      if (filter === 'female' && v.gender !== 'Female') return false;
      if (filter === 'male' && v.gender !== 'Male') return false;
      if (filter === 'hindi' && !(v.language === 'Hindi' || v.language === 'Hinglish')) return false;
      if (filter === 'english' && v.language !== 'Indian English') return false;
      if (filter === 'bengali' && v.language !== 'Bengali') return false;
      if (filter === 'tamil' && v.language !== 'Tamil') return false;
      if (filter === 'telugu' && v.language !== 'Telugu') return false;
      if (filter === 'marathi' && v.language !== 'Marathi') return false;
      if (filter === 'gujarati' && v.language !== 'Gujarati') return false;
      if (filter === 'kannada' && v.language !== 'Kannada') return false;
      if (filter === 'punjabi' && v.language !== 'Punjabi') return false;
      if (filter === 'malayalam' && v.language !== 'Malayalam') return false;
      if (filter === 'odia' && v.language !== 'Odia') return false;
      if (filter === 'regional' && ['Hindi', 'Hinglish', 'Indian English'].includes(v.language)) return false;

      if (search.trim()) {
        const q = search.toLowerCase().trim();
        return (
          v.id.toLowerCase().includes(q) ||
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
          <button
            type="button"
            className={`aw-trigger-preview-btn ${playingId === activeVoice.id ? 'is-playing' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              togglePreview(activeVoice.id);
            }}
            title="Listen to selected voice preview"
          >
            {playingId === activeVoice.id ? (
              <Square size={10} fill="currentColor" />
            ) : (
              <Volume2 size={13} />
            )}
          </button>
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
                placeholder="Search 224 voices by name, accent, style..."
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
                <span className="aw-search-shortcut">{filtered.length}</span>
              )}
            </div>

            {/* Filter Pills */}
            <div className="aw-filter-row">
              {[
                { key: 'all', label: `All (${CLOZFLOW_VOICE_LIST.length})` },
                { key: 'female', label: 'Female' },
                { key: 'male', label: 'Male' },
                { key: 'hindi', label: 'Hindi' },
                { key: 'english', label: 'English' },
                { key: 'bengali', label: 'Bengali' },
                { key: 'tamil', label: 'Tamil' },
                { key: 'telugu', label: 'Telugu' },
                { key: 'marathi', label: 'Marathi' },
                { key: 'gujarati', label: 'Gujarati' },
                { key: 'kannada', label: 'Kannada' },
                { key: 'punjabi', label: 'Punjabi' },
                { key: 'malayalam', label: 'Malayalam' },
                { key: 'odia', label: 'Odia' },
                { key: 'regional', label: 'Other Regional' }
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
                <span>No voice persona matching your search</span>
              </div>
            ) : (
              filtered.map((voice) => {
                const isSelected = voice.id.toLowerCase() === activeVoice.id.toLowerCase();
                const isItemPlaying = playingId === voice.id;
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
                          <span style={{ fontSize: '0.66rem', padding: '1px 5px', borderRadius: '4px', background: '#e0f2fe', color: '#0369a1', fontWeight: 500 }}>
                            {voice.category}
                          </span>
                        </div>
                        <span style={{ fontSize: '0.73rem', color: '#64748b', fontWeight: 400 }}>
                          {voice.style}
                        </span>
                      </div>
                    </div>

                    <div className="aw-option-right">
                      <button
                        type="button"
                        className={`aw-preview-btn ${isItemPlaying ? 'is-playing' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePreview(voice.id);
                        }}
                        title={`Preview ${voice.name} (Bulbul v4 Flash)`}
                      >
                        {isItemPlaying ? (
                          <Square size={10} fill="currentColor" />
                        ) : (
                          <Play size={10} fill="currentColor" style={{ marginLeft: '1px' }} />
                        )}
                      </button>
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
