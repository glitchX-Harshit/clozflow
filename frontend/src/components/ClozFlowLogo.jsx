import React from 'react';

const ClozFlowLogo = ({ className = 'cf-logo-svg', size = 32, ...props }) => (
    <svg
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        style={{ width: size, height: size, flexShrink: 0 }}
        {...props}
    >
        <path
            d="M21 11 A 7 7 0 1 0 16 23 L 16 9 L 23 9"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="cf-logo-path-main"
        />
        <path
            d="M16 16 H 21"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="cf-logo-path-bar"
        />
    </svg>
);

export default ClozFlowLogo;
