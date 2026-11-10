import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Volume2, Sparkles, Sliders } from 'lucide-react';

const SAMPLE_VOICES = [
  {
    id: 'aditya_hi_sales',
    name: 'Aditya',
    lang: 'Hindi',
    tag: 'Consultative Sales',
    text: 'Namaste Sharma ji! Main ClozFlow se baat kar raha hoon. Aapke team ka telephonic conversion 35% tak increase karne ke liye call kiya tha.',
    speechLang: 'hi-IN'
  },
  {
    id: 'ishita_enhi_companion',
    name: 'Ishita',
    lang: 'Hinglish',
    tag: 'High-Status Closer',
    text: 'Totally understand sir. But if your team is spending 3 hours daily on manual dialing, monthly revenue leak is huge. Kya hum 15 days ka trial karein?',
    speechLang: 'en-IN'
  },
  {
    id: 'dev_en_recovery',
    name: 'Dev',
    lang: 'Indian English',
    tag: 'Debt & Assertive Recovery',
    text: 'Good afternoon Mr. Verma. Regarding invoice number 2026-992, could you confirm if the RTGS payment has been cleared by your accounts team?',
    speechLang: 'en-IN'
  },
  {
    id: 'roopa_bn_conversational',
    name: 'Roopa',
    lang: 'Bengali',
    tag: 'Consultative Discovery',
    text: 'Nomoshkar Mukherjee babu, ClozFlow theke call korchi. Apnar business operations kemon cholche?',
    speechLang: 'bn-IN'
  },
  {
    id: 'karthik_ta_closer',
    name: 'Karthik',
    lang: 'Tamil',
    tag: 'Enterprise Closer',
    text: 'Vanakkam sir, ClozFlow-la irunthu call panren. Unga telephonic sales pipeline-ai automate panna oru quick demo arrange panrom.',
    speechLang: 'ta-IN'
  },
  {
    id: 'suresh_te_sales',
    name: 'Suresh',
    lang: 'Telugu',
    tag: 'Commercial Sales',
    text: 'Namaskaram garu, ClozFlow nunchi call chestunnanu. Mee outbound conversion ni 35% penchadaniki call chesamu.',
    speechLang: 'te-IN'
  },
  {
    id: 'sarang_mr_closer',
    name: 'Sarang',
    lang: 'Marathi',
    tag: 'Regional Consultation',
    text: 'Namaskar Kulkarni saheb, ClozFlow madhun boltoy. Aplya business deal closing sathi automated system bagha.',
    speechLang: 'mr-IN'
  },
  {
    id: 'jigna_gu_sales',
    name: 'Jigna',
    lang: 'Gujarati',
    tag: 'Commercial Advisory',
    text: 'Namaste Patel bhai, ClozFlow mathi vat karu chhu. Tamara sales team mate direct pipeline automation joiye chhe?',
    speechLang: 'gu-IN'
  }
];

export default function InteractiveAudioPlayer() {
  const [selectedVoice, setSelectedVoice] = useState(SAMPLE_VOICES[0]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [modelType, setModelType] = useState('kiki-v2-pro');
  const [speed, setSpeed] = useState(1.0);
  const [emotion, setEmotion] = useState('calm_authority');
  const utteranceRef = useRef(null);
  const safetyTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handlePlayToggle = () => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setIsPlaying((prev) => !prev);
      return;
    }

    if (isPlaying) {
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
      window.speechSynthesis.cancel();
      setIsPlaying(false);
      return;
    }

    try {
      window.speechSynthesis.cancel();
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }

      const utterance = new SpeechSynthesisUtterance(selectedVoice.text);
      utterance.rate = speed;
      utterance.pitch = emotion === 'warm_rapport' ? 1.05 : emotion === 'soft_challenge' ? 0.95 : 1.0;
      utterance.lang = selectedVoice.speechLang || 'hi-IN';

      const voices = window.speechSynthesis.getVoices();
      const match = voices.find(
        (v) =>
          v.lang === selectedVoice.speechLang ||
          v.lang.replace('_', '-').startsWith(selectedVoice.speechLang.split('-')[0])
      );
      if (match) utterance.voice = match;

      utterance.onstart = () => {
        setIsPlaying(true);
      };
      utterance.onend = () => {
        if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
        setIsPlaying(false);
      };
      utterance.onerror = () => {
        if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
        setIsPlaying(false);
      };

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);

      safetyTimerRef.current = setTimeout(() => {
        setIsPlaying(false);
      }, 7000);
    } catch {
      setIsPlaying(true);
      safetyTimerRef.current = setTimeout(() => setIsPlaying(false), 3500);
    }
  };

  return (
    <div className="docs-audio-previewer">
      <div className="docs-audio-previewer__header">
        <div className="flex items-center gap-2">
          <Volume2 size={16} className="text-zinc-300" />
          <span className="font-semibold text-zinc-100 text-sm">Interactive Voice Synthesizer Tester</span>
          <span className="docs-audio-pill">Live Audition</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-zinc-400">
          <Sparkles size={13} className="text-zinc-400" />
          <span>Real-time Neural Vocoder</span>
        </div>
      </div>

      <div className="docs-audio-previewer__controls-bar">
        {/* Voice Selector Tabs */}
        <div className="flex flex-wrap gap-1.5">
          {SAMPLE_VOICES.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`docs-voice-chip ${selectedVoice.id === v.id ? 'active' : ''}`}
              onClick={() => {
                if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current);
                if (isPlaying && window.speechSynthesis) window.speechSynthesis.cancel();
                setIsPlaying(false);
                setSelectedVoice(v);
              }}
            >
              <span className="font-medium">{v.name}</span>
              <span className="text-[10px] opacity-70">({v.lang})</span>
            </button>
          ))}
        </div>

        {/* Model and Emotion Selector */}
        <div className="flex items-center gap-2 mt-3">
          <div className="flex items-center gap-1 text-xs text-zinc-400">
            <span>Model:</span>
            <select
              className="docs-audio-select"
              value={modelType}
              onChange={(e) => setModelType(e.target.value)}
            >
              <option value="kiki-v1-flash">Kiki v1 Flash (99M)</option>
              <option value="kiki-v2-pro">Kiki v2 Pro (2.5B)</option>
            </select>
          </div>

          <div className="flex items-center gap-1 text-xs text-zinc-400">
            <Sliders size={12} />
            <span>Tone:</span>
            <select
              className="docs-audio-select"
              value={emotion}
              onChange={(e) => setEmotion(e.target.value)}
            >
              <option value="calm_authority">Calm Authority</option>
              <option value="soft_challenge">Soft Challenge</option>
              <option value="warm_rapport">Warm Rapport</option>
            </select>
          </div>

          <div className="flex items-center gap-1 text-xs text-zinc-400">
            <span>Speed:</span>
            <select
              className="docs-audio-select"
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
            >
              <option value="0.9">0.9x</option>
              <option value="1.0">1.0x</option>
              <option value="1.15">1.15x</option>
              <option value="1.25">1.25x</option>
            </select>
          </div>
        </div>
      </div>

      <div className="docs-audio-previewer__playback-row">
        <button
          type="button"
          className={`docs-play-btn ${isPlaying ? 'playing' : ''}`}
          onClick={handlePlayToggle}
          title={isPlaying ? 'Pause audio' : 'Play sample'}
        >
          {isPlaying ? <Pause size={17} /> : <Play size={17} className="translate-x-[1px]" />}
        </button>

        <div className="flex-1 min-w-0">
          <p className="docs-audio-text font-mono text-xs text-zinc-200">
            &quot;{selectedVoice.text}&quot;
          </p>
          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-zinc-400">
            <span className="text-zinc-200 font-medium">{selectedVoice.tag}</span>
            <span>•</span>
            <span>Sampling: 24,000 Hz</span>
            <span>•</span>
            <span>Est. TTFA: {modelType === 'kiki-v1-flash' ? '82ms' : '178ms'}</span>
          </div>
        </div>

        {/* Animated Sound Wave Bars */}
        <div className={`docs-soundwave ${isPlaying ? 'active' : ''}`} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
