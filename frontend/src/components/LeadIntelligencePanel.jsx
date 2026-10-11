/**
 * LeadIntelligencePanel
 * ─────────────────────
 * Premium AI-native intelligence layer for ClozFlow's Lead Finder.
 *
 * Architecture:
 * - Collapsible side panel positioned on the right edge
 * - Does NOT replace or override the existing Lead Finder
 * - Shares search state via useLeadFinderStore
 * - Owns its own state via useLeadIntelligenceStore
 * - Calls /intelligence/* backend endpoints
 *
 * Panel States:
 *   empty       — First use, ICP not defined
 *   understanding — AI is processing the user's offer
 *   icp         — ICP has been derived, showing recommendation
 *   active      — User has an ICP, currently in conversation
 *   lead        — Analyzing a specific selected lead
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
    X,
    ArrowRight,
    Send,
    ChevronRight,
    RefreshCw,
    Sparkles,
    Target,
    Search,
    Zap,
    MessageSquare,
    Info,
} from 'lucide-react';
import { useLeadIntelligenceStore } from '../store/useLeadIntelligenceStore';
import { useLeadFinderStore } from '../store/useLeadFinderStore';
import './LeadIntelligencePanel.css';

const API_BASE = window.APP_API_BASE;

// ── Loading Step Messages ────────────────────────────────────────────────────
const LOADING_STEPS = [
    'Understanding your offer...',
    'Identifying likely customers...',
    'Finding signals worth looking for...',
];

// ── Offer suggestion chips for empty state ───────────────────────────────────
const OFFER_SUGGESTIONS = [
    'I sell websites to D2C brands',
    "I'm a freelance video editor",
    'We provide CRM software for B2B teams',
];

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

/** Animated loading dots */
const LoadingDots = () => (
    <div className="li-loading-dots">
        <div className="li-loading-dot" />
        <div className="li-loading-dot" />
        <div className="li-loading-dot" />
    </div>
);

/** Single contextual suggestion chip */
const SuggestionChip = ({ text, onClick }) => (
    <button className="li-suggestion-chip" onClick={() => onClick(text)}>
        <span>{text}</span>
        <ChevronRight size={12} className="li-suggestion-chip-arrow" />
    </button>
);

/** A single conversation message bubble */
const MessageBubble = ({ message }) => (
    <div className={`li-message li-message--${message.role}`}>
        <span className="li-message-role">
            {message.role === 'user' ? 'You' : '✦ Intelligence'}
        </span>
        <div className="li-message-content">{message.content}</div>
        {message.searchExecuted && (
            <div className="li-search-confirmation">
                <div className="li-search-confirmation-dot" />
                <span>Lead Finder updated</span>
            </div>
        )}
    </div>
);


// ═══════════════════════════════════════════════════════════════════════════════
// STATE A — EMPTY STATE
// ═══════════════════════════════════════════════════════════════════════════════
const EmptyState = ({ onDiscover }) => {
    const { offerInput, setOfferInput } = useLeadIntelligenceStore();

    const handleSuggestion = (text) => {
        setOfferInput(text);
    };

    return (
        <div className="li-empty">
            <div>
                <div className="li-empty-question">Don't know your ICP?</div>
                <h2 className="li-empty-headline">Tell me what you sell.</h2>
            </div>
            <p className="li-empty-support">
                I'll help you identify who is most likely to need it.
            </p>

            <div className="li-offer-area">
                <textarea
                    className="li-offer-textarea"
                    placeholder="I sell AI automation to small businesses..."
                    value={offerInput}
                    onChange={(e) => setOfferInput(e.target.value)}
                    rows={3}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && offerInput.trim().length > 3) {
                            e.preventDefault();
                            onDiscover();
                        }
                    }}
                />
                <button
                    className="li-discover-btn"
                    onClick={onDiscover}
                    disabled={!offerInput || offerInput.trim().length < 3}
                >
                    Discover my ICP
                    <ArrowRight size={14} />
                </button>
            </div>

            <div className="li-suggestions-section">
                <div className="li-suggestions-label">Try an example</div>
                {OFFER_SUGGESTIONS.map((s) => (
                    <SuggestionChip key={s} text={s} onClick={handleSuggestion} />
                ))}
            </div>
        </div>
    );
};


// ═══════════════════════════════════════════════════════════════════════════════
// STATE B — UNDERSTANDING / LOADING
// ═══════════════════════════════════════════════════════════════════════════════
const UnderstandingState = ({ step }) => (
    <div className="li-loading">
        <div className="li-loading-step">
            <LoadingDots />
            <span>{step || LOADING_STEPS[0]}</span>
        </div>
        <div className="li-loading-bar-wrap">
            <div className="li-loading-bar" />
        </div>
    </div>
);


// ═══════════════════════════════════════════════════════════════════════════════
// STATE C — ICP RECOMMENDATION
// ═══════════════════════════════════════════════════════════════════════════════
const ICPState = ({ icp, onConfirm, onAdjust, onReset }) => (
    <div className="li-icp-card">
        <div>
            <div className="li-icp-product-label">YOUR PRODUCT</div>
            <div className="li-icp-product-name">"{icp.derivedFrom}"</div>
        </div>

        <div className="li-divider" />

        <div>
            <div className="li-icp-section-label">WE THINK YOUR BEST CUSTOMERS ARE:</div>
            <div className="li-icp-primary">{icp.primaryCustomer}</div>
        </div>

        {icp.segments?.length > 0 && (
            <div>
                <div className="li-icp-section-label">Potential segments</div>
                <div className="li-icp-chips">
                    {icp.segments.map((seg) => (
                        <span key={seg} className="li-icp-chip">{seg}</span>
                    ))}
                </div>
            </div>
        )}

        {icp.likelyBuyers?.length > 0 && (
            <div>
                <div className="li-icp-section-label">Likely buyers</div>
                <div className="li-icp-chips">
                    {icp.likelyBuyers.map((buyer) => (
                        <span key={buyer} className="li-icp-chip">{buyer}</span>
                    ))}
                </div>
            </div>
        )}

        {icp.usefulSignals?.length > 0 && (
            <div>
                <div className="li-icp-section-label">Useful signals</div>
                <div className="li-icp-signals">
                    {icp.usefulSignals.map((signal) => (
                        <div key={signal} className="li-icp-signal-item">
                            <div className="li-icp-signal-dot" />
                            <span>{signal}</span>
                        </div>
                    ))}
                </div>
            </div>
        )}

        <div className="li-divider" />

        <div>
            <div className="li-confirm-question">Does this look right?</div>
            <div className="li-confirm-row">
                <button className="li-btn li-btn--primary" onClick={onConfirm}>
                    Looks good
                </button>
                <button className="li-btn li-btn--secondary" onClick={onAdjust}>
                    Adjust
                </button>
            </div>
        </div>

        <div className="li-icp-reset-row">
            <button className="li-icp-reset-btn" onClick={onReset}>
                Start over
            </button>
        </div>
    </div>
);


// ═══════════════════════════════════════════════════════════════════════════════
// ACTIVE STATE — Conversation + Context
// ═══════════════════════════════════════════════════════════════════════════════
const ActiveSearchContext = ({ currentQuery, suggestions, onSuggestion, isLoading }) => (
    <div className="li-context-card">
        {currentQuery && (
            <div>
                <div className="li-context-label">Currently searching</div>
                <div className="li-context-query">"{currentQuery}"</div>
            </div>
        )}

        {suggestions?.length > 0 && (
            <div>
                <div className="li-suggestions-label">Suggested actions</div>
                <div className="li-context-suggestions">
                    {suggestions.map((s) => (
                        <SuggestionChip key={s} text={s} onClick={onSuggestion} />
                    ))}
                </div>
            </div>
        )}

        {isLoading && (
            <div className="li-loading-step">
                <LoadingDots />
                <span>Working on it...</span>
            </div>
        )}
    </div>
);


// ═══════════════════════════════════════════════════════════════════════════════
// STATE G — LEAD ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════
const LeadAnalysisState = ({ lead, whyData, isLoading, onGoOutreach, onGoCall }) => {
    if (isLoading) {
        return (
            <div className="li-loading">
                <div className="li-loading-step">
                    <LoadingDots />
                    <span>Analyzing {lead?.business_name}...</span>
                </div>
                <div className="li-loading-bar-wrap">
                    <div className="li-loading-bar" />
                </div>
            </div>
        );
    }

    if (!whyData) return null;

    return (
        <div className="li-lead-analysis">
            <div>
                <div className="li-icp-section-label">WHY THIS LEAD?</div>
                <div className="li-lead-name">{lead?.business_name}</div>
            </div>

            <div className="li-why-headline">{whyData.headline}</div>

            {whyData.signals?.length > 0 && (
                <div className="li-why-signals">
                    {whyData.signals.map((signal, i) => (
                        <div key={i} className="li-why-signal">
                            <span className="li-why-signal-plus">+</span>
                            <span>{signal}</span>
                        </div>
                    ))}
                </div>
            )}

            {whyData.approach && (
                <div className="li-approach-box">
                    <div className="li-approach-label">Recommended approach</div>
                    <span>{whyData.approach}</span>
                </div>
            )}

            {whyData.data_note && (
                <div className="li-data-note">⚠ {whyData.data_note}</div>
            )}

            <div className="li-divider" />

            <div className="li-lead-actions">
                <button className="li-lead-action-btn" onClick={onGoCall}>
                    <Sparkles size={13} />
                    <span>Live Copilot call</span>
                    <ChevronRight size={13} style={{ marginLeft: 'auto' }} />
                </button>
                <button className="li-lead-action-btn" onClick={onGoOutreach}>
                    <MessageSquare size={13} />
                    <span>Generate outreach</span>
                    <ChevronRight size={13} style={{ marginLeft: 'auto' }} />
                </button>
            </div>
        </div>
    );
};


// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PANEL COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
const LeadIntelligencePanel = ({ selectedLead, onStartCall, onOutreach }) => {
    const {
        isPanelOpen,
        togglePanel,
        closePanel,
        panelState,
        setPanelState,
        offerInput,
        setOfferInput,
        icp,
        setIcp,
        clearIcp,
        messages,
        addMessage,
        clearMessages,
        suggestions,
        setSuggestions,
        isLoading,
        setIsLoading,
        loadingStep,
        setLoadingStep,
        resultsSummary,
        setResultsSummary,
    } = useLeadIntelligenceStore();

    const {
        query,
        setQuery,
        setSearchMode,
        setActiveFilters,
        leads,
    } = useLeadFinderStore();

    const [chatInput, setChatInput] = useState('');
    const [whyData, setWhyData] = useState(null);
    const [whyLoading, setWhyLoading] = useState(false);
    const [stepIndex, setStepIndex] = useState(0);
    const bodyRef = useRef(null);
    const chatInputRef = useRef(null);
    const stepTimerRef = useRef(null);

    // ── Auto-scroll messages ──────────────────────────────────────────────────
    useEffect(() => {
        if (bodyRef.current) {
            bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
        }
    }, [messages, panelState]);

    // ── Auto-fetch suggestions when search changes ────────────────────────────
    useEffect(() => {
        if (query && query.length > 2 && isPanelOpen) {
            fetchSuggestions();
        }
    }, [query, isPanelOpen]);

    // ── Auto-analyze selected lead when panel opens in lead state ─────────────
    useEffect(() => {
        if (selectedLead && isPanelOpen && panelState === 'lead') {
            fetchWhyLead(selectedLead);
        }
    }, [selectedLead, isPanelOpen]);

    // ── When panel opens while a lead is selected, switch to lead state ────────
    useEffect(() => {
        if (selectedLead && isPanelOpen && icp && panelState === 'active') {
            // Don't auto-switch — user controls this via context
        }
    }, [selectedLead]);

    // ── Update results summary when leads change ──────────────────────────────
    useEffect(() => {
        if (leads && leads.length > 0 && icp) {
            const highFit = leads.filter(l => (l.opportunity_score ?? 0) >= 70).length;
            const hasSignals = leads.filter(l => (l.opportunity_signals?.length ?? 0) >= 2).length;
            setResultsSummary({ total: leads.length, highRelevance: highFit, strongSignals: hasSignals });
        }
    }, [leads, icp]);

    // ── Loading step animation ─────────────────────────────────────────────────
    const animateLoadingSteps = useCallback(() => {
        setStepIndex(0);
        setLoadingStep(LOADING_STEPS[0]);
        let idx = 0;
        stepTimerRef.current = setInterval(() => {
            idx = (idx + 1) % LOADING_STEPS.length;
            setStepIndex(idx);
            setLoadingStep(LOADING_STEPS[idx]);
        }, 1400);
    }, [setLoadingStep]);

    const stopLoadingSteps = useCallback(() => {
        if (stepTimerRef.current) {
            clearInterval(stepTimerRef.current);
            stepTimerRef.current = null;
        }
    }, []);

    // ── ICP Discovery ─────────────────────────────────────────────────────────
    const handleDiscover = useCallback(async () => {
        const offer = offerInput.trim();
        if (!offer || offer.length < 3) return;

        setPanelState('understanding');
        setIsLoading(true);
        animateLoadingSteps();

        try {
            const resp = await fetch(`${API_BASE}/intelligence/derive-icp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ offer }),
            });

            if (!resp.ok) throw new Error('ICP derivation failed');
            const data = await resp.json();

            if (data.success && data.icp) {
                stopLoadingSteps();
                setIcp(data.icp);
                // Auto-fetch suggestions based on ICP's suggested search
                if (data.icp.searchSuggestion) {
                    fetchSuggestions(data.icp.searchSuggestion);
                }
            } else {
                throw new Error('No ICP returned');
            }
        } catch (err) {
            console.error('[Intelligence] ICP error:', err);
            stopLoadingSteps();
            setPanelState('empty');
        } finally {
            setIsLoading(false);
        }
    }, [offerInput, setPanelState, setIsLoading, setIcp, animateLoadingSteps, stopLoadingSteps]);

    // ── ICP Confirmed — enter active state ────────────────────────────────────
    const handleICPConfirm = useCallback(() => {
        clearMessages();
        setPanelState('active');
        // If ICP has a search suggestion, show it
        if (icp?.searchSuggestion) {
            setSuggestions([
                `Search for ${icp.searchSuggestion}`,
                ...suggestions.slice(0, 3),
            ]);
        }
    }, [clearMessages, setPanelState, icp, suggestions, setSuggestions]);

    // ── ICP Adjust — go back to input with current offer ──────────────────────
    const handleICPAdjust = useCallback(() => {
        clearIcp();
        setPanelState('empty');
    }, [clearIcp, setPanelState]);

    // ── Fetch contextual suggestions ─────────────────────────────────────────
    const fetchSuggestions = useCallback(async (overrideQuery) => {
        try {
            const resp = await fetch(`${API_BASE}/intelligence/suggestions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    current_query: overrideQuery || query,
                    user_offer: offerInput,
                    leads_count: leads?.length ?? 0,
                    icp: icp || null,
                }),
            });
            if (resp.ok) {
                const data = await resp.json();
                if (data.suggestions) setSuggestions(data.suggestions);
            }
        } catch (err) {
            console.warn('[Intelligence] Suggestions fetch failed:', err);
        }
    }, [query, offerInput, leads, icp, setSuggestions]);

    // ── Chat / Conversational Search ─────────────────────────────────────────
    const handleChat = useCallback(async (messageText) => {
        const msg = (messageText || chatInput).trim();
        if (!msg) return;

        setChatInput('');

        // Add user message
        addMessage({ role: 'user', content: msg });

        // Build conversation history for context
        const history = messages.slice(-6).map(m => ({
            role: m.role,
            content: m.content,
        }));

        setIsLoading(true);
        try {
            const resp = await fetch(`${API_BASE}/intelligence/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: msg,
                    user_offer: offerInput,
                    current_query: query,
                    icp: icp || null,
                    conversation_history: history,
                }),
            });

            if (!resp.ok) throw new Error('Chat request failed');
            const data = await resp.json();

            let searchExecuted = false;

            // Apply search command if returned
            if (data.search_command) {
                const sc = data.search_command;
                if (sc.query) {
                    setQuery(sc.query);
                }
                if (sc.mode) {
                    setSearchMode(sc.mode);
                }
                if (sc.filters && Object.keys(sc.filters).length > 0) {
                    setActiveFilters(sc.filters);
                }
                searchExecuted = !!(sc.query || sc.mode || sc.filters);
            }

            // Add AI reply
            if (data.reply) {
                addMessage({
                    role: 'ai',
                    content: data.reply,
                    searchExecuted,
                });
            }

            // Update suggestions
            if (data.suggestions?.length) {
                setSuggestions(data.suggestions);
            }

            // Trigger search if a query was returned
            if (data.search_command?.query) {
                // Dispatch a custom event so LeadFinder can pick it up
                window.dispatchEvent(new CustomEvent('li:execute-search', {
                    detail: { query: data.search_command.query }
                }));
            }

        } catch (err) {
            console.error('[Intelligence] Chat error:', err);
            addMessage({
                role: 'ai',
                content: "I encountered an issue. Try rephrasing or use the search bar directly.",
            });
        } finally {
            setIsLoading(false);
        }
    }, [chatInput, messages, offerInput, query, icp, addMessage, setIsLoading,
        setQuery, setSearchMode, setActiveFilters, setSuggestions]);

    // ── Fetch Why This Lead ───────────────────────────────────────────────────
    const fetchWhyLead = useCallback(async (lead) => {
        if (!lead) return;
        setWhyLoading(true);
        setWhyData(null);

        try {
            const resp = await fetch(`${API_BASE}/intelligence/why-this-lead`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lead,
                    user_offer: offerInput,
                }),
            });
            if (resp.ok) {
                const data = await resp.json();
                if (data.success) {
                    setWhyData(data);
                }
            }
        } catch (err) {
            console.warn('[Intelligence] Why-lead fetch failed:', err);
        } finally {
            setWhyLoading(false);
        }
    }, [offerInput]);

    // ── Analyze selected lead ─────────────────────────────────────────────────
    const handleAnalyzeLead = useCallback(() => {
        if (selectedLead) {
            setPanelState('lead');
            fetchWhyLead(selectedLead);
        }
    }, [selectedLead, setPanelState, fetchWhyLead]);

    const handleBackFromLead = useCallback(() => {
        setWhyData(null);
        setPanelState(icp ? 'active' : 'empty');
    }, [icp, setPanelState]);

    // ── Handle suggestion click ───────────────────────────────────────────────
    const handleSuggestion = useCallback((text) => {
        if (panelState === 'active' || panelState === 'lead') {
            handleChat(text);
        } else {
            setOfferInput(text);
        }
    }, [panelState, handleChat, setOfferInput]);

    // ── Chat textarea key handler ─────────────────────────────────────────────
    const handleChatKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (chatInput.trim()) handleChat();
        }
    };

    // ═════════════════════════════════════════════════════════════════════════
    // RENDER
    // ═════════════════════════════════════════════════════════════════════════

    return (
        <>
            {/* ── Toggle Button (right edge) ── */}
            <button
                className={`li-toggle-btn ${isPanelOpen ? 'panel-open' : ''}`}
                onClick={togglePanel}
                title="Lead Intelligence"
            >
                <div className="li-toggle-icon">
                    <Sparkles size={14} />
                </div>
                <span className="li-toggle-label">Intelligence</span>
                {icp && <div className="li-toggle-dot" />}
            </button>

            {/* ── Panel ── */}
            <div className={`li-panel ${isPanelOpen ? 'is-open' : ''}`}>

                {/* Header */}
                <div className="li-header">
                    <div className="li-header-left">
                        <div className="li-header-title">
                            <span className="li-header-glyph">✦</span>
                            Lead Intelligence
                        </div>
                        <div className="li-header-sub">Your AI sales research copilot</div>
                    </div>
                    <button className="li-header-close" onClick={closePanel} title="Close panel">
                        <X size={14} />
                    </button>
                </div>

                {/* Body */}
                <div className="li-body" ref={bodyRef}>

                    {/* ── State A: Empty ── */}
                    {panelState === 'empty' && (
                        <EmptyState onDiscover={handleDiscover} />
                    )}

                    {/* ── State B: Understanding ── */}
                    {panelState === 'understanding' && (
                        <UnderstandingState step={loadingStep} />
                    )}

                    {/* ── State C: ICP Recommendation ── */}
                    {panelState === 'icp' && icp && (
                        <ICPState
                            icp={icp}
                            onConfirm={handleICPConfirm}
                            onAdjust={handleICPAdjust}
                            onReset={clearIcp}
                        />
                    )}

                    {/* ── State: Active / Conversation ── */}
                    {(panelState === 'active') && (
                        <>
                            {/* ICP context bar */}
                            {icp && (
                                <div className="li-icp-reset-row">
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                        <div className="li-icp-product-label">YOUR ICP</div>
                                        <div className="li-icp-product-name" style={{ fontSize: '0.8rem' }}>
                                            {icp.primaryCustomer?.slice(0, 55)}
                                            {icp.primaryCustomer?.length > 55 ? '...' : ''}
                                        </div>
                                    </div>
                                    <button className="li-icp-reset-btn" onClick={() => setPanelState('icp')} title="View ICP">
                                        View
                                    </button>
                                </div>
                            )}

                            <div className="li-divider" />

                            {/* Current search context */}
                            <ActiveSearchContext
                                currentQuery={query}
                                suggestions={suggestions}
                                onSuggestion={handleSuggestion}
                                isLoading={isLoading}
                            />

                            {/* Results summary */}
                            {resultsSummary && resultsSummary.total > 0 && (
                                <>
                                    <div className="li-divider" />
                                    <div className="li-results-summary">
                                        <div className="li-results-stat">
                                            <div className="li-results-stat-value">{resultsSummary.total}</div>
                                            <div className="li-results-stat-label">potential opportunities found</div>
                                        </div>
                                        <div className="li-results-meta-row">
                                            <div className="li-results-meta-item">
                                                <div className="li-results-meta-value">{resultsSummary.highRelevance}</div>
                                                <div className="li-results-meta-label">highly relevant</div>
                                            </div>
                                            <div className="li-results-meta-item">
                                                <div className="li-results-meta-value">{resultsSummary.strongSignals}</div>
                                                <div className="li-results-meta-label">strong signals</div>
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* Selected lead shortcut */}
                            {selectedLead && (
                                <>
                                    <div className="li-divider" />
                                    <div>
                                        <div className="li-icp-section-label">SELECTED LEAD</div>
                                        <button
                                            className="li-lead-action-btn"
                                            onClick={handleAnalyzeLead}
                                            style={{ marginTop: '0.4rem' }}
                                        >
                                            <Target size={13} />
                                            <span>Why {selectedLead.business_name}?</span>
                                            <ChevronRight size={13} style={{ marginLeft: 'auto' }} />
                                        </button>
                                    </div>
                                </>
                            )}

                            {/* Message thread */}
                            {messages.length > 0 && (
                                <>
                                    <div className="li-divider" />
                                    <div className="li-messages">
                                        {messages.map((msg) => (
                                            <MessageBubble key={msg.id} message={msg} />
                                        ))}
                                        {isLoading && (
                                            <div className="li-loading-step" style={{ paddingLeft: '0.1rem' }}>
                                                <LoadingDots />
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Thinking...</span>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </>
                    )}

                    {/* ── State G: Lead Analysis ── */}
                    {panelState === 'lead' && (
                        <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '-0.25rem' }}>
                                <button className="li-btn li-btn--ghost" onClick={handleBackFromLead} style={{ padding: '0.25rem 0', fontSize: '0.7rem' }}>
                                    ← Back
                                </button>
                            </div>
                            <LeadAnalysisState
                                lead={selectedLead}
                                whyData={whyData}
                                isLoading={whyLoading}
                                onGoOutreach={() => selectedLead && onOutreach?.(selectedLead, offerInput)}
                                onGoCall={() => selectedLead && onStartCall?.(selectedLead)}
                            />
                            {/* Suggestions below lead analysis */}
                            {!whyLoading && whyData && suggestions.length > 0 && (
                                <>
                                    <div className="li-divider" />
                                    <div className="li-context-suggestions">
                                        <div className="li-suggestions-label">What's next</div>
                                        {suggestions.slice(0, 3).map((s) => (
                                            <SuggestionChip key={s} text={s} onClick={handleSuggestion} />
                                        ))}
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </div>

                {/* ── Chat Input (shown in active/lead states) ── */}
                {(panelState === 'active' || panelState === 'lead') && (
                    <div className="li-chat-input-area">
                        <div className="li-chat-input-wrap">
                            <textarea
                                ref={chatInputRef}
                                className="li-chat-input"
                                placeholder={
                                    panelState === 'lead'
                                        ? 'Ask about this lead...'
                                        : 'Refine search, change city, add filters...'
                                }
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyDown={handleChatKeyDown}
                                rows={1}
                            />
                            <button
                                className="li-chat-send-btn"
                                onClick={() => handleChat()}
                                disabled={!chatInput.trim() || isLoading}
                                title="Send"
                            >
                                <Send size={12} />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
};

export default LeadIntelligencePanel;
