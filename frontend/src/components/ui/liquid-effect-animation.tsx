"use client";

import { useEffect, useRef } from "react";

export interface LiquidEffectAnimationProps {
  className?: string;
  canvasClassName?: string;
  imageSrc?: string;
}

export function LiquidEffectAnimation({
  className = "relative w-full h-full touch-none overflow-hidden",
  canvasClassName = "absolute inset-0 w-full h-full block",
  imageSrc = "https://cdn.21st.dev/assets/mirror/95/95e97d22cb2df434400243c60803fb89a5e25a46dad13c4a6d5cb27246173cf0.png",
}: LiquidEffectAnimationProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Clean up any stale liquidApp before initializing
    if (typeof window !== "undefined" && window.__liquidApp?.dispose) {
      try {
        window.__liquidApp.dispose();
      } catch (e) {
        console.warn("LiquidApp previous instance cleanup:", e);
      }
    }

    const sanitizedSrc = (imageSrc || "").replace(/\\/g, "/");

    // Load the script dynamically
    const script = document.createElement("script");
    script.type = "module";
    script.textContent = `
      import LiquidBackground from 'https://cdn.jsdelivr.net/npm/threejs-components@0.0.22/build/backgrounds/liquid1.min.js';
      
      const canvas = document.getElementById('liquid-canvas');
      if (canvas) {
        try {
          const app = LiquidBackground(canvas, { size: 'parent' });
          app.loadImage('${sanitizedSrc}');
          app.liquidPlane.material.metalness = 0.75;
          app.liquidPlane.material.roughness = 0.25;
          app.liquidPlane.uniforms.displacementScale.value = 5;
          app.setRain(false);
          window.__liquidApp = app;
        } catch (err) {
          console.warn("LiquidBackground init error:", err);
        }
      }
    `;
    scriptRef.current = script;
    document.body.appendChild(script);

    const handleResize = () => {
      if (window.__liquidApp && typeof window.__liquidApp.resize === "function") {
        try {
          window.__liquidApp.resize();
        } catch (e) {
          // Silent fallback
        }
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (typeof window !== "undefined" && window.__liquidApp?.dispose) {
        try {
          window.__liquidApp.dispose();
        } catch (e) {
          // Silent fallback
        }
        window.__liquidApp = undefined;
      }
      if (scriptRef.current && scriptRef.current.parentNode) {
        scriptRef.current.parentNode.removeChild(scriptRef.current);
      }
    };
  }, [imageSrc]);

  return (
    <div
      className={className}
      style={{ fontFamily: '"Montserrat", serif' }}
    >
      <canvas ref={canvasRef} id="liquid-canvas" className={canvasClassName} />
    </div>
  );
}

declare global {
  interface Window {
    __liquidApp?: any;
  }
}

export default LiquidEffectAnimation;
