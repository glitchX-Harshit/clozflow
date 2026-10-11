import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * SmoothScroll Component
 * Standardized Lenis implementation for React 19.
 * Syncs Lenis with GSAP ScrollTrigger for landing pages,
 * and automatically pauses on admin/dashboard routes to prevent scroll trapping.
 */
const SmoothScroll = () => {
    const location = useLocation();
    const lenisRef = useRef(null);

    useEffect(() => {
        // Initialize Lenis
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

        // Named handler to cleanly unregister from GSAP ticker on unmount
        const updateLenis = (time) => {
            lenis.raf(time * 1000);
        };

        gsap.ticker.add(updateLenis);
        gsap.ticker.lagSmoothing(0);

        // Global accessibility and cleanup
        window.lenis = lenis;

        return () => {
            gsap.ticker.remove(updateLenis);
            lenis.destroy();
            window.lenis = null;
            lenisRef.current = null;
        };
    }, []);

    // Pause Lenis on internal management portals to avoid scroll hijacking
    useEffect(() => {
        if (!lenisRef.current) return;
        const isAdminOrApp = location.pathname.startsWith('/admin') || 
                             location.pathname.startsWith('/dashboard') ||
                             location.pathname.startsWith('/call-brief') ||
                             location.pathname.startsWith('/live-call');
        if (isAdminOrApp) {
            lenisRef.current.stop();
        } else {
            lenisRef.current.start();
        }
    }, [location.pathname]);

    return null;
};

export default SmoothScroll;
