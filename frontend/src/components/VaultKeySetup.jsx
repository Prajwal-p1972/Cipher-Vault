import React, { useState } from 'react';
import { useVaultKey } from '../hooks/useVaultKey.js';

/**
 * Component for generating and registering a browser-bound ECDH vault key.
 * Explains device-bound security, accepts 6-digit TOTP step-up, displays key fingerprint,
 * and handles key mismatch states with explicit warnings.
 *
 * @param {{
 *   onClose?: () => void,
 *   onSuccess?: (fingerprint: string) => void
 * }} props
 */
export function VaultKeySetup({ onClose, onSuccess }) {
  const { status, fingerprint, createAndRegister, error: hookError } = useVaultKey();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [successFingerprint, setSuccessFingerprint] = useState(null);

  const isMismatch = status === 'mismatch';
  const isReady = status === 'ready';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);

    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setLocalError('Please enter a valid 6-digit authenticator code.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await createAndRegister(trimmed);
      const fp = res?.fingerprint || fingerprint;
      setSuccessFingerprint(fp);
      setCode('');
      if (typeof onSuccess === 'function' && fp) {
        onSuccess(fp);
      }
    } catch (err) {
      setLocalError(err.message || 'Failed to register vault key');
    } finally {
      setSubmitting(false);
    }
  };

  const activeFingerprint = successFingerprint || (isReady ? fingerprint : null);

  return (
    <div
      data-testid="vault-key-setup"
      style={{
        backgroundColor: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '12px',
        padding: '1.75rem',
        maxWidth: '560px',
        margin: '0 auto',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.25rem 0', color: '#0f172a' }}>
            Browser Vault Key
          </h2>
          <span
            style={{
              display: 'inline-block',
              fontSize: '0.75rem',
              fontWeight: 600,
              padding: '0.15rem 0.5rem',
              borderRadius: '9999px',
              backgroundColor: isReady ? '#ecfdf5' : isMismatch ? '#fef2f2' : '#f8fafc',
              color: isReady ? '#065f46' : isMismatch ? '#991b1b' : '#475569',
              border: `1px solid ${isReady ? '#a7f3d0' : isMismatch ? '#fecaca' : '#cbd5e1'}`
            }}
          >
            {isReady ? 'Active & Ready' : isMismatch ? 'Key Mismatch' : 'Not Configured'}
          </span>
        </div>

        {typeof onClose === 'function' && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.25rem',
              cursor: 'pointer',
              color: '#64748b'
            }}
          >
            &times;
          </button>
        )}
      </div>

      <p style={{ fontSize: '0.875rem', color: '#334155', lineHeight: 1.5, marginBottom: '1rem' }}>
        A key that stays in this browser lets people send you documents without sharing any secret. Documents sent to this key cannot be opened on other devices.
      </p>

      {/* Mismatch Warning */}
      {isMismatch && (
        <div
          role="alert"
          style={{
            backgroundColor: '#fff1f2',
            border: '1px solid #fecdd3',
            borderRadius: '8px',
            padding: '0.85rem',
            marginBottom: '1.25rem',
            fontSize: '0.825rem',
            color: '#9f1239',
            lineHeight: 1.45
          }}
        >
          <strong style={{ display: 'block', marginBottom: '0.25rem' }}>Warning: Key Mismatch Detected</strong>
          Your account has a vault key registered on the server, but this browser does not hold the matching private key (for example, if you registered from another browser or device). Documents sent to that key cannot be opened on this device. You may register a new key for this browser below to update your public key.
        </div>
      )}

      {/* Display Registered Fingerprint */}
      {activeFingerprint && (
        <div
          data-testid="fingerprint-display"
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            padding: '1rem',
            marginBottom: '1.25rem'
          }}
        >
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.35rem' }}>
            Your Public Key Fingerprint
          </div>
          <code
            style={{
              display: 'block',
              fontSize: '0.95rem',
              fontWeight: 700,
              fontFamily: 'ui-monospace, monospace',
              color: '#0f172a',
              letterSpacing: '0.05em',
              wordBreak: 'break-all'
            }}
          >
            {activeFingerprint}
          </code>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
            Senders will see this fingerprint to confirm they are delivering documents to your verified browser key.
          </p>
        </div>
      )}

      {/* Registration / Re-registration Form */}
      {(!isReady || isMismatch) && (
        <form onSubmit={handleSubmit} style={{ marginTop: '1rem' }}>
          <div style={{ marginBottom: '1rem' }}>
            <label
              htmlFor="vault-key-totp"
              style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#334155', marginBottom: '0.35rem' }}
            >
              Authenticator Code (TOTP)
            </label>
            <input
              id="vault-key-totp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                setLocalError(null);
              }}
              disabled={submitting}
              className="input-3d-well"
              style={{
                width: '100%',
                padding: '0.65rem 0.75rem',
                fontSize: '1.1rem',
                letterSpacing: '0.2em',
                textAlign: 'center',
                fontFamily: 'ui-monospace, monospace',
                borderRadius: '6px',
                boxSizing: 'border-box'
              }}
            />
            <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
              Enter your 6-digit authenticator code. If the code timer is low, wait for a fresh code before submitting.
            </p>
          </div>

          {(localError || hookError) && (
            <div
              role="alert"
              style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '6px',
                padding: '0.65rem 0.75rem',
                marginBottom: '1rem',
                fontSize: '0.825rem',
                color: '#991b1b'
              }}
            >
              {localError || hookError}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || code.length !== 6}
            className="btn btn-3d-primary"
            style={{
              width: '100%',
              padding: '0.75rem',
              fontSize: '0.9rem',
              fontWeight: 600,
              color: '#ffffff',
              borderRadius: '6px',
              cursor: submitting || code.length !== 6 ? 'not-allowed' : 'pointer'
            }}
          >
            {submitting ? 'Registering Key...' : isMismatch ? 'Rotate & Register Key for this Device' : 'Generate & Register Vault Key'}
          </button>
        </form>
      )}
    </div>
  );
}

export default VaultKeySetup;
