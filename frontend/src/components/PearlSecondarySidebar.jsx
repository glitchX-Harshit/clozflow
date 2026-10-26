import React, { useEffect, useRef } from 'react';
import { 
  Home, Bot, Workflow, BookOpen, 
  Phone, PhoneIncoming, Megaphone, Code, 
  BarChart3, Kanban, List, Sparkles, Settings,
  Layers, CircleDot, FileText, PanelLeft
} from 'lucide-react';
import gsap from 'gsap';
import './PearlSecondarySidebar.css';
import pearlLogo from '../assets/pearl-logo.png';

export const PEARL_MENU_SECTIONS = [
  {
    type: 'single',
    id: 'home',
    label: 'Home',
    icon: Home
  },
  {
    type: 'group',
    title: 'Build',
    items: [
      { id: 'agents', label: 'Agents', icon: Bot },
      { id: 'workflows', label: 'Workflows', icon: Workflow },
      { id: 'knowledge', label: 'Knowledge base', icon: BookOpen }
    ]
  },
  {
    type: 'group',
    title: 'Deploy',
    items: [
      { id: 'phone_numbers', label: 'Phone numbers', icon: Phone },
      { id: 'inbound', label: 'Inbound calls', icon: PhoneIncoming },
      { id: 'outbound', label: 'Outbound campaigns', icon: Megaphone },
      { id: 'deploy_code', label: 'Deploy with code', icon: Code }
    ]
  },
  {
    type: 'group',
    title: 'Monitor',
    items: [
      { id: 'agent_analytics', label: 'Agent analytics', icon: BarChart3 },
      { id: 'boards', label: 'Boards', icon: Kanban },
      { id: 'call_logs', label: 'Call logs', icon: List }
    ]
  },
  {
    type: 'group',
    title: 'Utilities',
    isUtility: true,
    items: [
      { id: 'whats_new', label: "What's new", icon: Sparkles, badge: 'New' },
      { id: 'settings', label: 'Settings', icon: Settings },
      { id: 'mcp', label: 'MCP', icon: Layers, badge: 'New' },
      { id: 'usage', label: 'Usage', icon: CircleDot },
      { id: 'documentation', label: 'Documentation', icon: FileText }
    ]
  }
];

const PearlSecondarySidebar = ({ activeSection, onSelectSection }) => {
  const sidebarRef = useRef(null);

  useEffect(() => {
    if (sidebarRef.current) {
      gsap.fromTo(sidebarRef.current,
        { x: -14, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.28, ease: 'power3.out' }
      );

      const navButtons = sidebarRef.current.querySelectorAll('.pearl-sec-btn');
      if (navButtons.length > 0) {
        gsap.fromTo(navButtons,
          { x: -8, opacity: 0 },
          { x: 0, opacity: 1, duration: 0.24, stagger: 0.015, ease: 'power2.out', delay: 0.04 }
        );
      }
    }
  }, []);

  return (
    <aside className="pearl-sec-sidebar" ref={sidebarRef}>
      {/* Sidebar Header with Title and Toggle Icon */}
      <div className="pearl-sec-header-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <img src={pearlLogo} alt="Pearl" style={{ width: '20px', height: '20px', objectFit: 'contain' }} />
          <span className="pearl-sec-title">Voice Agents</span>
        </div>
        <button 
          type="button" 
          className="pearl-sec-dock-btn" 
          title="Sidebar layout"
        >
          <PanelLeft size={16} />
        </button>
      </div>

      {/* Navigation Sections */}
      <nav className="pearl-sec-nav">
        {PEARL_MENU_SECTIONS.map((section, sIdx) => {
          if (section.type === 'single') {
            const Icon = section.icon;
            const isActive = activeSection === section.id;
            return (
              <div key={section.id} className="pearl-sec-single-wrap">
                <button
                  type="button"
                  onClick={() => onSelectSection(section.id)}
                  className={`pearl-sec-btn pearl-sec-home-btn ${isActive ? 'active' : ''}`}
                >
                  <Icon size={17} strokeWidth={isActive ? 2 : 1.75} className="pearl-sec-btn-icon" />
                  <span className="pearl-sec-btn-label">{section.label}</span>
                </button>
              </div>
            );
          }

          return (
            <div key={sIdx} className={`pearl-sec-group ${section.isUtility ? 'utility-group' : ''}`}>
              {!section.isUtility && (
                <span className="pearl-sec-group-title">{section.title}</span>
              )}
              {section.isUtility && <div className="pearl-sec-divider" />}
              <div className="pearl-sec-group-items">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectSection(item.id)}
                      className={`pearl-sec-btn ${isActive ? 'active' : ''}`}
                    >
                      <Icon size={17} strokeWidth={isActive ? 2 : 1.75} className="pearl-sec-btn-icon" />
                      <span className="pearl-sec-btn-label">{item.label}</span>
                      {item.badge && (
                        <span className="pearl-sec-badge">{item.badge}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
};

export default PearlSecondarySidebar;
