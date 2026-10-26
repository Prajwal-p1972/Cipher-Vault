import React, { useState, useEffect, useRef, useContext } from 'react';
import { SocketContext } from '../realtime/SocketContext.jsx';

/**
 * Pure helper function to append a notification and maintain a strict cap of 20 items.
 *
 * @param {Array<object>} list
 * @param {object} item
 * @returns {Array<object>}
 */
export function addNotificationToList(list, item) {
  if (!Array.isArray(list)) return [item];
  return [item, ...list].slice(0, 20);
}

/**
 * NotificationBell component with unread counter badge and dropdown of the last 20 notifications.
 * Supports both controlled usage (via props) and autonomous usage (via SocketContext).
 *
 * @param {{
 *   notifications?: Array<object>,
 *   unreadCount?: number,
 *   onMarkAllAsRead?: () => void
 * }} props
 */
export function NotificationBell({
  notifications: controlledNotifications,
  unreadCount: controlledUnreadCount,
  onMarkAllAsRead
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [internalNotifications, setInternalNotifications] = useState([]);
  const [internalUnread, setInternalUnread] = useState(0);

  const dropdownRef = useRef(null);
  const socketCtx = useContext(SocketContext);

  const isControlled = controlledNotifications !== undefined;
  const notifications = isControlled
    ? controlledNotifications.slice(0, 20)
    : internalNotifications.slice(0, 20);

  const unreadCount = controlledUnreadCount !== undefined ? controlledUnreadCount : internalUnread;

  // Listen to socket if uncontrolled
  useEffect(() => {
    if (isControlled || !socketCtx || typeof socketCtx.on !== 'function') return;

    const unsubscribe = socketCtx.on('document:sealed', (data) => {
      const item = {
        id: data.documentId || String(Date.now()),
        senderName: data.senderName || 'Sender',
        originalName: data.originalName || 'Document',
        createdAt: data.createdAt || new Date().toISOString(),
        read: false
      };
      setInternalNotifications((prev) => addNotificationToList(prev, item));
      setInternalUnread((count) => count + 1);
    });

    return () => {
      unsubscribe();
    };
  }, [isControlled, socketCtx]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleToggle = () => {
    setIsOpen((prev) => !prev);
  };

  const handleMarkAllRead = () => {
    if (typeof onMarkAllAsRead === 'function') {
      onMarkAllAsRead();
    }
    setInternalUnread(0);
    setInternalNotifications((prev) =>
      prev.map((n) => ({ ...n, read: true }))
    );
  };

  return (
    <div
      ref={dropdownRef}
      style={{ position: 'relative', display: 'inline-block' }}
      className="notification-bell-container"
    >
      <button
        type="button"
        onClick={handleToggle}
        className="btn-icon"
        aria-label="Notifications"
        aria-haspopup="true"
        aria-expanded={isOpen}
        style={{
          position: 'relative',
          background: 'transparent',
          border: '1px solid #cbd5e1',
          borderRadius: '6px',
          padding: '0.45rem 0.75rem',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.1rem',
          color: '#334155'
        }}
      >
        <span aria-hidden="true">&#128276;</span>
        {unreadCount > 0 && (
          <span
            data-testid="unread-badge"
            className="unread-badge"
            aria-label={`${unreadCount} unread notifications`}
            style={{
              position: 'absolute',
              top: '-6px',
              right: '-6px',
              backgroundColor: '#dc2626',
              color: '#ffffff',
              fontSize: '0.72rem',
              fontWeight: 700,
              borderRadius: '9999px',
              minWidth: '18px',
              height: '18px',
              padding: '0 4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1
            }}
          >
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="region"
          aria-label="Notifications list"
          className="notification-dropdown"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: '320px',
            maxWidth: '90vw',
            backgroundColor: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            zIndex: 1000,
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem 1rem',
              borderBottom: '1px solid #f1f5f9',
              backgroundColor: '#f8fafc'
            }}
          >
            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#0f172a' }}>
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#2563eb',
                  fontSize: '0.8rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  padding: 0
                }}
              >
                Mark all as read
              </button>
            )}
          </div>

          <div
            style={{
              maxHeight: '360px',
              overflowY: 'auto'
            }}
          >
            {notifications.length === 0 ? (
              <div
                style={{
                  padding: '1.5rem',
                  textAlign: 'center',
                  color: '#64748b',
                  fontSize: '0.85rem'
                }}
              >
                No notifications yet
              </div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {notifications.map((item, index) => (
                  <li
                    key={item.id || index}
                    className="notification-item"
                    style={{
                      padding: '0.75rem 1rem',
                      borderBottom: '1px solid #f1f5f9',
                      backgroundColor: item.read ? '#ffffff' : '#f0f9ff',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem'
                    }}
                  >
                    <div style={{ fontSize: '0.85rem', color: '#1e293b' }}>
                      <strong>{item.senderName}</strong> sent you{' '}
                      <strong>{item.originalName}</strong>
                    </div>
                    {item.createdAt && (
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        {new Date(item.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
