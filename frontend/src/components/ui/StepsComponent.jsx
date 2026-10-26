import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Globe, Phone, Headphones, Sparkles } from 'lucide-react';
import './StepsComponent.css';

const STEPS = [
    {
        number: '01',
        title: 'Connect website',
        description: 'Paste your URL. Pearl reads your products, pricing, and FAQs in 60 seconds.',
        icon: Globe
    },
    {
        number: '02',
        title: 'Pick your number',
        description: 'Choose a dedicated Indian (+91) or global line with zero paperwork.',
        icon: Phone
    },
    {
        number: '03',
        title: 'Test live call',
        description: 'Dial your number. Experience instant answers in fluent Hindi & Hinglish.',
        icon: Headphones
    },
    {
        number: '04',
        title: 'Automate revenue',
        description: 'Inbound answered 24/7 on ring one. Website leads dialed in 25 seconds.',
        icon: Sparkles
    }
];

export default function StepsComponent() {
    const [activeIdx, setActiveIdx] = useState(0);

    return (
        <div className="framer-steps-wrapper">
            {/* ── Cards Row: Bottom-aligned, Active Card is Taller and Wider ── */}
            <div className="framer-cards-row">
                {STEPS.map((step, idx) => {
                    const isActive = activeIdx === idx;
                    const IconComponent = step.icon;

                    return (
                        <motion.div
                            key={step.number}
                            className={`framer-card-item ${isActive ? 'is-active' : 'is-inactive'}`}
                            onClick={() => setActiveIdx(idx)}
                            layout
                            transition={{
                                type: 'spring',
                                stiffness: 300,
                                damping: 28
                            }}
                            whileHover={{ y: isActive ? 0 : -4 }}
                        >
                            {/* Top Text Group */}
                            <div className="framer-card-text">
                                <h4 className="framer-card-title">{step.title}</h4>
                                <p className="framer-card-desc">{step.description}</p>
                            </div>

                            {/* Bottom Icon Squircle */}
                            <div className="framer-card-icon-box">
                                <IconComponent size={19} strokeWidth={2} />
                            </div>
                        </motion.div>
                    );
                })}
            </div>

            {/* ── Timeline Track with Synchronized Number Pills ── */}
            <div className="framer-timeline-wrap">
                {/* Horizontal Track Line */}
                <div className="framer-track-line" />

                {/* Pills Row (Matching Card Flex Columns for Perfect Alignment) ── */}
                <div className="framer-pills-row">
                    {STEPS.map((step, idx) => {
                        const isActive = activeIdx === idx;

                        return (
                            <motion.div
                                key={step.number}
                                className={`framer-pill-slot ${isActive ? 'slot-active' : 'slot-inactive'}`}
                                layout
                                transition={{
                                    type: 'spring',
                                    stiffness: 300,
                                    damping: 28
                                }}
                            >
                                <button
                                    type="button"
                                    className={`framer-pill-btn ${isActive ? 'is-active' : 'is-inactive'}`}
                                    onClick={() => setActiveIdx(idx)}
                                    aria-label={`Step ${step.number}: ${step.title}`}
                                    aria-pressed={isActive}
                                >
                                    <span>{step.number}</span>
                                </button>
                            </motion.div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
