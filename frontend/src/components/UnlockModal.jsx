import React, { useState, useRef, useEffect } from 'react';
import { parsePayload } from '../utils/qrPayload.js';
import { getCurrentLocation } from '../utils/geolocation.js';
import { request, requestBlob, ApiError } from '../api/http.js';
import { unwrapDocumentKey, getKey } from '../crypto/vaultKeys.js';
import { AuthContext } from '../auth/AuthContext.jsx';
import { QrScanner } from './QrScanner.jsx';

/**
 * UnlockModal guides the receiver through context-gated document opening:
 * - Wrapped delivery: skips scan, fetches key-envelope, unwraps locally via browser vault key.
 * - QR delivery: scans and parses in-person QR code payload.
 * - Step 2: Step-up MFA verification + on-submit high-accuracy geolocation (if geofenced).
 *
 * Security requirements:
 * - documentKey lives EXCLUSIVELY in a useRef and is scrubbed immediately after request submission and on unmount.
 * - Never log or render documentKey, TOTP code, or coordinates.
 * - If local key is missing for a wrapped document, shows explicit message and offers nothing to send the key.
 *
 * @param {{
 *   document: {
 *     id?: string,
 *     _id?: string,
 *     originalName?: string,
 *     delivery?: 'wrapped' | 'qr',
 *     receiver?: string | { _id?: string, id?: string },
 *     hasGeofence?: boolean,
 *     policy?: { hasGeofence?: boolean, oneTimeUse?: boolean, expiresAt?: string },
 *     oneTimeUse?: boolean
 *   },
 *   hasVaultKey?: boolean,
 *   onSuccess: (data: { blob: Blob, contentType: string, originalName: string, status: number }) => void,
 *   onClose: () => void
 * }} props
 */
export function UnlockModal({ document: doc, hasVaultKey, onSuccess, onClose }) {
  const auth = React.useContext(AuthContext);
  const user = auth?.user || null;
  const isWrapped =
    doc?.delivery === 'wrapped' ||
    doc?.deliveryMode === 'wrapped' ||
    Boolean(doc?.keyEnvelope) ||
    Boolean(doc?.envelope);
  const targetDocId = doc?.id || doc?._id;
  const isGeofenced = Boolean(doc?.hasGeofence || doc?.policy?.hasGeofence || doc?.policy?.geofence);

  const [userHasVaultKey, setUserHasVaultKey] = useState(Boolean(hasVaultKey));

  useEffect(() => {
    if (hasVaultKey !== undefined) {
      setUserHasVaultKey(Boolean(hasVaultKey));
      return;
    }

    let isMounted = true;
    const checkLocalKey = async () => {
      const uid = user?.id || user?._id;
      if (!uid) {
        if (isMounted) setUserHasVaultKey(false);
        return;
      }
      try {
        const serverRes = await request('/api/keys/me');
        if (serverRes?.registered && serverRes?.keyId) {
          const localKey = await getKey(uid, serverRes.keyId);
          if (isMounted) {
            setUserHasVaultKey(Boolean(localKey?.privateKey));
          }
        } else {
          if (isMounted) setUserHasVaultKey(false);
        }
      } catch (_) {
        if (isMounted) setUserHasVaultKey(false);
      }
    };

    checkLocalKey();
    return () => {
      isMounted = false;
    };
  }, [hasVaultKey, user]);

  // Steps: 'loading_envelope' | 'scan' | 'verify' | 'missing_key'
  const [step, setStep] = useState(isWrapped ? 'loading_envelope' : 'scan');
  const [scanError, setScanError] = useState(null);
  const [missingKeyError, setMissingKeyError] = useState(null);
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Key is kept ONLY in a ref and never put in state, storage, or DOM
  const documentKeyRef = useRef(null);

  useEffect(() => {
    return () => {
      // Memory scrub on unmount
      documentKeyRef.current = null;
    };
  }, []);

  // For wrapped documents: automatically fetch envelope and unwrap locally on mount
  useEffect(() => {
    if (!isWrapped) {
      setStep('scan');
      return;
    }

    let isMounted = true;

    const unwrapEnvelope = async () => {
      setStep('loading_envelope');
      setMissingKeyError(null);

      try {
        const envelopeRes = await request(`/api/documents/${targetDocId}/key-envelope`);
        if (!isMounted) return;

        const envelope = envelopeRes?.envelope;
        if (!envelope) {
          throw new Error('This document was sent to a key that is not in this browser');
        }

        const receiverId =
          (typeof doc?.receiver === 'object' ? doc.receiver?._id || doc.receiver?.id : doc?.receiver) ||
          user?.id ||
          user?._id;

        const userId = user?.id || user?._id;

        const unwrappedKey = await unwrapDocumentKey({
          envelope,
          docId: targetDocId,
          receiverId,
          userId
        });

        if (!isMounted) return;

        documentKeyRef.current = unwrappedKey;
        setStep('verify');
      } catch (_) {
        if (!isMounted) return;
        documentKeyRef.current = null;
        setMissingKeyError('This document was sent to a key that is not in this browser');
        setStep('missing_key');
      }
    };

    unwrapEnvelope();

    return () => {
      isMounted = false;
      documentKeyRef.current = null;
    };
  }, [targetDocId, isWrapped, doc?.receiver, user]);

  const handleScanResult = (scannedText) => {
    setScanError(null);

    try {
      const payload = parsePayload(scannedText);

      if (payload.documentId !== targetDocId) {
        // MUST DISCARD the key immediately if document ID doesn't match
        documentKeyRef.current = null;
        setScanError('This QR belongs to a different document');
        return;
      }

      // Valid QR code for this document
      documentKeyRef.current = payload.documentKey;
      setStep('verify');
    } catch (_) {
      documentKeyRef.current = null;
      setScanError('Invalid QR code');
    }
  };

  const handleBackToScan = () => {
    documentKeyRef.current = null;
    setCode('');
    setSubmitError(null);
    setScanError(null);
    setStep('scan');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    setSubmitError(null);

    const trimmedCode = code.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      setSubmitError('Please enter a valid 6-digit authenticator code.');
      return;
    }

    if (!documentKeyRef.current) {
      if (isWrapped) {
        try {
          const envelopeRes = await request(`/api/documents/${targetDocId}/key-envelope`);
          const envelope = envelopeRes?.envelope;
          const receiverId =
            (typeof doc?.receiver === 'object' ? doc.receiver?._id || doc.receiver?.id : doc?.receiver) ||
            user?.id ||
            user?._id;
          const userId = user?.id || user?._id;
          const unwrappedKey = await unwrapDocumentKey({
            envelope,
            docId: targetDocId,
            receiverId,
            userId
          });
          documentKeyRef.current = unwrappedKey;
        } catch (_) {
          documentKeyRef.current = null;
          setSubmitError('This document was sent to a key that is not in this browser');
          setStep('missing_key');
          return;
        }
      } else {
        setSubmitError('Decryption key is missing. Please scan the QR code again.');
        setStep('scan');
        return;
      }
    }

    setSubmitting(true);

    let locationData = null;
    if (isGeofenced) {
      try {
        locationData = await getCurrentLocation();
      } catch (geoErr) {
        setSubmitting(false);
        const geoCode = geoErr?.code;
        if (geoCode === 'denied') {
          setSubmitError('Location access was denied. Please allow location access to unlock this document.');
        } else if (geoCode === 'timeout') {
          setSubmitError('Location request timed out. Please try again.');
        } else if (geoCode === 'unsupported') {
          setSubmitError('Geolocation is not supported by your browser.');
        } else {
          setSubmitError('Unable to determine location. Please ensure location services are enabled.');
        }
        return;
      }
    }

    // Build payload with only expected fields
    const requestPayload = {
      documentKey: documentKeyRef.current,
      code: trimmedCode
    };

    if (isGeofenced && locationData) {
      requestPayload.lat = locationData.lat;
      requestPayload.lng = locationData.lng;
      requestPayload.accuracyMeters = locationData.accuracyMeters;
    }

    // Scrub key immediately after copying into requestPayload
    documentKeyRef.current = null;

    try {
      const response = await requestBlob(`/api/documents/${targetDocId}/open`, {
        method: 'POST',
        body: requestPayload
      });

      // Extract Content-Type and Document Name
      const contentType = response.headers?.get?.('content-type') || response.blob?.type || 'application/octet-stream';
      let originalName = doc?.originalName || 'document';
      const rawDocNameHeader = response.headers?.get?.('x-document-name');
      if (rawDocNameHeader) {
        try {
          originalName = decodeURIComponent(rawDocNameHeader);
        } catch (_) {
          originalName = rawDocNameHeader;
        }
      }

      setSubmitting(false);

      if (typeof onSuccess === 'function') {
        onSuccess({
          blob: response.blob,
          contentType,
          originalName,
          status: response.status
        });
      }
    } catch (err) {
      setSubmitting(false);

      if (err instanceof ApiError) {
        const { status, code: errorCode } = err;

        if (status === 401) {
          setSubmitError('Invalid or expired MFA code. Please enter a fresh 6-digit code.');
        } else if (status === 423) {
          setSubmitError('Account is temporarily locked due to too many failed unlock attempts. Please try again later.');
        } else if (status === 429) {
          setSubmitError('Too many requests. Please slow down and wait a moment before trying again.');
        } else if (status === 410) {
          if (errorCode === 'consumed') {
            setSubmitError('This one-time document has already been opened and destroyed.');
          } else if (errorCode === 'destroyed') {
            setSubmitError('🚨 CRITICAL: This document has been permanently crypto-shredded and destroyed due to repeated security policy violations.');
          } else {
            setSubmitError('This document has expired and can no longer be accessed.');
          }
        } else if (status === 403) {
          if (errorCode === 'document_destroyed') {
            setSubmitError('🚨 CRITICAL: Maximum failed attempts exceeded! This document has been permanently crypto-shredded and destroyed.');
          } else if (errorCode === 'integrity') {
            setSubmitError(isWrapped ? 'Decryption key integrity check failed.' : 'Unable to open this document with this QR.');
          } else if (errorCode === 'outside_area') {
            setSubmitError('Access denied: You are outside the authorized geographic area for this document.');
          } else if (errorCode === 'location_required') {
            setSubmitError('Location verification is required to open this document.');
          } else if (errorCode === 'location_imprecise') {
            setSubmitError('Location accuracy is too low. Please move to an open area with better GPS reception.');
          } else {
            setSubmitError('Access denied: Security verification policy failed.');
          }
        } else if (status === 404) {
          setSubmitError('Document not found or you are not authorized to view it.');
        } else {
          setSubmitError(err.message || 'Failed to open document.');
        }
      } else {
        setSubmitError(err.message || 'An unexpected network error occurred.');
      }
    }
  };

  const handleModalClose = () => {
    documentKeyRef.current = null;
    if (typeof onClose === 'function') {
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unlock-modal-title"
      className="perspective-1000"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(5, 10, 20, 0.85)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1.5rem'
      }}
    >
      <div
        className="preserve-3d"
        style={{
          position: 'relative',
          backgroundColor: '#0c162c',
          color: '#f1f5f9',
          borderRadius: '14px',
          border: '1px solid rgba(56, 189, 248, 0.4)',
          boxShadow: '0 25px 60px -10px rgba(0, 0, 0, 0.85), 0 0 25px rgba(56, 189, 248, 0.25)',
          maxWidth: '520px',
          maxHeight: '90vh',
          overflowY: 'auto',
          width: '100%',
          padding: '2rem',
          boxSizing: 'border-box',
          transform: 'translateZ(20px)'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '1.75rem', lineHeight: 1 }}>&#128275;</span>
          <h2
            id="unlock-modal-title"
            style={{
              fontSize: '1.35rem',
              fontWeight: 700,
              color: '#f8fafc',
              textShadow: '0 0 12px rgba(56, 189, 248, 0.4)',
              margin: 0
            }}
          >
            {step === 'scan'
              ? 'Scan Document QR'
              : step === 'loading_envelope'
              ? 'Decrypting Key...'
              : step === 'missing_key'
              ? 'Key Unavailable'
              : 'Security Verification'}
          </h2>
        </div>

        <p style={{ fontSize: '0.875rem', color: '#94a3b8', margin: '0 0 1.25rem 0' }}>
          Document: <strong style={{ color: '#38bdf8' }}>{doc?.originalName || 'Confidential Document'}</strong>
        </p>

        {/* LOADING ENVELOPE STEP */}
        {step === 'loading_envelope' && (
          <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>&#9203;</div>
            <p style={{ margin: 0, fontSize: '0.9rem' }}>
              Unwrapping document encryption key with your browser vault key...
            </p>
          </div>
        )}

        {/* MISSING KEY STATE FOR WRAPPED DOCUMENTS */}
        {step === 'missing_key' && (
          <div data-testid="missing-key-state">
            <div
              role="alert"
              style={{
                padding: '1rem',
                backgroundColor: '#fff1f2',
                border: '1px solid #fecdd3',
                borderRadius: '8px',
                color: '#9f1239',
                fontSize: '0.9rem',
                lineHeight: 1.5,
                marginBottom: '1.5rem'
              }}
            >
              <strong>{missingKeyError || 'This document was sent to a key that is not in this browser'}</strong>
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.825rem', color: '#be123c' }}>
                This document was encrypted for a browser vault key that is not stored on this device. For security, documents cannot be unlocked from an unverified browser.
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={handleModalClose}
                className="btn btn-secondary"
                style={{ width: 'auto', padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* STEP 1: SCAN (QR mode only) */}
        {step === 'scan' && (
          <div>
            {userHasVaultKey && (
              <div
                data-testid="legacy-qr-hint"
                style={{
                  fontSize: '0.8rem',
                  color: '#64748b',
                  marginBottom: '0.75rem',
                  fontStyle: 'italic',
                  textAlign: 'center',
                  padding: '0.5rem 0.75rem',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px'
                }}
              >
                Note: This document was sealed using legacy QR mode before Vault Keys were established.
              </div>
            )}

            {scanError && (
              <div
                className="alert alert-error"
                role="alert"
                style={{
                  padding: '0.75rem 1rem',
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '6px',
                  color: '#991b1b',
                  fontSize: '0.85rem',
                  marginBottom: '1rem'
                }}
              >
                {scanError}
              </div>
            )}

            <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '8px' }}>
              <div className="hologram-scanline" />
              <QrScanner onResult={handleScanResult} onCancel={handleModalClose} />
            </div>
          </div>
        )}

        {/* STEP 2: VERIFY */}
        {step === 'verify' && (
          <form onSubmit={handleSubmit}>
            {submitError && (
              <div
                className="alert alert-error"
                role="alert"
                style={{
                  padding: '0.75rem 1rem',
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '6px',
                  color: '#991b1b',
                  fontSize: '0.85rem',
                  marginBottom: '1.25rem',
                  lineHeight: 1.45
                }}
              >
                {submitError}
              </div>
            )}

            {isGeofenced && (
              <div
                role="note"
                style={{
                  backgroundColor: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderLeft: '4px solid #3b82f6',
                  borderRadius: '6px',
                  padding: '0.85rem 1rem',
                  marginBottom: '1.25rem'
                }}
              >
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e40af', marginBottom: '0.2rem' }}>
                  Location Verification Required
                </div>
                <p style={{ margin: 0, fontSize: '0.82rem', color: '#1e3a8a', lineHeight: 1.45 }}>
                  This document is geofenced. Your browser will request your location when you click Unlock.
                </p>
              </div>
            )}

            <div style={{ marginBottom: '1.25rem' }}>
              <label
                htmlFor="totp-code-input"
                style={{
                  display: 'block',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: '#cbd5e1',
                  marginBottom: '0.4rem'
                }}
              >
                Authenticator MFA Code
              </label>
              <input
                id="totp-code-input"
                className="input-3d-well"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                disabled={submitting}
                style={{
                  width: '100%',
                  padding: '0.65rem 0.85rem',
                  fontSize: '1.25rem',
                  letterSpacing: '0.3em',
                  textAlign: 'center',
                  fontFamily: 'monospace',
                  borderRadius: '6px',
                  boxSizing: 'border-box'
                }}
              />
              <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                Use a fresh code. If you just signed in, wait for the next one.
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem' }}>
              {!isWrapped && (
                <button
                  type="button"
                  onClick={handleBackToScan}
                  disabled={submitting}
                  className="btn btn-secondary"
                  style={{ width: 'auto', padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                >
                  Scan Again
                </button>
              )}

              <div style={{ display: 'flex', gap: '0.5rem', marginLeft: isWrapped ? 'auto' : undefined }}>
                <button
                  type="button"
                  onClick={handleModalClose}
                  disabled={submitting}
                  className="btn btn-secondary"
                  style={{ width: 'auto', padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || code.length !== 6}
                  className="btn btn-primary btn-3d-primary"
                  style={{
                    width: 'auto',
                    padding: '0.5rem 1.25rem',
                    fontSize: '0.85rem',
                    opacity: submitting || code.length !== 6 ? 0.6 : 1,
                    cursor: submitting || code.length !== 6 ? 'not-allowed' : 'pointer'
                  }}
                >
                  {submitting ? 'Decrypting...' : 'Unlock Document'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default UnlockModal;
