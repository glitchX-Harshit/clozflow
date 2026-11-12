import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
    ArrowDownToLine,
    ArrowLeft,
    BellOff,
    BookOpen,
    ChevronDown,
    Mic,
    Pin,
    PinOff,
    Send,
    Sparkles,
    Square,
    ThumbsDown,
    ThumbsUp,
    X,
} from 'lucide-react';
import useCopilotStore from '../../store/copilotStore';
import { INTENSITIES } from '../../lib/wizardApi';
import { SNOOZE_DURATIONS, SNOOZE_OPTIONS, chipText, momentLabel, splitSentences } from '../../lib/cardPolicy';
import { levelToHeight } from '../../audio/levelBus';
import BattlecardDetail from './BattlecardDetail';
import '../../components/LiveCopilotPopup.css';

const STATUS = {
    failed: { tone: 'red', text: 'Connection lost' },
    reconnecting: { tone: 'amber', text: 'Reconnecting…' },
    connecting: { tone: 'amber', text: 'Connecting…' },
};

function statusLine({ isListening, hasStarted, connectionState, protocol }) {
    if (STATUS[connectionState] && (isListening || connectionState === 'failed')) return STATUS[connectionState];
    if (isListening && protocol === 0) return { tone: 'amber', text: 'Warming up…' };
    if (isListening) return { tone: 'green', text: 'Listening' };
    if (hasStarted) return { tone: 'amber', text: 'Paused' };
    return { tone: 'muted', text: 'Not started' };
}

/* ── Small level meter (idle state) ───────────────────────────────────────── */
const LevelMeter = memo(function LevelMeter({ bus, bars = 14 }) {
    const snapshot = useSyncExternalStore(bus.subscribe, bus.getSnapshot, bus.getSnapshot);
    const levels = snapshot.levels.slice(-bars);
    return (
        <div className="hud-meter" aria-hidden="true">
            {levels.map((level, i) => (
                <span key={i} className="hud-meter__bar" style={{ height: `${levelToHeight(level) * 100}%` }} />
            ))}
        </div>
    );
});

/* ── The now card ─────────────────────────────────────────────────────────── */
const NowCard = memo(function NowCard({ card, hud, controls, battlecard, onFeedback, feedback }) {
    // "Open card" is remembered per card id, so a new card arrives collapsed without an effect.
    const [openCardFor, setOpenCardFor] = useState(null);
    const showCard = openCardFor === card.id;
    const setShowCard = (next) => setOpenCardFor(next ? card.id : null);
    const sentences = splitSentences(card.say);
    const ttl = hud.remainingMs;
    const onDemand = card.trigger === 'on_demand' || card.trigger === 'ask';
    const isLegacy = !!card.legacy;

    const classes = [
        'hud-card',
        `hud-card--${card.moment}`,
        card.priority === 'high' ? 'hud-card--high' : '',
        card.late ? 'hud-card--late' : '',
        card.provisional ? 'hud-card--provisional' : '',
        card.pinned ? 'hud-card--pinned' : '',
        onDemand ? 'hud-card--on-demand' : '',
    ].filter(Boolean).join(' ');

    return (
        <article className={classes} aria-label={`${momentLabel(card.moment)} card`}>
            <header className="hud-card__top">
                <span className={`hud-chip hud-chip--${card.moment}`}>
                    {card.priority === 'high' && <span className="hud-chip__dot" aria-hidden="true" />}
                    {onDemand ? (card.trigger === 'ask' ? 'Your question' : 'What to say') : momentLabel(card.moment)}
                </span>
                {card.provisional && <span className="hud-card__refining" role="status">refining…</span>}
                {card.late && <span className="hud-card__late-tag">Late — for reference</span>}
                <span className="hud-card__spacer" />
                {hud.previous && !card.pinned && (
                    <button type="button" className="hud-icon-btn" onClick={() => controls.restorePrevious?.()} title="Previous card" aria-label="Show the previous card">
                        <ArrowLeft size={14} aria-hidden="true" />
                    </button>
                )}
                <button
                    type="button"
                    className={`hud-icon-btn ${card.pinned ? 'hud-icon-btn--active' : ''}`}
                    onClick={() => (card.pinned ? controls.unpin?.() : controls.pin?.(card.id))}
                    aria-pressed={card.pinned}
                    title={card.pinned ? 'Unpin' : 'Pin (keeps the card)'}
                    aria-label={card.pinned ? 'Unpin this card' : 'Pin this card'}
                >
                    {card.pinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}
                </button>
                <button type="button" className="hud-icon-btn" onClick={() => controls.dismiss?.()} title="Dismiss" aria-label="Dismiss this card">
                    <X size={14} aria-hidden="true" />
                </button>
            </header>

            {card.cue === 'pause' && (
                <div className="hud-card__cue" role="note">
                    <span className="hud-card__cue-dot" aria-hidden="true" />
                    Pause… let them finish
                </div>
            )}

            {card.headline && <div className="hud-card__headline">{card.headline}</div>}

            <div className="hud-card__body">
                {sentences.length > 0 ? (
                    <p className="hud-card__say" lang={card.sayLang === 'hi-IN' ? 'hi' : undefined}>
                        {sentences.map((sentence, i) => (
                            <span key={`${i}-${sentence.slice(0, 12)}`} className="hud-card__sentence">{sentence}{' '}</span>
                        ))}
                    </p>
                ) : (
                    <p className="hud-card__say hud-card__say--pending" aria-busy="true">Writing the first line…</p>
                )}
                {card.thenAsk && (
                    <p className="hud-card__then"><span className="hud-card__then-label">Then ask:</span> {card.thenAsk}</p>
                )}
                {card.detail && <p className="hud-card__detail">{card.detail}</p>}
            </div>

            <footer className="hud-card__foot">
                <div className="hud-card__sources">
                    {card.sources?.map((s, i) => (
                        <span key={`${s.label}-${i}`} className="hud-source" title={s.kind}>{s.label}</span>
                    ))}
                    {battlecard && (
                        <button type="button" className="hud-link" onClick={() => setShowCard(!showCard)} aria-expanded={showCard}>
                            <BookOpen size={12} aria-hidden="true" /> {showCard ? 'Hide card' : 'Open card'}
                        </button>
                    )}
                </div>
                {!isLegacy && (
                    <div className="hud-card__feedback" role="group" aria-label="Was this useful?">
                        {onDemand && (
                            <button type="button" className="hud-text-btn" onClick={() => controls.whatToSay?.('long')} title="A longer answer">Longer</button>
                        )}
                        <button
                            type="button"
                            className={`hud-icon-btn ${feedback === 'up' ? 'hud-icon-btn--good' : ''}`}
                            onClick={() => onFeedback(card.id, 'up')}
                            aria-pressed={feedback === 'up'}
                            aria-label="Useful"
                            title="Useful"
                        >
                            <ThumbsUp size={13} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            className={`hud-icon-btn ${feedback === 'down' ? 'hud-icon-btn--bad' : ''}`}
                            onClick={() => onFeedback(card.id, 'down')}
                            aria-pressed={feedback === 'down'}
                            aria-label="Not useful"
                            title="Not useful"
                        >
                            <ThumbsDown size={13} aria-hidden="true" />
                        </button>
                    </div>
                )}
            </footer>

            {showCard && battlecard && (
                <div className="hud-card__battlecard">
                    <BattlecardDetail card={battlecard} compact />
                </div>
            )}

            {ttl !== null && !card.pinned && (
                <div
                    key={`${card.id}-${card.updatedAt}`}
                    className="hud-card__ttl"
                    style={{ animationDuration: `${ttl}ms`, animationPlayState: hud.hovering ? 'paused' : 'running' }}
                    aria-hidden="true"
                />
            )}
        </article>
    );
});

/* ── Menus (details/summary: keyboard friendly without extra state) ─────────── */
function IntensityMenu({ intensity, onChange }) {
    const current = INTENSITIES.find((i) => i.id === intensity) || INTENSITIES[1];
    return (
        <details className="hud-menu">
            <summary className="hud-menu__summary" title="Coaching intensity">
                <Sparkles size={12} aria-hidden="true" /> {current.label} <ChevronDown size={11} aria-hidden="true" />
            </summary>
            <div className="hud-menu__panel" role="menu" aria-label="Coaching intensity">
                {INTENSITIES.map((i) => (
                    <button
                        key={i.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={i.id === intensity}
                        className={`hud-menu__item ${i.id === intensity ? 'hud-menu__item--active' : ''}`}
                        onClick={(e) => { onChange(i.id); e.currentTarget.closest('details')?.removeAttribute('open'); }}
                    >
                        <strong>{i.label}</strong>
                        <span>{i.blurb}</span>
                    </button>
                ))}
            </div>
        </details>
    );
}

function SnoozeMenu({ snoozed, onSnooze, onUnsnooze }) {
    const active = snoozed.length > 0;
    return (
        <details className="hud-menu">
            <summary className={`hud-menu__summary ${active ? 'hud-menu__summary--active' : ''}`} title="Snooze a category">
                <BellOff size={12} aria-hidden="true" /> {active ? `Snoozed ${snoozed.length}` : 'Snooze'}
            </summary>
            <div className="hud-menu__panel hud-menu__panel--snooze" role="menu" aria-label="Snooze cards by category">
                {SNOOZE_OPTIONS.map((opt) => {
                    const isSnoozed = snoozed.some((s) => s.moment === opt.moment);
                    return (
                        <div key={opt.moment} className="hud-menu__row">
                            <span className="hud-menu__row-label">{opt.label}</span>
                            {isSnoozed ? (
                                <button type="button" className="hud-text-btn" onClick={() => onUnsnooze(opt.moment)}>Resume</button>
                            ) : SNOOZE_DURATIONS.map((d) => (
                                <button key={d.ms} type="button" className="hud-text-btn" onClick={(e) => { onSnooze(opt.moment, d.ms); e.currentTarget.closest('details')?.removeAttribute('open'); }}>{d.label}</button>
                            ))}
                        </div>
                    );
                })}
            </div>
        </details>
    );
}

/**
 * CopilotHud — the live "now card" surface. Rendered inside the Live Call page
 * (`compact=false`) and inside the Picture-in-Picture window (`compact=true`).
 * All state comes from the copilot store; all actions go through `controls`.
 */
export default function CopilotHud({ compact = false, dark = compact, onDock, onClose, meter = null }) {
    const isListening = useCopilotStore((s) => s.isListening);
    const hasStarted = useCopilotStore((s) => s.hasStarted);
    const connectionState = useCopilotStore((s) => s.connectionState);
    const protocol = useCopilotStore((s) => s.protocol);
    const hud = useCopilotStore((s) => s.hud);
    const strip = useCopilotStore((s) => s.strip);
    const intensity = useCopilotStore((s) => s.intensity);
    const features = useCopilotStore((s) => s.features);
    const nudge = useCopilotStore((s) => s.nudge);
    const askOpen = useCopilotStore((s) => s.askOpen);
    const askPending = useCopilotStore((s) => s.askPending);
    const roundTripMs = useCopilotStore((s) => s.roundTripMs);
    const battlecards = useCopilotStore((s) => s.battlecards);
    const controls = useCopilotStore((s) => s.controls);
    const meeting = useCopilotStore((s) => s.meeting);
    const setAskOpen = useCopilotStore((s) => s.setAskOpen);

    const [question, setQuestion] = useState('');
    const [feedback, setFeedback] = useState({}); // card id → up | down
    const askRef = useRef(null);
    const stageRef = useRef(null);

    const card = hud.card;
    const canControl = protocol === 2 && features.length > 0;
    const legacyServer = protocol === 1;
    const status = statusLine({ isListening, hasStarted, connectionState, protocol });

    useEffect(() => {
        if (askOpen) askRef.current?.focus();
    }, [askOpen]);

    const submitAsk = (e) => {
        e.preventDefault();
        const q = question.trim();
        if (!q) return;
        controls.ask?.(q);
        setQuestion('');
        setAskOpen(false);
    };

    const sendFeedback = (id, value) => {
        setFeedback((prev) => ({ ...prev, [id]: value }));
        controls.feedback?.(id, value);
    };

    const stageHover = {
        onMouseEnter: () => controls.hoverStart?.(),
        onMouseLeave: () => controls.hoverEnd?.(),
        onFocus: () => controls.hoverStart?.(),
        onBlur: (e) => { if (!stageRef.current?.contains(e.relatedTarget)) controls.hoverEnd?.(); },
    };

    const idleText = !hasStarted
        ? (meeting?.title ? `Ready for “${meeting.title}”` : 'Ready when you are')
        : !isListening
            ? 'Paused — resume in the Live Call tab'
            : legacyServer
                ? 'Listening (classic engine)'
                : 'Listening…';

    return (
        <div className={`hud ${compact ? 'hud--compact' : ''} ${dark ? 'hud--dark' : 'hud--light'}`}>
            <header className="hud__bar">
                <div className="hud__status" role="status">
                    <span className={`hud__dot hud__dot--${status.tone}`} aria-hidden="true" />
                    <span className="hud__status-text">{status.text}</span>
                    {isListening && connectionState === 'connected' && protocol === 2 && <span className="hud__live">LIVE</span>}
                    {roundTripMs !== null && !compact && (
                        <span className={`hud__rtt ${roundTripMs > 2000 ? 'hud__rtt--slow' : ''}`} title="Measured round trip to the copilot">
                            · responds in about {(Math.max(roundTripMs, 300) / 1000).toFixed(1)} s{roundTripMs > 2000 ? ' (slow network)' : ''}
                        </span>
                    )}
                </div>
                <div className="hud__bar-actions">
                    {canControl && <IntensityMenu intensity={intensity} onChange={(v) => controls.setIntensity?.(v)} />}
                    {canControl && <SnoozeMenu snoozed={hud.snoozed} onSnooze={(m, ms) => controls.snooze?.(m, ms)} onUnsnooze={(m) => controls.unsnooze?.(m)} />}
                    {onDock && (
                        <button type="button" className="hud-icon-btn" onClick={onDock} title="Dock back to the Live Call page" aria-label="Dock back to the Live Call page">
                            <ArrowDownToLine size={13} aria-hidden="true" />
                        </button>
                    )}
                    {onClose && (
                        <button type="button" className="hud-icon-btn hud-icon-btn--close" onClick={onClose} title="Close this window" aria-label="Close the copilot window">
                            <X size={13} aria-hidden="true" />
                        </button>
                    )}
                </div>
            </header>

            {hud.chips.length > 0 && (
                <div className="hud__chips" aria-label="Recent moments">
                    {hud.chips.map((chip) => (
                        <span key={`${chip.moment}-${chip.at}`} className={`hud-chip hud-chip--${chip.moment}`}>{chipText(chip)}</span>
                    ))}
                </div>
            )}

            <div className="hud__stage" ref={stageRef} aria-live="polite" aria-atomic="false" {...stageHover}>
                {card ? (
                    <div key={card.id} className="hud__card-wrap">
                        <NowCard
                            card={card}
                            hud={hud}
                            controls={controls}
                            battlecard={card.battlecardId ? battlecards[card.battlecardId] : null}
                            onFeedback={sendFeedback}
                            feedback={feedback[card.id] || null}
                        />
                    </div>
                ) : (
                    <div className="hud__idle">
                        {meter && isListening ? <LevelMeter bus={meter} bars={compact ? 12 : 20} /> : <Mic size={compact ? 18 : 22} strokeWidth={1.6} aria-hidden="true" className="hud__idle-icon" />}
                        <span className="hud__idle-text">{idleText}</span>
                        {isListening && hud.previous && (
                            <button type="button" className="hud-text-btn" onClick={() => controls.restorePrevious?.()}>
                                <ArrowLeft size={12} aria-hidden="true" /> Show last card
                            </button>
                        )}
                    </div>
                )}
            </div>

            {hud.pinned && (
                <div className="hud__pinned" aria-label="Pinned card">
                    <Pin size={12} aria-hidden="true" />
                    <span className="hud__pinned-text"><strong>{hud.pinned.headline}</strong>{hud.pinned.say ? ` — ${hud.pinned.say}` : ''}</span>
                    <button type="button" className="hud-icon-btn" onClick={() => controls.dismissPinned?.()} aria-label="Remove the pinned card"><X size={12} aria-hidden="true" /></button>
                </div>
            )}

            {strip && (
                <div key={`${strip.label}-${strip.askNext}`} className="hud__strip" role="status" aria-label="Where we are">
                    {strip.label && <span className="hud__strip-label">{strip.label}</span>}
                    {strip.askNext && <span className="hud__strip-ask">{strip.askNext}</span>}
                </div>
            )}

            {nudge && (
                <div className={`hud__nudge hud__nudge--${nudge.kind}`} role="status">
                    <span>{nudge.text}</span>
                    <button type="button" className="hud-icon-btn" onClick={() => controls.dismissNudge?.()} aria-label="Dismiss"><X size={12} aria-hidden="true" /></button>
                </div>
            )}

            <footer className="hud__controls">
                <button
                    type="button"
                    className="hud-btn hud-btn--primary"
                    data-hud-primary
                    onClick={() => controls.whatToSay?.()}
                    disabled={!canControl || !isListening}
                    aria-busy={askPending}
                    title="Ctrl/Cmd + Enter"
                >
                    <Sparkles size={14} aria-hidden="true" />
                    {askPending ? 'Thinking…' : 'What should I say?'}
                    <kbd aria-hidden="true">⌃↵</kbd>
                </button>
                <button
                    type="button"
                    className="hud-btn"
                    onClick={() => setAskOpen(!askOpen)}
                    disabled={!canControl || !isListening}
                    aria-expanded={askOpen}
                    title="Ctrl/Cmd + K"
                >
                    Ask <kbd aria-hidden="true">⌃K</kbd>
                </button>
                {controls.endCall && (
                    <button type="button" className="hud-btn hud-btn--end" onClick={() => controls.endCall?.()} title="End the session and open the debrief">
                        <Square size={12} aria-hidden="true" /> {compact ? '' : 'End'}
                        {compact && <span className="sr-only">End</span>}
                    </button>
                )}
            </footer>

            {askOpen && (
                <form className="hud__ask" onSubmit={submitAsk}>
                    <input
                        ref={askRef}
                        className="hud__ask-input"
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        placeholder="Ask about the deal, the product or what they just said…"
                        aria-label="Ask the copilot"
                        maxLength={400}
                    />
                    <button type="submit" className="hud-btn hud-btn--primary" disabled={!question.trim()} aria-label="Send question">
                        <Send size={13} aria-hidden="true" />
                    </button>
                </form>
            )}
        </div>
    );
}
