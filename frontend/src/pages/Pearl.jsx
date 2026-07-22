import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
    Sparkle, ArrowRight, ChevronLeft, Check, MapPin, Users, Building2, 
    Mail, Clock, Shield, Zap, MessageSquare, Globe, Instagram, Phone, 
    Star, AlertCircle, TrendingUp, Search, ChevronDown, Sliders,
    Smartphone, QrCode, Wifi, WifiOff, RefreshCw, X, BarChart3
} from 'lucide-react';
import './Pearl.css';

const API_BASE = 'http://localhost:8000';
const WS_BASE = 'ws://localhost:8000';

const STAGES = [
    'Planning',
    'Geographic Expansion',
    'Lead Discovery',
    'Qualification',
    'AI Verification',
    'Lead Enrichment',
    'Personalization',
    'Outreach',
    'Conversation',
    'Follow-up',
    'CRM Sync',
    'Reporting'
];

const STAGE_DESCRIPTIONS = [
    'Analyzing mission parameters and planning execution strategy',
    'Dividing target region into localities and neighborhoods',
    'Searching Google Maps, directories, and business listings',
    'Applying qualification rules to filter leads',
    'Verifying business activity, websites, and social presence',
    'Enriching leads with owner info, emails, and phone numbers',
    'Generating personalized outreach messages for each lead',
    'Sending messages via configured channels',
    'Managing replies and qualifying interested prospects',
    'Scheduling and executing follow-up sequences',
    'Syncing qualified leads to CRM pipeline',
    'Compiling mission report and analytics'
];

const TEMPLATES = [
    'Find businesses without websites',
    'Find local businesses with poor reviews',
    'Find SaaS founders hiring SDRs',
    'Find agencies with inactive Instagram',
    'Find restaurants without online booking',
    'Find businesses with outdated branding',
    'Find high-ticket consultants',
    'Find dentists with no CRM'
];

const ACTIVITY_UPDATES = [
    { text: 'Mission started — analyzing parameters', type: 'accent' },
    { text: 'Target region: expanding into sub-localities', type: 'default' },
    { text: 'Scanning Google Maps for businesses', type: 'default' },
    { text: 'Found 12 businesses in Andheri West', type: 'success' },
    { text: 'Found 8 businesses in Bandra', type: 'success' },
    { text: 'Qualification: 6 leads missing websites', type: 'warning' },
    { text: 'AI verification: checking business activity', type: 'default' },
    { text: 'Lead enriched: Owner name + email found', type: 'success' },
    { text: 'Personalized message generated for lead #1', type: 'default' },
    { text: 'WhatsApp message delivered to lead #1', type: 'success' },
    { text: 'Reply received from Sharma Enterprises', type: 'accent' },
    { text: 'Meeting booked: Tomorrow 3:00 PM', type: 'accent' },
    { text: 'Found 15 businesses in Juhu', type: 'success' },
    { text: 'Qualification: 9 leads without booking system', type: 'warning' },
    { text: 'Outreach batch #2 sent — 8 messages', type: 'success' },
    { text: 'Human review required: pricing request', type: 'warning' },
];

export default function Pearl() {
    const [view, setView] = useState('home'); // 'home' | 'review' | 'running'
    const [missionInput, setMissionInput] = useState('');
    const [extractedFields, setExtractedFields] = useState({ industry: '', location: '', quantity: '', filters: '', channel: '', hours: '' });
    const [missionConfig, setMissionConfig] = useState({});
    const [activeStage, setActiveStage] = useState(0);
    const [metrics, setMetrics] = useState({ found: 0, qualified: 0, sent: 0, replies: 0 });
    const [activityLog, setActivityLog] = useState([]);
    const [stageProgress, setStageProgress] = useState(0);
    const [missionId, setMissionId] = useState(null);
    const [activeDropdown, setActiveDropdown] = useState(null);

    // WhatsApp connection state
    const [waStatus, setWaStatus] = useState('disconnected'); // disconnected, connecting, connected
    const [waQrCode, setWaQrCode] = useState(null);
    const [waPhone, setWaPhone] = useState(null);
    const [waLoading, setWaLoading] = useState(false);
    const qrPollRef = useRef(null);

    // Close active dropdown on click outside
    useEffect(() => {
        const handleClickOutside = () => setActiveDropdown(null);
        window.addEventListener('click', handleClickOutside);
        return () => window.removeEventListener('click', handleClickOutside);
    }, []);

    const outreachOptions = [
        { value: 'WhatsApp + Email', label: 'WhatsApp + Email' },
        { value: 'WhatsApp Only', label: 'WhatsApp Only' },
        { value: 'Email Only', label: 'Email Only' },
        { value: 'LinkedIn', label: 'LinkedIn' }
    ];

    const dailyLimitOptions = [
        { value: '25', label: '25 leads / day' },
        { value: '50', label: '50 leads / day' },
        { value: '100', label: '100 leads / day' },
        { value: '200', label: '200 leads / day' }
    ];

    const workingHoursOptions = [
        { value: '9:00 AM – 6:00 PM', label: '9:00 AM – 6:00 PM' },
        { value: '10:00 AM – 4:00 PM', label: '10:00 AM – 4:00 PM' },
        { value: '24/7', label: '24/7 (Always On)' }
    ];

    const approvalModeOptions = [
        { value: 'Auto-approve qualified leads', label: 'Auto-approve qualified leads' },
        { value: 'Manual review required', label: 'Manual review required' }
    ];

    const safetyRulesOptions = [
        { value: 'No follow-up after rejection', label: 'No follow-up after rejection' },
        { value: 'Push back gently on price', label: 'Push back gently on price' },
        { value: 'Aggressive follow-up', label: 'Aggressive follow-up' }
    ];

    const renderCustomSelect = (label, key, options, Icon) => {
        const isOpen = activeDropdown === key;
        const currentValue = missionConfig[key];
        const selectedOption = options.find(o => o.value === currentValue) || options[0];

        return (
            <div className="pearl__custom-select-container">
                <button
                    type="button"
                    className={`pearl__custom-select-trigger ${isOpen ? 'pearl__custom-select-trigger--open' : ''}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        setActiveDropdown(isOpen ? null : key);
                    }}
                >
                    <div className="pearl__custom-select-trigger-left">
                        {Icon && <Icon size={16} className="pearl__custom-select-icon" />}
                        <span className="pearl__custom-select-label">{label}</span>
                    </div>
                    <div className="pearl__custom-select-trigger-right">
                        <span className="pearl__custom-select-value">{selectedOption ? selectedOption.label : currentValue}</span>
                        <ChevronDown size={14} className={`pearl__custom-select-chevron ${isOpen ? 'pearl__custom-select-chevron--rotated' : ''}`} />
                    </div>
                </button>
                {isOpen && (
                    <div className="pearl__custom-select-options">
                        {options.map((opt) => (
                            <button
                                key={opt.value}
                                type="button"
                                className={`pearl__custom-select-option ${currentValue === opt.value ? 'pearl__custom-select-option--active' : ''}`}
                                onClick={() => {
                                    setMissionConfig({ ...missionConfig, [key]: opt.value });
                                    setActiveDropdown(null);
                                }}
                            >
                                <span className="pearl__custom-select-option-text">{opt.label}</span>
                                {currentValue === opt.value && <Check size={14} className="pearl__custom-select-option-check" />}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    // AI Field Extraction (simulated)
    useEffect(() => {
        const text = missionInput.toLowerCase();
        const fields = { industry: '', location: '', quantity: '', filters: '', channel: '', hours: '' };
        
        // Industry detection
        const industries = ['marketing agencies', 'restaurants', 'dentists', 'consultants', 'agencies', 'saas', 'founders', 'businesses', 'salons', 'gyms', 'clinics', 'hotels', 'cafes', 'startups'];
        for (const ind of industries) {
            if (text.includes(ind.toLowerCase())) { fields.industry = ind; break; }
        }
        
        // Location detection (Regex + Preposition-based dynamic extraction)
        const prepRegex = /\b(?:in|at|near|around|for)\s+([a-z0-9\s,-]+?)(?:\s+(?:without|poor|no|inactive|outdated|hiring|with|having|that|who|doing|leads|businesses|founders|agencies|restaurants|dentists|consultants|saas|salons|gyms|clinics|hotels|cafes|startups)\b|\d|$|\n|\.)/i;
        const prepMatch = text.match(prepRegex);
        let extractedLoc = '';
        
        if (prepMatch) {
            let candidate = prepMatch[1].trim();
            candidate = candidate.replace(/^the\s+/i, '');
            if (candidate && candidate.length > 1) {
                extractedLoc = candidate.split(' ').map(w => {
                    if (w.toLowerCase() === 'usa' || w.toLowerCase() === 'uk') return w.toUpperCase();
                    return w.charAt(0).toUpperCase() + w.slice(1);
                }).join(' ');
            }
        }
        
        if (!extractedLoc || extractedLoc.split(' ').length > 4) {
            const locations = ['mumbai', 'delhi', 'bangalore', 'pune', 'chennai', 'hyderabad', 'kolkata', 'new york', 'london', 'dubai', 'singapore', 'spain', 'barcelona', 'lucknow', 'usa', 'russia', 'madrid', 'paris', 'tokyo', 'berlin', 'rome'];
            for (const loc of locations) {
                if (text.includes(loc.toLowerCase())) { 
                    extractedLoc = loc.toLowerCase() === 'usa' ? 'USA' : loc.charAt(0).toUpperCase() + loc.slice(1); 
                    break; 
                }
            }
        }

        fields.location = extractedLoc;
        
        // Quantity detection
        const qtyMatch = text.match(/(\d+)/);
        if (qtyMatch) fields.quantity = qtyMatch[1];
        
        // Filter detection
        const filters = ['without websites', 'poor reviews', 'no crm', 'inactive instagram', 'without online booking', 'outdated branding', 'hiring sdrs', 'no website'];
        for (const f of filters) {
            if (text.includes(f.toLowerCase())) { fields.filters = f; break; }
        }
        
        setExtractedFields(fields);
    }, [missionInput]);

    const runSimulation = useCallback(() => {
        let stageIdx = 0;
        let actIdx = 0;
        let progress = 0;
        
        const interval = setInterval(() => {
            progress += Math.floor(Math.random() * 25) + 15;
            
            if (progress >= 100) {
                progress = 0;
                stageIdx = Math.min(stageIdx + 1, STAGES.length - 1);
                setActiveStage(stageIdx);
            }
            
            setStageProgress(Math.min(progress, 100));
            
            if (actIdx < ACTIVITY_UPDATES.length) {
                const update = ACTIVITY_UPDATES[actIdx];
                setActivityLog(prev => [{ ...update, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }, ...prev]);
                actIdx++;
            }
            
            setMetrics(prev => ({
                found: prev.found + Math.floor(Math.random() * 4),
                qualified: prev.qualified + Math.floor(Math.random() * 2),
                sent: prev.sent + Math.floor(Math.random() * 3),
                replies: prev.replies + (Math.random() > 0.7 ? 1 : 0),
            }));
            
            if (stageIdx >= STAGES.length - 1 && actIdx >= ACTIVITY_UPDATES.length) {
                clearInterval(interval);
            }
        }, 2500);
        
        return () => clearInterval(interval);
    }, []);

    // WebSocket connection for live mission updates
    useEffect(() => {
        if (view !== 'running' || !missionId) return;
        
        const token = localStorage.getItem('token');
        const ws = new WebSocket(`${WS_BASE}/pearl/missions/${missionId}/ws`);
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                if (data.event === 'stage_changed') {
                    setActiveStage(data.stage_index);
                    setStageProgress(0);
                }
                
                if (data.event === 'progress_updated') {
                    setStageProgress(data.progress);
                }
                
                if (data.event === 'metrics_updated' && data.metrics) {
                    setMetrics(data.metrics);
                }
                
                if (data.event === 'activity') {
                    setActivityLog(prev => [{
                        text: data.text,
                        type: data.type || 'default',
                        time: data.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    }, ...prev]);
                }
                
                if (data.event === 'mission_completed') {
                    // Mission done
                }
                
                if (data.event === 'mission_failed') {
                    console.error('Mission failed:', data.error);
                }
            } catch (e) {
                console.error('WS parse error:', e);
            }
        };
        
        ws.onerror = (err) => {
            console.warn('WebSocket error, falling back to simulation:', err);
            // Fallback to simulation if WS fails
            runSimulation();
        };
        
        ws.onclose = () => {
            console.log('Mission WebSocket closed');
        };
        
        return () => {
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close();
            }
        };
    }, [view, missionId]);

    // Fallback simulation when no backend connection
    useEffect(() => {
        if (view !== 'running' || missionId) return;
        
        // No missionId means API call failed, run local simulation
        const cleanup = runSimulation();
        return cleanup;
    }, [view, missionId, runSimulation]);

    // ── WhatsApp Connection ─────────────────────────────────────────
    const checkWaStatus = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE}/whatsapp/status`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            setWaStatus(data.status || 'disconnected');
            setWaPhone(data.phone || null);
            return data.status;
        } catch { setWaStatus('disconnected'); return 'disconnected'; }
    };

    const fetchQrCode = async () => {
        setWaLoading(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE}/whatsapp/qr`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.status === 'connected') {
                setWaStatus('connected');
                setWaPhone(data.phone);
                setWaQrCode(null);
                if (qrPollRef.current) clearInterval(qrPollRef.current);
            } else if (data.qr) {
                setWaQrCode(data.qr);
                setWaStatus('connecting');
                // Poll for connection and new QR codes every 5 seconds
                if (!qrPollRef.current) {
                    qrPollRef.current = setInterval(async () => {
                        try {
                            const token = localStorage.getItem('token');
                            const pollRes = await fetch(`${API_BASE}/whatsapp/qr`, {
                                headers: { 'Authorization': `Bearer ${token}` }
                            });
                            const pollData = await pollRes.json();
                            if (pollData.status === 'connected') {
                                setWaStatus('connected');
                                setWaPhone(pollData.phone);
                                setWaQrCode(null);
                                clearInterval(qrPollRef.current);
                                qrPollRef.current = null;
                            } else if (pollData.qr) {
                                setWaQrCode(pollData.qr); // Silently update if QR changed
                            }
                        } catch (e) {
                            console.error('Poll error:', e);
                        }
                    }, 5000);
                }
            }
        } catch (e) { console.error('QR fetch error:', e); }
        setWaLoading(false);
    };

    const disconnectWa = async () => {
        try {
            const token = localStorage.getItem('token');
            await fetch(`${API_BASE}/whatsapp/disconnect`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            setWaStatus('disconnected');
            setWaPhone(null);
            setWaQrCode(null);
        } catch (e) { console.error('Disconnect error:', e); }
    };

    // Check WA status on mount
    useEffect(() => {
        checkWaStatus();
        return () => {
            if (qrPollRef.current) clearInterval(qrPollRef.current);
        };
    }, []);

    const handleDeploy = () => {
        setMissionConfig({
            ...extractedFields,
            dailyLimit: '50',
            approvalMode: 'Auto-approve qualified leads',
            safetyRules: 'No follow-up after rejection',
            outreachChannel: extractedFields.channel || 'WhatsApp + Email',
            workingHours: extractedFields.hours || '9:00 AM – 6:00 PM',
        });
        setView('review');
    };

    const handleStartMission = async () => {
        setActiveStage(0);
        setMetrics({ found: 0, qualified: 0, sent: 0, replies: 0 });
        setActivityLog([]);
        setStageProgress(0);
        setView('running');
        
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE}/pearl/missions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    mission_input: missionInput,
                    industry: missionConfig.industry || null,
                    location: missionConfig.location || null,
                    quantity: missionConfig.quantity ? parseInt(missionConfig.quantity) : null,
                    filters: missionConfig.filters || null,
                    outreach_channel: missionConfig.outreachChannel || 'WhatsApp + Email',
                    daily_limit: parseInt(missionConfig.dailyLimit) || 50,
                    working_hours: missionConfig.workingHours || '9:00 AM - 6:00 PM',
                    approval_mode: missionConfig.approvalMode || 'Auto-approve qualified leads',
                    safety_rules: missionConfig.safetyRules || 'No follow-up after rejection'
                })
            });
            
            if (!res.ok) throw new Error('Failed to create mission');
            const mission = await res.json();
            setMissionId(mission.id);
        } catch (err) {
            console.error('Mission creation failed:', err);
            // Falls back to simulation mode if API fails
        }
    };

    const handleTemplateClick = (template) => {
        setMissionInput(template);
    };

    if (view === 'home') {
        return (
            <div className="pearl pearl--fade-in">
                <div className="pearl__home">
                    <div className="pearl__hero">
                        <div className="pearl__hero-badge">Autonomous Agent</div>
                        <h1 className="pearl__hero-title">Pearl</h1>
                        <p className="pearl__hero-subtitle">
                            Your autonomous AI sales employee. Tell Pearl what you want accomplished.
                        </p>
                    </div>
            
                    <div className="pearl__prompt-wrap">
                        <textarea
                            className="pearl__prompt-textarea"
                            placeholder="e.g. Find 100 marketing agencies in Mumbai without websites"
                            value={missionInput}
                            onChange={(e) => setMissionInput(e.target.value)}
                            rows={4}
                        />
                        
                        {/* Live extraction tags */}
                        {Object.values(extractedFields).some(v => v) && (
                            <div className="pearl__extraction">
                                {extractedFields.industry && (
                                    <span className="pearl__extraction-tag">
                                        <span className="pearl__extraction-tag-label">Industry</span>
                                        <span className="pearl__extraction-tag-value">{extractedFields.industry}</span>
                                    </span>
                                )}
                                {extractedFields.location && (
                                    <span className="pearl__extraction-tag">
                                        <span className="pearl__extraction-tag-label">Location</span>
                                        <span className="pearl__extraction-tag-value">{extractedFields.location}</span>
                                    </span>
                                )}
                                {extractedFields.quantity && (
                                    <span className="pearl__extraction-tag">
                                        <span className="pearl__extraction-tag-label">Qty</span>
                                        <span className="pearl__extraction-tag-value">{extractedFields.quantity}</span>
                                    </span>
                                )}
                                {extractedFields.filters && (
                                    <span className="pearl__extraction-tag">
                                        <span className="pearl__extraction-tag-label">Filter</span>
                                        <span className="pearl__extraction-tag-value">{extractedFields.filters}</span>
                                    </span>
                                )}
                            </div>
                        )}
                        
                        <div className="pearl__prompt-footer">
                            <span className="pearl__prompt-hint">Pearl will extract objectives automatically</span>
                            <button 
                                className="pearl__deploy-btn" 
                                disabled={!missionInput.trim()}
                                onClick={handleDeploy}
                            >
                                Deploy Pearl <ArrowRight size={15} style={{ marginLeft: 4 }} />
                            </button>
                        </div>
                    </div>
            
                    <div className="pearl__templates">
                        <div className="pearl__templates-label">Suggested Missions</div>
                        <div className="pearl__templates-grid">
                            {TEMPLATES.map((t, i) => (
                                <button key={i} className="pearl__template-card" onClick={() => handleTemplateClick(t)}>
                                    {t}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* WhatsApp Connection Panel */}
                    <div className="pearl__wa-panel">
                        <div className="pearl__wa-header">
                            <div className="pearl__wa-header-left">
                                <Smartphone size={18} />
                                <span className="pearl__wa-title">WhatsApp Channel</span>
                            </div>
                            <div className={`pearl__wa-status pearl__wa-status--${waStatus}`}>
                                {waStatus === 'connected' ? <Wifi size={13} /> : <WifiOff size={13} />}
                                <span>{waStatus === 'connected' ? `Connected${waPhone ? ` · ${waPhone}` : ''}` : waStatus === 'connecting' ? 'Scanning...' : 'Not Connected'}</span>
                            </div>
                        </div>
                        
                        {waStatus !== 'connected' ? (
                            <div className="pearl__wa-connect">
                                {waQrCode ? (
                                    <div className="pearl__wa-qr-section">
                                        <div className="pearl__wa-qr-box">
                                            <img src={waQrCode} alt="WhatsApp QR Code" className="pearl__wa-qr-img" />
                                        </div>
                                        <div className="pearl__wa-qr-instructions">
                                            <p className="pearl__wa-qr-step">1. Open WhatsApp on your phone</p>
                                            <p className="pearl__wa-qr-step">2. Tap <strong>Linked Devices</strong> → <strong>Link a Device</strong></p>
                                            <p className="pearl__wa-qr-step">3. Point your phone camera at this QR code</p>
                                        </div>
                                        <button className="pearl__wa-refresh-btn" onClick={fetchQrCode}>
                                            <RefreshCw size={14} /> Refresh QR
                                        </button>
                                    </div>
                                ) : (
                                    <div className="pearl__wa-connect-prompt">
                                        <div className="pearl__wa-connect-icon">
                                            <QrCode size={32} />
                                        </div>
                                        <p className="pearl__wa-connect-text">Connect your WhatsApp to let Pearl send messages and handle replies automatically.</p>
                                        <button className="pearl__wa-connect-btn" onClick={fetchQrCode} disabled={waLoading}>
                                            {waLoading ? <RefreshCw size={14} className="pearl__wa-spin" /> : <QrCode size={14} />}
                                            {waLoading ? 'Generating QR...' : 'Connect WhatsApp'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="pearl__wa-connected">
                                <div className="pearl__wa-connected-info">
                                    <div className="pearl__wa-connected-badge">
                                        <Check size={14} />
                                        <span>WhatsApp linked — Pearl can now send and receive messages</span>
                                    </div>
                                </div>
                                <button className="pearl__wa-disconnect-btn" onClick={disconnectWa}>
                                    <X size={13} /> Disconnect
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    if (view === 'review') {
        return (
            <div className="pearl pearl--fade-in">
                <div className="pearl__review">
                    <div className="pearl__review-header">
                        <h2 className="pearl__review-title">Mission Blueprint</h2>
                        <p className="pearl__review-subtitle">Review parameters and define automation guardrails before launching the agent.</p>
                    </div>
                    
                    <div className="pearl__review-layout">
                        {/* Left: Summary Panel */}
                        <div className="pearl__review-summary-card">
                            <h3 className="pearl__review-summary-title">
                                <Sparkle size={18} style={{ color: '#e11d48' }} />
                                Target & Objectives
                            </h3>
                            
                            <div className="pearl__review-summary-item">
                                <span className="pearl__review-summary-label">Target Industry</span>
                                <span className="pearl__review-summary-value">{missionConfig.industry || 'Auto-detect'}</span>
                            </div>
                            
                            <div className="pearl__review-summary-item">
                                <span className="pearl__review-summary-label">Target Region</span>
                                <span className="pearl__review-summary-value">{missionConfig.location || 'Auto-detect'}</span>
                            </div>
                            
                            <div className="pearl__review-summary-item">
                                <span className="pearl__review-summary-label">Qualification Rules</span>
                                <div className="pearl__review-summary-rules">
                                    {missionConfig.filters || 'Standard Lead Discovery: filtering and finding local prospects with high opportunity scores.'}
                                </div>
                            </div>
                        </div>

                        {/* Right: Automation Settings */}
                        <div className="pearl__review-config-card">
                            <h3 className="pearl__review-config-title">
                                <Zap size={18} style={{ color: '#e11d48' }} />
                                Automation Controls
                            </h3>
                            
                            {/* Quantity Input */}
                            <div className="pearl__custom-input-container">
                                <div className="pearl__custom-input-wrap">
                                    <div className="pearl__custom-input-left">
                                        <TrendingUp size={16} className="pearl__custom-select-icon" />
                                        <span className="pearl__custom-input-label">Quantity Target</span>
                                    </div>
                                    <input 
                                        type="number"
                                        className="pearl__custom-input-field" 
                                        value={missionConfig.quantity || ''} 
                                        onChange={(e) => setMissionConfig({...missionConfig, quantity: e.target.value})}
                                        placeholder="Max available"
                                    />
                                </div>
                            </div>

                            {/* Custom Selects */}
                            {renderCustomSelect('Outreach Channel', 'outreachChannel', outreachOptions, Mail)}
                            {renderCustomSelect('Daily Output Limit', 'dailyLimit', dailyLimitOptions, Sliders)}
                            {renderCustomSelect('Working Hours', 'workingHours', workingHoursOptions, Clock)}
                            {renderCustomSelect('Approval Mode', 'approvalMode', approvalModeOptions, Shield)}
                            {renderCustomSelect('Safety & Guardrails', 'safetyRules', safetyRulesOptions, AlertCircle)}
                        </div>
                    </div>

                    <div className="pearl__review-actions">
                        <button className="pearl__back-btn" onClick={() => setView('home')}>
                            <ChevronLeft size={15} style={{ marginRight: 4 }} /> Back
                        </button>
                        <button className="pearl__deploy-btn" onClick={handleStartMission}>
                            Launch Mission <ArrowRight size={15} style={{ marginLeft: 4 }} />
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (view === 'running') {
        return (
            <div className="pearl pearl--fade-in">
                <div className="pearl__running">
                    <div className="pearl__running-header">
                        <h2 className="pearl__running-title">Mission Active</h2>
                        <div className="pearl__running-status">
                            <span className="pearl__running-status-dot" />
                            Running — {STAGES[activeStage]}
                        </div>
                    </div>
                    
                    {/* Metrics Row */}
                    <div className="pearl__metrics">
                        {[
                            [metrics.found, 'Found'],
                            [metrics.qualified, 'Qualified'],
                            [metrics.sent, 'Sent'],
                            [metrics.replies, 'Replies'],
                        ].map(([val, label], i) => (
                            <div key={i} className="pearl__metric">
                                <div className="pearl__metric-value">{val}</div>
                                <div className="pearl__metric-label">{label}</div>
                            </div>
                        ))}
                    </div>
                    
                    {/* Three Column Body */}
                    <div className="pearl__running-body">
                        {/* Left: Stages */}
                        <div className="pearl__stages-panel">
                            <div className="pearl__stages-title">Progress</div>
                            {STAGES.map((stage, i) => (
                                <div key={i} className={`pearl__stage ${i < activeStage ? 'pearl__stage--completed' : ''} ${i === activeStage ? 'pearl__stage--active' : ''}`}>
                                    <div className="pearl__stage-dot">
                                        {i < activeStage && <Check size={10} />}
                                    </div>
                                    <span className="pearl__stage-name">{stage}</span>
                                </div>
                            ))}
                        </div>
                        
                        {/* Center: Workflow */}
                        <div className="pearl__workflow-panel">
                            <div className="pearl__workflow-title">Current Operation</div>
                            <div className="pearl__workflow-visual">
                                <div className="pearl__workflow-current">
                                    <div className="pearl__workflow-stage-name">{STAGES[activeStage]}</div>
                                    <div className="pearl__workflow-stage-desc">{STAGE_DESCRIPTIONS[activeStage]}</div>
                                    <div className="pearl__workflow-progress">
                                        <div className="pearl__workflow-bar-track">
                                            <div className="pearl__workflow-bar-fill" style={{ width: `${stageProgress}%` }} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        {/* Right: Activity Feed */}
                        <div className="pearl__activity-panel">
                            <div className="pearl__activity-title">Activity</div>
                            <div className="pearl__activity-list">
                                {activityLog.map((item, i) => (
                                    <div key={i} className="pearl__activity-item">
                                        <div className={`pearl__activity-icon pearl__activity-icon--${item.type}`} />
                                        <div className="pearl__activity-content">
                                            <div className="pearl__activity-text">{item.text}</div>
                                            <div className="pearl__activity-time">{item.time}</div>
                                        </div>
                                    </div>
                                ))}
                                {activityLog.length === 0 && (
                                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Waiting for activity...</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
    
    return null;
}
