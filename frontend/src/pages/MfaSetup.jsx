import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { ApiError } from '../api/http.js';
import CyberVaultCanvas3D from '../components/ui3d/CyberVaultCanvas3D.jsx';
import TiltCard3D from '../components/ui3d/TiltCard3D.jsx';
import HologramEmblem3D from '../components/ui3d/HologramEmblem3D.jsx';

export function MfaSetup() {
  const { status, setupToken, startSetup, confirmSetup } = useAuth();
  const navigate = useNavigate();

  const [qrDataUrl, setQrDataUrl] = useState('');
  const [manualEntryKey, setManualEntryKey] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [fetchLoading, setFetchLoading] = useState(true);
  const [submitLoading, setSubmitLoading] = useState(false);
  const hasFetched = useRef(false);

  // If already authenticated, go straight to dashboard
  if (status === 'authed') {
    return <Navigate to="/" replace />;
  }

  // If the state machine is not in the MFA setup state, redirect to login
  if (status !== 'booting' && status !== 'needsMfaSetup') {
    return <Navigate to="/login" replace />;
  }

  useEffect(() => {
    if (status !== 'needsMfaSetup' || !setupToken || hasFetched.current) return;
    hasFetched.current = true;

    setFetchLoading(true);
    startSetup()
      .then((data) => {
        if (data?.qrDataUrl) {
          setQrDataUrl(data.qrDataUrl);
          setManualEntryKey(data.manualEntryKey || '');
        }
      })
      .catch((err) => {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Failed to initiate MFA setup. Please sign in again.'
        );
      })
      .finally(() => {
        setFetchLoading(false);
      });
  }, [status, setupToken]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const clean = code.trim();
    if (!/^\d{6}$/.test(clean)) {
      setError('Please enter a valid 6-digit code.');
      return;
    }

    setSubmitLoading(true);
    try {
      await confirmSetup(clean);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError('Invalid code. Check your authenticator and try again.');
        } else if (err.status === 423) {
          setError('Account locked due to too many failed attempts. Try again later.');
        } else if (err.status === 429) {
          setError('Too many requests. Please slow down and try again.');
        } else {
          setError(err.message || 'MFA confirmation failed.');
        }
      } else {
        setError('An unexpected network error occurred.');
      }
    } finally {
      setSubmitLoading(false);
    }
  };

  return (
    <div className="mfa-setup-page auth-3d-scene perspective-1000">
      <CyberVaultCanvas3D opacity={0.65} />
      <TiltCard3D variant="cyan" className="auth-container">
        <HologramEmblem3D size="md" />
        <div className="auth-header">
          <h1>Configure Two-Factor Authentication</h1>
          <p>
            Scan the QR code below with your authenticator app (Google
            Authenticator, Authy, etc.), then enter the 6-digit code to
            activate.
          </p>
        </div>

        {error && (
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
        )}

        {fetchLoading ? (
          <div style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
            <div className="spinner" style={{ margin: '0 auto 1rem' }} />
            <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.875rem' }}>
              Generating cryptographic TOTP key…
            </p>
          </div>
        ) : (
          <>
            {qrDataUrl && (
              <div className="hologram-scanner-cradle" style={{ marginBottom: '1.25rem' }}>
                <div className="hologram-scanline" />
                <div className="qr-box" style={{ margin: 0 }}>
                  <img src={qrDataUrl} alt="TOTP QR Code — scan with your authenticator app" />
                  <div
                    style={{
                      marginTop: '0.75rem',
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)'
                    }}
                  >
                    Manual entry key:
                  </div>
                  <div className="manual-key-display">{manualEntryKey}</div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate>
              <div className="form-group">
                <label htmlFor="mfaSetupCode">6-Digit Verification Code</label>
                <input
                  id="mfaSetupCode"
                  className="input-3d-well"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
              </div>

              <button
                type="submit"
                className="btn btn-3d-primary"
                disabled={submitLoading || fetchLoading}
              >
                {submitLoading
                  ? 'Verifying…'
                  : 'Enable Two-Factor Authentication'}
              </button>
            </form>

            <div className="auth-footer">
              <button
                type="button"
                onClick={() => navigate('/login')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  padding: 0
                }}
              >
                ← Back to sign in
              </button>
            </div>
          </>
        )}
      </TiltCard3D>
    </div>
  );
}

export default MfaSetup;
