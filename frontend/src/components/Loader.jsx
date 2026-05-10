import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import './Loader.css';

/* A real strategic moment → Hexagon responds */
const OBJECTION = `"Pricing seems a bit high compared to our current setup."`;
const RESPONSE = `Detecting hesitation... Mapping ROI reframe. 98% certainty.`;

const typeInto = (el, text, speed = 28) =>
    new Promise(resolve => {
        let i = 0;
        const tick = setInterval(() => {
            el.textContent += text[i++];
            if (i >= text.length) { clearInterval(tick); resolve(); }
        }, speed);
    });

const Loader = ({ onComplete }) => {
    const rootRef = useRef(null);
    const objRef = useRef(null);
    const respRef = useRef(null);
    const cursorRef = useRef(null);
    const brandRef = useRef(null);
    const waveRef = useRef(null);

    useEffect(() => {
        const run = async () => {
            // 1. Waveform pulses (loop)
            gsap.utils.toArray('.ld-wave-bar').forEach((b, i) => {
                gsap.to(b, {
                    scaleY: Math.random() * 0.85 + 0.15,
                    duration: 0.2 + Math.random() * 0.25,
                    repeat: -1, yoyo: true, ease: 'sine.inOut', delay: i * 0.04
                });
            });

            // 2. Waveform fades in
            await gsap.fromTo(waveRef.current,
                { opacity: 0 }, { opacity: 1, duration: 0.5 }
            );

            await new Promise(r => setTimeout(r, 300));

            // 3. Objection bubble fades in
            gsap.set(objRef.current?.parentElement, { display: 'flex' });
            await gsap.fromTo(objRef.current?.parentElement,
                { opacity: 0, x: -16 },
                { opacity: 1, x: 0, duration: 0.35, ease: 'power3.out' }
            );

            // 4. Type the objection text
            await typeInto(objRef.current, OBJECTION, 22);
            await new Promise(r => setTimeout(r, 400));

            // 5. hexagon.ai response bubble
            gsap.set(respRef.current?.parentElement, { display: 'flex' });
            await gsap.fromTo(respRef.current?.parentElement,
                { opacity: 0, x: 16 },
                { opacity: 1, x: 0, duration: 0.35, ease: 'power3.out' }
            );

            // 6. Type hexagon.ai response
            await typeInto(respRef.current, RESPONSE, 20);

            // 7. Brand appears
            await new Promise(r => setTimeout(r, 250));
            await gsap.fromTo(brandRef.current,
                { opacity: 0, y: 8 },
                { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }
            );

            await new Promise(r => setTimeout(r, 500));

            // 8. Clip-path wipe UP — like a curtain lifting
            await gsap.to(rootRef.current, {
                clipPath: 'inset(100% 0 0 0)',
                duration: 0.75,
                ease: 'power4.inOut'
            });

            if (onComplete) onComplete();
            if (rootRef.current) rootRef.current.style.display = 'none';
        };

        run();
    }, [onComplete]);

    return (
        <div className="ld-root" ref={rootRef}>

            {/* Listening waveform */}
            <div className="ld-wave" ref={waveRef}>
                {[...Array(24)].map((_, i) => (
                    <div className="ld-wave-bar" key={i}></div>
                ))}
                <span className="ld-listening">listening...</span>
            </div>

            {/* Chat bubbles */}
            <div className="ld-chat">

                {/* Prospect objection — left */}
                <div className="ld-bubble ld-prospect" style={{ display: 'none' }}>
                    <div className="ld-bubble-who">Prospect</div>
                    <p ref={objRef}></p>
                </div>

                {/* hexagon.ai response — right */}
                <div className="ld-bubble ld-hexagonai" style={{ display: 'none' }}>
                    <div className="ld-bubble-who hexagon">
                        <span className="ld-bwdot">✦</span> Hexagon
                    </div>
                    <p ref={respRef}></p>
                </div>

            </div>

            {/* Brand line at bottom */}
            <div className="ld-brand" ref={brandRef}>
                <span className="ld-brand-nx">Hexagon</span>
                <span className="ld-brand-tag">— Behavioral Intelligence Layer</span>
            </div>

        </div>
    );
};

export default Loader;
