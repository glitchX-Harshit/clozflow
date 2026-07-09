import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, X, Phone, MessageSquare, Linkedin, Instagram, Activity } from 'lucide-react';
import useCopilotStore from '../store/copilotStore';
import './CopilotStatus.css';

const API_BASE = 'http://localhost:8000';

const CopilotStatus = () => {
    const { activeSessions, fetchActiveSessions, removeActiveSession } = useCopilotStore();

    useEffect(() => {
        fetchActiveSessions();
    }, [fetchActiveSessions]);

    const handleEndSession = async (sessionId) => {
        try {
            const token = localStorage.getItem('token');
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            // Optimistic update + prevent reappearance
            removeActiveSession(sessionId);

            await fetch(`${API_BASE}/api/copilot/session/${sessionId}/end`, {
                method: 'PUT',
                headers
            });
        } catch (error) {
            console.error('Failed to end session:', error);
        }
    };

    if (!activeSessions || activeSessions.length === 0) return null;

    const getPlatformIcon = (platform) => {
        const p = platform?.toLowerCase();
        if (p === 'whatsapp') return <Phone size={12} />;
        if (p === 'linkedin') return <Linkedin size={12} />;
        if (p === 'instagram') return <Instagram size={12} />;
        return <MessageSquare size={12} />;
    };

    return (
        <div className="cs-container animate-fade-in">
            <div className="cs-glow-bar" />
            <div className="cs-header">
                <div className="cs-header-left">
                    <div className="cs-status-indicator">
                        <div className="cs-pulse-wrapper">
                            <span className="cs-pulse-ring"></span>
                            <span className="cs-pulse-dot"></span>
                        </div>
                        <span className="cs-engine-tag">// Copilot Runtime Engine</span>
                    </div>
                    <h3 className="cs-title">Active Outreach Orchestration</h3>
                </div>
                <div className="cs-header-right">
                    <div className="cs-counter-panel">
                        <span className="cs-count-num">{String(activeSessions.length).padStart(2, '0')}</span>
                        <span className="cs-count-lbl">Live Channels</span>
                    </div>
                </div>
            </div>
            
            <div className="cs-grid-wrapper">
                <AnimatePresence mode="popLayout">
                    {activeSessions.map((session, idx) => (
                        <motion.div 
                            key={session.session_id}
                            layout
                            initial={{ opacity: 0, scale: 0.96, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96, y: -10 }}
                            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                            className="cs-session-card"
                        >
                            <div className="cs-card-glow" />
                            
                            <div className="cs-card-header">
                                <span className="cs-session-idx">{(idx + 1).toString().padStart(2, '0')}/</span>
                                <span className={`cs-platform-badge cs-${session.platform?.toLowerCase()}`}>
                                    {getPlatformIcon(session.platform)}
                                    {session.platform}
                                </span>
                            </div>
                            
                            <div className="cs-card-body">
                                <h4 className="cs-lead-name" title={session.business_name}>
                                    {session.business_name}
                                </h4>
                                {session.phone_number ? (
                                    <div className="cs-lead-phone" title="Platform Identifier">
                                        <span className="cs-lead-phone-icon">ID:</span>
                                        <span className="cs-lead-phone-val">{session.phone_number}</span>
                                    </div>
                                ) : (
                                    session.platform_identifier && (
                                        <div className="cs-lead-phone" title="Platform Identifier">
                                            <span className="cs-lead-phone-icon">ID:</span>
                                            <span className="cs-lead-phone-val">{session.platform_identifier}</span>
                                        </div>
                                    )
                                )}
                            </div>
                            
                            <div className="cs-card-footer">
                                <div className="cs-stage-pill">
                                    <Activity size={10} className="cs-activity-icon" />
                                    <span className="cs-stage-lbl">STAGE:</span>
                                    <span className="cs-stage-val">{session.stage?.replace('_', ' ')}</span>
                                </div>
                                
                                <button 
                                    onClick={() => handleEndSession(session.session_id)}
                                    className="cs-disconnect-btn"
                                    title="Terminate Copilot Runtime Session"
                                >
                                    <span>Disconnect</span>
                                    <X size={10} className="cs-cross" />
                                </button>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default CopilotStatus;
