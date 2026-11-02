import React, { useEffect, useRef } from 'react';

/**
 * CyberVaultCanvas3D
 * Lightweight, zero-dependency HTML5 2D-projected 3D wireframe vault & cyber constellation.
 * Fully JSDOM/headless safe with rigorous context guards.
 */
export default function CyberVaultCanvas3D({
  opacity = 0.65,
  speed = 1,
  starCount = 55,
  interactive = true,
  className = '',
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    // Gracefully bypass canvas execution in headless JSDOM / Vitest environments
    if (
      typeof window === 'undefined' ||
      typeof navigator === 'undefined' ||
      navigator.userAgent?.includes('jsdom') ||
      navigator.userAgent?.includes('Node.js')
    ) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.getContext !== 'function') return;

    let ctx = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      return;
    }
    if (!ctx) return;

    let animFrameId = null;
    let width = 0;
    let height = 0;

    const resize = () => {
      if (!canvas) return;
      width = canvas.parentElement ? canvas.parentElement.clientWidth : window.innerWidth;
      height = canvas.parentElement ? canvas.parentElement.clientHeight : window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };
    resize();
    window.addEventListener('resize', resize);

    // Mouse parallax tracking
    const mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
    const handleMouseMove = (e) => {
      if (!interactive) return;
      const nx = (e.clientX / (window.innerWidth || 1)) - 0.5;
      const ny = (e.clientY / (window.innerHeight || 1)) - 0.5;
      mouse.targetX = nx * 0.8;
      mouse.targetY = ny * 0.8;
    };
    window.addEventListener('mousemove', handleMouseMove);

    // Cryptographic Core Geometry: Icosahedron Vertices
    const phi = (1 + Math.sqrt(5)) / 2;
    const rawVertices = [
      [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
      [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
      [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1]
    ];
    // Normalize to unit sphere
    const icosaVertices = rawVertices.map(([x, y, z]) => {
      const len = Math.hypot(x, y, z);
      return [x / len, y / len, z / len];
    });

    // Edges connecting vertices with distance squared close to ~ (4 / (1 + phi^2))
    const icosaEdges = [];
    for (let i = 0; i < icosaVertices.length; i++) {
      for (let j = i + 1; j < icosaVertices.length; j++) {
        const dx = icosaVertices[i][0] - icosaVertices[j][0];
        const dy = icosaVertices[i][1] - icosaVertices[j][1];
        const dz = icosaVertices[i][2] - icosaVertices[j][2];
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < 1.15) {
          icosaEdges.push([i, j]);
        }
      }
    }

    // Inner Octahedron core
    const octaVertices = [
      [1, 0, 0], [-1, 0, 0],
      [0, 1, 0], [0, -1, 0],
      [0, 0, 1], [0, 0, -1]
    ];
    const octaEdges = [
      [0, 2], [2, 1], [1, 3], [3, 0],
      [0, 4], [2, 4], [1, 4], [3, 4],
      [0, 5], [2, 5], [1, 5], [3, 5]
    ];

    // Constellation Cyber-Nodes
    const nodes = [];
    for (let i = 0; i < starCount; i++) {
      nodes.push({
        x: (Math.random() - 0.5) * 800,
        y: (Math.random() - 0.5) * 600,
        z: (Math.random() - 0.5) * 600,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        vz: (Math.random() - 0.5) * 0.4,
        size: Math.random() * 2 + 1,
      });
    }

    let rotX = 0;
    let rotY = 0;
    let rotZ = 0;

    const render = () => {
      if (!ctx || width === 0 || height === 0) return;

      // Mouse smoothing
      mouse.x += (mouse.targetX - mouse.x) * 0.05;
      mouse.y += (mouse.targetY - mouse.y) * 0.05;

      ctx.clearRect(0, 0, width, height);

      rotX += 0.004 * speed + mouse.y * 0.01;
      rotY += 0.006 * speed + mouse.x * 0.01;
      rotZ += 0.002 * speed;

      const fov = 340;
      const cx = width / 2;
      const cy = height / 2;

      // Draw background perspective cyber grid lines
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.04)';
      ctx.lineWidth = 1;
      const gridStep = 45;
      for (let x = 0; x < width; x += gridStep) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridStep) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      ctx.restore();

      // Project 3D helper function
      const project = (x, y, z, rx, ry, rz, scaleRadius, camDist = 380) => {
        // Rotate Y
        const cosY = Math.cos(ry);
        const sinY = Math.sin(ry);
        const x1 = x * cosY + z * sinY;
        const z1 = -x * sinY + z * cosY;

        // Rotate X
        const cosX = Math.cos(rx);
        const sinX = Math.sin(rx);
        const y2 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;

        // Rotate Z
        const cosZ = Math.cos(rz);
        const sinZ = Math.sin(rz);
        const x3 = x1 * cosZ - y2 * sinZ;
        const y3 = x1 * sinZ + y2 * cosZ;

        const factor = fov / (fov + z2 * scaleRadius + camDist);
        return {
          sx: cx + x3 * scaleRadius * factor,
          sy: cy + y3 * scaleRadius * factor,
          depth: z2,
          visible: factor > 0
        };
      };

      // 1. Render Cyber-Nodes & Connecting Neural Edges
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        n.x += n.vx;
        n.y += n.vy;
        n.z += n.vz;

        if (n.x < -400) n.x = 400;
        if (n.x > 400) n.x = -400;
        if (n.y < -300) n.y = 300;
        if (n.y > 300) n.y = -300;
        if (n.z < -300) n.z = 300;
        if (n.z > 300) n.z = -300;

        const p = project(n.x, n.y, n.z, mouse.y * 0.4, mouse.x * 0.4, 0, 1, 400);
        n.sx = p.sx;
        n.sy = p.sy;

        ctx.fillStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, n.size, 0, Math.PI * 2);
        ctx.fill();
      }

      // Connect close constellation nodes
      ctx.lineWidth = 0.6;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].sx - nodes[j].sx;
          const dy = nodes[i].sy - nodes[j].sy;
          const dist = Math.hypot(dx, dy);
          if (dist < 80) {
            const alpha = (1 - dist / 80) * 0.18;
            ctx.strokeStyle = `rgba(0, 240, 255, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(nodes[i].sx, nodes[i].sy);
            ctx.lineTo(nodes[j].sx, nodes[j].sy);
            ctx.stroke();
          }
        }
      }

      // 2. Render Outer 3D Icosahedron Core (Rotating Vault Cryptographic Cage)
      const coreRadius = Math.min(width, height) * 0.22;
      const projectedIcosa = icosaVertices.map(([x, y, z]) =>
        project(x, y, z, rotX, rotY, rotZ, coreRadius, 400)
      );

      ctx.lineWidth = 1.2;
      for (const [i1, i2] of icosaEdges) {
        const p1 = projectedIcosa[i1];
        const p2 = projectedIcosa[i2];
        const avgDepth = (p1.depth + p2.depth) / 2;
        const edgeAlpha = Math.max(0.12, Math.min(0.85, (avgDepth + 1) * 0.45));

        ctx.strokeStyle = `rgba(56, 189, 248, ${edgeAlpha})`;
        ctx.beginPath();
        ctx.moveTo(p1.sx, p1.sy);
        ctx.lineTo(p2.sx, p2.sy);
        ctx.stroke();
      }

      // Render glowing vertices
      for (const p of projectedIcosa) {
        const vAlpha = Math.max(0.2, (p.depth + 1) * 0.5);
        ctx.fillStyle = `rgba(0, 240, 255, ${vAlpha})`;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3. Render Inner Counter-Rotating Octahedron
      const innerRadius = coreRadius * 0.52;
      const projectedOcta = octaVertices.map(([x, y, z]) =>
        project(x, y, z, -rotX * 1.5, -rotY * 1.5, rotZ * 1.5, innerRadius, 400)
      );

      ctx.lineWidth = 1;
      for (const [i1, i2] of octaEdges) {
        const p1 = projectedOcta[i1];
        const p2 = projectedOcta[i2];
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.45)';
        ctx.beginPath();
        ctx.moveTo(p1.sx, p1.sy);
        ctx.lineTo(p2.sx, p2.sy);
        ctx.stroke();
      }

      // Glowing center beacon
      const centerPulse = 0.5 + Math.sin(rotX * 4) * 0.3;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, innerRadius * 0.6);
      grad.addColorStop(0, `rgba(56, 189, 248, ${0.45 * centerPulse})`);
      grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, innerRadius * 0.6, 0, Math.PI * 2);
      ctx.fill();

      animFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animFrameId) cancelAnimationFrame(animFrameId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [interactive, opacity, speed, starCount]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`cyber-vault-canvas-3d ${className}`}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        opacity,
        zIndex: 0,
      }}
    />
  );
}
