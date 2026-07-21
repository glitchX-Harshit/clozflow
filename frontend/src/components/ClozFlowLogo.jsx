import React from 'react';

const ClozFlowLogo = ({ className = 'cf-logo-wrapper', size = 32, ...props }) => {
    // Proportional font and underline sizing
    const fontSize = size;
    const subSize = size * 0.28;
    const underlineWidth = size * 0.85;

    return (
        <div 
            className={className} 
            style={{ 
                display: 'inline-flex', 
                flexDirection: 'column', 
                alignItems: 'flex-start', 
                lineHeight: 1.05,
                userSelect: 'none',
                fontFamily: 'inherit'
            }}
            {...props}
        >
            <div style={{ display: 'flex', alignItems: 'baseline', position: 'relative', paddingBottom: '2px' }}>
                <span style={{ 
                    fontFamily: '"Playfair Display", "DM Serif Display", serif', 
                    fontSize: `${fontSize}px`, 
                    fontWeight: 900, 
                    textTransform: 'lowercase',
                    color: 'var(--text, #0a0a0a)',
                    letterSpacing: '-0.03em',
                    position: 'relative'
                }}>
                    clozflow
                    <span style={{ color: '#E23E6E', fontSize: `${fontSize * 1.1}px` }}>.</span>
                    
                    {/* Horizontal underline specifically under "cl" */}
                    <span style={{
                        position: 'absolute',
                        left: '1px',
                        bottom: '2px',
                        width: `${underlineWidth}px`, 
                        height: `${Math.max(1.5, size * 0.06)}px`,
                        background: 'var(--text, #0a0a0a)',
                    }} />
                </span>
            </div>
            
            {/* Logo Subtitle tag: CLOSE MORE. FLOW BETTER. */}
            <span style={{ 
                fontFamily: 'var(--font-body, "Outfit", sans-serif)', 
                fontSize: `${subSize}px`, 
                letterSpacing: '0.22em', 
                color: 'var(--text-dim, #6b7280)', 
                textTransform: 'uppercase', 
                marginTop: '1px',
                fontWeight: 700,
                whiteSpace: 'nowrap'
            }}>
                close more. flow better.
            </span>
        </div>
    );
};

export default ClozFlowLogo;
