import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import './WebPreload.css';

const BRAND_LETTERS = ['c', 'l', 'o', 'z', 'f', 'l', 'o', 'w'];

export default function WebPreload({ onComplete }) {
    const [isExiting, setIsExiting] = useState(false);
    const [isVisible, setIsVisible] = useState(true);

    // Responsive sizing proportional to ClozFlow Montserrat Black logo
    const [size, setSize] = useState(84);

    useEffect(() => {
        const updateSize = () => {
            if (window.innerWidth < 640) {
                setSize(52);
            } else if (window.innerWidth < 1024) {
                setSize(68);
            } else {
                setSize(84);
            }
        };
        updateSize();
        window.addEventListener('resize', updateSize);
        return () => window.removeEventListener('resize', updateSize);
    }, []);

    const fontSize = size;
    const dotSize = Math.max(12, size * 0.175);

    // Lock page scroll on mount while preloader is active & ensure top scroll on reload
    useEffect(() => {
        // Disable browser's automatic scroll restoration on reload
        if ('scrollRestoration' in window.history) {
            window.history.scrollRestoration = 'manual';
        }

        // Immediately enforce scroll position at top
        window.scrollTo(0, 0);
        if (window.lenis) {
            window.lenis.scrollTo(0, { immediate: true });
            window.lenis.stop();
        }

        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        // Preload timing: after 2.4s, trigger the high-tension curtain exit
        const exitTimer = setTimeout(() => {
            setIsExiting(true);
        }, 2400);

        return () => {
            clearTimeout(exitTimer);
            document.body.style.overflow = prevOverflow;
            window.lenis?.start();
        };
    }, []);

    const handleCurtainComplete = () => {
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
        <motion.div
            className="wp-root"
            initial={{ y: '0%' }}
            animate={isExiting ? { y: '-100%' } : { y: '0%' }}
            transition={{
                duration: 1.05,
                ease: [1, 0.01, 0.38, 1.01],
                type: 'tween'
            }}
            onAnimationComplete={handleCurtainComplete}
            aria-live="polite"
            aria-label="Loading ClozFlow"
        >
            <div className="wp-bg">
                {/* ── 1st Circular Geometry: Starts Visibly in Top-Left Corner → Glides to Right ── */}
                <motion.div
                    className="wp-radial wp-radial--top"
                    initial={{
                        opacity: 0.7,
                        x: '0vw'
                    }}
                    animate={{
                        opacity: 0.7,
                        x: ['0vw', '42vw', '86vw']
                    }}
                    transition={{
                        duration: 2.35,
                        times: [0, 0.5, 1],
                        ease: [0.45, 0.05, 0.55, 0.95]
                    }}
                />

                {/* ── Bottom Circular Geometry: Starts Visibly in Bottom-Right Corner → Glides to Left ── */}
                <motion.div
                    className="wp-radial wp-radial--bottom"
                    initial={{
                        opacity: 0.7,
                        x: '0vw'
                    }}
                    animate={{
                        opacity: 0.7,
                        x: ['0vw', '-42vw', '-86vw']
                    }}
                    transition={{
                        duration: 2.35,
                        times: [0, 0.5, 1],
                        ease: [0.45, 0.05, 0.55, 0.95]
                    }}
                />

                {/* ── Center Content Container (Inner Upward Parallax Shift y: -80px) ── */}
                <motion.div
                    className="wp-content"
                    animate={isExiting ? { y: -80, opacity: 0.3 } : { y: 0, opacity: 1 }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                >
                    {/* ── clozflow. Character Blur & Spring Reveal (Montserrat Black 900) ── */}
                    <div className="wp-logo-wrap">
                        <div 
                            className="wp-logo-baseline"
                            style={{ paddingBottom: `${Math.max(4, size * 0.06)}px` }}
                        >
                            <span 
                                className="wp-logo-chars-track"
                                style={{
                                    fontFamily: '"Montserrat", sans-serif',
                                    fontSize: `${fontSize}px`,
                                    fontWeight: 900,
                                    letterSpacing: '-0.055em',
                                    color: '#0a0a0a',
                                    lineHeight: 1
                                }}
                            >
                                {/* Animated individual letters */}
                                {BRAND_LETTERS.map((char, i) => (
                                    <motion.span
                                        key={i}
                                        className="wp-char"
                                        initial={{
                                            opacity: 0,
                                            filter: 'blur(14px)',
                                            scale: 2.4,
                                            x: 40,
                                            rotateX: -15
                                        }}
                                        animate={{
                                            opacity: 1,
                                            filter: 'blur(0px)',
                                            scale: 1,
                                            x: 0,
                                            rotateX: 0
                                        }}
                                        transition={{
                                            type: 'spring',
                                            stiffness: 380,
                                            damping: 36,
                                            mass: 1,
                                            delay: 0.12 + i * 0.05
                                        }}
                                    >
                                        {char}
                                    </motion.span>
                                ))}

                                {/* ── THE UPGRADED ELECTRIC BLUE TO CYAN GRADIENT DOT ── */}
                                <motion.span
                                    className="wp-dot-spring"
                                    style={{
                                        width: `${dotSize}px`,
                                        height: `${dotSize}px`,
                                        marginLeft: `${Math.max(2, size * 0.03)}px`,
                                        marginBottom: `${Math.max(2, size * 0.03)}px`
                                    }}
                                    initial={{
                                        opacity: 0,
                                        filter: 'blur(14px)',
                                        scale: 2.4,
                                        x: 40,
                                        rotateX: -15
                                    }}
                                    animate={{
                                        opacity: 1,
                                        filter: 'blur(0px)',
                                        scale: 1,
                                        x: 0,
                                        rotateX: 0
                                    }}
                                    transition={{
                                        type: 'spring',
                                        stiffness: 380,
                                        damping: 36,
                                        mass: 1,
                                        delay: 0.12 + BRAND_LETTERS.length * 0.05
                                    }}
                                >
                                    <svg viewBox="0 0 20 20" fill="none" className="wp-dot-svg">
                                        <defs>
                                            <linearGradient id="clozflowNewGradientDot" x1="10%" y1="10%" x2="95%" y2="95%">
                                                <stop offset="0%" stopColor="#44d8f4" />
                                                <stop offset="30%" stopColor="#2dd3ed" />
                                                <stop offset="70%" stopColor="#1037ff" />
                                                <stop offset="100%" stopColor="#0020d0" />
                                            </linearGradient>
                                        </defs>
                                        <circle cx="10" cy="10" r="9" fill="url(#clozflowNewGradientDot)" />
                                    </svg>
                                </motion.span>
                            </span>
                        </div>
                    </div>
                </motion.div>
            </div>
        </motion.div>
    );
}
