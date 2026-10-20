import React, { useRef, useMemo, useState, useEffect } from 'react';
import { motion, useMotionValue, useTransform, useSpring } from 'framer-motion';
import { ArrowLeft, ArrowRight, Sparkles, Play, Pause } from 'lucide-react';
import mascotVoicePoster from '../assets/clozflow-ai-voice-mascot-poster.webp';
import conversionCloudscape from '../assets/conversion-cloudscape.webp';
import aiSalesEngineerBanner from '../assets/ai-sales-engineer-banner.webp';
import futuristicVoicePoster from '../assets/futuristic-multilingual-voice-ai-poster.webp';
import pearlCallInterface from '../assets/clozflow-pearl-ai-call-interface.webp';
import builtInIndiaSovereign from '../assets/built-in-india-made-sovereign.webp';
import './DepthBlurCarousel.css';

// ── Curated Full-Bleed Visual Imagery (Ultra-High Resolution, Editorial Tech & Architecture) ──
const CAROUSEL_SLIDES = [
    {
        id: 'built-in-india-sovereign',
        image: builtInIndiaSovereign,
        title: 'Built in India, Made Sovereign',
        tag: 'SOVEREIGN DATA ARCHITECTURE',
        metric: '100% On-Soil Compute'
    },
    {
        id: 'voice-mascot-poster',
        image: mascotVoicePoster,
        title: 'Clozflow AI Voice Mascot',
        tag: 'AUTONOMOUS VOICE AGENT',
        metric: 'Sub-200ms Telemetry',
        hasAudioPreview: true
    },
    {
        id: 'pearl-call-interface',
        image: pearlCallInterface,
        title: 'Pearl AI Call Interface',
        tag: 'LIVE TELEMETRY HUD',
        metric: 'Autonomous Dialing'
    },
    {
        id: 'multilingual-voice-ai',
        image: futuristicVoicePoster,
        title: 'Futuristic Multilingual Voice AI',
        tag: 'NATIVE CODE-SWITCHING',
        metric: 'Zero-Latency Fluency'
    },
    {
        id: 'ai-sales-engineer',
        image: aiSalesEngineerBanner,
        title: 'AI Sales Engineer',
        tag: 'AUTONOMOUS WORKFORCE',
        metric: 'Full-Stack Execution'
    },
    {
        id: 'conversion-cloudscape',
        image: conversionCloudscape,
        title: '83% More Conversion Cloudscape',
        tag: 'HIGH-CONVERSION VELOCITY',
        metric: '+83% Conversion Lift'
    }
];

export default function DepthBlurCarousel({
    slides = CAROUSEL_SLIDES,
    itemWidth = 352,
    itemHeight = 440,
    sideItemWidth = 280,
    sideItemHeight = 350,
    gap = 42,
    maxRotation = 75,
    perspective = 450,
    borderRadius = 16,
    scrollDamping = 100,
    blurSpread = 25,
    blurStrength = 24
}) {
    // Dummy audio playback state (future-ready for MP3 file)
    const [playingAudioId, setPlayingAudioId] = useState(null);
    const audioRef = useRef(null);

    const handleToggleAudio = (e, item) => {
        e.stopPropagation();
        if (playingAudioId === item.id) {
            setPlayingAudioId(null);
            if (audioRef.current) {
                audioRef.current.pause();
            }
        } else {
            setPlayingAudioId(item.id);
            // Future MP3 connection: when item.audioSrc is provided, connect audio playback
            if (item.audioSrc) {
                if (!audioRef.current) {
                    audioRef.current = new Audio(item.audioSrc);
                    audioRef.current.onended = () => setPlayingAudioId(null);
                } else {
                    audioRef.current.src = item.audioSrc;
                }
                audioRef.current.play().catch((err) => {
                    console.warn('Audio playback failed or requires user gesture:', err);
                });
            }
        }
    };

    useEffect(() => {
        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
        };
    }, []);

    // Responsive card dimensions (scaled down)
    const [dims, setDims] = useState({
        itemWidth,
        itemHeight,
        sideItemWidth,
        sideItemHeight,
        gap
    });

    useEffect(() => {
        const updateDims = () => {
            if (window.innerWidth < 640) {
                setDims({
                    itemWidth: 248,
                    itemHeight: 310,
                    sideItemWidth: 192,
                    sideItemHeight: 240,
                    gap: 18
                });
            } else if (window.innerWidth < 1024) {
                setDims({
                    itemWidth: 304,
                    itemHeight: 380,
                    sideItemWidth: 248,
                    sideItemHeight: 310,
                    gap: 30
                });
            } else {
                setDims({
                    itemWidth: 352,
                    itemHeight: 440,
                    sideItemWidth: 280,
                    sideItemHeight: 350,
                    gap: 42
                });
            }
        };
        updateDims();
        window.addEventListener('resize', updateDims);
        return () => window.removeEventListener('resize', updateDims);
    }, [itemWidth, itemHeight, sideItemWidth, sideItemHeight, gap]);

    // Build infinite repeating array matching Framer logic
    const renderItems = useMemo(() => {
        const pool = slides && slides.length > 0 ? slides : CAROUSEL_SLIDES;
        const items = [];
        while (items.length < 18) {
            items.push(...pool);
        }
        return items;
    }, [slides]);

    const totalItems = renderItems.length;
    const scrollTarget = useRef(0);
    const rawScroll = useMotionValue(0);
    const snapTimeout = useRef(null);
    const mountRef = useRef(null);
    const isUserInteracting = useRef(false);

    const smoothScroll = useSpring(rawScroll, {
        stiffness: 140,
        damping: 30,
        mass: 0.8,
        restDelta: 0.001
    });

    // Track active index for pagination
    const [activeIndex, setActiveIndex] = useState(0);
    useEffect(() => {
        const unsubscribe = smoothScroll.on('change', (v) => {
            const normalized = ((Math.round(v) % slides.length) + slides.length) % slides.length;
            setActiveIndex(normalized);
        });
        return () => unsubscribe();
    }, [smoothScroll, slides.length]);

    // ── Synchronize with Page Up/Down Scroll: moves cards Left and Right ──
    useEffect(() => {
        let lastScrollY = window.scrollY;
        let scrollAccumulator = 0;

        const onScroll = () => {
            // Only drive carousel if user isn't actively dragging/panning
            if (isUserInteracting.current) return;

            const currentScrollY = window.scrollY;
            const deltaY = currentScrollY - lastScrollY;
            lastScrollY = currentScrollY;

            // Only respond when section is somewhat in viewport view
            if (mountRef.current) {
                const rect = mountRef.current.getBoundingClientRect();
                const vh = window.innerHeight;
                if (rect.bottom < -100 || rect.top > vh + 100) return;
            }

            // Scroll down moves carousel right (+), scroll up moves carousel left (-)
            scrollAccumulator += deltaY * 0.004;
            scrollTarget.current += deltaY * 0.004;
            rawScroll.set(scrollTarget.current);
        };

        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, [rawScroll]);

    // Horizontal wheel navigation
    const handleWheel = (e) => {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            e.preventDefault();
            scrollTarget.current += e.deltaX * 0.003;
            rawScroll.set(scrollTarget.current);
            clearTimeout(snapTimeout.current);
            snapTimeout.current = setTimeout(() => {
                scrollTarget.current = Math.round(scrollTarget.current);
                rawScroll.set(scrollTarget.current);
            }, 140);
        }
    };

    // Pan / Drag navigation
    const handlePanStart = () => {
        isUserInteracting.current = true;
    };

    const handlePan = (e, info) => {
        isUserInteracting.current = true;
        const delta = -info.delta.x * 0.005;
        scrollTarget.current += delta;
        rawScroll.set(scrollTarget.current);
        clearTimeout(snapTimeout.current);
    };

    const handlePanEnd = (e, info) => {
        scrollTarget.current += -info.velocity.x * 0.0015;
        scrollTarget.current = Math.round(scrollTarget.current);
        rawScroll.set(scrollTarget.current);
        setTimeout(() => {
            isUserInteracting.current = false;
        }, 150);
    };

    const prevCard = () => {
        scrollTarget.current = Math.round(scrollTarget.current) - 1;
        rawScroll.set(scrollTarget.current);
    };

    const nextCard = () => {
        scrollTarget.current = Math.round(scrollTarget.current) + 1;
        rawScroll.set(scrollTarget.current);
    };

    const scrollToSlide = (idx) => {
        const currentNorm = ((Math.round(scrollTarget.current) % slides.length) + slides.length) % slides.length;
        let diff = idx - currentNorm;
        if (diff > slides.length / 2) diff -= slides.length;
        if (diff < -slides.length / 2) diff += slides.length;
        scrollTarget.current = Math.round(scrollTarget.current) + diff;
        rawScroll.set(scrollTarget.current);
    };

    return (
        <div
            className="dbc-stage"
            ref={mountRef}
            style={{
                perspective: Math.max(perspective, 1)
            }}
        >
            {/* Gesture Interaction Layer */}
            <motion.div
                className="dbc-gesture-layer"
                onWheel={handleWheel}
                onPanStart={handlePanStart}
                onPan={handlePan}
                onPanEnd={handlePanEnd}
            />

            {/* 3D Origin Container */}
            <div className="dbc-3d-origin">
                {renderItems.map((item, i) => (
                    <ImageDepthCard
                        key={`card-${i}`}
                        item={item}
                        index={i}
                        total={totalItems}
                        smoothScroll={smoothScroll}
                        itemWidth={dims.itemWidth}
                        itemHeight={dims.itemHeight}
                        sideItemWidth={dims.sideItemWidth}
                        sideItemHeight={dims.sideItemHeight}
                        gap={dims.gap}
                        maxRotation={maxRotation}
                        borderRadius={borderRadius}
                        isPlaying={playingAudioId === item.id}
                        onToggleAudio={handleToggleAudio}
                        onClick={() => {
                            scrollTarget.current = i;
                            rawScroll.set(scrollTarget.current);
                        }}
                    />
                ))}
            </div>

            {/* ── Progressive Smear Edge Blur: Left ── */}
            <div
                className="dbc-edge-blur dbc-edge-blur--left"
                style={{
                    width: `${blurSpread}%`,
                    backdropFilter: `blur(${blurStrength}px)`,
                    WebkitBackdropFilter: `blur(${blurStrength}px)`,
                    maskImage: 'linear-gradient(to right, black 0%, transparent 100%)',
                    WebkitMaskImage: 'linear-gradient(to right, black 0%, transparent 100%)'
                }}
            />

            {/* ── Progressive Smear Edge Blur: Right ── */}
            <div
                className="dbc-edge-blur dbc-edge-blur--right"
                style={{
                    width: `${blurSpread}%`,
                    backdropFilter: `blur(${blurStrength}px)`,
                    WebkitBackdropFilter: `blur(${blurStrength}px)`,
                    maskImage: 'linear-gradient(to left, black 0%, transparent 100%)',
                    WebkitMaskImage: 'linear-gradient(to left, black 0%, transparent 100%)'
                }}
            />

            {/* ── Bottom Controls: Minimal Dots + Arrows ── */}
            <div className="dbc-controls">
                <button
                    type="button"
                    className="dbc-nav-btn dbc-nav-btn--prev"
                    onClick={prevCard}
                    aria-label="Previous card"
                >
                    <ArrowLeft size={16} />
                </button>

                <div className="dbc-dots">
                    {slides.map((_, sIdx) => (
                        <button
                            key={sIdx}
                            type="button"
                            className={`dbc-dot ${activeIndex === sIdx ? 'dbc-dot--active' : ''}`}
                            onClick={() => scrollToSlide(sIdx)}
                            aria-label={`Jump to slide ${sIdx + 1}`}
                        />
                    ))}
                </div>

                <button
                    type="button"
                    className="dbc-nav-btn dbc-nav-btn--next"
                    onClick={nextCard}
                    aria-label="Next card"
                >
                    <ArrowRight size={16} />
                </button>
            </div>
        </div>
    );
}

function ImageDepthCard({
    item,
    index,
    total,
    smoothScroll,
    itemWidth,
    itemHeight,
    sideItemWidth,
    sideItemHeight,
    gap,
    maxRotation,
    borderRadius,
    isPlaying,
    onToggleAudio,
    onClick
}) {
    const localOffset = useTransform(smoothScroll, (v) => {
        let linearBase = index - v;
        let mapped = ((linearBase % total) + total) % total;
        if (mapped > total / 2) mapped -= total;
        return mapped;
    });

    const absOffset = useTransform(localOffset, Math.abs);
    const cardWidth = useTransform(absOffset, [0, 1], [itemWidth, sideItemWidth], { clamp: true });
    const cardHeight = useTransform(absOffset, [0, 1], [itemHeight, sideItemHeight], { clamp: true });
    const marginLeft = useTransform(cardWidth, (w) => -w / 2);
    const marginTop = useTransform(cardHeight, (h) => -h / 2);

    const x = useTransform(localOffset, (o) => {
        const a = Math.abs(o);
        const s = Math.sign(o);
        const centerToNext = itemWidth / 2 + gap + sideItemWidth / 2;
        const sideToSide = sideItemWidth + gap;
        if (a === 0) return 0;
        if (a <= 1) {
            return s * centerToNext * a;
        } else {
            return s * (centerToNext + (a - 1) * sideToSide * 0.85);
        }
    });

    const z = useTransform(absOffset, (a) => -a * 200);
    const rotateY = useTransform(localOffset, (o) => {
        return Math.sign(o) * Math.min(Math.abs(o) * 35, maxRotation);
    });
    const zIndex = useTransform(absOffset, (a) => 1000 - Math.round(a * 10));
    const visibilityOpacity = useTransform(absOffset, [0, 5, 7], [1, 1, 0]);

    return (
        <motion.div
            className="dbc-card-anchor"
            onClick={onClick}
            style={{
                marginLeft,
                marginTop,
                width: cardWidth,
                height: cardHeight,
                rotateY,
                x,
                z,
                zIndex
            }}
        >
            <motion.div
                className="dbc-card-surface"
                style={{
                    borderRadius,
                    opacity: visibilityOpacity
                }}
            >
                {/* Pure Full-Bleed Image (Zero bottom overlay / shadow) */}
                <img
                    src={item.image}
                    alt={item.title || 'ClozFlow Visual'}
                    className="dbc-card-img"
                    loading="lazy"
                />

                {/* Optional Audio Play/Pause Button on specific card (bottom 15-20%) */}
                {item.hasAudioPreview && (
                    <div
                        className="dbc-audio-trigger-wrap"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                    >
                        {isPlaying && (
                            <div className="dbc-audio-pill">
                                <span className="dbc-audio-waves">
                                    <span className="dbc-audio-wave-bar" />
                                    <span className="dbc-audio-wave-bar" />
                                    <span className="dbc-audio-wave-bar" />
                                </span>
                                <span className="dbc-audio-pill-text">Voice Demo</span>
                            </div>
                        )}
                        <button
                            type="button"
                            className={`dbc-audio-btn ${isPlaying ? 'dbc-audio-btn--playing' : ''}`}
                            onClick={(e) => onToggleAudio(e, item)}
                            aria-label={isPlaying ? 'Pause voice demo' : 'Play voice demo'}
                            title={isPlaying ? 'Pause Voice Demo' : 'Play Voice Demo'}
                        >
                            {isPlaying ? (
                                <Pause size={17} className="dbc-audio-icon dbc-audio-icon--pause" />
                            ) : (
                                <Play size={17} className="dbc-audio-icon dbc-audio-icon--play" />
                            )}
                        </button>
                    </div>
                )}
            </motion.div>
        </motion.div>
    );
}
