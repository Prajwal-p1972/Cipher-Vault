import { AI_URL } from '../config.js';

/**
 * Structured error class representing failures interacting with the local AI microservice.
 */
export class LocalAiError extends Error {
  /**
   * @param {number} status - HTTP status code (0 for network failures)
   * @param {string} message - User-safe error description
   */
  constructor(status, message) {
    super(message);
    this.name = 'LocalAiError';
    this.status = status;
  }
}

/**
 * Probe local AI service liveness and verify offline model availability.
 * Rejects after a strict 3-second timeout.
 *
 * @returns {Promise<{ online: boolean, modelsReady: boolean }>}
 */
export async function checkHealth() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(`${AI_URL}/health`, {
      method: 'GET',
      signal: controller.signal
    });

    if (!res.ok) {
      return { online: false, modelsReady: false };
    }

    const data = await res.json().catch(() => ({}));
    return {
      online: true,
      modelsReady: Boolean(data.modelsReady)
    };
  } catch (_) {
    return { online: false, modelsReady: false };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Initialize an ephemeral in-memory session on the local AI microservice.
 *
 * @returns {Promise<{ sessionId: string, token: string, expiresAt: number, ttlSeconds: number }>}
 */
export async function createSession() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(`${AI_URL}/v1/sessions`, {
      method: 'POST',
      signal: controller.signal
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new LocalAiError(
        res.status,
        data.error || data.detail || 'Failed to establish local AI session'
      );
    }

    const data = await res.json();
    return {
      sessionId: data.sessionId,
      token: data.token,
      expiresAt: data.expiresAt,
      ttlSeconds: data.ttlSeconds
    };
  } catch (err) {
    if (err instanceof LocalAiError) {
      throw err;
    }
    if (err.name === 'AbortError') {
      throw new LocalAiError(504, 'Session creation timed out');
    }
    throw new LocalAiError(0, err.message || 'Unable to connect to local AI service');
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Send raw unencrypted document bytes directly to the local AI microservice for in-memory indexing.
 *
 * @param {{ sessionId: string, token: string }} session
 * @param {Blob} blob - Decrypted document content
 * @param {((progress: number) => void)} [onProgress]
 * @returns {Promise<{ docId: string, pageCount: number, ocrPages: number, chunkCount: number, warnings: string[] }>}
 */
export async function ingestDocument(session, blob, onProgress) {
  if (!session || !session.sessionId || !session.token) {
    throw new LocalAiError(401, 'Missing active AI session');
  }
  if (!blob) {
    throw new LocalAiError(400, 'Missing document payload');
  }

  const controller = new AbortController();
  // 3-minute hard timeout for intensive PDF/OCR analysis
  const timeoutId = setTimeout(() => controller.abort(), 180000);

  try {
    const res = await fetch(`${AI_URL}/v1/sessions/${session.sessionId}/documents`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.token}`,
        'Content-Type': 'application/octet-stream'
      },
      body: blob,
      signal: controller.signal
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      let message = data.error || data.detail || 'Document ingestion failed';
      if (res.status === 413) {
        message = data.error || 'Document exceeds permitted size limits';
      } else if (res.status === 415) {
        message = data.error || 'Unsupported document format';
      } else if (res.status === 422) {
        message = data.error || 'Failed to extract document text';
      } else if (res.status === 504) {
        message = data.error || 'Document processing timed out';
      }
      throw new LocalAiError(res.status, message);
    }

    const data = await res.json();
    return {
      docId: data.docId,
      pageCount: data.pageCount ?? 0,
      ocrPages: data.ocrPages ?? 0,
      chunkCount: data.chunkCount ?? 0,
      warnings: data.warnings || []
    };
  } catch (err) {
    if (err instanceof LocalAiError) {
      throw err;
    }
    if (err.name === 'AbortError') {
      throw new LocalAiError(504, 'Document ingestion timed out');
    }
    throw new LocalAiError(0, err.message || 'Network error during document ingestion');
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Retrieve session metadata and chunk counts from local AI service.
 *
 * @param {{ sessionId: string, token: string }} session
 * @returns {Promise<{ documents: number, chunks: number, expiresAt: number }>}
 */
export async function getSession(session) {
  if (!session || !session.sessionId || !session.token) {
    throw new LocalAiError(401, 'Missing active AI session');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(`${AI_URL}/v1/sessions/${session.sessionId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${session.token}`
      },
      signal: controller.signal
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new LocalAiError(
        res.status,
        data.error || data.detail || 'Failed to retrieve session metadata'
      );
    }

    const data = await res.json();
    return {
      documents: data.documents ?? 0,
      chunks: data.chunks ?? 0,
      expiresAt: data.expiresAt
    };
  } catch (err) {
    if (err instanceof LocalAiError) {
      throw err;
    }
    if (err.name === 'AbortError') {
      throw new LocalAiError(504, 'Session query timed out');
    }
    throw new LocalAiError(0, err.message || 'Network error querying session');
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Request immediate deletion of an active AI session and its vector store collections.
 * Dispatched with keepalive: true to ensure execution during window teardown.
 *
 * @param {{ sessionId: string, token: string } | null} session
 * @returns {Promise<void>}
 */
export async function deleteSession(session) {
  if (!session || !session.sessionId || !session.token) {
    return;
  }

  try {
    await fetch(`${AI_URL}/v1/sessions/${session.sessionId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${session.token}`
      },
      keepalive: true
    });
  } catch (_) {
    // Non-blocking cleanup during teardown
  }
}
