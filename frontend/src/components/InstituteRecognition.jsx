import React from 'react';
import { Trophy, Award } from 'lucide-react';
import './InstituteRecognition.css';

// Crisp Laurel Branch SVG for the luxury prestige feel
const LaurelBranch = ({ flip = false, className = "" }) => (
    <svg 
        width="16" 
        height="20" 
        viewBox="0 0 16 20" 
        fill="currentColor"
        style={{ transform: flip ? 'scaleX(-1)' : 'none' }}
        className={className}
        aria-hidden="true"
    >
        <path d="M7.8 19c-.3-1.6-.7-4.2-1.9-6.3-1-1.8-2.6-3.2-4.5-4C.4 8.3 0 7.4 0 6.4c0-1.2.6-2.2 1.6-2.8 1-.6 2.3-.5 3.3.2 1.3.9 2.2 2.3 2.7 3.8.3-1.8 1.1-3.5 2.4-4.8 1.1-1.1 2.6-1.7 4.2-1.6 1 .1 1.8.8 1.8 1.8 0 1-.7 1.8-1.7 2-1.6.3-3 1.3-3.8 2.7-.8 1.4-1 3.1-.7 4.7.7-1.1 1.8-1.9 3-2.3 1.1-.4 2.3-.2 3.1.5.8.7.9 1.8.4 2.7-.6 1.1-1.7 1.8-2.9 2-1.6.3-3.2-.2-4.5-1.2-.2 1.7-.8 3.4-1.6 4.9L7.8 19z" />
    </svg>
);

const InstituteRecognition = () => {
    return (
        <section 
            id="institute-recognition" 
            className="inst-strap-section"
            aria-label="Institute Recognition and Awards"
        >
            <div className="inst-strap-container">
                {/* Left: Laurel + Recognition Title */}
                <div className="inst-strap-header">
                    <span className="inst-strap-icon-wrap" title="Prestige Award">
                        <LaurelBranch />
                        <Trophy size={14} className="mx-0.5 text-amber-500" />
                    </span>
                    <span className="inst-strap-title">
                        Recognised by the Top Institute
                    </span>
                </div>

                {/* Subtle Divider */}
                <div className="inst-strap-divider" aria-hidden="true" />

                {/* Right: Gold Winner Badge + Recipient + Event + Date */}
                <div className="inst-strap-content">
                    <span className="inst-strap-badge">
                        <Award size={10} strokeWidth={2.5} />
                        WINNER
                    </span>

                    <span className="inst-strap-recipient">
                        IIT Patna
                    </span>

                    <span className="inst-strap-dot" aria-hidden="true">•</span>

                    <span className="inst-strap-subtitle">
                        Startup Showcase 2026
                    </span>

                    <span className="inst-strap-dot" aria-hidden="true">•</span>

                    <span className="inst-strap-date">
                        May 2026
                    </span>

                    <span className="inst-strap-laurel-right">
                        <LaurelBranch flip />
                    </span>
                </div>
            </div>
        </section>
    );
};

export default InstituteRecognition;
