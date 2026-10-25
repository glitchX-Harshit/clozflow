import React from 'react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

/**
 * HowItWorksPage
 * ─────────────────────────────────────────────────────────────
 * Clean slate ready for redesign from scratch.
 * ─────────────────────────────────────────────────────────────
 */
export default function HowItWorksPage() {
    return (
        <div 
            className="how-it-works-page-root"
            style={{
                minHeight: '100vh',
                backgroundColor: 'var(--bg, #f4f6f8)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
            }}
        >
            <Navbar />
            
            <main 
                style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '8rem 2rem 4rem 2rem',
                    textAlign: 'center',
                }}
            >
                {/* Redesign your new How It Works page here */}
            </main>

            <Footer />
        </div>
    );
}
