import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  request,
  requestBlob,
  getAccessToken,
  setAccessToken,
  clearAccessToken,
  refreshSession,
  ApiError
} from './http.js';

describe('HTTP Client & Single-Flight Refresh Tests', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearAccessToken();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearAccessToken();
  });

  it('handles 5 concurrent 401s with exactly ONE /refresh call and 5 successful retries', async () => {
    setAccessToken('stale_token_123');

    let refreshCallCount = 0;
    const dataCallCounts = {
      '/api/data/1': 0,
      '/api/data/2': 0,
      '/api/data/3': 0,
      '/api/data/4': 0,
      '/api/data/5': 0
    };

    globalThis.fetch = vi.fn(async (url, options = {}) => {
      const urlStr = String(url);

      if (urlStr === '/api/auth/refresh') {
        refreshCallCount++;
        // Small delay to test concurrency window
        await new Promise((res) => setTimeout(res, 20));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: 'fresh_rotated_access_token_456',
            user: { id: 'user_1', email: 'test@example.com' }
          })
        };
      }

      if (urlStr.startsWith('/api/data/')) {
        dataCallCounts[urlStr] = (dataCallCounts[urlStr] || 0) + 1;
        const authHeader = options.headers?.['Authorization'] || options.headers?.Authorization;

        if (authHeader === 'Bearer stale_token_123') {
          return {
            ok: false,
            status: 401,
            json: async () => ({ error: 'Invalid or expired token' })
          };
        }

        if (authHeader === 'Bearer fresh_rotated_access_token_456') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, url: urlStr })
          };
        }

        return {
          ok: false,
          status: 403,
          json: async () => ({ error: 'Unexpected auth header' })
        };
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' })
      };
    });

    // Fire 5 concurrent requests simultaneously
    const results = await Promise.all([
      request('/api/data/1'),
      request('/api/data/2'),
      request('/api/data/3'),
      request('/api/data/4'),
      request('/api/data/5')
    ]);

    // All 5 successfully recovered and received payload
    expect(results).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(results[i].success).toBe(true);
      expect(results[i].url).toBe(`/api/data/${i + 1}`);
    }

    // Exactly ONE refresh request was dispatched
    expect(refreshCallCount).toBe(1);

    // Each endpoint was called twice: 1 initial (401) + 1 retry (200)
    for (let i = 1; i <= 5; i++) {
      expect(dataCallCounts[`/api/data/${i}`]).toBe(2);
    }

    // Active access token was updated to fresh token
    expect(getAccessToken()).toBe('fresh_rotated_access_token_456');
  });

  it('dispatches auth:logout on window and clears in-memory token when refresh fails', async () => {
    setAccessToken('stale_token_abc');

    globalThis.fetch = vi.fn(async (url) => {
      const urlStr = String(url);
      if (urlStr === '/api/auth/refresh') {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: 'Session expired or token reused' })
        };
      }
      return {
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' })
      };
    });

    let logoutDispatched = false;
    const logoutHandler = () => {
      logoutDispatched = true;
    };
    window.addEventListener('auth:logout', logoutHandler);

    try {
      await expect(request('/api/data/confidential')).rejects.toThrow();
      expect(logoutDispatched).toBe(true);
      expect(getAccessToken()).toBe(null);
    } finally {
      window.removeEventListener('auth:logout', logoutHandler);
    }
  });

  it('guarantees that tokens are never written to localStorage, sessionStorage, or document.cookie', async () => {
    const localSpy = vi.spyOn(Storage.prototype, 'setItem');
    const sessionSpy = vi.spyOn(Storage.prototype, 'setItem');

    globalThis.fetch = vi.fn(async (url) => {
      if (String(url) === '/api/auth/refresh') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: 'ultra_secret_token_123',
            user: { id: 'u1' }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true })
      };
    });

    await refreshSession();
    await request('/api/secure');

    expect(getAccessToken()).toBe('ultra_secret_token_123');
    expect(localSpy).not.toHaveBeenCalled();
    expect(sessionSpy).not.toHaveBeenCalled();
    expect(document.cookie).not.toContain('ultra_secret_token_123');
  });

  it('handles concurrent requestBlob 401s with exactly ONE /refresh call and successful retries', async () => {
    setAccessToken('stale_blob_token');

    let refreshCount = 0;
    const blobCallCounts = {
      '/api/documents/1/open': 0,
      '/api/documents/2/open': 0,
      '/api/documents/3/open': 0
    };

    globalThis.fetch = vi.fn(async (url, options = {}) => {
      const urlStr = String(url);

      if (urlStr === '/api/auth/refresh') {
        refreshCount++;
        await new Promise((res) => setTimeout(res, 25));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: 'fresh_blob_token_999',
            user: { id: 'u1' }
          })
        };
      }

      if (urlStr.startsWith('/api/documents/')) {
        blobCallCounts[urlStr] = (blobCallCounts[urlStr] || 0) + 1;
        const authHeader = options.headers?.['Authorization'] || options.headers?.Authorization;

        if (authHeader === 'Bearer stale_blob_token') {
          return {
            ok: false,
            status: 401,
            json: async () => ({ error: 'Invalid or expired token', code: 'token_expired' })
          };
        }

        if (authHeader === 'Bearer fresh_blob_token_999') {
          const fakeBlob = new Blob(['raw-decrypted-bytes'], { type: 'application/pdf' });
          return {
            ok: true,
            status: 200,
            blob: async () => fakeBlob,
            headers: new Headers({
              'content-type': 'application/pdf',
              'x-document-name': encodeURIComponent('doc.pdf')
            })
          };
        }

        return {
          ok: false,
          status: 403,
          json: async () => ({ error: 'Unexpected auth header' })
        };
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' })
      };
    });

    // Run 3 concurrent requestBlob calls
    const results = await Promise.all([
      requestBlob('/api/documents/1/open'),
      requestBlob('/api/documents/2/open'),
      requestBlob('/api/documents/3/open')
    ]);

    expect(results).toHaveLength(3);
    for (const res of results) {
      expect(res.status).toBe(200);
      expect(res.blob).toBeInstanceOf(Blob);
      expect(res.headers.get('content-type')).toBe('application/pdf');
    }

    // Exactly ONE refresh request occurred despite 3 simultaneous 401s
    expect(refreshCount).toBe(1);

    // Each requestBlob endpoint was called twice: 1 initial (401) + 1 retry (200)
    for (let i = 1; i <= 3; i++) {
      expect(blobCallCounts[`/api/documents/${i}/open`]).toBe(2);
    }

    expect(getAccessToken()).toBe('fresh_blob_token_999');
  });
});
