import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import './Loader.css';

const Loader = ({ onComplete }) => {
    const rootRef = useRef(null);
    const counterRef = useRef(null);

    // 10x10 grid for the pixel dissolve effect
    const pixels = Array.from({ length: 100 }, (_, i) => i);

    useEffect(() => {
        const tl = gsap.timeline({
            onComplete: () => {
                if (onComplete) onComplete();
                if (rootRef.current) rootRef.current.style.display = 'none';
            }
        });

        // The object we will tween to animate the number
        const counter = { val: 0 };

        // 1. Animate the counter from 0 to 100
        tl.to(counter, {
            val: 100,
            duration: 2.2, // fast and punchy
            ease: "power3.inOut",
            onUpdate: () => {
                if (counterRef.current) {
                    // Update text, formatting as 000 if needed, or just standard 0%
                    counterRef.current.textContent = Math.round(counter.val);
                }
            }
        });

        // 2. Hide counter
        tl.to(counterRef.current, {
            opacity: 0,
            y: 20,
            duration: 0.4,
            ease: "power2.in"
        });

        // 3. Premium Pixel Dissolve
        tl.to('.loader-pixel', {
            scale: 0,
            opacity: 0,
            duration: 0.6,
            stagger: {
                amount: 0.8,
                from: "random",
                grid: [10, 10]
            },
            ease: "expo.inOut"
        }, '-=0.1');

    }, [onComplete]);

    return (
        <div className="loader-overlay" ref={rootRef}>
            <div className="loader-pixels">
                {pixels.map(i => (
                    <div key={i} className="loader-pixel"></div>
                ))}
            </div>
            
            <div className="loader-counter" ref={counterRef}>
                0
            </div>
        </div>
    );
};

export default Loader;
