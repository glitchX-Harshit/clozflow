import { useEffect, useState } from 'react';
import MagButton from './MagButton';
import './Navbar.css';

const LINKS = [
    { label: 'Features', href: '#features' },
    { label: 'How it works', href: '#how-it-works' },
    { label: 'Integrations', href: '#integrations' },
    { label: 'Pricing', href: '#pricing' },
];

const HexagonLogo = () => (
    <svg
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="nb__custom-mark"
    >
        <defs>
            <linearGradient id="hexGradOuter" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#8b5cf6" />
                <stop offset="50%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
            <linearGradient id="hexGradInner" x1="100%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#ec4899" />
                <stop offset="100%" stopColor="#8b5cf6" />
            </linearGradient>
            <filter id="hexGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="1.5" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
        </defs>
        <path
            d="M16 2L3 9.5V22.5L16 30L29 22.5V9.5L16 2Z"
            stroke="url(#hexGradOuter)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            filter="url(#hexGlow)"
            className="nb__hex-base"
        />
        <path
            d="M16 7L9 11V19L16 23L23 19V11L16 7Z"
            fill="url(#hexGradInner)"
            className="nb__hex-inner"
            opacity="0.85"
        />
        <circle cx="16" cy="15" r="2.5" fill="#ffffff" className="nb__hex-core" />
    </svg>
);

const Navbar = ({ onSignup, onLogin }) => {
    const [scrolled, setScrolled] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 30);
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    useEffect(() => {
        if (mobileOpen) {
            window.lenis?.stop();
        } else {
            window.lenis?.start();
        }
        return () => {
            window.lenis?.start();
        };
    }, [mobileOpen]);

    useEffect(() => {
        const preventDefault = (e) => {
            // Prevent background touch scrolling through the drawer
            e.preventDefault();
        };
        const drawer = document.querySelector('.nb__drawer');
        if (mobileOpen && drawer) {
            drawer.addEventListener('touchmove', preventDefault, { passive: false });
        }
        return () => {
            if (drawer) {
                drawer.removeEventListener('touchmove', preventDefault);
            }
        };
    }, [mobileOpen]);

    const close = () => setMobileOpen(false);

    return (
        <>
            <nav className={`nb ${scrolled ? 'nb--scrolled' : ''} ${mobileOpen ? 'nb--open' : ''}`}>
                <div className="nb__inner">
                    {/* Logo */}
                    <a href="#" className="nb__logo">
                        <HexagonLogo />
                        <div className="nb__wordmark-wrapper">
                            <span className="nb__wordmark">Hexagon</span>
                        </div>
                    </a>

                    {/* Center links */}
                    <div className="nb__links">
                        {LINKS.map(l => (
                            <a key={l.href} href={l.href} className="nb__link">
                                {l.label}
                            </a>
                        ))}
                    </div>

                    {/* Actions */}
                    <div className="nb__actions">
                        <MagButton
                            label="Log in"
                            variant="outline"
                            onClick={onLogin}
                            className="nb__login-mag"
                            magnetStrength={0.35}
                        />
                        <MagButton
                            label="Enter Workspace"
                            variant="dark"
                            onClick={onSignup}
                            className="nb__cta-mag"
                            magnetStrength={0.35}
                        />
                        <button
                            className={`nb__hamburger ${mobileOpen ? 'nb__hamburger--active' : ''}`}
                            onClick={() => setMobileOpen(o => !o)}
                            aria-label="Toggle menu"
                        >
                            <span className="nb__hamburger-line nb__hamburger-line--1"></span>
                            <span className="nb__hamburger-line nb__hamburger-line--2"></span>
                        </button>
                    </div>
                </div>
            </nav>

            {/* Mobile drawer */}
            <div className={`nb__drawer ${mobileOpen ? 'nb__drawer--open' : ''}`}>
                {/* Background grid lines */}
                <div className="nb__drawer-grid-lines">
                    <div className="nb__drawer-grid-line vertical dv1"></div>
                    <div className="nb__drawer-grid-line vertical dv2"></div>
                </div>

                <div className="nb__drawer-content">
                    {/* Links */}
                    <div className="nb__drawer-links">
                        {LINKS.map((l, idx) => (
                            <div key={l.href} className="nb__drawer-link-item">
                                <span className="nb__drawer-link-num">0{idx + 1}</span>
                                <a href={l.href} className="nb__drawer-link" onClick={close}>
                                    {l.label}
                                </a>
                            </div>
                        ))}
                    </div>

                    {/* Actions & Footer Metadata */}
                    <div className="nb__drawer-footer">
                        <div className="nb__drawer-actions nb__drawer-animate-fade">
                            <MagButton
                                label="Log in"
                                variant="outline"
                                fullWidth
                                magnetStrength={0.2}
                                onClick={() => { onLogin(); close(); }}
                                className="nb__drawer-btn"
                            />
                            <MagButton
                                label="Enter Workspace"
                                variant="dark"
                                fullWidth
                                magnetStrength={0.2}
                                onClick={() => { onSignup(); close(); }}
                                className="nb__drawer-btn primary"
                            />
                        </div>

                        <div className="nb__drawer-meta nb__drawer-animate-fade">
                            <span>© 2026 HEXAGON. ALL RIGHTS RESERVED.</span>
                            <span>DESIGNED FOR ENTERPRISE</span>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};

export default Navbar;
