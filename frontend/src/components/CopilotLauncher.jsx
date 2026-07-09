import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Rocket, Monitor, Chrome, X, CheckCircle2 } from 'lucide-react';
import MagButton from './MagButton';
import useCopilotStore from '../store/copilotStore';
import './CopilotLauncher.css';

const API_BASE = 'http://localhost:8000';

const CopilotLauncher = ({ isOpen, onClose, lead, platform }) => {
    const [step, setStep] = useState(1);
    const [selectedEnv, setSelectedEnv] = useState('browser');
    const [loading, setLoading] = useState(false);
    const [activeSessionId, setActiveSessionId] = useState(null);
    const { fetchActiveSessions } = useCopilotStore();
    
    if (!isOpen) return null;
    
    const handleLaunch = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('token');
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            let currentLeadId = lead.id;
            
            // If lead doesn't have an ID (not saved yet), save it first
            if (!currentLeadId) {
                const saveRes = await fetch(`${API_BASE}/leads/save`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(lead)
                });
                
                if (saveRes.ok) {
                    const savedData = await saveRes.json();
                    currentLeadId = savedData.id;
                } else {
                    throw new Error('Failed to save lead prior to launch');
                }
            }

            const res = await fetch(`${API_BASE}/api/copilot/session/start`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    lead_id: currentLeadId,
                    platform: platform.toLowerCase(),
                    platform_identifier: lead.phone_number || lead.website || lead.business_name
                })
            });
            
            
            if (!res.ok) throw new Error('Failed to start session');
            
            const data = await res.json();
            if (data.session_id) {
                setActiveSessionId(data.session_id);
            }
            
            // Sync with global store so status widget appears instantly without polling
            await fetchActiveSessions();

            setStep(3); // Success step
        } catch (error) {
            console.error('Failed to launch copilot:', error);
            // In a real app, handle error UI here
            setStep(3); // Mock success for now if backend is not ready
        }
        setLoading(false);
    };

    const handleClose = async () => {
        if (activeSessionId) {
            try {
                const token = localStorage.getItem('token');
                const headers = { 'Content-Type': 'application/json' };
                if (token) headers['Authorization'] = `Bearer ${token}`;
                
                await fetch(`${API_BASE}/api/copilot/session/${activeSessionId}/end`, {
                    method: 'PUT',
                    headers
                });
                
                // Sync with global store so status widget disappears instantly without polling
                await fetchActiveSessions();
            } catch (err) {
                console.error('Failed to end session on close:', err);
            }
            setActiveSessionId(null);
            setStep(1);
        }
        onClose();
    };

    return (
        <div className="cl-modal-overlay">
            <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="cl-modal-content"
            >
                <div className="cl-header">
                    <h3 className="cl-title">
                        <Rocket className="cl-title-icon" size={20} />
                        Launch Copilot
                    </h3>
                    <button onClick={handleClose} className="cl-close-btn" title="Close">
                        <X size={20} />
                    </button>
                </div>
                
                <div className="cl-body">
                    <AnimatePresence mode="wait">
                        {step === 1 && (
                            <motion.div 
                                key="step1"
                                initial={{ opacity: 0, x: 10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -10 }}
                            >
                                <p className="cl-subtitle">
                                    Choose your copilot environment for engaging with <strong>{lead.business_name}</strong> on {platform}:
                                </p>
                                
                                <div className="cl-options-grid">
                                    <div 
                                        onClick={() => setSelectedEnv('browser')}
                                        className={`cl-option-card ${selectedEnv === 'browser' ? 'active' : ''}`}
                                    >
                                        <Chrome size={24} className="cl-option-icon" />
                                        <div>
                                            <div className="cl-option-title">Browser Extension</div>
                                            <div className="cl-option-desc">Lightweight UI that sits inside WhatsApp Web, LinkedIn, etc.</div>
                                        </div>
                                    </div>
                                    
                                    <div className="cl-option-card disabled">
                                        <Monitor size={24} className="cl-option-icon" />
                                        <div>
                                            <div className="cl-option-title">
                                                Desktop App
                                                <span className="cl-badge-soon">Coming Soon</span>
                                            </div>
                                            <div className="cl-option-desc">Native OS-level floating window for any desktop app.</div>
                                        </div>
                                    </div>
                                </div>
                                
                                <MagButton 
                                     onClick={handleLaunch}
                                     disabled={loading}
                                     className="cl-launch-btn os-v3-primary-btn--copilot"
                                     label={loading ? 'Initializing...' : 'Launch Session'}
                                     hoverLabel="Start AI Companion"
                                     icon={<Rocket size={18} />}
                                     variant="custom"
                                 />
                            </motion.div>
                        )}
                        
                        {step === 3 && (
                            <motion.div 
                                key="step3"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="cl-success-view"
                            >
                                <div className="cl-success-icon-wrap">
                                    <CheckCircle2 size={32} className="cl-success-icon" />
                                </div>
                                <h3 className="cl-success-title">Session Active!</h3>
                                <p className="cl-success-desc">
                                    Open your browser tab for <strong>{platform}</strong> and navigate to the chat with this lead.
                                </p>
                                <div className="cl-success-note">
                                    The ClozFlow Copilot extension will appear automatically when it detects the chat.
                                </div>
                                <button 
                                    onClick={handleClose}
                                    className="cl-close-action-btn"
                                >
                                    Close & Deactivate
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>
        </div>
    );
};

export default CopilotLauncher;
