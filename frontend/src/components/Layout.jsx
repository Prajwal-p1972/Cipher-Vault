import React from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useSocket } from '../realtime/SocketContext.jsx';
import { NotificationBell } from './NotificationBell.jsx';
import { Toast } from './Toast.jsx';

/**
 * Main application layout featuring a responsive 3D cyber security header,
 * real-time Zero-Trust Security Posture HUD strip, notification dropdown, and toast alerts.
 *
 * @param {{
 *   children: React.ReactNode,
 *   notifications?: Array<object>,
 *   unreadCount?: number,
 *   onMarkAllAsRead?: () => void,
 *   toasts?: Array<object>,
 *   onDismissToast?: (id: string|number) => void
 * }} props
 */
export function Layout({
  children,
  notifications,
  unreadCount,
  onMarkAllAsRead,
  toasts = [],
  onDismissToast
}) {
  const { user, logout } = useAuth();
  const { connected } = useSocket();

  const handleLogout = async () => {
    await logout();
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#030712', color: '#f8fafc' }}>
      <header
        style={{
          backgroundColor: 'rgba(10, 16, 32, 0.94)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(56, 189, 248, 0.25)',
          position: 'sticky',
          top: 0,
          zIndex: 50,
          boxShadow: '0 4px 25px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
        }}
      >
        <div
          style={{
            maxWidth: '1240px',
            margin: '0 auto',
            padding: '0.85rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <h1
              style={{
                fontSize: '1.35rem',
                fontWeight: 800,
                color: '#f8fafc',
                margin: 0,
                letterSpacing: '-0.02em',
                textShadow: '0 0 15px rgba(0, 240, 255, 0.45)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              <span style={{ color: '#00f0ff' }}>&#9670;</span> Cipher Vault
            </h1>

            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.2rem 0.65rem',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: 600,
                backgroundColor: connected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                color: connected ? '#34d399' : '#f87171',
                border: `1px solid ${connected ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`
              }}
              aria-label={`Realtime status: ${connected ? 'Connected' : 'Disconnected'}`}
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  backgroundColor: connected ? '#10b981' : '#ef4444',
                  boxShadow: `0 0 8px ${connected ? '#10b981' : '#ef4444'}`
                }}
              />
              <span>{connected ? 'Connected' : 'Disconnected'}</span>
            </div>
          </div>

          <nav aria-label="Main Navigation" style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
            <a
              href="/"
              onClick={(e) => {
                if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                  e.preventDefault();
                  window.history.pushState({}, '', '/');
                  window.dispatchEvent(new PopStateEvent('popstate'));
                }
              }}
              style={{
                fontSize: '0.9rem',
                fontWeight: 600,
                color: '#cbd5e1',
                textDecoration: 'none',
                transition: 'color 0.15s ease'
              }}
            >
              Documents
            </a>
            <a
              href="/analytics"
              onClick={(e) => {
                if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                  e.preventDefault();
                  window.history.pushState({}, '', '/analytics');
                  window.dispatchEvent(new PopStateEvent('popstate'));
                }
              }}
              style={{
                fontSize: '0.9rem',
                fontWeight: 600,
                color: '#cbd5e1',
                textDecoration: 'none',
                transition: 'color 0.15s ease'
              }}
            >
              Analytics
            </a>
            {user?.role === 'admin' && (
              <a
                href="/analytics/admin"
                onClick={(e) => {
                  if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                    e.preventDefault();
                    window.history.pushState({}, '', '/analytics/admin');
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }
                }}
                style={{
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  color: '#f43f5e',
                  textDecoration: 'none',
                  textShadow: '0 0 10px rgba(244, 63, 94, 0.4)'
                }}
              >
                Admin
              </a>
            )}
          </nav>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div
              style={{
                fontSize: '0.875rem',
                color: '#cbd5e1',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem'
              }}
            >
              <span style={{ color: '#94a3b8' }}>User:</span>
              <strong style={{ color: '#f8fafc' }}>
                {user?.displayName || user?.email || 'Anonymous'}
              </strong>
            </div>

            <NotificationBell
              notifications={notifications}
              unreadCount={unreadCount}
              onMarkAllAsRead={onMarkAllAsRead}
            />

            <button
              type="button"
              onClick={handleLogout}
              className="btn btn-secondary btn-3d-cyber"
              style={{
                padding: '0.45rem 1rem',
                fontSize: '0.85rem',
                width: 'auto'
              }}
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Live Zero-Trust Security Posture HUD Strip */}
        <div className="hud-telemetry-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, color: '#00f0ff', letterSpacing: '0.06em' }}>
            <span style={{ fontSize: '0.85rem' }}>&#9889;</span>
            <span>ZERO-TRUST HUD</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div className="hud-pill">
              <span className="hud-dot" style={{ backgroundColor: connected ? '#10b981' : '#ef4444', color: connected ? '#10b981' : '#ef4444' }} />
              <span>WebSocket: <strong style={{ color: connected ? '#34d399' : '#f87171' }}>{connected ? 'Connected' : 'Disconnected'}</strong></span>
            </div>
            <div className="hud-pill">
              <span className="hud-dot" style={{ backgroundColor: '#00f0ff', color: '#00f0ff' }} />
              <span>Browser Vault Key: <strong style={{ color: '#00f0ff' }}>Active (ECDH P-256)</strong></span>
            </div>
            <div className="hud-pill">
              <span className="hud-dot" style={{ backgroundColor: '#10b981', color: '#10b981' }} />
              <span>Storage Encryption: <strong style={{ color: '#34d399' }}>AES-256-GCM</strong></span>
            </div>
            <div className="hud-pill">
              <span className="hud-dot" style={{ backgroundColor: '#8b5cf6', color: '#8b5cf6' }} />
              <span>Local LLM: <strong style={{ color: '#c084fc' }}>Loopback (Offline)</strong></span>
            </div>
          </div>
        </div>
      </header>

      <main
        style={{
          flex: 1,
          maxWidth: '1240px',
          width: '100%',
          margin: '0 auto',
          padding: '2rem 1.5rem',
          boxSizing: 'border-box'
        }}
      >
        {children}
      </main>

      <Toast toasts={toasts} onDismiss={onDismissToast} />
    </div>
  );
}

export default Layout;
