import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { MEETING_STATUS_LABELS, WIZARD_UNAVAILABLE_MESSAGE, isWizardUnavailable, outcomeInfo } from '../../lib/wizardApi';
import { errorMessage } from '../../lib/apiFetch';

/** Small coloured label. tone: good | warn | bad | muted | accent */
export function Pill({ tone = 'muted', children, className = '', title }) {
    return <span className={`wz-pill wz-pill--${tone} ${className}`} title={title}>{children}</span>;
}

export function OutcomePill({ outcome }) {
    if (!outcome) return null;
    const info = outcomeInfo(outcome);
    return <Pill tone={info.tone}>{info.label}</Pill>;
}

export function StatusPill({ status }) {
    const tone = status === 'live' ? 'bad' : status === 'ready' ? 'accent' : status === 'debriefed' ? 'good' : status === 'cancelled' || status === 'no_show' ? 'muted' : 'muted';
    return <Pill tone={tone} className={status === 'live' ? 'wz-pill--pulse' : ''}>{MEETING_STATUS_LABELS[status] || status}</Pill>;
}

export function Spinner({ label = 'Loading…', size = 18 }) {
    return (
        <div className="wz-loading" role="status" aria-live="polite">
            <Loader2 size={size} className="wz-spin" aria-hidden="true" />
            <span>{label}</span>
        </div>
    );
}

export function EmptyState({ icon, title, text, children }) {
    const Icon = icon;
    return (
        <div className="wz-empty">
            {Icon && <Icon size={28} className="wz-empty__icon" aria-hidden="true" />}
            {title && <h4>{title}</h4>}
            {text && <p>{text}</p>}
            {children && <div className="wz-empty__actions">{children}</div>}
        </div>
    );
}

export function ErrorState({ error, onRetry, fallback = 'Something went wrong.', children }) {
    const unavailable = isWizardUnavailable(error);
    const message = unavailable ? WIZARD_UNAVAILABLE_MESSAGE : errorMessage(error, fallback);
    return (
        <div className={`wz-error ${unavailable ? 'wz-error--soft' : ''}`} role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <div className="wz-error__body">
                <span>{message}</span>
                {children}
            </div>
            {onRetry && (
                <button type="button" className="wz-btn wz-btn--ghost wz-btn--sm" onClick={onRetry}>
                    <RefreshCw size={13} aria-hidden="true" /> Retry
                </button>
            )}
        </div>
    );
}

/** A titled card section with an optional step number and header actions. */
export function SectionCard({ step, title, desc, actions, children, className = '', id }) {
    return (
        <section className={`wz-card ${className}`} id={id} aria-labelledby={id ? `${id}-title` : undefined}>
            {(title || actions) && (
                <div className="wz-card-header">
                    <div className="wz-card-title-group">
                        {step && <span className="wz-step-num">{step}</span>}
                        <div>
                            {title && <h3 className="wz-card-title" id={id ? `${id}-title` : undefined}>{title}</h3>}
                            {desc && <p className="wz-card-desc">{desc}</p>}
                        </div>
                    </div>
                    {actions && <div className="wz-card-actions">{actions}</div>}
                </div>
            )}
            {children}
        </section>
    );
}

/** Label + control + hint/error. */
export function Field({ label, htmlFor, hint, error, required, children, className = '' }) {
    return (
        <div className={`wz-field ${error ? 'wz-field--error' : ''} ${className}`}>
            {label && (
                <label className="wz-input-label" htmlFor={htmlFor}>
                    {label}{required && <span className="wz-required" aria-hidden="true"> *</span>}
                </label>
            )}
            {children}
            {error ? <span className="wz-field-error" role="alert">{error}</span> : hint ? <span className="wz-field-subtext">{hint}</span> : null}
        </div>
    );
}

/** Horizontal choice cards (platform, methodology, intensity). */
export function ChoiceGrid({ options, value, onChange, columns = 3, name, renderExtra }) {
    return (
        <div className="wz-choice-grid" style={{ '--wz-cols': columns }} role="radiogroup" aria-label={name}>
            {options.map((opt) => {
                const selected = value === opt.id;
                const Icon = opt.icon || null;
                return (
                    <button
                        key={opt.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={`wz-choice ${selected ? 'wz-choice--active' : ''} ${opt.disabled ? 'wz-choice--disabled' : ''}`}
                        onClick={() => !opt.disabled && onChange(opt.id)}
                        disabled={opt.disabled}
                        title={opt.disabled ? opt.disabledReason : undefined}
                    >
                        <span className="wz-choice__label">{Icon && <Icon size={15} aria-hidden="true" />}{opt.label}</span>
                        {(opt.blurb || opt.how) && <span className="wz-choice__blurb">{opt.disabled && opt.disabledReason ? opt.disabledReason : opt.blurb || opt.how}</span>}
                        {renderExtra && renderExtra(opt, selected)}
                    </button>
                );
            })}
        </div>
    );
}

/** Row of 2–4 numeric tiles. */
export function StatRow({ stats }) {
    return (
        <div className="wz-stats">
            {stats.map((s) => (
                <div key={s.label} className="wz-stat">
                    <span className="wz-stat__value">{s.value}</span>
                    <span className="wz-stat__label">{s.label}</span>
                    {s.note && <span className="wz-stat__note">{s.note}</span>}
                </div>
            ))}
        </div>
    );
}
