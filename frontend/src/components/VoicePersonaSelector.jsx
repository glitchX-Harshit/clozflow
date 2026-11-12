import React, { useState, useRef, useEffect, useMemo, useId } from 'react';
import { ChevronDown, Check, Search, X, Play, Square, Volume2 } from 'lucide-react';
import gsap from 'gsap';
import { CLOZFLOW_VOICE_LIST } from './voiceList';
import { apiUrl } from '../pages/pearl/lib/pearlApi.js';
import {
  filterVoices, findActiveVoice, moveActiveIndex, voicePreviewPath, voiceSearchPlaceholder,
} from '../pages/pearl/lib/voicePicker.js';
import './VoicePersonaSelector.css';

export { CLOZFLOW_VOICE_LIST };
export const SARVAM_VOICE_LIST = CLOZFLOW_VOICE_LIST;

const FILTER_TABS = [
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
];

const LIST_NAV_KEYS = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'];

const VoicePersonaSelector = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | female | male | hindi | english | <language> | regional
  const [playingId, setPlayingId] = useState(null);
  const [previewError, setPreviewError] = useState(null); // { id, name }
  const [activeIndex, setActiveIndex] = useState(-1);

  const baseId = useId();
  const listboxId = `${baseId}-voices`;
  const optionDomId = (index) => `${baseId}-voice-${index}`;

  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const chevronRef = useRef(null);
  const inputRef = useRef(null);
  const audioRef = useRef(null);
  const errorTimerRef = useRef(null);

  const activeVoice = useMemo(() => findActiveVoice(CLOZFLOW_VOICE_LIST, value), [value]);
  const filtered = useMemo(() => filterVoices(CLOZFLOW_VOICE_LIST, { filter, search }), [filter, search]);

  const releaseAudio = () => {
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
  };

  const stopPreview = () => {
    releaseAudio();
    setPlayingId(null);
  };

  const showPreviewError = (voice) => {
    setPreviewError({ id: voice.id, name: voice.name });
    clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setPreviewError(null), 5000);
  };

  // Audio preview (public, server-cached sample). Uses the API base so it also works when the
  // API runs on another origin (local dev) — a relative URL would hit the frontend server.
  const togglePreview = (voice) => {
    if (!voice) return;
    if (playingId === voice.id) {
      stopPreview();
      return;
    }
    releaseAudio();
    setPreviewError(null);

    const audio = new Audio(apiUrl(voicePreviewPath(voice.id)));
    audioRef.current = audio;
    setPlayingId(voice.id);

    const fail = () => {
      if (audioRef.current !== audio) return;
      audioRef.current = null;
      setPlayingId(null);
      showPreviewError(voice);
    };
    audio.onended = () => {
      if (audioRef.current !== audio) return;
      audioRef.current = null;
      setPlayingId(null);
    };
    audio.onerror = fail;
    audio.play().catch((err) => {
      // A pause() before playback started rejects with AbortError — that is a user stop, not a failure.
      if (err && err.name === 'AbortError') return;
      fail();
    });
  };

  // Cleanup audio and timers on unmount
  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      audioRef.current = null;
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
      }
      clearTimeout(errorTimerRef.current);
    };
  }, []);

  // GSAP animation for dropdown toggle; focus the search field when the list opens
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

  // Outside click dismiss
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isOpen]);

  const openList = () => {
    const selectedIndex = filtered.findIndex((v) => v.id === activeVoice?.id);
    setActiveIndex(selectedIndex);
    setIsOpen(true);
  };

  const closeList = ({ focusTrigger = false } = {}) => {
    setIsOpen(false);
    setSearch('');
    if (focusTrigger) triggerRef.current?.focus();
  };

  const handleSelect = (voiceId) => {
    onChange(voiceId);
    closeList({ focusTrigger: true });
  };

  const scrollOptionIntoView = (index) => {
    if (index < 0 || typeof document === 'undefined') return;
    document.getElementById(optionDomId(index))?.scrollIntoView?.({ block: 'nearest' });
  };

  const handleTriggerKeyDown = (e) => {
    if (e.target !== e.currentTarget) return; // keys from the nested preview button
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) openList();
    } else if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      e.stopPropagation();
      closeList();
    }
  };

  const handleSearchKeyDown = (e) => {
    if (LIST_NAV_KEYS.includes(e.key)) {
      e.preventDefault();
      const next = moveActiveIndex(activeIndex, e.key, filtered.length);
      setActiveIndex(next);
      scrollOptionIntoView(next);
    } else if (e.key === 'Enter' || (e.key === ' ' && !search.trim())) {
      const voice = activeIndex >= 0 ? filtered[activeIndex] : null;
      if (voice) {
        e.preventDefault();
        handleSelect(voice.id);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeList({ focusTrigger: true });
    }
  };

  const handleContainerBlur = (e) => {
    // Close when keyboard focus leaves the picker (Tab away). A null relatedTarget is a
    // click on a non-focusable area or a window switch — the outside-click handler covers clicks.
    if (isOpen && e.relatedTarget && containerRef.current && !containerRef.current.contains(e.relatedTarget)) {
      closeList();
    }
  };

  const activeDescendant = activeIndex >= 0 && activeIndex < filtered.length ? optionDomId(activeIndex) : undefined;
  const activeVoicePlaying = Boolean(activeVoice) && playingId === activeVoice.id;

  if (!activeVoice) return null;

  return (
    <div className="aw-voice-select-wrap" ref={containerRef} onBlur={handleContainerBlur}>
      {/* ── MINIMAL TRIGGER ── (a combobox element, so the preview button inside it is valid HTML) */}
      <div
        ref={triggerRef}
        className={`aw-voice-trigger ${isOpen ? 'is-open' : ''}`}
        role="combobox"
        tabIndex={0}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-label={`Voice persona: ${activeVoice.name}, ${activeVoice.gender}, ${activeVoice.style}`}
        onClick={() => (isOpen ? closeList() : openList())}
        onKeyDown={handleTriggerKeyDown}
      >
        <div className="aw-trigger-left">
          <span className="aw-voice-name">{activeVoice.name}</span>
          <span className="aw-voice-sep" aria-hidden="true">·</span>
          <span className="aw-voice-meta">{activeVoice.gender}</span>
          <span className="aw-voice-sep" aria-hidden="true">·</span>
          <span style={{ fontSize: '0.78rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '240px' }}>
            {activeVoice.style}
          </span>
        </div>

        <div className="aw-trigger-right">
          <button
            type="button"
            className={`aw-trigger-preview-btn ${activeVoicePlaying ? 'is-playing' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              togglePreview(activeVoice);
            }}
            title="Listen to selected voice preview"
            aria-label={activeVoicePlaying ? `Stop the ${activeVoice.name} preview` : `Play a preview of ${activeVoice.name}`}
          >
            {activeVoicePlaying ? (
              <Square size={10} fill="currentColor" />
            ) : (
              <Volume2 size={13} />
            )}
          </button>
          <span ref={chevronRef} className="aw-chevron-wrap" aria-hidden="true">
            <ChevronDown size={14} strokeWidth={2} />
          </span>
        </div>
      </div>

      {previewError && !isOpen && (
        <p className="aw-preview-status" role="status">
          Preview unavailable for {previewError.name}. Try again later.
        </p>
      )}

      {/* ── MINIMAL DROPDOWN ── */}
      {isOpen && (
        <div
          className="aw-voice-dropdown"
          ref={dropdownRef}
          tabIndex={-1}
          data-lenis-prevent
        >
          {/* Search & Filter Header */}
          <div className="aw-dropdown-header">
            <div className="aw-search-row">
              <Search size={13} className="aw-search-icon" aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                className="aw-search-field"
                placeholder={voiceSearchPlaceholder(CLOZFLOW_VOICE_LIST.length)}
                aria-label="Search voices"
                aria-controls={listboxId}
                aria-activedescendant={activeDescendant}
                aria-autocomplete="list"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setActiveIndex(e.target.value.trim() ? 0 : -1);
                }}
                onKeyDown={handleSearchKeyDown}
              />
              {search ? (
                <button
                  type="button"
                  className="aw-clear-search"
                  onClick={() => {
                    setSearch('');
                    setActiveIndex(-1);
                    inputRef.current?.focus();
                  }}
                  aria-label="Clear search"
                >
                  <X size={12} />
                </button>
              ) : (
                <span className="aw-search-shortcut" aria-hidden="true">{filtered.length}</span>
              )}
            </div>

            {/* Filter Pills */}
            <div className="aw-filter-row" role="group" aria-label="Filter voices">
              {FILTER_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`aw-filter-tab ${filter === tab.key ? 'active' : ''}`}
                  aria-pressed={filter === tab.key}
                  onClick={() => {
                    setFilter(tab.key);
                    setActiveIndex(-1);
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {previewError && (
              <p className="aw-preview-status-inline" role="status">
                Preview unavailable for {previewError.name}. Try again later.
              </p>
            )}
          </div>

          {/* Options List */}
          {filtered.length === 0 ? (
            <div className="aw-options-container" data-lenis-prevent>
              <div className="aw-empty-row" role="status">
                <span>No voice persona matching your search</span>
              </div>
            </div>
          ) : (
            <div
              className="aw-options-container"
              id={listboxId}
              role="listbox"
              aria-label="Voice personas"
              data-lenis-prevent
              onWheel={(e) => e.stopPropagation()}
            >
              {filtered.map((voice, index) => {
                const isSelected = voice.id.toLowerCase() === activeVoice.id.toLowerCase();
                const isItemPlaying = playingId === voice.id;
                return (
                  <div
                    key={voice.id}
                    id={optionDomId(index)}
                    role="option"
                    aria-selected={isSelected}
                    className={`aw-voice-option ${isSelected ? 'is-selected' : ''} ${index === activeIndex ? 'is-active' : ''}`}
                    onClick={() => handleSelect(voice.id)}
                    onMouseMove={() => {
                      if (activeIndex !== index) setActiveIndex(index);
                    }}
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
                      {/* Mouse shortcut; keyboard users preview the selected voice from the trigger. */}
                      <button
                        type="button"
                        tabIndex={-1}
                        className={`aw-preview-btn ${isItemPlaying ? 'is-playing' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePreview(voice);
                        }}
                        title={`Preview ${voice.name} (Voice Sample)`}
                        aria-label={isItemPlaying ? `Stop the ${voice.name} preview` : `Play a preview of ${voice.name}`}
                      >
                        {isItemPlaying ? (
                          <Square size={10} fill="currentColor" />
                        ) : (
                          <Play size={10} fill="currentColor" style={{ marginLeft: '1px' }} />
                        )}
                      </button>
                      {isSelected && (
                        <span className="aw-option-check" aria-hidden="true">
                          <Check size={13} strokeWidth={2.5} />
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VoicePersonaSelector;
