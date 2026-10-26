import React, { useState, useEffect } from 'react';
import { 
    Wallet, 
    CreditCard, 
    PhoneCall, 
    Bot, 
    Zap, 
    Sparkles, 
    Clock, 
    ArrowUpRight, 
    CheckCircle2, 
    AlertCircle, 
    Phone, 
    ShieldCheck, 
    Layers, 
    Loader2,
    RefreshCw
} from 'lucide-react';
import './WalletPage.css';

const QUICK_AMOUNTS = [100, 500, 1000, 2500, 5000];

const WalletPage = ({ onBalanceUpdated }) => {
    const [balanceData, setBalanceData] = useState({
        credit_balance: 0.0,
        currency: 'INR',
        conversion_rule: '1 INR = 1 Credit',
        rates: {
            test_simulation: 2.0,
            pearl_call_per_minute: 2.5,
            telephony_pulse_30s: 0.2,
            phone_rental_monthly: 199.0
        }
    });
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [topupAmount, setTopupAmount] = useState(500);
    const [customAmount, setCustomAmount] = useState('');
    const [processingTopup, setProcessingTopup] = useState(false);
    const [topupMessage, setTopupMessage] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);

    // Call cost estimator state
    const [calcDuration, setCalcDuration] = useState(120); // 2 minutes default
    const [rentingNumber, setRentingNumber] = useState(false);

    const token = localStorage.getItem('token');
    const apiBase = window.APP_API_BASE || '';

    // Fetch Wallet Balance & Transaction Ledger
    const fetchWalletData = async () => {
        try {
            setLoading(true);
            setErrorMessage(null);

            // 1. Balance
            const balRes = await fetch(`${apiBase}/api/wallet/balance`, {
                headers: { Authorization: token ? `Bearer ${token}` : '' }
            });
            if (balRes.ok) {
                const balJson = await balRes.json();
                setBalanceData(balJson);
                if (onBalanceUpdated) onBalanceUpdated(balJson.credit_balance);
            }

            // 2. Transactions
            const txnRes = await fetch(`${apiBase}/api/wallet/transactions?limit=25`, {
                headers: { Authorization: token ? `Bearer ${token}` : '' }
            });
            if (txnRes.ok) {
                const txnJson = await txnRes.json();
                setTransactions(txnJson.transactions || []);
            }
        } catch (err) {
            console.error('Failed to load wallet data:', err);
            setErrorMessage('Could not load wallet telemetry. Please check server connection.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchWalletData();
    }, []);

    // Handle Top-Up
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

            const res = await fetch(`${apiBase}/api/wallet/topup`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({
                    amount: finalAmount,
                    payment_method: 'razorpay_payg'
                })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Top-up failed');
            }

            const data = await res.json();
            setTopupMessage(`Success! Added ${data.amount_added} Credits (₹${data.amount_added.toFixed(2)}) to your wallet.`);
            setBalanceData(prev => ({ ...prev, credit_balance: data.new_balance }));
            if (onBalanceUpdated) onBalanceUpdated(data.new_balance);
            setCustomAmount('');
            fetchWalletData();
        } catch (err) {
            setErrorMessage(err.message || 'Payment processing error');
        } finally {
            setProcessingTopup(false);
        }
    };

    // Handle Phone Number Rental (199 Rs / 199 Credits)
    const handleRentNumber = async () => {
        if (balanceData.credit_balance < 199) {
            setErrorMessage('Insufficient balance. You need at least 199 Credits (₹199.00) to rent a dedicated business phone number.');
            return;
        }

        if (!window.confirm('Rent a dedicated Indian business virtual number for 30 days at ₹199.00 (199 Credits)?')) {
            return;
        }

        try {
            setRentingNumber(true);
            setErrorMessage(null);
            const res = await fetch(`${apiBase}/api/wallet/rent-phone-number`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: token ? `Bearer ${token}` : ''
                }
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Failed to rent phone number');
            }

            const data = await res.json();
            setTopupMessage(data.message || 'Dedicated virtual caller ID provisioned successfully.');
            setBalanceData(prev => ({ ...prev, credit_balance: data.new_balance }));
            if (onBalanceUpdated) onBalanceUpdated(data.new_balance);
            fetchWalletData();
        } catch (err) {
            setErrorMessage(err.message);
        } finally {
            setRentingNumber(false);
        }
    };

    // Calculate real-time estimated call breakdown
    const estimateCallCost = (seconds) => {
        const pearlCost = (seconds / 60.0) * (balanceData.rates?.pearl_call_per_minute || 2.5);
        const pulses = Math.ceil(seconds / 30.0);
        const telephonyCost = pulses * (balanceData.rates?.telephony_pulse_30s || 0.2);
        const total = pearlCost + telephonyCost;
        return {
            pearlCost: pearlCost.toFixed(2),
            pulses,
            telephonyCost: telephonyCost.toFixed(2),
            total: total.toFixed(2)
        };
    };

    const est = estimateCallCost(calcDuration);

    return (
        <div className="wallet-page-wrap">
            {/* Header */}
            <div className="wallet-header">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h1 className="wallet-title">Wallet & Usage Metering</h1>
                        <p className="wallet-subtitle">
                            Pay-as-you-go credit balance and live metered telephony consumption. 
                            <strong> 1 INR = 1 Credit.</strong>
                        </p>
                    </div>
                    <button 
                        onClick={fetchWalletData} 
                        disabled={loading}
                        style={{
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            padding: '0.5rem 0.85rem',
                            borderRadius: '10px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            color: 'var(--text)'
                        }}
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Notification Banners */}
            {topupMessage && (
                <div style={{
                    padding: '0.85rem 1rem',
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    borderRadius: '12px',
                    color: '#059669',
                    marginBottom: '1.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontWeight: 500
                }}>
                    <CheckCircle2 size={18} />
                    {topupMessage}
                </div>
            )}

            {errorMessage && (
                <div style={{
                    padding: '0.85rem 1rem',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '12px',
                    color: '#dc2626',
                    marginBottom: '1.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontWeight: 500
                }}>
                    <AlertCircle size={18} />
                    {errorMessage}
                </div>
            )}

            {/* Top Grid: Balance & Top-up Card + Metering Rates Card */}
            <div className="wallet-grid">
                {/* Balance & Top Up */}
                <div className="wallet-card">
                    <div className="wallet-card-header">
                        <h2 className="wallet-card-title">
                            <Wallet size={18} color="var(--accent)" />
                            Current Balance
                        </h2>
                        {balanceData.is_superuser ? (
                            <span className="wallet-superuser-badge">👑 Superuser / Unlimited Mode</span>
                        ) : (
                            <span className="wallet-badge-rule">⚡ 1 INR = 1 Credit</span>
                        )}
                    </div>

                    <div className="wallet-balance-row">
                        <span className="wallet-balance-num">
                            {balanceData.is_superuser ? 'Unlimited' : `₹${balanceData.credit_balance.toFixed(2)}`}
                        </span>
                        <span className="wallet-balance-unit">
                            {balanceData.is_superuser ? '(∞ Simulation Credits)' : `(${balanceData.credit_balance.toFixed(2)} Credits)`}
                        </span>
                    </div>

                    {balanceData.is_superuser ? (
                        <>
                            <div className="wallet-topup-label">Superuser Simulation Top-Up</div>
                            <div className="wallet-chips-row">
                                {QUICK_AMOUNTS.map(amt => (
                                    <button
                                        key={amt}
                                        type="button"
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
                                    {processingTopup ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}
                                    {processingTopup ? 'Processing...' : `Simulate +₹${customAmount || topupAmount}`}
                                </button>
                            </div>
                        </>
                    ) : (
                        /* Normal Customer View: Coming Soon Upgrade Section */
                        <div className="wallet-coming-soon-card">
                            <div className="wallet-coming-soon-badge">
                                <Sparkles size={13} /> COMING SOON
                            </div>
                            <h3 className="wallet-coming-soon-title">Payment Gateway & Credit Upgrade</h3>
                            <p className="wallet-coming-soon-text">
                                Automated online top-ups via UPI, Credit/Debit cards & NetBanking are launching soon. New customer accounts start with 0 credits.
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', width: '100%' }}>
                                <button type="button" className="wallet-coming-soon-btn" disabled>
                                    <CreditCard size={15} /> Top-Up Credits (Coming Soon)
                                </button>
                                <span className="wallet-coming-soon-hint">
                                    Need early access credits for team pilot? Reach out to support.
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Metering Rates Card */}
                <div className="wallet-card">
                    <div className="wallet-card-header">
                        <h2 className="wallet-card-title">
                            <Zap size={18} color="#f59e0b" />
                            Usage Metering Rules
                        </h2>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Business Tier</span>
                    </div>

                    <div className="meter-rates-list">
                        <div className="meter-rate-item">
                            <div className="meter-rate-left">
                                <div className="meter-rate-icon-box">
                                    <Bot size={18} />
                                </div>
                                <div>
                                    <h4 className="meter-rate-name">Agent Test Simulation</h4>
                                    <p className="meter-rate-desc">Deducted per browser simulation session</p>
                                </div>
                            </div>
                            <div className="meter-rate-cost">
                                <p className="meter-rate-val">₹{balanceData.rates?.test_simulation?.toFixed(2) || '2.00'}</p>
                                <p className="meter-rate-unit">2 Credits / test</p>
                            </div>
                        </div>

                        <div className="meter-rate-item">
                            <div className="meter-rate-left">
                                <div className="meter-rate-icon-box" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                                    <Sparkles size={18} />
                                </div>
                                <div>
                                    <h4 className="meter-rate-name">Pearl Voice AI Outbound</h4>
                                    <p className="meter-rate-desc">High-stakes psychological closing engine</p>
                                </div>
                            </div>
                            <div className="meter-rate-cost">
                                <p className="meter-rate-val">₹{balanceData.rates?.pearl_call_per_minute?.toFixed(2) || '2.50'}</p>
                                <p className="meter-rate-unit">2.5 Credits / min</p>
                            </div>
                        </div>

                        <div className="meter-rate-item">
                            <div className="meter-rate-left">
                                <div className="meter-rate-icon-box" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>
                                    <PhoneCall size={18} />
                                </div>
                                <div>
                                    <h4 className="meter-rate-name">Vobiz Telephony Usage</h4>
                                    <p className="meter-rate-desc">Carrier PSTN pulse (30 seconds / pulse)</p>
                                </div>
                            </div>
                            <div className="meter-rate-cost">
                                <p className="meter-rate-val">₹{balanceData.rates?.telephony_pulse_30s?.toFixed(2) || '0.20'}</p>
                                <p className="meter-rate-unit">0.2 Credits / 30s pulse</p>
                            </div>
                        </div>

                        <div className="meter-rate-item">
                            <div className="meter-rate-left">
                                <div className="meter-rate-icon-box" style={{ background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6' }}>
                                    <Phone size={18} />
                                </div>
                                <div>
                                    <h4 className="meter-rate-name">Dedicated Number Rental</h4>
                                    <p className="meter-rate-desc">Dedicated virtual caller ID (monthly)</p>
                                </div>
                            </div>
                            <div className="meter-rate-cost">
                                <p className="meter-rate-val">₹{balanceData.rates?.phone_rental_monthly?.toFixed(2) || '199.00'}</p>
                                <p className="meter-rate-unit">199 Credits / month</p>
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
                            <Clock size={18} color="var(--accent)" />
                            Call Meter Calculator
                        </h2>
                    </div>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 1rem 0' }}>
                        Preview exact credit burn for any outbound call duration:
                    </p>

                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.9rem' }}>
                            <span>Call Duration:</span>
                            <span style={{ color: 'var(--accent)' }}>{calcDuration} Seconds ({Math.floor(calcDuration / 60)}m {calcDuration % 60}s)</span>
                        </div>
                        <input
                            type="range"
                            min="30"
                            max="600"
                            step="30"
                            value={calcDuration}
                            onChange={(e) => setCalcDuration(parseInt(e.target.value))}
                            style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
                        />
                    </div>

                    <div className="calc-result-box">
                        <div className="calc-breakdown-row">
                            <span>Pearl Voice AI (₹2.50/min):</span>
                            <span>₹{est.pearlCost}</span>
                        </div>
                        <div className="calc-breakdown-row">
                            <span>Vobiz Telephony ({est.pulses} pulses @ ₹0.20/30s):</span>
                            <span>₹{est.telephonyCost}</span>
                        </div>
                        <div className="calc-total-row">
                            <span>Estimated Total Deduction:</span>
                            <span>{est.total} Credits (₹{est.total})</span>
                        </div>
                    </div>
                </div>

                {/* Virtual Number Provisioning */}
                <div className="wallet-card">
                    <div className="wallet-card-header">
                        <h2 className="wallet-card-title">
                            <Phone size={18} color="#8b5cf6" />
                            Business Caller ID Rental
                        </h2>
                        <span className="wallet-badge-rule">₹199 / 30 Days</span>
                    </div>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 1rem 0' }}>
                        Rent a dedicated Indian 10-digit virtual caller ID for your Pearl agents to maximize answer rates and prevent spam labeling.
                    </p>

                    <div style={{
                        padding: '1rem',
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: '12px',
                        marginBottom: '1rem'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            <ShieldCheck size={16} color="#10b981" />
                            <span>Carrier verified with high delivery reputation</span>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleRentNumber}
                        disabled={rentingNumber}
                        style={{
                            width: '100%',
                            background: 'var(--surface)',
                            border: '1px solid var(--accent)',
                            color: 'var(--accent)',
                            padding: '0.75rem',
                            borderRadius: '10px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.5rem',
                            transition: 'all 0.2s'
                        }}
                    >
                        {rentingNumber ? <Loader2 size={16} className="animate-spin" /> : <PhoneCall size={16} />}
                        {rentingNumber ? 'Provisioning Number...' : 'Rent Business Number (₹199 / Month)'}
                    </button>
                </div>
            </div>

            {/* Transaction Ledger Table */}
            <div className="wallet-ledger-card">
                <div className="wallet-card-header" style={{ marginBottom: '0.5rem' }}>
                    <h2 className="wallet-card-title">
                        <Layers size={18} color="var(--accent)" />
                        Credit Transaction Ledger
                    </h2>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {transactions.length} Recent Transactions
                    </span>
                </div>

                <div className="wallet-table-wrap">
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '2rem' }}>
                            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent)' }} />
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
                                    <th>Date</th>
                                    <th>Type</th>
                                    <th>Description</th>
                                    <th style={{ textAlign: 'right' }}>Amount</th>
                                    <th style={{ textAlign: 'right' }}>Balance After</th>
                                </tr>
                            </thead>
                            <tbody>
                                {transactions.map((t) => {
                                    const isPositive = t.amount > 0;
                                    const dateStr = t.created_at ? new Date(t.created_at).toLocaleString() : 'Just now';
                                    return (
                                        <tr key={t.id}>
                                            <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{dateStr}</td>
                                            <td>
                                                <span style={{
                                                    fontSize: '0.75rem',
                                                    fontWeight: 600,
                                                    textTransform: 'uppercase',
                                                    padding: '0.2rem 0.5rem',
                                                    borderRadius: '6px',
                                                    background: isPositive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                                    color: isPositive ? '#10b981' : '#ef4444'
                                                }}>
                                                    {t.type}
                                                </span>
                                            </td>
                                            <td style={{ fontWeight: 500 }}>{t.description || 'System Transaction'}</td>
                                            <td style={{ textAlign: 'right' }} className={isPositive ? 'wallet-amount-pos' : 'wallet-amount-neg'}>
                                                {isPositive ? `+₹${t.amount.toFixed(2)}` : `-₹${Math.abs(t.amount).toFixed(2)}`}
                                            </td>
                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                                ₹{t.balance_after.toFixed(2)}
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
