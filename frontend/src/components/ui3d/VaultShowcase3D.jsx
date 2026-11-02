import React, { useState, useEffect, useRef } from 'react';

/**
 * VaultShowcase3D
 * High-impact interactive 3D mechanical vault door & architecture showcase
 * designed for executive demonstrations and final-year evaluation presentation.
 * Headless/JSDOM safe with automated context & test guards.
 */
export default function VaultShowcase3D() {
  const containerRef = useRef(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, px: 50, py: 50 });

  const isTest = typeof window !== 'undefined' && (
    import.meta.env?.MODE === 'test' ||
    navigator?.userAgent?.includes('jsdom') ||
    navigator?.userAgent?.includes('Node.js')
  );

  const handleMouseMove = (e) => {
    if (isTest || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({
      rx: -ny * 10,
      ry: nx * 10,
      px: ((e.clientX - rect.left) / rect.width) * 100,
      py: ((e.clientY - rect.top) / rect.height) * 100,
    });
  };

  const handleMouseLeave = () => {
    setTilt({ rx: 0, ry: 0, px: 50, py: 50 });
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="vault-showcase-container preserve-3d"
      style={{
        transform: `perspective(1000px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
        transition: 'transform 0.15s ease-out',
      }}
    >
      {/* Mechanical Vault Door 3D Presentation Graphic */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '240px',
          background: 'linear-gradient(145deg, rgba(15, 23, 42, 0.95) 0%, rgba(6, 11, 22, 0.98) 100%)',
          borderRadius: '16px',
          border: '1px solid rgba(0, 240, 255, 0.3)',
          boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.8), 0 0 25px rgba(0, 240, 255, 0.15), inset 0 1px 1px rgba(255, 255, 255, 0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {/* Corner Targeting Brackets */}
        <div style={{ position: 'absolute', top: 8, left: 8, width: 14, height: 14, borderTop: '2px solid #00f0ff', borderLeft: '2px solid #00f0ff', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: 8, right: 8, width: 14, height: 14, borderTop: '2px solid #00f0ff', borderRight: '2px solid #00f0ff', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: 8, left: 8, width: 14, height: 14, borderBottom: '2px solid #00f0ff', borderLeft: '2px solid #00f0ff', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: 8, right: 8, width: 14, height: 14, borderBottom: '2px solid #00f0ff', borderRight: '2px solid #00f0ff', pointerEvents: 'none' }} />

        {/* Ambient Radial Glare */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: `radial-gradient(circle at ${tilt.px}% ${tilt.py}%, rgba(0, 240, 255, 0.18) 0%, transparent 65%)`,
            pointerEvents: 'none',
          }}
        />

        {/* 3D Interlocking Gear Rings & Heavy Chrome Vault Door Centerpiece */}
        <div
          style={{
            position: 'relative',
            width: '180px',
            height: '180px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, #1e293b 0%, #0b1329 70%, #030712 100%)',
            border: '4px solid #334155',
            boxShadow: '0 0 30px rgba(0, 0, 0, 0.9), inset 0 0 25px rgba(0, 240, 255, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Outer Rotating Gear Ring */}
          <div
            style={{
              position: 'absolute',
              width: '160px',
              height: '160px',
              borderRadius: '50%',
              border: '2px dashed rgba(0, 240, 255, 0.65)',
              animation: 'spin3dRing 14s linear infinite',
            }}
          />

          {/* Counter-Rotating Middle Gear Ring */}
          <div
            style={{
              position: 'absolute',
              width: '130px',
              height: '130px',
              borderRadius: '50%',
              border: '2px solid rgba(139, 92, 246, 0.6)',
              borderTopColor: 'transparent',
              borderBottomColor: 'transparent',
              animation: 'spin3dRingRev 9s linear infinite',
            }}
          />

          {/* Horizontal Chrome Locking Bolts */}
          <div
            style={{
              position: 'absolute',
              width: '190px',
              height: '10px',
              background: 'linear-gradient(90deg, #38bdf8 0%, #94a3b8 50%, #38bdf8 100%)',
              borderRadius: '5px',
              boxShadow: '0 0 10px rgba(56, 189, 248, 0.5)',
              opacity: 0.85,
            }}
          />
          <div
            style={{
              position: 'absolute',
              width: '10px',
              height: '190px',
              background: 'linear-gradient(180deg, #38bdf8 0%, #94a3b8 50%, #38bdf8 100%)',
              borderRadius: '5px',
              boxShadow: '0 0 10px rgba(56, 189, 248, 0.5)',
              opacity: 0.85,
            }}
          />

          {/* Central Cryptographic AES-256-GCM Core */}
          <div
            style={{
              position: 'relative',
              width: '84px',
              height: '84px',
              borderRadius: '50%',
              background: 'radial-gradient(circle, #0284c7 0%, #082f49 100%)',
              border: '2px solid #00f0ff',
              boxShadow: '0 0 20px #00f0ff, inset 0 0 12px #00f0ff',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 3,
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f8fafc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span style={{ fontSize: '0.62rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '0.08em', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
              AES-256
            </span>
          </div>
        </div>

        {/* Security Status Badge in Vault View */}
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            right: 14,
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.2rem 0.6rem',
            background: 'rgba(6, 11, 22, 0.9)',
            border: '1px solid rgba(16, 185, 129, 0.5)',
            borderRadius: '9999px',
            fontSize: '0.7rem',
            fontWeight: 700,
            color: '#10b981',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
          IMMUTABLE VAULT
        </div>
      </div>

      {/* 4 Pillars of Architecture Showcase Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {/* Pillar 1 */}
        <div className="pillar-pill-3d">
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(0, 240, 255, 0.12)', border: '1px solid rgba(0, 240, 255, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00f0ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#f8fafc' }}>
              AES-256-GCM + ECDH P-256 Envelopes
            </div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              True zero-cloud encryption: keys exist only in recipient browser volatile memory.
            </div>
          </div>
        </div>

        {/* Pillar 2 */}
        <div className="pillar-pill-3d">
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#f8fafc' }}>
              Haversine Geofencing &amp; Step-Up TOTP
            </div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              Mathematical GPS radius enforcement verified on-submit with 30s grace TOTP.
            </div>
          </div>
        </div>

        {/* Pillar 3 */}
        <div className="pillar-pill-3d">
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(139, 92, 246, 0.12)', border: '1px solid rgba(139, 92, 246, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#f8fafc' }}>
              Tamper-Evident SHA-256 HMAC Audit Chain
            </div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              Cryptographically verifiable ledger: any single log alteration invalidates chain hash.
            </div>
          </div>
        </div>

        {/* Pillar 4 */}
        <div className="pillar-pill-3d">
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#f8fafc' }}>
              100% Offline Local Llama 3 Intelligence
            </div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              Zero cloud leakage: document analysis &amp; RAG inference runs strictly on loopback.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

