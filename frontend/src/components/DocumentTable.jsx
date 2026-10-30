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
      return { label: 'Sealed', bg: '#ecfdf5', color: '#065f46', border: '#a7f3d0' };
    case 'consumed':
      return { label: 'Consumed', bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' };
    case 'expired':
      return { label: 'Expired', bg: '#fffbeb', color: '#92400e', border: '#fde68a' };
    case 'revoked':
      return { label: 'Revoked', bg: '#fef2f2', color: '#991b1b', border: '#fecaca' };
    default:
      return { label: s || 'Unknown', bg: '#f8fafc', color: '#334155', border: '#e2e8f0' };
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
          backgroundColor: '#f8fafc',
          borderRadius: '8px',
          border: '1px dashed #cbd5e1',
          color: '#64748b'
        }}
      >
        <span style={{ fontSize: '2rem', display: 'block', marginBottom: '0.5rem' }}>&#128194;</span>
        <p style={{ margin: 0, fontSize: '0.95rem', fontWeight: 500 }}>{emptyMessage}</p>
      </div>
    );
  }

  const isReceived = type === 'received';

  return (
    <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
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
          <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
            <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#334155' }}>Name</th>
            <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#334155' }}>
              {isReceived ? 'Sender' : 'Recipient'}
            </th>
            <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#334155' }}>Size</th>
            <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#334155' }}>Created</th>
            <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#334155' }}>Expires</th>
            <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#334155' }}>Status</th>
            <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#334155' }}>Flags</th>
            {isReceived && (
              <th style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#334155' }}>Action</th>
            )}
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => {
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
            }

            return (
              <tr
                key={doc.id}
                data-testid={`doc-row-${doc.id}`}
                style={{
                  borderBottom: '1px solid #f1f5f9',
                  backgroundColor: '#ffffff'
                }}
              >
                <td style={{ padding: '0.75rem 1rem', fontWeight: 500, color: '#0f172a' }}>
                  <div style={{ wordBreak: 'break-word', maxWidth: '240px' }}>
                    {doc.originalName}
                  </div>
                </td>

                <td style={{ padding: '0.75rem 1rem', color: '#475569' }}>
                  <span style={{ wordBreak: 'break-all' }}>{counterpart}</span>
                </td>

                <td style={{ padding: '0.75rem 1rem', color: '#475569', whiteSpace: 'nowrap' }}>
                  {formatBytes(doc.sizeBytes)}
                </td>

                <td style={{ padding: '0.75rem 1rem', color: '#475569', whiteSpace: 'nowrap' }}>
                  {formatDate(doc.createdAt)}
                </td>

                <td style={{ padding: '0.75rem 1rem', color: '#475569', whiteSpace: 'nowrap' }}>
                  {formatDate(expiresAtVal)}
                </td>

                <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '0.2rem 0.55rem',
                      borderRadius: '9999px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      backgroundColor: statusStyle.bg,
                      color: statusStyle.color,
                      border: `1px solid ${statusStyle.border}`
                    }}
                  >
                    {statusStyle.label}
                  </span>
                </td>

                <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span
                      data-testid="delivery-badge"
                      style={{
                        display: 'inline-block',
                        padding: '0.15rem 0.45rem',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        backgroundColor: doc.delivery === 'wrapped' ? '#eff6ff' : '#f5f3ff',
                        color: doc.delivery === 'wrapped' ? '#1d4ed8' : '#6d28d9',
                        border: `1px solid ${doc.delivery === 'wrapped' ? '#bfdbfe' : '#ddd6fe'}`
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
                          backgroundColor: '#fef3c7',
                          color: '#92400e',
                          border: '1px solid #fde68a'
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
                          backgroundColor: '#e0e7ff',
                          color: '#3730a3',
                          border: '1px solid #c7d2fe'
                        }}
                      >
                        Geofenced
                      </span>
                    )}
                  </div>
                </td>

                {isReceived && (
                  <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                    {canOpen ? (
                      <button
                        type="button"
                        onClick={() => typeof onOpen === 'function' && onOpen(doc)}
                        className="btn btn-primary"
                        style={{
                          padding: '0.35rem 0.75rem',
                          fontSize: '0.78rem',
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
                          padding: '0.35rem 0.75rem',
                          fontSize: '0.78rem',
                          width: 'auto',
                          opacity: 0.6,
                          cursor: 'not-allowed',
                          backgroundColor: '#f1f5f9',
                          color: '#64748b',
                          borderColor: '#cbd5e1'
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

