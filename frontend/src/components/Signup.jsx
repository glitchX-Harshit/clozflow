import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, CheckCircle, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { gsap } from 'gsap';
import MagButton from './MagButton';
import './Signup.css';

const Signup = ({ onBack, onSwitchToLogin, onSignupSuccess }) => {
    const [formData, setFormData] = useState({
        email: '',
        password: ''
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [showPassword, setShowPassword] = useState(false);
    const { login } = useAuth();
    const cardRef = useRef(null);
    const contentRef = useRef(null);

    useEffect(() => {
        const ctx = gsap.context(() => {
            gsap.from(cardRef.current, {
                y: 30,
                opacity: 0,
                duration: 1,
                ease: 'power4.out',
                delay: 0.1
            });
            
            gsap.fromTo('.su-head > *, .su-form', 
                { y: 20, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    stagger: 0.08,
                    duration: 0.6,
                    ease: 'power3.out',
                    delay: 0.2,
                    clearProps: 'all'
                }
            );
        });
        return () => ctx.revert();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('http://localhost:8000/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: formData.email, password: formData.password })
            });
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.detail || 'Failed to create account');
            }
            const data = await res.json();
            login(data.access_token, { id: data.user_id, email: data.email });
            onSignupSuccess();
        } catch (err) {
            setError(err.message);
        }
        setLoading(false);
    };

    return (
        <div className="su-overlay">
            <div className="su-blob su-blob-1"></div>
            <div className="su-blob su-blob-2"></div>
            <div className="su-grid"></div>

            <button className="su-back interactive" onClick={onBack}>
                <ArrowLeft size={16} />
                <span>Back</span>
            </button>

            <div className="su-card shadow-premium" ref={cardRef}>
                <div className="su-head">
                    <div className="su-logo-mark">
                        <CheckCircle size={24} color="var(--bg)" />
                    </div>
                    <h2 className="su-title">Get started</h2>
                    <p className="su-subtitle">Join 2,000+ sales professionals closing faster with AI.</p>
                </div>

                <form className="su-form" onSubmit={handleSubmit}>
                    <div className="su-field">
                        <label className="su-label">Work Email</label>
                        <input 
                            type="email" 
                            className="su-input" 
                            placeholder="name@company.com"
                            required
                            value={formData.email}
                            onChange={(e) => setFormData({...formData, email: e.target.value})}
                        />
                    </div>

                    <div className="su-field">
                        <label className="su-label">Password</label>
                        <div className="su-password-wrapper">
                            <input 
                                type={showPassword ? "text" : "password"} 
                                className="su-input" 
                                placeholder="••••••••"
                                required
                                value={formData.password}
                                onChange={(e) => setFormData({...formData, password: e.target.value})}
                            />
                            <button 
                                type="button" 
                                className="su-password-toggle"
                                onClick={() => setShowPassword(!showPassword)}
                                tabIndex="-1"
                            >
                                {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                            </button>
                        </div>
                    </div>

                    {error && <div style={{ color: '#ef4444', marginBottom: '1rem', fontSize: '0.8125rem', textAlign: 'center', fontWeight: 600 }}>{error}</div>}

                    <MagButton
                        label={loading ? 'Creating Account...' : 'Continue'}
                        type="submit"
                        disabled={loading}
                        variant="dark"
                        fullWidth
                        magnetStrength={0.3}
                    />
                </form>

                <p className="su-login-prompt">
                    Already using hexagon? <a href="#" onClick={(e) => { e.preventDefault(); onSwitchToLogin(); }}>Log in</a>
                </p>
            </div>
        </div>
    );
};

export default Signup;


