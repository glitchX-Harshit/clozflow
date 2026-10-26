import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    Play, Pause, CheckCircle2, ArrowRight, ShieldCheck, Clock
} from 'lucide-react';
import './PearlPortalPage.css';

// ── Realistic Customer Conversation Scenarios ──
const CONVERSATIONS = [
    {
        id: 'inbound-pricing',
        category: 'Inbound Deal',
        title: 'Late-Night Inbound Call',
        callerContext: 'Customer calling your dedicated number at 11:30 PM with pricing & onboarding questions',
        callerQuestion: '“Bhaiya pricing kya hai aur WhatsApp pe message kaise bhejte hain?”',
        pearlResponse: '“Namaste! Main aapko explain karti hoon. ClozFlow mein aap direct apni website link daal kar 5 minute mein dedicated number le sakte hain. Starter plan ₹2,499 se shuru hota hai jisme WhatsApp automated follow-ups bhi included hain. Kya main link aapke WhatsApp par bhej doon abhi?”',
        langCode: 'hi-IN',
        pitch: 1.1,
        rate: 1.0,
        duration: '0:14',
        durationSec: 14,
        takeaway: 'Picks up on the first ring at midnight, explains pricing in warm Hinglish, and gets permission to send details on WhatsApp.'
    },
    {
        id: 'speed-to-lead',
        category: 'Speed-to-Lead',
        title: 'Instant Website Callback',
        callerContext: 'Dials a prospect 25 seconds after they submitted an inquiry form on your website',
        callerQuestion: '“Hey, who is this? I literally just clicked submit on your site.”',
        pearlResponse: '“Hey Vikram! Rohan here from ClozFlow. Saw you just checked out our automated sales dialer and wanted to make sure you get set up without any hiccups. Are you looking to handle inbound customer calls, or dial outbound lead lists?”',
        langCode: 'en-IN',
        pitch: 1.0,
        rate: 1.05,
        duration: '0:12',
        durationSec: 12,
        takeaway: 'Calls before the lead closes the browser tab, catching high-intent buyers while their attention is 100% on your product.'
    },
    {
        id: 'objection-email',
        category: 'Objection Defense',
        title: '“Just Send Me an Email”',
        callerContext: 'Prospect trying to brush off a sales follow-up call during a busy workday',
        callerQuestion: '“I’m in the middle of a meeting right now. Just email me the one-pager.”',
        pearlResponse: '“Totally understand Vikram, I won’t hold you up. People get 200 emails a day and never open them. Give me just 25 seconds right now to explain how we automate phone calls—if it doesn’t fit, we disconnect right away. Fair enough?”',
        langCode: 'en-IN',
        pitch: 1.0,
        rate: 1.04,
        duration: '0:13',
        durationSec: 13,
        takeaway: 'Politely respects their time without letting the deal freeze in an unopened inbox. 84% of prospects agree to the 25-second pitch.'
    },
    {
        id: 'objection-budget',
        category: 'ROI Defense',
        title: '“Your Pricing is Too Expensive”',
        callerContext: 'Prospect comparing Pearl to basic software tools without accounting for SDR salaries',
        callerQuestion: '“Your pricing seems high compared to the other software we checked.”',
        pearlResponse: '“I hear you on budget. But traditional software still requires you to hire, train, and manage reps who miss calls after 6 PM. Pearl is a full sales rep with its own dedicated line that answers 24/7 for less than the cost of a part-time intern. If I can prove 3x pipeline in 14 days, would you test it?”',
        langCode: 'en-US',
        pitch: 0.98,
        rate: 1.02,
        duration: '0:15',
        durationSec: 15,
        takeaway: 'Transforms budget resistance into an ROI pilot by highlighting the hidden cost of human turnover and missed late-night calls.'
    }
];

const PearlPortalPage = () => {
    const navigate = useNavigate();
    const [activeScenario, setActiveScenario] = useState(CONVERSATIONS[0]);
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const playbackTimerRef = useRef(null);

    // Audio playback via Web Speech API
    const handleToggleAudio = (scenario) => {
        if (activeScenario.id === scenario.id && isPlaying) {
            if (typeof window !== 'undefined' && window.speechSynthesis) {
                window.speechSynthesis.cancel();
            }
            clearInterval(playbackTimerRef.current);
            setIsPlaying(false);
            setProgress(0);
            return;
        }

        setActiveScenario(scenario);
        setIsPlaying(true);
        setProgress(0);

        if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(scenario.pearlResponse);
            utterance.lang = scenario.langCode || 'en-IN';
            utterance.pitch = scenario.pitch || 1.0;
            utterance.rate = scenario.rate || 1.0;

            const voices = window.speechSynthesis.getVoices();
            const matchingVoice = voices.find(v => v.lang.includes(scenario.langCode)) || voices.find(v => v.lang.startsWith('en'));
            if (matchingVoice) utterance.voice = matchingVoice;

            utterance.onend = () => {
                setIsPlaying(false);
                setProgress(100);
                clearInterval(playbackTimerRef.current);
            };

            utterance.onerror = () => {
                setIsPlaying(false);
                clearInterval(playbackTimerRef.current);
            };

            window.speechSynthesis.speak(utterance);
        }

        clearInterval(playbackTimerRef.current);
        const startTime = Date.now();
        const totalDurationMs = scenario.durationSec * 1000;

        playbackTimerRef.current = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const pct = Math.min((elapsed / totalDurationMs) * 100, 100);
            setProgress(pct);

            if (pct >= 100) {
                clearInterval(playbackTimerRef.current);
                setIsPlaying(false);
            }
        }, 80);
    };

    useEffect(() => {
        return () => {
            if (typeof window !== 'undefined' && window.speechSynthesis) {
                window.speechSynthesis.cancel();
            }
            clearInterval(playbackTimerRef.current);
        };
    }, []);

    return (
        <section className="pearl-portal-page" aria-label="Pearl AI Telephony Overview">
            <div className="pearl-portal__container">

                {/* ── Live Conversations: Hear Pearl in Action ── */}
                <div className="pearl-section" id="voice-showcase">
                    <div className="pearl-section-head">
                        <h3 className="pearl-section-title">Hear Pearl in real customer conversations</h3>
                        <p className="pearl-section-sub">
                            No robotic monotone. No 3-second awkward silence. Tap any scenario below to listen to how Pearl handles real buyers.
                        </p>
                    </div>

                    {/* Clean Scenario Navigation Tabs */}
                    <div className="pearl-scenario-tabs" role="tablist">
                        {CONVERSATIONS.map((sc) => {
                            const isActive = activeScenario.id === sc.id;
                            return (
                                <button
                                    key={sc.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={isActive}
                                    className={`pearl-scenario-tab ${isActive ? 'active' : ''}`}
                                    onClick={() => handleToggleAudio(sc)}
                                >
                                    <span className="pearl-tab-label">{sc.title}</span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Active Conversation Stage */}
                    <div className="pearl-conversation-stage">
                        <div className="pearl-stage-header">
                            <div>
                                <span className="pearl-stage-category">{activeScenario.category}</span>
                                <h4 className="pearl-stage-title">{activeScenario.title}</h4>
                                <p className="pearl-stage-context">{activeScenario.callerContext}</p>
                            </div>

                            {/* Prominent Play / Pause Button */}
                            <button
                                type="button"
                                className={`pearl-stage-play-btn ${isPlaying ? 'is-playing' : ''}`}
                                onClick={() => handleToggleAudio(activeScenario)}
                                aria-label={isPlaying ? 'Pause conversation' : 'Play conversation'}
                            >
                                {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="translate-x-0.5" />}
                                <span>{isPlaying ? 'Pause' : 'Listen Now'}</span>
                            </button>
                        </div>

                        {/* Scrubber Track */}
                        <div className="pearl-stage-scrubber">
                            <div className="pearl-scrub-track">
                                <div className="pearl-scrub-progress" style={{ width: `${progress}%` }} />
                            </div>
                            <div className="pearl-scrub-meta">
                                <span>{isPlaying ? 'Playing sample...' : 'Tap listen to hear audio'}</span>
                                <span>{activeScenario.duration}</span>
                            </div>
                        </div>

                        {/* Dialogue Exchange */}
                        <div className="pearl-dialogue-wrap">
                            <div className="pearl-dialogue-turn pearl-dialogue-caller">
                                <span className="pearl-turn-speaker">Customer:</span>
                                <p className="pearl-turn-text">{activeScenario.callerQuestion}</p>
                            </div>

                            <div className="pearl-dialogue-turn pearl-dialogue-pearl">
                                <span className="pearl-turn-speaker">Pearl AI:</span>
                                <p className="pearl-turn-text">{activeScenario.pearlResponse}</p>
                            </div>
                        </div>

                        {/* Key Takeaway */}
                        <div className="pearl-stage-takeaway">
                            <CheckCircle2 size={16} className="pearl-takeaway-icon" />
                            <span><strong>Why this converts:</strong> {activeScenario.takeaway}</span>
                        </div>
                    </div>
                </div>

                {/* ── 3. How Pearl Works (Open 3-Step Story) ── */}
                <div className="pearl-section">
                    <div className="pearl-section-head">
                        <h3 className="pearl-section-title">How Pearl works on your phone lines</h3>
                        <p className="pearl-section-sub">
                            You don't need to write complex prompts or buy telecom hardware. You’re ready in 3 simple steps.
                        </p>
                    </div>

                    <div className="pearl-steps-row">
                        <div className="pearl-step-card">
                            <span className="pearl-step-number">01</span>
                            <h4 className="pearl-step-heading">Train on your website URL</h4>
                            <p className="pearl-step-body">
                                Paste your domain link. In 60 seconds, Pearl reads your products, pricing plans, and FAQs. It learns your brand voice so every answer is accurate and context-aware.
                            </p>
                        </div>

                        <div className="pearl-step-card">
                            <span className="pearl-step-number">02</span>
                            <h4 className="pearl-step-heading">Pick your dedicated phone number</h4>
                            <p className="pearl-step-body">
                                Choose an Indian (+91) virtual number or international phone line. It belongs exclusively to your business—no shared lines, zero SIM cards, zero telecom paperwork.
                            </p>
                        </div>

                        <div className="pearl-step-card">
                            <span className="pearl-step-number">03</span>
                            <h4 className="pearl-step-heading">Calls happen automatically</h4>
                            <p className="pearl-step-body">
                                Inbound customer calls are answered in 1 ring, 24 hours a day. Website signups are dialed within 25 seconds. Every call is recorded, transcribed, and logged to your CRM.
                            </p>
                        </div>
                    </div>
                </div>

                {/* ── 4. The Difference: Traditional Sales vs. Pearl ── */}
                <div className="pearl-section">
                    <div className="pearl-section-head">
                        <h3 className="pearl-section-title">Why phone calls beat emails and chat widgets</h3>
                        <p className="pearl-section-sub">
                            Most deals die in the delay between a lead signing up and a human rep getting around to calling them.
                        </p>
                    </div>

                    <div className="pearl-comparison-grid">
                        <div className="pearl-compare-card pearl-compare-old">
                            <span className="pearl-compare-tag">Without Pearl</span>
                            <h4 className="pearl-compare-title">Where deals slip through the cracks</h4>
                            <ul className="pearl-compare-list">
                                <li>
                                    <strong>60% of after-hours calls go to voicemail:</strong> Leads calling on weekends or at 9 PM get dead silence and buy from someone else.
                                </li>
                                <li>
                                    <strong>Average callback takes 4+ hours:</strong> By the time a sales rep dials, the prospect has forgotten signing up.
                                </li>
                                <li>
                                    <strong>Frustrating IVR menus:</strong> Customers hang up the moment they hear "Press 1 for Sales, Press 2 for Support".
                                </li>
                                <li>
                                    <strong>SDR hesitation and turnover:</strong> Reps hesitate before cold dials and give up at the first objection.
                                </li>
                            </ul>
                        </div>

                        <div className="pearl-compare-card pearl-compare-new">
                            <span className="pearl-compare-tag">With Pearl</span>
                            <h4 className="pearl-compare-title">Never miss another revenue opportunity</h4>
                            <ul className="pearl-compare-list">
                                <li>
                                    <strong>1-ring answer 24/7/365:</strong> Every customer call is answered immediately, even on holidays and at 2 AM.
                                </li>
                                <li>
                                    <strong>25-second speed-to-lead:</strong> Website form signups get a live call within seconds while their buying intent is peaked.
                                </li>
                                <li>
                                    <strong>Warm, natural bilingual conversation:</strong> Speaks Hinglish and English naturally with zero robotic pauses.
                                </li>
                                <li>
                                    <strong>Instant calendar bookings:</strong> Automatically checks your availability and locks demos straight onto your calendar.
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>

                {/* ── 5. Simple, Honest Metrics ── */}
                <div className="pearl-metrics-row">
                    <div className="pearl-metric-box">
                        <span className="pearl-metric-value">&lt;500ms</span>
                        <span className="pearl-metric-label">Voice response time</span>
                        <p className="pearl-metric-desc">Conversational cadence that feels like speaking to a real person.</p>
                    </div>

                    <div className="pearl-metric-box">
                        <span className="pearl-metric-value">100%</span>
                        <span className="pearl-metric-label">Inbound call capture</span>
                        <p className="pearl-metric-desc">Zero missed calls during lunch breaks, weekends, or late nights.</p>
                    </div>

                    <div className="pearl-metric-box">
                        <span className="pearl-metric-value">25 sec</span>
                        <span className="pearl-metric-label">Speed to lead</span>
                        <p className="pearl-metric-desc">Instant phone callback as soon as a visitor fills your website form.</p>
                    </div>

                    <div className="pearl-metric-box">
                        <span className="pearl-metric-value">5 min</span>
                        <span className="pearl-metric-label">Setup time</span>
                        <p className="pearl-metric-desc">Trained directly from your website. Ready for live calls today.</p>
                    </div>
                </div>

                {/* ── 6. Final Call to Action ── */}
                <div className="pearl-cta-panel">
                    <div className="pearl-cta-inner">
                        <h3 className="pearl-cta-heading">Ready to put Pearl on your phone line?</h3>
                        <p className="pearl-cta-description">
                            Select your dedicated virtual number, paste your website URL to auto-train Pearl, and make your first live test call today.
                        </p>

                        <div className="pearl-cta-buttons">
                            <button 
                                type="button" 
                                className="pearl-cta-primary"
                                onClick={() => navigate('/dashboard')}
                            >
                                <span>Get Your Dedicated Number</span>
                                <ArrowRight size={16} />
                            </button>

                            <button 
                                type="button" 
                                className="pearl-cta-secondary"
                                onClick={() => navigate('/call-brief')}
                            >
                                <span>Explore Call Briefing</span>
                            </button>
                        </div>

                        <div className="pearl-cta-guarantees">
                            <div className="pearl-guarantee-point">
                                <ShieldCheck size={14} />
                                <span>No credit card required</span>
                            </div>
                            <div className="pearl-guarantee-point">
                                <CheckCircle2 size={14} />
                                <span>Dedicated virtual line ready in minutes</span>
                            </div>
                            <div className="pearl-guarantee-point">
                                <Clock size={14} />
                                <span>Cancel anytime</span>
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </section>
    );
};

export default PearlPortalPage;
