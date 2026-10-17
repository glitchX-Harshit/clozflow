import React, { useEffect, useRef, useState, useCallback } from 'react';
import { PhoneCall, Network, Sparkles, Radio } from 'lucide-react';

/**
 * High-Performance WebGL Fluid Simulation Shader Engine
 * Real-time Navier-Stokes inspired domain warping, curl-noise advection,
 * and mouse-interactive liquid ripple dynamics.
 */

const VERTEX_SHADER_SOURCE = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER_SOURCE = `
  precision highp float;
  varying vec2 v_uv;
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform vec2 u_mouse;
  uniform float u_hover;
  uniform int u_theme; // 0 = Amber/Flame Orange, 1 = Cyber Emerald/Mint

  // Pseudo-random hash
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  // Value noise with cubic hermite interpolation
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  // Fractional Brownian Motion (4 octaves)
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (int i = 0; i < 4; ++i) {
      v += a * noise(p);
      p = rot * p * 2.0 + shift;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    // Normalized centered coordinates
    vec2 p = (v_uv - 0.5) * 2.2;
    p.x *= u_resolution.x / u_resolution.y;

    // Interactive mouse fluid impulse
    vec2 m = (u_mouse - 0.5) * 2.2;
    m.x *= u_resolution.x / u_resolution.y;
    float distMouse = length(p - m);
    float mouseWave = exp(-distMouse * 4.2) * (0.5 + u_hover * 1.0);

    float t = u_time * 0.48;

    // Domain Warping (Simulating turbulent fluid advection)
    vec2 q = vec2(
      fbm(p + vec2(0.0, 0.0) + t * 0.32),
      fbm(p + vec2(5.2, 1.3) + t * 0.28)
    );

    vec2 r = vec2(
      fbm(p + 3.6 * q + vec2(1.7, 9.2) + mouseWave * 1.6),
      fbm(p + 3.6 * q + vec2(8.3, 2.8) - mouseWave * 1.6)
    );

    float f = fbm(p + 3.8 * r + t * 0.22);

    // Color Palette Computation
    vec3 col = vec3(0.0);

    if (u_theme == 0) {
      // ── ClozFlow Amber / Flame Copper / Molten Gold ──
      vec3 cDeep = vec3(0.18, 0.06, 0.02);    // Deep obsidian rust
      vec3 cMid = vec3(0.92, 0.35, 0.05);     // Flame Orange (#ea580c)
      vec3 cWarm = vec3(0.98, 0.58, 0.12);    // Vibrant Amber (#f97316)
      vec3 cBright = vec3(0.99, 0.82, 0.35);  // Golden Glow (#fde047)
      vec3 cSpec = vec3(1.0, 0.96, 0.90);     // Specular highlight

      col = mix(cDeep, cMid, clamp(f * f * 3.2, 0.0, 1.0));
      col = mix(col, cWarm, clamp(length(q) * 1.1, 0.0, 1.0));
      col = mix(col, cBright, clamp(pow(r.x, 2.8) * 1.8, 0.0, 1.0));
      col += cSpec * smoothstep(0.72, 0.95, f) * 0.45;
    } else {
      // ── Cyber Emerald / Mint / Neon Aquamarine ──
      vec3 cDeep = vec3(0.02, 0.12, 0.08);    // Deep forest obsidian
      vec3 cMid = vec3(0.02, 0.59, 0.41);     // Emerald (#059669)
      vec3 cWarm = vec3(0.10, 0.73, 0.52);    // Mint (#10b981)
      vec3 cBright = vec3(0.35, 0.88, 0.78);  // Cyan Aquamarine (#5eead4)
      vec3 cSpec = vec3(0.92, 1.0, 0.96);     // Specular highlight

      col = mix(cDeep, cMid, clamp(f * f * 3.2, 0.0, 1.0));
      col = mix(col, cWarm, clamp(length(q) * 1.1, 0.0, 1.0));
      col = mix(col, cBright, clamp(pow(r.x, 2.8) * 1.8, 0.0, 1.0));
      col += cSpec * smoothstep(0.72, 0.95, f) * 0.45;
    }

    // Organic circular aperture mask with soft liquid rim
    float radius = length(p);
    float vignette = smoothstep(1.7, 0.2, radius);
    col *= vignette;

    // Specular Fresnel rim light
    float rim = smoothstep(0.7, 1.3, radius) * smoothstep(1.5, 0.9, radius);
    col += vec3(0.18) * rim * (0.8 + u_hover * 0.6);

    gl_FragColor = vec4(col, 1.0);
  }
`;

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl, vsSource, fsSource) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/**
 * Reusable WebGL Fluid Simulation Canvas
 */
const WebGLFluidCanvas = ({ 
  theme = 0, 
  isHovered = false, 
  cardHovered = false,
  className = '' 
}) => {
  const canvasRef = useRef(null);
  const glRef = useRef(null);
  const programRef = useRef(null);
  const animFrameRef = useRef(null);
  const startTimeRef = useRef(performance.now());
  
  // Smooth mouse coordinates & hover animation state
  const mouseRef = useRef({ x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5 });
  const hoverFactorRef = useRef(0.0);

  const handlePointerMove = useCallback((e) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1.0 - (e.clientY - rect.top) / rect.height)); // WebGL Y is inverted
    mouseRef.current.targetX = x;
    mouseRef.current.targetY = y;
  }, []);

  const handlePointerLeave = useCallback(() => {
    mouseRef.current.targetX = 0.5;
    mouseRef.current.targetY = 0.5;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let gl = canvas.getContext('webgl', { 
      alpha: true, 
      antialias: true, 
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    });

    if (!gl) {
      gl = canvas.getContext('experimental-webgl');
    }

    if (!gl) {
      console.warn('WebGL not supported, falling back to 2D canvas');
      return;
    }

    glRef.current = gl;

    const program = createProgram(gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
    if (!program) return;
    programRef.current = program;

    // Full-screen quad geometry
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = new Float32Array([
      -1.0, -1.0,
       1.0, -1.0,
      -1.0,  1.0,
      -1.0,  1.0,
       1.0, -1.0,
       1.0,  1.0,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const aPositionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(aPositionLocation);
    gl.vertexAttribPointer(aPositionLocation, 2, gl.FLOAT, false, 0, 0);

    // Uniform locations
    const uTimeLoc = gl.getUniformLocation(program, 'u_time');
    const uResLoc = gl.getUniformLocation(program, 'u_resolution');
    const uMouseLoc = gl.getUniformLocation(program, 'u_mouse');
    const uHoverLoc = gl.getUniformLocation(program, 'u_hover');
    const uThemeLoc = gl.getUniformLocation(program, 'u_theme');

    let isDestroyed = false;

    // Render loop
    const render = () => {
      if (isDestroyed || !glRef.current || !programRef.current) return;

      const gl = glRef.current;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      const targetWidth = Math.floor(width * dpr);
      const targetHeight = Math.floor(height * dpr);

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
      }

      gl.useProgram(program);

      // Smooth mouse easing with viscous inertia
      mouseRef.current.x += (mouseRef.current.targetX - mouseRef.current.x) * 0.12;
      mouseRef.current.y += (mouseRef.current.targetY - mouseRef.current.y) * 0.12;

      // Smooth hover easing
      const targetHover = (isHovered || cardHovered) ? 1.0 : 0.0;
      hoverFactorRef.current += (targetHover - hoverFactorRef.current) * 0.08;

      const currentTime = (performance.now() - startTimeRef.current) / 1000;

      gl.uniform1f(uTimeLoc, currentTime);
      gl.uniform2f(uResLoc, canvas.width, canvas.height);
      gl.uniform2f(uMouseLoc, mouseRef.current.x, mouseRef.current.y);
      gl.uniform1f(uHoverLoc, hoverFactorRef.current);
      gl.uniform1i(uThemeLoc, theme);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      isDestroyed = true;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (gl) {
        gl.deleteBuffer(positionBuffer);
        gl.deleteProgram(program);
      }
    };
  }, [theme]);

  return (
    <canvas
      ref={canvasRef}
      className={`pearl-webgl-fluid-canvas ${className}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    />
  );
};

/**
 * 1. ClozFlowTelephonyNode — Molten Copper / Amber Fluid Portal
 * For "Rent from ClozFlow" Card
 */
export const ClozFlowTelephonyNode = ({ isHovered = false }) => {
  return (
    <div className="pearl-fluid-node-wrapper theme-copper" aria-label="ClozFlow Telephony Fluid Visual">
      <div className="pearl-fluid-aperture">
        <WebGLFluidCanvas 
          theme={0} 
          cardHovered={isHovered} 
          className="fluid-copper"
        />
        {/* Luminous Center Glass Badge */}
        <div className="fluid-center-glass-badge">
          <PhoneCall size={24} className="fluid-badge-icon copper-glow" strokeWidth={2.2} />
        </div>
        {/* Micro Pulse Indicator */}
        <div className="fluid-pulse-orb copper" />
      </div>
    </div>
  );
};

/**
 * 2. BringYourOwnTrunkNode — Cyber Emerald / Mint Fluid Portal
 * For "Bring your own telephony" Card
 */
export const BringYourOwnTrunkNode = ({ isHovered = false }) => {
  return (
    <div className="pearl-fluid-node-wrapper theme-emerald" aria-label="BYOT Telephony Fluid Visual">
      <div className="pearl-fluid-aperture">
        <WebGLFluidCanvas 
          theme={1} 
          cardHovered={isHovered} 
          className="fluid-emerald"
        />
        {/* Luminous Center Glass Badge */}
        <div className="fluid-center-glass-badge">
          <Network size={24} className="fluid-badge-icon emerald-glow" strokeWidth={2.2} />
        </div>
        {/* Micro Pulse Indicator */}
        <div className="fluid-pulse-orb emerald" />
      </div>
    </div>
  );
};

export default ClozFlowTelephonyNode;
