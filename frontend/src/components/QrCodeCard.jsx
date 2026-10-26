import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { encodePayload } from '../utils/qrPayload.js';

/**
 * Renders an offline cryptographic QR code containing the envelope decryption key.
 * Never transmits key material over the network.
 *
 * @param {{
 *   documentId: string,
 *   documentKey: string,
 *   documentName?: string
 * }} props
 */
export function QrCodeCard({ documentId, documentKey, documentName }) {
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [generationError, setGenerationError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    if (!documentId || !documentKey) {
      setQrDataUrl(null);
      return;
    }

    try {
      const payload = encodePayload({ documentId, documentKey });
      QRCode.toDataURL(payload, {
        errorCorrectionLevel: 'M',
        width: 320,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        }
      })
        .then((url) => {
          if (isMounted) {
            setQrDataUrl(url);
            setGenerationError(null);
          }
        })
        .catch((err) => {
          if (isMounted) {
            setGenerationError('Failed to generate QR code');
          }
        });
    } catch (err) {
      setGenerationError(err.message || 'Failed to encode QR payload');
    }

    return () => {
      isMounted = false;
      setQrDataUrl(null);
    };
  }, [documentId, documentKey]);

  const handleDownload = () => {
    if (!qrDataUrl) return;
    const sanitizedName = (documentName || 'cipher-vault-key')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .toLowerCase();
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `qr-${sanitizedName}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      className="qr-code-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '1.25rem',
        backgroundColor: '#f8fafc',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        marginBottom: '1.25rem',
        textAlign: 'center'
      }}
    >
      <div
        role="alert"
        style={{
          backgroundColor: '#fffbeb',
          border: '1px solid #fde68a',
          borderLeft: '4px solid #f59e0b',
          borderRadius: '6px',
          padding: '0.85rem 1rem',
          marginBottom: '1.25rem',
          textAlign: 'left',
          width: '100%',
          boxSizing: 'border-box'
        }}
      >
        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#92400e', marginBottom: '0.2rem' }}>
          Confidential Key QR
        </div>
        <p style={{ margin: 0, fontSize: '0.82rem', color: '#78350f', lineHeight: 1.45 }}>
          This QR contains the decryption key. Share it only with the receiver, over a channel you trust. It is NOT stored on the server and cannot be shown again.
        </p>
      </div>

      {generationError && (
        <div className="alert alert-error" style={{ marginBottom: '1rem', width: '100%' }}>
          {generationError}
        </div>
      )}

      {qrDataUrl ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1rem'
          }}
        >
          <div
            style={{
              padding: '0.75rem',
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)'
            }}
          >
            <img
              src={qrDataUrl}
              alt="Document decryption key QR code"
              data-testid="qr-code-image"
              width="260"
              height="260"
              style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
            />
          </div>

          <button
            type="button"
            onClick={handleDownload}
            className="btn btn-secondary"
            style={{
              fontSize: '0.85rem',
              padding: '0.45rem 1rem',
              width: 'auto'
            }}
          >
            Download PNG
          </button>
        </div>
      ) : (
        <div style={{ padding: '2rem', color: '#64748b', fontSize: '0.85rem' }}>
          Generating secure cryptographic QR...
        </div>
      )}
    </div>
  );
}

export default QrCodeCard;
