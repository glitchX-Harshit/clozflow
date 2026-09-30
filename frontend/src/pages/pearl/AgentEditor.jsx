import React, { useState } from 'react';
import { 
  ArrowLeft, Bot, Play, MoreVertical, 
  FileText, Braces, Wrench, Settings, 
  CheckCircle, Sparkles, ChevronDown, ChevronUp 
} from 'lucide-react';
import './AgentEditor.css';

const AgentEditor = () => {
  const [activeTab, setActiveTab] = useState('instructions');
  const [agentName, setAgentName] = useState('My Support Agent');
  const [greetingEnabled, setGreetingEnabled] = useState(true);
  
  const [expandedSections, setExpandedSections] = useState({
    persona: true,
    objective: true,
    behavior: true
  });

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const renderLeftPanel = () => (
    <div className="agent-editor-left">
      <nav className="agent-tabs">
        <button 
          className={`agent-tab ${activeTab === 'instructions' ? 'active' : ''}`}
          onClick={() => setActiveTab('instructions')}
        >
          <FileText size={18} />
          <span>Instructions</span>
        </button>
        <button 
          className={`agent-tab ${activeTab === 'variables' ? 'active' : ''}`}
          onClick={() => setActiveTab('variables')}
        >
          <Braces size={18} />
          <span>Variables</span>
        </button>
        <button 
          className={`agent-tab ${activeTab === 'tools' ? 'active' : ''}`}
          onClick={() => setActiveTab('tools')}
        >
          <Wrench size={18} />
          <span>Tools</span>
        </button>
        <button 
          className={`agent-tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <Settings size={18} />
          <span>Settings</span>
        </button>
        <button 
          className={`agent-tab ${activeTab === 'tests' ? 'active' : ''}`}
          onClick={() => setActiveTab('tests')}
        >
          <CheckCircle size={18} />
          <span>Tests</span>
        </button>
      </nav>
    </div>
  );

  const renderInstructionsTab = () => (
    <div className="instructions-tab">
      <div className="editor-section">
        <div className="section-header-row">
          <h3>Greeting</h3>
          <label className="toggle-switch">
            <input 
              type="checkbox" 
              checked={greetingEnabled} 
              onChange={(e) => setGreetingEnabled(e.target.checked)} 
            />
            <span className="slider"></span>
          </label>
        </div>
        {greetingEnabled && (
          <textarea 
            className="editor-textarea"
            defaultValue="Hi, this is Pearl from Clozflow. Am I speaking with {{prospect_name}}?"
          />
        )}
      </div>

      <div className="expandable-card">
        <div className="card-header" onClick={() => toggleSection('persona')}>
          <h3>Persona</h3>
          {expandedSections.persona ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
        {expandedSections.persona && (
          <div className="card-content grid-2">
            <div className="form-group">
              <label>Agent Identity</label>
              <input type="text" defaultValue="Pearl" className="form-input" />
            </div>
            <div className="form-group">
              <label>Role</label>
              <input type="text" defaultValue="Customer Support Representative" className="form-input" />
            </div>
            <div className="form-group">
              <label>Company</label>
              <input type="text" defaultValue="Clozflow" className="form-input" />
            </div>
            <div className="form-group">
              <label>Tone</label>
              <select className="form-select" defaultValue="Professional">
                <option>Professional</option>
                <option>Friendly</option>
                <option>Assertive</option>
                <option>Casual</option>
              </select>
            </div>
            <div className="form-group">
              <label>Communication Style</label>
              <select className="form-select" defaultValue="Concise">
                <option>Concise</option>
                <option>Detailed</option>
                <option>Conversational</option>
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="expandable-card">
        <div className="card-header" onClick={() => toggleSection('objective')}>
          <h3>Objective</h3>
          {expandedSections.objective ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
        {expandedSections.objective && (
          <div className="card-content">
            <div className="form-group">
              <label>Primary Goal</label>
              <textarea className="form-textarea" defaultValue="Assist the customer with their inquiries and resolve issues." />
            </div>
            <div className="form-group">
              <label>Qualification Goal</label>
              <textarea className="form-textarea" defaultValue="Ensure the customer is a good fit for our premium services." />
            </div>
          </div>
        )}
      </div>

      <div className="expandable-card">
        <div className="card-header" onClick={() => toggleSection('behavior')}>
          <h3>Conversation Behavior</h3>
          {expandedSections.behavior ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
        {expandedSections.behavior && (
          <div className="card-content">
            <div className="form-group">
              <label>Response Length</label>
              <select className="form-select" defaultValue="Medium">
                <option>Short</option>
                <option>Medium</option>
                <option>Detailed</option>
              </select>
            </div>
            <div className="form-group-toggle">
              <label>Allow interruptions</label>
              <label className="toggle-switch">
                <input type="checkbox" defaultChecked />
                <span className="slider"></span>
              </label>
            </div>
            <div className="form-group">
              <label>Objection Handling</label>
              <textarea className="form-textarea" defaultValue="If they say it's too expensive, highlight the ROI..." />
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderCenterContent = () => {
    switch (activeTab) {
      case 'instructions':
        return renderInstructionsTab();
      case 'variables':
        return <div className="placeholder-content">Define dynamic variables that Pearl can use during conversations.</div>;
      case 'tools':
        return <div className="placeholder-content">Connect tools and integrations for Pearl to use.</div>;
      case 'settings':
        return <div className="placeholder-content">Voice and Listening config placeholders</div>;
      case 'tests':
        return <div className="placeholder-content">Create test scenarios to validate Pearl's behavior.</div>;
      default:
        return null;
    }
  };

  const renderRightPanel = () => (
    <div className="agent-editor-right">
      <div className="genie-header">
        <Sparkles size={20} className="genie-icon" />
        <div>
          <h3>Pearl Genie</h3>
          <p>AI assistant for your agent configuration</p>
        </div>
      </div>
      
      <div className="genie-content">
        <div className="genie-suggestions">
          <button className="suggestion-chip">Tighten the greeting</button>
          <button className="suggestion-chip">Make responses shorter</button>
          <button className="suggestion-chip">Add objection handling</button>
        </div>
      </div>

      <div className="genie-input-area">
        <input type="text" placeholder="Ask Genie to modify your agent..." className="genie-input" />
      </div>
    </div>
  );

  return (
    <div className="agent-editor-container">
      <header className="agent-editor-header">
        <div className="header-left">
          <button className="icon-button"><ArrowLeft size={20} /></button>
          <div className="agent-title">
            <div className="agent-icon"><Bot size={18} /></div>
            <input 
              type="text" 
              value={agentName} 
              onChange={(e) => setAgentName(e.target.value)}
              className="agent-name-input"
            />
          </div>
        </div>
        <div className="header-right">
          <button className="btn-primary">
            <Play size={16} fill="currentColor" />
            Test Agent
          </button>
          <button className="icon-button"><MoreVertical size={20} /></button>
        </div>
      </header>
      
      <div className="agent-editor-body">
        {renderLeftPanel()}
        <div className="agent-editor-center">
          {renderCenterContent()}
        </div>
        {renderRightPanel()}
      </div>
    </div>
  );
};

export default AgentEditor;
