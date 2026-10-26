import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './Navbar.css';

const SunIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.3" />
    <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const MoonIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M13.5 9.8A5.5 5.5 0 1 1 6.2 2.5a4.4 4.4 0 0 0 7.3 7.3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
);

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [mode, setMode] = useState(() => {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  });

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const toggleTheme = () => {
    const next = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    if (next === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.style.setProperty('--bg', '#111110');
      document.documentElement.style.setProperty('--text', '#F1EFEA');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.style.setProperty('--bg', '#f4f6f8');
      document.documentElement.style.setProperty('--text', '#0a0a0a');
    }
  };

  const navLinks = [
    {
      label: 'Product',
      href: '/#objections',
      onClick: (e) => {
        e.preventDefault();
        if (location.pathname === '/') {
          document.getElementById('objections')?.scrollIntoView({ behavior: 'smooth' });
        } else {
          navigate('/#objections');
        }
      },
    },
    {
      label: 'How it works',
      href: '/how-it-works',
      onClick: (e) => {
        e.preventDefault();
        navigate('/how-it-works');
      },
    },
    {
      label: 'Integrations',
      href: '/#integrations',
      onClick: (e) => {
        e.preventDefault();
        if (location.pathname === '/') {
          document.getElementById('integrations')?.scrollIntoView({ behavior: 'smooth' });
        } else {
          navigate('/#integrations');
        }
      },
    },
    {
      label: 'Pricing',
      href: '/pricing',
      active: location.pathname === '/pricing',
      onClick: (e) => {
        e.preventDefault();
        navigate('/pricing');
      },
    },
  ];

  return (
    <header className={`editorial-navbar ${scrolled ? 'editorial-navbar--scrolled' : ''}`}>
      <nav className="editorial-navbar__inner" aria-label="Primary">
        {/* Brand */}
        <a 
          className="editorial-navbar__brand" 
          href="/" 
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
        >
          ClozFlow®
        </a>

        {/* Links + Theme Toggle + Contact CTA */}
        <ul className="editorial-navbar__links">
          {navLinks.map((l, i) => (
            <li key={i}>
              <a 
                className={`editorial-navbar__link ${l.active ? 'editorial-navbar__link--active' : ''}`} 
                href={l.href} 
                onClick={l.onClick}
              >
                {l.label}
              </a>
            </li>
          ))}

          {/* Theme Toggle */}
          <li className="editorial-navbar__keep">
            <button
              type="button"
              className="editorial-navbar__theme"
              aria-label={mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={toggleTheme}
            >
              {mode === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
          </li>

          {/* Contact Pill CTA */}
          <li className="editorial-navbar__keep">
            <a 
              className="editorial-navbar__navcta" 
              href="/auth" 
              onClick={(e) => {
                e.preventDefault();
                navigate('/auth', { state: { view: 'login' } });
              }}
            >
              Contact
            </a>
          </li>
        </ul>
      </nav>
    </header>
  );
}
