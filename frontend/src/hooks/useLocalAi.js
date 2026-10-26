import { useState, useRef, useEffect, useCallback } from 'react';
import { checkHealth, createSession, ingestDocument, deleteSession, LocalAiError } from '../api/localAi.js';

/**
 * React hook orchestrating the local AI lifecycle, in-memory sessions, and document indexing state.
 *
 * States:
 * - 'idle': Initial state before analysis is requested
 * - 'checking': Testing service liveness and model weights availability
 * - 'offline': Service not responding or required model weights missing
 * - 'ready': Service validated and ready (transient during analyze)
 * - 'analyzing': Actively streaming and indexing document content
 * - 'indexed': Content processed into in-memory vector store, stats available
 * - 'error': Ingestion or session error occurred
 *
 * @returns {{
 *   state: 'idle' | 'checking' | 'offline' | 'ready' | 'analyzing' | 'indexed' | 'error',
 *   stats: { pageCount: number, ocrPages: number, chunkCount: number, warnings: string[] } | null,
 *   error: string | null,
 *   analyze: (blob: Blob) => Promise<void>,
 *   reset: () => Promise<void>,
 *   session: { sessionId: string, token: string } | null
 * }}
 */
export function useLocalAi() {
  const [state, setState] = useState('idle');
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  const sessionRef = useRef(null);
  const isMountedRef = useRef(true);

  const cleanupSession = useCallback(() => {
    if (sessionRef.current) {
      const activeSession = sessionRef.current;
      sessionRef.current = null;
      deleteSession(activeSession);
    }
  }, []);

  const reset = useCallback(() => {
    cleanupSession();
    if (isMountedRef.current) {
      setState('idle');
      setStats(null);
      setError(null);
    }
  }, [cleanupSession]);

  const analyze = useCallback(async (blob) => {
    if (!blob) {
      if (isMountedRef.current) {
        setError('No document provided for analysis.');
        setState('error');
      }
      return;
    }

    if (isMountedRef.current) {
      setState('checking');
      setError(null);
    }

    // 1. Probe local AI health and model readiness
    const health = await checkHealth();
    if (!isMountedRef.current) return;

    if (!health.online) {
      setState('offline');
      setError('Local AI service is offline. Please start the service to enable document analysis.');
      return;
    }

    if (!health.modelsReady) {
      setState('offline');
      setError('Local AI models are not downloaded. Please run the model download script.');
      return;
    }

    // 2. Prepare session and ingest
    setState('analyzing');

    try {
      // Clear any prior session
      await cleanupSession();

      const newSession = await createSession();
      sessionRef.current = newSession;

      const result = await ingestDocument(newSession, blob);
      if (!isMountedRef.current) return;

      setStats({
        pageCount: result.pageCount,
        ocrPages: result.ocrPages,
        chunkCount: result.chunkCount,
        warnings: result.warnings
      });
      setState('indexed');
    } catch (err) {
      if (!isMountedRef.current) return;

      let safeMessage = err.message || 'Failed to analyze document with local AI.';
      if (err instanceof LocalAiError) {
        if (err.status === 413) {
          safeMessage = 'Document exceeds permitted size limit.';
        } else if (err.status === 415) {
          safeMessage = 'Unsupported document format.';
        } else if (err.status === 422) {
          safeMessage = 'Failed to extract text from document.';
        } else if (err.status === 504) {
          safeMessage = 'Analysis timed out.';
        }
      }

      setError(safeMessage);
      setState('error');
    }
  }, [cleanupSession]);

  // Handle unmount and pagehide lifecycle cleanup
  useEffect(() => {
    isMountedRef.current = true;

    const handlePageHide = () => {
      if (sessionRef.current) {
        const activeSession = sessionRef.current;
        sessionRef.current = null;
        deleteSession(activeSession);
      }
    };

    window.addEventListener('pagehide', handlePageHide);

    return () => {
      isMountedRef.current = false;
      window.removeEventListener('pagehide', handlePageHide);
      if (sessionRef.current) {
        const activeSession = sessionRef.current;
        sessionRef.current = null;
        deleteSession(activeSession);
      }
    };
  }, []);

  return {
    state,
    stats,
    error,
    analyze,
    reset,
    get session() {
      if (!sessionRef.current) return null;
      return {
        get sessionId() {
          return sessionRef.current?.sessionId;
        },
        get token() {
          return sessionRef.current?.token;
        },
        toJSON: () => undefined,
        toString: () => '[OpaqueSession]'
      };
    }
  };
}
