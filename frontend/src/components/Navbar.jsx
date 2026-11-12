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

const THEME_KEY = 'clozflow:marketing-theme';

const readTheme = () => {
  try {
    return sessionStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

/** The dark look only exists on marketing pages: it is set on <html> while a Navbar is mounted. */
const applyTheme = (mode) => {
  const root = document.documentElement;
  if (mode === 'dark') {
    root.classList.add('dark');
    root.style.setProperty('--bg', '#111110');
    root.style.setProperty('--text', '#F1EFEA');
  } else {
    root.classList.remove('dark');
    root.style.removeProperty('--bg');
    root.style.removeProperty('--text');
  }
};

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [mode, setMode] = useState(readTheme);

  // Apply the marketing theme; leaving the marketing pages restores the (light-only) product look.
  useEffect(() => {
    applyTheme(mode);
    return () => applyTheme('light');
  }, [mode]);

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
    try {
      sessionStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage blocked: the choice lasts until the next page.
    }
  };

  const navLinks = [
    {
      label: 'Product',
      href: '/#how-it-works',
      onClick: (e) => {
        e.preventDefault();
        if (location.pathname === '/') {
          document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' });
        } else {
          navigate('/#how-it-works');
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
          ClozFlow AI®
        </a>

        {/* Links + Theme Toggle + Contact CTA */}
        <ul className="editorial-navbar__links">
          {navLinks.map((l, i) => (
            <li key={i}>
              <a 
                className={`editorial-navbar__link ${l.active ? 'editorial-navbar__link--active' : ''}`} 
                href={l.href} 
                onClick={l.onClick}
                aria-current={l.active ? 'page' : undefined}
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
