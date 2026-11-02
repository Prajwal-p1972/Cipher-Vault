import React from 'react';

/**
 * HologramEmblem3D
 * Pure-CSS 3D multi-ring rotating cryptographic emblem with glowing holographic core.
 */
export default function HologramEmblem3D({
  size = 'md', // 'sm' (48px) | 'md' (72px) | 'lg' (96px)
  className = '',
}) {
  const dim = {
    sm: 52,
    md: 76,
    lg: 108,
  }[size] || 76;

  const iconDim = Math.round(dim * 0.42);

  return (
    <div
      aria-hidden="true"
      className={`hologram-emblem-container preserve-3d ${className}`}
      style={{
        position: 'relative',
        width: `${dim}px`,
        height: `${dim}px`,
        margin: '0 auto 1rem auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        perspective: '600px',
      }}
    >
      {/* Outer 3D Gyroscopic Orbital Ring */}
      <div
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          border: '1.5px dashed rgba(56, 189, 248, 0.75)',
          animation: 'spin3dRing 7s linear infinite',
          boxShadow: '0 0 10px rgba(56, 189, 248, 0.3)',
          pointerEvents: 'none',
        }}
      />

      {/* Middle Counter-Rotating Ring */}
      <div
        style={{
          position: 'absolute',
          width: '84%',
          height: '84%',
          borderRadius: '50%',
          border: '1.5px solid rgba(168, 85, 247, 0.65)',
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          animation: 'spin3dRingRev 5s linear infinite',
          boxShadow: '0 0 8px rgba(168, 85, 247, 0.3)',
          pointerEvents: 'none',
        }}
      />

      {/* Inner Fast Orbital Ring */}
      <div
        style={{
          position: 'absolute',
          width: '68%',
          height: '68%',
          borderRadius: '50%',
          border: '1px dotted rgba(0, 240, 255, 0.8)',
          animation: 'spin3dRingZ 3.5s linear infinite',
          pointerEvents: 'none',
        }}
      />

      {/* Glowing Central Cryptographic Shield / Lock */}
      <div
        style={{
          position: 'relative',
          width: `${iconDim * 1.5}px`,
          height: `${iconDim * 1.5}px`,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(56, 189, 248, 0.25) 0%, rgba(13, 22, 41, 0.8) 75%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'cyberPulse 3s ease-in-out infinite',
          border: '1px solid rgba(56, 189, 248, 0.5)',
          boxShadow: '0 0 16px rgba(56, 189, 248, 0.4), inset 0 0 8px rgba(56, 189, 248, 0.3)',
          zIndex: 2,
        }}
      >
        <svg
          width={iconDim}
          height={iconDim}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#38bdf8"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: 'drop-shadow(0 0 4px #38bdf8)' }}
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          <circle cx="12" cy="16" r="1" fill="#38bdf8" />
        </svg>
      </div>
    </div>
  );
}

