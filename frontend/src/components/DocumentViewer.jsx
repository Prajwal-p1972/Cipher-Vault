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
  const [activeMobileTab, setActiveMobileTab] = useState('doc'); // 'doc' | 'ai'
  const [showAiDesktop, setShowAiDesktop] = useState(true);
  const [isAiExpanded, setIsAiExpanded] = useState(false);
  const [isWideScreen, setIsWideScreen] = useState(
    typeof window !== 'undefined' ? (window.innerWidth >= 1024 || window.innerWidth === 0) : true
  );

  const urlRef = useRef(null);
  const localAi = useLocalAi();

  useEffect(() => {
    const handleResize = () => {
      setIsWideScreen(window.innerWidth >= 1024 || window.innerWidth === 0);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
        backgroundColor: 'rgba(3, 7, 18, 0.92)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
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
          backgroundColor: 'rgba(10, 16, 32, 0.95)',
          color: '#ffffff',
          padding: '0.85rem 1.75rem',
          borderBottom: '1px solid rgba(56, 189, 248, 0.25)',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.6)',
          flexWrap: 'wrap',
          gap: '0.75rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: 'rgba(0, 240, 255, 0.12)', border: '1px solid rgba(0, 240, 255, 0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '1.25rem' }}>&#128196;</span>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: '#f8fafc', textShadow: '0 0 10px rgba(0, 240, 255, 0.3)' }}>{fileName}</div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '2px' }}>
              <span>Auto-closes in</span>
              <strong style={{ color: '#00f0ff', fontFamily: 'var(--font-mono)' }}>
                {formatRemainingTime(timeRemainingSeconds)}
              </strong>
            </div>
          </div>
        </div>

        {/* Center / Right Controls: Responsive Tab / Desktop Toggle & Close */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Mobile Screen Segmented Tabs */}
          {!isWideScreen && (
            <div
              role="tablist"
              aria-label="Viewer Views"
              style={{
                display: 'flex',
                background: 'rgba(15, 23, 42, 0.85)',
                padding: '3px',
                borderRadius: '8px',
                border: '1px solid rgba(56, 189, 248, 0.25)'
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeMobileTab === 'doc'}
                onClick={() => setActiveMobileTab('doc')}
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  background: activeMobileTab === 'doc' ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                  color: activeMobileTab === 'doc' ? '#38bdf8' : '#94a3b8',
                  transition: 'all 0.15s ease'
                }}
              >
                📄 Document
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeMobileTab === 'ai'}
                onClick={() => setActiveMobileTab('ai')}
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  background: activeMobileTab === 'ai' ? 'rgba(168, 85, 247, 0.25)' : 'transparent',
                  color: activeMobileTab === 'ai' ? '#c084fc' : '#94a3b8',
                  transition: 'all 0.15s ease'
                }}
              >
                🤖 AI Assistant
              </button>
            </div>
          )}

          {/* Desktop Toggle Button */}
          {isWideScreen && (
            <>
              <button
                type="button"
                onClick={() => setShowAiDesktop((prev) => !prev)}
                className="btn btn-secondary btn-3d-cyber"
                style={{
                  padding: '0.4rem 0.85rem',
                  fontSize: '0.8rem',
                  width: 'auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem'
                }}
              >
                <span>🤖</span>
                <span>{showAiDesktop ? 'Hide AI Assistant' : 'Show AI Assistant'}</span>
              </button>

              {showAiDesktop && (
                <button
                  type="button"
                  onClick={() => setIsAiExpanded((prev) => !prev)}
                  className="btn btn-secondary"
                  style={{
                    padding: '0.4rem 0.85rem',
                    fontSize: '0.8rem',
                    width: 'auto',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    backgroundColor: isAiExpanded ? 'rgba(168, 85, 247, 0.25)' : 'rgba(15, 23, 42, 0.7)',
                    color: isAiExpanded ? '#c084fc' : '#94a3b8',
                    border: isAiExpanded ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid rgba(148, 163, 184, 0.2)'
                  }}
                  title={isAiExpanded ? 'Switch to Split View' : 'Expand AI Chat Panel'}
                >
                  <span>{isAiExpanded ? '🗗 Split View' : '🗖 Expand AI'}</span>
                </button>
              )}
            </>
          )}

          <button
            type="button"
            onClick={handleClose}
            className="btn btn-secondary btn-3d-danger"
            style={{
              padding: '0.45rem 1.15rem',
              fontSize: '0.85rem',
              width: 'auto'
            }}
          >
            Close Viewer
          </button>
        </div>
      </header>

      {/* 3D Volatile RAM Security Banner */}
      <div
        role="note"
        className="ram-security-banner-3d"
      >
        <span className="volatile-ram-pulse" />
        <span style={{ fontWeight: 700, color: '#10b981', letterSpacing: '0.04em' }}>
          VOLATILE RAM ISOLATION ACTIVE:
        </span>
        <span>
          Decrypted in memory on the server and not stored there. Your browser holds it only while this window is open.
        </span>
        <span
          style={{
            marginLeft: 'auto',
            padding: '0.15rem 0.55rem',
            borderRadius: '4px',
            background: 'rgba(0, 240, 255, 0.15)',
            border: '1px solid rgba(0, 240, 255, 0.35)',
            color: '#00f0ff',
            fontSize: '0.72rem',
            fontFamily: 'var(--font-mono)',
            fontWeight: 700
          }}
        >
          SESSION ID: {blob ? `${Math.round(blob.size / 1024)}KB RAM` : 'VOLATILE'}
        </span>
      </div>

      {/* Viewer Body: Split-Pane Container with Independent Scrolling */}
      <main
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: isWideScreen ? 'row' : 'column',
          overflow: 'hidden',
          backgroundColor: '#030712',
          boxSizing: 'border-box'
        }}
      >
        {error ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2rem'
            }}
          >
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
          </div>
        ) : !objectUrl ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94a3b8',
              fontSize: '0.9rem'
            }}
          >
            Loading secure view...
          </div>
        ) : (
          <>
            {/* Left Pane: Document Viewer */}
            <div
              data-testid="document-pane"
              style={{
                flex: isWideScreen ? (showAiDesktop ? '1 1 58%' : '1 1 100%') : '1 1 auto',
                minWidth: 0,
                minHeight: 0,
                height: '100%',
                overflowY: 'auto',
                overscrollBehavior: 'contain',
                padding: '1.25rem',
                boxSizing: 'border-box',
                display: (!isWideScreen && activeMobileTab !== 'doc') ? 'none' : 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-start'
              }}
            >
              {normalizedType === 'application/pdf' && (
                <div
                  className="preserve-3d"
                  style={{
                    width: '100%',
                    height: '100%',
                    minHeight: '620px',
                    borderRadius: '12px',
                    padding: '3px',
                    background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.35) 0%, rgba(139, 92, 246, 0.35) 100%)',
                    boxShadow: '0 20px 45px -10px rgba(0, 0, 0, 0.9), 0 0 20px rgba(0, 240, 255, 0.15)'
                  }}
                >
                  <iframe
                    title="Decrypted PDF Document"
                    src={objectUrl}
                    referrerPolicy="no-referrer"
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      borderRadius: '9px',
                      backgroundColor: '#ffffff'
                    }}
                  />
                </div>
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
                    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
                    marginTop: '2rem'
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
            </div>

            {/* Right Pane: Local AI Assistant */}
            <div
              data-testid="ai-pane"
              style={{
                flex: isWideScreen ? (isAiExpanded ? '1 1 58%' : '0 0 520px') : '1 1 auto',
                maxWidth: isWideScreen ? (isAiExpanded ? '65%' : '48%') : '100%',
                minWidth: isWideScreen ? '400px' : 0,
                minHeight: 0,
                height: '100%',
                overflowY: 'auto',
                overscrollBehavior: 'contain',
                padding: '1.25rem',
                boxSizing: 'border-box',
                borderLeft: isWideScreen && showAiDesktop ? '1px solid rgba(56, 189, 248, 0.2)' : 'none',
                display: isWideScreen
                  ? (showAiDesktop ? 'block' : 'none')
                  : (activeMobileTab === 'ai' ? 'block' : 'none'),
                transition: 'flex 0.2s ease, max-width 0.2s ease'
              }}
            >
              <LocalAiPanel
                blob={blob}
                ai={localAi}
                isExpanded={isAiExpanded}
                onToggleExpand={() => setIsAiExpanded((prev) => !prev)}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default DocumentViewer;
