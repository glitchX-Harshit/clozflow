import React, { useEffect, useRef, useState } from 'react';
import { X, ArrowRight, Check, Copy, Mail, PhoneCall, ShieldCheck, Info } from 'lucide-react';
import { useBackdropDismiss, useDialogA11y } from '../lib/a11y';
import {
  BYOC_CARRIERS, OTHER_CARRIER_ID, SUPPORT_EMAIL, buildByocRequest, findCarrier, validateByocRequest
} from '../lib/telephonyCarriers';
import { copyToClipboard } from '../lib/subsectionCode';
import './ConnectProviderModal.css';

/*
 * Bring-your-own-carrier: there is no backend that stores or verifies customer
 * trunks — Pearl dials through ClozFlow's own Vobiz / Exotel accounts. This dialog
 * therefore collects no credentials and never reports a connection; it prepares a
 * setup request for the ClozFlow team (e-mail or copy).
 */

const STEPS = [
  { n: 1, label: 'Carrier' },
  { n: 2, label: 'Details' },
  { n: 3, label: 'Send request' }
];

const ByocRequestDialog = ({ onClose, defaultOrgName, contactEmail }) => {
  const [step, setStep] = useState(1);
  const [carrierId, setCarrierId] = useState('');
  const [otherCarrierName, setOtherCarrierName] = useState('');
  const [orgName, setOrgName] = useState(defaultOrgName || '');
  const [email, setEmail] = useState(contactEmail || '');
  const [monthlyMinutes, setMonthlyMinutes] = useState('');
  const [existingNumbers, setExistingNumbers] = useState('');
  const [notes, setNotes] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [copyState, setCopyState] = useState(null); // 'copied' | 'failed' | null
  const [mailOpened, setMailOpened] = useState(false);
  const copyTimerRef = useRef(null);

  const { ref, dialogProps } = useDialogA11y(true, onClose);
  const backdrop = useBackdropDismiss(onClose);

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  const fields = { carrierId, otherCarrierName, orgName, contactEmail: email, monthlyMinutes, existingNumbers, notes };
  const errors = validateByocRequest(fields);
  const carrierChosen = !errors.carrierId && !errors.otherCarrierName;
  const detailsValid = carrierChosen && !errors.contactEmail;
  const maxStep = !carrierChosen ? 1 : (!detailsValid ? 2 : 3);
  const request = buildByocRequest(fields);
  const carrier = findCarrier(carrierId);
  const accent = carrier?.accentColor || '#475569';

  const goTo = (n) => {
    if (n <= maxStep) setStep(n);
  };

  const handleNext = () => {
    if (step === 1 && carrierChosen) {
      setStep(2);
    } else if (step === 2) {
      setShowErrors(true);
      if (detailsValid) setStep(3);
    }
  };

  const handleCopy = async () => {
    const ok = await copyToClipboard(`To: ${SUPPORT_EMAIL}\nSubject: ${request.subject}\n\n${request.body}`);
    setCopyState(ok ? 'copied' : 'failed');
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopyState(null), 2500);
  };

  const chooseCarrier = (id) => {
    setCarrierId(id);
    setMailOpened(false);
  };

  return (
    <div className="cz-trunk-overlay" {...backdrop}>
      <div className="cz-trunk-modal animate-cz-pop" ref={ref} {...dialogProps} aria-labelledby="cz-byoc-title">
        {/* Top bar */}
        <div className="cz-modal-topbar">
          <div className="cz-topbar-left">
            <span className="cz-pulse-badge">Bring your own carrier</span>
            {orgName.trim() && <span className="cz-topbar-org">{orgName.trim()}</span>}
          </div>
          <button type="button" className="cz-close-btn" onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="cz-wizard-body">
          <div className="cz-byoc-intro">
            <h2 className="cz-hero-headline" id="cz-byoc-title">Use your own telephony account</h2>
            <p className="cz-hero-description">
              Self-serve carrier connections aren&apos;t available yet. Tell us which carrier you use and our team will
              help you set Pearl up on it. Until then, Pearl calls go out on ClozFlow&apos;s own Vobiz and Exotel lines.
            </p>
          </div>

          {/* Stepper (a step opens only once the previous one is complete) */}
          <div className="cz-pipeline-stepper" role="list" aria-label="Request steps">
            {STEPS.map((s, i) => (
              <React.Fragment key={s.n}>
                {i > 0 && <div className="cz-stepper-connector" aria-hidden="true" />}
                <div role="listitem">
                  <button
                    type="button"
                    className={`cz-stepper-item ${step === s.n ? 'is-current' : ''} ${step > s.n ? 'is-done' : ''}`}
                    onClick={() => goTo(s.n)}
                    disabled={s.n > maxStep}
                    aria-current={step === s.n ? 'step' : undefined}
                  >
                    <div className="cz-stepper-pill-num" aria-hidden="true">
                      {step > s.n ? <Check size={11} strokeWidth={3} /> : s.n}
                    </div>
                    <span className="cz-stepper-label">{s.label}</span>
                  </button>
                </div>
              </React.Fragment>
            ))}
          </div>

          {/* ── STEP 1: choose carrier ── */}
          {step === 1 && (
            <div className="cz-tab-view animate-cz-fade">
              <div>
                <h4 className="cz-tab-title">Which carrier do you use?</h4>
                <p className="cz-tab-sub">Pearl&apos;s dialer can place calls through these carriers.</p>
              </div>

              <div className="cz-options-container" role="group" aria-label="Carrier">
                {[...BYOC_CARRIERS, { id: OTHER_CARRIER_ID, name: 'Another carrier', tagline: 'Tell us which one — we’ll let you know if it can be supported', accentColor: '#475569' }].map((c) => {
                  const selected = carrierId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={selected}
                      className={`cz-carrier-option ${selected ? 'is-selected' : ''}`}
                      onClick={() => chooseCarrier(c.id)}
                    >
                      <span className="cz-option-left">
                        <span
                          className="cz-carrier-badge-icon"
                          aria-hidden="true"
                          style={{ backgroundColor: `${c.accentColor}14`, color: c.accentColor, borderColor: `${c.accentColor}28` }}
                        >
                          {c.id === OTHER_CARRIER_ID ? <PhoneCall size={14} /> : c.name.slice(0, 2).toUpperCase()}
                        </span>
                        <span className="cz-option-info">
                          <span className="cz-option-name">{c.name}</span>
                          <span className="cz-option-tagline">{c.tagline}</span>
                        </span>
                      </span>
                      {selected ? <Check size={15} className="cz-option-check" aria-hidden="true" /> : <ArrowRight size={14} className="cz-option-arrow" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>

              {carrierId === OTHER_CARRIER_ID && (
                <div className="cz-field-item">
                  <label className="cz-form-label" htmlFor="cz-other-carrier">Carrier name</label>
                  <input
                    id="cz-other-carrier"
                    type="text"
                    className="cz-form-input"
                    value={otherCarrierName}
                    onChange={(e) => setOtherCarrierName(e.target.value)}
                    placeholder="e.g. Tata Smartflo"
                    data-autofocus
                  />
                </div>
              )}

              <div className="cz-benefits-grid">
                <div className="cz-benefit-card">
                  <div className="cz-benefit-icon-wrap"><ShieldCheck size={16} className="text-blue" aria-hidden="true" /></div>
                  <div>
                    <h4 className="cz-benefit-title">No credentials here</h4>
                    <p className="cz-benefit-desc">This form never asks for API keys or passwords. Our team will set up the connection with you.</p>
                  </div>
                </div>
                <div className="cz-benefit-card">
                  <div className="cz-benefit-icon-wrap"><Info size={16} className="text-amber" aria-hidden="true" /></div>
                  <div>
                    <h4 className="cz-benefit-title">Nothing changes yet</h4>
                    <p className="cz-benefit-desc">Your agents keep calling through ClozFlow&apos;s lines until your carrier is set up.</p>
                  </div>
                </div>
              </div>

              <div className="cz-wizard-actions">
                <button type="button" className="cz-btn-secondary" onClick={onClose}>Cancel</button>
                <button type="button" className="cz-btn-primary" disabled={!carrierChosen} onClick={handleNext}>
                  <span>Continue</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: details ── */}
          {step === 2 && (
            <div className="cz-tab-view animate-cz-fade">
              <div>
                <h4 className="cz-tab-title">How can we reach you?</h4>
                <p className="cz-tab-sub">Don&apos;t include passwords or API keys — we&apos;ll share a secure way to connect your account.</p>
              </div>

              <div className="cz-form-grid">
                <div className="cz-field-item">
                  <label className="cz-form-label" htmlFor="cz-byoc-email">Contact e-mail</label>
                  <input
                    id="cz-byoc-email"
                    type="email"
                    className="cz-form-input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={showErrors && Boolean(errors.contactEmail)}
                    aria-describedby={showErrors && errors.contactEmail ? 'cz-byoc-email-error' : undefined}
                    autoComplete="email"
                    data-autofocus
                  />
                  {showErrors && errors.contactEmail && (
                    <span className="cz-field-error" id="cz-byoc-email-error">{errors.contactEmail}</span>
                  )}
                </div>

                <div className="cz-field-item">
                  <label className="cz-form-label" htmlFor="cz-byoc-org">Organisation <span className="cz-optional">(optional)</span></label>
                  <input
                    id="cz-byoc-org"
                    type="text"
                    className="cz-form-input"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    autoComplete="organization"
                  />
                </div>

                <div className="cz-field-item">
                  <label className="cz-form-label" htmlFor="cz-byoc-minutes">Expected call minutes per month <span className="cz-optional">(optional)</span></label>
                  <input
                    id="cz-byoc-minutes"
                    type="text"
                    inputMode="numeric"
                    className="cz-form-input"
                    value={monthlyMinutes}
                    onChange={(e) => setMonthlyMinutes(e.target.value)}
                    placeholder="e.g. 5000"
                  />
                </div>

                <div className="cz-field-item">
                  <label className="cz-form-label" htmlFor="cz-byoc-numbers">Phone numbers you want Pearl to call from <span className="cz-optional">(optional)</span></label>
                  <input
                    id="cz-byoc-numbers"
                    type="text"
                    className="cz-form-input"
                    value={existingNumbers}
                    onChange={(e) => setExistingNumbers(e.target.value)}
                    placeholder="e.g. 2 numbers on my carrier account"
                  />
                </div>

                <div className="cz-field-item">
                  <label className="cz-form-label" htmlFor="cz-byoc-notes">Anything else? <span className="cz-optional">(optional)</span></label>
                  <textarea
                    id="cz-byoc-notes"
                    className="cz-form-input is-textarea"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>

              <div className="cz-wizard-actions">
                <button type="button" className="cz-btn-secondary" onClick={() => setStep(1)}>Back</button>
                <button type="button" className="cz-btn-primary" onClick={handleNext}>
                  <span>Review request</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3: send ── */}
          {step === 3 && (
            <div className="cz-tab-view animate-cz-fade">
              <div>
                <h4 className="cz-tab-title">Send the request to our team</h4>
                <p className="cz-tab-sub">
                  We&apos;ll reply to <strong>{email.trim()}</strong>. Nothing is connected until your carrier has been set up with you.
                </p>
              </div>

              <div className="cz-connection-summary-card">
                <div className="cz-summary-line">
                  <span className="cz-sum-label">Carrier</span>
                  <strong className="cz-sum-value" style={{ color: accent }}>{request.carrier}</strong>
                </div>
                {orgName.trim() && (
                  <div className="cz-summary-line">
                    <span className="cz-sum-label">Organisation</span>
                    <strong className="cz-sum-value">{orgName.trim()}</strong>
                  </div>
                )}
                <div className="cz-summary-line">
                  <span className="cz-sum-label">Contact</span>
                  <strong className="cz-sum-value">{email.trim()}</strong>
                </div>
                {monthlyMinutes.trim() && (
                  <div className="cz-summary-line">
                    <span className="cz-sum-label">Minutes / month</span>
                    <strong className="cz-sum-value">{monthlyMinutes.trim()}</strong>
                  </div>
                )}
                {existingNumbers.trim() && (
                  <div className="cz-summary-line">
                    <span className="cz-sum-label">Numbers</span>
                    <strong className="cz-sum-value">{existingNumbers.trim()}</strong>
                  </div>
                )}
                <div className="cz-summary-line">
                  <span className="cz-sum-label">Status</span>
                  <span className="cz-request-status">Not sent yet</span>
                </div>
              </div>

              {mailOpened && (
                <div className="cz-guard-callout" role="status">
                  <div className="cz-guard-icon-col"><Info size={16} aria-hidden="true" /></div>
                  <div className="cz-guard-body">
                    <h5 className="cz-guard-title">Finish sending it from your e-mail app</h5>
                    <p className="cz-guard-text">
                      Your e-mail app should have opened with the request. If it didn&apos;t, copy the request and send it to {SUPPORT_EMAIL}.
                    </p>
                  </div>
                </div>
              )}

              <div className="cz-wizard-actions">
                <button type="button" className="cz-btn-secondary" onClick={() => setStep(2)}>Back</button>
                <button type="button" className="cz-btn-secondary cz-btn-with-icon" onClick={handleCopy}>
                  {copyState === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  <span aria-live="polite">
                    {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy request'}
                  </span>
                </button>
                <a className="cz-btn-primary" href={request.mailto} onClick={() => setMailOpened(true)}>
                  <Mail size={14} aria-hidden="true" />
                  <span>E-mail our team</span>
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * @param {{ isOpen: boolean, onClose: () => void, defaultOrgName?: string, contactEmail?: string }} props
 * The dialog body mounts fresh on every open, so no state leaks between requests.
 */
export const ConnectProviderModal = ({ isOpen, onClose, defaultOrgName = '', contactEmail = '' }) => {
  if (!isOpen) return null;
  return <ByocRequestDialog onClose={onClose} defaultOrgName={defaultOrgName} contactEmail={contactEmail} />;
};

export default ConnectProviderModal;
