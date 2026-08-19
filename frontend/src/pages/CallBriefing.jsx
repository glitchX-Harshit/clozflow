import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    ArrowLeft, 
    User, 
    Building, 
    Target, 
    Sparkles, 
    CheckCircle2, 
    Briefcase,
    Zap,
    Pill
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
        product_price: '',
        product_specification: '',
        call_goal: ''
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [capsules, setCapsules] = useState([]);
    const [showCapsuleFeedback, setShowCapsuleFeedback] = useState(false);
    const [selectedCapsuleId, setSelectedCapsuleId] = useState(null);

    useEffect(() => {
        const fetchCapsules = async () => {
            try {
                const token = localStorage.getItem('token');
                if (!token) return;
                
                const response = await fetch('http://localhost:8000/api/capsules', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    setCapsules(data);
                    
                    // Auto-load default if form is empty
                    const defaultCap = data.find(c => c.is_default);
                    if (defaultCap && !formData.product_name && !formData.product_price && !formData.product_specification) {
                        applyCapsule(defaultCap);
                    }
                }
            } catch (err) {
                console.error("Failed to fetch capsules", err);
            }
        };
        fetchCapsules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const applyCapsule = (capsule) => {
        let specString = capsule.product_specification || '';
        
        if (capsule.target_audience) specString += `\nTarget Audience: ${capsule.target_audience}`;
        if (capsule.key_differentiators) specString += `\nKey Differentiators: ${capsule.key_differentiators}`;
        if (capsule.pain_points_solved) specString += `\nPain Points Solved: ${capsule.pain_points_solved}`;
        if (capsule.additional_context) specString += `\nAdditional Context: ${capsule.additional_context}`;

        setFormData(prev => ({
            ...prev,
            product_name: capsule.product_name || prev.product_name,
            product_price: capsule.product_price || prev.product_price,
            product_specification: specString.trim() || prev.product_specification
        }));
        setSelectedCapsuleId(capsule.id);

        setShowCapsuleFeedback(true);
        setTimeout(() => setShowCapsuleFeedback(false), 2000);
    };

    const handleCapsuleSelect = (capsule) => {
        if (selectedCapsuleId === capsule.id) {
            // If already selected, deselect and clear product fields
            setFormData(prev => ({
                ...prev,
                product_name: '',
                product_price: '',
                product_specification: ''
            }));
            setSelectedCapsuleId(null);
        } else {
            applyCapsule(capsule);
        }
    };

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
        <div className="cb-overlay" data-lenis-prevent>
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

                    <div className="cb-field" style={{ position: 'relative' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <label className="cb-label" style={{ margin: 0 }}>
                                <Zap size={14} color="var(--accent)" /> Your Product or Service
                            </label>
                            {showCapsuleFeedback && (
                                <span className="animate-fade-in" style={{
                                    color: '#10b981', fontSize: '0.72rem', fontWeight: 700,
                                    display: 'flex', alignItems: 'center', gap: '0.25rem',
                                    background: 'rgba(16,185,129,0.06)',
                                    padding: '0.2rem 0.6rem', borderRadius: 99,
                                    textTransform: 'uppercase', letterSpacing: '0.04em'
                                }}>
                                    ✓ Applied Specs
                                </span>
                            )}
                        </div>

                        {/* Awwwards-style horizontal scrolling pill track for Saved Product Capsules */}
                        {capsules.length > 0 && (
                            <div 
                                style={{ 
                                    display: 'flex', gap: '0.5rem', overflowX: 'auto', 
                                    padding: '0.25rem 0.25rem 0.85rem', margin: '0 -0.25rem 0.5rem',
                                    scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch'
                                }} 
                                className="no-scrollbar"
                            >
                                {capsules.map(c => {
                                    const isSelected = selectedCapsuleId === c.id;
                                    return (
                                        <button
                                            key={c.id}
                                            type="button"
                                            onClick={() => handleCapsuleSelect(c)}
                                            style={{
                                                display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
                                                background: isSelected ? 'var(--text)' : 'var(--surface-2)',
                                                border: `1px solid ${isSelected ? 'var(--text)' : 'var(--border-strong)'}`,
                                                borderRadius: 99, padding: '0.45rem 1rem',
                                                fontSize: '0.78rem', fontWeight: 600,
                                                color: isSelected ? 'var(--bg)' : 'var(--text)',
                                                cursor: 'pointer', whiteSpace: 'nowrap',
                                                transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                                                boxShadow: isSelected ? 'var(--shadow-sm)' : 'none',
                                                outline: 'none'
                                            }}
                                            onMouseEnter={e => {
                                                if (!isSelected) {
                                                    e.currentTarget.style.borderColor = 'var(--text)';
                                                    e.currentTarget.style.background = 'var(--surface)';
                                                }
                                            }}
                                            onMouseLeave={e => {
                                                if (!isSelected) {
                                                    e.currentTarget.style.borderColor = 'var(--border-strong)';
                                                    e.currentTarget.style.background = 'var(--surface-2)';
                                                }
                                            }}
                                        >
                                            <Pill 
                                                size={11} 
                                                color={isSelected ? 'var(--bg)' : '#e11d48'} 
                                                style={{ transition: 'color 0.25s ease' }} 
                                            />
                                            {c.name}
                                            {c.is_default && (
                                                <span style={{ fontSize: '0.65rem', opacity: 0.8 }}>⭐</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        <input 
                            type="text" 
                            className="cb-input" 
                            placeholder="Enterprise Sales Acceleration Platform"
                            required
                            value={formData.product_name}
                            onChange={(e) => {
                                setFormData({...formData, product_name: e.target.value});
                                setSelectedCapsuleId(null);
                            }}
                        />
                    </div>

                    <div className="cb-field">
                        <label className="cb-label"><Zap size={14} color="var(--accent)" /> Product Price / Value</label>
                        <input 
                            type="text" 
                            className="cb-input" 
                            placeholder="$50k/year or $5k setup"
                            value={formData.product_price}
                            onChange={(e) => setFormData({...formData, product_price: e.target.value})}
                        />
                    </div>

                    <div className="cb-field">
                        <label className="cb-label"><Zap size={14} color="var(--accent)" /> Product Specification</label>
                        <input 
                            type="text" 
                            className="cb-input" 
                            placeholder="Key features or specs"
                            value={formData.product_specification}
                            onChange={(e) => setFormData({...formData, product_specification: e.target.value})}
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
