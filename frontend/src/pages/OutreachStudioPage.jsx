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
    Phone,
    Rocket,
    Puzzle
} from 'lucide-react';
import './OutreachStudioPage.css';
import CopilotLauncher from '../components/CopilotLauncher';
import MagButton from '../components/MagButton';
import useCopilotStore from '../store/copilotStore';

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
    if (/\b(nepal|kathmandu|pokhara|lalitpur|bhaktapur)\b/.test(t)) return '+977';
    
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
    const [language, setLanguage] = useState('english');
    const [isEditing, setIsEditing] = useState(false);
    const [editedMessage, setEditedMessage] = useState('');
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState(null);
    const [isCopilotLauncherOpen, setIsCopilotLauncherOpen] = useState(false);
    
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
                    language: language,
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
    }, [lead, userOffer, targetPhone, language]);

    // Automatically trigger generation on mount if not already done
    useEffect(() => {
        if (lead && !generatedMessage && !generating && !error) {
            handleGenerate(false);
        }
    }, [lead, generatedMessage, generating, error, handleGenerate]);

    const handleCopy = useCallback((text) => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            }).catch(console.error);
        }
    }, []);

    const openWhatsApp = async () => {
        if (!targetPhone) {
            setError("Please provide a valid WhatsApp number with country code.");
            return;
        }
        const text = isEditing ? editedMessage : generatedMessage?.opening_message;
        const encodedMessage = encodeURIComponent(text || '');
        const waUrl = `https://api.whatsapp.com/send?phone=${targetPhone.replace(/\D/g, '')}&text=${encodedMessage}`;
        window.open(waUrl, '_blank');

        // Automatically launch copilot session
        try {
            const token = localStorage.getItem('token');
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            let currentLeadId = lead.id;
            
            // Save lead if new
            if (!currentLeadId) {
                const saveRes = await fetch(`${API_BASE}/leads/save`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(lead)
                });
                if (saveRes.ok) {
                    const savedData = await saveRes.json();
                    currentLeadId = savedData.id;
                }
            }

            const res = await fetch(`${API_BASE}/api/copilot/session/start`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    lead_id: currentLeadId,
                    platform: 'whatsapp',
                    platform_identifier: targetPhone
                })
            });
            
            if (res.ok) {
                await useCopilotStore.getState().fetchActiveSessions();
            }
        } catch (err) {
            console.error('Failed to auto-launch copilot for WhatsApp:', err);
        }
    };

    if (!lead) return null;

    const messageText = isEditing ? editedMessage : (generatedMessage?.opening_message || '');

    return (
        <div className={`os-v3-wrapper ${propLead ? 'os-v3-wrapper--nested' : ''}`}>
            
            {/* Simulated Chrome Extension Icon */}
            {!isCopilotLauncherOpen && (
                <div 
                    onClick={() => setIsCopilotLauncherOpen(true)}
                    className="animate-fade-in-up"
                    style={{
                        position: 'fixed',
                        top: '1.5rem',
                        right: '1.5rem',
                        width: '42px',
                        height: '42px',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        zIndex: 99999,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.background = 'var(--bg)';
                        e.currentTarget.style.borderColor = 'var(--text-muted)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.background = 'var(--surface)';
                        e.currentTarget.style.borderColor = 'var(--border)';
                    }}
                    title="ClozFlow Copilot Extension (Simulated)"
                >
                    <Puzzle size={20} color="var(--text)" />
                    {/* Tiny notification dot */}
                    <div style={{ position: 'absolute', top: '8px', right: '8px', width: '6px', height: '6px', background: 'var(--text)', borderRadius: '50%' }} />
                </div>
            )}

            <div className="os-v3-ambient-glow" />
            
            <div className="os-v3-workspace-header">
                <MagButton 
                    className="os-v3-back" 
                    onClick={onBackClick}
                    label="Back to Discovery"
                    icon={<ArrowLeft size={16} strokeWidth={2.5} />}
                    variant="outline"
                    magnetStrength={0.2}
                    splitText={false}
                />
            </div>

            <div className="os-v3-workspace animate-fade-in-up">
                
                {/* Left Side: Message Composer & Recipient Input */}
                <div className="os-v3-main-pane">
                    
                    {error && (
                        <div className="os-v3-error">
                            <AlertTriangle size={18} />
                            <span>{error}</span>
                        </div>
                    )}

                    <div className="os-v3-section-card">
                        <div className="os-v3-section-header">
                            <span className="os-v3-badge"><Sparkles size={12}/> AI Outreach Editor</span>
                            <div className="os-v3-message-actions">
                                <select 
                                    value={language}
                                    onChange={(e) => setLanguage(e.target.value)}
                                    className="os-v3-language-select"
                                    style={{
                                        background: 'var(--surface)',
                                        border: '1px solid var(--border)',
                                        color: 'var(--text-dim)',
                                        borderRadius: '8px',
                                        padding: '4px 8px',
                                        fontSize: '0.75rem',
                                        marginRight: '8px',
                                        outline: 'none',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <option value="english">English</option>
                                    <option value="hinglish">Hinglish</option>
                                    <option value="hindi">Hindi</option>
                                    <option value="spanish">Spanish</option>
                                    <option value="french">French</option>
                                </select>
                                <button className="os-v3-icon-btn" onClick={() => handleCopy(messageText)} title="Copy message">
                                    {copied ? <CheckCircle2 size={16} color="#10b981"/> : <Copy size={16} />}
                                </button>
                                <button className="os-v3-icon-btn" onClick={() => setIsEditing(!isEditing)} title={isEditing ? "Save & View" : "Edit message"}>
                                    <Edit3 size={16} />
                                </button>
                            </div>
                        </div>

                        {generating && !generatedMessage ? (
                            <div className="os-v3-skeleton-message" />
                        ) : (
                            <div className="os-v3-editor-wrapper">
                                {isEditing ? (
                                    <textarea
                                        className="os-v3-message-input"
                                        value={editedMessage}
                                        onChange={(e) => setEditedMessage(e.target.value)}
                                        autoFocus
                                    />
                                ) : (
                                    <p className="os-v3-message-content">
                                        {messageText || "No message generated yet. Click Regenerate below to create one."}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Recipient Details & WhatsApp Dispatch */}
                    <div className="os-v3-section-card">
                        <h3 className="os-v3-section-title">Outbound Channel Settings</h3>
                        <div className="os-v3-form-group">
                            <label className="os-v3-input-label">
                                <Phone size={14} /> <span>WhatsApp Phone Number (with Country Code)</span>
                            </label>
                            <input 
                                type="text"
                                value={targetPhone}
                                onChange={(e) => setTargetPhone(e.target.value)}
                                placeholder="Include country code (e.g., +14155551234 or +919876543210)"
                                className="os-v3-text-field"
                            />
                        </div>

                        {/* Dispatch Button Grid */}
                        <div className="os-v3-bottom-actions">
                            <MagButton 
                                className="os-v3-secondary-btn" 
                                onClick={() => handleGenerate(false)}
                                disabled={generating}
                                label={generating ? "Generating..." : "Regenerate Hook"}
                                hoverLabel="Synthesize Hook"
                                icon={generating ? <Loader2 size={18} className="spin"/> : <RefreshCw size={18} />}
                                variant="outline"
                                magnetStrength={0.25}
                            />
                            <MagButton 
                                className="os-v3-primary-btn" 
                                onClick={openWhatsApp}
                                disabled={!targetPhone || generating}
                                label="Launch WhatsApp Chat"
                                hoverLabel="Open In WhatsApp"
                                icon={<MessageCircle size={18} />}
                                variant="custom"
                                magnetStrength={0.25}
                            />
                            <MagButton 
                                className="os-v3-primary-btn os-v3-primary-btn--copilot" 
                                onClick={() => setIsCopilotLauncherOpen(true)}
                                disabled={generating || !generatedMessage}
                                label="Launch Browser Copilot"
                                hoverLabel="Start AI Companion"
                                icon={<Rocket size={18} />}
                                variant="custom"
                                magnetStrength={0.25}
                                style={{gridColumn: '1 / -1', width: '100%'}}
                            />
                        </div>
                    </div>

                </div>

                {/* Right Side: Lead Metadata & AI Strategy Cards */}
                <div className="os-v3-side-pane">
                    
                    {/* Lead Metadata Card */}
                    <div className="os-v3-sidebar-card">
                        <div className="os-v3-lead-meta-header">
                            <span className="os-v3-sidebar-tag">TARGET PROFILE</span>
                        </div>
                        <h2 className="os-v3-lead-title">{lead.business_name}</h2>
                        
                        <div className="os-v3-lead-details">
                            {lead.category && (
                                <div className="os-v3-detail-item">
                                    <span className="lbl">Category</span>
                                    <span className="val">{lead.category}</span>
                                </div>
                            )}
                            {lead.city && (
                                <div className="os-v3-detail-item">
                                    <span className="lbl">Location</span>
                                    <span className="val">{lead.city}</span>
                                </div>
                            )}
                            {lead.address && (
                                <div className="os-v3-detail-item">
                                    <span className="lbl">Address</span>
                                    <span className="val">{lead.address}</span>
                                </div>
                            )}
                            {lead.phone_number && (
                                <div className="os-v3-detail-item">
                                    <span className="lbl">Listed Phone</span>
                                    <span className="val">{lead.phone_number}</span>
                                </div>
                            )}
                            {lead.website && (
                                <div className="os-v3-detail-item">
                                    <span className="lbl">Website</span>
                                    <a href={lead.website} target="_blank" rel="noopener noreferrer" className="val link">
                                        {lead.website}
                                    </a>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* AI Persuasion Blueprint */}
                    <div className="os-v3-sidebar-card">
                        <div className="os-v3-lead-meta-header">
                            <span className="os-v3-sidebar-tag">PERSUASION BLUEPRINT</span>
                        </div>

                        {generating && !generatedMessage ? (
                            <div className="os-v3-skeleton-sidebar" />
                        ) : generatedMessage ? (
                            <div className="os-v3-intel-block">
                                <div className="os-v3-intel-section">
                                    <span className="os-v3-intel-lbl">Psychological Hook Angle</span>
                                    <p className="os-v3-intel-text">{generatedMessage.observation}</p>
                                </div>
                                
                                <div className="os-v3-intel-section">
                                    <span className="os-v3-intel-lbl">Predicted Prospect Reply</span>
                                    <p className="os-v3-intel-text">"{generatedMessage.likely_reply}"</p>
                                </div>

                                {generatedMessage.likely_response_rate && (
                                    <div className={`os-v3-rate-badge rate-${generatedMessage.likely_response_rate.toLowerCase()}`}>
                                        <TrendingUp size={12} /> 
                                        <span>{generatedMessage.likely_response_rate} Conversion Probability</span>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <p className="os-v3-sidebar-placeholder">AI strategy blueprint will appear here once synthesized.</p>
                        )}
                    </div>

                </div>

            </div>
            
            <CopilotLauncher 
                isOpen={isCopilotLauncherOpen} 
                onClose={() => setIsCopilotLauncherOpen(false)} 
                lead={lead} 
                platform="WhatsApp" 
            />
        </div>
    );
};

export default OutreachStudioPage;

