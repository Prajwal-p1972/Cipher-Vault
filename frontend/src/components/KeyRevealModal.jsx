import React, { useState, useEffect } from 'react';
import { QrCodeCard } from './QrCodeCard.jsx';

/**
 * KeyRevealModal displays the one-time encryption envelope key after a document is sealed.
 * Also renders an offline cryptographic QR code via QrCodeCard.
 * The key exists exclusively in component state and is completely wiped upon close/unmount.
 *
 * @param {{
 *   documentKey: string|null,
 *   document?: { id?: string, _id?: string, originalName?: string },
 *   documentId?: string,
 *   documentName?: string,
 *   onClose: () => void
 * }} props
 */
export function KeyRevealModal({ documentKey: initialKey, document, documentId, documentName, onClose }) {
  const [key, setKey] = useState(initialKey);
  const [copied, setCopied] = useState(false);
  const [confirmedSaved, setConfirmedSaved] = useState(false);

  const effectiveDocId = documentId || document?.id || document?._id;
  const effectiveDocName = documentName || document?.originalName;

  useEffect(() => {
    setKey(initialKey);
    setCopied(false);
    setConfirmedSaved(false);

    return () => {
      // Memory scrub on unmount
      setKey(null);
    };
  }, [initialKey]);

  if (!key) {
    return null;
  }

  const handleCopy = async () => {
    if (!key) return;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(key);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch (_) {
      // Clipboard write failed or disallowed
    }
  };

  const handleClose = () => {
    if (!confirmedSaved) return;
    setKey(null);
    if (typeof onClose === 'function') {
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1.5rem'
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1)',
          maxWidth: '560px',
          maxHeight: '90vh',
          overflowY: 'auto',
          width: '100%',
          padding: '2rem',
          boxSizing: 'border-box'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <span style={{ fontSize: '1.75rem', lineHeight: 1 }}>&#128273;</span>
          <h2
            id="modal-title"
            style={{
              fontSize: '1.35rem',
              fontWeight: 700,
              color: '#0f172a',
              margin: 0
            }}
          >
            Document Sealed Successfully
          </h2>
        </div>

        {effectiveDocName && (
          <p style={{ fontSize: '0.9rem', color: '#475569', marginBottom: '1.25rem' }}>
            File: <strong>{effectiveDocName}</strong>
          </p>
        )}

        {effectiveDocId && key && (
          <QrCodeCard
            documentId={effectiveDocId}
            documentKey={key}
            documentName={effectiveDocName}
          />
        )}

        <div
          role="alert"
          style={{
            backgroundColor: '#fffbeb',
            border: '1px solid #fde68a',
            borderLeft: '4px solid #f59e0b',
            borderRadius: '6px',
            padding: '1rem',
            marginBottom: '1.25rem'
          }}
        >
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#92400e', marginBottom: '0.25rem' }}>
            Critical Security Warning
          </div>
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#78350f', lineHeight: 1.5 }}>
            Shown only once. It is not stored on the server. You will need it to create the QR code in the next phase.
          </p>
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
            Secret Document Key
          </label>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              backgroundColor: '#f1f5f9',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              padding: '0.6rem 0.85rem'
            }}
          >
            <code
              data-testid="document-key-value"
              style={{
                flex: 1,
                fontSize: '0.85rem',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                wordBreak: 'break-all',
                color: '#0f172a'
              }}
            >
              {key}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="btn btn-secondary"
              style={{
                width: 'auto',
                padding: '0.4rem 0.75rem',
                fontSize: '0.8rem',
                whiteSpace: 'nowrap'
              }}
            >
              {copied ? 'Copied!' : 'Copy Key'}
            </button>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            marginBottom: '1.5rem',
            padding: '0.75rem',
            backgroundColor: '#f8fafc',
            borderRadius: '6px',
            border: '1px solid #e2e8f0'
          }}
        >
          <input
            id="confirm-saved-checkbox"
            type="checkbox"
            checked={confirmedSaved}
            onChange={(e) => setConfirmedSaved(e.target.checked)}
            style={{ width: '1.15rem', height: '1.15rem', cursor: 'pointer' }}
          />
          <label
            htmlFor="confirm-saved-checkbox"
            style={{
              fontSize: '0.875rem',
              fontWeight: 500,
              color: '#1e293b',
              cursor: 'pointer',
              userSelect: 'none'
            }}
          >
            I saved it
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={handleClose}
            disabled={!confirmedSaved}
            className="btn btn-primary"
            style={{
              width: 'auto',
              padding: '0.6rem 1.25rem',
              fontSize: '0.9rem',
              opacity: confirmedSaved ? 1 : 0.5,
              cursor: confirmedSaved ? 'pointer' : 'not-allowed'
            }}
          >
            Close &amp; Clear Key
          </button>
        </div>
      </div>
    </div>
  );
}

export default KeyRevealModal;
