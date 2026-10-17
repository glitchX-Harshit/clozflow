import React, { useState, useEffect, useCallback } from 'react';
import { 
  Bot, Plus, Play, Copy, Trash2, Search, Edit3, 
  Sparkles, Phone, ArrowLeft, Loader2, Volume2, Database, Mic,
  CheckCircle2, Clock, Zap, Activity, ShieldCheck, Radio
} from 'lucide-react';
import AgentEditor from './AgentEditor';
import AgentTestingPanel from './AgentTestingPanel';
import Pearl from '../Pearl';
import './AgentWorkspace.css';

const AgentMonogram = ({ name = 'Agent' }) => {
  const getInitials = (str) => {
    if (!str) return 'AG';
    const cleaned = str.trim().replace(/^Agent\s+/i, '');
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return cleaned.slice(0, 2).toUpperCase();
  };

  const initials = getInitials(name);

  return (
    <div className="agent-monogram-container" title={`${name} · Active`}>
      <div className="agent-monogram-box">
        <span className="agent-monogram-initials">{initials}</span>
      </div>
      <span className="agent-monogram-status-dot" aria-label="Status active" />
    </div>
  );
};

// Executive mission description sanitizer & generator for high-caliber SaaS presentation
const getAgentCardDescription = (agent) => {
  const mission = (agent.mission || '').trim();

  // Safeguard: detect if mission is empty or contaminated with internal prompt engineering instructions
  const isPromptLeakage = (text) => {
    if (!text) return true;
    const lower = text.toLowerCase();
    const promptKeywords = [
      'reframe', 'assumptions', 'objection', 'system_prompt', 'system prompt', 
      'instructions:', 'guidelines:', '- use ', 'natural hinglish', 'prompt engineering',
      'you are a', 'you are an', 'act as a', 'do not reveal', 'temperature:',
      'words like', 'bilkul', 'actually', 'sahi'
    ];
    if (promptKeywords.some(kw => lower.includes(kw))) return true;
    if (text.includes('\n-') || text.includes('\n*') || text.startsWith('-') || text.startsWith('*')) return true;
    return false;
  };

  if (mission && !isPromptLeakage(mission)) {
    return mission;
  }

  // Creative, punchy Indian-style viral description tailored to role & persona
  const role = (agent.role || '').toLowerCase();
  
  if (role.includes('qualification') || role.includes('outbound')) {
    return "Desi charm, razor-sharp pitch. Cracks tough 'email bhej do' objections in butter-smooth Hinglish and locks the meeting before they hang up.";
  }
  if (role.includes('support') || role.includes('inbound') || role.includes('customer')) {
    return "Handles irritated callers with infinite patience, zero hold music, and solves 'mera refund kab aayega' like a seasoned pro.";
  }
  if (role.includes('appointment') || role.includes('booking') || role.includes('schedule')) {
    return "Direct, punctual, zero drama. Negotiates calendar availability faster than an auto-rickshaw meter and locks the slot.";
  }
  if (role.includes('cold') || role.includes('lead') || role.includes('outreach')) {
    return "High-velocity outbound machine. Turns cold Indian CXOs into warm discovery demos with high-trust Hinglish banter.";
  }
  if (role.includes('retention') || role.includes('success')) {
    return "Chai-level warmth with boardroom precision. Keeps accounts delighted and stops churn before it even starts.";
  }

  return "Pure conviction, zero awkward pauses. Engages Indian prospects in butter-smooth Hinglish and closes deals with natural flair.";
};


const API_BASE = window.APP_API_BASE || '';

const getHeaders = () => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
};

export const AgentWorkspace = ({ onNavigateSection }) => {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Navigation states within Agent Workspace
  const [editingAgentId, setEditingAgentId] = useState(null); // null | 'new' | number
  const [activeTestingAgent, setActiveTestingAgent] = useState(null); // null | { id, name }
  const [isDirectCallOpen, setIsDirectCallOpen] = useState(false);

  // Fetch agents from backend
  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/pearl/agents`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setAgents(data || []);
      }
    } catch (err) {
      console.error('Failed to load agents:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Handle Duplicate Agent
  const handleDuplicate = async (agentId, e) => {
    e.stopPropagation();
    try {
      const res = await fetch(`${API_BASE}/api/pearl/agents/${agentId}/duplicate`, {
        method: 'POST',
        headers: getHeaders()
      });
      if (res.ok) {
        await fetchAgents();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Duplicate failed: ${err.detail || 'Server error'}`);
      }
    } catch (err) {
      alert(`Duplicate failed: ${err.message}`);
    }
  };

  // Handle Delete Agent
  const handleDelete = async (agentId, e) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this agent?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/pearl/agents/${agentId}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      if (res.ok) {
        await fetchAgents();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Delete failed: ${err.detail || 'Server error'}`);
      }
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  // 1. If currently editing or creating an agent, show AgentEditor
  if (editingAgentId !== null) {
    return (
      <AgentEditor 
        agentId={editingAgentId === 'new' ? null : editingAgentId} 
        onBack={() => {
          setEditingAgentId(null);
          fetchAgents();
        }}
      />
    );
  }

  // 2. If user requested direct PSTN manual call, show Pearl
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
              <h1 style={{ fontSize: '1.1rem' }}>Manual Telephony Testing</h1>
              <p>Direct PSTN outbound call console</p>
            </div>
          </div>
        </div>
        <div style={{ padding: '2rem 2.5rem 4rem 2.5rem' }}>
          <Pearl />
        </div>
      </div>
    );
  }

  // Filter agents by search query
  const filteredAgents = agents.filter(a => 
    a.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.role?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.mission?.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
            title="Open manual PSTN calling console"
          >
            <Phone size={14} />
            <span>Dialpad</span>
          </button>
          <button 
            type="button" 
            className="agent-btn-primary"
            onClick={() => setEditingAgentId('new')}
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
            <Search size={15} color="#94a3b8" />
            <input 
              type="text" 
              placeholder="Search by agent name, role, or directives..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="agent-ws-count-indicator">
            {filteredAgents.length} {filteredAgents.length === 1 ? 'persona' : 'personas'}
          </div>
        </div>

        {/* Loading State */}
        {loading && agents.length === 0 ? (
          <div className="agent-ws-loading">
            <Loader2 size={24} className="animate-spin" color="#090a10" style={{ margin: '0 auto 12px auto' }} />
            <div>Loading agent directory...</div>
          </div>
        ) : filteredAgents.length === 0 ? (
          /* Empty State */
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
                onClick={() => setEditingAgentId('new')}
                style={{ margin: '0 auto' }}
              >
                <Plus size={15} />
                <span>Create Agent</span>
              </button>
            )}
          </div>
        ) : (
          /* Agent Cards Grid */
          <div className="agent-ws-grid">
            {filteredAgents.map(agent => {
              const voice = agent.voice_config || {};
              const speaker = voice.speaker || 'shubh_enhi_ads';
              const lang = voice.language || 'Auto';
              const pace = voice.pace || 1.0;

              const displayName = agent.name 
                ? agent.name.charAt(0).toUpperCase() + agent.name.slice(1)
                : 'Autonomous Agent';

              const displayRole = agent.role 
                ? agent.role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                : 'Outbound Specialist';

              const speakerName = speaker.split('_')[0].charAt(0).toUpperCase() + speaker.split('_')[0].slice(1);
              const displayLang = (lang && lang !== 'Auto')
                ? lang
                : (speaker.includes('enhi') ? 'Hinglish (en-IN)' : 'English');

              const cardDescription = getAgentCardDescription(agent);

              return (
                <div 
                  key={agent.id} 
                  className="agent-ws-card"
                  onClick={() => setEditingAgentId(agent.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="agent-card-top">
                    <div className="agent-card-crest-wrap">
                      <AgentMonogram name={displayName} />
                      <div className="agent-card-identity-col">
                        <span className="agent-card-role-label">
                          {displayRole}
                        </span>
                        <h3 className="agent-card-title">{displayName}</h3>
                      </div>
                    </div>
                    <span className="agent-version-badge">v{agent.version || 1}</span>
                  </div>

                  <p className="agent-card-desc">
                    {cardDescription}
                  </p>

                  <div className="agent-card-specs-grid">
                    <div className="agent-spec-chip" title="Voice Persona">
                      <Mic size={12} className="chip-icon" />
                      <span className="chip-label">{speakerName}</span>
                      <span className="chip-sub">· {displayLang} ({pace}x)</span>
                    </div>
                    <div className="agent-spec-chip" title="Grounding Knowledge Capsule">
                      <Database size={12} className="chip-icon" />
                      <span className="chip-label">{agent.capsule_name || 'Grounding Capsule'}</span>
                    </div>
                  </div>

                  <div className="agent-card-footer" onClick={e => e.stopPropagation()}>
                    <div className="agent-card-meta">
                      <Clock size={11} />
                      <span>{agent.updated_at ? new Date(agent.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'Ready'}</span>
                    </div>

                    <div className="agent-footer-actions">
                      <button 
                        type="button" 
                        className="agent-btn-test-cta"
                        onClick={() => setActiveTestingAgent(agent)}
                        title="Open Voice Sandbox"
                      >
                        <Play size={10} fill="currentColor" />
                        <span>Test Voice</span>
                      </button>

                      <div className="agent-btn-group-tools">
                        <button 
                          type="button" 
                          className="agent-tool-btn"
                          onClick={() => setEditingAgentId(agent.id)}
                          title="Edit agent"
                        >
                          <Edit3 size={13} />
                        </button>
                        <button 
                          type="button" 
                          className="agent-tool-btn"
                          onClick={(e) => handleDuplicate(agent.id, e)}
                          title="Duplicate agent"
                        >
                          <Copy size={13} />
                        </button>
                        <button 
                          type="button" 
                          className="agent-tool-btn delete"
                          onClick={(e) => handleDelete(agent.id, e)}
                          title="Delete agent"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Contextual Browser Testing Drawer when clicking "Test" directly from card */}
      {activeTestingAgent && (
        <AgentTestingPanel 
          agent={activeTestingAgent}
          agentId={activeTestingAgent.id}
          agentName={activeTestingAgent.name}
          onClose={() => setActiveTestingAgent(null)}
        />
      )}
    </div>
  );
};

export default AgentWorkspace;
