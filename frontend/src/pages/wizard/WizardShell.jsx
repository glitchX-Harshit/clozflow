import { ArrowLeft, BookOpen, Home, Plus, Settings } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useDashboardStore } from '../../store/useDashboardStore';
import '../WizardPage.css';

const LINKS = [
    { to: '/wizard', label: 'Home', icon: Home, end: true },
    { to: '/wizard/new', label: 'New meeting', icon: Plus },
    { to: '/wizard/battlecards', label: 'Battlecards', icon: BookOpen },
    { to: '/wizard/settings', label: 'Settings', icon: Settings },
];

/**
 * Frame for the stand-alone Wizard routes (/wizard/*): a slim bar with the
 * section links and a way back to the dashboard. The dashboard's Wizard tab
 * renders the home page without this shell.
 */
export default function WizardShell({ children, width = 'wide' }) {
    const navigate = useNavigate();
    const backToDashboard = () => {
        useDashboardStore.getState().setActiveTab('wizard');
        navigate('/dashboard?tab=wizard');
    };
    return (
        <div className="wz-shell" data-lenis-prevent="true">
            <header className="wz-shell__bar">
                <button type="button" className="wz-shell__back" onClick={backToDashboard}>
                    <ArrowLeft size={15} aria-hidden="true" /> Dashboard
                </button>
                <nav className="wz-shell__nav" aria-label="Meeting Wizard">
                    {LINKS.map((link) => {
                        const Icon = link.icon;
                        return (
                            <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => `wz-shell__link ${isActive ? 'wz-shell__link--active' : ''}`}>
                                <Icon size={14} aria-hidden="true" /> {link.label}
                            </NavLink>
                        );
                    })}
                </nav>
            </header>
            <main className={`wz-page-container wz-page-container--${width}`}>{children}</main>
        </div>
    );
}
