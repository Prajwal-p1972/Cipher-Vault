import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  request,
  refreshSession,
  setAccessToken,
  clearAccessToken
} from '../api/http.js';

export const AuthContext = createContext(null);

let initialBootPromise = null;

/**
 * Resets initial boot promise (for testing isolation).
 */
export function resetBootPromise() {
  initialBootPromise = null;
}

/**
 * Executes exactly one session recovery refresh across React mounts.
 */
function performInitialBoot() {
  if (!initialBootPromise) {
    initialBootPromise = (async () => {
      try {
        const data = await refreshSession();
        return data;
      } catch {
        return null;
      }
    })();
  }
  return initialBootPromise;
}

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('booting');
  const [user, setUser] = useState(null);
  const [setupToken, setSetupToken] = useState(null);
  const [mfaToken, setMfaToken] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    performInitialBoot().then((data) => {
      if (!isMounted) return;
      if (data?.user && data?.accessToken) {
        setUser(data.user);
        setStatus('authed');
      } else {
        setStatus('loggedOut');
      }
    });

    const handleAuthLogout = () => {
      setUser(null);
      setSetupToken(null);
      setMfaToken(null);
      setStatus('loggedOut');
    };

    window.addEventListener('auth:logout', handleAuthLogout);
    return () => {
      isMounted = false;
      window.removeEventListener('auth:logout', handleAuthLogout);
    };
  }, []);

  const register = async ({ email, displayName, password }) => {
    setError(null);
    return await request('/api/auth/register', {
      method: 'POST',
      body: { email, displayName, password }
    });
  };

  const login = async ({ email, password }) => {
    setError(null);
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: { email, password }
    });

    if (res.status === 'MFA_SETUP_REQUIRED') {
      setSetupToken(res.setupToken);
      setStatus('needsMfaSetup');
    } else if (res.status === 'MFA_REQUIRED') {
      setMfaToken(res.mfaToken);
      setStatus('needsMfaCode');
    }

    return res;
  };

  const startSetup = async () => {
    setError(null);
    return await request('/api/auth/mfa/setup', {
      method: 'POST',
      token: setupToken
    });
  };

  const confirmSetup = async (code) => {
    setError(null);
    const res = await request('/api/auth/mfa/enable', {
      method: 'POST',
      token: setupToken,
      body: { code }
    });

    setAccessToken(res.accessToken);
    setUser(res.user);
    setSetupToken(null);
    setStatus('authed');
    return res;
  };

  const verifyMfa = async (code) => {
    setError(null);
    const res = await request('/api/auth/mfa/verify', {
      method: 'POST',
      body: { mfaToken, code }
    });

    setAccessToken(res.accessToken);
    setUser(res.user);
    setMfaToken(null);
    setStatus('authed');
    return res;
  };

  const logout = async () => {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } catch (_) {
      // Best effort
    }
    clearAccessToken();
    setUser(null);
    setSetupToken(null);
    setMfaToken(null);
    setStatus('loggedOut');
  };

  const value = {
    user,
    status,
    error,
    setError,
    setupToken,
    mfaToken,
    register,
    login,
    startSetup,
    confirmSetup,
    verifyMfa,
    logout
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
