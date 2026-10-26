import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ShieldCheck, CheckCircle2, Clock } from 'lucide-react';
import './TabsCardComponent.css';

import callInterfaceImg from '../../assets/clozflow-pearl-ai-call-interface.webp';
import agentBannerImg from '../../assets/ai-sales-engineer-banner.webp';
import voicePosterImg from '../../assets/futuristic-multilingual-voice-ai-poster.webp';
import cloudscapeImg from '../../assets/conversion-cloudscape.webp';

const TABS = [
    {
        id: 'line',
        title: 'Dedicated phone line',
        description: 'Choose your dedicated Indian (+91) or global line with zero paperwork, SIM cards, or telecom contracts.',
        image: callInterfaceImg,
        badge: 'Instant Provisioning',
        actionText: 'Get your dedicated number'
    },
    {
        id: 'sync',
        title: 'Website auto-sync',
        description: 'Paste your URL. Pearl reads your products, pricing tiers, and FAQs to learn your company voice in 60 seconds.',
        image: agentBannerImg,
        badge: 'Zero Configuration',
        actionText: 'Train from website'
    },
    {
        id: 'voice',
        title: 'Natural voice engine',
        description: 'Answers inbound calls in 1 ring. Speaks fluent, natural Hindi, Hinglish, and English with sub-500ms cadence.',
        image: voicePosterImg,
        badge: 'Sub-500ms Cadence',
        actionText: 'Test live call'
    },
    {
        id: 'revenue',
        title: 'Autonomous closing',
        description: 'Dials website form signups within 25 seconds, overcomes hesitation, and books qualified demos on your calendar.',
        image: cloudscapeImg,
        badge: 'Automated Pipeline',
        actionText: 'Put Pearl on your lines'
    }
];

export default function TabsCardComponent() {
    const [activeIdx, setActiveIdx] = useState(0);
    const navigate = useNavigate();
    const activeTab = TABS[activeIdx];

    return (
        <div className="tabs-card-wrapper">
            {/* ── Main Framer Tabs Card ── */}
            <div className="tabs-card-root">
                {/* Left Side: Vertical Tabs List */}
                <div className="tabs-card-nav" role="tablist">
                    {TABS.map((tab, idx) => {
                        const isSelected = activeIdx === idx;

                        return (
                            <div
                                key={tab.id}
                                className={`tabs-card-item ${isSelected ? 'is-selected' : ''}`}
                                onClick={() => setActiveIdx(idx)}
                                onMouseEnter={() => setActiveIdx(idx)}
                                role="tab"
                                aria-selected={isSelected}
                            >
                                <h3 className="tabs-item-title">{tab.title}</h3>

                                <AnimatePresence initial={false}>
                                    {isSelected && (
                                        <motion.p
                                            className="tabs-item-desc"
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            exit={{ opacity: 0, height: 0 }}
                                            transition={{
                                                type: 'spring',
                                                stiffness: 300,
                                                damping: 30
                                            }}
                                        >
                                            {tab.description}
                                        </motion.p>
                                    )}
                                </AnimatePresence>

                                {/* Scooped Inset Corner Fillets (Apple/Framer Signature Flange) */}
                                {isSelected && (
                                    <>
                                        <div className="tab-corner-top" aria-hidden="true">
                                            <svg viewBox="0 0 20 20" width="20" height="20">
                                                <path
                                                    d="M 6.018 19.789 C 4.705 20 3.137 20 0 20 L 20 20 L 20 0 C 20 3.137 20 4.705 19.789 6.018 C 18.65 13.098 13.098 18.65 6.018 19.789 Z"
                                                    fill="var(--tab-accent-bg, #e2e8f0)"
                                                />
                                            </svg>
                                        </div>
                                        <div className="tab-corner-bottom" aria-hidden="true">
                                            <svg viewBox="0 0 20 20" width="20" height="20">
                                                <path
                                                    d="M 6.018 0.211 C 4.705 0 3.137 0 0 0 L 20 0 L 20 20 C 20 16.863 20 15.295 19.789 13.982 C 18.65 6.902 13.098 1.35 6.018 0.211 Z"
                                                    fill="var(--tab-accent-bg, #e2e8f0)"
                                                />
                                            </svg>
                                        </div>
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Right Side: Active Image Preview Container */}
                <div className="tabs-card-image-panel">
                    <div className="tabs-image-viewport">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={activeTab.id}
                                className="tabs-image-inner"
                                initial={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 1.01 }}
                                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                            >
                                <img
                                    src={activeTab.image}
                                    alt={activeTab.title}
                                    className="tabs-preview-img"
                                    loading="eager"
                                />

                                {/* Subtle Floating Pill & CTA Overlay */}
                                <div className="tabs-image-overlay">
                                    <span className="tabs-overlay-badge">{activeTab.badge}</span>
                                    <button
                                        type="button"
                                        className="tabs-overlay-cta"
                                        onClick={() => navigate('/dashboard')}
                                    >
                                        <span>{activeTab.actionText}</span>
                                        <ArrowRight size={14} />
                                    </button>
                                </div>
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </div>
            </div>

            {/* Bottom Guarantees Strip */}
            <div className="tabs-guarantees-strip">
                <div className="tabs-guarantee-item">
                    <ShieldCheck size={14} className="tabs-guarantee-icon" />
                    <span>No credit card required</span>
                </div>
                <div className="tabs-guarantee-item">
                    <CheckCircle2 size={14} className="tabs-guarantee-icon" />
                    <span>Dedicated virtual line ready in minutes</span>
                </div>
                <div className="tabs-guarantee-item">
                    <Clock size={14} className="tabs-guarantee-icon" />
                    <span>Cancel anytime</span>
                </div>
            </div>
        </div>
    );
}
