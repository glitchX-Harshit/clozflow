import { useEffect, useRef } from 'react';
import './Footer.css';

const Footer = () => {
    const leftIrisRef = useRef(null);
    const rightIrisRef = useRef(null);
    const leftEyeRef = useRef(null);
    const rightEyeRef = useRef(null);

    useEffect(() => {
        let rafId = null;
        let mouseX = window.innerWidth / 2;
        let mouseY = 0;

        const updateEyes = () => {
            const eyes = [
                { eye: leftEyeRef.current, iris: leftIrisRef.current },
                { eye: rightEyeRef.current, iris: rightIrisRef.current }
            ];

            eyes.forEach(({ eye, iris }) => {
                if (!eye || !iris) return;
                const rect = eye.getBoundingClientRect();
                const eyeCenterX = rect.left + rect.width / 2;
                const eyeCenterY = rect.top + rect.height / 2;

                const dx = mouseX - eyeCenterX;
                const dy = mouseY - eyeCenterY;
                const angle = Math.atan2(dy, dx);

                // Maximum offset within the sclera socket
                const maxTravel = rect.width * 0.24;
                const dist = Math.min(maxTravel, Math.hypot(dx, dy) / 6);

                const x = Math.cos(angle) * dist;
                const y = Math.sin(angle) * dist;

                iris.style.transform = `translate3d(${x}px, ${y}px, 0)`;
            });
        };

        const onMouseMove = (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
            if (!rafId) {
                rafId = requestAnimationFrame(() => {
                    updateEyes();
                    rafId = null;
                });
            }
        };

        const onScroll = () => {
            if (!rafId) {
                rafId = requestAnimationFrame(() => {
                    updateEyes();
                    rafId = null;
                });
            }
        };

        window.addEventListener('mousemove', onMouseMove, { passive: true });
        window.addEventListener('scroll', onScroll, { passive: true });
        
        // Initial look position
        updateEyes();

        return () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('scroll', onScroll);
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, []);

    return (
        <footer className="ft__wrapper">
            <div className="ft__inner">
                {/* ── Top Header Row ── */}
                <div className="ft__top-section">
                    {/* Left: Contact */}
                    <div className="ft__contact-block">
                        <span className="ft__talk-tag">Let's talk</span>
                        <a 
                            href="mailto:info@clozflow.in" 
                            className="ft__email-anchor"
                            aria-label="Email info@clozflow.in"
                        >
                            <span className="ft__email-val">info@clozflow.in</span>
                        </a>
                    </div>

                    {/* Right: Nav Groups */}
                    <div className="ft__nav-columns">
                        <div className="ft__nav-col">
                            <span className="ft__nav-heading">Explore</span>
                            <ul className="ft__nav-links">
                                <li><a href="/dashboard">Dashboard</a></li>
                                <li><a href="/live-call">Live Copilot</a></li>
                                <li><a href="/how-it-works">How it Works</a></li>
                                <li><a href="/pricing">Pricing</a></li>
                            </ul>
                        </div>

                        <div className="ft__nav-col">
                            <span className="ft__nav-heading">Follow</span>
                            <ul className="ft__nav-links">
                                <li><a href="https://instagram.com" target="_blank" rel="noreferrer">Instagram</a></li>
                                <li><a href="https://linkedin.com" target="_blank" rel="noreferrer">LinkedIn</a></li>
                                <li><a href="https://x.com" target="_blank" rel="noreferrer">X</a></li>
                            </ul>
                        </div>
                    </div>
                </div>

                {/* ── The Centerpiece: Peeking Eyes + Massive Clozflow Card ── */}
                <div className="ft__card-container">
                    {/* The Two 3D Eyeballs peeking over the top border */}
                    <div className="ft__peeking-eyes" aria-hidden="true">
                        {/* Left Eyeball */}
                        <div className="ft__eyeball" ref={leftEyeRef}>
                            <div className="ft__eyeball-sclera">
                                <div className="ft__eyeball-iris" ref={leftIrisRef}>
                                    <div className="ft__eyeball-pupil" />
                                    <div className="ft__eyeball-glint-large" />
                                    <div className="ft__eyeball-glint-small" />
                                </div>
                            </div>
                        </div>

                        {/* Right Eyeball */}
                        <div className="ft__eyeball" ref={rightEyeRef}>
                            <div className="ft__eyeball-sclera">
                                <div className="ft__eyeball-iris" ref={rightIrisRef}>
                                    <div className="ft__eyeball-pupil" />
                                    <div className="ft__eyeball-glint-large" />
                                    <div className="ft__eyeball-glint-small" />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* The Giant Off-White/Cream Card */}
                    <div className="ft__porcelain-card">
                        <div className="ft__hero-word-wrap">
                            <h2 className="ft__hero-word">
                                clozflow
                                <span className="ft__gradient-dot" aria-hidden="true" />
                            </h2>
                        </div>

                        {/* Bottom Row inside Card */}
                        <div className="ft__card-footer">
                            <span className="ft__copyright-text">
                                © 2026 ClozFlow, made for closers
                            </span>
                            <div className="ft__legal-group">
                                <a href="/privacy">Privacy</a>
                                <a href="/terms">Terms</a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
