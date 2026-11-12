import React, { useEffect, useRef } from 'react';
import {
  Home, Bot, Workflow, BookOpen,
  Phone, PhoneIncoming, Megaphone, Code,
  BarChart3, Kanban, List, Sparkles, Settings,
  Layers, CircleDot, FileText
} from 'lucide-react';
import gsap from 'gsap';
import { pearlMenuGroups } from '../pages/pearl/lib/subsectionNav';
import './PearlSecondarySidebar.css';
import pearlLogo from '../assets/pearl-logo.png';

const SECTION_ICONS = {
  home: Home,
  agents: Bot,
  workflows: Workflow,
  knowledge: BookOpen,
  phone_numbers: Phone,
  inbound: PhoneIncoming,
  outbound: Megaphone,
  deploy_code: Code,
  agent_analytics: BarChart3,
  boards: Kanban,
  call_logs: List,
  whats_new: Sparkles,
  settings: Settings,
  mcp: Layers,
  usage: CircleDot,
  documentation: FileText
};

const MENU_GROUPS = pearlMenuGroups();

const NavButton = ({ section, isActive, onSelect, extraClass = '' }) => {
  const Icon = SECTION_ICONS[section.id] || CircleDot;
  return (
    <button
      type="button"
      onClick={() => onSelect(section.id)}
      className={`pearl-sec-btn ${extraClass} ${isActive ? 'active' : ''}`}
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon size={17} strokeWidth={isActive ? 2 : 1.75} className="pearl-sec-btn-icon" aria-hidden="true" />
      <span className="pearl-sec-btn-label">{section.label}</span>
      {!section.available && (
        <span className="pearl-sec-badge soon" title="Not available yet">Soon</span>
      )}
    </button>
  );
};

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

  const select = (id) => {
    if (typeof onSelectSection === 'function') onSelectSection(id);
  };

  return (
    <aside className="pearl-sec-sidebar" ref={sidebarRef}>
      {/* Sidebar header */}
      <div className="pearl-sec-header-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <img src={pearlLogo} alt="" aria-hidden="true" style={{ width: '20px', height: '20px', objectFit: 'contain' }} />
          <span className="pearl-sec-title">Voice Agents</span>
        </div>
      </div>

      {/* Navigation sections */}
      <nav className="pearl-sec-nav" aria-label="Pearl sections">
        {MENU_GROUPS.map((group) => {
          if (group.type === 'single') {
            return (
              <div key={group.section.id} className="pearl-sec-single-wrap">
                <NavButton
                  section={group.section}
                  isActive={activeSection === group.section.id}
                  onSelect={select}
                  extraClass="pearl-sec-home-btn"
                />
              </div>
            );
          }

          return (
            <div key={group.title} className={`pearl-sec-group ${group.isUtility ? 'utility-group' : ''}`}>
              {!group.isUtility && (
                <span className="pearl-sec-group-title">{group.title}</span>
              )}
              {group.isUtility && <div className="pearl-sec-divider" role="separator" />}
              <div className="pearl-sec-group-items">
                {group.sections.map((section) => (
                  <NavButton
                    key={section.id}
                    section={section}
                    isActive={activeSection === section.id}
                    onSelect={select}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
};

export default PearlSecondarySidebar;
