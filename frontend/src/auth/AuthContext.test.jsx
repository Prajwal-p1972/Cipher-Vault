import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth, resetBootPromise } from './AuthContext.jsx';
import { clearAccessToken, ApiError } from '../api/http.js';

function TestConsumer({ onState }) {
  const auth = useAuth();
  useEffect(() => {
    if (onState) onState(auth);
  }, [auth, onState]);

  return (
    <div>
      <div data-testid="status">{auth.status}</div>
      <div data-testid="user">{auth.user ? auth.user.email : 'null'}</div>
    </div>
  );
}

describe('AuthContext State Machine Tests', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearAccessToken();
    resetBootPromise();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearAccessToken();
    resetBootPromise();
  });

  it('StrictMode double-mount sends only ONE /refresh call', async () => {
    let refreshCalls = 0;
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url) === '/api/auth/refresh') {
        refreshCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: 'recovered_token_abc',
            user: { id: 'u1', email: 'recovered@example.com' }
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    render(
      <React.StrictMode>
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>
      </React.StrictMode>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('authed');
    });

    expect(screen.getByTestId('user').textContent).toBe('recovered@example.com');
    // StrictMode double mounts in dev, but single-flight boot must dispatch exactly ONE /refresh
    expect(refreshCalls).toBe(1);
  });

  it('executes login -> needsMfaSetup -> confirmSetup -> authed transition', async () => {
    // Initial boot fails (no session cookie)
    globalThis.fetch = vi.fn(async (url) => {
      const urlStr = String(url);
      if (urlStr === '/api/auth/refresh') {
        return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    let currentAuth = null;
    render(
      <AuthProvider>
        <TestConsumer onState={(auth) => { currentAuth = auth; }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('loggedOut');
    });

    // 1. Login requiring setup
    globalThis.fetch = vi.fn(async (url, opts) => {
      const urlStr = String(url);
      if (urlStr === '/api/auth/login') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'MFA_SETUP_REQUIRED',
            setupToken: 'setup_token_xyz'
          })
        };
      }
      if (urlStr === '/api/auth/mfa/setup') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            qrDataUrl: 'data:image/png;base64,mockQr',
            manualEntryKey: 'MKEY123'
          })
        };
      }
      if (urlStr === '/api/auth/mfa/enable') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: 'at_new_user',
            user: { id: 'u_new', email: 'new@example.com' }
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    await act(async () => {
      await currentAuth.login({ email: 'new@example.com', password: 'Password1234!' });
    });

    expect(screen.getByTestId('status').textContent).toBe('needsMfaSetup');
    expect(currentAuth.setupToken).toBe('setup_token_xyz');

    // 2. Start setup
    const setupData = await currentAuth.startSetup();
    expect(setupData.manualEntryKey).toBe('MKEY123');

    // 3. Confirm setup
    await act(async () => {
      await currentAuth.confirmSetup('123456');
    });

    expect(screen.getByTestId('status').textContent).toBe('authed');
    expect(screen.getByTestId('user').textContent).toBe('new@example.com');
  });

  it('executes login -> needsMfaCode -> verifyMfa -> authed transition', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url) === '/api/auth/refresh') {
        return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    let currentAuth = null;
    render(
      <AuthProvider>
        <TestConsumer onState={(auth) => { currentAuth = auth; }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('loggedOut');
    });

    globalThis.fetch = vi.fn(async (url) => {
      const urlStr = String(url);
      if (urlStr === '/api/auth/login') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'MFA_REQUIRED',
            mfaToken: 'mfa_token_456'
          })
        };
      }
      if (urlStr === '/api/auth/mfa/verify') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: 'at_returning_user',
            user: { id: 'u_existing', email: 'bob@example.com' }
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    await act(async () => {
      await currentAuth.login({ email: 'bob@example.com', password: 'Password1234!' });
    });

    expect(screen.getByTestId('status').textContent).toBe('needsMfaCode');
    expect(currentAuth.mfaToken).toBe('mfa_token_456');

    await act(async () => {
      await currentAuth.verifyMfa('654321');
    });

    expect(screen.getByTestId('status').textContent).toBe('authed');
    expect(screen.getByTestId('user').textContent).toBe('bob@example.com');
  });

  it('handles 423 account locked response correctly', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const urlStr = String(url);
      if (urlStr === '/api/auth/refresh') {
        return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) };
      }
      if (urlStr === '/api/auth/login') {
        return {
          ok: false,
          status: 423,
          json: async () => ({
            error: 'Account is temporarily locked due to too many failed attempts'
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    let currentAuth = null;
    render(
      <AuthProvider>
        <TestConsumer onState={(auth) => { currentAuth = auth; }} />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('loggedOut');
    });

    await expect(
      currentAuth.login({ email: 'locked@example.com', password: 'Password1234!' })
    ).rejects.toMatchObject({
      status: 423
    });

    expect(screen.getByTestId('status').textContent).toBe('loggedOut');
  });
});
