import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import { apiFetch, errorMessage } from '../lib/apiFetch';
import MagButton from '../components/MagButton';
import './CallBriefing.css';

const str = (value) => (typeof value === 'string' ? value : '');

const REQUIRED_FIELDS = [
    ['client_name', 'Prospect Name'],
    ['client_industry', 'Company / Industry'],
    ['client_role', 'Title / Role'],
    ['product_name', 'Your Product or Service'],
    ['call_goal', 'Strategic Call Goal'],
];

/** Product fields from a saved capsule (multi-line specification). */
function withCapsule(prev, capsule) {
    let specString = capsule.product_specification || '';
    if (capsule.target_audience) specString += `\nTarget Audience: ${capsule.target_audience}`;
    if (capsule.key_differentiators) specString += `\nKey Differentiators: ${capsule.key_differentiators}`;
    if (capsule.pain_points_solved) specString += `\nPain Points Solved: ${capsule.pain_points_solved}`;
    if (capsule.additional_context) specString += `\nAdditional Context: ${capsule.additional_context}`;

    return {
        ...prev,
        product_name: capsule.product_name || prev.product_name,
        product_price: capsule.product_price || prev.product_price,
        product_specification: specString.trim() || prev.product_specification,
    };
}

const CallBriefing = () => {
    const navigate = useNavigate();
    const { state } = useLocation();
    const [formData, setFormData] = useState(() => {
        // Prefill sent by Lead Finder / the Intelligence panel ("Live Copilot" on a lead).
        const prefill = state?.prefill ?? {};
        return {
            client_name: str(prefill.client_name),
            client_industry: str(prefill.client_industry),
            client_role: str(prefill.client_role),
            product_name: '',
            product_price: '',
            product_specification: '',
            call_goal: str(prefill.call_goal),
        };
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null); // { message, auth? }
    const [missing, setMissing] = useState([]);
    const [capsules, setCapsules] = useState([]);
    const [showCapsuleFeedback, setShowCapsuleFeedback] = useState(false);
    const [selectedCapsuleId, setSelectedCapsuleId] = useState(null);

    const flashCapsuleFeedback = () => {
        setShowCapsuleFeedback(true);
        setTimeout(() => setShowCapsuleFeedback(false), 2000);
    };

    // Latest form values for the async capsule response (it can arrive after the user typed).
    const formRef = useRef(formData);
    useEffect(() => {
        formRef.current = formData;
    });

    useEffect(() => {
        let cancelled = false;
        const hasProduct = (f) => !!(f.product_name || f.product_price || f.product_specification);
        apiFetch('/api/capsules')
            .then((data) => {
                if (cancelled || !Array.isArray(data)) return;
                setCapsules(data);
                const defaultCap = data.find((c) => c.is_default);
                // Never overwrite product fields the user already typed.
                if (!defaultCap || hasProduct(formRef.current)) return;
                setFormData((prev) => (hasProduct(prev) ? prev : withCapsule(prev, defaultCap)));
                setSelectedCapsuleId(defaultCap.id);
                setShowCapsuleFeedback(true);
                setTimeout(() => setShowCapsuleFeedback(false), 2000);
            })
            .catch((err) => {
                // Capsules are optional; the form still works without them.
                console.warn('Failed to fetch capsules:', err?.message || err);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const updateField = (key, value) => {
        setFormData((prev) => ({ ...prev, [key]: value }));
        if (missing.includes(key) && value.trim()) setMissing((prev) => prev.filter((k) => k !== key));
    };

    const applyCapsule = (capsule) => {
        setFormData((prev) => withCapsule(prev, capsule));
        setSelectedCapsuleId(capsule.id);
        flashCapsuleFeedback();
    };

    const handleCapsuleSelect = (capsule) => {
        if (selectedCapsuleId === capsule.id) {
            // If already selected, deselect and clear product fields
            setFormData((prev) => ({
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
        if (loading) return;

        const body = Object.fromEntries(Object.entries(formData).map(([k, v]) => [k, str(v).trim()]));
        const blank = REQUIRED_FIELDS.filter(([key]) => !body[key]).map(([key]) => key);
        if (blank.length) {
            setMissing(blank);
            const names = REQUIRED_FIELDS.filter(([key]) => blank.includes(key)).map(([, label]) => label);
            setError({ message: `Fill in ${names.join(', ')} before launching the session.` });
            return;
        }

        setMissing([]);
        setError(null);
        setLoading(true);

        // Open the copilot window inside the user gesture (requestWindow runs synchronously here).
        let winRefs = null;
        let navigated = false;
        try {
            try {
                winRefs = await openCopilotWindow();
            } catch (winErr) {
                console.warn('[Copilot] Could not auto-open on gesture:', winErr?.message);
            }

            const data = await apiFetch('/call/start', { method: 'POST', body });
            if (!data?.context_id) throw new Error('missing context id');

            // Store references in Zustand so the Portal renders immediately in the new window
            if (winRefs) {
                useCopilotStore.getState().setExternalRefs(winRefs.win, winRefs.container);
            }
            navigated = true;
            navigate('/live-call', { state: { contextId: data.context_id, callContext: body } });
        } catch (err) {
            setError({
                message: errorMessage(err, 'Failed to create call context. Please try again.'),
                auth: err?.status === 401,
            });
        } finally {
            if (!navigated) {
                // A window opened for a session that never started must not linger.
                if (winRefs?.win) {
                    try {
                        winRefs.win.close();
                    } catch {
                        // already closed
                    }
                }
                setLoading(false);
            }
        }
    };

    // Server limits for /call/start (longer values are rejected with 422).
    const maxLengthOf = (key) => (key === 'product_specification' ? 8000 : key === 'call_goal' ? 2000 : 500);

    const fieldProps = (key) => ({
        id: `cb-${key}`,
        maxLength: maxLengthOf(key),
        value: formData[key],
        onChange: (e) => updateField(key, e.target.value),
        'aria-invalid': missing.includes(key) || undefined,
    });

    return (
        <div className="cb-overlay" data-lenis-prevent>
            {/* Back button */}
            <button type="button" className="cb-back interactive" onClick={() => navigate(-1)}>
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

                <form className="cb-form" onSubmit={handleSubmit} noValidate>
                    <div className="cb-grid-fields">
                        <div className="cb-field">
                            <label className="cb-label" htmlFor="cb-client_name"><User size={14} color="var(--accent)" aria-hidden="true" /> Prospect Name</label>
                            <input
                                type="text"
                                className="cb-input"
                                placeholder="Sarah Chen"
                                required
                                aria-required="true"
                                {...fieldProps('client_name')}
                            />
                        </div>
                        <div className="cb-field">
                            <label className="cb-label" htmlFor="cb-client_industry"><Building size={14} color="var(--accent)" aria-hidden="true" /> Company / Industry</label>
                            <input
                                type="text"
                                className="cb-input"
                                placeholder="Fintech Inc."
                                required
                                aria-required="true"
                                {...fieldProps('client_industry')}
                            />
                        </div>
                        <div className="cb-field">
                            <label className="cb-label" htmlFor="cb-client_role"><Briefcase size={14} color="var(--accent)" aria-hidden="true" /> Title / Role</label>
                            <input
                                type="text"
                                className="cb-input"
                                placeholder="VP of Sales"
                                required
                                aria-required="true"
                                {...fieldProps('client_role')}
                            />
                        </div>
                    </div>

                    <div className="cb-field" style={{ position: 'relative' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <label className="cb-label" htmlFor="cb-product_name" style={{ margin: 0 }}>
                                <Zap size={14} color="var(--accent)" aria-hidden="true" /> Your Product or Service
                            </label>
                            {showCapsuleFeedback && (
                                <span className="animate-fade-in" role="status" style={{
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
                                role="group"
                                aria-label="Saved product capsules"
                            >
                                {capsules.map(c => {
                                    const isSelected = selectedCapsuleId === c.id;
                                    return (
                                        <button
                                            key={c.id}
                                            type="button"
                                            className="cb-capsule-pill"
                                            aria-pressed={isSelected}
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
                                                aria-hidden="true"
                                            />
                                            {c.name}
                                            {c.is_default && (
                                                <span style={{ fontSize: '0.65rem', opacity: 0.8 }} aria-label="(default)">⭐</span>
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
                            aria-required="true"
                            {...fieldProps('product_name')}
                            onChange={(e) => {
                                updateField('product_name', e.target.value);
                                setSelectedCapsuleId(null);
                            }}
                        />
                    </div>

                    <div className="cb-field">
                        <label className="cb-label" htmlFor="cb-product_price"><Zap size={14} color="var(--accent)" aria-hidden="true" /> Product Price / Value</label>
                        <input
                            type="text"
                            className="cb-input"
                            placeholder="$50k/year or $5k setup"
                            {...fieldProps('product_price')}
                        />
                    </div>

                    <div className="cb-field">
                        <label className="cb-label" htmlFor="cb-product_specification"><Zap size={14} color="var(--accent)" aria-hidden="true" /> Product Specification</label>
                        <textarea
                            className="cb-textarea"
                            rows={4}
                            placeholder="Key features or specs"
                            {...fieldProps('product_specification')}
                        />
                    </div>

                    <div className="cb-field">
                        <label className="cb-label" htmlFor="cb-call_goal"><Target size={14} color="var(--accent)" aria-hidden="true" /> Strategic Call Goal</label>
                        <textarea
                            className="cb-textarea"
                            placeholder="Identify pain points regarding lead velocity and handle pricing objections for the Q3 pilot..."
                            required
                            aria-required="true"
                            {...fieldProps('call_goal')}
                        />
                    </div>

                    {error && (
                        <div className="cb-error" role="alert">
                            {error.message}
                            {error.auth && (
                                <button type="button" className="cb-error-action" onClick={() => navigate('/auth', { state: { view: 'login' } })}>
                                    Sign in again
                                </button>
                            )}
                        </div>
                    )}

                    <MagButton
                        label={loading ? 'Initializing Engine...' : 'Launch Intelligence Session'}
                        aria-label={loading ? 'Initializing engine' : 'Launch Intelligence Session'}
                        type="submit"
                        disabled={loading}
                        variant="dark"
                        fullWidth
                        icon={<Sparkles size={18} />}
                        magnetStrength={0.25}
                        className="cb-submit-mag"
                    />

                    <div className="cb-footnote">
                        <CheckCircle2 size={14} color="#10b981" aria-hidden="true" />
                        <span>AI will optimize suggestions for this specific target and goal.</span>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CallBriefing;
