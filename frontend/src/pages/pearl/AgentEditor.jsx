import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  ArrowLeft, Bot, Play, MoreVertical, 
  FileText, Braces, Wrench, Settings, 
  CheckCircle, CheckCircle2, Sparkles, ChevronDown, ChevronUp,
  Save, Loader2, Check, ExternalLink, Database, Mic,
  ShieldCheck, Tag, Info, Layers, Zap, Target, DollarSign, Trash2
} from 'lucide-react';
import './AgentEditor.css';
import AgentTestingPanel from './AgentTestingPanel';
import VoicePersonaSelector, { CLOZFLOW_VOICE_LIST } from '../../components/VoicePersonaSelector';
import CapsuleSelector from '../../components/CapsuleSelector';
import ArchetypeLibraryModal from '../../components/ArchetypeLibraryModal';
import { 
  extractVariables, 
  substituteVariables, 
  formatVariableLabel, 
  mergeVariablesWithDefaults 
} from '../../utils/variableParser';
import { SALES_ARCHETYPES, getArchetypeById } from '../../data/salesArchetypes';

export const AgentEditor = ({ agentId = null, initialArchetypeId = null, onBack }) => {
  const [searchParams] = useSearchParams();
  const queryArchetype = searchParams?.get('archetype');
  const effectiveArchetypeId = initialArchetypeId || queryArchetype;

  const [activeTab, setActiveTab] = useState('instructions');
  const [currentId, setCurrentId] = useState(agentId);

  useEffect(() => {
    setCurrentId(agentId);
  }, [agentId]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showTestingPanel, setShowTestingPanel] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Archetype & Template State
  const [showArchetypeModal, setShowArchetypeModal] = useState(false);
  const [activeArchetypeId, setActiveArchetypeId] = useState(effectiveArchetypeId || null);
  const [templateNotification, setTemplateNotification] = useState(null);

  // Configuration Fields
  const [agentName, setAgentName] = useState('New Sales Agent');
  const [role, setRole] = useState('outbound_qualification');
  const [mission, setMission] = useState('Qualify prospect intent, establish immediate product relevance, and book a discovery demo.');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [greetingEnabled, setGreetingEnabled] = useState(false);
  const [greetingText, setGreetingText] = useState('');
  
  // Voice Persona Settings
  const [speaker, setSpeaker] = useState('shubh_enhi_ads');
  const [language, setLanguage] = useState('Auto');
  const [pace, setPace] = useState(1.0);
  const [tone, setTone] = useState('Professional');
  
  // Capsule Reference
  const [capsules, setCapsules] = useState([]);
  const [capsuleId, setCapsuleId] = useState('');

  // Test Variables
  const [testVariables, setTestVariables] = useState({
    prospect_name: 'Rahul Sharma',
    company: 'Clozflow Technologies'
  });

  // Real-time extracted dynamic variables from greeting + system prompt
  const combinedPromptText = `${greetingEnabled ? greetingText : ''} ${systemPrompt}`;
  const detectedVariables = useMemo(() => extractVariables(combinedPromptText), [combinedPromptText]);

  const applyArchetype = useCallback((archetype, checkConfirmation = true) => {
    if (!archetype) return;

    if (checkConfirmation && isDirty) {
      const proceed = window.confirm(
        `Applying the "${archetype.name}" blueprint will update your greeting, directives, and suggested voice persona.\n\nCustom edits can still be made. Do you want to proceed?`
      );
      if (!proceed) return;
    }

    setAgentName(archetype.name);
    setRole(archetype.defaultRole || archetype.default_role || 'outbound_qualification');
    setMission(archetype.mission || '');
    setSystemPrompt(archetype.systemPrompt || archetype.system_prompt || '');
    if (archetype.greeting) {
      setGreetingText(archetype.greeting);
      setGreetingEnabled(true);
    }
    const voiceId = archetype.defaultVoiceId || archetype.default_voice_id;
    if (voiceId) {
      setSpeaker(voiceId);
    }
    const lang = archetype.defaultLanguage || archetype.default_language;
    if (lang) {
      setLanguage(lang);
    }
    const p = archetype.defaultPace || archetype.default_pace;
    if (p) {
      setPace(p);
    }
    const t = archetype.defaultTone || archetype.default_tone;
    if (t) {
      setTone(t);
    }
    setActiveArchetypeId(archetype.id);

    // Merge dynamic variables with archetype defaults
    const combined = `${archetype.greeting || ''} ${archetype.systemPrompt || archetype.system_prompt || ''}`;
    const detected = extractVariables(combined);
    const supported = archetype.supportedVariables || archetype.supported_variables;
    setTestVariables(prev => mergeVariablesWithDefaults(detected, prev, supported));

    setIsDirty(true);
    setTemplateNotification(`Applied template: ${archetype.name}`);
    setTimeout(() => setTemplateNotification(null), 3500);
  }, [isDirty]);

  // Pre-seed archetype when creating a fresh agent with archetype query/prop
  useEffect(() => {
    if (!currentId && effectiveArchetypeId) {
      const arch = getArchetypeById(effectiveArchetypeId);
      if (arch) {
        applyArchetype(arch, false);
      }
    }
  }, [currentId, effectiveArchetypeId, applyArchetype]);

  const [expandedSections, setExpandedSections] = useState({
    greeting: true,
    persona: true,
    objective: true,
    behavior: true,
    capsule: true
  });

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // 1. Fetch available Product Knowledge Capsules
  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch(`${window.APP_API_BASE || ''}/api/capsules`, {
      headers: { Authorization: token ? `Bearer ${token}` : '' }
    })
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        setCapsules(data || []);
        if (data && data.length > 0 && !capsuleId) {
          const def = data.find(c => c.is_default);
          setCapsuleId(def ? def.id : data[0].id);
        }
      })
      .catch(err => console.error('Failed to load capsules:', err));
  }, []);

  // 2. Fetch existing Agent if agentId provided
  useEffect(() => {
    if (!currentId) return;
    setLoading(true);
    const token = localStorage.getItem('token');
    fetch(`${window.APP_API_BASE || ''}/api/pearl/agents/${currentId}`, {
      headers: { Authorization: token ? `Bearer ${token}` : '' }
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) {
          setAgentName(data.name || 'Pearl Agent');
          setRole(data.role || 'outbound_qualification');
          setMission(data.mission || '');
          if (data.system_prompt) setSystemPrompt(data.system_prompt);
          if (data.greeting) {
            setGreetingText(data.greeting);
            setGreetingEnabled(true);
          } else {
            setGreetingEnabled(false);
          }
          if (data.voice_config) {
            setSpeaker(data.voice_config.speaker || 'shubh_enhi_ads');
            setLanguage(data.voice_config.language || 'Auto');
            setPace(data.voice_config.pace || 1.0);
            setTone(data.voice_config.tone || 'Professional');
          }
          if (data.capsule_id) setCapsuleId(data.capsule_id);
          if (data.test_variables) setTestVariables(data.test_variables);
        }
      })
      .catch(err => console.error('Failed to load agent:', err))
      .finally(() => setLoading(false));
  }, [currentId]);

  // Handle Save Agent
  const handleSaveAgent = async () => {
    setSaving(true);
    setSaveSuccess(false);

    const activePersona = (CLOZFLOW_VOICE_LIST || []).find(v => v.id.toLowerCase() === (speaker || '').toLowerCase());
    const personaGender = activePersona ? activePersona.gender : 'Male';

    const payload = {
      name: agentName.trim() || 'Untitled Agent',
      role,
      mission,
      system_prompt: systemPrompt,
      greeting: greetingEnabled ? greetingText : null,
      voice_config: {
        speaker,
        language,
        pace: parseFloat(pace),
        tone,
        gender: personaGender
      },
      capsule_id: capsuleId ? parseInt(capsuleId) : null,
      test_variables: testVariables,
      call_provider: 'exotel'
    };

    const token = localStorage.getItem('token');
    const isNew = !currentId;
    const url = isNew 
      ? `${window.APP_API_BASE || ''}/api/pearl/agents`
      : `${window.APP_API_BASE || ''}/api/pearl/agents/${currentId}`;
    const method = isNew ? 'POST' : 'PATCH';

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to save agent configuration');
      }

      const saved = await res.json();
      const finalId = (isNew && saved.id) ? saved.id : currentId;
      if (isNew && saved.id) {
        setCurrentId(saved.id);
      }
      setIsDirty(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
      return finalId;
    } catch (err) {
      console.error('Save error:', err);
      alert(`Save error: ${err.message}`);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleOpenTesting = async () => {
    let id = currentId;
    if (!id) {
      id = await handleSaveAgent();
      if (!id) return;
    }
    setShowTestingPanel(true);
  };

  const handleDeleteCapsuleFromEditor = async (id, name) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete capsule "${name || 'Selected Capsule'}"?\n\nThis will remove it from this agent and database.`
    );
    if (!confirmed) return;

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/capsules/${id}`, {
        method: 'DELETE',
        headers: { Authorization: token ? `Bearer ${token}` : '' }
      });
      if (res.ok) {
        setCapsules(prev => prev.filter(c => String(c.id) !== String(id)));
        if (String(capsuleId) === String(id)) {
          setCapsuleId('');
        }
        setIsDirty(true);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Failed to delete capsule: ${err.detail || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Delete capsule error:', err);
      alert('Network error while deleting capsule.');
    }
  };

  const currentAgentSnapshot = {
    id: currentId,
    name: agentName,
    mission,
    system_prompt: systemPrompt,
    greeting: greetingEnabled ? greetingText : null,
    voice_config: { 
      speaker, 
      language, 
      pace, 
      tone,
      gender: (CLOZFLOW_VOICE_LIST || []).find(v => v.id.toLowerCase() === (speaker || '').toLowerCase())?.gender || 'Male'
    },
    capsule_id: capsuleId,
    test_variables: testVariables
  };

  const renderLeftPanel = () => (
    <div className="agent-editor-left">
      <nav className="agent-tabs">
        <button 
          type="button"
          className={`agent-tab ${activeTab === 'instructions' ? 'active' : ''}`}
          onClick={() => setActiveTab('instructions')}
        >
          <FileText size={18} />
          <span>Instructions</span>
        </button>
        <button 
          type="button"
          className={`agent-tab ${activeTab === 'variables' ? 'active' : ''}`}
          onClick={() => setActiveTab('variables')}
        >
          <Braces size={18} />
          <span>Test Variables</span>
        </button>
        <button 
          type="button"
          className={`agent-tab ${activeTab === 'capsule' ? 'active' : ''}`}
          onClick={() => setActiveTab('capsule')}
        >
          <Database size={18} />
          <span>Knowledge Capsule</span>
        </button>
        <button 
          type="button"
          className={`agent-tab ${activeTab === 'voice' ? 'active' : ''}`}
          onClick={() => setActiveTab('voice')}
        >
          <Mic size={18} />
          <span>Voice & Persona</span>
        </button>
      </nav>
    </div>
  );

  const renderInstructionsTab = () => (
    <div className="instructions-tab">
      {/* Greeting Section */}
      <div className="editor-section">
        <div className="section-header-row">
          <div>
            <h3>Fixed Opening Script (Optional Override)</h3>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>By default, Pearl dynamically invents an AI pattern interrupt hook from your knowledge capsule. Enable only to enforce a static script.</span>
          </div>
          <label className="toggle-switch">
            <input 
              type="checkbox" 
              checked={greetingEnabled} 
              onChange={(e) => { setGreetingEnabled(e.target.checked); setIsDirty(true); }} 
            />
            <span className="slider"></span>
          </label>
        </div>
        {greetingEnabled && (
          <textarea 
            className="editor-textarea"
            value={greetingText}
            onChange={(e) => { setGreetingText(e.target.value); setIsDirty(true); }}
            placeholder={`e.g. Hi {{borrower_name | "Sir"}}, this is ${agentName || 'Neha'} from Clozflow. Am I speaking with the founder?`}
          />
        )}

        {/* Dynamic Prompt Variables Chip Inspection Bar */}
        <div className="dynamic-variables-inspection-bar">
          <div className="var-bar-header">
            <div className="var-bar-title">
              <Braces size={14} color="#2563eb" />
              <span>Detected Dynamic Tokens ({detectedVariables.length})</span>
            </div>
            <span className="var-bar-hint">Tokens auto-substituted during live calls</span>
          </div>
          <div className="var-chips-wrap">
            {detectedVariables.length > 0 ? (
              detectedVariables.map(v => (
                <span 
                  key={v.name} 
                  className="var-chip"
                  onClick={() => setActiveTab('variables')}
                  title={`Click to edit test value. Fallback: "${v.fallback || 'none'}"`}
                >
                  <span className="var-chip-name">{`{{${v.name}}}`}</span>
                  {v.fallback && <span className="var-chip-fallback">| "{v.fallback}"</span>}
                </span>
              ))
            ) : (
              <span className="var-chips-empty">
                No variables detected. Add <code>{'{{variable_name | "Fallback"}}'}</code> to greeting or directives.
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Objective Card */}
      <div className="expandable-card">
        <div className="card-header" onClick={() => toggleSection('objective')}>
          <div>
            <h3 style={{ margin: 0, fontSize: '0.98rem' }}>Sales Mission & Objective</h3>
            <span style={{ fontSize: '0.78rem', color: '#64748b' }}>Primary outcome Pearl guides the conversation toward</span>
          </div>
          {expandedSections.objective ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
        {expandedSections.objective && (
          <div className="card-content" style={{ padding: '16px 20px' }}>
            <div className="form-group">
              <textarea 
                className="form-textarea" 
                value={mission}
                onChange={(e) => { setMission(e.target.value); setIsDirty(true); }}
                placeholder="e.g. Qualify outbound prospect intent and secure a 15-minute product walk-through demo."
              />
            </div>
          </div>
        )}
      </div>

      {/* Autonomous Directives & System Prompt Card */}
      <div className="expandable-card">
        <div className="card-header" onClick={() => toggleSection('behavior')}>
          <div>
            <h3 style={{ margin: 0, fontSize: '0.98rem' }}>Autonomous Directives & Objection Playbook</h3>
            <span style={{ fontSize: '0.78rem', color: '#64748b' }}>Custom conversational rules, 2-Yes scripts, objection trees, and compliance guardrails</span>
          </div>
          {expandedSections.behavior ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
        {expandedSections.behavior && (
          <div className="card-content" style={{ padding: '16px 20px' }}>
            <div className="form-group">
              <textarea 
                className="form-textarea prompt-textarea" 
                rows={12}
                value={systemPrompt}
                onChange={(e) => { setSystemPrompt(e.target.value); setIsDirty(true); }}
                placeholder="Enter custom prompt directives, objection playbooks, or choose a blueprint from Template Library..."
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderVariablesTab = () => {
    const substitutedGreeting = substituteVariables(greetingText, testVariables);

    return (
      <div className="instructions-tab">
        <div className="editor-section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <h3>Dynamic Test Variables</h3>
            <span style={{ fontSize: '0.72rem', padding: '3px 8px', borderRadius: 4, background: '#eff6ff', color: '#1d4ed8', fontWeight: 600, border: '1px solid #bfdbfe' }}>
              Token Engine
            </span>
          </div>
          <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: 16 }}>
            These template variables replace placeholders like <code>{'{{prospect_name}}'}</code> and <code>{'{{company}}'}</code> during browser and PSTN testing.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {detectedVariables.length > 0 ? (
              detectedVariables.map(v => (
                <div key={v.name} className="form-group">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>
                      {formatVariableLabel(v.name)}
                    </label>
                    <code style={{ fontSize: '0.72rem', background: '#f1f5f9', padding: '1px 5px', borderRadius: 4, color: '#2563eb' }}>
                      {`{{${v.name}}}`}
                    </code>
                  </div>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={testVariables[v.name] !== undefined ? testVariables[v.name] : ''}
                    placeholder={v.fallback ? `Default fallback: "${v.fallback}"` : 'Enter test value...'}
                    onChange={(e) => {
                      setTestVariables(prev => ({ ...prev, [v.name]: e.target.value }));
                      setIsDirty(true);
                    }}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: '0.85rem' }}
                  />
                  {v.fallback && (
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 4, display: 'block' }}>
                      Fallback: <em>"{v.fallback}"</em>
                    </span>
                  )}
                </div>
              ))
            ) : (
              <>
                <div className="form-group">
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 6 }}>
                    Prospect Name (<code>{'{{prospect_name}}'}</code>)
                  </label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={testVariables.prospect_name || ''}
                    onChange={(e) => {
                      setTestVariables(prev => ({ ...prev, prospect_name: e.target.value }));
                      setIsDirty(true);
                    }}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 6 }}
                  />
                </div>

                <div className="form-group">
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: 6 }}>
                    Target Company (<code>{'{{company}}'}</code>)
                  </label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={testVariables.company || ''}
                    onChange={(e) => {
                      setTestVariables(prev => ({ ...prev, company: e.target.value }));
                      setIsDirty(true);
                    }}
                    style={{ width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 6 }}
                  />
                </div>
              </>
            )}
          </div>

          {/* Live Substituted Greeting Preview */}
          {greetingEnabled && greetingText && (
            <div style={{ marginTop: 24, padding: '16px 18px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: '0.78rem', fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                <Sparkles size={13} color="#2563eb" />
                <span>Live Spoken Opening Script Preview (Bulbul v4 Synthesis)</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.88rem', color: '#1e293b', lineHeight: 1.6, fontStyle: 'italic' }}>
                "{substitutedGreeting}"
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderCapsuleTab = () => {
    const selectedCap = capsules.find(c => String(c.id) === String(capsuleId));

    return (
      <div className="instructions-tab">
        <div className="editor-section capsule-editor-section">
          <div className="section-header-row" style={{ marginBottom: 8 }}>
            <div>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
                <Database size={18} color="#2563eb" />
                Product Knowledge Capsule
              </h3>
              <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '4px 0 0 0' }}>
                Ground Pearl with zero-hallucination factual intelligence about pricing, features, competitive battlecards, and objections.
              </p>
            </div>
            {selectedCap && (
              <span className="dossier-pill-verified">
                <span className="dossier-beacon-pulse" />
                Autonomous Grounding Active
              </span>
            )}
          </div>

          <div className="form-group" style={{ marginTop: 18 }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span>Assigned Knowledge Capsule</span>
              <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 400 }}>({capsules.length} available in Hexagon DB)</span>
            </label>
            <CapsuleSelector 
              capsules={capsules}
              value={capsuleId}
              onChange={(newId) => {
                setCapsuleId(newId);
                setIsDirty(true);
              }}
              placeholder="Search or select a Product Knowledge Capsule..."
            />
          </div>

          {selectedCap ? (
            <div className="capsule-intelligence-dossier animate-fade-in">
              <div className="dossier-header-bar">
                <div className="dossier-header-left">
                  <div className="dossier-badge-icon">
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <h4 className="dossier-title">{selectedCap.name}</h4>
                    <span className="dossier-sub">{selectedCap.product_name} &bull; Anchored to Pearl Knowledge Engine</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {selectedCap.is_default && (
                    <span className="dossier-default-tag">System Default</span>
                  )}
                  <button
                    type="button"
                    style={{ fontSize: '0.75rem', fontWeight: 500, padding: '4px 10px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 6, color: '#475569', cursor: 'pointer' }}
                    onClick={() => {
                      setCapsuleId('');
                      setIsDirty(true);
                    }}
                    title="Detach capsule from this agent"
                  >
                    Detach
                  </button>
                  <button
                    type="button"
                    style={{ fontSize: '0.75rem', fontWeight: 600, padding: '4px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, color: '#dc2626', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                    onClick={() => handleDeleteCapsuleFromEditor(selectedCap.id, selectedCap.name)}
                    title="Permanently delete this capsule"
                  >
                    <Trash2 size={12} />
                    Delete Capsule
                  </button>
                </div>
              </div>

              <div className="dossier-metrics-grid">
                <div className="dossier-metric-card">
                  <div className="dossier-metric-header">
                    <Tag size={14} color="#2563eb" />
                    <span>Product Offering</span>
                  </div>
                  <div className="dossier-metric-val">{selectedCap.product_name || 'Standard Service'}</div>
                </div>

                <div className="dossier-metric-card">
                  <div className="dossier-metric-header">
                    <DollarSign size={14} color="#16a34a" />
                    <span>Price & Terms</span>
                  </div>
                  <div className="dossier-metric-val" style={{ color: '#16a34a', fontWeight: 700 }}>
                    {selectedCap.product_price || 'Custom / Contact Sales'}
                  </div>
                </div>

                <div className="dossier-metric-card" style={{ gridColumn: 'span 2' }}>
                  <div className="dossier-metric-header">
                    <Target size={14} color="#8b5cf6" />
                    <span>Target Audience & Ideal Customer Profile</span>
                  </div>
                  <div className="dossier-metric-val">{selectedCap.target_audience || 'General B2B Decision Makers'}</div>
                </div>

                <div className="dossier-metric-card" style={{ gridColumn: 'span 2' }}>
                  <div className="dossier-metric-header">
                    <Zap size={14} color="#ea580c" />
                    <span>Primary Pain Points Solved</span>
                  </div>
                  <div className="dossier-metric-val" style={{ whiteSpace: 'pre-line', lineHeight: 1.5 }}>
                    {selectedCap.pain_points_solved || 'Manual prospecting friction and delayed lead follow-ups.'}
                  </div>
                </div>

                {selectedCap.key_differentiators && (
                  <div className="dossier-metric-card" style={{ gridColumn: 'span 2' }}>
                    <div className="dossier-metric-header">
                      <Sparkles size={14} color="#d97706" />
                      <span>Key Differentiators & Moats</span>
                    </div>
                    <div className="dossier-metric-val" style={{ whiteSpace: 'pre-line', lineHeight: 1.5 }}>
                      {selectedCap.key_differentiators}
                    </div>
                  </div>
                )}

                {selectedCap.product_specification && (
                  <div className="dossier-metric-card" style={{ gridColumn: 'span 2' }}>
                    <div className="dossier-metric-header">
                      <Layers size={14} color="#0284c7" />
                      <span>Product Specifications & Architecture</span>
                    </div>
                    <div className="dossier-metric-val" style={{ whiteSpace: 'pre-line', lineHeight: 1.5, fontSize: '0.8rem' }}>
                      {selectedCap.product_specification}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="capsule-empty-state">
              <div className="capsule-empty-orb">
                <Database size={24} />
              </div>
              <h4>No Capsule Attached</h4>
              <p>
                Pearl is running in <strong>Script Mode</strong>. Attaching a Knowledge Capsule will inject verified pricing, competitor answers, and product truth directly into Pearl's runtime prompt.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderVoiceTab = () => (
    <div className="instructions-tab">
      <div className="editor-section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h3>Voice Identity & Synthesis</h3>
          <span style={{ fontSize: '0.72rem', padding: '3px 8px', borderRadius: 4, background: '#f1f5f9', color: '#334155', fontWeight: 600, border: '1px solid #e2e8f0' }}>
            Neural Acoustic Engine
          </span>
        </div>
        <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: 20 }}>
          High-fidelity conversational acoustic engine with real-time articulation for natural Indian accents, code-switching, and live phone rhythm.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Voice Persona & Timbre
            </label>
            <VoicePersonaSelector 
              value={speaker}
              onChange={(newSpeaker) => { setSpeaker(newSpeaker); setIsDirty(true); }}
            />
          </div>

          <div className="form-group">
            <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Spoken Language & Dialect (Sarvam Bulbul v4)
            </label>
            <select 
              className="form-select"
              value={language}
              onChange={(e) => { setLanguage(e.target.value); setIsDirty(true); }}
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: 6, fontWeight: 500 }}
            >
              <option value="Auto">Auto (Dynamic Hinglish Code-Switching)</option>
              <optgroup label="Official 11 Indic Languages (Bulbul v4 Flash)">
                <option value="Hindi">Hindi (हिन्दी · hi-IN)</option>
                <option value="English">Indian English (en-IN)</option>
                <option value="Bengali">Bengali (বাংলা · bn-IN)</option>
                <option value="Gujarati">Gujarati (ગુજરાતી · gu-IN)</option>
                <option value="Kannada">Kannada (ಕನ್ನಡ · kn-IN)</option>
                <option value="Malayalam">Malayalam (മലയാളം · ml-IN)</option>
                <option value="Marathi">Marathi (मराठी · mr-IN)</option>
                <option value="Odia">Odia (ଓଡ଼ିଆ · od-IN)</option>
                <option value="Punjabi">Punjabi (ਪੰਜਾਬੀ · pa-IN)</option>
                <option value="Tamil">Tamil (தமிழ் · ta-IN)</option>
                <option value="Telugu">Telugu (తెలుగు · te-IN)</option>
              </optgroup>
              <optgroup label="Additional Regional Languages">
                <option value="Assamese">Assamese (অসমীয়া · as-IN)</option>
              </optgroup>
            </select>
          </div>

          <div className="form-group">
            <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Speaking Speed (Pace: {pace}x)
            </label>
            <input 
              type="range" 
              min="0.8" 
              max="1.3" 
              step="0.05"
              value={pace}
              onChange={(e) => { setPace(e.target.value); setIsDirty(true); }}
              style={{ width: '100%' }}
            />
          </div>

          <div className="form-group">
            <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Conversation Tone
            </label>
            <select 
              className="form-select"
              value={tone}
              onChange={(e) => { setTone(e.target.value); setIsDirty(true); }}
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: 6 }}
            >
              <option value="Professional">Professional</option>
              <option value="Friendly">Friendly & Enthusiastic</option>
              <option value="Assertive">Assertive Challenge</option>
              <option value="Casual">Casual</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );

  const renderCenterContent = () => {
    switch (activeTab) {
      case 'instructions': return renderInstructionsTab();
      case 'variables': return renderVariablesTab();
      case 'capsule': return renderCapsuleTab();
      case 'voice': return renderVoiceTab();
      default: return renderInstructionsTab();
    }
  };

  const renderRightPanel = () => (
    <div className="agent-editor-right">
      <div className="genie-header">
        <Sparkles size={20} className="genie-icon" />
        <div>
          <h3>Prompt Assistant</h3>
          <p>Quick directives for sales behavior</p>
        </div>
      </div>
      
      <div className="genie-content">
        <div className="genie-suggestions">
          <button 
            type="button" 
            className="suggestion-chip"
            style={{ background: '#fdf4ff', borderColor: '#f0abfc', color: '#7e22ce', fontWeight: 600 }}
            onClick={() => setShowArchetypeModal(true)}
          >
            <Sparkles size={13} style={{ marginRight: 4, display: 'inline' }} />
            <span>Browse 5 Sales Archetypes</span>
          </button>
          {detectedVariables.slice(0, 3).map(v => (
            <button 
              key={v.name}
              type="button" 
              className="suggestion-chip"
              onClick={() => {
                setSystemPrompt(prev => prev + ` {{${v.name}}}`);
                setIsDirty(true);
              }}
            >
              + Insert {`{{${v.name}}}`}
            </button>
          ))}
          <button 
            type="button" 
            className="suggestion-chip"
            onClick={() => {
              setSystemPrompt(prev => prev + "\n- Keep all responses strictly under 2 sentences.");
              setIsDirty(true);
            }}
          >
            + Enforce short 2-sentence responses
          </button>
          <button 
            type="button" 
            className="suggestion-chip"
            onClick={() => {
              setSystemPrompt(prev => prev + "\n- If they object to pricing, explain that Clozflow pays for itself within 14 days by preventing lost inbound leads.");
              setIsDirty(true);
            }}
          >
            + Add ROI price objection rule
          </button>
          <button 
            type="button" 
            className="suggestion-chip"
            onClick={() => {
              setSystemPrompt(prev => prev + "\n- Use natural Hinglish words like 'bilkul', 'actually', and 'sahi'.");
              setIsDirty(true);
            }}
          >
            + Add natural conversational Hinglish
          </button>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="agent-editor-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '80vh' }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 size={32} className="animate-spin" color="#2563eb" style={{ margin: '0 auto 12px' }} />
          <p style={{ color: '#64748b', fontSize: '0.9rem', fontWeight: 500 }}>Loading agent configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-editor-container">
      {/* Editor Header */}
      <header className="agent-editor-header">
        <div className="header-left">
          {onBack && (
            <button 
              type="button" 
              className="icon-button" 
              onClick={onBack} 
              title="Back to Agents"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#f8fafc', color: '#334155', fontWeight: 600, fontSize: '0.84rem', cursor: 'pointer' }}
            >
              <ArrowLeft size={16} />
              <span>Back</span>
            </button>
          )}
          <div className="agent-title">
            <div className="agent-icon"><Bot size={18} /></div>
            <input 
              type="text" 
              value={agentName} 
              onChange={(e) => { setAgentName(e.target.value); setIsDirty(true); }}
              className="agent-name-input"
              placeholder="Agent Name"
            />
            {isDirty && (
              <span style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: 500 }}>
                • Unsaved changes
              </span>
            )}
            {saveSuccess && (
              <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Check size={14} /> Saved
              </span>
            )}
          </div>
        </div>

        <div className="header-right">
          <button 
            type="button" 
            className="btn-template-library"
            onClick={() => setShowArchetypeModal(true)}
            title="Browse and apply pre-built enterprise sales archetypes"
          >
            <Sparkles size={15} />
            <span>Template Library</span>
          </button>

          <button 
            type="button" 
            className="btn-primary" 
            style={{ background: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1' }}
            onClick={handleSaveAgent}
            disabled={saving}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            <span>{saving ? 'Saving...' : 'Save Agent'}</span>
          </button>

          <button 
            type="button" 
            className="btn-primary"
            style={{ background: '#0f172a' }}
            onClick={handleOpenTesting}
            disabled={saving}
            title="Open browser test sandbox (Voice & Chat)"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} fill="currentColor" />}
            <span>Test Agent</span>
          </button>
        </div>
      </header>
      
      {/* Editor Body */}
      <div className="agent-editor-body">
        {renderLeftPanel()}
        <div className="agent-editor-center">
          {renderCenterContent()}
        </div>
        {renderRightPanel()}
      </div>

      {/* Contextual Browser Testing Drawer */}
      {showTestingPanel && (
        <AgentTestingPanel 
          agent={currentAgentSnapshot} 
          agentId={currentId}
          agentName={agentName}
          onClose={() => setShowTestingPanel(false)} 
          onSaveAndTest={handleSaveAgent}
        />
      )}

      {/* Archetype Library Modal */}
      <ArchetypeLibraryModal 
        isOpen={showArchetypeModal}
        onClose={() => setShowArchetypeModal(false)}
        onApplyArchetype={(arch) => applyArchetype(arch, true)}
        currentArchetypeId={activeArchetypeId}
      />

      {/* Template Notification Toast */}
      {templateNotification && (
        <div className="agent-template-toast animate-fade-in">
          <CheckCircle2 size={16} color="#10b981" />
          <span>{templateNotification}</span>
        </div>
      )}
    </div>
  );
};

export default AgentEditor;
