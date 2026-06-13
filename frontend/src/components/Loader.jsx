import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import './Loader.css';

const Loader = ({ onComplete }) => {
    const rootRef = useRef(null);
    const counterObjectRef = useRef({ val: 0 });
    const hundredsStripRef = useRef(null);
    const tensStripRef = useRef(null);
    const onesStripRef = useRef(null);
    const progressBarRef = useRef(null);

    // Dynamically generate the odometer digit strips (101 elements each to prevent backward wrapping scrolls)
    const onesList = Array.from({ length: 101 }, (_, i) => i % 10);
    const tensList = Array.from({ length: 101 }, (_, i) => Math.floor((i % 100) / 10));
    const hundredsList = Array.from({ length: 101 }, (_, i) => Math.floor(i / 100));

    useEffect(() => {
        // Lock scroll on mount to prevent scrolling behind the loader
        window.lenis?.stop();
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
        document.body.style.overflow = 'hidden';
        document.body.style.paddingRight = `${scrollbarWidth}px`;
        
        const navbar = document.querySelector('.nb');
        if (navbar) {
            navbar.style.paddingRight = `${scrollbarWidth}px`;
        }

        const ctx = gsap.context(() => {
            // Initial setup for the parallax reveal on the hero section (inside context)
            gsap.set('.hero', { y: 100 });

            const tl = gsap.timeline({
                onComplete: () => {
                    // Reset the translated hero back to default styles once done
                    gsap.set('.hero', { clearProps: "transform" });
                    if (onComplete) onComplete();
                }
            });

            // Initial states of loader elements
            gsap.set('.loader-logo-char', { y: '100%' });
            gsap.set('.loader-counter-container', { y: 15, opacity: 0 });
            gsap.set('.loader-progress-track', { scaleX: 0, transformOrigin: "center center" });

            // 1. Entrance Sequence
            tl.to('.loader-logo-char', {
                y: '0%',
                duration: 0.6,
                stagger: 0.04,
                ease: "power3.out"
            })
            .to('.loader-counter-container', {
                y: 0,
                opacity: 1,
                duration: 0.5,
                ease: "power2.out"
            }, "-=0.3")
            .to('.loader-progress-track', {
                scaleX: 1,
                duration: 0.5,
                ease: "power2.out"
            }, "-=0.4");

            // 2. Snappy Odometer count-up (under 1.4 seconds)
            const counterObj = counterObjectRef.current;
            tl.to(counterObj, {
                val: 100,
                duration: 1.3,
                ease: "power3.inOut",
                onUpdate: () => {
                    const p = counterObj.val;
                    
                    // Update progress bar width
                    if (progressBarRef.current) {
                        progressBarRef.current.style.width = `${p}%`;
                    }

                    // Translate odometer strips
                    const translation = -p * (100 / 101);
                    if (onesStripRef.current) onesStripRef.current.style.transform = `translateY(${translation}%)`;
                    if (tensStripRef.current) tensStripRef.current.style.transform = `translateY(${translation}%)`;
                    if (hundredsStripRef.current) hundredsStripRef.current.style.transform = `translateY(${translation}%)`;
                }
            }, "-=0.1");

            // Short hold for visual impact
            tl.to({}, { duration: 0.15 });

            // 3. Exit Animation & Parallax Reveal
            tl.to('.loader-logo-char', {
                y: '-100%',
                duration: 0.5,
                stagger: 0.03,
                ease: "power3.in"
            })
            .to('.loader-counter-container', {
                y: -15,
                opacity: 0,
                duration: 0.4,
                ease: "power3.in"
            }, "-=0.4")
            .to('.loader-progress-track', {
                scaleX: 0,
                opacity: 0,
                duration: 0.4,
                ease: "power3.in"
            }, "-=0.4");

            // Slide up the entire preloader panel AND slide up the hero in parallax
            tl.to(rootRef.current, {
                yPercent: -100,
                duration: 1.1,
                ease: "power4.inOut"
            }, "-=0.2")
            .to('.hero', {
                y: 0,
                duration: 1.3,
                ease: "power4.out"
            }, "-=1.1");

        }, rootRef);

        return () => {
            ctx.revert();
            // Force reset any transform on hero to prevent offset glitch
            gsap.set('.hero', { clearProps: "transform" });
            
            // Restore scroll and Lenis on unmount
            window.lenis?.start();
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
            const navbarElement = document.querySelector('.nb');
            if (navbarElement) {
                navbarElement.style.paddingRight = '';
            }
        };
    }, [onComplete]);

    return (
        <div className="loader-overlay" ref={rootRef}>
            {/* Minimal Center Group */}
            <div className="loader-center-group">
                {/* Wordmark logo */}
                <div className="loader-logo-wrapper">
                    <h1 className="loader-logo">
                        {"clozflow".split("").map((char, i) => (
                            <span key={i} className="loader-logo-char">{char}</span>
                        ))}
                    </h1>
                </div>

                {/* Brackets Odometer */}
                <div className="loader-counter-container">
                    <div className="loader-odometer">
                        <span className="loader-bracket">[</span>
                        {/* Hundreds Column */}
                        <div className="loader-digit-window">
                            <div className="loader-digit-strip" ref={hundredsStripRef}>
                                {hundredsList.map((val, idx) => (
                                    <span key={idx}>{val}</span>
                                ))}
                            </div>
                        </div>
                        {/* Tens Column */}
                        <div className="loader-digit-window">
                            <div className="loader-digit-strip" ref={tensStripRef}>
                                {tensList.map((val, idx) => (
                                    <span key={idx}>{val}</span>
                                ))}
                            </div>
                        </div>
                        {/* Ones Column */}
                        <div className="loader-digit-window">
                            <div className="loader-digit-strip" ref={onesStripRef}>
                                {onesList.map((val, idx) => (
                                    <span key={idx}>{val}</span>
                                ))}
                            </div>
                        </div>
                        <span className="loader-percent">%</span>
                        <span className="loader-bracket">]</span>
                    </div>
                </div>

                {/* Tiny Centered Progress Bar */}
                <div className="loader-progress-track">
                    <div className="loader-progress-bar" ref={progressBarRef}></div>
                </div>
            </div>
        </div>
    );
};

export default Loader;
