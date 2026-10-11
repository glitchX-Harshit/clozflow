import React, { useEffect, useRef, useState } from 'react';

const FONT_STACK = 'ui-monospace, "SF Mono", "Cascadia Code", "Source Code Pro", Menlo, Consolas, Monaco, monospace';

/**
 * Pure 3D ASCII Wireframe Engine
 * Real-time 3D coordinate projection directly to raw monospace characters
 */
function renderCompact3DAscii(type, angleX, angleY, angleZ, isHovered, tick) {
  const cols = 16;
  const rows = 8;
  const buffer = Array.from({ length: rows }, () => Array(cols).fill(' '));
  const zBuffer = Array.from({ length: rows }, () => Array(cols).fill(-999));

  let vertices = [];
  let edges = [];

  if (type === 'telecom_cube') {
    // 3D Isometric Telecom Cube
    const s = 1.15;
    vertices = [
      [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
      [-s, -s, s],  [s, -s, s],  [s, s, s],  [-s, s, s]
    ];
    edges = [
      [0,1], [1,2], [2,3], [3,0],
      [4,5], [5,6], [6,7], [7,4],
      [0,4], [1,5], [2,6], [3,7]
    ];
  } else {
    // 3D Octahedral SIP Trunk Matrix
    const s = 1.4;
    vertices = [
      [0, -s, 0], [0, s, 0],
      [-s, 0, 0], [s, 0, 0],
      [0, 0, -s], [0, 0, s]
    ];
    edges = [
      [0,2], [0,3], [0,4], [0,5],
      [1,2], [1,3], [1,4], [1,5],
      [2,4], [4,3], [3,5], [5,2]
    ];
  }

  const sinX = Math.sin(angleX), cosX = Math.cos(angleX);
  const sinY = Math.sin(angleY), cosY = Math.cos(angleY);
  const sinZ = Math.sin(angleZ), cosZ = Math.cos(angleZ);

  const project = ([x, y, z]) => {
    let x1 = x * cosY + z * sinY;
    let y1 = y;
    let z1 = -x * sinY + z * cosY;

    let x2 = x1;
    let y2 = y1 * cosX - z1 * sinX;
    let z2 = y1 * sinX + z1 * cosX;

    let x3 = x2 * cosZ - y2 * sinZ;
    let y3 = x2 * sinZ + y2 * cosZ;
    let z3 = z2;

    const distance = 3.3;
    const factor = (cols * 0.44) / (z3 + distance);
    const screenX = Math.floor(cols / 2 + x3 * factor * 1.6);
    const screenY = Math.floor(rows / 2 + y3 * factor * 0.85);

    return { sx: screenX, sy: screenY, z: z3 };
  };

  const drawLine3D = (p1, p2, edgeIdx) => {
    const proj1 = project(p1);
    const proj2 = project(p2);

    let x0 = proj1.sx, y0 = proj1.sy;
    let x1 = proj2.sx, y1 = proj2.sy;

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    const steps = Math.max(dx, dy, 1);
    let stepCount = 0;

    const glyphs = isHovered 
      ? ['#', '*', '+', '=', '%', '·'] 
      : ['+', '*', '·', ':', '-', '/'];

    while (true) {
      if (x0 >= 0 && x0 < cols && y0 >= 0 && y0 < rows) {
        const t = stepCount / steps;
        const currentZ = proj1.z * (1 - t) + proj2.z * t;
        if (currentZ > zBuffer[y0][x0]) {
          zBuffer[y0][x0] = currentZ;
          const charIdx = (edgeIdx + stepCount + Math.floor(tick / 2)) % glyphs.length;
          buffer[y0][x0] = glyphs[charIdx];
        }
      }

      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
      stepCount++;
    }
  };

  edges.forEach(([i, j], edgeIdx) => {
    if (vertices[i] && vertices[j]) {
      drawLine3D(vertices[i], vertices[j], edgeIdx);
    }
  });

  return buffer.map(row => row.join('')).join('\n');
}

/**
 * 1. ClozFlowTelephonyNode — Pure Raw ASCII (Zero borders, zero cards)
 * For "Rent from ClozFlow"
 */
export const ClozFlowTelephonyNode = ({ isHovered = false }) => {
  const [frameText, setFrameText] = useState('');
  const animRef = useRef(null);
  const stateRef = useRef({ angleX: 0.4, angleY: 0.6, angleZ: 0.1, tick: 0 });

  useEffect(() => {
    let lastTime = performance.now();

    const loop = (currentTime) => {
      const dt = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      const speed = isHovered ? 2.4 : 0.8;
      stateRef.current.angleX += 0.6 * dt * speed;
      stateRef.current.angleY += 0.9 * dt * speed;
      stateRef.current.angleZ += 0.3 * dt * speed;
      stateRef.current.tick += 1;

      const ascii = renderCompact3DAscii(
        'telecom_cube',
        stateRef.current.angleX,
        stateRef.current.angleY,
        stateRef.current.angleZ,
        isHovered,
        stateRef.current.tick
      );

      setFrameText(ascii);
      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [isHovered]);

  return (
    <div className="pearl-ascii-raw-node" aria-hidden="true">
      <pre className="ascii-raw-pre theme-copper" style={{ fontFamily: FONT_STACK }}>
        {frameText}
      </pre>
    </div>
  );
};

/**
 * 2. BringYourOwnTrunkNode — Pure Raw ASCII (Zero borders, zero cards)
 * For "Bring your own telephony"
 */
export const BringYourOwnTrunkNode = ({ isHovered = false }) => {
  const [frameText, setFrameText] = useState('');
  const animRef = useRef(null);
  const stateRef = useRef({ angleX: 0.8, angleY: 0.4, angleZ: 0.2, tick: 0 });

  useEffect(() => {
    let lastTime = performance.now();

    const loop = (currentTime) => {
      const dt = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      const speed = isHovered ? 2.6 : 0.85;
      stateRef.current.angleX += 0.8 * dt * speed;
      stateRef.current.angleY += 0.5 * dt * speed;
      stateRef.current.angleZ += 0.4 * dt * speed;
      stateRef.current.tick += 1;

      const ascii = renderCompact3DAscii(
        'octa_sip',
        stateRef.current.angleX,
        stateRef.current.angleY,
        stateRef.current.angleZ,
        isHovered,
        stateRef.current.tick
      );

      setFrameText(ascii);
      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [isHovered]);

  return (
    <div className="pearl-ascii-raw-node" aria-hidden="true">
      <pre className="ascii-raw-pre theme-emerald" style={{ fontFamily: FONT_STACK }}>
        {frameText}
      </pre>
    </div>
  );
};
