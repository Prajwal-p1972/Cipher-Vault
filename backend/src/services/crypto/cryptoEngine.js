import crypto from 'node:crypto';
import { canonicalJson } from '../../utils/canonicalJson.js';
import { hmacSha256, sha256Hex, safeEqualHex } from '../../utils/crypto.js';

const MAX_RECENT_IVS = 100000;
const HKDF_SALT = Buffer.from('cipher-vault/v1', 'utf8');
const HKDF_INFO_ENC = Buffer.from('enc', 'utf8');
const HKDF_INFO_MAC = Buffer.from('mac', 'utf8');

/**
 * Process-wide bounded in-memory Set of recent IV hexes.
 * Evicts oldest when exceeding MAX_RECENT_IVS (100,000).
 *
 * NOTE: Each document utilizes a unique, randomly-generated document key (docKey),
 * which mathematically prevents (key, IV) reuse across documents even in the event of an IV collision.
 * Furthermore, 96-bit random IVs have a negligible collision probability (birthday bound ~2^48).
 * This process-wide collision guard serves as an additional defense-in-depth measure against
 * potential entropy degradation or CSPRNG failures.
 */
const recentIvs = new Set();

/**
 * Generates a cryptographically secure 32-byte document encryption key.
 *
 * @returns {Buffer} 32-byte key Buffer
 */
export function generateDocumentKey() {
  return crypto.randomBytes(32);
}

/**
 * Derives distinct encryption and MAC keys from a document key using HKDF-SHA256.
 *
 * @param {Buffer} docKey - 32-byte document key Buffer
 * @returns {{ encKey: Buffer, macKey: Buffer }} Distinct 32-byte keys
 */
export function deriveKeys(docKey) {
  if (!Buffer.isBuffer(docKey) || docKey.length !== 32) {
    throw new TypeError('docKey must be a 32-byte Buffer');
  }

  const encKeyRaw = crypto.hkdfSync('sha256', docKey, HKDF_SALT, HKDF_INFO_ENC, 32);
  const macKeyRaw = crypto.hkdfSync('sha256', docKey, HKDF_SALT, HKDF_INFO_MAC, 32);

  return {
    encKey: Buffer.from(encKeyRaw),
    macKey: Buffer.from(macKeyRaw)
  };
}

/**
 * Builds deterministic Additional Authenticated Data (AAD) Buffer from required metadata fields.
 *
 * @param {{
 *   docId: string,
 *   senderId: string,
 *   receiverId: string,
 *   mimeType: string,
 *   sizeBytes: number,
 *   policyHash: string
 * }} fields
 * @returns {Buffer} Canonical JSON representation as UTF-8 Buffer
 */
export function buildAad(fields) {
  if (!fields || typeof fields !== 'object') {
    throw new TypeError('AAD fields object is required');
  }

  const required = ['docId', 'senderId', 'receiverId', 'mimeType', 'sizeBytes', 'policyHash'];
  for (const field of required) {
    if (fields[field] === undefined || fields[field] === null) {
      throw new Error(`Missing required AAD field: ${field}`);
    }
  }

  const payload = {
    docId: fields.docId,
    senderId: fields.senderId,
    receiverId: fields.receiverId,
    mimeType: fields.mimeType,
    sizeBytes: fields.sizeBytes,
    policyHash: fields.policyHash
  };

  return Buffer.from(canonicalJson(payload), 'utf8');
}

/**
 * Securely zeros memory of a sensitive buffer.
 *
 * @param {Buffer} buffer - Buffer to wipe
 */
export function wipe(buffer) {
  if (Buffer.isBuffer(buffer)) {
    buffer.fill(0);
  }
}

/**
 * Computes deterministic SHA-256 hex digest of a policy object.
 *
 * @param {object} policy - Policy object
 * @returns {string} Hex SHA-256 string
 */
export function policyHash(policy) {
  return sha256Hex(canonicalJson(policy));
}

/**
 * Encrypts and authenticates a plaintext buffer using AES-256-GCM + HMAC-SHA256 (Encrypt-then-MAC).
 *
 * @param {Buffer} plaintextBuffer - Raw data to encrypt
 * @param {Buffer} docKey - 32-byte document encryption key
 * @param {object|Buffer} aadFields - AAD fields object or pre-built AAD Buffer
 * @returns {{
 *   ciphertext: Buffer,
 *   iv: Buffer,
 *   authTag: Buffer,
 *   hmac: string,
 *   ciphertextSha256: string,
 *   algorithm: 'aes-256-gcm'
 * }}
 */
export function sealBuffer(plaintextBuffer, docKey, aadFields) {
  if (!Buffer.isBuffer(plaintextBuffer)) {
    throw new TypeError('plaintextBuffer must be a Buffer');
  }
  if (!Buffer.isBuffer(docKey) || docKey.length !== 32) {
    throw new TypeError('docKey must be a 32-byte Buffer');
  }

  const aadBuffer = Buffer.isBuffer(aadFields) ? aadFields : buildAad(aadFields);
  const { encKey, macKey } = deriveKeys(docKey);

  try {
    const iv = crypto.randomBytes(12);
    const ivHex = iv.toString('hex');

    if (recentIvs.has(ivHex)) {
      throw new Error('IV collision detected');
    }

    if (recentIvs.size >= MAX_RECENT_IVS) {
      const oldest = recentIvs.values().next().value;
      recentIvs.delete(oldest);
    }
    recentIvs.add(ivHex);

    const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
    cipher.setAAD(aadBuffer);

    const ciphertext = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const macPayload = Buffer.concat([iv, authTag, ciphertext, aadBuffer]);
    const hmac = hmacSha256(macKey, macPayload);
    const ciphertextSha256 = sha256Hex(ciphertext);

    return {
      ciphertext,
      iv,
      authTag,
      hmac,
      ciphertextSha256,
      algorithm: 'aes-256-gcm'
    };
  } finally {
    wipe(encKey);
    wipe(macKey);
  }
}

/**
 * Verifies authenticity and decrypts ciphertext using AES-256-GCM.
 * Enforces strict order of operations: HMAC verification occurs BEFORE any decipher construction.
 * All verification/decryption errors throw an identical generic error message.
 *
 * @param {{
 *   ciphertext: Buffer,
 *   iv: Buffer,
 *   authTag: Buffer,
 *   hmac: string|Buffer
 * }} sealedData
 * @param {Buffer} docKey - 32-byte document encryption key
 * @param {object|Buffer} aadFields - AAD fields object or pre-built AAD Buffer
 * @returns {Buffer} Decrypted plaintext buffer
 */
export function openBuffer(sealedData, docKey, aadFields) {
  let encKey = null;
  let macKey = null;

  try {
    if (!sealedData || typeof sealedData !== 'object') {
      throw new Error('Integrity check failed');
    }

    const { ciphertext, iv, authTag, hmac } = sealedData;

    if (!Buffer.isBuffer(ciphertext)) {
      throw new Error('Integrity check failed');
    }

    if (!Buffer.isBuffer(iv) || iv.length !== 12) {
      throw new Error('Integrity check failed');
    }

    if (!Buffer.isBuffer(authTag) || authTag.length !== 16) {
      throw new Error('Integrity check failed');
    }

    let hmacHex;
    if (typeof hmac === 'string') {
      if (hmac.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(hmac)) {
        throw new Error('Integrity check failed');
      }
      hmacHex = hmac.toLowerCase();
    } else if (Buffer.isBuffer(hmac)) {
      if (hmac.length !== 32) {
        throw new Error('Integrity check failed');
      }
      hmacHex = hmac.toString('hex').toLowerCase();
    } else {
      throw new Error('Integrity check failed');
    }

    if (!Buffer.isBuffer(docKey) || docKey.length !== 32) {
      throw new Error('Integrity check failed');
    }

    const aadBuffer = Buffer.isBuffer(aadFields) ? aadFields : buildAad(aadFields);

    const keys = deriveKeys(docKey);
    encKey = keys.encKey;
    macKey = keys.macKey;

    // Step 1: Recompute and timing-safe compare HMAC BEFORE any decryption
    const macPayload = Buffer.concat([iv, authTag, ciphertext, aadBuffer]);
    const computedHmac = hmacSha256(macKey, macPayload);

    if (!safeEqualHex(computedHmac, hmacHex)) {
      throw new Error('Integrity check failed');
    }

    // Step 2: AES-GCM decrypt and verify auth tag
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, iv);
    decipher.setAAD(aadBuffer);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext;
  } catch (err) {
    throw new Error('Integrity check failed');
  } finally {
    if (encKey) wipe(encKey);
    if (macKey) wipe(macKey);
  }
}
