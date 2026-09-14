import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import ClozFlowLogo from './ClozFlowLogo';
import './Navbar.css';

const LINKS = [
    { label: 'Product', href: '#features' },
    { label: 'How it works', href: '#how-it-works' },
    { label: 'Integrations', href: '#integrations' },
    { label: 'Pricing', href: '#pricing' },
];

const Navbar = ({ onSignup, onLogin }) => {
    const [scrolled, setScrolled] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [activeSection, setActiveSection] = useState('');

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 20);
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
        const preventDefault = (e) => e.preventDefault();
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

    // Active Section Intersection Observer
    useEffect(() => {
        const sections = LINKS.map(link => document.querySelector(link.href)).filter(Boolean);
        
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    setActiveSection(entry.target.id);
                }
            });
        }, {
            rootMargin: '-30% 0px -60% 0px'
        });

        sections.forEach(sec => observer.observe(sec));
        return () => {
            sections.forEach(sec => observer.unobserve(sec));
        };
    }, []);

    const close = () => setMobileOpen(false);

    return (
        <>
            <header className={`nb ${scrolled ? 'nb--scrolled' : ''} ${mobileOpen ? 'nb--open' : ''}`}>
                <div className="nb__inner">
                    {/* Logo & Tagline */}
                    <a href="/" className="nb__logo" aria-label="Clozflow homepage">
                        <ClozFlowLogo size={30} />
                    </a>

                    {/* Center Navigation Links - Swiss Typography */}
                    <nav className="nb__links" aria-label="Main Navigation">
                        {LINKS.map(l => (
                            <a
                                key={l.href}
                                href={l.href}
                                className={`nb__link ${activeSection === l.href.substring(1) ? 'nb__link--active' : ''}`}
                            >
                                {l.label}
                            </a>
                        ))}
                    </nav>

                    {/* Right Side Actions */}
                    <div className="nb__actions">
                        <button
                            className="nb__login-btn"
                            onClick={onLogin}
                            aria-label="Log in"
                        >
                            Log in
                        </button>
                        <button
                            className="nb__cta-btn"
                            onClick={onSignup}
                            aria-label="Enter Workspace"
                        >
                            <span>Enter Workspace</span>
                            <ArrowRight size={14} className="nb__cta-arrow" />
                        </button>

                        {/* Mobile Hamburger */}
                        <button
                            className={`nb__hamburger ${mobileOpen ? 'nb__hamburger--active' : ''}`}
                            onClick={() => setMobileOpen(o => !o)}
                            aria-label="Toggle navigation menu"
                            aria-expanded={mobileOpen}
                        >
                            <span className="nb__hamburger-line nb__hamburger-line--1"></span>
                            <span className="nb__hamburger-line nb__hamburger-line--2"></span>
                        </button>
                    </div>
                </div>
            </header>

            {/* Mobile Drawer */}
            <div className={`nb__drawer ${mobileOpen ? 'nb__drawer--open' : ''}`}>
                <div className="nb__drawer-content">
                    <div className="nb__drawer-links">
                        {LINKS.map((l, idx) => (
                            <div key={l.href} className="nb__drawer-link-item">
                                <span className="nb__drawer-link-num">0{idx + 1}</span>
                                <a 
                                    href={l.href} 
                                    className={`nb__drawer-link ${activeSection === l.href.substring(1) ? 'nb__drawer-link--active' : ''}`} 
                                    onClick={close}
                                >
                                    {l.label}
                                </a>
                            </div>
                        ))}
                    </div>

                    <div className="nb__drawer-footer">
                        <div className="nb__drawer-actions">
                            <button
                                className="nb__drawer-login-btn"
                                onClick={() => { onLogin(); close(); }}
                            >
                                Log in
                            </button>
                            <button
                                className="nb__drawer-cta-btn"
                                onClick={() => { onSignup(); close(); }}
                            >
                                <span>Enter Workspace</span>
                                <ArrowRight size={15} />
                            </button>
                        </div>
                        <div className="nb__drawer-meta">
                            <span>© 2026 CLOZFLOW. ALL RIGHTS RESERVED.</span>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};

export default Navbar;
