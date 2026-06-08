import './Footer.css';

const Footer = () => (
    <footer className="ft__section">
        <div className="container">
            <div className="ft__top">
                {/* Brand */}
                <div className="ft__brand">
                    <div className="ft__logo">
                        <svg
                            viewBox="0 0 32 32"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            className="nb__custom-mark"
                        >
                            <defs>
                                <linearGradient id="hexGradOuterFooter" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" stopColor="#8b5cf6" />
                                    <stop offset="50%" stopColor="#6366f1" />
                                    <stop offset="100%" stopColor="#3b82f6" />
                                </linearGradient>
                                <linearGradient id="hexGradInnerFooter" x1="100%" y1="0%" x2="0%" y2="100%">
                                    <stop offset="0%" stopColor="#ec4899" />
                                    <stop offset="100%" stopColor="#8b5cf6" />
                                </linearGradient>
                                <filter id="hexGlowFooter" x="-20%" y="-20%" width="140%" height="140%">
                                    <feGaussianBlur stdDeviation="1.5" result="blur" />
                                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                </filter>
                            </defs>
                            <path
                                d="M16 2L3 9.5V22.5L16 30L29 22.5V9.5L16 2Z"
                                stroke="url(#hexGradOuterFooter)"
                                strokeWidth="2.5"
                                strokeLinejoin="round"
                                filter="url(#hexGlowFooter)"
                                className="nb__hex-base"
                            />
                            <path
                                d="M16 7L9 11V19L16 23L23 19V11L16 7Z"
                                fill="url(#hexGradInnerFooter)"
                                className="nb__hex-inner"
                                opacity="0.85"
                            />
                            <circle cx="16" cy="15" r="2.5" fill="#ffffff" className="nb__hex-core" />
                        </svg>
                        <div className="nb__wordmark-wrapper">
                            <span className="nb__wordmark" style={{ fontSize: '1.25rem' }}>Hexagon</span>
                        </div>
                    </div>
                    <p className="ft__brand-desc">
                        Behavioral intelligence for elite strategic closers.
                        Decisive. Minimalist. Intelligent.
                    </p>
                </div>

                {/* Links */}
                <div className="ft__links-grid">
                    <div>
                        <div className="ft__col-title">Product</div>
                        <ul className="ft__col-links">
                            <li><a href="#features">Features</a></li>
                            <li><a href="#how-it-works">How it Works</a></li>
                            <li><a href="#pricing">Pricing</a></li>
                            <li><a href="#integrations">Integrations</a></li>
                        </ul>
                    </div>
                    <div>
                        <div className="ft__col-title">Company</div>
                        <ul className="ft__col-links">
                            <li><a href="#">About</a></li>
                            <li><a href="#">Blog</a></li>
                            <li><a href="#">Careers</a></li>
                            <li><a href="#">Contact</a></li>
                        </ul>
                    </div>
                    <div>
                        <div className="ft__col-title">Legal</div>
                        <ul className="ft__col-links">
                            <li><a href="#">Privacy</a></li>
                            <li><a href="#">Terms</a></li>
                            <li><a href="#">Security</a></li>
                            <li><a href="#">GDPR</a></li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="ft__bottom">
                <p className="ft__copy">© 2025 Hexagon — All rights reserved.</p>
                <div className="ft__bottom-links">
                    <a href="#">Privacy Policy</a>
                    <a href="#">Terms of Service</a>
                </div>
            </div>
        </div>
    </footer>
);

export default Footer;
