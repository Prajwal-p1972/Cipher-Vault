import crypto from 'node:crypto';
import { env } from '../config/env.js';

let cachedMfaKey = null;

/**
 * Converts env.MFA_ENC_KEY into a cached 32-byte Buffer.
 *
 * @returns {Buffer} 32-byte key buffer
 */
export function getMfaKey() {
  if (!cachedMfaKey) {
    if (!env.MFA_ENC_KEY || env.MFA_ENC_KEY.length !== 64) {
      throw new TypeError('MFA_ENC_KEY must be exactly 64 hex characters (32 bytes)');
    }
    cachedMfaKey = Buffer.from(env.MFA_ENC_KEY, 'hex');
  }
  return cachedMfaKey;
}

/**
 * Authenticated symmetric encryption using AES-256-GCM.
 * Generates a fresh 12-byte random IV on every invocation.
 *
 * @param {string} plaintext - Plaintext to encrypt
 * @param {Buffer} key - 32-byte key Buffer
 * @returns {string} Sealed format: "iv.tag.ciphertext" (base64)
 */
export function secretBox(plaintext, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new TypeError('Key must be a 32-byte Buffer');
  }
  if (typeof plaintext !== 'string') {
    throw new TypeError('Plaintext must be a string');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64')}.${authTag.toString('base64')}.${ciphertext.toString('base64')}`;
}

/**
 * Decrypts and authenticates a sealed string.
 *
 * @param {string} sealedStr - "iv.tag.ciphertext" in base64
 * @param {Buffer} key - 32-byte key Buffer
 * @returns {string} Plaintext UTF-8 string
 */
export function unsealBox(sealedStr, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new TypeError('Key must be a 32-byte Buffer');
  }
  if (typeof sealedStr !== 'string') {
    throw new TypeError('Sealed string must be a string');
  }

  const parts = sealedStr.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed sealed ciphertext format');
  }

  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');

  if (iv.length !== 12) {
    throw new Error('Invalid IV length (must be 12 bytes)');
  }
  if (authTag.length !== 16) {
    throw new Error('Invalid auth tag length (must be 16 bytes)');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}

// Attach object methods for compatibility
secretBox.seal = (plaintext, key) =>
  secretBox(plaintext, Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex'));
secretBox.unseal = (sealedStr, key) =>
  unsealBox(sealedStr, Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex'));

/**
 * Computes HMAC-SHA256 signature in hex.
 *
 * @param {string|Buffer} key - Secret key
 * @param {string|Buffer} data - Message data
 * @returns {string} Hex string
 */
export function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

/**
 * Computes SHA-256 digest in hex.
 *
 * @param {string|Buffer} data - Data to hash
 * @returns {string} Hex string
 */
export function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export const hashSha256 = sha256Hex;

/**
 * Timing-safe hexadecimal equality check.
 * Returns false on length mismatch without throwing.
 *
 * @param {string} a - First hex string
 * @param {string} b - Second hex string
 * @returns {boolean} True if equal
 */
export function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');

  if (bufA.length !== bufB.length || bufA.length === 0) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}
