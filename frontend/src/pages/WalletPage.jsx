import { useState, useEffect, useRef } from 'react';
import {
    Wallet,
    CreditCard,
    PhoneCall,
    Bot,
    Zap,
    Sparkles,
    Clock,
    CheckCircle2,
    AlertCircle,
    Info,
    Phone,
    ShieldCheck,
    Layers,
    Loader2,
    RefreshCw
} from 'lucide-react';
import { apiFetch } from '../lib/apiFetch';
import { formatServerDateTime } from '../lib/dates';
import './WalletPage.css';

const QUICK_AMOUNTS = [100, 500, 1000, 2500, 5000];
const LOAD_ERROR = 'Could not load wallet telemetry. Please check server connection.';

const asNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

/** `₹3.00`, or an em dash while the value is unknown. */
const rupees = (value) => {
    const n = asNumber(value);
    return n === null ? '—' : `₹${n.toFixed(2)}`;
};

/** JS-style number (`3`, `0.25`, `179`) for "{n} Credits" labels; '—' when unknown. */
const plain = (value) => {
    const n = asNumber(value);
    return n === null ? '—' : String(n);
};

const Banner = ({ kind, children }) => {
    const palette = {
        success: { bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.3)', color: '#047857', Icon: CheckCircle2 },
        error: { bg: 'rgba(239, 68, 68, 0.1)', border: 'rgba(239, 68, 68, 0.3)', color: '#b91c1c', Icon: AlertCircle },
        info: { bg: 'var(--surface)', border: 'var(--border)', color: 'var(--text)', Icon: Info },
    }[kind];
    const { Icon } = palette;
    return (
        <div role={kind === 'error' ? 'alert' : 'status'} style={{
            padding: '0.85rem 1rem',
            background: palette.bg,
            border: `1px solid ${palette.border}`,
            borderRadius: '12px',
            color: palette.color,
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontWeight: 500
        }}>
            <Icon size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
            {children}
        </div>
    );
};

const WalletPage = ({ onBalanceUpdated }) => {
    // Nothing is shown as a rate until the backend has answered (it owns the prices).
    const [balanceData, setBalanceData] = useState(null);
    const [transactions, setTransactions] = useState([]);
    const [loaded, setLoaded] = useState(false);
    const [refreshing, setRefreshing] = useState(true);
    const [reloadKey, setReloadKey] = useState(0);
    const [loadError, setLoadError] = useState(null);
    const [topupAmount, setTopupAmount] = useState(500);
    const [customAmount, setCustomAmount] = useState('');
    const [processingTopup, setProcessingTopup] = useState(false);
    const [topupMessage, setTopupMessage] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);
    const [infoMessage, setInfoMessage] = useState(null);

    // Call cost estimator state (backend metering, cached per duration)
    const [calcDuration, setCalcDuration] = useState(120); // 2 minutes default
    const [estimates, setEstimates] = useState({});
    const [estimateError, setEstimateError] = useState(null);
    const [rentingNumber, setRentingNumber] = useState(false);

    const onBalanceUpdatedRef = useRef(onBalanceUpdated);
    useEffect(() => {
        onBalanceUpdatedRef.current = onBalanceUpdated;
    });

    // Wallet balance + rates and the transaction ledger (on mount and on Refresh / after a change).
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const [balance, ledger] = await Promise.allSettled([
                apiFetch('/api/wallet/balance'),
                apiFetch('/api/wallet/transactions?limit=25'),
            ]);
            if (cancelled) return;
            let failed = false;
            if (balance.status === 'fulfilled' && balance.value) {
                setBalanceData(balance.value);
                onBalanceUpdatedRef.current?.(asNumber(balance.value.credit_balance) ?? 0);
            } else if (balance.status === 'rejected') {
                failed = true;
            }
            if (ledger.status === 'fulfilled') {
                setTransactions(Array.isArray(ledger.value?.transactions) ? ledger.value.transactions : []);
            } else {
                failed = true;
            }
            setLoadError(failed ? LOAD_ERROR : null);
            setLoaded(true);
            setRefreshing(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [reloadKey]);

    const refresh = () => {
        setRefreshing(true);
        setReloadKey((k) => k + 1);
    };

    // Exact metering from the backend (`POST /api/wallet/estimate-call-cost`), debounced while sliding.
    useEffect(() => {
        if (estimates[calcDuration]) return undefined;
        let cancelled = false;
        const seconds = calcDuration;
        const timer = setTimeout(() => {
            apiFetch('/api/wallet/estimate-call-cost', { method: 'POST', body: { duration_seconds: seconds } })
                .then((data) => {
                    if (cancelled || !data) return;
                    setEstimates((prev) => ({ ...prev, [seconds]: data }));
                    setEstimateError(null);
                })
                .catch((err) => {
                    if (!cancelled) setEstimateError({ seconds, message: err?.message || 'Could not calculate this estimate.' });
                });
        }, 150);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [calcDuration, estimates]);

    const rates = balanceData?.rates || {};
    const creditBalance = asNumber(balanceData?.credit_balance);
    const isSuperuser = Boolean(balanceData?.is_superuser);
    const rentalRate = asNumber(rates.phone_rental_monthly);
    const rentalAvailable = balanceData ? balanceData.phone_rental_available !== false : false;

    // Handle Top-Up (superusers only; the backend refuses everyone else)
    const handleTopUp = async () => {
        const finalAmount = parseFloat(customAmount) || topupAmount;
        if (!finalAmount || finalAmount < 10) {
            setErrorMessage('Minimum top-up amount is ₹10.00 (10 Credits).');
            return;
        }

        try {
            setProcessingTopup(true);
            setErrorMessage(null);
            setTopupMessage(null);
            setInfoMessage(null);

            const data = await apiFetch('/api/wallet/topup', {
                method: 'POST',
                body: { amount: finalAmount, payment_method: 'razorpay_payg' },
            });

            const added = asNumber(data?.amount_added) ?? finalAmount;
            setTopupMessage(`Success! Added ${added} Credits (₹${added.toFixed(2)}) to your wallet.`);
            const newBalance = asNumber(data?.new_balance);
            if (newBalance !== null) {
                setBalanceData(prev => (prev ? { ...prev, credit_balance: newBalance } : prev));
                onBalanceUpdatedRef.current?.(newBalance);
            }
            setCustomAmount('');
            refresh();
        } catch (err) {
            setErrorMessage(err?.message || 'Payment processing error');
        } finally {
            setProcessingTopup(false);
        }
    };

    // Dedicated caller ID rental. The backend answers 501 (and never charges) until provisioning exists.
    const handleRentNumber = async () => {
        setErrorMessage(null);
        setTopupMessage(null);
        setInfoMessage(null);
        if (!rentalAvailable) {
            setInfoMessage("Number rental isn't available yet. You have not been charged; calls use the shared ClozFlow caller ID for now.");
            return;
        }
        // Superusers aren't limited by their real balance.
        if (!isSuperuser && rentalRate !== null && (creditBalance ?? 0) < rentalRate) {
            setErrorMessage(`Insufficient balance. You need at least ${plain(rentalRate)} Credits (${rupees(rentalRate)}) to rent a dedicated business phone number.`);
            return;
        }

        if (!window.confirm(`Rent a dedicated Indian business virtual number for 30 days at ${rupees(rentalRate)} (${plain(rentalRate)} Credits)?`)) {
            return;
        }

        try {
            setRentingNumber(true);
            const data = await apiFetch('/api/wallet/rent-phone-number', { method: 'POST' });
            setTopupMessage(data?.message || 'Dedicated virtual caller ID provisioned successfully.');
            const newBalance = asNumber(data?.new_balance);
            if (newBalance !== null) {
                setBalanceData(prev => (prev ? { ...prev, credit_balance: newBalance } : prev));
                onBalanceUpdatedRef.current?.(newBalance);
            }
            refresh();
        } catch (err) {
            if (err?.status === 501) {
                setInfoMessage(err.message);
                setBalanceData(prev => (prev ? { ...prev, phone_rental_available: false } : prev));
            } else {
                setErrorMessage(err?.message || 'Failed to rent phone number');
            }
        } finally {
            setRentingNumber(false);
        }
    };

    const est = estimates[calcDuration] || null;
    const estFailed = !est && estimateError?.seconds === calcDuration;

    return (
        <div className="wallet-page-wrap">
            {/* Header */}
            <div className="wallet-header">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <div>
                        <h1 className="wallet-title">Wallet & Usage Metering</h1>
                        <p className="wallet-subtitle">
                            Pay-as-you-go credit balance and live metered telephony consumption.
                            <strong> 1 INR = 1 Credit.</strong>
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={refresh}
                        disabled={refreshing}
                        style={{
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            padding: '0.5rem 0.85rem',
                            borderRadius: '10px',
                            cursor: refreshing ? 'wait' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            color: 'var(--text)'
                        }}
                    >
                        <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Notification Banners */}
            {topupMessage && <Banner kind="success">{topupMessage}</Banner>}
            {infoMessage && <Banner kind="info">{infoMessage}</Banner>}
            {errorMessage && <Banner kind="error">{errorMessage}</Banner>}
            {loadError && !errorMessage && <Banner kind="error">{loadError}</Banner>}

            {/* Top Grid: Balance & Top-up Card + Metering Rates Card */}
            <div className="wallet-grid">
                {/* Balance & Top Up */}
                <div className="wallet-card">
                    <div className="wallet-card-header">
                        <h2 className="wallet-card-title">
                            <Wallet size={18} color="var(--accent)" aria-hidden="true" />
                            Current Balance
                        </h2>
                        {isSuperuser ? (
                            <span className="wallet-superuser-badge">👑 Superuser / Unlimited Mode</span>
                        ) : (
                            <span className="wallet-badge-rule">⚡ 1 INR = 1 Credit</span>
                        )}
                    </div>

                    <div className="wallet-balance-row">
                        <span className="wallet-balance-num">
                            {isSuperuser ? 'Unlimited' : rupees(creditBalance)}
                        </span>
                        <span className="wallet-balance-unit">
                            {isSuperuser ? '(∞ Simulation Credits)' : `(${creditBalance === null ? '—' : creditBalance.toFixed(2)} Credits)`}
                        </span>
                    </div>

                    {isSuperuser ? (
                        <>
                            <div className="wallet-topup-label" id="wallet-topup-label">Superuser Simulation Top-Up</div>
                            <div className="wallet-chips-row" role="group" aria-labelledby="wallet-topup-label">
                                {QUICK_AMOUNTS.map(amt => (
                                    <button
                                        key={amt}
                                        type="button"
                                        aria-pressed={topupAmount === amt && !customAmount}
                                        className={`wallet-chip-btn ${topupAmount === amt && !customAmount ? 'active' : ''}`}
                                        onClick={() => {
                                            setTopupAmount(amt);
                                            setCustomAmount('');
                                        }}
                                    >
                                        +₹{amt}
                                    </button>
                                ))}
                            </div>

                            <div className="wallet-input-row">
                                <input
                                    type="number"
                                    placeholder="Custom Amount (₹)"
                                    aria-label="Custom top-up amount in rupees"
                                    className="wallet-input"
                                    value={customAmount}
                                    onChange={(e) => setCustomAmount(e.target.value)}
                                    min="10"
                                />
                                <button
                                    type="button"
                                    className="wallet-topup-submit-btn"
                                    onClick={handleTopUp}
                                    disabled={processingTopup}
                                >
                                    {processingTopup ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <CreditCard size={16} aria-hidden="true" />}
                                    {processingTopup ? 'Processing...' : `Simulate +₹${customAmount || topupAmount}`}
                                </button>
                            </div>
                        </>
                    ) : (
                        /* Normal Customer View: Coming Soon Upgrade Section */
                        <div className="wallet-coming-soon-card">
                            <div className="wallet-coming-soon-badge">
                                <Sparkles size={13} aria-hidden="true" /> COMING SOON
                            </div>
                            <h3 className="wallet-coming-soon-title">Payment Gateway & Credit Upgrade</h3>
                            <p className="wallet-coming-soon-text">
                                Automated online top-ups via UPI, Credit/Debit cards & NetBanking are launching soon. New customer accounts start with 0 credits.
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', width: '100%' }}>
                                <button type="button" className="wallet-coming-soon-btn" disabled>
                                    <CreditCard size={15} aria-hidden="true" /> Top-Up Credits (Coming Soon)
                                </button>
                                <span className="wallet-coming-soon-hint">
                                    Need early access credits for team pilot? Reach out to support.
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Metering Rates Card (values and units come from the backend's rates) */}
                <div className="wallet-card">
                    <div className="wallet-card-header">
                        <h2 className="wallet-card-title">
                            <Zap size={18} color="#f59e0b" aria-hidden="true" />
                            Usage Metering Rules
                        </h2>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Pay-as-you-go rates</span>
                    </div>

                    <div className="meter-rates-list">
                        <div className="meter-rate-item">
                            <div className="meter-rate-left">
                                <div className="meter-rate-icon-box" aria-hidden="true">
                                    <Bot size={18} />
                                </div>
                                <div>
                                    <h4 className="meter-rate-name">Agent Test Simulation</h4>
                                    <p className="meter-rate-desc">Deducted per browser simulation session</p>
                                </div>
                            </div>
                            <div className="meter-rate-cost">
                                <p className="meter-rate-val">{rupees(rates.test_simulation)}</p>
                                <p className="meter-rate-unit">{plain(rates.test_simulation)} Credits / test</p>
                            </div>
                        </div>

                        <div className="meter-rate-item">
                            <div className="meter-rate-left">
                                <div className="meter-rate-icon-box" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }} aria-hidden="true">
                                    <Sparkles size={18} />
                                </div>
                                <div>
                                    <h4 className="meter-rate-name">Pearl Voice AI Outbound</h4>
                                    <p className="meter-rate-desc">High-stakes psychological closing engine</p>
                                </div>
                            </div>
                            <div className="meter-rate-cost">
                                <p className="meter-rate-val">{rupees(rates.pearl_call_per_minute)}</p>
                                <p className="meter-rate-unit">{plain(rates.pearl_call_per_minute)} Credits / min · telephony included</p>
                            </div>
                        </div>

                        <div className="meter-rate-item">
                            <div className="meter-rate-left">
                                <div className="meter-rate-icon-box" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }} aria-hidden="true">
                                    <PhoneCall size={18} />
                                </div>
                                <div>
                                    <h4 className="meter-rate-name">Vobiz Telephony Usage</h4>
                                    <p className="meter-rate-desc">Carrier PSTN pulse (30 seconds / pulse)</p>
                                </div>
                            </div>
                            <div className="meter-rate-cost">
                                <p className="meter-rate-val">{rupees(rates.telephony_pulse_30s)}</p>
                                <p className="meter-rate-unit">{plain(rates.telephony_pulse_30s)} Credits / 30s pulse · part of the per-minute rate</p>
                            </div>
                        </div>

                        <div className="meter-rate-item">
                            <div className="meter-rate-left">
                                <div className="meter-rate-icon-box" style={{ background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6' }} aria-hidden="true">
                                    <Phone size={18} />
                                </div>
                                <div>
                                    <h4 className="meter-rate-name">Dedicated Number Rental</h4>
                                    <p className="meter-rate-desc">Dedicated virtual caller ID (monthly)</p>
                                </div>
                            </div>
                            <div className="meter-rate-cost">
                                <p className="meter-rate-val">{rupees(rentalRate)}</p>
                                <p className="meter-rate-unit">{balanceData && !rentalAvailable ? 'Not available yet' : `${plain(rentalRate)} Credits / month`}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Middle Grid: Live Call Meter Calculator & Number Rental */}
            <div className="wallet-middle-grid">
                {/* Live Meter Simulator */}
                <div className="wallet-card">
                    <div className="wallet-card-header">
                        <h2 className="wallet-card-title">
                            <Clock size={18} color="var(--accent)" aria-hidden="true" />
                            Call Meter Calculator
                        </h2>
                    </div>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', margin: '0 0 1rem 0' }}>
                        Preview exact credit burn for any outbound call duration:
                    </p>

                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.9rem', gap: '0.75rem' }}>
                            <label htmlFor="wallet-call-duration">Call Duration:</label>
                            <span style={{ color: 'var(--accent)' }}>{calcDuration} Seconds ({Math.floor(calcDuration / 60)}m {calcDuration % 60}s)</span>
                        </div>
                        <input
                            id="wallet-call-duration"
                            type="range"
                            min="30"
                            max="600"
                            step="30"
                            value={calcDuration}
                            onChange={(e) => setCalcDuration(parseInt(e.target.value, 10))}
                            aria-valuetext={`${Math.floor(calcDuration / 60)} minutes ${calcDuration % 60} seconds`}
                            style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
                        />
                    </div>

                    <div className="calc-result-box" aria-live="polite" style={{ opacity: est ? 1 : 0.6, transition: 'opacity 0.2s' }}>
                        {estFailed ? (
                            <div role="alert" style={{ fontSize: '0.85rem', color: '#b91c1c' }}>
                                Couldn&apos;t calculate this estimate: {estimateError.message}
                            </div>
                        ) : (
                            <>
                                <div className="calc-breakdown-row">
                                    <span>Pearl Voice AI:</span>
                                    <span>{est ? rupees(est.pearl_voice_cost) : '…'}</span>
                                </div>
                                <div className="calc-breakdown-row">
                                    <span>Vobiz Telephony ({est ? est.pulses : '…'} pulses @ {rupees(rates.telephony_pulse_30s)}/30s, included):</span>
                                    <span>{est ? rupees(est.telephony_cost) : '…'}</span>
                                </div>
                                <div className="calc-total-row">
                                    <span>Estimated Total Deduction:</span>
                                    <span>{est ? `${asNumber(est.total_credits)?.toFixed(2) ?? '—'} Credits (${rupees(est.total_credits)})` : '…'}</span>
                                </div>
                            </>
                        )}
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', margin: '0.75rem 0 0 0', lineHeight: 1.5 }}>
                        Calls are billed at {rupees(rates.pearl_call_per_minute)} / min all-inclusive (30-second minimum); telephony is part of that rate, not added on top.
                    </p>
                </div>

                {/* Virtual Number Provisioning */}
                <div className="wallet-card">
                    <div className="wallet-card-header">
                        <h2 className="wallet-card-title">
                            <Phone size={18} color="#8b5cf6" aria-hidden="true" />
                            Business Caller ID Rental
                        </h2>
                        <span className="wallet-badge-rule">{rupees(rentalRate)} / 30 Days{balanceData && !rentalAvailable ? ' · Coming soon' : ''}</span>
                    </div>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', margin: '0 0 1rem 0' }}>
                        Rent a dedicated Indian 10-digit virtual caller ID for your Pearl agents to maximize answer rates and prevent spam labeling.
                    </p>

                    <div style={{
                        padding: '1rem',
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: '12px',
                        marginBottom: '1rem'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                            <ShieldCheck size={16} color="#10b981" aria-hidden="true" />
                            <span>
                                {balanceData && !rentalAvailable
                                    ? 'Not available yet: calls use the shared ClozFlow caller ID, and you are never charged for a rental.'
                                    : 'Carrier verified with high delivery reputation'}
                            </span>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleRentNumber}
                        disabled={rentingNumber || !balanceData || !rentalAvailable}
                        style={{
                            width: '100%',
                            background: 'var(--surface)',
                            border: '1px solid var(--accent)',
                            color: 'var(--accent)',
                            padding: '0.75rem',
                            borderRadius: '10px',
                            fontWeight: 600,
                            cursor: rentingNumber || !balanceData || !rentalAvailable ? 'not-allowed' : 'pointer',
                            opacity: !balanceData || !rentalAvailable ? 0.55 : 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.5rem',
                            transition: 'all 0.2s'
                        }}
                    >
                        {rentingNumber ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <PhoneCall size={16} aria-hidden="true" />}
                        {rentingNumber
                            ? 'Provisioning Number...'
                            : balanceData && !rentalAvailable
                                ? 'Number Rental Not Available Yet'
                                : `Rent Business Number (${rupees(rentalRate)} / Month)`}
                    </button>
                </div>
            </div>

            {/* Transaction Ledger Table */}
            <div className="wallet-ledger-card">
                <div className="wallet-card-header" style={{ marginBottom: '0.5rem' }}>
                    <h2 className="wallet-card-title">
                        <Layers size={18} color="var(--accent)" aria-hidden="true" />
                        Credit Transaction Ledger
                    </h2>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                        {transactions.length} Recent Transactions
                    </span>
                </div>

                <div className="wallet-table-wrap">
                    {!loaded ? (
                        <div role="status" aria-label="Loading transactions" style={{ textAlign: 'center', padding: '2rem' }}>
                            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent)' }} aria-hidden="true" />
                        </div>
                    ) : transactions.length === 0 ? (
                        <div className="wallet-empty-state">
                            <p>No credit transactions recorded yet.</p>
                            <span style={{ fontSize: '0.85rem' }}>New users start at 0 credits. Top up above to run your first simulation!</span>
                        </div>
                    ) : (
                        <table className="wallet-table">
                            <thead>
                                <tr>
                                    <th scope="col">Date</th>
                                    <th scope="col">Type</th>
                                    <th scope="col">Description</th>
                                    <th scope="col" style={{ textAlign: 'right' }}>Amount</th>
                                    <th scope="col" style={{ textAlign: 'right' }}>Balance After</th>
                                </tr>
                            </thead>
                            <tbody>
                                {transactions.map((t, idx) => {
                                    const amount = asNumber(t.amount) ?? 0;
                                    const isPositive = amount > 0;
                                    return (
                                        <tr key={t.id ?? idx}>
                                            <td style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>{formatServerDateTime(t.created_at, 'Just now')}</td>
                                            <td>
                                                <span style={{
                                                    fontSize: '0.75rem',
                                                    fontWeight: 600,
                                                    textTransform: 'uppercase',
                                                    padding: '0.2rem 0.5rem',
                                                    borderRadius: '6px',
                                                    background: isPositive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                                    color: isPositive ? '#047857' : '#b91c1c'
                                                }}>
                                                    {t.type || 'adjustment'}
                                                </span>
                                            </td>
                                            <td style={{ fontWeight: 500 }}>{t.description || 'System Transaction'}</td>
                                            <td style={{ textAlign: 'right' }} className={isPositive ? 'wallet-amount-pos' : 'wallet-amount-neg'}>
                                                {isPositive ? `+₹${amount.toFixed(2)}` : `-₹${Math.abs(amount).toFixed(2)}`}
                                            </td>
                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                                {rupees(t.balance_after)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

export default WalletPage;
