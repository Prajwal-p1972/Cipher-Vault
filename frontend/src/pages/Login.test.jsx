import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, resetBootPromise } from '../auth/AuthContext.jsx';
import { Login } from './Login.jsx';
import { clearAccessToken } from '../api/http.js';

describe('Login Component Tests', () => {
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

  function renderLogin() {
    return render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>
    );
  }

  it('displays client error when submitting empty fields', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({})
    }));

    const user = userEvent.setup();
    renderLogin();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(
      screen.getByText(/please provide both email and password/i)
    ).toBeTruthy();
  });

  it('displays generic error on 401 credential failure without revealing user existence', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const urlStr = String(url);
      if (urlStr === '/api/auth/refresh') {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      if (urlStr === '/api/auth/login') {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: 'Invalid credentials' })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const user = userEvent.setup();
    renderLogin();

    await waitFor(() => {
      expect(screen.getByLabelText(/email address/i)).toBeTruthy();
    });

    await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
    await user.type(screen.getByLabelText(/master password/i), 'WrongPassword123!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText('Invalid email or password')).toBeTruthy();
    });
  });

  it('displays locked message on 423 status and rate-limited message on 429 status', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const urlStr = String(url);
      if (urlStr === '/api/auth/refresh') {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      if (urlStr === '/api/auth/login') {
        return {
          ok: false,
          status: 423,
          json: async () => ({ error: 'Account is temporarily locked' })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const user = userEvent.setup();
    renderLogin();

    await waitFor(() => {
      expect(screen.getByLabelText(/email address/i)).toBeTruthy();
    });

    await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
    await user.type(screen.getByLabelText(/master password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/account is temporarily locked/i)).toBeTruthy();
    });
  });

  it('transitions to MFA setup step and renders QR img src matching data URL', async () => {
    const mockQrDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const mockManualKey = 'JBSWY3DPEHPK3PXP';

    globalThis.fetch = vi.fn(async (url) => {
      const urlStr = String(url);
      if (urlStr === '/api/auth/refresh') {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      if (urlStr === '/api/auth/login') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'MFA_SETUP_REQUIRED',
            setupToken: 'test_setup_token'
          })
        };
      }
      if (urlStr === '/api/auth/mfa/setup') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            qrDataUrl: mockQrDataUrl,
            manualEntryKey: mockManualKey,
            otpauthUrl: 'otpauth://totp/CipherVault:test@example.com?secret=JBSWY3DPEHPK3PXP'
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const user = userEvent.setup();
    renderLogin();

    await waitFor(() => {
      expect(screen.getByLabelText(/email address/i)).toBeTruthy();
    });

    await user.type(screen.getByLabelText(/email address/i), 'newuser@example.com');
    await user.type(screen.getByLabelText(/master password/i), 'ValidPassword123!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/configure two-factor authentication/i)).toBeTruthy();
    });

    // Verify QR code image rendering and src match
    const qrImg = await screen.findByRole('img', { name: /totp qr code/i });
    expect(qrImg).toBeTruthy();
    expect(qrImg.getAttribute('src')).toBe(mockQrDataUrl);

    // Verify manual key entry display
    expect(screen.getByText(mockManualKey)).toBeTruthy();
    expect(screen.getByLabelText(/6-digit verification code/i)).toBeTruthy();
  });

  it('transitions to MFA code verification step when MFA is already enabled', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const urlStr = String(url);
      if (urlStr === '/api/auth/refresh') {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      if (urlStr === '/api/auth/login') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'MFA_REQUIRED',
            mfaToken: 'test_mfa_token'
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const user = userEvent.setup();
    renderLogin();

    await waitFor(() => {
      expect(screen.getByLabelText(/email address/i)).toBeTruthy();
    });

    await user.type(screen.getByLabelText(/email address/i), 'existing@example.com');
    await user.type(screen.getByLabelText(/master password/i), 'ValidPassword123!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/two-factor verification/i)).toBeTruthy();
    });

    expect(screen.getByLabelText(/authentication code/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /verify & access vault/i })).toBeTruthy();
  });
});
