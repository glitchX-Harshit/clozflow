import React from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import AgentEditor from './AgentEditor';
import { useDashboardStore } from '../../store/useDashboardStore';
import './AgentEditor.css';

export const AgentEditorPage = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const archetypeId = searchParams.get('archetype');
  const navigate = useNavigate();

  const handleBack = () => {
    // Restore dashboard Pearl tab when navigating back
    try {
      useDashboardStore.getState().setActiveTab('pearl');
    } catch {
      // fallback
    }
    navigate('/dashboard');
  };

  const parsedId = (id && id !== 'new') ? id : null;

  return (
    <div className="agent-editor-page-container">
      <AgentEditor 
        agentId={parsedId} 
        initialArchetypeId={archetypeId}
        onBack={handleBack} 
      />
    </div>
  );
};

export default AgentEditorPage;
