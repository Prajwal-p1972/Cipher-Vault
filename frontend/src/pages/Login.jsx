import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { ApiError } from '../api/http.js';
import CyberVaultCanvas3D from '../components/ui3d/CyberVaultCanvas3D.jsx';
import TiltCard3D from '../components/ui3d/TiltCard3D.jsx';
import HologramEmblem3D from '../components/ui3d/HologramEmblem3D.jsx';
import VaultShowcase3D from '../components/ui3d/VaultShowcase3D.jsx';

export function Login() {
  const {
    status,
    login,
    startSetup,
    confirmSetup,
    verifyMfa,
    setupToken,
    mfaToken
  } = useAuth();

  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');

  // MFA setup state
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [manualEntryKey, setManualEntryKey] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);

  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState(
    location.state?.message || ''
  );
  const [loading, setLoading] = useState(false);

  // If already authenticated, redirect to dashboard
  if (status === 'authed') {
    return <Navigate to="/" replace />;
  }

  const hasFetchedSetup = useRef(false);

  // Load MFA setup details when transitioning to needsMfaSetup
  useEffect(() => {
    if (status === 'needsMfaSetup' && setupToken && !hasFetchedSetup.current) {
      hasFetchedSetup.current = true;
      setSetupLoading(true);
      startSetup()
        .then((data) => {
          if (data?.qrDataUrl) {
            setQrDataUrl(data.qrDataUrl);
            setManualEntryKey(data.manualEntryKey || '');
          }
        })
        .catch((err) => {
          setErrorMessage(err.message || 'Failed to initialize MFA setup');
        })
        .finally(() => {
          setSetupLoading(false);
        });
    }
  }, [status, setupToken]);

  const handleCredentialsSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setErrorMessage('Please provide both email and password');
      return;
    }

    setLoading(true);
    try {
      await login({ email: cleanEmail, password });
      try {
        sessionStorage.setItem('cv_play_vault_door', 'true');
      } catch (_) {}
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setErrorMessage('Invalid email or password');
        } else if (err.status === 423) {
          setErrorMessage('Account is temporarily locked due to too many failed attempts. Please try again later.');
        } else if (err.status === 429) {
          setErrorMessage('Too many requests. Please slow down and try again later.');
        } else {
          setErrorMessage(err.message || 'Sign in failed');
        }
      } else {
        setErrorMessage('An unexpected network error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSetupSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    const cleanCode = code.trim();
    if (!cleanCode || cleanCode.length !== 6 || !/^\d{6}$/.test(cleanCode)) {
      setErrorMessage('Please enter a valid 6-digit authentication code');
      return;
    }

    setLoading(true);
    try {
      await confirmSetup(cleanCode);
      try {
        sessionStorage.setItem('cv_play_vault_door', 'true');
      } catch (_) {}
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setErrorMessage('Invalid verification code. Please check your authenticator and try again.');
        } else if (err.status === 423) {
          setErrorMessage('Account is temporarily locked due to too many failed attempts. Please try again later.');
        } else if (err.status === 429) {
          setErrorMessage('Too many requests. Please slow down and try again later.');
        } else {
          setErrorMessage(err.message || 'MFA confirmation failed');
        }
      } else {
        setErrorMessage('An unexpected network error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMfaVerifySubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    const cleanCode = code.trim();
    if (!cleanCode || cleanCode.length !== 6 || !/^\d{6}$/.test(cleanCode)) {
      setErrorMessage('Please enter a valid 6-digit authentication code');
      return;
    }

    setLoading(true);
    try {
      await verifyMfa(cleanCode);
      try {
        sessionStorage.setItem('cv_play_vault_door', 'true');
      } catch (_) {}
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setErrorMessage('Invalid verification code. Please check your authenticator and try again.');
        } else if (err.status === 423) {
          setErrorMessage('Account is temporarily locked due to too many failed attempts. Please try again later.');
        } else if (err.status === 429) {
          setErrorMessage('Too many requests. Please slow down and try again later.');
        } else {
          setErrorMessage(err.message || 'MFA verification failed');
        }
      } else {
        setErrorMessage('An unexpected network error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  // Step 2: MFA Enrollment
  if (status === 'needsMfaSetup') {
    return (
      <div className="auth-3d-scene perspective-1000">
        <CyberVaultCanvas3D opacity={0.65} />
        <div className="login-split-layout">
          <VaultShowcase3D />
          <TiltCard3D variant="cyan" className="auth-container">
            <HologramEmblem3D size="md" />
            <div className="auth-header">
              <h1>Configure Two-Factor Authentication</h1>
              <p>Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)</p>
            </div>

            {errorMessage && (
              <div className="alert alert-danger" role="alert">
                {errorMessage}
              </div>
            )}

            {setupLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem' }}>
                <div className="spinner" />
                <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)' }}>
                  Generating cryptographic TOTP key...
                </p>
              </div>
            ) : (
              <>
                {qrDataUrl && (
                  <div className="hologram-scanner-cradle" style={{ marginBottom: '1.25rem' }}>
                    <div className="hologram-scanline" />
                    <div className="qr-box" style={{ margin: 0 }}>
                      <img src={qrDataUrl} alt="TOTP QR Code" />
                      <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        Manual key entry:
                      </div>
                      <div className="manual-key-display">{manualEntryKey}</div>
                    </div>
                  </div>
                )}

                <form onSubmit={handleMfaSetupSubmit} noValidate>
                  <div className="form-group">
                    <label htmlFor="totpSetupCode">6-Digit Verification Code</label>
                    <input
                      id="totpSetupCode"
                      className="input-3d-well"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="000000"
                      required
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    />
                  </div>

                  <button type="submit" className="btn btn-3d-primary" disabled={loading}>
                    {loading ? 'Verifying...' : 'Enable Two-Factor Authentication'}
                  </button>
                </form>
              </>
            )}
          </TiltCard3D>
        </div>
      </div>
    );
  }

  // Step 3: MFA Verification
  if (status === 'needsMfaCode') {
    return (
      <div className="auth-3d-scene perspective-1000">
        <CyberVaultCanvas3D opacity={0.65} />
        <div className="login-split-layout">
          <VaultShowcase3D />
          <TiltCard3D variant="cyan" className="auth-container">
            <HologramEmblem3D size="md" />
            <div className="auth-header">
              <h1>Two-Factor Verification</h1>
              <p>Enter the 6-digit code from your authenticator application</p>
            </div>

            {errorMessage && (
              <div className="alert alert-danger" role="alert">
                {errorMessage}
              </div>
            )}

            <form onSubmit={handleMfaVerifySubmit} noValidate>
              <div className="form-group">
                <label htmlFor="totpCode">Authentication Code</label>
                <input
                  id="totpCode"
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

              <button type="submit" className="btn btn-3d-primary" disabled={loading}>
                {loading ? 'Verifying...' : 'Verify & Access Vault'}
              </button>
            </form>
          </TiltCard3D>
        </div>
      </div>
    );
  }

  // Step 1: Credentials
  return (
    <div className="auth-3d-scene perspective-1000">
      <CyberVaultCanvas3D opacity={0.65} />
      <div className="login-split-layout">
        <VaultShowcase3D />
        <TiltCard3D variant="cyan" className="auth-container">
          <HologramEmblem3D size="md" />
          <div className="auth-header">
            <h1>Sign In to Cipher Vault</h1>
            <p>Zero-cloud secure document exchange</p>
          </div>

          {successMessage && (
            <div className="alert alert-success" role="status">
              {successMessage}
            </div>
          )}

          {errorMessage && (
            <div className="alert alert-danger" role="alert">
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleCredentialsSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input
                id="email"
                className="input-3d-well"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Master Password</label>
              <div className="password-toggle-wrapper">
                <input
                  id="password"
                  className="input-3d-well"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="password-eye-btn"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label="Toggle password visibility"
                >
                  {showPassword ? (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-3d-primary" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="auth-footer">
            Don't have an account? <Link to="/register">Create one</Link>
          </div>
        </TiltCard3D>
      </div>
    </div>
  );
}

export default Login;
