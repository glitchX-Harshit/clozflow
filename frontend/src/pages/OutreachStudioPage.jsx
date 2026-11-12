import { useState, useCallback, useEffect, useEffectEvent, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    ArrowLeft,
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
    RotateCcw,
} from 'lucide-react';
import './OutreachStudioPage.css';
import MagButton from '../components/MagButton';
import { ApiError, apiFetch } from '../lib/apiFetch';
import { copyText } from '../lib/clipboard';
import { isSampleLead } from '../lib/leadSearch';
import {
    EMPTY_DRAFT,
    OUTREACH_UNAVAILABLE_MESSAGE,
    currentMessage,
    draftFromGenerated,
    editDraft,
    isDraftEdited,
    isFallbackOutreach,
    resetDraft,
} from '../lib/outreachDraft';
import { DEFAULT_COUNTRY_CODE, isValidWhatsAppNumber, normalizeWhatsAppNumber, whatsAppUrl } from '../lib/phone';
import { useLeadFinderStore } from '../store/useLeadFinderStore';

const LANGUAGE_LABELS = { english: 'English', hinglish: 'Hinglish', hindi: 'Hindi', spanish: 'Spanish', french: 'French' };

const OutreachStudioPage = ({ lead: propLead, userOffer: propUserOffer, onBack: propOnBack, query: propQuery }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const storeQuery = useLeadFinderStore((s) => s.query);

    const lead = propLead || location.state?.lead;
    const userOffer = propUserOffer || location.state?.userOffer || '';
    // Inside the Dashboard the query is not passed down; the Lead Finder store still has it.
    const query = propQuery ?? location.state?.query ?? storeQuery ?? '';
    const onBackClick = propOnBack || (() => navigate(-1));
    const sample = isSampleLead(lead);

    useEffect(() => {
        if (!lead) {
            navigate('/dashboard');
        }
    }, [lead, navigate]);

    const [generatedMessage, setGeneratedMessage] = useState(null);
    const [generating, setGenerating] = useState(false);
    const [language, setLanguage] = useState('english');
    const [generatedLanguage, setGeneratedLanguage] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [draftState, setDraftState] = useState(EMPTY_DRAFT);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState(null);
    const copiedTimerRef = useRef(null);

    // Target phone number, editable so the country code can be checked.
    const [phone, setPhone] = useState(() => normalizeWhatsAppNumber(lead, query));
    const targetPhone = phone.number;

    useEffect(() => () => clearTimeout(copiedTimerRef.current), []);

    const handleGenerate = useCallback(async () => {
        if (!lead) return;
        setGenerating(true);
        setError(null);

        try {
            const data = await apiFetch('/outreach/generate', {
                method: 'POST',
                body: {
                    lead_data: lead,
                    channel: 'whatsapp',
                    user_offer: userOffer,
                    language: language,
                },
            });
            if (isFallbackOutreach(data)) {
                // The server's failure placeholder must never become the message to send.
                setError(OUTREACH_UNAVAILABLE_MESSAGE);
                return;
            }
            setGeneratedMessage(data);
            setGeneratedLanguage(language);
            setDraftState(draftFromGenerated(data.opening_message));
            setIsEditing(false);
        } catch (err) {
            console.error('Generate error:', err);
            // Keep the previous draft; only show why this attempt failed.
            setError(err instanceof ApiError && err.status !== 0
                ? err.message
                : 'Failed to generate message. Please check your connection and try again.');
        } finally {
            setGenerating(false);
        }
    }, [lead, userOffer, language]);

    // Generate once when the page opens for a lead.
    const generateOnOpen = useEffectEvent(() => {
        handleGenerate();
    });

    useEffect(() => {
        if (lead) generateOnOpen();
    }, [lead]);

    const draft = currentMessage(draftState);
    const edited = isDraftEdited(draftState);

    const handleRegenerate = () => {
        if (edited && draft && !window.confirm('Replace your edited message with a new AI draft?')) return;
        handleGenerate();
    };

    const handleCopy = async () => {
        if (!draft) return;
        const ok = await copyText(draft);
        if (!ok) {
            setError('Could not copy the message — select it and copy manually.');
            return;
        }
        setCopied(true);
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    };

    const phoneValid = isValidWhatsAppNumber(targetPhone);
    const canLaunch = !!draft && phoneValid && !generating && !sample;

    const openWhatsApp = () => {
        if (!phoneValid) {
            setError('Enter a WhatsApp number with its country code (8–15 digits).');
            return;
        }
        if (!draft) return;
        window.open(whatsAppUrl(targetPhone, draft), '_blank', 'noopener,noreferrer');
    };

    if (!lead) return null;

    const languageChanged = generatedMessage && generatedLanguage && language !== generatedLanguage;

    return (
        <div className={`os-v3-wrapper ${propLead ? 'os-v3-wrapper--nested' : ''}`}>



            <div className="os-v3-ambient-glow" />

            <div className="os-v3-workspace-header">
                <MagButton
                    className="os-v3-back"
                    onClick={onBackClick}
                    label="Back to Discovery"
                    aria-label="Back to Discovery"
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
                        <div className="os-v3-error" role="alert">
                            <AlertTriangle size={18} />
                            <span>{error}</span>
                        </div>
                    )}

                    {sample && (
                        <div className="os-v3-error os-v3-error--warn" role="status">
                            <AlertTriangle size={18} />
                            <span>This is a sample lead generated without live data. Its phone number is not real, so WhatsApp is disabled.</span>
                        </div>
                    )}

                    <div className="os-v3-section-card">
                        <div className="os-v3-section-header">
                            <span className="os-v3-badge">
                                <Sparkles size={12}/> AI Outreach Editor
                                {edited && <span className="os-v3-edited-tag">Edited</span>}
                            </span>
                            <div className="os-v3-message-actions">
                                <select
                                    value={language}
                                    onChange={(e) => setLanguage(e.target.value)}
                                    className="os-v3-language-select"
                                    aria-label="Message language"
                                    style={{
                                        background: 'var(--surface)',
                                        border: '1px solid var(--border)',
                                        color: 'var(--text-dim)',
                                        borderRadius: '8px',
                                        padding: '4px 8px',
                                        fontSize: '0.75rem',
                                        marginRight: '8px',
                                        cursor: 'pointer'
                                    }}
                                >
                                    {Object.entries(LANGUAGE_LABELS).map(([value, label]) => (
                                        <option key={value} value={value}>{label}</option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    className="os-v3-icon-btn"
                                    onClick={handleCopy}
                                    disabled={!draft}
                                    title="Copy message"
                                    aria-label={copied ? 'Message copied' : 'Copy message'}
                                >
                                    {copied ? <CheckCircle2 size={16} color="#10b981"/> : <Copy size={16} />}
                                </button>
                                <button
                                    type="button"
                                    className="os-v3-icon-btn"
                                    onClick={() => setIsEditing(!isEditing)}
                                    title={isEditing ? "Save & View" : "Edit message"}
                                    aria-label={isEditing ? 'Save and view message' : 'Edit message'}
                                    aria-pressed={isEditing}
                                >
                                    <Edit3 size={16} />
                                </button>
                            </div>
                        </div>

                        {(languageChanged || edited) && (
                            <div className="os-v3-draft-hints">
                                {languageChanged && (
                                    <span>Regenerate to apply {LANGUAGE_LABELS[language]}.</span>
                                )}
                                {edited && (
                                    <button type="button" className="os-v3-link-btn" onClick={() => setDraftState(resetDraft)}>
                                        <RotateCcw size={12} /> Reset to AI draft
                                    </button>
                                )}
                            </div>
                        )}

                        {generating && !generatedMessage ? (
                            <div className="os-v3-skeleton-message" />
                        ) : (
                            <div className="os-v3-editor-wrapper">
                                {isEditing ? (
                                    <textarea
                                        className="os-v3-message-input"
                                        aria-label="Outreach message"
                                        value={draftState.draft}
                                        onChange={(e) => setDraftState((prev) => editDraft(prev, e.target.value))}
                                        autoFocus
                                    />
                                ) : (
                                    <p className="os-v3-message-content">
                                        {draft || "No message generated yet. Click Regenerate below to create one."}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Recipient Details & WhatsApp Dispatch */}
                    <div className="os-v3-section-card">
                        <h3 className="os-v3-section-title">Outbound Channel Settings</h3>
                        <div className="os-v3-form-group">
                            <label className="os-v3-input-label" htmlFor="os-whatsapp-number">
                                <Phone size={14} /> <span>WhatsApp Phone Number (with Country Code)</span>
                            </label>
                            <input
                                id="os-whatsapp-number"
                                type="tel"
                                value={targetPhone}
                                onChange={(e) => setPhone({ number: e.target.value, guessed: false, code: null })}
                                placeholder="Include country code (e.g., +14155551234 or +919876543210)"
                                className="os-v3-text-field"
                                aria-invalid={!!targetPhone && !phoneValid}
                                aria-describedby="os-whatsapp-hint"
                            />
                            <p id="os-whatsapp-hint" className={`os-v3-field-hint ${targetPhone && !phoneValid ? 'os-v3-field-hint--error' : ''}`}>
                                {targetPhone && !phoneValid
                                    ? 'Enter the full number with country code (8–15 digits).'
                                    : phone.guessed
                                        ? `Assumed ${phone.code || DEFAULT_COUNTRY_CODE} — check the country code.`
                                        : !targetPhone ? 'No phone number is listed for this lead.' : ' '}
                            </p>
                        </div>

                        {/* Dispatch Button Grid */}
                        <div className="os-v3-bottom-actions">
                            <MagButton
                                className="os-v3-secondary-btn"
                                onClick={handleRegenerate}
                                disabled={generating}
                                label={generating ? "Generating..." : "Regenerate Hook"}
                                hoverLabel="Synthesize Hook"
                                aria-label={generating ? 'Generating message' : 'Regenerate message'}
                                icon={generating ? <Loader2 size={18} className="spin"/> : <RefreshCw size={18} />}
                                variant="outline"
                                magnetStrength={0.25}
                            />
                            <MagButton
                                className="os-v3-primary-btn"
                                onClick={openWhatsApp}
                                disabled={!canLaunch}
                                label="Launch WhatsApp Chat"
                                hoverLabel="Open In WhatsApp"
                                aria-label="Launch WhatsApp chat"
                                icon={<MessageCircle size={18} />}
                                variant="custom"
                                magnetStrength={0.25}
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


        </div>
    );
};

export default OutreachStudioPage;
