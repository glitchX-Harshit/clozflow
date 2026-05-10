import './Footer.css';

const Footer = () => (
    <footer className="ft__section">
        <div className="container">
            <div className="ft__top">
                {/* Brand */}
                <div className="ft__brand">
                    <div className="ft__logo">
                        <div className="ft__logo-mark">H</div>
                        <span className="ft__logo-text">
                            Hexagon
                        </span>
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
