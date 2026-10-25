"use client";

import React from "react";
import { Button } from "./button";

const ICONS_ROW1 = [
  "https://cdn.21st.dev/assets/mirror/86/8622b1a4306b413670d9d200591dac7a11d02f70dc525683e44ba14b91737a90.png",
  "https://cdn.21st.dev/assets/mirror/8e/8ee5be289b25fe1868edb80dd7ebd3f8de6f9cc581c1324261bc74146a2bd0e8.png",
  "https://cdn.21st.dev/assets/mirror/b6/b6f94ff4cf6d63ecd9945dd0c6fd806c82afad8cb1f4b350cb0ff9297d6fdb74.png",
  "https://cdn.21st.dev/assets/mirror/8e/8ec92b4cf29e37b05768a5b7027ff6da920ebeec32e16b4063f5b70617fc079d.png",
  "https://cdn.21st.dev/assets/mirror/83/8387574f7ebab08465d1419134bbff0e73bc26ca7220b18d16a264d67f996116.png",
  "https://cdn.21st.dev/assets/mirror/61/61243e3e521df8314819e9929dd5d53d53dc3161545b0fc74c27edf96130190d.png",
  "https://cdn.21st.dev/assets/mirror/a1/a1a606bc6e11ae6714100008321081c24019489862df4243fe436a51adff5ab4.png",
];

const ICONS_ROW2 = [
  "https://cdn.21st.dev/assets/mirror/9e/9eb6ffcfa297dc25aebd90fd7930e9d4ad724d8cd496d4621df28ddc29631d77.png",
  "https://cdn.21st.dev/assets/mirror/e8/e899b6d586e1dc1058236c2f16969da36e3a7bdf126a51153ed723e710995823.png",
  "https://cdn.21st.dev/assets/mirror/e6/e6a8797615bf186b1e2bbe586dc3bb2a0b13a8924ba1ead2a431bd3e7d95dd70.png",
  "https://cdn.21st.dev/assets/mirror/fb/fbae1b43d23969d7c2078467a5431adc4b6b39d88d88a3710ed9b08c51a9fd3d.png",
  "https://cdn.21st.dev/assets/mirror/03/03b8741ba2f1e519cafd7c185ece02da69086370a576ec27d0d014a5864ede2e.png",
  "https://cdn.21st.dev/assets/mirror/d2/d2e9f9dda468cbbf30b63ec62ed81dfbea099e09552632d4be89570a8486ec50.png",
  "https://cdn.21st.dev/assets/mirror/a7/a7e2f5f2c86fba897e233c7a04830382b81b31603b4d1f05a46fcd5c7e4d45c8.png",
];

// Utility to repeat icons enough times
const repeatedIcons = (icons: string[], repeat = 4) => Array.from({ length: repeat }).flatMap(() => icons);

export default function IntegrationHero() {
  return (
    <section 
      style={{
        position: 'relative',
        padding: '110px 0 120px 0',
        overflow: 'hidden',
        backgroundColor: 'var(--bg, #f4f6f8)',
        width: '100%',
      }}
    >
      {/* Light dot grid background */}
      <div 
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(circle at center, rgba(15, 23, 42, 0.055) 1.2px, transparent 1.2px)',
          backgroundSize: '28px 28px',
          pointerEvents: 'none',
        }}
      />

      {/* Main Centered Container */}
      <div 
        style={{
          position: 'relative',
          maxWidth: '1280px',
          margin: '0 auto',
          padding: '0 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          width: '100%',
        }}
      >
        {/* Top Pill Badge */}
        <div 
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '6px 18px',
            borderRadius: '9999px',
            border: '1px solid #e2e8f0',
            backgroundColor: '#ffffff',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
            marginBottom: '22px',
          }}
        >
          <span style={{ fontSize: '13px', fontWeight: 500, color: '#334155', letterSpacing: '-0.01em' }}>
            Integrations
          </span>
        </div>

        {/* Heading */}
        <h2 
          style={{
            fontSize: 'clamp(2.25rem, 5vw, 3.75rem)',
            fontWeight: 800,
            color: '#0f172a',
            lineHeight: 1.15,
            letterSpacing: '-0.03em',
            textTransform: 'none',
            textAlign: 'center',
            margin: '0 0 16px 0',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--font-display, inherit)',
          }}
        >
          Integrate with favorite tools
        </h2>

        {/* Subtitle */}
        <p 
          style={{
            fontSize: 'clamp(1rem, 2vw, 1.125rem)',
            color: '#64748b',
            fontWeight: 400,
            lineHeight: 1.6,
            maxWidth: '580px',
            margin: '0 auto 32px auto',
            textAlign: 'center',
          }}
        >
          250+ top apps are available to integrate seamlessly with your workflow.
        </p>

        {/* CTA Button */}
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined") {
              const contactEl = document.getElementById("contact") || document.getElementById("footer");
              if (contactEl) {
                contactEl.scrollIntoView({ behavior: "smooth" });
              } else {
                window.location.href = "/auth";
              }
            }
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '44px',
            padding: '0 26px',
            backgroundColor: '#000000',
            color: '#ffffff',
            fontSize: '14px',
            fontWeight: 500,
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            marginBottom: '58px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)',
            transition: 'background-color 0.2s ease, transform 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#262626')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#000000')}
        >
          Contact us
        </button>

        {/* Carousel Container */}
        <div style={{ position: 'relative', width: '100%', overflow: 'hidden', paddingBottom: '16px' }}>
          {/* Row 1 */}
          <div 
            style={{
              display: 'flex',
              gap: '32px',
              whiteSpace: 'nowrap',
              width: 'max-content',
              animation: 'scroll-left 35s linear infinite',
            }}
          >
            {repeatedIcons(ICONS_ROW1, 4).map((src, i) => (
              <div 
                key={i} 
                style={{
                  width: '72px',
                  height: '72px',
                  minWidth: '72px',
                  minHeight: '72px',
                  borderRadius: '50%',
                  backgroundColor: '#ffffff',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.06)',
                  border: '1px solid rgba(0, 0, 0, 0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '16px',
                  flexShrink: 0,
                }}
              >
                <img 
                  src={src} 
                  alt="integration icon" 
                  style={{
                    width: '40px',
                    height: '40px',
                    objectFit: 'contain',
                    display: 'block',
                  }} 
                />
              </div>
            ))}
          </div>

          {/* Row 2 */}
          <div 
            style={{
              display: 'flex',
              gap: '32px',
              whiteSpace: 'nowrap',
              width: 'max-content',
              marginTop: '22px',
              animation: 'scroll-right 35s linear infinite',
            }}
          >
            {repeatedIcons(ICONS_ROW2, 4).map((src, i) => (
              <div 
                key={i} 
                style={{
                  width: '72px',
                  height: '72px',
                  minWidth: '72px',
                  minHeight: '72px',
                  borderRadius: '50%',
                  backgroundColor: '#ffffff',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.06)',
                  border: '1px solid rgba(0, 0, 0, 0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '16px',
                  flexShrink: 0,
                }}
              >
                <img 
                  src={src} 
                  alt="integration icon" 
                  style={{
                    width: '40px',
                    height: '40px',
                    objectFit: 'contain',
                    display: 'block',
                  }} 
                />
              </div>
            ))}
          </div>

          {/* Left Fade Overlay */}
          <div 
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              height: '100%',
              width: '160px',
              pointerEvents: 'none',
              zIndex: 10,
              background: 'linear-gradient(to right, var(--bg, #f4f6f8) 25%, transparent 100%)',
            }}
          />
          {/* Right Fade Overlay */}
          <div 
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              height: '100%',
              width: '160px',
              pointerEvents: 'none',
              zIndex: 10,
              background: 'linear-gradient(to left, var(--bg, #f4f6f8) 25%, transparent 100%)',
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes scroll-left {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes scroll-right {
          0% { transform: translateX(-50%); }
          100% { transform: translateX(0); }
        }
      `}</style>
    </section>
  );
}
