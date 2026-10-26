"use client";

/**
 * Glyph Portal © 2026 Christian Katzmann. MIT.
 * Origin: UsefulPortal.astro on https://ktzm.dk → UsefulPortal.tsx → ClarityPortal.tsx.
 * Refactored for ClozFlow: High-performance pinned typographic portal.
 */
import { useId, useEffect, useRef, type CSSProperties, type ReactNode } from "react";

export type GlyphPortalStyle = CSSProperties & {
  "--gp-paper"?: string;
  "--gp-ink"?: string;
  "--gp-field"?: string;
  "--gp-foreground"?: string;
};

export type GlyphPortalProps = {
  word?: string;
  /** First matching character. Omit to choose the largest safe patch of ink. */
  focusChar?: string;
  interactive?: boolean;
  background?: ReactNode;
  behind?: ReactNode;
  front?: ReactNode;
  children?: ReactNode;
  /** Scroll travel in visible container heights. */
  scrollLength?: number;
  verticalRatio?: number;
  fontScale?: number;
  fontFamily?: string;
  fontWeight?: number;
  annotations?: boolean;
  enterLabel?: string;
  className?: string;
  style?: GlyphPortalStyle;
  onProgress?: (progress: number) => void;
};

const clamp = (n: number, a = 0, b = 1) => Math.min(b, Math.max(a, n));
const smooth = (a: number, b: number, n: number) => {
  const t = clamp((n - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const DEFAULT_FONT = '"Montserrat", "Arial Black", "Arial", sans-serif';
type Ink = { x: number; y: number; radius: number; index: number };
type Letter = { index: number; x: number; y: number; width: number; height: number };

/** Largest opaque square inside letter ink, in linear time. */
function interior(context: CanvasRenderingContext2D, char: string, font: string): Omit<Ink, "index"> | null {
  try {
    const canvas = context.canvas;
    context.font = font;
    const m = context.measureText(char);
    const pad = 8;
    const left = Math.ceil(m.actualBoundingBoxLeft || 0);
    const ascent = Math.ceil(m.actualBoundingBoxAscent || 70);
    canvas.width = Math.max(1, Math.ceil((m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || 50)) + pad * 2);
    canvas.height = Math.max(1, Math.ceil((m.actualBoundingBoxAscent || 70) + (m.actualBoundingBoxDescent || 20)) + pad * 2);
    context.font = font;
    context.fontKerning = "none";
    context.fillText(char, pad + left, pad + ascent);
    const { width, height } = canvas;
    const pixels = context.getImageData(0, 0, width, height).data;
    const rows = new Uint16Array(width + 1);
    let size = 0, bx = 0, by = 0;
    for (let y = 0; y < height; y++) {
      let diagonal = 0;
      for (let x = 0; x < width; x++) {
        const above = rows[x + 1];
        rows[x + 1] = pixels[(y * width + x) * 4 + 3] > 240
          ? Math.min(above, rows[x], diagonal) + 1 : 0;
        diagonal = above;
        if (rows[x + 1] > size) { size = rows[x + 1]; bx = x; by = y; }
      }
    }
    if (size < 3) return null;
    return {
      x: (bx + 1 - size / 2 - pad - left) / 3,
      y: (by + 1 - size / 2 - pad - ascent) / 3,
      radius: (size / 2 - 1) / 3
    };
  } catch {
    return null;
  }
}

/** Largest square inside an enclosed counter hole (e.g. the closed circle of 'a'), in linear time. */
function findHole(context: CanvasRenderingContext2D, char: string, font: string): Omit<Ink, "index"> | null {
  try {
    const canvas = context.canvas;
    context.font = font;
    const m = context.measureText(char);
    const pad = 12;
    const left = Math.ceil(m.actualBoundingBoxLeft || 0);
    const ascent = Math.ceil(m.actualBoundingBoxAscent || 70);
    canvas.width = Math.max(1, Math.ceil((m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || 50)) + pad * 2);
    canvas.height = Math.max(1, Math.ceil((m.actualBoundingBoxAscent || 70) + (m.actualBoundingBoxDescent || 20)) + pad * 2);
    context.font = font;
    context.fontKerning = "none";
    context.fillText(char, pad + left, pad + ascent);
    const { width, height } = canvas;
    const pixels = context.getImageData(0, 0, width, height).data;

    // Flood fill from borders to identify all exterior background pixels
    const total = width * height;
    const isExterior = new Uint8Array(total);
    const queue = new Int32Array(total);
    let qHead = 0, qTail = 0;

    const pushExterior = (x: number, y: number) => {
      const idx = y * width + x;
      if (!isExterior[idx] && pixels[idx * 4 + 3] < 128) {
        isExterior[idx] = 1;
        queue[qTail++] = idx;
      }
    };

    for (let x = 0; x < width; x++) {
      pushExterior(x, 0);
      pushExterior(x, height - 1);
    }
    for (let y = 0; y < height; y++) {
      pushExterior(0, y);
      pushExterior(width - 1, y);
    }

    while (qHead < qTail) {
      const idx = queue[qHead++];
      const cx = idx % width;
      const cy = Math.floor(idx / width);

      if (cx > 0) pushExterior(cx - 1, cy);
      if (cx < width - 1) pushExterior(cx + 1, cy);
      if (cy > 0) pushExterior(cx, cy - 1);
      if (cy < height - 1) pushExterior(cx, cy + 1);
    }

    // Identify enclosed counter hole (isExterior === 0 and alpha < 128)
    const rows = new Uint16Array(width + 1);
    let size = 0, bx = 0, by = 0;
    for (let y = 0; y < height; y++) {
      let diagonal = 0;
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const above = rows[x + 1];
        const isHole = !isExterior[idx] && pixels[idx * 4 + 3] < 128;
        rows[x + 1] = isHole ? Math.min(above, rows[x], diagonal) + 1 : 0;
        diagonal = above;
        if (rows[x + 1] > size) {
          size = rows[x + 1];
          bx = x;
          by = y;
        }
      }
    }

    if (size < 3) return null;
    return {
      x: (bx + 1 - size / 2 - pad - left) / 3,
      y: (by + 1 - size / 2 - pad - ascent) / 3,
      radius: (size / 2 - 1) / 3
    };
  } catch {
    return null;
  }
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let p = element.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight && p !== document.body && p !== document.documentElement) return p;
  }
  return null;
}

export default function GlyphPortal({
  word = "Pearl.",
  focusChar = "a",
  interactive = false,
  background,
  behind,
  front,
  children,
  scrollLength = 3.6,
  verticalRatio = 0.30,
  fontScale = 1.0,
  fontFamily = DEFAULT_FONT,
  fontWeight = 700,
  annotations = false,
  className,
  style,
  onProgress,
}: GlyphPortalProps) {
  const uid = `gp-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const clipId = `${uid}-clip`;
  const sectionRef = useRef<HTMLElement>(null);
  const progressRef = useRef(onProgress);
  useEffect(() => { progressRef.current = onProgress; }, [onProgress]);

  const text = word.trim().normalize("NFC") || "Pearl.";
  const length = Number.isFinite(scrollLength) ? clamp(scrollLength, 1.5, 8) : 3.6;
  const weight = Number.isFinite(fontWeight) ? clamp(fontWeight, 100, 900) : 700;
  const q = `:where(#${uid})`;
  const yRatio = Number.isFinite(verticalRatio) ? verticalRatio : 0.30;
  const fScale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1.0;

  useEffect(() => {
    const section = sectionRef.current!;
    const pin = section.querySelector<HTMLElement>("[data-gp-pin]")!;
    const field = section.querySelector<HTMLElement>("[data-gp-field]")!;
    const art = section.querySelector<SVGSVGElement>("[data-gp-art]")!;
    const clip = section.querySelector<SVGClipPathElement>(`#${clipId}`)!;
    const glyph = section.querySelector<SVGTextElement>("[data-gp-glyph]")!;
    const marks = section.querySelector<SVGGElement>("[data-gp-marks]")!;
    const dotOuter = section.querySelector<SVGGElement>("[data-gp-dot-outer]");
    const dotInner = section.querySelector<SVGGElement>("[data-gp-dot-inner]");
    const dotCircle = section.querySelector<SVGCircleElement>("[data-gp-dot-circle]");
    const root = scrollParent(section);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let disposed = false, raf = 0, dirty = true, ready = false;
    let W = 1, H = 1, travel = 1, startScale = 1, endScale = 1;
    let center = { x: 0, y: 0 }, target: Ink | null = null;
    let lastProgress = -1;
    let currentProgress = -1;
    let targetProgress = 0;
    let currentYRatio = yRatio;
    let candidates: Ink[] = [], letters: Letter[] = [];
    let bounds = { x: 0, y: 0, width: 1, height: 1 };
    let fontDirty = true;

    glyph.style.fontFamily = fontFamily;

    const readInk = () => {
      if (!context) return false;
      const font = getComputedStyle(glyph);
      const scanFont = `${weight} 300px ${font.fontFamily || DEFAULT_FONT}`;
      context.font = `${weight} 100px ${font.fontFamily || DEFAULT_FONT}`;
      context.fontKerning = "none";
      const metrics = context.measureText(text);
      const advances = Array.from({ length: text.length }, (_, i) => context.measureText(text.slice(0, i)).width);

      bounds = {
        x: -metrics.actualBoundingBoxLeft,
        y: -metrics.actualBoundingBoxAscent,
        width: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
        height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
      };
      if (!bounds.width || !bounds.height) {
        bounds = { x: 0, y: -70, width: metrics.width || 300, height: 80 };
      }
      center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };

      const requested = focusChar ? text.toLowerCase().indexOf(focusChar.toLowerCase().normalize("NFC")) : -1;
      let offset = 0;
      candidates = [];
      letters = [];
      for (const char of Array.from(text)) {
        context.font = `${weight} 100px ${font.fontFamily || DEFAULT_FONT}`;
        const m = context.measureText(char);
        const lLeft = m.actualBoundingBoxLeft || 0;
        const lAscent = m.actualBoundingBoxAscent || 70;
        const lWidth = Math.max(1, (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || m.width || 40));
        const lHeight = Math.max(1, (m.actualBoundingBoxAscent || 70) + (m.actualBoundingBoxDescent || 20));

        letters.push({
          index: offset,
          x: advances[offset] - lLeft,
          y: -lAscent,
          width: lWidth,
          height: lHeight
        });

        // Find the enclosed counter hole for the character (e.g. the closed circle of 'a')
        const found = findHole(context, char, scanFont) ?? interior(context, char, scanFont);
        if (found) {
          candidates.push({ ...found, x: found.x + advances[offset], index: offset });
        }
        offset += char.length;
      }

      // Lock camera target to the hole / counter of letter 'a' (index 2 for "Pearl.")
      const targetLetter = (requested !== -1 ? letters.find((l) => l.index === requested) : null) ?? letters[2] ?? letters[0];
      const foundCandidate = requested !== -1 ? candidates.find((c) => c.index === requested) : null;

      if (foundCandidate) {
        target = foundCandidate;
      } else if (targetLetter) {
        // Fallback directly to the closed circle (counter bowl) inside the letter 'a'
        target = {
          x: targetLetter.x + targetLetter.width * 0.46,
          y: targetLetter.y + targetLetter.height * 0.68,
          radius: Math.max(10, Math.min(targetLetter.width, targetLetter.height) * 0.22),
          index: targetLetter.index
        };
      } else {
        target = { x: center.x, y: center.y, radius: 24, index: 0 };
      }

      // Configure SVG position of the legendary gradient period dot
      const baseText = text.endsWith(".") ? text.slice(0, -1) : text;
      context.font = `${weight} 100px ${font.fontFamily || DEFAULT_FONT}`;
      const baseMetrics = context.measureText(baseText);
      const dotX = (baseMetrics.actualBoundingBoxRight || baseMetrics.width) + 16.5;
      const dotY = -8;
      const dotR = 8;
      if (dotCircle) {
        dotCircle.setAttribute("cx", String(dotX));
        dotCircle.setAttribute("cy", String(dotY));
        dotCircle.setAttribute("r", String(dotR));
      }

      return true;
    };

    const select = (next: Ink | null) => {
      target = next ?? target;
      // Deep zoom into the closed circle hole of 'a' so it comfortably expands past all screen corners
      endScale = target ? Math.max(startScale * 80, Math.hypot(W, H) / (target.radius * 0.65)) : startScale * 80;
      section.dataset.gpFocus = target ? Array.from(text.slice(target.index))[0] : "";
    };

    const position = () => {
      const origin = root ? root.getBoundingClientRect().top + root.clientTop : 0;
      return clamp((origin - section.getBoundingClientRect().top) / travel);
    };

    const paint = (progress: number) => {
      const isStatic = motion.matches;
      const p = isStatic ? 0 : progress;

      // ── PROGRESSION ARCHITECTURE ──
      // [0.00 -> 0.22]: Reading Runway (Comfortable Delay). Pearl is at resting scale, copy is 100% readable.
      // [0.18 -> 0.30]: Front subtext gently fades out and glides upward.
      // [0.22 -> 0.60]: Cinematic Camera Glide into the hole of 'a' (smooth, measured pacing).
      // [0.54 -> 0.64]: Inside showroom room reveals smoothly.
      // [0.58 -> 1.00]: Pinned matte white showroom experience.

      // Camera zoom starts after the initial reading delay (p >= 0.22)
      const t = clamp((p - 0.22) / 0.36);
      const eased = t * t * (3 - 2 * t);
      const scale = Math.exp(Math.log(startScale) + Math.log(endScale / startScale) * eased);
      const blend = endScale === startScale ? 0 : (1 / scale - 1 / startScale) / (1 / endScale - 1 / startScale);
      const cx = center.x + ((target?.x ?? center.x) - center.x) * blend;
      const cy = center.y + ((target?.y ?? center.y) - center.y) * blend;
      const roll = -3 * smooth(0.04, 0.45, t) * (1 - smooth(0.65, 0.95, t));

      const radians = (roll * Math.PI) / 180;
      const dx = W / 2 / scale;
      const dy = (H * currentYRatio + H * 0.04 * eased) / scale;

      clip.setAttribute("transform", `scale(${scale}) rotate(${roll})`);
      glyph.setAttribute(
        "transform",
        `translate(${Math.cos(radians) * dx + Math.sin(radians) * dy - cx} ${-Math.sin(radians) * dx + Math.cos(radians) * dy - cy})`
      );

      if (marks) {
        marks.setAttribute("transform", `translate(${W / 2} ${H * currentYRatio + H * 0.04 * eased}) scale(${scale}) rotate(${roll}) translate(${-cx} ${-cy})`);
        marks.style.opacity = String(1 - smooth(0.20, 0.36, p));
      }

      if (dotOuter) {
        dotOuter.setAttribute("transform", clip.getAttribute("transform")!);
        if (dotInner) {
          dotInner.setAttribute("transform", glyph.getAttribute("transform")!);
        }
        // Fade the gradient period dot out smoothly as we zoom into 'a'
        dotOuter.style.opacity = String(1 - smooth(0.22, 0.42, p));
      }

      // When zooming into the hole of 'a', keep field clipped to the glyph letters
      field.style.clipPath = `url(#${clipId})`;
      // As camera passes deep into the hole (t >= 0.85), gracefully fade field opacity to eliminate any edge bleeding
      field.style.opacity = String(1 - smooth(0.85, 0.98, t));

      // Front subtext stays 100% visible through the reading runway, then fades gracefully
      const frontOpacity = isStatic ? 1 : Math.max(0, 1 - smooth(0.18, 0.30, p));
      section.style.setProperty("--gp-front-opacity", String(frontOpacity));
      section.style.setProperty("--gp-front-hit", frontOpacity > 0.05 ? "auto" : "none");
      section.style.setProperty("--gp-front-visibility", frontOpacity > 0.01 ? "visible" : "hidden");
      section.style.setProperty("--gp-front-y", `${(1 - frontOpacity) * -22}px`);

      // Behind dome fades out smoothly as zoom takes off
      const stageOpacity = isStatic ? 1 : 1 - smooth(0.22, 0.40, p);
      section.style.setProperty("--gp-behind-opacity", String(stageOpacity));

      // Reveal the pinned interior destination room smoothly once inside the white hole
      const reveal = isStatic ? 1 : clamp((p - 0.54) / 0.10);
      section.style.setProperty("--gp-reveal", String(reveal));
      section.style.setProperty("--gp-content-hit", p >= 0.58 ? "auto" : "none");
      section.style.setProperty("--gp-field-scale", String(1 + 0.14 * smooth(0.22, 0.88, p)));
      section.dataset.gpEntered = String(p >= 0.50);
      section.dataset.gpProgress = p.toFixed(5);
      if (p >= 0.50) {
        section.style.background = "#f4f6f8";
      } else {
        section.style.background = "";
      }

      if (p !== lastProgress) {
        lastProgress = p;
        progressRef.current?.(p);
      }
    };

    const layout = () => {
      if (!section.clientWidth) return;
      W = pin.clientWidth;
      const smallViewport = section.querySelector<HTMLElement>("[data-gp-viewport]")!.offsetHeight || window.innerHeight;
      const viewportHeight = Math.max(1, Math.min(root?.clientHeight ?? smallViewport, smallViewport));
      H = motion.matches ? Math.min(viewportHeight * 0.75, 480) : viewportHeight;
      section.style.setProperty("--gp-height", `${H}px`);

      const isMobile = W < 768;
      // On mobile phones, elevate yRatio slightly and adapt travel length
      currentYRatio = isMobile ? 0.17 : yRatio;
      const effectiveLength = isMobile ? Math.min(length, 6.0) : length;
      section.style.setProperty("--gp-length", String(effectiveLength));
      travel = Math.max(1, (effectiveLength - 1) * H);
      art.setAttribute("viewBox", `0 0 ${W} ${H}`);

      if (fontDirty) {
        ready = readInk();
        fontDirty = false;
      }
      if (!ready) return;

      // On mobile screens, scale typography so Pearl is bold, prominent, and proportional
      const mobileFScale = isMobile ? Math.max(0.78, Math.min(0.92, (W / 400) * 0.85)) : fScale;
      const widthFactor = isMobile ? 0.84 : 0.65;
      const heightFactor = isMobile ? 0.18 : 0.26;
      const wordHeight = H * heightFactor * mobileFScale;
      startScale = Math.min((W * widthFactor * mobileFScale) / bounds.width, wordHeight / bounds.height);

      select(target);

      if (dotOuter && dotInner) {
        dotOuter.setAttribute("transform", `scale(${startScale})`);
        dotInner.setAttribute("transform", `translate(${W / 2 / startScale - center.x} ${H * currentYRatio / startScale - center.y})`);
      }

      section.dataset.gpReady = "true";
      section.dataset.gpMotion = motion.matches ? "off" : "on";
    };

    const frame = () => {
      raf = 0;
      if (disposed) return;
      if (dirty) {
        dirty = false;
        layout();
      }
      if (ready) {
        targetProgress = position();

        // Initial paint or jump without lerp
        if (currentProgress < 0) {
          currentProgress = targetProgress;
        } else {
          // Fluid damping to absorb high-speed flick / wheel spikes
          const delta = targetProgress - currentProgress;
          if (Math.abs(delta) > 0.0002) {
            currentProgress += delta * 0.20;
            // Continue frame loop until settled
            raf = requestAnimationFrame(frame);
          } else {
            currentProgress = targetProgress;
          }
        }

        paint(currentProgress);
      }
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const resize = () => {
      cancelAnimationFrame(raf);
      dirty = true;
      currentProgress = -1;
      frame();
    };

    const scroll = () => schedule();

    // Re-check ink once web fonts finish loading
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (disposed) return;
        fontDirty = true;
        dirty = true;
        schedule();
      });
    }

    const observer = new ResizeObserver(resize);
    observer.observe(section);
    if (root) observer.observe(root);

    const visibility = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          dirty = true;
          schedule();
        } else if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
      },
      { root, rootMargin: "100% 0px" }
    );
    visibility.observe(section);

    (root ?? window).addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("resize", resize);

    // Initial frame
    frame();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      visibility.disconnect();
      (root ?? window).removeEventListener("scroll", scroll);
      window.removeEventListener("resize", resize);
    };
  }, [text, focusChar, fontFamily, weight, length, clipId, yRatio, fScale]);

  return (
    <section
      ref={sectionRef}
      id={uid}
      className={className}
      aria-label={text}
      style={
        {
          "--gp-length": length,
          "--gp-characters": Array.from(text).length,
          ...style,
        } as CSSProperties
      }
    >
      <style>{`
        ${q} {
          --gp-paper: #f4f6f8;
          --gp-ink: #0a0a0a;
          --gp-field: #0a0a0a;
          --gp-foreground: #0f172a;
          position: relative;
          isolation: isolate;
          background: var(--gp-paper);
          color: var(--gp-ink);
          font-family: inherit;
          /* Critical: Section must span the full multi-viewport scroll track so pin holds */
          height: calc(var(--gp-length, 3.6) * var(--gp-height, 100svh));
          min-height: calc(var(--gp-length, 3.6) * 100vh);
          margin: 0 !important;
          padding: 0 !important;
          transition: background-color 0.25s ease;
        }
        ${q}[data-gp-entered="true"] {
          background: #f4f6f8 !important;
        }
        ${q} > [data-gp-viewport] {
          position: absolute;
          inset: 0 auto auto 0;
          height: 100vh;
          height: 100svh;
          width: 0;
          pointer-events: none;
          visibility: hidden;
        }
        /* Pinned container: Remains fixed at top: 0 for the entire travel */
        ${q} [data-gp-pin] {
          position: sticky !important;
          top: 0 !important;
          left: 0;
          width: 100%;
          height: var(--gp-height, 100svh);
          overflow: clip;
          isolation: isolate;
          container-type: size;
        }
        ${q} [data-gp-behind] {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 1;
          opacity: var(--gp-behind-opacity, 1);
          transition: opacity 0.15s ease-out;
        }
        ${q} [data-gp-field] {
          position: absolute;
          inset: 0;
          background: var(--gp-field);
          opacity: 0;
          pointer-events: none;
          z-index: 10;
        }
        ${q}[data-gp-ready] [data-gp-field] {
          opacity: 1;
        }
        ${q} [data-gp-art] {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          overflow: visible;
          pointer-events: none;
          z-index: 15;
        }
        ${q} [data-gp-marks] {
          fill: none;
          stroke: var(--gp-ink);
          opacity: 0.6;
        }
        ${q} [data-gp-front] {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          pointer-events: var(--gp-front-hit, auto);
          z-index: 20;
          opacity: var(--gp-front-opacity, 1);
          visibility: var(--gp-front-visibility, visible);
          transform: translateY(var(--gp-front-y, 0px));
          transition: opacity 0.16s ease-out, transform 0.16s ease-out;
          will-change: opacity, transform;
        }
        ${q} [data-gp-pinned-room] {
          position: absolute;
          inset: 0;
          z-index: 30;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: stretch;
          justify-content: flex-start;
          opacity: var(--gp-reveal, 0);
          pointer-events: var(--gp-content-hit, none);
          transition: opacity 0.25s ease-out;
          overflow: hidden;
        }
        @media(prefers-reduced-motion: reduce) {
          ${q} [data-gp-pin] {
            position: relative !important;
          }
        }
      `}</style>
      <div data-gp-viewport aria-hidden="true" />
      <div data-gp-pin>
        {behind && <div data-gp-behind>{behind}</div>}
        <div data-gp-field aria-hidden="true" inert>
          {background ?? (
            <div
              data-gp-default-field
              style={{
                position: "absolute",
                inset: 0,
                transform: "scale(var(--gp-field-scale,1))",
                background: "#0a0a0a",
              }}
            />
          )}
        </div>
        <svg data-gp-art aria-hidden="true" focusable="false">
          <defs>
            <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
              <text
                data-gp-glyph
                x="0"
                y="0"
                style={{
                  fontFamily,
                  fontWeight: weight,
                  fontSize: 100,
                  fontKerning: "none",
                  fontVariantLigatures: "none",
                  letterSpacing: 0,
                }}
              >
                {text.endsWith(".") ? text.slice(0, -1) : text}
              </text>
            </clipPath>
            <linearGradient id={`${uid}-legendary-dot`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#44d8f4" />
              <stop offset="100%" stopColor="#1037ff" />
            </linearGradient>
          </defs>
          <g data-gp-marks style={{ visibility: annotations ? "visible" : "hidden" }}>
            <path />
          </g>
          <g data-gp-dot-outer style={{ opacity: text.endsWith(".") ? 1 : 0 }}>
            <g data-gp-dot-inner>
              <circle data-gp-dot-circle cx="0" cy="0" r="0" fill={`url(#${uid}-legendary-dot)`} />
            </g>
          </g>
        </svg>

        {front && <div data-gp-front>{front}</div>}

        {/* Pinned Interior Room: Stays locked inside the sticky pin container */}
        <div
          data-gp-pinned-room
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 30,
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "stretch",
            justifyContent: "flex-start",
            opacity: "var(--gp-reveal, 0)",
            pointerEvents: "var(--gp-content-hit, none)",
            transition: "opacity 0.25s ease-out",
            overflow: "hidden",
          }}
        >
          {children}
        </div>
      </div>
    </section>
  );
}
