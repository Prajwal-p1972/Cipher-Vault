/**
 * ==============================================================================
 * SHARED CONTRACT (the frontend implements the receiving side with Web Crypto; match it EXACTLY)
 * - Receiver key: ECDH P-256. publicKey = raw uncompressed point (65 bytes, 0x04||X||Y), base64url.
 *   keyId = lowercase hex SHA-256 of those 65 raw bytes. fingerprint = first 32 hex chars of keyId in 8 groups of 4.
 * - Envelope (stored on the document): { v:1, alg:'ECDH-P256-HKDF-SHA256-A256GCM', recipientKeyId,
 *   epk (base64url raw 65 bytes), salt (base64url, 32 bytes), iv (base64url, 12 bytes),
 *   ct (base64url of ciphertext||16-byte GCM tag; 48 bytes for a 32-byte key) }.
 * - Wrapping: ephemeral ECDH P-256 key pair per document; shared = ECDH(ephemeralPrivate, recipientPublic)
 *   (32 bytes); info = utf8('cipher-vault/keywrap/v1|' + docId + '|' + receiverId + '|' + recipientKeyId);
 *   kek = HKDF-SHA256(ikm=shared, salt=salt, info=info, L=32); ct = AES-256-GCM(kek, iv, plaintext = the 32-byte
 *   document key, aad = info bytes). Wipe shared, kek, and the document key afterwards.
 * ==============================================================================
 */

import crypto from 'crypto';
import { AppError } from '../../utils/errors.js';

/**
 * Validates a receiver's raw uncompressed ECDH P-256 public key (base64url).
 * Ensures exactly 65 bytes, first byte 0x04, and the point is on the curve.
 * Rejects invalid keys with a generic 400 bad request error.
 *
 * @param {string} rawB64Url
 * @returns {Buffer} The 65-byte raw uncompressed public key buffer
 */
export function validatePublicKey(rawB64Url) {
  if (typeof rawB64Url !== 'string' || !rawB64Url.trim() || !/^[A-Za-z0-9_-]+$/.test(rawB64Url)) {
    throw AppError.badRequest('Invalid public key');
  }

  let buf;
  try {
    buf = Buffer.from(rawB64Url, 'base64url');
  } catch (_) {
    throw AppError.badRequest('Invalid public key');
  }

  if (buf.length !== 65 || buf[0] !== 0x04) {
    throw AppError.badRequest('Invalid public key');
  }

  try {
    const throwaway = crypto.createECDH('prime256v1');
    throwaway.generateKeys();
    throwaway.computeSecret(buf);
  } catch (_) {
    throw AppError.badRequest('Invalid public key');
  }

  return buf;
}

/**
 * Computes lowercase hex SHA-256 of the 65 raw public key bytes.
 *
 * @param {Buffer|string} raw
 * @returns {string} 64-character lowercase hex string
 */
export function computeKeyId(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'base64url');
  return crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
}

/**
 * Formats first 32 hex chars of keyId into 8 groups of 4 separated by spaces.
 *
 * @param {string} keyId
 * @returns {string} Formatted fingerprint
 */
export function fingerprintOf(keyId) {
  if (typeof keyId !== 'string' || keyId.length < 32) {
    throw AppError.badRequest('Invalid keyId for fingerprint');
  }
  return keyId.slice(0, 32).toLowerCase().match(/.{1,4}/g).join(' ');
}

/**
 * Validates the shape and field constraints of a key envelope.
 *
 * @param {object} env
 * @returns {boolean}
 */
export function assertEnvelopeShape(env) {
  if (!env || typeof env !== 'object') {
    throw AppError.badRequest('Invalid key envelope');
  }
  if (env.v !== 1) {
    throw AppError.badRequest('Invalid key envelope version');
  }
  if (env.alg !== 'ECDH-P256-HKDF-SHA256-A256GCM') {
    throw AppError.badRequest('Invalid key envelope algorithm');
  }
  if (typeof env.recipientKeyId !== 'string' || !/^[0-9a-f]{64}$/.test(env.recipientKeyId)) {
    throw AppError.badRequest('Invalid recipientKeyId in envelope');
  }
  if (typeof env.epk !== 'string') {
    throw AppError.badRequest('Invalid epk in envelope');
  }
  try {
    const epkBuf = Buffer.from(env.epk, 'base64url');
    if (epkBuf.length !== 65 || epkBuf[0] !== 0x04) {
      throw AppError.badRequest('Invalid epk in envelope');
    }
  } catch (_) {
    throw AppError.badRequest('Invalid epk in envelope');
  }
  if (typeof env.salt !== 'string' || Buffer.from(env.salt, 'base64url').length !== 32) {
    throw AppError.badRequest('Invalid salt in envelope');
  }
  if (typeof env.iv !== 'string' || Buffer.from(env.iv, 'base64url').length !== 12) {
    throw AppError.badRequest('Invalid iv in envelope');
  }
  if (typeof env.ct !== 'string' || Buffer.from(env.ct, 'base64url').length !== 48) {
    throw AppError.badRequest('Invalid ct in envelope');
  }
  return true;
}

/**
 * Wraps a 32-byte document key using ephemeral ECDH P-256 + HKDF-SHA256 + AES-256-GCM.
 * Securely wipes sensitive memory buffers afterwards.
 *
 * @param {{
 *   docKey: Buffer|string,
 *   recipientPublicB64Url: string,
 *   recipientKeyId: string,
 *   docId: string,
 *   receiverId: string
 * }} params
 * @returns {object} The encrypted key envelope
 */
export function wrapDocumentKey({ docKey, recipientPublicB64Url, recipientKeyId, docId, receiverId }) {
  const recipientPublicBuf = validatePublicKey(recipientPublicB64Url);

  const keyBuf = Buffer.isBuffer(docKey) ? Buffer.from(docKey) : Buffer.from(docKey, 'base64url');
  if (keyBuf.length !== 32) {
    throw AppError.badRequest('Invalid document key length');
  }

  // 1) Ephemeral ECDH P-256 key pair
  const ephemeral = crypto.createECDH('prime256v1');
  ephemeral.generateKeys();
  const epkBuf = ephemeral.getPublicKey();
  const epk = epkBuf.toString('base64url');

  // 2) Shared secret
  const shared = ephemeral.computeSecret(recipientPublicBuf);

  // 3) Random 32-byte salt and 12-byte IV
  const saltBuf = crypto.randomBytes(32);
  const salt = saltBuf.toString('base64url');
  const ivBuf = crypto.randomBytes(12);
  const iv = ivBuf.toString('base64url');

  // 4) AAD / Info string
  const infoStr = 'cipher-vault/keywrap/v1|' + docId + '|' + receiverId + '|' + recipientKeyId;
  const info = Buffer.from(infoStr, 'utf8');

  // 5) KEK derivation via HKDF-SHA256
  const kek = Buffer.from(crypto.hkdfSync('sha256', shared, saltBuf, info, 32));

  let ct;
  try {
    // 6) AES-256-GCM authenticated encryption
    const cipher = crypto.createCipheriv('aes-256-gcm', kek, ivBuf);
    cipher.setAAD(info);
    const ctPart = cipher.update(keyBuf);
    const finalPart = cipher.final();
    const tag = cipher.getAuthTag();
    ct = Buffer.concat([ctPart, finalPart, tag]).toString('base64url');
  } finally {
    // 7) Wipe sensitive material from memory
    shared.fill(0);
    kek.fill(0);
    keyBuf.fill(0);
    if (Buffer.isBuffer(docKey)) {
      docKey.fill(0);
    }
  }

  const envelope = {
    v: 1,
    alg: 'ECDH-P256-HKDF-SHA256-A256GCM',
    recipientKeyId,
    epk,
    salt,
    iv,
    ct
  };

  assertEnvelopeShape(envelope);
  return envelope;
}
