import React, { useState } from 'react';
import { Link, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { ApiError } from '../api/http.js';
import CyberVaultCanvas3D from '../components/ui3d/CyberVaultCanvas3D.jsx';
import TiltCard3D from '../components/ui3d/TiltCard3D.jsx';
import HologramEmblem3D from '../components/ui3d/HologramEmblem3D.jsx';
import VaultShowcase3D from '../components/ui3d/VaultShowcase3D.jsx';

export function Register() {
  const { register, status } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [errorMessage, setErrorMessage] = useState('');
  const [validationDetails, setValidationDetails] = useState([]);
  const [loading, setLoading] = useState(false);

  if (status === 'authed') {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setValidationDetails([]);

    const cleanEmail = email.trim();
    const cleanName = displayName.trim();

    // Client-side validation mirroring backend
    if (!cleanName) {
      setErrorMessage('Display name is required');
      return;
    }

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMessage('Valid email address is required');
      return;
    }

    if (password.length < 12 || password.length > 128) {
      setErrorMessage('Password must be between 12 and 128 characters');
      return;
    }

    setLoading(true);
    try {
      await register({
        email: cleanEmail,
        displayName: cleanName,
        password
      });

      navigate('/login', {
        state: { message: 'Registration successful. Please log in to configure MFA.' }
      });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setErrorMessage('Registration failed. Please check your details and try again.');
        } else if (err.status === 400 && Array.isArray(err.details)) {
          setErrorMessage('Validation failed:');
          setValidationDetails(err.details);
        } else if (err.status === 429) {
          setErrorMessage('Too many requests. Please slow down and try again later.');
        } else {
          setErrorMessage(err.message || 'Registration failed');
        }
      } else {
        setErrorMessage('An unexpected network error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-3d-scene perspective-1000">
      <CyberVaultCanvas3D opacity={0.65} />
      <div className="login-split-layout">
        <VaultShowcase3D />
        <TiltCard3D variant="cyan" className="auth-container">
          <HologramEmblem3D size="md" />
          <div className="auth-header">
            <h1>Create Account</h1>
            <p>Zero-cloud encrypted document vault</p>
          </div>

          {errorMessage && (
            <div className="alert alert-danger" role="alert">
              <p>{errorMessage}</p>
              {validationDetails.length > 0 && (
                <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
                  {validationDetails.map((d, idx) => (
                    <li key={idx}>{d.message || `${d.path}: invalid`}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="displayName">Display Name</label>
              <input
                id="displayName"
                className="input-3d-well"
                type="text"
                required
                maxLength={80}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
              />
            </div>

            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input
                id="email"
                className="input-3d-well"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Master Password (min 12 characters)</label>
              <div className="password-toggle-wrapper">
                <input
                  id="password"
                  className="input-3d-well"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={12}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
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
              {loading ? 'Registering...' : 'Create Secure Vault Account'}
            </button>
          </form>

          <div className="auth-footer">
            Already have an account? <Link to="/login">Sign In</Link>
          </div>
        </TiltCard3D>
      </div>
    </div>
  );
}

export default Register;
