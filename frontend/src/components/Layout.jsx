import React from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useSocket } from '../realtime/SocketContext.jsx';
import { NotificationBell } from './NotificationBell.jsx';
import { Toast } from './Toast.jsx';

/**
 * Main application layout featuring a responsive security header,
 * real-time connection status indicator, notification dropdown, and toast alerts.
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
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          position: 'sticky',
          top: 0,
          zIndex: 50,
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)'
        }}
      >
        <div
          style={{
            maxWidth: '1200px',
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
                fontSize: '1.25rem',
                fontWeight: 700,
                color: '#0f172a',
                margin: 0,
                letterSpacing: '-0.02em'
              }}
            >
              Cipher Vault
            </h1>

            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.2rem 0.6rem',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: 600,
                backgroundColor: connected ? '#ecfdf5' : '#fef2f2',
                color: connected ? '#065f46' : '#991b1b',
                border: `1px solid ${connected ? '#a7f3d0' : '#fecaca'}`
              }}
              aria-label={`Realtime status: ${connected ? 'Connected' : 'Disconnected'}`}
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  backgroundColor: connected ? '#10b981' : '#ef4444'
                }}
              />
              <span>{connected ? 'Connected' : 'Disconnected'}</span>
            </div>
          </div>

          <nav aria-label="Main Navigation" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
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
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#475569',
                textDecoration: 'none'
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
                fontSize: '0.875rem',
                fontWeight: 600,
                color: '#475569',
                textDecoration: 'none'
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
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: '#991b1b',
                  textDecoration: 'none'
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
                color: '#475569',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem'
              }}
            >
              <span style={{ color: '#94a3b8' }}>User:</span>
              <strong style={{ color: '#1e293b' }}>
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
                padding: '0.45rem 0.9rem',
                fontSize: '0.85rem',
                width: 'auto'
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main
        style={{
          flex: 1,
          maxWidth: '1200px',
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
