import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { request } from '../api/http.js';
import { SocketContext } from '../realtime/SocketContext.jsx';

/**
 * Normalizes document metadata across GET API responses and 'document:sealed' socket payloads.
 *
 * @param {object} item
 * @returns {object|null}
 */
export function normalizeDoc(item) {
  if (!item) return null;
  const id = item.id || item._id || item.documentId;
  if (!id) return null;

  return {
    id: String(id),
    originalName: item.originalName || 'Untitled Document',
    mimeType: item.mimeType || 'application/octet-stream',
    sizeBytes: item.sizeBytes ?? 0,
    status: item.status || 'sealed',
    delivery: item.delivery || 'qr',
    policy: item.policy || {
      expiresAt: item.expiresAt ?? null,
      oneTimeUse: Boolean(item.oneTimeUse),
      geofence: item.hasGeofence ? {} : null
    },
    sender: item.senderName || item.sender || 'Unknown',
    receiver: item.receiver || null,
    hasGeofence: Boolean(item.hasGeofence || item.policy?.geofence || item.policy?.hasGeofence),
    keyEnvelope: item.keyEnvelope || null,
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || item.createdAt || new Date().toISOString()
  };
}

/**
 * Deduplicates an array of document records by ID, preserving the order of first occurrence.
 *
 * @param {Array<object>} list
 * @returns {Array<object>}
 */
export function deduplicateDocs(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const deduped = [];

  for (const item of list) {
    const norm = normalizeDoc(item);
    if (norm && !seen.has(norm.id)) {
      seen.add(norm.id);
      deduped.push(norm);
    }
  }

  return deduped;
}

/**
 * Hook to manage sent and received documents for the authenticated user.
 * Automatically fetches on mount, refetches on socket reconnection,
 * and exposes an addReceived callback for real-time socket events.
 *
 * @returns {{
 *   sent: Array<object>,
 *   received: Array<object>,
 *   loading: boolean,
 *   error: string|null,
 *   refresh: () => Promise<void>,
 *   addReceived: (doc: object) => void
 * }}
 */
export function useDocuments() {
  const [sent, setSent] = useState([]);
  const [received, setReceived] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const socketContext = useContext(SocketContext);
  const hasMounted = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [sentRes, receivedRes] = await Promise.all([
        request('/api/documents/sent'),
        request('/api/documents/received')
      ]);

      const sentDocs = Array.isArray(sentRes?.documents) ? sentRes.documents : [];
      const receivedDocs = Array.isArray(receivedRes?.documents) ? receivedRes.documents : [];

      setSent(deduplicateDocs(sentDocs));
      setReceived(deduplicateDocs(receivedDocs));
    } catch (err) {
      setError(err.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, []);

  const addReceived = useCallback((doc) => {
    const norm = normalizeDoc(doc);
    if (!norm) return;

    setReceived((prev) => {
      if (prev.some((d) => d.id === norm.id)) {
        return prev;
      }
      return [norm, ...prev];
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!socketContext || typeof socketContext.on !== 'function') return;

    const unsubscribe = socketContext.on('connect', () => {
      if (hasMounted.current) {
        refresh();
      }
    });

    hasMounted.current = true;
    return () => {
      unsubscribe();
    };
  }, [socketContext, refresh]);

  return {
    sent,
    received,
    loading,
    error,
    refresh,
    addReceived
  };
}

export default useDocuments;
