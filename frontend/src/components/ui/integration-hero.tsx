"use client";

import React from "react";

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
    <section className="ih__section">
      {/* Light dot grid background */}
      <div 
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(circle at center, rgba(0, 0, 0, 0.055) 1.2px, transparent 1.2px)',
          backgroundSize: '28px 28px',
          pointerEvents: 'none',
        }}
      />

      {/* Main Centered Container */}
      <div className="ih__container">
        {/* Top Pill Badge */}
        <div className="ih__badge">
          <span style={{ fontSize: '13px', fontWeight: 500, color: '#334155', letterSpacing: '-0.01em' }}>
            Integrations
          </span>
        </div>

        {/* Heading */}
        <h2 className="ih__title">
          Integrate with favorite tools
        </h2>

        {/* Subtitle */}
        <p className="ih__subtitle">
          250+ top apps are available to integrate seamlessly with your workflow.
        </p>

        {/* CTA Button */}
        <button
          type="button"
          className="ih__btn"
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
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#262626')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#000000')}
        >
          Contact us
        </button>

        {/* Carousel Container */}
        <div style={{ position: 'relative', width: '100%', overflow: 'hidden', paddingBottom: '16px' }}>
          {/* Row 1 */}
          <div 
            className="ih__marquee-row"
            style={{
              animation: 'scroll-left 35s linear infinite',
            }}
          >
            {repeatedIcons(ICONS_ROW1, 4).map((src, i) => (
              <div 
                key={i} 
                className="ih__icon-card"
              >
                <img 
                  src={src} 
                  alt="integration icon" 
                  className="ih__icon-img"
                  loading="lazy"
                />
              </div>
            ))}
          </div>

          {/* Row 2 */}
          <div 
            className="ih__marquee-row"
            style={{
              marginTop: '18px',
              animation: 'scroll-right 35s linear infinite',
            }}
          >
            {repeatedIcons(ICONS_ROW2, 4).map((src, i) => (
              <div 
                key={i} 
                className="ih__icon-card"
              >
                <img 
                  src={src} 
                  alt="integration icon" 
                  className="ih__icon-img"
                  loading="lazy"
                />
              </div>
            ))}
          </div>

          {/* Left Fade Overlay */}
          <div 
            aria-hidden="true"
            className="ih__fade-overlay ih__fade-left"
          />
          {/* Right Fade Overlay */}
          <div 
            aria-hidden="true"
            className="ih__fade-overlay ih__fade-right"
          />
        </div>
      </div>

      <style>{`
        .ih__section {
          position: relative;
          padding: 100px 0 110px 0;
          overflow: hidden;
          background-color: var(--bg, #f4f6f8);
          width: 100%;
        }

        .ih__container {
          position: relative;
          max-width: 1280px;
          margin: 0 auto;
          padding: 0 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          width: 100%;
          box-sizing: border-box;
        }

        .ih__badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 6px 18px;
          border-radius: 9999px;
          border: 1px solid #e2e8f0;
          background-color: #ffffff;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
          margin-bottom: 20px;
        }

        .ih__title {
          font-size: clamp(1.85rem, 5vw, 3.6rem);
          font-weight: 800;
          color: #000000;
          line-height: 1.15;
          letter-spacing: -0.035em;
          text-align: center;
          margin: 0 0 16px 0;
          text-wrap: balance;
          font-family: var(--font-display, inherit);
          max-width: 900px;
          word-break: break-word;
        }

        .ih__subtitle {
          font-size: clamp(0.95rem, 2vw, 1.125rem);
          color: #64748b;
          font-weight: 400;
          line-height: 1.55;
          max-width: 580px;
          margin: 0 auto 30px auto;
          text-align: center;
        }

        .ih__btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 44px;
          padding: 0 26px;
          background-color: #000000;
          color: #ffffff;
          font-size: 14px;
          font-weight: 500;
          border-radius: 8px;
          border: none;
          cursor: pointer;
          margin-bottom: 50px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
          transition: background-color 0.2s ease, transform 0.15s ease;
        }

        .ih__marquee-row {
          display: flex;
          gap: 28px;
          white-space: nowrap;
          width: max-content;
        }

        .ih__icon-card {
          width: 68px;
          height: 68px;
          min-width: 68px;
          min-height: 68px;
          border-radius: 50%;
          background-color: #ffffff;
          box-shadow: 0 4px 18px rgba(0, 0, 0, 0.06);
          border: 1px solid rgba(0, 0, 0, 0.05);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 14px;
          flex-shrink: 0;
          transition: transform 0.2s ease;
        }

        .ih__icon-img {
          width: 38px;
          height: 38px;
          object-fit: contain;
          display: block;
        }

        .ih__fade-overlay {
          position: absolute;
          top: 0;
          height: 100%;
          width: 140px;
          pointer-events: none;
          z-index: 10;
        }
        .ih__fade-left {
          left: 0;
          background: linear-gradient(to right, var(--bg, #f4f6f8) 25%, transparent 100%);
        }
        .ih__fade-right {
          right: 0;
          background: linear-gradient(to left, var(--bg, #f4f6f8) 25%, transparent 100%);
        }

        @keyframes scroll-left {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes scroll-right {
          0% { transform: translateX(-50%); }
          100% { transform: translateX(0); }
        }

        /* ── Mobile Tablet Adaptations ── */
        @media (max-width: 768px) {
          .ih__section {
            padding: 64px 0 72px 0;
          }
          .ih__container {
            padding: 0 16px;
          }
          .ih__badge {
            padding: 5px 14px;
            margin-bottom: 16px;
          }
          .ih__title {
            font-size: clamp(1.65rem, 6vw, 2.25rem);
            letter-spacing: -0.025em;
            margin-bottom: 12px;
          }
          .ih__subtitle {
            font-size: 0.95rem;
            margin-bottom: 24px;
            padding: 0 8px;
          }
          .ih__btn {
            height: 42px;
            padding: 0 22px;
            font-size: 13.5px;
            margin-bottom: 36px;
          }
          .ih__marquee-row {
            gap: 16px;
          }
          .ih__icon-card {
            width: 52px;
            height: 52px;
            min-width: 52px;
            min-height: 52px;
            padding: 10px;
          }
          .ih__icon-img {
            width: 28px;
            height: 28px;
          }
          .ih__fade-overlay {
            width: 50px;
          }
        }

        /* ── Mobile Phone Adaptations (<480px) ── */
        @media (max-width: 480px) {
          .ih__section {
            padding: 48px 0 56px 0;
          }
          .ih__title {
            font-size: 1.62rem;
            line-height: 1.2;
          }
          .ih__subtitle {
            font-size: 0.88rem;
            line-height: 1.5;
            margin-bottom: 20px;
          }
          .ih__marquee-row {
            gap: 13px;
          }
          .ih__icon-card {
            width: 46px;
            height: 46px;
            min-width: 46px;
            min-height: 46px;
            padding: 9px;
          }
          .ih__icon-img {
            width: 24px;
            height: 24px;
          }
          .ih__fade-overlay {
            width: 36px;
          }
        }
      `}</style>
    </section>
  );
}
