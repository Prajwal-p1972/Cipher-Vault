/**
 * ECDH P-256 Vault Key Management & Key Wrapping (Phase 7).
 *
 * Implements non-extractable client-side private key generation,
 * persistent storage in IndexedDB ('cipher-vault-keys'),
 * keyId & fingerprint computation, and Web Crypto envelope unwrapping.
 */

const DB_NAME = 'cipher-vault-keys';
const DB_VERSION = 1;
const STORE_NAME = 'keys';

/**
 * Encodes a Uint8Array into a base64url string (RFC 4648 §5).
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64Url(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodes a base64url string into a Uint8Array.
 *
 * @param {string} b64url
 * @returns {Uint8Array}
 */
export function base64UrlToBytes(b64url) {
  if (typeof b64url !== 'string') {
    throw new TypeError('base64url input must be a string');
  }
  let base64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const binary = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encodes a UTF-8 string into a Uint8Array.
 *
 * @param {string} str
 * @returns {Uint8Array}
 */
export function utf8ToBytes(str) {
  return new TextEncoder().encode(str);
}

/**
 * Computes lowercase hex string from a Uint8Array.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex.toLowerCase();
}

/**
 * Computes lowercase hex SHA-256 of raw 65-byte uncompressed public key.
 *
 * @param {Uint8Array|ArrayBuffer} rawBytes
 * @returns {Promise<string>} 64-character lowercase hex string
 */
export async function keyIdOf(rawBytes) {
  const cryptoObj = globalThis.crypto || window.crypto;
  const hashBuffer = await cryptoObj.subtle.digest('SHA-256', rawBytes);
  return bytesToHex(new Uint8Array(hashBuffer));
}

/**
 * Formats first 32 hex chars of keyId into 8 groups of 4 separated by spaces.
 *
 * @param {string} keyId
 * @returns {string}
 */
export function fingerprintOf(keyId) {
  if (typeof keyId !== 'string' || keyId.length < 32) {
    throw new Error('Invalid keyId for fingerprint');
  }
  const clean = keyId.replace(/\s+/g, '').toLowerCase().slice(0, 32);
  const groups = clean.match(/.{1,4}/g);
  return groups ? groups.join(' ') : clean;
}

/**
 * Opens the IndexedDB database for vault keys.
 *
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  const idb = globalThis.indexedDB || window.indexedDB;
  if (!idb) {
    return Promise.reject(new Error('IndexedDB is not supported in this environment'));
  }

  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: ['userId', 'keyId'] });
        store.createIndex('userId', 'userId', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open vault key database'));
  });
}

/**
 * Generates an ECDH P-256 key pair.
 * Private key is non-extractable and never leaves the browser.
 * Public key is exported in raw uncompressed format (65 bytes, 0x04||X||Y).
 *
 * @returns {Promise<{
 *   keyId: string,
 *   privateKey: CryptoKey,
 *   publicKey: CryptoKey,
 *   publicRaw: Uint8Array,
 *   publicB64Url: string,
 *   fingerprint: string
 * }>}
 */
export async function generateVaultKey() {
  const cryptoObj = globalThis.crypto || window.crypto;
  const keyPair = await cryptoObj.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256'
    },
    false, // Private key is strictly NON-EXTRACTABLE
    ['deriveBits', 'deriveKey']
  );

  const rawBuffer = await cryptoObj.subtle.exportKey('raw', keyPair.publicKey);
  const publicRaw = new Uint8Array(rawBuffer);
  const publicB64Url = bytesToBase64Url(publicRaw);
  const keyId = await keyIdOf(publicRaw);
  const fingerprint = fingerprintOf(keyId);

  return {
    keyId,
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicRaw,
    publicB64Url,
    fingerprint
  };
}

/**
 * Saves a vault key in IndexedDB under the specified userId.
 * Note: Old keys are NEVER deleted on rotation so historical documents remain openable.
 *
 * @param {string} userId
 * @param {{ keyId: string, privateKey: CryptoKey, publicRaw: Uint8Array }} keyRecord
 * @returns {Promise<void>}
 */
export async function saveKey(userId, { keyId, privateKey, publicRaw }) {
  if (!userId) {
    throw new Error('userId is required to save vault key');
  }
  if (!keyId || !privateKey) {
    throw new Error('keyId and privateKey are required to save vault key');
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const record = {
      userId: String(userId),
      keyId,
      privateKey,
      publicRaw: publicRaw ? new Uint8Array(publicRaw) : null,
      createdAt: Date.now()
    };

    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error('Failed to save vault key'));
  });
}

/**
 * Retrieves a specific vault key by keyId for a user from IndexedDB.
 *
 * @param {string} userId
 * @param {string} keyId
 * @returns {Promise<{ keyId: string, privateKey: CryptoKey, publicRaw: Uint8Array }|null>}
 */
export async function getKey(userId, keyId) {
  if (!userId || !keyId) return null;

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get([String(userId), String(keyId)]);

    req.onsuccess = () => {
      resolve(req.result || null);
    };
    req.onerror = () => reject(req.error || new Error('Failed to load vault key'));
  });
}

/**
 * Lists all keyIds stored locally for a given user.
 *
 * @param {string} userId
 * @returns {Promise<string[]>}
 */
export async function listKeyIds(userId) {
  if (!userId) return [];

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('userId');
    const req = index.getAll(IDBKeyRange.only(String(userId)));

    req.onsuccess = () => {
      const records = req.result || [];
      resolve(records.map((r) => r.keyId));
    };
    req.onerror = () => reject(req.error || new Error('Failed to list vault keys'));
  });
}

/**
 * Unwraps an encrypted document key using the locally stored ECDH P-256 private key.
 * Strictly throws the generic error 'Cannot unlock this document on this device' on any failure.
 *
 * @param {{
 *   envelope: {
 *     v: number,
 *     alg: string,
 *     recipientKeyId: string,
 *     epk: string,
 *     salt: string,
 *     iv: string,
 *     ct: string
 *   },
 *   docId: string,
 *   receiverId: string,
 *   userId: string
 * }} params
 * @returns {Promise<string>} The unwrapped 32-byte document key as a base64url string
 */
export async function unwrapDocumentKey({ envelope, docId, receiverId, userId }) {
  const GENERIC_ERROR = 'Cannot unlock this document on this device';

  try {
    if (!envelope || typeof envelope !== 'object') {
      throw new Error(GENERIC_ERROR);
    }
    if (envelope.v !== 1 || envelope.alg !== 'ECDH-P256-HKDF-SHA256-A256GCM') {
      throw new Error(GENERIC_ERROR);
    }
    if (!envelope.recipientKeyId || !envelope.epk || !envelope.salt || !envelope.iv || !envelope.ct) {
      throw new Error(GENERIC_ERROR);
    }
    if (!docId || !receiverId || !userId) {
      throw new Error(GENERIC_ERROR);
    }

    const keyRecord = await getKey(userId, envelope.recipientKeyId);
    if (!keyRecord || !keyRecord.privateKey) {
      throw new Error(GENERIC_ERROR);
    }

    const cryptoObj = globalThis.crypto || window.crypto;

    // 1. Import ephemeral public key (raw 65 bytes)
    const epkBytes = base64UrlToBytes(envelope.epk);
    if (epkBytes.length !== 65 || epkBytes[0] !== 0x04) {
      throw new Error(GENERIC_ERROR);
    }

    const epkKey = await cryptoObj.subtle.importKey(
      'raw',
      epkBytes,
      {
        name: 'ECDH',
        namedCurve: 'P-256'
      },
      false,
      []
    );

    // 2. Derive 256 shared secret bits via ECDH
    const sharedBits = await cryptoObj.subtle.deriveBits(
      {
        name: 'ECDH',
        public: epkKey
      },
      keyRecord.privateKey,
      256
    );

    // 3. Import shared bits as HKDF Initial Keying Material (IKM)
    const ikm = await cryptoObj.subtle.importKey(
      'raw',
      sharedBits,
      'HKDF',
      false,
      ['deriveKey']
    );

    // 4. Construct AAD / Info string
    const infoStr = 'cipher-vault/keywrap/v1|' + String(docId) + '|' + String(receiverId) + '|' + String(envelope.recipientKeyId);
    const infoBytes = utf8ToBytes(infoStr);
    const saltBytes = base64UrlToBytes(envelope.salt);

    // 5. Derive AES-256-GCM Key Encryption Key (KEK) via HKDF-SHA256
    const kek = await cryptoObj.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: saltBytes,
        info: infoBytes
      },
      ikm,
      {
        name: 'AES-GCM',
        length: 256
      },
      false,
      ['decrypt']
    );

    // 6. Decrypt ciphertext + tag (48 bytes) with AES-256-GCM and AAD
    const ctBytes = base64UrlToBytes(envelope.ct);
    const ivBytes = base64UrlToBytes(envelope.iv);

    const decryptedBuffer = await cryptoObj.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivBytes,
        additionalData: infoBytes
      },
      kek,
      ctBytes
    );

    const docKeyBytes = new Uint8Array(decryptedBuffer);
    if (docKeyBytes.length !== 32) {
      throw new Error(GENERIC_ERROR);
    }

    return bytesToBase64Url(docKeyBytes);
  } catch (err) {
    throw new Error(GENERIC_ERROR);
  }
}
