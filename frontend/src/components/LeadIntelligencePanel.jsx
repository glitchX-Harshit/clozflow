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
 * - Calls /intelligence/* backend endpoints (with the user's bearer token)
 *
 * Panel States:
 *   empty       — First use, ICP not defined
 *   understanding — AI is processing the user's offer
 *   icp         — ICP has been derived, showing recommendation
 *   active      — User has an ICP, currently in conversation
 *   lead        — Analyzing a specific selected lead
 */

import { useState, useRef, useEffect, useCallback, useEffectEvent } from 'react';
import {
    X,
    ArrowRight,
    Send,
    ChevronRight,
    RefreshCw,
    Sparkles,
    Target,
    MessageSquare,
} from 'lucide-react';
import { useLeadIntelligenceStore } from '../store/useLeadIntelligenceStore';
import { useLeadFinderStore } from '../store/useLeadFinderStore';
import { ApiError, apiFetch, errorMessage, isAbortError } from '../lib/apiFetch';
import { CHAT_ERROR_TEXT, toChatHistory } from '../lib/intelligenceChat';
import { SEARCH_MODE_VALUES, foldIntoQuery, sanitizeFilters } from '../lib/leadSearch';
import './LeadIntelligencePanel.css';

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

const SUGGESTIONS_DEBOUNCE_MS = 600;
const leadKeyOf = (lead) => (lead ? `${lead.business_name ?? ''}|${lead.city ?? ''}|${lead.address ?? ''}|${lead.phone_number ?? ''}` : '');

// ═══════════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

/** Animated loading dots */
const LoadingDots = () => (
    <div className="li-loading-dots" aria-hidden="true">
        <div className="li-loading-dot" />
        <div className="li-loading-dot" />
        <div className="li-loading-dot" />
    </div>
);

/** Single contextual suggestion chip */
const SuggestionChip = ({ text, onClick }) => (
    <button type="button" className="li-suggestion-chip" onClick={() => onClick(text)}>
        <span>{text}</span>
        <ChevronRight size={12} className="li-suggestion-chip-arrow" aria-hidden="true" />
    </button>
);

/** A single conversation message bubble */
const MessageBubble = ({ message }) => {
    const isUser = message.role === 'user';
    return (
        <div className={`li-message li-message--${isUser ? 'user' : 'ai'}`}>
            <span className="li-message-role">
                {isUser ? 'You' : '✦ Intelligence'}
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
};

/** Inline failure with an optional Retry action */
const PanelError = ({ message, onRetry }) => (
    <div className="li-panel-error" role="alert">
        <span>{message}</span>
        {onRetry && (
            <button type="button" className="li-btn li-btn--secondary li-panel-error-retry" onClick={onRetry}>
                <RefreshCw size={12} aria-hidden="true" /> Retry
            </button>
        )}
    </div>
);


// ═══════════════════════════════════════════════════════════════════════════════
// STATE A — EMPTY STATE
// ═══════════════════════════════════════════════════════════════════════════════
const EmptyState = ({ onDiscover, error }) => {
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

            {error && <PanelError message={error} onRetry={offerInput.trim().length >= 3 ? onDiscover : null} />}

            <div className="li-offer-area">
                <textarea
                    className="li-offer-textarea"
                    aria-label="Describe what you sell"
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
                    type="button"
                    className="li-discover-btn"
                    onClick={onDiscover}
                    disabled={!offerInput || offerInput.trim().length < 3}
                >
                    Discover my ICP
                    <ArrowRight size={14} aria-hidden="true" />
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
    <div className="li-loading" role="status">
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
                <button type="button" className="li-btn li-btn--primary" onClick={onConfirm}>
                    Looks good
                </button>
                <button type="button" className="li-btn li-btn--secondary" onClick={onAdjust}>
                    Adjust
                </button>
            </div>
        </div>

        <div className="li-icp-reset-row">
            <button type="button" className="li-icp-reset-btn" onClick={onReset}>
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
            <div className="li-loading-step" role="status">
                <LoadingDots />
                <span>Working on it...</span>
            </div>
        )}
    </div>
);


// ═══════════════════════════════════════════════════════════════════════════════
// STATE G — LEAD ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════
const LeadAnalysisState = ({ lead, whyData, isLoading, error, onRetry, onGoOutreach, onGoCall }) => {
    if (isLoading) {
        return (
            <div className="li-loading" role="status">
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

    if (error) return <PanelError message={error} onRetry={onRetry} />;
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
                <button type="button" className="li-lead-action-btn" onClick={onGoCall}>
                    <Sparkles size={13} aria-hidden="true" />
                    <span>Live Copilot call</span>
                    <ChevronRight size={13} style={{ marginLeft: 'auto' }} aria-hidden="true" />
                </button>
                <button type="button" className="li-lead-action-btn" onClick={onGoOutreach}>
                    <MessageSquare size={13} aria-hidden="true" />
                    <span>Generate outreach</span>
                    <ChevronRight size={13} style={{ marginLeft: 'auto' }} aria-hidden="true" />
                </button>
            </div>
        </div>
    );
};


// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PANEL COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
const MIN_PANEL_WIDTH = 320;
const DEFAULT_PANEL_WIDTH = 380;
const getMaxPanelWidth = () => Math.min(960, Math.max(MIN_PANEL_WIDTH, window.innerWidth - 80));

const LeadIntelligencePanel = ({ selectedLead, onStartCall, onOutreach }) => {
    const {
        isPanelOpen,
        togglePanel,
        closePanel,
        panelWidth = 380,
        setPanelWidth,
        panelState,
        setPanelState,
        panelError,
        setPanelError,
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

    const [isResizing, setIsResizing] = useState(false);

    const handleResizeMouseDown = (e) => {
        e.preventDefault();
        setIsResizing(true);
    };

    const handleResizeTouchStart = () => {
        setIsResizing(true);
    };

    const handleResetWidth = () => {
        setPanelWidth(DEFAULT_PANEL_WIDTH);
    };

    // ── Horizontal Drag Resizing Logic ─────────────────────────────────────────
    useEffect(() => {
        if (!isResizing) return;

        const handlePointerMove = (e) => {
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const newWidth = window.innerWidth - clientX;
            const maxWidth = getMaxPanelWidth();
            const clamped = Math.min(maxWidth, Math.max(MIN_PANEL_WIDTH, newWidth));
            setPanelWidth(clamped);
        };

        const handlePointerUp = () => {
            setIsResizing(false);
        };

        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';

        window.addEventListener('mousemove', handlePointerMove);
        window.addEventListener('mouseup', handlePointerUp);
        window.addEventListener('touchmove', handlePointerMove, { passive: false });
        window.addEventListener('touchend', handlePointerUp);

        return () => {
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
            window.removeEventListener('mousemove', handlePointerMove);
            window.removeEventListener('mouseup', handlePointerUp);
            window.removeEventListener('touchmove', handlePointerMove);
            window.removeEventListener('touchend', handlePointerUp);
        };
    }, [isResizing, setPanelWidth]);

    // ── Keep width within window bounds on viewport resize ────────────────────
    useEffect(() => {
        const handleWindowResize = () => {
            const maxWidth = getMaxPanelWidth();
            if (panelWidth > maxWidth) {
                setPanelWidth(maxWidth);
            }
        };
        window.addEventListener('resize', handleWindowResize);
        return () => window.removeEventListener('resize', handleWindowResize);
    }, [panelWidth, setPanelWidth]);

    const {
        query,
        setQuery,
        setSearchMode,
        setActiveFilters,
        leads,
        lastSearchedQuery,
        requestSearch,
    } = useLeadFinderStore();

    const [chatInput, setChatInput] = useState('');
    const [whyData, setWhyData] = useState(null); // { ...response, leadKey }
    const [whyLoading, setWhyLoading] = useState(false);
    const [whyError, setWhyError] = useState(null);
    const bodyRef = useRef(null);
    const chatInputRef = useRef(null);
    const stepTimerRef = useRef(null);
    const whySeqRef = useRef(0);
    const suggestionsSeqRef = useRef(0);
    const suggestionsAbortRef = useRef(null);

    // A persisted "lead" or "icp" view without its data falls back to a state that can render.
    const viewState = panelState === 'lead' && !selectedLead
        ? (icp ? 'active' : 'empty')
        : panelState === 'icp' && !icp ? 'empty' : panelState;

    // ── Auto-scroll messages ──────────────────────────────────────────────────
    useEffect(() => {
        if (bodyRef.current) {
            bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
        }
    }, [messages, viewState]);

    // ── Loading step animation ─────────────────────────────────────────────────
    const stopLoadingSteps = useCallback(() => {
        if (stepTimerRef.current) {
            clearInterval(stepTimerRef.current);
            stepTimerRef.current = null;
        }
    }, []);

    const animateLoadingSteps = useCallback(() => {
        stopLoadingSteps();
        setLoadingStep(LOADING_STEPS[0]);
        let idx = 0;
        stepTimerRef.current = setInterval(() => {
            idx = (idx + 1) % LOADING_STEPS.length;
            setLoadingStep(LOADING_STEPS[idx]);
        }, 1400);
    }, [setLoadingStep, stopLoadingSteps]);

    useEffect(() => () => {
        stopLoadingSteps();
        suggestionsAbortRef.current?.abort();
    }, [stopLoadingSteps]);

    // ── Fetch contextual suggestions (one request per committed query) ────────
    const fetchSuggestions = useCallback(async (forQuery) => {
        const q = typeof forQuery === 'string' ? forQuery.trim() : '';
        if (!q) return;
        suggestionsAbortRef.current?.abort();
        const controller = new AbortController();
        suggestionsAbortRef.current = controller;
        const seq = ++suggestionsSeqRef.current;
        try {
            const intel = useLeadIntelligenceStore.getState();
            const data = await apiFetch('/intelligence/suggestions', {
                method: 'POST',
                body: {
                    current_query: q,
                    user_offer: intel.offerInput,
                    leads_count: useLeadFinderStore.getState().leads?.length ?? 0,
                    icp: intel.icp || null,
                },
                signal: controller.signal,
            });
            if (seq !== suggestionsSeqRef.current) return; // a newer request owns the list
            if (Array.isArray(data?.suggestions)) setSuggestions(data.suggestions);
        } catch (err) {
            if (!isAbortError(err)) console.warn('[Intelligence] Suggestions fetch failed:', err?.message || err);
        }
    }, [setSuggestions]);

    // Suggestions follow searches that actually ran — not every keystroke in the search box.
    useEffect(() => {
        if (!isPanelOpen || !lastSearchedQuery || lastSearchedQuery.trim().length < 3) return undefined;
        const timer = setTimeout(() => fetchSuggestions(lastSearchedQuery), SUGGESTIONS_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [lastSearchedQuery, isPanelOpen, fetchSuggestions]);

    // ── Update results summary when leads change ──────────────────────────────
    useEffect(() => {
        if (leads && leads.length > 0 && icp) {
            const highFit = leads.filter(l => (l.opportunity_score ?? 0) >= 70).length;
            const hasSignals = leads.filter(l => (l.opportunity_signals?.length ?? 0) >= 2).length;
            setResultsSummary({ total: leads.length, highRelevance: highFit, strongSignals: hasSignals });
        }
    }, [leads, icp, setResultsSummary]);

    // ── ICP Discovery ─────────────────────────────────────────────────────────
    const handleDiscover = useCallback(async () => {
        const offer = offerInput.trim();
        if (!offer || offer.length < 3) return;

        setPanelState('understanding');
        setIsLoading(true);
        animateLoadingSteps();

        try {
            const data = await apiFetch('/intelligence/derive-icp', {
                method: 'POST',
                body: { offer },
            });

            if (data?.success && data.icp) {
                setIcp(data.icp);
                // Suggestions based on the ICP's suggested search
                if (data.icp.searchSuggestion) {
                    fetchSuggestions(data.icp.searchSuggestion);
                }
            } else {
                setPanelState('empty');
                setPanelError({ message: data?.error || "Couldn't analyse your offer. Try describing it in a few more words." });
            }
        } catch (err) {
            console.error('[Intelligence] ICP error:', err);
            setPanelState('empty');
            setPanelError({ message: errorMessage(err, "Couldn't analyse your offer. Please retry.") });
        } finally {
            stopLoadingSteps();
            setIsLoading(false);
        }
    }, [offerInput, setPanelState, setPanelError, setIsLoading, setIcp, animateLoadingSteps, stopLoadingSteps, fetchSuggestions]);

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

    // ── Chat / Conversational Search ─────────────────────────────────────────
    const handleChat = useCallback(async (messageText) => {
        if (useLeadIntelligenceStore.getState().isLoading) return; // one request at a time
        const msg = (messageText || chatInput).trim();
        if (!msg) return;

        setChatInput('');

        // History for the model: user / assistant roles only, error bubbles excluded.
        const history = toChatHistory(useLeadIntelligenceStore.getState().messages);
        addMessage({ role: 'user', content: msg });

        setIsLoading(true);
        try {
            const finder = useLeadFinderStore.getState();
            const data = await apiFetch('/intelligence/chat', {
                method: 'POST',
                body: {
                    message: msg,
                    user_offer: offerInput,
                    current_query: finder.query,
                    icp: icp || null,
                    conversation_history: history,
                },
            });

            if (data?.success === false && !data.reply) {
                addMessage({ role: 'assistant', content: data.error || CHAT_ERROR_TEXT, isError: true });
                return;
            }

            let searchExecuted = false;
            let searchQuery = null;

            // Apply the search command, keeping only filters the Lead Finder understands.
            const sc = data?.search_command;
            if (sc && typeof sc === 'object') {
                const { filters, city, category } = sanitizeFilters(sc.filters);
                const proposed = typeof sc.query === 'string' && sc.query.trim() ? sc.query.trim() : null;
                searchQuery = city || category
                    ? foldIntoQuery(proposed || finder.query, { city, category }) || null
                    : proposed;
                const validMode = typeof sc.mode === 'string' && SEARCH_MODE_VALUES.includes(sc.mode) ? sc.mode : null;

                if (searchQuery) setQuery(searchQuery);
                if (validMode) setSearchMode(validMode);
                if (filters) setActiveFilters(filters);
                searchExecuted = !!(searchQuery || validMode || filters);
            }

            // Add AI reply
            if (data?.reply) {
                addMessage({
                    role: 'assistant',
                    content: data.reply,
                    searchExecuted,
                });
            }

            // Update suggestions
            if (data?.suggestions?.length) {
                setSuggestions(data.suggestions);
            }

            // Lead Finder runs the search with the mode, filters and offer just set.
            if (searchQuery) requestSearch(searchQuery);
        } catch (err) {
            console.error('[Intelligence] Chat error:', err);
            addMessage({
                role: 'assistant',
                content: err instanceof ApiError && err.status !== 0 ? err.message : CHAT_ERROR_TEXT,
                isError: true,
            });
        } finally {
            setIsLoading(false);
        }
    }, [chatInput, offerInput, icp, addMessage, setIsLoading,
        setQuery, setSearchMode, setActiveFilters, setSuggestions, requestSearch]);

    // ── Fetch Why This Lead (latest request wins) ─────────────────────────────
    const fetchWhyLead = useCallback(async (lead) => {
        if (!lead) return;
        const seq = ++whySeqRef.current;
        setWhyLoading(true);
        setWhyData(null);
        setWhyError(null);

        try {
            const data = await apiFetch('/intelligence/why-this-lead', {
                method: 'POST',
                body: {
                    lead,
                    user_offer: offerInput,
                },
            });
            if (seq !== whySeqRef.current) return;
            if (data?.success) {
                setWhyData({ ...data, leadKey: leadKeyOf(lead) });
            } else {
                setWhyError(data?.error || "Couldn't analyse this lead.");
            }
        } catch (err) {
            if (seq !== whySeqRef.current) return;
            console.warn('[Intelligence] Why-lead fetch failed:', err);
            setWhyError(errorMessage(err, "Couldn't analyse this lead. Please retry."));
        } finally {
            if (seq === whySeqRef.current) setWhyLoading(false);
        }
    }, [offerInput]);

    // ── Analyze the selected lead whenever it changes in the lead view ────────
    const analyzeSelectedLead = useEffectEvent((lead) => {
        fetchWhyLead(lead);
    });

    useEffect(() => {
        if (selectedLead && isPanelOpen && panelState === 'lead') {
            analyzeSelectedLead(selectedLead);
        }
    }, [selectedLead, isPanelOpen, panelState]);

    const handleAnalyzeLead = useCallback(() => {
        if (selectedLead) setPanelState('lead');
    }, [selectedLead, setPanelState]);

    const handleBackFromLead = useCallback(() => {
        whySeqRef.current += 1; // drop any in-flight analysis
        setWhyData(null);
        setWhyError(null);
        setWhyLoading(false);
        setPanelState(icp ? 'active' : 'empty');
    }, [icp, setPanelState]);

    // ── Handle suggestion click ───────────────────────────────────────────────
    const handleSuggestion = useCallback((text) => {
        if (viewState === 'active' || viewState === 'lead') {
            handleChat(text);
        } else {
            setOfferInput(text);
        }
    }, [viewState, handleChat, setOfferInput]);

    // ── Chat textarea key handler ─────────────────────────────────────────────
    const handleChatKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (chatInput.trim() && !isLoading) handleChat();
        }
    };

    const currentWhy = whyData && whyData.leadKey === leadKeyOf(selectedLead) ? whyData : null;

    // ═════════════════════════════════════════════════════════════════════════
    // RENDER
    // ═════════════════════════════════════════════════════════════════════════

    return (
        <>
            {/* ── Toggle Button (right edge) ── */}
            <button
                type="button"
                className={`li-toggle-btn ${isPanelOpen ? 'panel-open' : ''} ${isResizing ? 'is-resizing' : ''}`}
                onClick={togglePanel}
                title="Lead Intelligence"
                aria-expanded={isPanelOpen}
                aria-controls="li-panel"
                style={{
                    '--panel-width': `${panelWidth}px`,
                    ...(isPanelOpen ? { right: `${panelWidth}px` } : {})
                }}
            >
                <div className="li-toggle-icon">
                    <Sparkles size={14} aria-hidden="true" />
                </div>
                <span className="li-toggle-label">Intelligence</span>
                {icp && <div className="li-toggle-dot" />}
            </button>

            {/* ── Panel ── (inert while closed: it is only moved off-screen) */}
            <div
                id="li-panel"
                className={`li-panel ${isPanelOpen ? 'is-open' : ''} ${isResizing ? 'is-resizing' : ''}`}
                role="complementary"
                aria-label="Lead Intelligence"
                aria-hidden={!isPanelOpen}
                inert={!isPanelOpen}
                style={{
                    '--panel-width': `${panelWidth}px`,
                    width: `${panelWidth}px`,
                    right: isPanelOpen ? 0 : `-${panelWidth + 40}px`
                }}
            >
                {/* ── Horizontal Resize Drag Handle ── */}
                <div
                    className={`li-resize-handle ${isResizing ? 'is-dragging' : ''}`}
                    onMouseDown={handleResizeMouseDown}
                    onTouchStart={handleResizeTouchStart}
                    onDoubleClick={handleResetWidth}
                    title="Drag horizontally to resize · Double-click to reset"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize Intelligence sidebar"
                >
                    <div className="li-resize-handle-knob" />
                </div>

                {/* Header */}
                <div className="li-header">
                    <div className="li-header-left">
                        <div className="li-header-title">
                            <span className="li-header-glyph" aria-hidden="true">✦</span>
                            Lead Intelligence
                        </div>
                        <div className="li-header-sub">Your AI sales research copilot</div>
                    </div>
                    <button type="button" className="li-header-close" onClick={closePanel} title="Close panel" aria-label="Close panel">
                        <X size={14} />
                    </button>
                </div>

                {/* Body */}
                <div className="li-body" ref={bodyRef}>

                    {/* ── State A: Empty ── */}
                    {viewState === 'empty' && (
                        <EmptyState onDiscover={handleDiscover} error={panelError?.message} />
                    )}

                    {/* ── State B: Understanding ── */}
                    {viewState === 'understanding' && (
                        <UnderstandingState step={loadingStep} />
                    )}

                    {/* ── State C: ICP Recommendation ── */}
                    {viewState === 'icp' && icp && (
                        <ICPState
                            icp={icp}
                            onConfirm={handleICPConfirm}
                            onAdjust={handleICPAdjust}
                            onReset={clearIcp}
                        />
                    )}

                    {/* ── State: Active / Conversation ── */}
                    {viewState === 'active' && (
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
                                    <button type="button" className="li-icp-reset-btn" onClick={() => setPanelState('icp')} title="View ICP">
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
                                            type="button"
                                            className="li-lead-action-btn"
                                            onClick={handleAnalyzeLead}
                                            style={{ marginTop: '0.4rem' }}
                                        >
                                            <Target size={13} aria-hidden="true" />
                                            <span>Why {selectedLead.business_name}?</span>
                                            <ChevronRight size={13} style={{ marginLeft: 'auto' }} aria-hidden="true" />
                                        </button>
                                    </div>
                                </>
                            )}

                            {/* Message thread */}
                            {messages.length > 0 && (
                                <>
                                    <div className="li-divider" />
                                    <div className="li-messages" aria-live="polite">
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
                    {viewState === 'lead' && (
                        <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '-0.25rem' }}>
                                <button type="button" className="li-btn li-btn--ghost" onClick={handleBackFromLead} style={{ padding: '0.25rem 0', fontSize: '0.7rem' }}>
                                    ← Back
                                </button>
                            </div>
                            <LeadAnalysisState
                                lead={selectedLead}
                                whyData={currentWhy}
                                isLoading={whyLoading}
                                error={whyError}
                                onRetry={() => fetchWhyLead(selectedLead)}
                                onGoOutreach={() => selectedLead && onOutreach?.(selectedLead, offerInput)}
                                onGoCall={() => selectedLead && onStartCall?.(selectedLead)}
                            />
                            {/* Suggestions below lead analysis */}
                            {!whyLoading && currentWhy && suggestions.length > 0 && (
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
                {(viewState === 'active' || viewState === 'lead') && (
                    <div className="li-chat-input-area">
                        <div className="li-chat-input-wrap">
                            <textarea
                                ref={chatInputRef}
                                className="li-chat-input"
                                aria-label={viewState === 'lead' ? 'Ask about this lead' : 'Message Lead Intelligence'}
                                placeholder={
                                    viewState === 'lead'
                                        ? 'Ask about this lead...'
                                        : 'Refine search, change city, add filters...'
                                }
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyDown={handleChatKeyDown}
                                rows={1}
                            />
                            <button
                                type="button"
                                className="li-chat-send-btn"
                                onClick={() => handleChat()}
                                disabled={!chatInput.trim() || isLoading}
                                title="Send"
                                aria-label="Send message"
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
