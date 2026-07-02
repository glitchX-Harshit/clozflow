import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    Zap,
    BrainCircuit,
    TrendingUp,
    X,
    MessageSquare,
    ArrowDownToLine,
} from 'lucide-react';
import useCopilotStore from '../store/copilotStore';
import './LiveCopilotPopup.css';

/**
 * LiveCopilotPopup — Renders copilot content into the external window.
 *
 * This component is mounted at the App root. It reads the external
 * window container from the Zustand store and portals content into it.
 *
 * No in-page popup mode — the popup ONLY lives in the external window.
 * When docked, the LiveCall dashboard panel handles the UI instead.
 */
const LiveCopilotPopup = () => {
    const {
        externalContainer,
        isListening,
        latestSuggestion,
        suggestionCount,
        reasoningData,
        dockToPanel,
        hidePopup,
    } = useCopilotStore();

    // ── Animation key for new suggestions ──
    const [animKey, setAnimKey] = useState(0);
    const prevSuggestionId = useRef(null);
    const bodyRef = useRef(null);

    // Re-animate when new suggestion arrives
    useEffect(() => {
        if (latestSuggestion && latestSuggestion.id !== prevSuggestionId.current) {
            prevSuggestionId.current = latestSuggestion.id;
            setAnimKey(k => k + 1);
            if (bodyRef.current) bodyRef.current.scrollTop = 0;
        }
    }, [latestSuggestion]);

    // Nothing to render if no external window is open
    if (!externalContainer) return null;

    const content = (
        <div className="copilot-popup" style={{ height: '100%' }}>
            {/* ── Header ── */}
            <div className="copilot-popup__header">
                <div className="copilot-popup__header-left">
                    <div className={`copilot-popup__wave ${!isListening ? 'copilot-popup__wave--idle' : ''}`}>
                        <span className="copilot-popup__wave-bar" />
                        <span className="copilot-popup__wave-bar" />
                        <span className="copilot-popup__wave-bar" />
                    </div>
                    <span className="copilot-popup__title">ClozFlow Copilot</span>
                    {isListening && (
                        <span className="copilot-popup__live-badge">LIVE</span>
                    )}
                </div>

                <div className="copilot-popup__header-actions">
                    {/* Dock back into dashboard panel */}
                    <button
                        className="copilot-popup__btn copilot-popup__btn--dock"
                        onClick={dockToPanel}
                        title="Dock back to dashboard"
                    >
                        <ArrowDownToLine size={13} />
                    </button>

                    {/* Close */}
                    <button
                        className="copilot-popup__btn copilot-popup__btn--close"
                        onClick={hidePopup}
                        title="Close copilot"
                    >
                        <X size={13} />
                    </button>
                </div>
            </div>

            <div className="copilot-popup__divider" />

            {/* ── Body ── */}
            <div className="copilot-popup__body" ref={bodyRef}>
                {!latestSuggestion ? (
                    /* Idle / Waiting */
                    <div className="copilot-popup__idle">
                        <div className="copilot-popup__idle-ring">
                            <BrainCircuit size={32} strokeWidth={1.5} />
                        </div>
                        <span className="copilot-popup__idle-text">
                            {isListening ? 'Analyzing conversation...' : 'Waiting to start'}
                        </span>
                        <span className="copilot-popup__idle-sub">
                            {isListening
                                ? 'AI responses will appear here in real-time.'
                                : 'Start your session to activate the engine.'}
                        </span>
                    </div>
                ) : (
                    <>
                        {/* AI Response */}
                        <div className="copilot-popup__response" key={`r-${animKey}`}>
                            <div className="copilot-popup__response-label">
                                <Zap size={11} strokeWidth={2.5} />
                                <span>Say This</span>
                            </div>
                            <div className="copilot-popup__response-text">
                                "{latestSuggestion.text}"
                            </div>
                            {latestSuggestion.strategy && (
                                <div className="copilot-popup__strategy">
                                    {latestSuggestion.strategy}
                                </div>
                            )}
                        </div>

                        {/* Next Question */}
                        {latestSuggestion.nextQuestion && (
                            <div className="copilot-popup__next" key={`n-${animKey}`}>
                                <div className="copilot-popup__next-label">
                                    <TrendingUp size={11} strokeWidth={2.5} />
                                    <span>Ask Next</span>
                                </div>
                                <div className="copilot-popup__next-text">
                                    "{latestSuggestion.nextQuestion}"
                                </div>
                            </div>
                        )}

                        {/* Coaching Tip */}
                        {reasoningData?.coachingTip && (
                            <div className="copilot-popup__tip" key={`t-${animKey}`}>
                                <MessageSquare size={12} strokeWidth={2} />
                                <span>{reasoningData.coachingTip}</span>
                            </div>
                        )}

                        {/* Count */}
                        {suggestionCount > 1 && (
                            <div className="copilot-popup__history-count">
                                {suggestionCount} insights generated
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );

    return createPortal(content, externalContainer);
};

export default LiveCopilotPopup;
