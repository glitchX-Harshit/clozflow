import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import AgentEditor from './AgentEditor';
import { useDashboardStore } from '../../store/useDashboardStore';
import './AgentEditor.css';

export const AgentEditorPage = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const archetypeId = searchParams.get('archetype');
  const navigate = useNavigate();
  const location = useLocation();
  // Id of an agent created on this page: the URL switches to it without remounting the editor.
  const [createdId, setCreatedId] = useState(null);

  const parsedId = (id && id !== 'new') ? id : null;
  // Same editor instance while a new agent receives its id; a fresh one for any other agent.
  const editorKey = parsedId && parsedId !== createdId ? parsedId : 'new';

  const handleBack = useCallback(() => {
    // Restore dashboard Pearl tab when navigating back
    try {
      useDashboardStore.getState().setActiveTab('pearl');
    } catch {
      // store unavailable: the dashboard opens on its default tab
    }
    navigate('/dashboard');
  }, [navigate]);

  const handleCreated = useCallback((newId) => {
    if (newId) setCreatedId(String(newId));
  }, []);

  // After the first save of a new agent, replace /agent-editor/new with /agent-editor/<id>
  // so a reload (or Back/Forward) reopens the same agent instead of a blank "new" editor.
  const redirectedRef = useRef(null);
  useEffect(() => {
    if (!createdId || redirectedRef.current === createdId) return;
    redirectedRef.current = createdId; // once per created agent; later navigation is the user's
    if (parsedId === createdId) return;
    const base = location.pathname.startsWith('/pearl/') ? '/pearl/agent-editor' : '/agent-editor';
    navigate(`${base}/${encodeURIComponent(createdId)}`, { replace: true });
  }, [createdId, parsedId, location.pathname, navigate]);

  return (
    <div className="agent-editor-page-container">
      <AgentEditor
        key={editorKey}
        agentId={parsedId}
        initialArchetypeId={archetypeId}
        onBack={handleBack}
        onCreated={handleCreated}
      />
    </div>
  );
};

export default AgentEditorPage;
