import React, { useState, useRef } from 'react';

/**
 * TiltCard3D
 * Reusable 3D interactive card with mouse-parallax tilt and specular holographic sheen.
 * Preserves all children, props, and test attributes.
 */
export default function TiltCard3D({
  children,
  className = '',
  variant = 'cyan', // 'cyan' | 'emerald' | 'purple' | 'crimson'
  maxTilt = 8,
  glare = true,
  cornerBrackets = true,
  style = {},
  ...rest
}) {
  const cardRef = useRef(null);
  const [coords, setCoords] = useState({ rx: 0, ry: 0, px: 50, py: 50, isHovered: false });

  const handleMouseMove = (e) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const normX = (x / rect.width) - 0.5;
    const normY = (y / rect.height) - 0.5;

    setCoords({
      rx: -normY * maxTilt,
      ry: normX * maxTilt,
      px: (x / rect.width) * 100,
      py: (y / rect.height) * 100,
      isHovered: true,
    });
  };

  const handleMouseLeave = () => {
    setCoords({ rx: 0, ry: 0, px: 50, py: 50, isHovered: false });
  };

  // Color profiles based on variant
  const variantStyles = {
    cyan: {
      border: '1px solid rgba(56, 189, 248, 0.35)',
      boxShadow: coords.isHovered
        ? '0 20px 40px -10px rgba(0, 0, 0, 0.8), 0 0 25px rgba(56, 189, 248, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.1)'
        : '0 12px 30px -8px rgba(0, 0, 0, 0.7), 0 0 10px rgba(56, 189, 248, 0.15)',
      bracketColor: '#38bdf8',
      glareColor: 'rgba(56, 189, 248, 0.15)',
    },
    emerald: {
      border: '1px solid rgba(16, 185, 129, 0.35)',
      boxShadow: coords.isHovered
        ? '0 20px 40px -10px rgba(0, 0, 0, 0.8), 0 0 25px rgba(16, 185, 129, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.1)'
        : '0 12px 30px -8px rgba(0, 0, 0, 0.7), 0 0 10px rgba(16, 185, 129, 0.15)',
      bracketColor: '#10b981',
      glareColor: 'rgba(16, 185, 129, 0.15)',
    },
    purple: {
      border: '1px solid rgba(168, 85, 247, 0.35)',
      boxShadow: coords.isHovered
        ? '0 20px 40px -10px rgba(0, 0, 0, 0.8), 0 0 25px rgba(168, 85, 247, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.1)'
        : '0 12px 30px -8px rgba(0, 0, 0, 0.7), 0 0 10px rgba(168, 85, 247, 0.15)',
      bracketColor: '#a855f7',
      glareColor: 'rgba(168, 85, 247, 0.15)',
    },
    crimson: {
      border: '1px solid rgba(239, 68, 68, 0.35)',
      boxShadow: coords.isHovered
        ? '0 20px 40px -10px rgba(0, 0, 0, 0.8), 0 0 25px rgba(239, 68, 68, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.1)'
        : '0 12px 30px -8px rgba(0, 0, 0, 0.7), 0 0 10px rgba(239, 68, 68, 0.15)',
      bracketColor: '#ef4444',
      glareColor: 'rgba(239, 68, 68, 0.15)',
    },
  }[variant] || {};

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`tilt-card-3d-wrapper preserve-3d ${className}`}
      style={{
        position: 'relative',
        transform: `perspective(1000px) rotateX(${coords.rx}deg) rotateY(${coords.ry}deg)`,
        transition: coords.isHovered ? 'transform 0.08s ease-out' : 'transform 0.45s ease-out, box-shadow 0.45s ease',
        background: 'linear-gradient(145deg, rgba(13, 22, 41, 0.92) 0%, rgba(6, 11, 22, 0.96) 100%)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderRadius: '14px',
        border: variantStyles.border,
        boxShadow: variantStyles.boxShadow,
        overflow: 'hidden',
        ...style,
      }}
      {...rest}
    >
      {/* Tactical Military Cyber Corner Brackets */}
      {cornerBrackets && (
        <>
          <div
            style={{
              position: 'absolute',
              top: '6px',
              left: '6px',
              width: '12px',
              height: '12px',
              borderTop: `2px solid ${variantStyles.bracketColor}`,
              borderLeft: `2px solid ${variantStyles.bracketColor}`,
              pointerEvents: 'none',
              zIndex: 3,
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: '6px',
              right: '6px',
              width: '12px',
              height: '12px',
              borderTop: `2px solid ${variantStyles.bracketColor}`,
              borderRight: `2px solid ${variantStyles.bracketColor}`,
              pointerEvents: 'none',
              zIndex: 3,
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: '6px',
              left: '6px',
              width: '12px',
              height: '12px',
              borderBottom: `2px solid ${variantStyles.bracketColor}`,
              borderLeft: `2px solid ${variantStyles.bracketColor}`,
              pointerEvents: 'none',
              zIndex: 3,
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: '6px',
              right: '6px',
              width: '12px',
              height: '12px',
              borderBottom: `2px solid ${variantStyles.bracketColor}`,
              borderRight: `2px solid ${variantStyles.bracketColor}`,
              pointerEvents: 'none',
              zIndex: 3,
            }}
          />
        </>
      )}

      {/* Specular Holographic Glare Overlay */}
      {glare && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: 'none',
            zIndex: 2,
            opacity: coords.isHovered ? 1 : 0,
            transition: 'opacity 0.3s ease',
            background: `radial-gradient(circle at ${coords.px}% ${coords.py}%, ${variantStyles.glareColor} 0%, rgba(255, 255, 255, 0.05) 25%, transparent 60%)`,
          }}
        />
      )}

      {/* Card Content with subtle 3D pop */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          transform: coords.isHovered ? 'translateZ(15px)' : 'translateZ(0px)',
          transition: 'transform 0.15s ease-out',
        }}
      >
        {children}
      </div>
    </div>
  );
}

