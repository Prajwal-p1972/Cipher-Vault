import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider, resetBootPromise } from '../auth/AuthContext.jsx';
import { Register } from './Register.jsx';
import { clearAccessToken } from '../api/http.js';

describe('Register Component Tests', () => {
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

  function renderRegister() {
    return render(
      <MemoryRouter initialEntries={['/register']}>
        <AuthProvider>
          <Routes>
            <Route path="/register" element={<Register />} />
            <Route path="/login" element={<div>Login Page Target</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );
  }

  it('enforces client-side validation rules for name, email, and password length', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({})
    }));

    const user = userEvent.setup();
    renderRegister();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create secure vault account/i })).toBeTruthy();
    });

    const submitBtn = screen.getByRole('button', { name: /create secure vault account/i });

    // 1. Empty display name
    await user.click(submitBtn);
    expect(screen.getByText(/display name is required/i)).toBeTruthy();

    // 2. Invalid email format
    await user.type(screen.getByLabelText(/display name/i), 'Alice');
    await user.type(screen.getByLabelText(/email address/i), 'not-an-email');
    await user.click(submitBtn);
    expect(screen.getByText(/valid email address is required/i)).toBeTruthy();

    // 3. Password shorter than 12 characters
    await user.clear(screen.getByLabelText(/email address/i));
    await user.type(screen.getByLabelText(/email address/i), 'alice@example.com');
    await user.type(screen.getByLabelText(/master password/i), 'shortpass');
    await user.click(submitBtn);
    expect(
      screen.getByText(/password must be between 12 and 128 characters/i)
    ).toBeTruthy();
  });

  it('displays structured server validation details on 400 response', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const urlStr = String(url);
      if (urlStr === '/api/auth/refresh') {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      if (urlStr === '/api/auth/register') {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: 'Validation failed',
            details: [
              { path: 'password', message: 'Password must contain at least one symbol' }
            ]
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const user = userEvent.setup();
    renderRegister();

    await waitFor(() => {
      expect(screen.getByLabelText(/display name/i)).toBeTruthy();
    });

    await user.type(screen.getByLabelText(/display name/i), 'Alice Test');
    await user.type(screen.getByLabelText(/email address/i), 'alice@test.com');
    await user.type(screen.getByLabelText(/master password/i), 'Password123456');
    await user.click(screen.getByRole('button', { name: /create secure vault account/i }));

    await waitFor(() => {
      expect(screen.getByText('Validation failed:')).toBeTruthy();
      expect(
        screen.getByText('Password must contain at least one symbol')
      ).toBeTruthy();
    });
  });

  it('submits valid registration and redirects to /login', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      const urlStr = String(url);
      if (urlStr === '/api/auth/refresh') {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      if (urlStr === '/api/auth/register') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            user: { id: 'u_100', email: 'valid@example.com', displayName: 'Valid User' }
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const user = userEvent.setup();
    renderRegister();

    await waitFor(() => {
      expect(screen.getByLabelText(/display name/i)).toBeTruthy();
    });

    await user.type(screen.getByLabelText(/display name/i), 'Valid User');
    await user.type(screen.getByLabelText(/email address/i), 'valid@example.com');
    await user.type(screen.getByLabelText(/master password/i), 'ValidPassword123!');
    await user.click(screen.getByRole('button', { name: /create secure vault account/i }));

    await waitFor(() => {
      expect(screen.getByText('Login Page Target')).toBeTruthy();
    });
  });
});
