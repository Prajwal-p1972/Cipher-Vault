import React from 'react';

/**
 * Formats byte counts into clean human-readable binary representations.
 *
 * @param {number|string} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  const num = Number(bytes);
  if (Number.isNaN(num) || num <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(num) / Math.log(k));
  const clampedIndex = Math.min(i, sizes.length - 1);
  const val = (num / Math.pow(k, clampedIndex)).toFixed(clampedIndex === 0 ? 0 : 1);
  return `${val} ${sizes[clampedIndex]}`;
}

/**
 * Safely formats date strings or timestamps.
 *
 * @param {string|Date|null} val
 * @returns {string}
 */
export function formatDate(val) {
  if (!val) return 'Never';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return 'Never';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Returns accessible visual styling for document statuses.
 *
 * @param {string} status
 * @returns {{ label: string, bg: string, color: string, border: string }}
 */
function getStatusBadgeStyle(status) {
  const s = String(status || '').toLowerCase();
  switch (s) {
    case 'sealed':
      return { label: 'Sealed', className: 'badge-3d-sealed' };
    case 'consumed':
      return { label: 'Consumed', className: 'badge-3d-consumed' };
    case 'expired':
      return { label: 'Expired', className: 'badge-3d-expired' };
    case 'revoked':
      return { label: 'Revoked', className: 'badge-3d-expired' };
    case 'destroyed':
      return { label: 'Destroyed', className: 'badge-3d-danger' };
    default:
      return { label: s || 'Unknown', className: 'badge-3d-sealed' };
  }
}

/**
 * Tabular view of cryptographic document records.
 * Ensures zero HTML injection by rendering all cell values via React primitives.
 *
 * @param {{
 *   documents: Array<object>,
 *   type?: 'received' | 'sent',
 *   emptyMessage?: string
 * }} props
 */
export function DocumentTable({
  documents = [],
  type = 'received',
  emptyMessage = 'No documents found.',
  onOpen
}) {
  if (!documents || documents.length === 0) {
    return (
      <div
        className="empty-state"
        style={{
          padding: '3rem 1.5rem',
          textAlign: 'center',
          backgroundColor: 'rgba(15, 23, 42, 0.6)',
          borderRadius: '10px',
          border: '1px dashed rgba(56, 189, 248, 0.3)',
          color: '#94a3b8'
        }}
      >
        <span style={{ fontSize: '2rem', display: 'block', marginBottom: '0.5rem' }}>&#128194;</span>
        <p style={{ margin: 0, fontSize: '0.95rem', fontWeight: 500, color: '#cbd5e1' }}>{emptyMessage}</p>
      </div>
    );
  }

  const isReceived = type === 'received';

  return (
    <div style={{ overflowX: 'auto', border: '1px solid rgba(56, 189, 248, 0.25)', borderRadius: '10px', background: 'rgba(15, 23, 42, 0.85)', boxShadow: '0 10px 30px -5px rgba(0, 0, 0, 0.8)' }}>
      <table
        className="doc-table"
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          textAlign: 'left',
          fontSize: '0.875rem'
        }}
      >
        <thead>
          <tr style={{ backgroundColor: 'rgba(10, 16, 32, 0.95)', borderBottom: '1px solid rgba(56, 189, 248, 0.25)' }}>
            <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#94a3b8', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Name</th>
            <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#94a3b8', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {isReceived ? 'Sender' : 'Recipient'}
            </th>
            <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#94a3b8', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Size</th>
            <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#94a3b8', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Created</th>
            <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#94a3b8', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Expires</th>
            <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#94a3b8', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
            <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#94a3b8', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Flags</th>
            {isReceived && (
              <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#94a3b8', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Action</th>
            )}
          </tr>
        </thead>
        <tbody>
          {documents.map((doc, index) => {
            const statusStyle = getStatusBadgeStyle(doc.status);
            const isOneTime = Boolean(doc.oneTimeUse || doc.policy?.oneTimeUse);
            const isGeofenced = Boolean(doc.hasGeofence || doc.policy?.hasGeofence || doc.policy?.geofence);
            const counterpart = isReceived
              ? (doc.senderName || doc.sender || 'Unknown')
              : (doc.receiverEmail || doc.receiver || 'Unknown');

            const expiresAtVal = doc.policy?.expiresAt || doc.expiresAt;
            const isExpired = Boolean(
              doc.status === 'expired' ||
              (expiresAtVal && new Date(expiresAtVal).getTime() <= Date.now())
            );
            const isSealed = String(doc.status || '').toLowerCase() === 'sealed';
            const canOpen = isSealed && !isExpired;

            let disabledReason = 'Unavailable';
            if (isExpired) {
              disabledReason = 'Expired';
            } else if (doc.status === 'consumed') {
              disabledReason = 'Already opened';
            } else if (doc.status === 'revoked') {
              disabledReason = 'Revoked';
            } else if (doc.status === 'destroyed') {
              disabledReason = 'Crypto-shredded';
            }

            return (
              <tr
                key={doc.id}
                data-testid={`doc-row-${doc.id}`}
                style={{
                  borderBottom: '1px solid rgba(30, 41, 59, 0.6)',
                  backgroundColor: index % 2 === 0 ? 'rgba(15, 23, 42, 0.4)' : 'transparent'
                }}
              >
                <td style={{ padding: '0.85rem 1rem', fontWeight: 600, color: '#f8fafc' }}>
                  <div style={{ wordBreak: 'break-word', maxWidth: '240px' }}>
                    {doc.originalName}
                  </div>
                </td>

                <td style={{ padding: '0.85rem 1rem', color: '#cbd5e1' }}>
                  <span style={{ wordBreak: 'break-all' }}>{counterpart}</span>
                </td>

                <td style={{ padding: '0.85rem 1rem', color: '#94a3b8', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
                  {formatBytes(doc.sizeBytes)}
                </td>

                <td style={{ padding: '0.85rem 1rem', color: '#94a3b8', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
                  {formatDate(doc.createdAt)}
                </td>

                <td style={{ padding: '0.85rem 1rem', color: '#94a3b8', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
                  {formatDate(expiresAtVal)}
                </td>

                <td style={{ padding: '0.85rem 1rem', whiteSpace: 'nowrap' }}>
                  <span className={statusStyle.className}>
                    {statusStyle.label}
                  </span>
                </td>

                <td style={{ padding: '0.85rem 1rem', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span
                      data-testid="delivery-badge"
                      style={{
                        display: 'inline-block',
                        padding: '0.15rem 0.45rem',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        backgroundColor: doc.delivery === 'wrapped' ? 'rgba(0, 240, 255, 0.12)' : 'rgba(139, 92, 246, 0.12)',
                        color: doc.delivery === 'wrapped' ? '#00f0ff' : '#c084fc',
                        border: `1px solid ${doc.delivery === 'wrapped' ? 'rgba(0, 240, 255, 0.35)' : 'rgba(139, 92, 246, 0.35)'}`
                      }}
                    >
                      {doc.delivery === 'wrapped' ? 'Secure delivery' : 'QR handover'}
                    </span>
                    {isOneTime && (
                      <span
                        title="Self-destructs after one decryption"
                        style={{
                          display: 'inline-block',
                          padding: '0.15rem 0.45rem',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          backgroundColor: 'rgba(245, 158, 11, 0.12)',
                          color: '#f59e0b',
                          border: '1px solid rgba(245, 158, 11, 0.35)'
                        }}
                      >
                        1-Time
                      </span>
                    )}
                    {isGeofenced && (
                      <span
                        title="Decryption restricted to authorized physical location"
                        style={{
                          display: 'inline-block',
                          padding: '0.15rem 0.45rem',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          backgroundColor: 'rgba(16, 185, 129, 0.12)',
                          color: '#34d399',
                          border: '1px solid rgba(16, 185, 129, 0.35)'
                        }}
                      >
                        Geofenced
                      </span>
                    )}
                    {Boolean(doc.failedAttempts && doc.failedAttempts > 0) && (
                      <span
                        title={doc.destructionReason ? `Destruction Reason: ${doc.destructionReason}` : `${doc.failedAttempts}/${doc.maxFailedAttempts || 3} failed unlock attempts`}
                        style={{
                          display: 'inline-block',
                          padding: '0.15rem 0.45rem',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          backgroundColor: doc.status === 'destroyed' ? 'rgba(244, 63, 94, 0.2)' : 'rgba(245, 158, 11, 0.15)',
                          color: doc.status === 'destroyed' ? '#f43f5e' : '#fbbf24',
                          border: `1px solid ${doc.status === 'destroyed' ? 'rgba(244, 63, 94, 0.5)' : 'rgba(245, 158, 11, 0.4)'}`
                        }}
                      >
                        {doc.status === 'destroyed' ? '⚡ Shredded' : `⚠ ${doc.failedAttempts}/${doc.maxFailedAttempts || 3} Failed`}
                      </span>
                    )}
                  </div>
                </td>

                {isReceived && (
                  <td style={{ padding: '0.85rem 1rem', whiteSpace: 'nowrap' }}>
                    {canOpen ? (
                      <button
                        type="button"
                        onClick={() => typeof onOpen === 'function' && onOpen(doc)}
                        className="btn btn-primary btn-3d-cyber"
                        style={{
                          padding: '0.4rem 0.95rem',
                          fontSize: '0.8rem',
                          width: 'auto',
                          cursor: 'pointer'
                        }}
                      >
                        Open
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled
                        aria-disabled="true"
                        title={disabledReason}
                        className="btn btn-secondary"
                        style={{
                          padding: '0.4rem 0.95rem',
                          fontSize: '0.8rem',
                          width: 'auto',
                          opacity: 0.5,
                          cursor: 'not-allowed',
                          backgroundColor: 'rgba(30, 41, 59, 0.6)',
                          color: '#64748b',
                          borderColor: 'rgba(255, 255, 255, 0.08)'
                        }}
                      >
                        {disabledReason}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default DocumentTable;

