import { useState, useEffect, useCallback } from 'react';
import { request, ApiError } from '../api/http.js';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  generateVaultKey,
  saveKey,
  getKey
} from '../crypto/vaultKeys.js';

/**
 * Custom hook managing the user's browser-bound ECDH vault key lifecycle:
 * - Checks server status via GET /api/keys/me and reconciles with local IndexedDB.
 * - Detects 'none' (not configured), 'ready' (matching local key), or 'mismatch' (server has key not in this browser).
 * - Generates and registers new key pairs with step-up MFA verification via PUT /api/keys/me.
 *
 * @returns {{
 *   status: 'loading' | 'none' | 'ready' | 'mismatch',
 *   fingerprint: string | null,
 *   createAndRegister: (code: string) => Promise<object>,
 *   error: string | null,
 *   refresh: () => Promise<void>
 * }}
 */
export function useVaultKey() {
  const { user } = useAuth();
  const userId = user?.id || user?._id;

  const [status, setStatus] = useState('loading');
  const [fingerprint, setFingerprint] = useState(null);
  const [error, setError] = useState(null);

  const checkStatus = useCallback(async () => {
    if (!userId) {
      setStatus('none');
      setFingerprint(null);
      return;
    }

    try {
      const serverRes = await request('/api/keys/me');

      if (!serverRes || !serverRes.registered || !serverRes.keyId) {
        setStatus('none');
        setFingerprint(null);
        return;
      }

      // Check if this browser holds the matching private key in IndexedDB
      const localKey = await getKey(userId, serverRes.keyId);

      if (localKey && localKey.privateKey) {
        setStatus('ready');
        setFingerprint(serverRes.fingerprint);
      } else {
        setStatus('mismatch');
        setFingerprint(serverRes.fingerprint);
      }
    } catch (err) {
      setStatus('none');
      setFingerprint(null);
    }
  }, [userId]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const createAndRegister = async (code) => {
    setError(null);

    const trimmedCode = String(code || '').trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      const msg = 'Please enter a valid 6-digit authenticator code.';
      setError(msg);
      throw new Error(msg);
    }

    if (!userId) {
      const msg = 'User session is not authenticated.';
      setError(msg);
      throw new Error(msg);
    }

    // 1. Generate local ECDH P-256 key pair (private key is non-extractable)
    const keyData = await generateVaultKey();

    try {
      // 2. Submit public key to backend with step-up MFA code
      const response = await request('/api/keys/me', {
        method: 'PUT',
        body: {
          publicKey: keyData.publicB64Url,
          code: trimmedCode
        }
      });

      // 3. Save locally in IndexedDB ONLY AFTER the server has confirmed acceptance
      await saveKey(userId, {
        keyId: keyData.keyId,
        privateKey: keyData.privateKey,
        publicRaw: keyData.publicRaw
      });

      setStatus('ready');
      setFingerprint(response.fingerprint || keyData.fingerprint);
      setError(null);
      return response;
    } catch (err) {
      let mappedError = 'Failed to register vault key. Please try again.';

      if (err instanceof ApiError) {
        if (err.status === 401) {
          mappedError = 'Invalid or used code. Wait for the next code.';
        } else if (err.status === 423) {
          mappedError = 'Account is temporarily locked due to too many failed attempts. Please try again later.';
        } else if (err.status === 429) {
          mappedError = 'Too many requests. Please wait a moment before trying again.';
        } else if (err.message) {
          mappedError = err.message;
        }
      } else if (err.message) {
        mappedError = err.message;
      }

      setError(mappedError);
      throw new Error(mappedError);
    }
  };

  return {
    status,
    fingerprint,
    createAndRegister,
    error,
    refresh: checkStatus
  };
}
