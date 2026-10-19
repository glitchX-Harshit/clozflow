import React from 'react';
import { useNavigate } from 'react-router-dom';
import MarqueeAlongSvgPath from '@/components/ui/marquee-along-svg-path';
import './MarqueePathSection.css';

const IMGS = [
  "https://cdn.cosmos.so/b9909337-7a53-48bc-9672-33fbd0f040a1?format=jpeg",
  "https://cdn.cosmos.so/ecdc9dd7-2862-4c28-abb1-dcc0947390f3?format=jpeg",
  "https://cdn.cosmos.so/79de41ec-baa4-4ac0-a9a4-c090005ca640?format=jpeg",
  "https://cdn.cosmos.so/1a18b312-21cd-4484-bce5-9fb7ed1c5e01?format=jpeg",
  "https://cdn.cosmos.so/d765f64f-7a66-462f-8b2d-3d7bc8d7db55?format=jpeg",
  "https://cdn.cosmos.so/6b9f08ea-f0c5-471f-a620-71221ff1fb65?format=jpeg",
  "https://cdn.cosmos.so/40a09525-4b00-4666-86f0-3c45f5d77605?format=jpeg",
  "https://cdn.cosmos.so/14f05ab6-b4d0-4605-9007-8a2190a249d0?format=jpeg",
  "https://cdn.cosmos.so/d05009a2-a2f8-4a4c-a0de-e1b0379dddb8?format=jpeg",
  "https://cdn.cosmos.so/ba646e35-efc2-494a-961b-b40f597e6fc9?format=jpeg",
  "https://cdn.cosmos.so/e899f9c3-ed48-4899-8c16-fbd5a60705da?format=jpeg",
  "https://cdn.cosmos.so/24e83c11-c607-45cd-88fb-5059960b56a0?format=jpeg",
  "https://cdn.cosmos.so/cd346bce-f415-4ea7-8060-99c5f7c1741a?format=jpeg",
];

// Continuous ribbon path extracted and fitted 1:1 to Typographic Ribbon Sales Engine.png (1855x848 space)
const SVG_PATH =
  "M -40 640 " +
  "C 30 540 130 430 230 330 " +
  "C 340 220 460 110 600 -40 " +
  "C 720 -150 940 -120 1060 -30 " +
  "C 1130 50 1180 165 1260 165 " +
  "C 1340 165 1390 60 1480 -30 " +
  "C 1560 -120 1740 -80 1830 10 " +
  "C 1880 70 1780 170 1680 270 " +
  "C 1560 380 1465 460 1465 540 " +
  "C 1465 640 1540 730 1660 800 " +
  "C 1760 860 1860 910 1930 960 " +
  "C 1750 1040 1250 1000 850 950 " +
  "C 650 920 480 870 330 880 " +
  "C 220 890 100 860 35 780 " +
  "C -30 700 -20 630 -40 640 Z";

// Secondary arch strip matching the user's red stroke path at the lower right
const SVG_PATH_STRIP_2 =
  "M 960 960 " +
  "C 1040 820 1130 715 1230 700 " +
  "C 1350 680 1520 770 1720 950";

const IMGS_STRIP_2 = [
  IMGS[4], // teal cursive
  IMGS[6], // red 'A'
  IMGS[5], // blue 'g'
  IMGS[1], // green '&'
  IMGS[9], // orange 0123
  IMGS[2], // pink typography
  IMGS[8], // black knot
  IMGS[7], // dark green glyph
];

export default function MarqueePathSection({ onGetStarted }) {
  const [container, setContainer] = React.useState(null);
  const navigate = useNavigate();

  const handleCta = () => {
    if (onGetStarted) {
      onGetStarted();
    } else {
      navigate('/dashboard');
    }
  };

  return (
    <section 
      className="mps__section" 
      ref={(node) => setContainer(node)} 
      id="marquee-stream"
    >
      {/* ── Marquee Along Svg Path Orbit Stage ── */}
      <div className="mps__stage">
        {/* Strip 2: Lower-Right Secondary Arch (matches user-drawn stroke) */}
        <MarqueeAlongSvgPath
          path={SVG_PATH_STRIP_2}
          pathId="mps-secondary-strip"
          viewBox="0 0 1855 848"
          baseVelocity={24.5}
          scrollSensitivity={0.09}
          showPath={false}
          slowdownOnHover={true}
          draggable={true}
          dragAwareDirection
          dragVelocityDecay={0.98}
          scrollAwareDirection={true}
          useScrollVelocity={true}
          scrollContainer={{ current: container }}
          repeat={1}
          enableRollingZIndex={true}
          dragSensitivity={0.05}
          className="absolute top-0 w-full h-full pointer-events-auto"
          responsive
          grabCursor
        >
          {IMGS_STRIP_2.map((img, i) => (
            <div key={`s2-${i}`} className="mps__img-card">
              <img
                src={img}
                alt={`Tile ${i}`}
                className="w-full h-full object-cover"
                draggable={false}
              />
            </div>
          ))}
        </MarqueeAlongSvgPath>

        {/* Strip 1: Main Framing Ribbon */}
        <MarqueeAlongSvgPath
          path={SVG_PATH}
          pathId="mps-main-strip"
          viewBox="0 0 1855 848"
          baseVelocity={4}
          scrollSensitivity={0.015}
          showPath={false}
          slowdownOnHover={true}
          draggable={true}
          dragAwareDirection
          dragVelocityDecay={0.98}
          scrollAwareDirection={true}
          useScrollVelocity={true}
          scrollContainer={{ current: container }}
          repeat={4}
          enableRollingZIndex={true}
          dragSensitivity={0.01}
          className="absolute top-0 w-full h-full pointer-events-auto"
          responsive
          grabCursor
        >
          {IMGS.map((img, i) => (
            <div key={`s1-${i}`} className="mps__img-card">
              <img
                src={img}
                alt={`Example ${i}`}
                className="w-full h-full object-cover"
                draggable={false}
              />
            </div>
          ))}
        </MarqueeAlongSvgPath>
      </div>

      {/* ── Central Focal Engine & High-Conversion CTA Block ── */}
      <div className="mps__center-content">
        <h2 className="mps__headline">
          <span className="mps__headline-row">
            आप <span className="mps__headline-latin">product</span> बनाओ<span className="mps__headline-dot">.</span>
          </span>
          <span className="mps__headline-row">
            <span className="mps__headline-latin">Sales</span> की दौड़
          </span>
          <span className="mps__headline-row mps__headline-highlight">
            हम संभालेंगे<span className="mps__headline-dot">.</span>
          </span>
        </h2>

        <p className="mps__subheadline">
          From finding the right prospects to moving sales conversations forward.
        </p>

        <button 
          type="button" 
          className="mps__cta-btn" 
          onClick={handleCta}
        >
          <span>Build your sales engine</span>
          <span className="mps__cta-arrow">↗</span>
        </button>
      </div>
    </section>
  );
}
