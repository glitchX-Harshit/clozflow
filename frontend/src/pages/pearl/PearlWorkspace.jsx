import React, { useState } from 'react';
import { 
  Bot, Phone, Megaphone, Code, 
  List, BarChart3, Settings, BookOpen 
} from 'lucide-react';
import './PearlWorkspace.css';
import AgentEditor from './AgentEditor';

const NAV_SECTIONS = [
  {
    label: 'DEPLOY',
    items: [
      { id: 'agent', icon: Bot, label: 'Agent' },
      { id: 'phone_numbers', icon: Phone, label: 'Phone numbers' },
      { id: 'outbound', icon: Megaphone, label: 'Outbound campaigns' },
      { id: 'developers', icon: Code, label: 'Deploy with code' }
    ]
  },
  {
    label: 'MONITOR',
    items: [
      { id: 'call_logs', icon: List, label: 'Call logs' },
      { id: 'analytics', icon: BarChart3, label: 'Agent analytics' }
    ]
  },
  {
    label: 'SYSTEM',
    items: [
      { id: 'settings', icon: Settings, label: 'Settings' },
      { id: 'docs', icon: BookOpen, label: 'Documentation' }
    ]
  }
];

const PearlWorkspace = () => {
  const [activeSection, setActiveSection] = useState('agent');

  const renderContent = () => {
    if (activeSection === 'agent') {
      return <AgentEditor />;
    }
    
    return (
      <div className="pearl-placeholder-content">
        <h2>{activeSection.replace('_', ' ').toUpperCase()}</h2>
        <p>This section is under construction.</p>
      </div>
    );
  };

  return (
    <div className="pearl-workspace">
      <aside className="pearl-sidebar">
        <div className="pearl-sidebar-header">
          <div className="pearl-brand-icon">
            <Bot size={24} color="var(--accent)" />
          </div>
          <div className="pearl-brand-text">
            <h2>Pearl</h2>
            <span>Voice Agent</span>
          </div>
        </div>

        <nav className="pearl-nav">
          {NAV_SECTIONS.map((section, idx) => (
            <div key={idx} className="pearl-nav-section">
              <span className="pearl-nav-label">{section.label}</span>
              <div className="pearl-nav-items">
                {section.items.map((item) => (
                  <button
                    key={item.id}
                    className={`pearl-nav-item ${activeSection === item.id ? 'active' : ''}`}
                    onClick={() => setActiveSection(item.id)}
                  >
                    <item.icon size={18} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      
      <main className="pearl-main-content">
        {renderContent()}
      </main>
    </div>
  );
};

export default PearlWorkspace;
