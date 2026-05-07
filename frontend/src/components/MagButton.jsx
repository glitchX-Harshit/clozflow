import { useRef, useState, useCallback } from 'react';
import './MagButton.css';

/**
 * MagButton — Awwwards-grade hover animation button
 *
 * Props:
 *   label        — button text (required)
 *   onClick      — click handler
 *   type         — button type (default "button")
 *   disabled     — disabled state
 *   variant      — "dark" | "outline" | "accent"  (default "dark")
 *   className    — extra CSS classes
 *   fullWidth    — stretch to 100%
 *   icon         — optional JSX icon (placed after label)
 *   magnetStrength — how far the button pulls (default 0.35)
 */
const MagButton = ({
    label,
    onClick,
    type = 'button',
    disabled = false,
    variant = 'dark',
    className = '',
    fullWidth = false,
    icon,
    magnetStrength = 0.35,
    ...rest
}) => {
    const btnRef  = useRef(null);
    const fillRef = useRef(null);
    const [hovered, setHovered] = useState(false);

    /* ── Magnetic movement ──────────────────────────── */
    const handleMouseMove = useCallback((e) => {
        if (disabled) return;
        const rect   = btnRef.current.getBoundingClientRect();
        const cx     = rect.left + rect.width  / 2;
        const cy     = rect.top  + rect.height / 2;
        const dx     = (e.clientX - cx) * magnetStrength;
        const dy     = (e.clientY - cy) * magnetStrength;

        btnRef.current.style.transform =
            `translate(${dx}px, ${dy}px)`;

        /* Parallax the inner text slightly less */
        const inner = btnRef.current.querySelector('.mag-inner');
        if (inner) {
            inner.style.transform =
                `translate(${dx * 0.4}px, ${dy * 0.4}px)`;
        }

        /* Move liquid fill origin to cursor position */
        if (fillRef.current) {
            const x = ((e.clientX - rect.left) / rect.width)  * 100;
            const y = ((e.clientY - rect.top)  / rect.height) * 100;
            fillRef.current.style.setProperty('--ox', `${x}%`);
            fillRef.current.style.setProperty('--oy', `${y}%`);
        }
    }, [disabled, magnetStrength]);

    const handleMouseEnter = useCallback((e) => {
        if (disabled) return;
        setHovered(true);
        handleMouseMove(e);
    }, [disabled, handleMouseMove]);

    const handleMouseLeave = useCallback(() => {
        setHovered(false);
        if (btnRef.current) {
            btnRef.current.style.transform = 'translate(0px, 0px)';
            const inner = btnRef.current.querySelector('.mag-inner');
            if (inner) inner.style.transform = 'translate(0px, 0px)';
        }
    }, []);

    return (
        <button
            ref={btnRef}
            type={type}
            disabled={disabled}
            onClick={onClick}
            onMouseMove={handleMouseMove}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            className={[
                'mag-btn',
                `mag-btn--${variant}`,
                hovered   ? 'is-hovered' : '',
                fullWidth  ? 'mag-btn--full' : '',
                disabled   ? 'mag-btn--disabled' : '',
                className,
            ].filter(Boolean).join(' ')}
            {...rest}
        >
            {/* Liquid fill blob */}
            <span className="mag-fill" ref={fillRef} aria-hidden="true" />

            {/* Text layers — slide up on hover */}
            <span className="mag-inner">
                <span className="mag-label mag-label--default">{label}</span>
                <span className="mag-label mag-label--hover">{label}</span>
            </span>

            {/* Optional icon */}
            {icon && <span className="mag-icon" aria-hidden="true">{icon}</span>}
        </button>
    );
};

export default MagButton;
