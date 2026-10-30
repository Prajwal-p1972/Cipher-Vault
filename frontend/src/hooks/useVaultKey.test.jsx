import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVaultKey } from './useVaultKey.js';
import { AuthContext } from '../auth/AuthContext.jsx';
import { getKey, saveKey, generateVaultKey } from '../crypto/vaultKeys.js';

describe('useVaultKey Hook Specification', () => {
  const originalFetch = globalThis.fetch;
  const mockUser = { id: 'user_hook_test_42', email: 'test@example.com' };

  const wrapper = ({ children }) => (
    <AuthContext.Provider value={{ user: mockUser, status: 'authed' }}>
      {children}
    </AuthContext.Provider>
  );

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sets status to 'none' when user has no key registered on server", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url) === '/api/keys/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ registered: false, keyId: null, fingerprint: null })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const { result } = renderHook(() => useVaultKey(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe('none');
    });

    expect(result.current.fingerprint).toBe(null);
  });

  it("sets status to 'ready' when matching key exists both on server and in local IndexedDB", async () => {
    const keyData = await generateVaultKey();
    await saveKey(mockUser.id, {
      keyId: keyData.keyId,
      privateKey: keyData.privateKey,
      publicRaw: keyData.publicRaw
    });

    globalThis.fetch = vi.fn(async (url) => {
      if (String(url) === '/api/keys/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            registered: true,
            keyId: keyData.keyId,
            fingerprint: keyData.fingerprint
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const { result } = renderHook(() => useVaultKey(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    expect(result.current.fingerprint).toBe(keyData.fingerprint);
  });

  it("sets status to 'mismatch' when server has a registered key missing from this browser", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url) === '/api/keys/me') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            registered: true,
            keyId: 'foreign_key_id_not_in_indexeddb_abcdef1234567890abcdef1234567890',
            fingerprint: 'abcd 1234 5678 90ef abcd 1234 5678 90ef'
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const { result } = renderHook(() => useVaultKey(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe('mismatch');
    });

    expect(result.current.fingerprint).toBe('abcd 1234 5678 90ef abcd 1234 5678 90ef');
  });

  it('saves key locally ONLY after the server accepts registration, then transitions to ready', async () => {
    let capturedBody = null;
    let putResolved = false;

    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const urlStr = String(url);
      if (urlStr === '/api/keys/me' && init.method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ registered: false })
        };
      }

      if (urlStr === '/api/keys/me' && init.method === 'PUT') {
        capturedBody = JSON.parse(init.body);
        putResolved = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            registered: true,
            keyId: 'registered_key_id_123',
            fingerprint: '1111 2222 3333 4444 5555 6666 7777 8888'
          })
        };
      }

      return { ok: false, status: 404, json: async () => ({}) };
    });

    const { result } = renderHook(() => useVaultKey(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe('none');
    });

    let res;
    await act(async () => {
      res = await result.current.createAndRegister('654321');
    });

    expect(putResolved).toBe(true);
    expect(capturedBody.code).toBe('654321');
    expect(typeof capturedBody.publicKey).toBe('string');
    expect(res.fingerprint).toBe('1111 2222 3333 4444 5555 6666 7777 8888');

    expect(result.current.status).toBe('ready');
    expect(result.current.fingerprint).toBe('1111 2222 3333 4444 5555 6666 7777 8888');
  });

  it('correctly maps 401, 423, and 429 server error codes and leaves local storage clean on failure', async () => {
    const errorCases = [
      {
        status: 401,
        body: { error: 'Invalid or used code' },
        expected: /Invalid or used code\. Wait for the next code\./i
      },
      {
        status: 423,
        body: { error: 'Account is locked' },
        expected: /temporarily locked/i
      },
      {
        status: 429,
        body: { error: 'Rate limited' },
        expected: /Too many requests/i
      }
    ];

    for (const testCase of errorCases) {
      globalThis.fetch = vi.fn(async (url, init = {}) => {
        const urlStr = String(url);
        if (urlStr === '/api/keys/me' && init.method === 'GET') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ registered: false })
          };
        }

        if (urlStr === '/api/keys/me' && init.method === 'PUT') {
          return {
            ok: false,
            status: testCase.status,
            json: async () => testCase.body
          };
        }

        return { ok: false, status: 404, json: async () => ({}) };
      });

      const { result } = renderHook(() => useVaultKey(), { wrapper });

      await waitFor(() => {
        expect(result.current.status).toBe('none');
      });

      await act(async () => {
        await expect(result.current.createAndRegister('112233')).rejects.toThrow(testCase.expected);
      });

      expect(result.current.error).toMatch(testCase.expected);
      expect(result.current.status).toBe('none');
    }
  });
});
