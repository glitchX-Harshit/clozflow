import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import MagButton from './MagButton';
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

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 30);
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    useEffect(() => {
        document.body.style.overflow = mobileOpen ? 'hidden' : '';
        return () => { document.body.style.overflow = ''; };
    }, [mobileOpen]);

    const close = () => setMobileOpen(false);

    return (
        <>
            <nav className={`nb ${scrolled ? 'nb--scrolled' : ''}`}>
                <div className="nb__inner">
                    {/* Logo */}
                    <a href="#" className="nb__logo">
                        <span className="nb__mark" aria-hidden="true">H</span>
                        <span className="nb__wordmark">
                            Hexagon
                        </span>
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
                            className="nb__hamburger"
                            onClick={() => setMobileOpen(o => !o)}
                            aria-label="Toggle menu"
                        >
                            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
                        </button>
                    </div>
                </div>
            </nav>

            {/* Mobile drawer */}
            <div className={`nb__drawer ${mobileOpen ? 'nb__drawer--open' : ''}`}>
                <div className="nb__drawer-links">
                    {LINKS.map(l => (
                        <a key={l.href} href={l.href} className="nb__drawer-link" onClick={close}>
                            {l.label}
                        </a>
                    ))}
                </div>
                <div className="nb__drawer-actions">
                    <MagButton
                        label="Log in"
                        variant="outline"
                        fullWidth
                        magnetStrength={0.25}
                        onClick={() => { onLogin(); close(); }}
                    />
                    <MagButton
                        label="Enter Workspace"
                        variant="dark"
                        fullWidth
                        magnetStrength={0.25}
                        onClick={() => { onSignup(); close(); }}
                    />
                </div>
            </div>
        </>
    );
};

export default Navbar;
