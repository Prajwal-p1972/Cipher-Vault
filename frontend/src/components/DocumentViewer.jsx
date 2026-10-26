import React, { useState, useEffect, useRef } from 'react';
import { useLocalAi } from '../hooks/useLocalAi.js';
import { LocalAiPanel } from './LocalAiPanel.jsx';

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'application/zip'];
const AUTO_CLOSE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * In-browser secure viewer for decrypted documents.
 * - Restricts rendering to application/pdf, image/jpeg, or application/zip.
 * - PDF rendered inside a sandboxed iframe with referrerPolicy="no-referrer".
 * - JPEG rendered inside an <img> tag.
 * - ZIP provides a notice and client-side download button.
 * - Integrates LocalAiPanel for privacy-preserving local offline AI analysis.
 * - Revokes Blob object URLs immediately on close or unmount after AI session destruction.
 * - Automatically closes after 10 minutes.
 *
 * @param {{
 *   blob: Blob | null,
 *   contentType: string,
 *   originalName?: string,
 *   onClose: () => void
 * }} props
 */
export function DocumentViewer({ blob: initialBlob, contentType, originalName, onClose }) {
  const [blob, setBlob] = useState(initialBlob);
  const [objectUrl, setObjectUrl] = useState(null);
  const [error, setError] = useState(null);
  const [timeRemainingSeconds, setTimeRemainingSeconds] = useState(600);

  const urlRef = useRef(null);
  const localAi = useLocalAi();

  const handleClose = () => {
    try {
      localAi.reset();
    } catch (_) {
      // Best-effort cleanup
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setObjectUrl(null);
    setBlob(null);
    if (typeof onClose === 'function') {
      onClose();
    }
  };

  useEffect(() => {
    if (!initialBlob) {
      setError('No document data available.');
      return;
    }

    // Normalize mime type
    const normalizedType = (contentType || initialBlob.type || '').split(';')[0].trim().toLowerCase();

    if (!ALLOWED_MIME_TYPES.includes(normalizedType)) {
      setError(`Unsupported document format: ${normalizedType || 'unknown'}. Allowed formats are PDF, JPEG, and ZIP.`);
      return;
    }

    try {
      const url = URL.createObjectURL(initialBlob);
      urlRef.current = url;
      setObjectUrl(url);
      setBlob(initialBlob);
    } catch (_) {
      setError('Failed to allocate document URL in browser memory.');
      return;
    }

    // 10-minute auto-close timer
    const autoCloseTimer = setTimeout(() => {
      handleClose();
    }, AUTO_CLOSE_TIMEOUT_MS);

    // Optional 1-second interval to update remaining time indicator
    const countdownInterval = setInterval(() => {
      setTimeRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearTimeout(autoCloseTimer);
      clearInterval(countdownInterval);
      localAi.reset();
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      setObjectUrl(null);
      setBlob(null);
    };
  }, [initialBlob, contentType]);

  const normalizedType = (contentType || blob?.type || '').split(';')[0].trim().toLowerCase();
  const fileName = originalName || 'decrypted-document';

  const formatRemainingTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Decrypted Document Viewer"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 10000
      }}
    >
      {/* Header bar */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#0f172a',
          color: '#ffffff',
          padding: '0.75rem 1.5rem',
          borderBottom: '1px solid #334155'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.25rem' }}>&#128196;</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{fileName}</div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              Auto-closes in {formatRemainingTime(timeRemainingSeconds)}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleClose}
          className="btn btn-secondary"
          style={{
            backgroundColor: '#334155',
            color: '#ffffff',
            borderColor: '#475569',
            padding: '0.4rem 1rem',
            fontSize: '0.85rem',
            width: 'auto'
          }}
        >
          Close Viewer
        </button>
      </header>

      {/* Security Banner */}
      <div
        role="note"
        style={{
          backgroundColor: '#1e293b',
          color: '#94a3b8',
          fontSize: '0.8rem',
          padding: '0.5rem 1.5rem',
          textAlign: 'center',
          borderBottom: '1px solid #334155'
        }}
      >
        Decrypted in memory on the server and not stored there. Your browser holds it only while this window is open.
      </div>

      {/* Viewer Body */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          overflow: 'auto',
          padding: '1.5rem',
          backgroundColor: '#1e293b',
          gap: '1rem',
          boxSizing: 'border-box'
        }}
      >
        {error ? (
          <div
            className="alert alert-error"
            role="alert"
            style={{
              maxWidth: '500px',
              backgroundColor: '#fef2f2',
              color: '#991b1b',
              padding: '1.25rem',
              borderRadius: '8px',
              border: '1px solid #fecaca'
            }}
          >
            <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1rem' }}>Cannot View Document</h3>
            <p style={{ margin: 0, fontSize: '0.875rem' }}>{error}</p>
          </div>
        ) : !objectUrl ? (
          <div style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Loading secure view...</div>
        ) : (
          <>
            <LocalAiPanel blob={blob} ai={localAi} />
            {normalizedType === 'application/pdf' && (
              <iframe
                title="Decrypted PDF Document"
                src={objectUrl}
                referrerPolicy="no-referrer"
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  borderRadius: '6px',
                  backgroundColor: '#ffffff'
                }}
              />
            )}

            {normalizedType === 'image/jpeg' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '100%',
                  height: '100%'
                }}
              >
                <img
                  src={objectUrl}
                  alt={fileName}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    borderRadius: '6px',
                    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)'
                  }}
                />
              </div>
            )}

            {normalizedType === 'application/zip' && (
              <div
                style={{
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '12px',
                  padding: '2.5rem',
                  maxWidth: '480px',
                  textAlign: 'center',
                  color: '#f8fafc',
                  boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)'
                }}
              >
                <span style={{ fontSize: '3rem', display: 'block', marginBottom: '1rem' }}>&#128230;</span>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 0.5rem 0' }}>
                  Decrypted ZIP Archive
                </h3>
                <p style={{ fontSize: '0.875rem', color: '#94a3b8', margin: '0 0 1.5rem 0', lineHeight: 1.5 }}>
                  ZIP archives cannot be previewed directly inside the browser. You may save the decrypted archive to your device.
                </p>
                <a
                  href={objectUrl}
                  download={fileName}
                  className="btn btn-primary"
                  style={{
                    display: 'inline-block',
                    padding: '0.65rem 1.5rem',
                    fontSize: '0.9rem',
                    textDecoration: 'none',
                    fontWeight: 600
                  }}
                >
                  Download Decrypted ZIP
                </a>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default DocumentViewer;
