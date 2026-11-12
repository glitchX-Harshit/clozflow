import { AlertOctagon, Check, Copy, HelpCircle, Lightbulb, MessageSquareQuote, ShieldCheck, Target } from 'lucide-react';
import { useState } from 'react';
import { copyText } from '../../lib/clipboard';

const ROWS = [
    ['fact', 'Fact', ShieldCheck],
    ['impact', 'Impact', Target],
    ['act', 'Say', MessageSquareQuote],
    ['question_to_ask', 'Then ask', HelpCircle],
    ['proof_point', 'Proof', Lightbulb],
    ['do_not', "Don't", AlertOctagon],
];

/**
 * One battlecard, Klue-style: Fact → Impact → Act (the spoken reframe) → Ask →
 * Proof → Don't. `compact` is the version shown inside the live HUD.
 */
export default function BattlecardDetail({ card, compact = false, showTriggers = true, className = '' }) {
    const [copied, setCopied] = useState(false);
    if (!card) return null;

    const copyAct = async () => {
        if (!(await copyText(card.act))) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
    };

    const rows = ROWS.filter(([key]) => card[key]).filter(([key]) => !compact || ['fact', 'act', 'do_not', 'question_to_ask'].includes(key));

    return (
        <div className={`bc-detail ${compact ? 'bc-detail--compact' : ''} ${className}`}>
            {!compact && (
                <div className="bc-detail__head">
                    <span className="bc-detail__dot" style={{ background: card.accent }} aria-hidden="true" />
                    <div>
                        <div className="bc-detail__kicker">{[card.kind?.replace(/_/g, ' '), card.category, card.tag].filter(Boolean).join(' · ')}</div>
                        <h3 className="bc-detail__title">{card.title}</h3>
                    </div>
                </div>
            )}
            <dl className="bc-detail__rows">
                {rows.map((row) => {
                    const [key, label] = row;
                    const Icon = row[2];
                    return (
                        <div key={key} className={`bc-detail__row bc-detail__row--${key}`}>
                            <dt><Icon size={13} aria-hidden="true" /> {label}</dt>
                            <dd>
                                {card[key]}
                                {key === 'act' && (
                                    <button type="button" className="bc-detail__copy" onClick={copyAct} aria-label="Copy the line to say">
                                        {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                                        <span>{copied ? 'Copied' : 'Copy'}</span>
                                    </button>
                                )}
                            </dd>
                        </div>
                    );
                })}
            </dl>
            {!compact && card.psychology && (
                <p className="bc-detail__psych"><strong>Why it works.</strong> {card.psychology}</p>
            )}
            {!compact && showTriggers && card.trigger_keywords?.length > 0 && (
                <div className="bc-detail__triggers" aria-label="Trigger phrases">
                    {card.trigger_keywords.map((k) => <span key={k} className="bc-detail__trigger">{k}</span>)}
                </div>
            )}
        </div>
    );
}
