import React from 'react';

/**
 * Renders accessible toast alert notifications announced via aria-live="polite".
 *
 * @param {{
 *   toasts: Array<{ id: string|number, message: string }>,
 *   onDismiss?: (id: string|number) => void
 * }} props
 */
export function Toast({ toasts = [], onDismiss }) {
  return (
    <div
      className="toast-container"
      aria-live="polite"
      aria-atomic="true"
      role="status"
      style={{
        position: 'fixed',
        bottom: '1.5rem',
        right: '1.5rem',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        maxWidth: '400px',
        width: 'calc(100% - 3rem)',
        pointerEvents: 'none'
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast-item"
          role="alert"
          style={{
            pointerEvents: 'auto',
            background: '#ffffff',
            border: '1px solid #cbd5e1',
            borderLeft: '4px solid #2563eb',
            borderRadius: '6px',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.12)',
            padding: '0.85rem 1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            color: '#0f172a'
          }}
        >
          <div style={{ fontSize: '0.9rem', fontWeight: 500, wordBreak: 'break-word' }}>
            {toast.message}
          </div>
          {onDismiss && (
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="toast-close-btn"
              aria-label="Dismiss notification"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '1.25rem',
                lineHeight: 1,
                padding: '0.2rem',
                color: '#64748b'
              }}
            >
              &times;
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export default Toast;
