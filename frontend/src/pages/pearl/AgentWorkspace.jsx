import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot, Plus, Play, Copy, Trash2, Search, Edit3, Phone, ArrowLeft, Loader2, Database, Mic, Clock,
  AlertCircle, RefreshCw, X,
} from 'lucide-react';
import ArchetypeShowcase from '../../components/ArchetypeShowcase';
import { apiFetch, errorMessage } from './lib/pearlApi.js';
import { agentInitials, agentStatusMeta, formatAgentRole, getAgentCardDescription, voiceDisplayName } from './lib/agentCard.js';
import { formatServerDate } from './lib/dates.js';
import { agentDisplayName, filterAgents, listableAgents } from './lib/dialpadAgents.js';
import './AgentWorkspace.css';

// Loaded on demand: the call console and the test drawer are not needed to list agents.
const Pearl = lazy(() => import('../Pearl'));
const AgentTestingPanel = lazy(() => import('./AgentTestingPanel'));

const AgentMonogram = ({ name, status }) => {
  const meta = agentStatusMeta(status);
  return (
    <div className="agent-monogram-container" title={`${name} · ${meta.label}`}>
      <div className="agent-monogram-box">
        <span className="agent-monogram-initials">{agentInitials(name)}</span>
      </div>
      <span className={`agent-monogram-status-dot tone-${meta.tone}`} aria-hidden="true" />
    </div>
  );
};

const describeVoice = (voice) => {
  const speaker = voice?.speaker;
  const name = speaker ? voiceDisplayName(speaker) : 'Default voice';
  const lang = voice?.language && voice.language !== 'Auto' ? voice.language : 'Auto language';
  const pace = Number(voice?.pace) > 0 ? Number(voice.pace) : 1;
  return { name, detail: `${lang} (${pace}x)` };
};

export const AgentWorkspace = () => {
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [loadState, setLoadState] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState(null); // { tone: 'error' | 'success', text }
  const [busyAgentId, setBusyAgentId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTestingAgent, setActiveTestingAgent] = useState(null);
  const [isDirectCallOpen, setIsDirectCallOpen] = useState(false);

  // Resolves true, or the error message. Results are applied in promise callbacks.
  const loadAgents = useCallback(() => apiFetch('/api/pearl/agents').then(
    (data) => {
      setAgents(listableAgents(data));
      setLoadError('');
      setLoadState('ready');
      return true;
    },
    (err) => {
      const message = errorMessage(err, "Couldn't load your agents.");
      setLoadError(message);
      // Keep a list that is already on screen; only a first load turns into the error state.
      setLoadState((prev) => (prev === 'ready' ? 'ready' : 'error'));
      return message;
    },
  ), []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const handleRetry = () => {
    setLoadState('loading');
    loadAgents();
  };

  const refreshAfterChange = async (successText) => {
    const result = await loadAgents();
    if (result === true) {
      setNotice(successText ? { tone: 'success', text: successText } : null);
    } else {
      setNotice({ tone: 'error', text: `The change was saved, but the list could not be refreshed: ${result}` });
    }
  };

  const handleDuplicate = async (agent) => {
    const name = agentDisplayName(agent);
    setBusyAgentId(agent.id);
    setNotice(null);
    try {
      await apiFetch(`/api/pearl/agents/${encodeURIComponent(agent.id)}/duplicate`, { method: 'POST' });
      await refreshAfterChange(`Created a copy of “${name}”.`);
    } catch (err) {
      setNotice({ tone: 'error', text: `Couldn't duplicate “${name}”: ${errorMessage(err)}` });
    } finally {
      setBusyAgentId(null);
    }
  };

  const handleDelete = async (agent) => {
    const name = agentDisplayName(agent);
    const confirmed = window.confirm(
      `Delete “${name}”?\n\nIts test sessions are deleted and any campaign that uses it is left without an agent. This cannot be undone.`,
    );
    if (!confirmed) return;
    setBusyAgentId(agent.id);
    setNotice(null);
    try {
      await apiFetch(`/api/pearl/agents/${encodeURIComponent(agent.id)}`, { method: 'DELETE' });
      await refreshAfterChange(`Deleted “${name}”.`);
    } catch (err) {
      setNotice({ tone: 'error', text: `Couldn't delete “${name}”: ${errorMessage(err)}` });
    } finally {
      setBusyAgentId(null);
    }
  };

  const filteredAgents = useMemo(() => filterAgents(agents, searchQuery), [agents, searchQuery]);

  const handleUseArchetype = (archetypeId) => {
    navigate(`/agent-editor/new?archetype=${encodeURIComponent(archetypeId)}`);
  };

  const openAgent = (agentId) => navigate(`/agent-editor/${encodeURIComponent(agentId)}`);

  // Direct single-call console
  if (isDirectCallOpen) {
    return (
      <div className="agent-ws-container animate-fade-in">
        <div className="agent-ws-header">
          <div className="agent-ws-title-wrap" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              className="agent-btn-subtle"
              onClick={() => setIsDirectCallOpen(false)}
            >
              <ArrowLeft size={16} />
              <span>Back to Agent Library</span>
            </button>
            <div>
              <h1 style={{ fontSize: '1.1rem' }}>Call Console</h1>
              <p>Place one outbound call and follow it live</p>
            </div>
          </div>
        </div>
        <div className="agent-ws-dialpad-wrap">
          <Suspense
            fallback={(
              <div className="agent-ws-loading">
                <Loader2 size={24} className="animate-spin" color="#090a10" style={{ margin: '0 auto 12px auto' }} />
                <div>Loading the call console…</div>
              </div>
            )}
          >
            <Pearl />
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-ws-container animate-fade-in">
      {/* Top Header */}
      <header className="agent-ws-header">
        <div className="agent-ws-title-wrap">
          <h1>Voice Agents</h1>
          <p>Design, customize directives, and deploy autonomous conversational personas</p>
        </div>
        <div className="agent-ws-actions">
          <button
            type="button"
            className="agent-btn-subtle"
            onClick={() => setIsDirectCallOpen(true)}
            title="Open the single-call console"
          >
            <Phone size={14} />
            <span>Dialpad</span>
          </button>
          <button
            type="button"
            className="agent-btn-primary"
            onClick={() => navigate('/agent-editor/new')}
          >
            <Plus size={15} />
            <span>New Agent</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="agent-ws-body">
        {/* Search & Filter Bar */}
        <div className="agent-ws-filter-bar">
          <div className="agent-ws-search-box">
            <Search size={15} color="#94a3b8" aria-hidden="true" />
            <input
              type="search"
              placeholder="Search by agent name, role, or directives..."
              aria-label="Search agents"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {loadState === 'ready' && (
            <div className="agent-ws-count-indicator">
              {filteredAgents.length} {filteredAgents.length === 1 ? 'persona' : 'personas'}
            </div>
          )}
        </div>

        {notice && (
          <div className={`agent-ws-notice ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
            {notice.tone === 'error' && <AlertCircle size={15} aria-hidden="true" />}
            <span>{notice.text}</span>
            <button type="button" className="agent-ws-notice-close" onClick={() => setNotice(null)} aria-label="Dismiss message">
              <X size={14} />
            </button>
          </div>
        )}

        {loadState === 'loading' ? (
          <div className="agent-ws-loading" role="status">
            <Loader2 size={24} className="animate-spin" color="#090a10" style={{ margin: '0 auto 12px auto' }} />
            <div>Loading agent directory...</div>
          </div>
        ) : loadState === 'error' ? (
          <div className="agent-empty-box agent-error-box" role="alert">
            <div className="agent-empty-monogram">
              <AlertCircle size={26} strokeWidth={1.5} />
            </div>
            <h3>Couldn&apos;t load your agents</h3>
            <p>{loadError}</p>
            <button type="button" className="agent-btn-primary" onClick={handleRetry} style={{ margin: '0 auto' }}>
              <RefreshCw size={15} />
              <span>Retry</span>
            </button>
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="agent-empty-box">
            <div className="agent-empty-monogram">
              <Bot size={26} strokeWidth={1.5} />
            </div>
            <h3>{searchQuery ? 'No matching agents found' : 'No agents configured yet'}</h3>
            <p>
              {searchQuery ? 'Try adjusting your search query.' : 'Create your first autonomous voice persona with custom directives and knowledge.'}
            </p>
            {!searchQuery && (
              <button
                type="button"
                className="agent-btn-primary"
                onClick={() => navigate('/agent-editor/new')}
                style={{ margin: '0 auto' }}
              >
                <Plus size={15} />
                <span>Create Agent</span>
              </button>
            )}
          </div>
        ) : (
          <div className="agent-ws-grid">
            {filteredAgents.map((agent) => {
              const displayName = agentDisplayName(agent);
              const displayRole = formatAgentRole(agent.role) || 'Voice Agent';
              const status = agentStatusMeta(agent.status);
              const voice = describeVoice(agent.voice_config);
              const updated = formatServerDate(agent.updated_at || agent.created_at, { day: 'numeric', month: 'short', year: 'numeric' });
              const busy = busyAgentId === agent.id;

              return (
                <article key={agent.id} className="agent-ws-card" aria-label={displayName}>
                  <div className="agent-card-top">
                    <div className="agent-card-crest-wrap">
                      <AgentMonogram name={displayName} status={agent.status} />
                      <div className="agent-card-identity-col">
                        <span className="agent-card-role-label">{displayRole}</span>
                        <h3 className="agent-card-title">
                          {/* Stretched button: the whole card opens the editor, keyboard users get a real button. */}
                          <button
                            type="button"
                            className="agent-card-open-btn"
                            onClick={() => openAgent(agent.id)}
                            title={`Open ${displayName} in the editor`}
                          >
                            {displayName}
                          </button>
                        </h3>
                      </div>
                    </div>
                    <div className="agent-card-badges">
                      <span className={`agent-status-pill tone-${status.tone}`}>{status.label}</span>
                      <span className="agent-version-badge">v{agent.version || 1}</span>
                    </div>
                  </div>

                  <p className={`agent-card-desc ${agent.mission && String(agent.mission).trim() ? '' : 'is-empty'}`}>
                    {getAgentCardDescription(agent)}
                  </p>

                  <div className="agent-card-specs-grid">
                    <div className="agent-spec-chip" title="Voice persona">
                      <Mic size={12} className="chip-icon" aria-hidden="true" />
                      <span className="chip-label">{voice.name}</span>
                      <span className="chip-sub">· {voice.detail}</span>
                    </div>
                    <div className="agent-spec-chip" title="Knowledge base">
                      <Database size={12} className="chip-icon" aria-hidden="true" />
                      <span className="chip-label">{agent.capsule_name || 'No knowledge base'}</span>
                    </div>
                  </div>

                  <div className="agent-card-footer">
                    <div className="agent-card-meta">
                      {updated && (
                        <>
                          <Clock size={11} aria-hidden="true" />
                          <span>Updated {updated}</span>
                        </>
                      )}
                    </div>

                    <div className="agent-footer-actions">
                      <button
                        type="button"
                        className="agent-btn-test-cta"
                        onClick={() => setActiveTestingAgent(agent)}
                        title="Open the test drawer (a test session is only started after you confirm)"
                      >
                        <Play size={10} fill="currentColor" aria-hidden="true" />
                        <span>Test Voice</span>
                      </button>

                      <div className="agent-btn-group-tools">
                        <button
                          type="button"
                          className="agent-tool-btn"
                          onClick={() => openAgent(agent.id)}
                          aria-label={`Edit ${displayName}`}
                          title="Edit agent"
                        >
                          <Edit3 size={13} />
                        </button>
                        <button
                          type="button"
                          className="agent-tool-btn"
                          onClick={() => handleDuplicate(agent)}
                          disabled={busy}
                          aria-label={`Duplicate ${displayName}`}
                          title="Duplicate agent"
                        >
                          {busy ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
                        </button>
                        <button
                          type="button"
                          className="agent-tool-btn delete"
                          onClick={() => handleDelete(agent)}
                          disabled={busy}
                          aria-label={`Delete ${displayName}`}
                          title="Delete agent"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Explore Sales Archetypes / Agent Types (Positioned Below Created Agents) */}
        <div style={{ marginTop: '36px' }}>
          <ArchetypeShowcase onSelectArchetype={handleUseArchetype} />
        </div>
      </div>

      {/* Test drawer opened from a card */}
      {activeTestingAgent && (
        <Suspense fallback={null}>
          <AgentTestingPanel
            agent={activeTestingAgent}
            agentId={activeTestingAgent.id}
            agentName={activeTestingAgent.name}
            onClose={() => setActiveTestingAgent(null)}
          />
        </Suspense>
      )}
    </div>
  );
};

export default AgentWorkspace;
