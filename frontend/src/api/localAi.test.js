import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkHealth,
  createSession,
  ingestDocument,
  getSession,
  deleteSession,
  LocalAiError
} from './localAi.js';
import { AI_URL } from '../config.js';

describe('Local AI API Client Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkHealth', () => {
    it('queries GET {AI}/health without Authorization header and returns readiness', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', modelsReady: true })
      });

      const res = await checkHealth();
      expect(res).toEqual({ online: true, modelsReady: true });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe(`${AI_URL}/health`);
      expect(options.method).toBe('GET');
      expect(options.headers).toBeUndefined();
    });

    it('returns offline when health check fails or times out', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Connection refused'));

      const res = await checkHealth();
      expect(res).toEqual({ online: false, modelsReady: false });
    });
  });

  describe('createSession', () => {
    it('queries POST {AI}/v1/sessions without Authorization header', async () => {
      const mockSession = {
        sessionId: 'test-session-id-123',
        token: 'test-token-abc',
        expiresAt: 1800000000,
        ttlSeconds: 1800
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockSession
      });

      const session = await createSession();
      expect(session).toEqual(mockSession);

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe(`${AI_URL}/v1/sessions`);
      expect(options.method).toBe('POST');
      expect(options.headers).toBeUndefined();
    });

    it('maps HTTP errors into LocalAiError with status and message', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Forbidden: origin not allowed' })
      });

      await expect(createSession()).rejects.toThrowError(LocalAiError);
      try {
        await createSession();
      } catch (err) {
        expect(err.status).toBe(403);
        expect(err.message).toContain('Forbidden');
      }
    });
  });

  describe('ingestDocument', () => {
    it('sends raw Blob with Content-Type application/octet-stream and Bearer token', async () => {
      const session = { sessionId: 'sid-1', token: 'tok-1' };
      const blob = new Blob(['%PDF-1.4 test content'], { type: 'application/pdf' });

      const mockResponse = {
        docId: 'doc-123',
        pageCount: 2,
        ocrPages: 1,
        chunkCount: 5,
        warnings: ['Low resolution page']
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockResponse
      });

      const res = await ingestDocument(session, blob);
      expect(res).toEqual(mockResponse);

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe(`${AI_URL}/v1/sessions/sid-1/documents`);
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({
        'Authorization': 'Bearer tok-1',
        'Content-Type': 'application/octet-stream'
      });
      expect(options.body).toBe(blob);
    });

    it('maps specific 413, 415, and 422 HTTP responses to user-safe LocalAiError', async () => {
      const session = { sessionId: 'sid-1', token: 'tok-1' };
      const blob = new Blob(['sample']);

      // 413 Too Large
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 413,
        json: async () => ({ error: 'Payload exceeds maximum permitted size.' })
      });
      await expect(ingestDocument(session, blob)).rejects.toMatchObject({
        status: 413,
        message: 'Payload exceeds maximum permitted size.'
      });

      // 415 Unsupported
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 415,
        json: async () => ({ error: 'Unsupported document format.' })
      });
      await expect(ingestDocument(session, blob)).rejects.toMatchObject({
        status: 415,
        message: 'Unsupported document format.'
      });

      // 422 Unreadable
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ error: 'Document extraction failed.' })
      });
      await expect(ingestDocument(session, blob)).rejects.toMatchObject({
        status: 422,
        message: 'Document extraction failed.'
      });
    });

    it('maps AbortError to 504 timeout error', async () => {
      const session = { sessionId: 'sid-1', token: 'tok-1' };
      const blob = new Blob(['sample']);

      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(abortError);

      await expect(ingestDocument(session, blob)).rejects.toMatchObject({
        status: 504,
        message: 'Document ingestion timed out'
      });
    });
  });

  describe('getSession', () => {
    it('retrieves session metadata with Bearer authorization', async () => {
      const session = { sessionId: 'sid-2', token: 'tok-2' };
      const mockInfo = { documents: 1, chunks: 4, expiresAt: 1900000000 };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockInfo
      });

      const res = await getSession(session);
      expect(res).toEqual(mockInfo);

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe(`${AI_URL}/v1/sessions/sid-2`);
      expect(options.method).toBe('GET');
      expect(options.headers).toEqual({
        'Authorization': 'Bearer tok-2'
      });
    });
  });

  describe('deleteSession', () => {
    it('dispatches DELETE request using keepalive: true', async () => {
      const session = { sessionId: 'sid-del', token: 'tok-del' };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 204
      });

      await deleteSession(session);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe(`${AI_URL}/v1/sessions/sid-del`);
      expect(options.method).toBe('DELETE');
      expect(options.headers).toEqual({
        'Authorization': 'Bearer tok-del'
      });
      expect(options.keepalive).toBe(true);
    });

    it('gracefully handles missing session argument without error', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      await deleteSession(null);
      await deleteSession({});
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
