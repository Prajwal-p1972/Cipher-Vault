/**
 * Base64URL string encoder (browser and node safe).
 *
 * @param {string} str
 * @returns {string}
 */
function toBase64Url(str) {
  let base64;
  if (typeof btoa === 'function') {
    base64 = btoa(str);
  } else {
    base64 = Buffer.from(str, 'utf8').toString('base64');
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64URL string decoder (browser and node safe).
 *
 * @param {string} b64url
 * @returns {string}
 */
function fromBase64Url(b64url) {
  let base64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  if (typeof atob === 'function') {
    return atob(base64);
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Encodes document envelope ID and decryption key into a compact, versioned QR payload string.
 * Format: "CV1." + base64url(JSON { v: 1, d, k })
 *
 * @param {{ documentId: string, documentKey: string }} params
 * @returns {string}
 */
export function encodePayload({ documentId, documentKey }) {
  if (typeof documentId !== 'string' || !/^[a-f0-9]{24}$/.test(documentId)) {
    throw new Error('Invalid documentId format');
  }
  if (typeof documentKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(documentKey)) {
    throw new Error('Invalid documentKey format');
  }

  const payloadObj = {
    v: 1,
    d: documentId,
    k: documentKey
  };

  const jsonStr = JSON.stringify(payloadObj);
  return `CV1.${toBase64Url(jsonStr)}`;
}

/**
 * Strictly parses and validates a scanned QR payload string.
 * Must match prefix "CV1.", valid base64url, valid JSON, v === 1,
 * 24-character hex ObjectId 'd', 43-character base64url key 'k', and no extra properties.
 *
 * @param {string} text
 * @returns {{ documentId: string, documentKey: string }}
 */
export function parsePayload(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > 200) {
    throw new Error('Invalid QR code');
  }

  if (!text.startsWith('CV1.')) {
    throw new Error('Invalid QR code');
  }

  const b64url = text.slice(4);
  if (!b64url || !/^[A-Za-z0-9_-]+$/.test(b64url)) {
    throw new Error('Invalid QR code');
  }

  let data;
  try {
    const jsonStr = fromBase64Url(b64url);
    data = JSON.parse(jsonStr);
  } catch (_) {
    throw new Error('Invalid QR code');
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid QR code');
  }

  const keys = Object.keys(data);
  if (keys.length !== 3) {
    throw new Error('Invalid QR code');
  }

  if (!keys.includes('v') || !keys.includes('d') || !keys.includes('k')) {
    throw new Error('Invalid QR code');
  }

  if (data.v !== 1) {
    throw new Error('Invalid QR code');
  }

  if (typeof data.d !== 'string' || !/^[a-f0-9]{24}$/.test(data.d)) {
    throw new Error('Invalid QR code');
  }

  if (typeof data.k !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.k)) {
    throw new Error('Invalid QR code');
  }

  return {
    documentId: data.d,
    documentKey: data.k
  };
}
