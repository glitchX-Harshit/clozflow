import React, { useEffect, useState } from 'react';
import { motion, useMotionValue, useSpring, animate } from 'framer-motion';
import './FramerAnimationLoader.css';

/**
 * Exact React implementation of the Framer "Animation loader" by yahya:
 * Ref: https://framer.com/m/Animation-loader-eHagKV.js@ijRh61gfd3rmanud1uxr
 *
 * Features:
 * - Brand entrance with character blur & spring reveal
 * - Synchronized horizontal progress line
 * - Giant typographic counter (0% -> 100%)
 * - Curvature mask morph and curtain reveal exit
 */
export default function FramerAnimationLoader({
  brandName = "clozflow®",
  counterDuration = 2.8,
  textColor = "#0a0a0a",
  background = "#ffffff",
  onComplete,
}) {
  const [displayCount, setDisplayCount] = useState(0);
  const [isExiting, setIsExiting] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  // Counter animation using framer-motion values
  const countMotion = useMotionValue(0);
  const smoothCount = useSpring(countMotion, {
    duration: counterDuration * 1000,
    bounce: 0,
  });

  useEffect(() => {
    // 1. Lock scrolling on mount
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
    window.scrollTo(0, 0);

    if (window.lenis) {
      window.lenis.scrollTo(0, { immediate: true });
      window.lenis.stop();
    }

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // 2. Start counter animation
    countMotion.set(100);

    const unsubscribe = smoothCount.on('change', (latest) => {
      setDisplayCount(Math.round(latest));
    });

    // 3. Trigger exit sequence right when counter reaches 100%
    const exitTimer = setTimeout(() => {
      setIsExiting(true);
    }, counterDuration * 1000 + 150);

    return () => {
      unsubscribe();
      clearTimeout(exitTimer);
      document.body.style.overflow = prevOverflow;
      window.lenis?.start();
    };
  }, [counterDuration, countMotion, smoothCount]);

  const handleAnimationComplete = () => {
    if (isExiting) {
      setIsVisible(false);
      window.scrollTo(0, 0);
      if (window.lenis) {
        window.lenis.scrollTo(0, { immediate: true });
        window.lenis.start();
      }
      document.body.style.overflow = '';
      if (onComplete) onComplete();
    }
  };

  if (!isVisible) return null;

  return (
    <div
      className="framer-loader-root"
      style={{
        pointerEvents: isExiting ? 'none' : 'all',
      }}
      aria-live="polite"
      aria-label="Loading page"
    >
      <motion.div
        className="framer-loader-mask"
        style={{
          backgroundColor: background,
          color: textColor,
        }}
        initial={{
          y: '0%',
          borderBottomLeftRadius: '0px',
          borderBottomRightRadius: '0px',
        }}
        animate={
          isExiting
            ? {
                y: '-100%',
                borderBottomLeftRadius: '45vw 25vh',
                borderBottomRightRadius: '45vw 25vh',
              }
            : {
                y: '0%',
                borderBottomLeftRadius: '0px',
                borderBottomRightRadius: '0px',
              }
        }
        transition={{
          duration: 0.75,
          ease: [0.77, 0.02, 0.24, 1.02],
        }}
        onAnimationComplete={handleAnimationComplete}
      >
        <div className="framer-loader-content">
          {/* Top Brand Name */}
          <div className="framer-loader-top">
            <motion.h1
              className="framer-loader-brand"
              initial={{ filter: 'blur(10px)', opacity: 0, y: 10 }}
              animate={{ filter: 'blur(0px)', opacity: 1, y: 0 }}
              transition={{
                type: 'spring',
                stiffness: 200,
                damping: 40,
                mass: 1,
                delay: 0.08,
              }}
            >
              {brandName}
            </motion.h1>
          </div>

          {/* Middle Synchronized Bar Line */}
          <div className="framer-loader-middle">
            <div
              className="framer-loader-bar-track"
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.06)',
              }}
            >
              <motion.div
                className="framer-loader-bar-fill"
                style={{
                  backgroundColor: textColor,
                }}
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{
                  duration: counterDuration,
                  ease: [0.12, 0.23, 0.5, 1],
                  delay: 0.05,
                }}
              />
            </div>
          </div>

          {/* Bottom Right Massive Percentage Counter */}
          <div className="framer-loader-bottom">
            <div className="framer-loader-counter-wrap">
              <span className="framer-loader-number">{displayCount}</span>
              <span className="framer-loader-percent">%</span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
