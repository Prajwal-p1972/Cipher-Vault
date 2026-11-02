import React, { useState, useEffect } from 'react';

/**
 * VaultDoorTransition3D
 * Cinematic 3D brushed-titanium vault blast doors opening reveal on authenticated entry.
 * Strictly non-blocking: uses pointer-events: none and bypasses execution in Vitest / headless JSDOM.
 */
export default function VaultDoorTransition3D({ onComplete }) {
  const [active, setActive] = useState(true);
  const [lockStatus, setLockStatus] = useState('LOCKED [AES-256]');

  const isTest = typeof window !== 'undefined' && (
    import.meta.env?.MODE === 'test' ||
    navigator?.userAgent?.includes('jsdom') ||
    navigator?.userAgent?.includes('Node.js')
  );

  useEffect(() => {
    if (isTest) {
      if (typeof onComplete === 'function') onComplete();
      return;
    }

    // Switch lock text quickly to ACCESS GRANTED
    const statusTimer = setTimeout(() => {
      setLockStatus('ACCESS GRANTED');
    }, 280);

    // Complete animation sequence after 1.4s
    const animTimer = setTimeout(() => {
      setActive(false);
      if (typeof onComplete === 'function') {
        onComplete();
      }
    }, 1400);

    return () => {
      clearTimeout(statusTimer);
      clearTimeout(animTimer);
    };
  }, [isTest, onComplete]);

  if (isTest || !active) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 99999,
        overflow: 'hidden',
        perspective: '1400px',
      }}
    >
      {/* Left Titanium Blast Door */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '50.5vw',
          height: '100vh',
          background: 'radial-gradient(ellipse at 80% 50%, #1e293b 0%, #0f172a 60%, #030712 100%)',
          borderRight: '3px solid rgba(0, 240, 255, 0.65)',
          boxShadow: '10px 0 50px rgba(0, 0, 0, 0.95), inset -2px 0 10px rgba(255, 255, 255, 0.2)',
          animation: 'vaultDoorSlideLeft 1.4s cubic-bezier(0.7, 0, 0.3, 1) forwards',
          transformOrigin: 'left center',
        }}
      >
        {/* Decorative Heavy Chrome Rivets */}
        <div style={{ position: 'absolute', right: '35px', top: '15%', display: 'flex', flexDirection: 'column', gap: '30px' }}>
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, #94a3b8 0%, #334155 100%)',
                boxShadow: '0 2px 5px rgba(0,0,0,0.8), inset 0 1px 1px #ffffff',
              }}
            />
          ))}
        </div>
      </div>

      {/* Right Titanium Blast Door */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: '50.5vw',
          height: '100vh',
          background: 'radial-gradient(ellipse at 20% 50%, #1e293b 0%, #0f172a 60%, #030712 100%)',
          borderLeft: '3px solid rgba(0, 240, 255, 0.65)',
          boxShadow: '-10px 0 50px rgba(0, 0, 0, 0.95), inset 2px 0 10px rgba(255, 255, 255, 0.2)',
          animation: 'vaultDoorSlideRight 1.4s cubic-bezier(0.7, 0, 0.3, 1) forwards',
          transformOrigin: 'right center',
        }}
      >
        {/* Decorative Heavy Chrome Rivets */}
        <div style={{ position: 'absolute', left: '35px', top: '15%', display: 'flex', flexDirection: 'column', gap: '30px' }}>
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, #94a3b8 0%, #334155 100%)',
                boxShadow: '0 2px 5px rgba(0,0,0,0.8), inset 0 1px 1px #ffffff',
              }}
            />
          ))}
        </div>
      </div>

      {/* Central Interlocking 3D Combination Wheel & Status */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          animation: 'vaultWheelSpin 1.4s cubic-bezier(0.7, 0, 0.3, 1) forwards',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '210px',
            height: '210px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, #334155 0%, #0f172a 75%, #020617 100%)',
            border: '5px solid #64748b',
            boxShadow: '0 0 50px rgba(0, 240, 255, 0.5), inset 0 0 30px rgba(0, 0, 0, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Wheel spokes */}
          <div style={{ position: 'absolute', width: '100%', height: '8px', background: '#94a3b8', borderRadius: '4px' }} />
          <div style={{ position: 'absolute', width: '8px', height: '100%', background: '#94a3b8', borderRadius: '4px' }} />
          <div style={{ position: 'absolute', width: '100%', height: '8px', background: '#94a3b8', borderRadius: '4px', transform: 'rotate(45deg)' }} />
          <div style={{ position: 'absolute', width: '8px', height: '100%', background: '#94a3b8', borderRadius: '4px', transform: 'rotate(45deg)' }} />

          {/* Central Wheel Hub */}
          <div
            style={{
              position: 'relative',
              width: '110px',
              height: '110px',
              borderRadius: '50%',
              background: lockStatus === 'ACCESS GRANTED'
                ? 'radial-gradient(circle, #059669 0%, #064e3b 100%)'
                : 'radial-gradient(circle, #0284c7 0%, #082f49 100%)',
              border: `3px solid ${lockStatus === 'ACCESS GRANTED' ? '#10b981' : '#00f0ff'}`,
              boxShadow: `0 0 25px ${lockStatus === 'ACCESS GRANTED' ? '#10b981' : '#00f0ff'}`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 5,
              transition: 'all 0.3s ease',
            }}
          >
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {lockStatus === 'ACCESS GRANTED' ? (
                <polyline points="20 6 9 17 4 12" />
              ) : (
                <>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </>
              )}
            </svg>
          </div>
        </div>

        {/* Lock Telemetry Badge below wheel */}
        <div
          style={{
            marginTop: '1.25rem',
            padding: '0.4rem 1.25rem',
            background: 'rgba(6, 11, 22, 0.95)',
            border: `1.5px solid ${lockStatus === 'ACCESS GRANTED' ? '#10b981' : '#00f0ff'}`,
            borderRadius: '9999px',
            fontSize: '0.85rem',
            fontWeight: 800,
            letterSpacing: '0.12em',
            color: lockStatus === 'ACCESS GRANTED' ? '#10b981' : '#00f0ff',
            fontFamily: 'var(--font-mono)',
            boxShadow: `0 0 16px ${lockStatus === 'ACCESS GRANTED' ? 'rgba(16, 185, 129, 0.5)' : 'rgba(0, 240, 255, 0.5)'}`,
            whiteSpace: 'nowrap',
          }}
        >
          {lockStatus}
        </div>
      </div>
    </div>
  );
}

