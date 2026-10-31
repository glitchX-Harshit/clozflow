import React, { useRef, useMemo, useState, useEffect } from 'react';
import { motion, useMotionValue, useTransform, useSpring } from 'framer-motion';
import { ArrowLeft, ArrowRight, Play, Pause } from 'lucide-react';
import mascotVoicePoster from '../assets/clozflow-ai-voice-mascot-poster.webp';
import conversionCloudscape from '../assets/conversion-cloudscape.webp';
import aiSalesEngineerBanner from '../assets/ai-sales-engineer-banner.webp';
import futuristicVoicePoster from '../assets/futuristic-multilingual-voice-ai-poster.webp';
import pearlCallInterface from '../assets/clozflow-pearl-ai-call-interface.webp';
import builtInIndiaSovereign from '../assets/built-in-india-made-sovereign.webp';
import whyWeAreWinningAudio from '../assets/why-we-are-winning-demo.wav';
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
        title: 'Why we are winning?',
        tag: 'AUTONOMOUS VOICE AGENT',
        metric: 'Sub-200ms Telemetry',
        hasAudioPreview: true,
        audioSrc: whyWeAreWinningAudio || '/audio/why-we-are-winning-demo.wav',
        audioFallbackSrc: '/audio/why-we-are-winning-demo.mp3'
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
    // ── Dedicated High-Fidelity Audio Controller ──
    const [playingAudioId, setPlayingAudioId] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const audioRef = useRef(null);

    // Initialize global Audio instance with lifecycle listeners
    useEffect(() => {
        const audio = new Audio();
        audio.preload = 'metadata';
        audioRef.current = audio;

        const handleEnded = () => {
            setIsPlaying(false);
            setPlayingAudioId(null);
        };

        const handlePause = () => {
            setIsPlaying(false);
        };

        const handlePlay = () => {
            setIsPlaying(true);
        };

        audio.addEventListener('ended', handleEnded);
        audio.addEventListener('pause', handlePause);
        audio.addEventListener('play', handlePlay);

        return () => {
            audio.removeEventListener('ended', handleEnded);
            audio.removeEventListener('pause', handlePause);
            audio.removeEventListener('play', handlePlay);
            audio.pause();
            audio.src = '';
            audioRef.current = null;
        };
    }, []);

    const handleToggleAudio = (e, item) => {
        if (e && e.stopPropagation) e.stopPropagation();
        const audio = audioRef.current;
        if (!audio) return;

        if (playingAudioId === item.id) {
            if (isPlaying) {
                audio.pause();
            } else {
                audio.play().catch((err) => {
                    console.warn('Audio play failed or requires user interaction:', err);
                });
            }
        } else {
            setPlayingAudioId(item.id);
            const targetSrc = item.audioSrc || '/audio/why-we-are-winning-demo.wav';
            if (!audio.src || !audio.src.includes('why-we-are-winning-demo')) {
                audio.src = targetSrc;
                audio.currentTime = 0;
            }
            audio.play().catch((err) => {
                console.warn('Audio play failed:', err);
            });
        }
    };

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

        const onScroll = () => {
            if (isUserInteracting.current) return;

            const currentScrollY = window.scrollY;
            const deltaY = currentScrollY - lastScrollY;
            lastScrollY = currentScrollY;

            if (mountRef.current) {
                const rect = mountRef.current.getBoundingClientRect();
                const vh = window.innerHeight;
                if (rect.bottom < -100 || rect.top > vh + 100) return;
            }

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

    // Pan / Drag navigation on the stage container
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
        <motion.div
            className="dbc-stage"
            ref={mountRef}
            onWheel={handleWheel}
            onPanStart={handlePanStart}
            onPan={handlePan}
            onPanEnd={handlePanEnd}
            style={{
                perspective: Math.max(perspective, 1)
            }}
        >
            {/* 3D Origin Container — Cards render directly without blocking gesture overlay */}
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
                        isPlaying={isPlaying && playingAudioId === item.id}
                        onToggleAudio={handleToggleAudio}
                        onClick={() => {
                            if (!isUserInteracting.current) {
                                scrollTarget.current = i;
                                rawScroll.set(scrollTarget.current);
                            }
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
            <div
                className="dbc-controls"
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
            >
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
        </motion.div>
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
                {/* Pure Full-Bleed Image */}
                <img
                    src={item.image}
                    alt={item.title || 'ClozFlow Visual'}
                    className="dbc-card-img"
                    loading="lazy"
                />

                {/* ── Play Button directly connected to conversation audio ── */}
                {item.hasAudioPreview && (
                    <div
                        className="dbc-audio-trigger-wrap"
                        onClick={(e) => {
                            e.stopPropagation();
                        }}
                        onPointerDown={(e) => {
                            e.stopPropagation();
                        }}
                        onMouseDown={(e) => {
                            e.stopPropagation();
                        }}
                        onTouchStart={(e) => {
                            e.stopPropagation();
                        }}
                    >
                        <button
                            type="button"
                            className={`dbc-audio-btn ${isPlaying ? 'dbc-audio-btn--playing' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleAudio(e, item);
                            }}
                            onPointerDown={(e) => {
                                e.stopPropagation();
                            }}
                            onMouseDown={(e) => {
                                e.stopPropagation();
                            }}
                            onTouchStart={(e) => {
                                e.stopPropagation();
                            }}
                            aria-label={isPlaying ? 'Pause conversation' : 'Play conversation'}
                            title={isPlaying ? 'Pause conversation' : 'Play conversation'}
                        >
                            {isPlaying ? (
                                <Pause size={18} className="dbc-audio-icon dbc-audio-icon--pause" />
                            ) : (
                                <Play size={18} className="dbc-audio-icon dbc-audio-icon--play" />
                            )}
                        </button>
                    </div>
                )}
            </motion.div>
        </motion.div>
    );
}
