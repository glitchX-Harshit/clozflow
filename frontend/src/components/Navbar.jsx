import { useEffect, useState, useRef } from 'react';
import MagButton from './MagButton';
import ClozFlowLogo from './ClozFlowLogo';
import './Navbar.css';

const LINKS = [
    { label: 'Features', href: '#features' },
    { label: 'How it works', href: '#how-it-works' },
    { label: 'Integrations', href: '#integrations' },
    { label: 'Pricing', href: '#pricing' },
];

const Navbar = ({ onSignup, onLogin }) => {
    const [scrolled, setScrolled] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [activeSection, setActiveSection] = useState('');
    const [hoveredRect, setHoveredRect] = useState(null);
    const [navHovered, setNavHovered] = useState(false);

    const containerRef = useRef(null);

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

    // Set sliding pill coordinates to active link or clear it
    useEffect(() => {
        if (!navHovered) {
            const activeLinkEl = containerRef.current?.querySelector(`.nb__link[href="#${activeSection}"]`);
            if (activeLinkEl) {
                const rect = activeLinkEl.getBoundingClientRect();
                const parentRect = containerRef.current.getBoundingClientRect();
                setHoveredRect({
                    left: rect.left - parentRect.left,
                    width: rect.width,
                    height: rect.height,
                    top: rect.top - parentRect.top,
                });
            } else {
                setHoveredRect(null);
            }
        }
    }, [activeSection, navHovered]);

    const handleMouseEnter = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const parentRect = containerRef.current.getBoundingClientRect();
        setHoveredRect({
            left: rect.left - parentRect.left,
            width: rect.width,
            height: rect.height,
            top: rect.top - parentRect.top,
        });
        setNavHovered(true);
    };

    const handleMouseLeave = () => {
        setNavHovered(false);
    };

    const close = () => setMobileOpen(false);

    return (
        <>
            <nav className={`nb ${scrolled ? 'nb--scrolled' : ''} ${mobileOpen ? 'nb--open' : ''}`}>
                <div className="nb__inner">
                    {/* Logo */}
                    <a href="/" className="nb__logo" aria-label="Go to ClozFlow homepage">
                        <ClozFlowLogo size={32} />
                    </a>

                    {/* Center links */}
                    <div className="nb__links" ref={containerRef} onMouseLeave={handleMouseLeave}>
                        <div
                            className="nb__link-bg"
                            style={{
                                transform: hoveredRect ? `translate3d(${hoveredRect.left}px, ${hoveredRect.top}px, 0)` : 'none',
                                width: hoveredRect ? `${hoveredRect.width}px` : 0,
                                height: hoveredRect ? `${hoveredRect.height}px` : 0,
                                opacity: hoveredRect ? 1 : 0,
                            }}
                        />
                        {LINKS.map(l => (
                            <a
                                key={l.href}
                                href={l.href}
                                className={`nb__link ${activeSection === l.href.substring(1) ? 'nb__link--active' : ''}`}
                                onMouseEnter={handleMouseEnter}
                            >
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
                            disableMagnet
                        />
                        <MagButton
                            label="Enter Workspace"
                            variant="dark"
                            onClick={onSignup}
                            className="nb__cta-mag"
                            disableMagnet
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
                <div className="nb__drawer-glow" />
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

                    {/* Actions & Footer Metadata */}
                    <div className="nb__drawer-footer">
                        <div className="nb__drawer-actions nb__drawer-animate-fade">
                            <MagButton
                                label="Log in"
                                variant="outline"
                                fullWidth
                                disableMagnet
                                onClick={() => { onLogin(); close(); }}
                                className="nb__drawer-btn"
                            />
                            <MagButton
                                label="Enter Workspace"
                                variant="dark"
                                fullWidth
                                disableMagnet
                                onClick={() => { onSignup(); close(); }}
                                className="nb__drawer-btn primary"
                            />
                        </div>

                        <div className="nb__drawer-meta nb__drawer-animate-fade">
                            <span>© 2026 CLOZFLOW. ALL RIGHTS RESERVED.</span>
                            <span>DESIGNED FOR ENTERPRISE</span>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};

export default Navbar;
