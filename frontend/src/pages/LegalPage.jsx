import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import './HowItWorksPage.css';

const SALES_EMAIL = 'info@clozflow.in';
const SUPPORT_EMAIL = 'support@clozflow.com';
const LOCAL_MODE = import.meta.env.VITE_AUTH_MODE === 'local';

const mail = (address, subject) => `mailto:${address}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;

const RELATED = [
    { to: '/terms', label: 'Terms of Service' },
    { to: '/privacy', label: 'Privacy Policy' },
    { to: '/ai-voice-policy', label: 'AI & Voice Policy' },
    { to: '/contact', label: 'Contact' },
];

/**
 * Minimal, honest pages behind the legal / contact links (auth screens, footer,
 * How It Works). The full legal texts aren't published yet, so these say so and
 * point to a real contact instead of silently bouncing to the landing page.
 */
const PAGES = {
    terms: {
        tag: 'Legal',
        title: 'Terms of Service',
        subtitle: 'The full ClozFlow Terms of Service are being finalised and will be published on this page.',
        body: (
            <p>
                Until then, if you have a question about using ClozFlow (accounts, billing or acceptable use), write to{' '}
                <a href={mail(SALES_EMAIL, 'Terms of Service')}>{SALES_EMAIL}</a> and we will reply directly.
            </p>
        ),
    },
    privacy: {
        tag: 'Legal',
        title: 'Privacy Policy',
        subtitle: 'The full ClozFlow Privacy Policy is being finalised and will be published on this page.',
        body: (
            <>
                {LOCAL_MODE && <p>Your account and sessions are saved on this PC. Gemini receives text for reasoning.</p>}
                <p>
                    You can delete your call history, or your whole account, at any time from Settings › Danger Zone. For any other
                    question about your data, write to <a href={mail(SALES_EMAIL, 'Privacy question')}>{SALES_EMAIL}</a>.
                </p>
            </>
        ),
    },
    'ai-voice-policy': {
        tag: 'Legal',
        title: 'AI & Voice Policy',
        subtitle: 'The ClozFlow AI & Voice Policy is being finalised and will be published on this page.',
        body: (
            <p>
                Questions about how ClozFlow's AI voice agents and live call guidance work? Write to{' '}
                <a href={mail(SALES_EMAIL, 'AI & Voice Policy')}>{SALES_EMAIL}</a>.
            </p>
        ),
    },
    contact: {
        tag: 'Contact',
        title: 'Talk to the ClozFlow team.',
        subtitle: 'Pilots, pricing, integrations or an architecture consultation: write to us and a person replies.',
        body: (
            <>
                <p>
                    <strong>Sales &amp; general enquiries:</strong>{' '}
                    <a href={mail(SALES_EMAIL, 'ClozFlow enquiry')}>{SALES_EMAIL}</a>
                </p>
                <p>
                    <strong>Product support:</strong>{' '}
                    <a href={mail(SUPPORT_EMAIL, 'Support Inquiry')}>{SUPPORT_EMAIL}</a>
                </p>
                <div className="hiw-cta-links" style={{ marginTop: 32 }}>
                    <a href={mail(SALES_EMAIL, 'Architecture consultation')} className="hiw-link-btn">
                        Book Architecture Consultation →
                    </a>
                    <Link to="/pricing" className="hiw-link-text">View Transparent Pricing</Link>
                </div>
            </>
        ),
    },
};

export default function LegalPage({ page }) {
    const content = PAGES[page] || PAGES.contact;

    useEffect(() => {
        const previous = document.title;
        document.title = `${content.title.replace(/\.$/, '')} · ClozFlow`;
        window.scrollTo(0, 0);
        return () => {
            document.title = previous;
        };
    }, [content.title]);

    return (
        <div className="hiw-root">
            <Navbar />
            <main className="hiw-container">
                <header className="hiw-header">
                    <span className="hiw-tag">{content.tag}</span>
                    <h1 className="hiw-title">{content.title}</h1>
                    <p className="hiw-subtitle">{content.subtitle}</p>
                </header>
                <article className="hiw-body">
                    {content.body}
                    <nav aria-label="Related pages" className="hiw-meta-line" style={{ flexWrap: 'wrap' }}>
                        {RELATED.filter((item) => item.to !== `/${page}`).map((item) => (
                            <Link key={item.to} to={item.to} className="hiw-share-link">{item.label}</Link>
                        ))}
                    </nav>
                </article>
            </main>
            <Footer />
        </div>
    );
}
