import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * SmoothScroll Component
 * Standardized Lenis implementation for React 19.
 * Syncs Lenis with GSAP ScrollTrigger on public marketing routes (e.g. /, /pricing, /how-it-works).
 * Completely destroys Lenis on internal app/dashboard/admin routes to prevent scroll hijacking,
 * wheel trapping (preventDefault), and class-based clipping.
 */
const MARKETING_ROUTES = ['/', '/how-it-works', '/pricing'];

const isMarketingRoute = (pathname) => {
    if (MARKETING_ROUTES.includes(pathname)) return true;
    if (pathname.startsWith('/relay/')) return true;
    return false;
};

const SmoothScroll = () => {
    const location = useLocation();
    const lenisRef = useRef(null);
    const updateHandlerRef = useRef(null);

    useEffect(() => {
        const needsSmoothScroll = isMarketingRoute(location.pathname);

        const cleanupClasses = () => {
            const classes = ['lenis', 'lenis-stopped', 'lenis-scrolling', 'lenis-smooth', 'lenis-locked'];
            classes.forEach((cls) => {
                document.documentElement.classList.remove(cls);
                document.body.classList.remove(cls);
            });
        };

        if (needsSmoothScroll) {
            // Already running? Make sure it's active
            if (lenisRef.current) {
                lenisRef.current.start();
                cleanupClasses();
                return;
            }

            // Prevent browser from restoring stale scroll position across reloads
            if ('scrollRestoration' in window.history) {
                window.history.scrollRestoration = 'manual';
            }

            // Initialize Lenis strictly for marketing/landing pages
            const lenis = new Lenis({
                duration: 1.2,
                easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
                orientation: 'vertical',
                gestureOrientation: 'vertical',
                smoothWheel: true,
                wheelMultiplier: 1,
                touchMultiplier: 2,
                infinite: false,
            });

            lenisRef.current = lenis;

            // Sync ScrollTrigger with Lenis
            lenis.on('scroll', ScrollTrigger.update);

            const updateLenis = (time) => {
                lenis.raf(time * 1000);
            };
            updateHandlerRef.current = updateLenis;

            gsap.ticker.add(updateLenis);
            gsap.ticker.lagSmoothing(0);

            window.lenis = lenis;
            cleanupClasses();
        } else {
            // App / Dashboard / Admin route: completely destroy Lenis
            // to eliminate any wheel event.preventDefault() hijacking
            if (lenisRef.current) {
                if (updateHandlerRef.current) {
                    gsap.ticker.remove(updateHandlerRef.current);
                    updateHandlerRef.current = null;
                }
                lenisRef.current.destroy();
                lenisRef.current = null;
                window.lenis = null;
            }
            cleanupClasses();
        }
    }, [location.pathname]);

    // Global cleanup on unmount
    useEffect(() => {
        return () => {
            if (updateHandlerRef.current) {
                gsap.ticker.remove(updateHandlerRef.current);
                updateHandlerRef.current = null;
            }
            if (lenisRef.current) {
                lenisRef.current.destroy();
                lenisRef.current = null;
                window.lenis = null;
            }
            const classes = ['lenis', 'lenis-stopped', 'lenis-scrolling', 'lenis-smooth', 'lenis-locked'];
            classes.forEach((cls) => {
                document.documentElement.classList.remove(cls);
                document.body.classList.remove(cls);
            });
        };
    }, []);

    return null;
};

export default SmoothScroll;
