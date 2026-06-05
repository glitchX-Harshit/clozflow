import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    ArrowLeft, 
    User, 
    Building, 
    Target, 
    Sparkles, 
    CheckCircle2, 
    Briefcase,
    Zap
} from 'lucide-react';
import useCopilotStore from '../store/copilotStore';
import { openCopilotWindow } from '../utils/copilotWindow';
import MagButton from '../components/MagButton';
import './CallBriefing.css';

const CallBriefing = () => {
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        client_name: '',
        client_industry: '',
        client_role: '',
        product_name: '',
        call_goal: ''
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        // Open copilot window immediately on user gesture to avoid browser blocker
        let winRefs = null;
        try {
            winRefs = await openCopilotWindow();
        } catch (winErr) {
            console.warn('[Copilot] Could not auto-open on gesture:', winErr.message);
        }

        setLoading(true);
        setError(null);

        try {
            const token = localStorage.getItem('token');
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const response = await fetch('http://localhost:8000/call/start', {
                method: 'POST',
                headers,
                body: JSON.stringify(formData)
            });

            if (!response.ok) {
                // If call starting fails, close the newly opened window
                if (winRefs && winRefs.win) {
                    try { winRefs.win.close(); } catch {}
                }
                throw new Error('Failed to create call context');
            }

            const data = await response.json();

            // Store references in Zustand so the Portal renders immediately in the new window
            if (winRefs) {
                useCopilotStore.getState().setExternalRefs(winRefs.win, winRefs.container);
            }

            navigate('/live-call', { state: { contextId: data.context_id, callContext: formData } });
        } catch (err) {
            setError(err.message);
            setLoading(false);
        }
    };

    return (
        <div className="cb-overlay">
            {/* Back button */}
            <button className="cb-back interactive" onClick={() => navigate(-1)}>
                <ArrowLeft size={16} strokeWidth={2.5} />
                <span>Back to Dashboard</span>
            </button>

            {/* Card */}
            <div className="cb-card animate-fade-in">
                <div className="cb-head">
                    <div className="cb-logo-mark">
                        <Zap size={24} color="var(--bg)" strokeWidth={2.5} />
                    </div>
                    <div className="cb-head-text">
                        <h2 className="cb-title">Call Intelligence Briefing</h2>
                        <p className="cb-subtitle">Prepare the AI with deal context for maximum closing potential.</p>
                    </div>
                </div>

                <form className="cb-form" onSubmit={handleSubmit}>
                    <div className="cb-grid-fields">
                        <div className="cb-field">
                            <label className="cb-label"><User size={14} color="var(--accent)" /> Prospect Name</label>
                            <input 
                                type="text" 
                                className="cb-input" 
                                placeholder="Sarah Chen"
                                required
                                value={formData.client_name}
                                onChange={(e) => setFormData({...formData, client_name: e.target.value})}
                            />
                        </div>
                        <div className="cb-field">
                            <label className="cb-label"><Building size={14} color="var(--accent)" /> Company / Industry</label>
                            <input 
                                type="text" 
                                className="cb-input" 
                                placeholder="Fintech Inc."
                                required
                                value={formData.client_industry}
                                onChange={(e) => setFormData({...formData, client_industry: e.target.value})}
                            />
                        </div>
                        <div className="cb-field">
                            <label className="cb-label"><Briefcase size={14} color="var(--accent)" /> Title / Role</label>
                            <input 
                                type="text" 
                                className="cb-input" 
                                placeholder="VP of Sales"
                                required
                                value={formData.client_role}
                                onChange={(e) => setFormData({...formData, client_role: e.target.value})}
                            />
                        </div>
                    </div>

                    <div className="cb-field">
                        <label className="cb-label"><Zap size={14} color="var(--accent)" /> Your Product or Service</label>
                        <input 
                            type="text" 
                            className="cb-input" 
                            placeholder="Enterprise Sales Acceleration Platform"
                            required
                            value={formData.product_name}
                            onChange={(e) => setFormData({...formData, product_name: e.target.value})}
                        />
                    </div>

                    <div className="cb-field">
                        <label className="cb-label"><Target size={14} color="var(--accent)" /> Strategic Call Goal</label>
                        <textarea 
                            className="cb-textarea" 
                            placeholder="Identify pain points regarding lead velocity and handle pricing objections for the Q3 pilot..."
                            required
                            value={formData.call_goal}
                            onChange={(e) => setFormData({...formData, call_goal: e.target.value})}
                        />
                    </div>

                    {error && <div className="cb-error">{error}</div>}

                    <MagButton
                        label={loading ? 'Initializing Engine...' : 'Launch Intelligence Session'}
                        type="submit"
                        disabled={loading}
                        variant="dark"
                        fullWidth
                        icon={<Sparkles size={18} />}
                        magnetStrength={0.25}
                        className="cb-submit-mag"
                    />
                    
                    <div className="cb-footnote">
                        <CheckCircle2 size={14} color="#10b981" />
                        <span>AI will optimize suggestions for this specific target and goal.</span>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CallBriefing;
