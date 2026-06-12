import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    ArrowLeft,
    Send,
    MessageCircle,
    Sparkles,
    Copy,
    RefreshCw,
    Edit3,
    CheckCircle2,
    AlertTriangle,
    Loader2,
    TrendingUp,
    Phone
} from 'lucide-react';
import './OutreachStudioPage.css';

const API_BASE = 'http://localhost:8000';

const scoreLevel = (score) => {
    if (score >= 70) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
};

const guessCountryCode = (text) => {
    if (!text) return null;
    const t = text.toLowerCase();
    
    // Expanded US list with common typos, abbreviations (CA, NY, TX, FL) and partial matches
    if (/\b(us|usa|united states|america|new york|los angeles|chicago|houston|phoenix|san fran|san farnsico|california|texas|florida|boston|seattle|miami|canada|toronto|vancouver|montreal|calgary)\b/.test(t) || t.includes('san fran') || /\b(ca|ny|tx|fl)\b/.test(t)) return '+1';
    
    if (/\b(uk|united kingdom|london|manchester|birmingham|liverpool|edinburgh|glasgow)\b/.test(t)) return '+44';
    if (/\b(australia|sydney|melbourne|brisbane|perth|adelaide)\b/.test(t)) return '+61';
    if (/\b(uae|united arab emirates|dubai|abu dhabi|sharjah)\b/.test(t)) return '+971';
    if (/\b(germany|berlin|munich|hamburg|frankfurt)\b/.test(t)) return '+49';
    if (/\b(france|paris|marseille|lyon|toulouse)\b/.test(t)) return '+33';
    if (/\b(india|delhi|mumbai|pune|hyderabad|jaipur|bangalore|chennai|lucknow|kolkata|ahmedabad|surat|noida|gurgaon|kochi|indore|chandigarh)\b/.test(t)) return '+91';
    
    return null;
};

const OutreachStudioPage = ({ lead: propLead, userOffer: propUserOffer, onBack: propOnBack }) => {
    const navigate = useNavigate();
    const location = useLocation();
    
    const lead = propLead || location.state?.lead;
    const userOffer = propUserOffer || location.state?.userOffer || '';
    const query = location.state?.query || '';
    const onBackClick = propOnBack || (() => navigate(-1));

    useEffect(() => {
        if (!lead) {
            navigate('/dashboard');
        }
    }, [lead, navigate]);

    const [generatedMessage, setGeneratedMessage] = useState(null);
    const [generating, setGenerating] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editedMessage, setEditedMessage] = useState('');
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState(null);
    
    // Manage target phone number explicitly so country code can be added/edited
    const [targetPhone, setTargetPhone] = useState('');

    useEffect(() => {
        if (lead?.phone_number) {
            // Remove everything except digits and the plus sign
            let num = lead.phone_number.replace(/[^\d+]/g, '');
            
            // Try to guess country code from the search query or the lead's city/address
            const guessedCode = guessCountryCode(query) || guessCountryCode(lead.city) || guessCountryCode(lead.address) || '+91';
            
            if (!num.startsWith('+')) {
                // If it starts with 0 and is likely a local number length, strip the 0
                if (num.startsWith('0') && num.length <= 11) {
                    num = num.substring(1);
                }
                
                // If the length indicates a local number without a country code (<= 10 digits)
                if (num.length <= 10) {
                    num = guessedCode + num;
                } else {
                    // If it's longer than 10 digits without a +, it probably already includes the country code.
                    // For example, 14155551234 or 919876543210
                    num = '+' + num;
                }
            }
            
            setTargetPhone(num);
        }
    }, [lead, query]);

    const handleGenerate = useCallback(async (autoOpenWa = false) => {
        if (!lead) return;
        setGenerating(true);
        setError(null);

        try {
            const resp = await fetch(`${API_BASE}/outreach/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lead_data: lead,
                    channel: 'whatsapp',
                    user_offer: userOffer,
                }),
            });
            if (!resp.ok) throw new Error('Message generation failed');
            const data = await resp.json();
            setGeneratedMessage(data);
            setEditedMessage(data.opening_message || '');
            
            if (autoOpenWa && targetPhone) {
                const encodedMessage = encodeURIComponent(data.opening_message || '');
                const waUrl = `https://api.whatsapp.com/send?phone=${targetPhone.replace(/\D/g, '')}&text=${encodedMessage}`;
                window.open(waUrl, '_blank');
            }
        } catch (err) {
            console.error('Generate error:', err);
            setError('Failed to generate message. Please check your connection and try again.');
        } finally {
            setGenerating(false);
        }
    }, [lead, userOffer, targetPhone]);

    const handleCopy = useCallback((text) => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            }).catch(console.error);
        }
    }, []);

    const openWhatsApp = () => {
        if (!targetPhone) {
            setError("Please provide a valid WhatsApp number with country code.");
            return;
        }
        const text = isEditing ? editedMessage : generatedMessage?.opening_message;
        const encodedMessage = encodeURIComponent(text || '');
        const waUrl = `https://api.whatsapp.com/send?phone=${targetPhone.replace(/\D/g, '')}&text=${encodedMessage}`;
        window.open(waUrl, '_blank');
    };

    if (!lead) return null;

    const messageText = isEditing ? editedMessage : (generatedMessage?.opening_message || '');

    return (
        <div className={`os-v3-wrapper ${propLead ? 'os-v3-wrapper--nested' : ''}`}>
            <div className="os-v3-ambient-glow" />
            
            <button className="os-v3-back" onClick={onBackClick}>
                <ArrowLeft size={16} strokeWidth={2.5} />
                <span>Back</span>
            </button>

            <div className="os-v3-container animate-fade-in-up">
                
                {/* Header */}
                <div className="os-v3-header">
                    <div className="os-v3-logo-box">
                        <MessageCircle size={28} className="os-v3-logo-icon" />
                    </div>
                    <div className="os-v3-header-text">
                        <h2 className="os-v3-title">{lead.business_name}</h2>
                        <p className="os-v3-subtitle">
                            AI-powered sales conversion engine
                        </p>
                    </div>
                </div>

                {error && (
                    <div className="os-v3-error">
                        <AlertTriangle size={18} />
                        {error}
                    </div>
                )}

                {/* Initial State / Generate Action */}
                {!generatedMessage ? (
                    <div className="os-v3-action-panel">
                        <div className="os-v3-action-illustration">
                            <div className="os-v3-pulse-ring" />
                            <Sparkles size={48} className="os-v3-action-icon" />
                        </div>
                        <h3 className="os-v3-action-title">Ready to engage</h3>
                        <p className="os-v3-action-desc">
                            We will analyze {lead.business_name}'s digital footprint, spot a revenue gap, and craft a message designed to earn a reply in seconds.
                        </p>
                        
                        <div style={{ width: '100%', maxWidth: '320px', marginBottom: '1.5rem', textAlign: 'left' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-dim)', marginBottom: '0.5rem' }}>
                                <Phone size={14} /> WhatsApp Number
                            </label>
                            <input 
                                type="text"
                                value={targetPhone}
                                onChange={(e) => setTargetPhone(e.target.value)}
                                placeholder="Include country code (e.g., 919876543210)"
                                className="os-v3-message-input"
                                style={{ minHeight: 'auto', padding: '0.85rem', fontSize: '1rem' }}
                            />
                        </div>
                        
                        <button 
                            className={`os-v3-primary-btn ${generating ? 'loading' : ''}`}
                            onClick={() => handleGenerate(true)}
                            disabled={generating || !targetPhone}
                        >
                            {generating ? (
                                <><Loader2 size={20} className="spin" /> Synthesizing Strategy...</>
                            ) : (
                                <><Send size={18} /> Start Conversation</>
                            )}
                        </button>
                    </div>
                ) : (
                    /* Result State */
                    <div className="os-v3-result-panel animate-fade-in-up">
                        
                        {/* The Message Box */}
                        <div className="os-v3-message-box">
                            <div className="os-v3-message-header">
                                <span className="os-v3-badge"><Sparkles size={12}/> AI Crafted</span>
                                <div className="os-v3-message-actions">
                                    <button className="os-v3-icon-btn" onClick={() => handleCopy(messageText)} title="Copy">
                                        {copied ? <CheckCircle2 size={16} color="#10b981"/> : <Copy size={16} />}
                                    </button>
                                    <button className="os-v3-icon-btn" onClick={() => setIsEditing(!isEditing)} title="Edit">
                                        <Edit3 size={16} />
                                    </button>
                                </div>
                            </div>
                            
                            {isEditing ? (
                                <textarea
                                    className="os-v3-message-input"
                                    value={editedMessage}
                                    onChange={(e) => setEditedMessage(e.target.value)}
                                    autoFocus
                                />
                            ) : (
                                <p className="os-v3-message-content">{messageText}</p>
                            )}
                        </div>

                        {/* Intelligence Grid */}
                        <div className="os-v3-intelligence">
                            <div className="os-v3-intel-card">
                                <h4>Observation Angle</h4>
                                <p>{generatedMessage.observation}</p>
                            </div>
                            <div className="os-v3-intel-card">
                                <h4>Predicted Reply</h4>
                                <p>"{generatedMessage.likely_reply}"</p>
                                {generatedMessage.likely_response_rate && (
                                    <span className={`os-v3-rate-badge rate-${generatedMessage.likely_response_rate.toLowerCase()}`}>
                                        <TrendingUp size={12} /> {generatedMessage.likely_response_rate} Probability
                                    </span>
                                )}
                            </div>
                        </div>
                        
                        {/* Target Phone Input before sending */}
                        <div style={{ marginTop: '0.5rem' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-dim)', marginBottom: '0.5rem' }}>
                                <Phone size={14} /> Send to WhatsApp Number
                            </label>
                            <input 
                                type="text"
                                value={targetPhone}
                                onChange={(e) => setTargetPhone(e.target.value)}
                                placeholder="Include country code (e.g., 919876543210)"
                                className="os-v3-message-input"
                                style={{ minHeight: 'auto', padding: '0.85rem', fontSize: '1rem', width: '100%' }}
                            />
                        </div>

                        {/* Bottom Actions */}
                        <div className="os-v3-bottom-actions">
                            <button 
                                className="os-v3-secondary-btn" 
                                onClick={() => handleGenerate(false)}
                                disabled={generating}
                            >
                                {generating ? <Loader2 size={18} className="spin"/> : <RefreshCw size={18} />}
                                Regenerate Opening
                            </button>
                            <button 
                                className="os-v3-primary-btn" 
                                onClick={openWhatsApp}
                                disabled={!targetPhone}
                            >
                                <MessageCircle size={18} /> 
                                Open in WhatsApp
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default OutreachStudioPage;

