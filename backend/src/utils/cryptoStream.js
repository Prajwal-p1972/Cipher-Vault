import crypto from 'crypto';
import zlib from 'zlib';

/**
 * Creates an AES-256-GCM encryption stream pipeline.
 * @returns {Object} { cipher, compressor, iv, key }
 */
export function createEncryptionStream() {
  const key = crypto.randomBytes(32); // 256-bit key
  const iv = crypto.randomBytes(12);  // 96-bit strictly random IV/nonce
  
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const compressor = zlib.createGzip();
  
  return { cipher, compressor, iv, key };
}

/**
 * Creates an AES-256-GCM decryption stream pipeline.
 * @param {Buffer} key - 32-byte decryption key
 * @param {Buffer} iv - 12-byte initialization vector
 * @param {Buffer} authTag - 16-byte authentication tag
 * @returns {Object} { decipher, decompressor }
 */
export function createDecryptionStream(key, iv, authTag) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decompressor = zlib.createGunzip();
  
  return { decipher, decompressor };
}
