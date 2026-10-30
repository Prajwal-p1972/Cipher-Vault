/**
 * Browser-side AES-256-GCM RAM decryption using the Web Crypto API.
 *
 * Security model:
 * - All key material lives exclusively in ephemeral JS variables and
 *   CryptoKey objects that are never extractable from memory.
 * - No intermediate data is written to disk, localStorage, or sessionStorage.
 * - Caller is responsible for zeroing input key strings after calling decryptInRAM.
 *
 * Wire format emitted by the backend crypto pipeline:
 *   ciphertext  = AES-256-GCM encrypted bytes (with gzip inside)
 *   authTag     = 16-byte GCM authentication tag (stored separately in MongoDB)
 *
 * The Web Crypto API requires the auth tag to be appended to the ciphertext
 * before passing to subtle.decrypt({ name: 'AES-GCM' }). This module handles
 * that concatenation internally.
 */

/**
 * Decodes a standard base64 string into a Uint8Array.
 *
 * @param {string} base64 - Standard base64 (may include + and / and = padding)
 * @returns {Uint8Array}
 */
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decodes a base64url string into a Uint8Array.
 * Converts base64url alphabet (- _) back to standard base64 (+ /) and
 * re-pads before calling atob.
 *
 * @param {string} base64url - URL-safe base64 without padding
 * @returns {Uint8Array}
 */
function base64UrlToBytes(base64url) {
  let std = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (std.length % 4 !== 0) {
    std += '=';
  }
  return base64ToBytes(std);
}

/**
 * Detects whether the input is base64url (no +, no /) or standard base64,
 * then decodes accordingly.
 *
 * @param {string} encoded
 * @returns {Uint8Array}
 */
function decodeKey(encoded) {
  const isBase64Url = /^[A-Za-z0-9_-]+$/.test(encoded.replace(/=+$/, ''));
  return isBase64Url ? base64UrlToBytes(encoded) : base64ToBytes(encoded);
}

/**
 * Imports a raw 32-byte AES-256 key into a non-extractable CryptoKey.
 *
 * @param {Uint8Array} keyBytes - Exactly 32 bytes
 * @returns {Promise<CryptoKey>}
 */
async function importAesKey(keyBytes) {
  return crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,         // non-extractable: key material cannot leave the engine
    ['decrypt']
  );
}

/**
 * Decrypts an AES-256-GCM encrypted Blob entirely in browser RAM.
 *
 * The backend stores the auth tag separately from the ciphertext. This
 * function re-concatenates them in the order required by the Web Crypto API:
 *   combinedData = ciphertext || authTag  (authTag appended at the end)
 *
 * The output Blob is the raw decrypted bytes. If the backend pipeline
 * compressed with gzip before encryption, the output will be a gzip stream.
 * Pass it to DecompressionStream or send it directly to the local AI service
 * which handles decompression internally.
 *
 * @param {Blob}   encryptedBlob - Raw AES-256-GCM ciphertext from the backend
 * @param {string} keyEncoded    - 32-byte AES key in base64 or base64url
 * @param {string} ivEncoded     - 12-byte IV in base64 or base64url
 * @param {string} authTagEncoded - 16-byte GCM auth tag in base64 or base64url
 * @returns {Promise<Blob>} Plaintext bytes as a Blob
 * @throws {DOMException} If authentication fails (tampered ciphertext or wrong key)
 */
export async function decryptInRAM(encryptedBlob, keyEncoded, ivEncoded, authTagEncoded) {
  const keyBytes     = decodeKey(keyEncoded);
  const ivBytes      = decodeKey(ivEncoded);
  const authTagBytes = decodeKey(authTagEncoded);

  if (keyBytes.length !== 32) {
    throw new Error(`Invalid AES key length: expected 32 bytes, got ${keyBytes.length}`);
  }
  if (ivBytes.length !== 12) {
    throw new Error(`Invalid IV length: expected 12 bytes, got ${ivBytes.length}`);
  }
  if (authTagBytes.length !== 16) {
    throw new Error(`Invalid auth tag length: expected 16 bytes, got ${authTagBytes.length}`);
  }

  const ciphertextBuffer = await encryptedBlob.arrayBuffer();
  const ciphertextBytes  = new Uint8Array(ciphertextBuffer);

  // Web Crypto AES-GCM: expects ciphertext with the 16-byte tag appended
  const combined = new Uint8Array(ciphertextBytes.length + authTagBytes.length);
  combined.set(ciphertextBytes, 0);
  combined.set(authTagBytes, ciphertextBytes.length);

  const cryptoKey = await importAesKey(keyBytes);

  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    cryptoKey,
    combined
  );

  return new Blob([plaintextBuffer]);
}

/**
 * Decrypts an AES-256-GCM encrypted Blob in RAM and decompresses the result
 * using the browser's native DecompressionStream (gzip).
 *
 * Use this variant when the backend pipeline applied gzip compression before
 * encryption (the production Cipher Vault pipeline always does this).
 *
 * @param {Blob}   encryptedBlob
 * @param {string} keyEncoded
 * @param {string} ivEncoded
 * @param {string} authTagEncoded
 * @param {string} [mimeType='application/octet-stream'] - MIME type for the resulting Blob
 * @returns {Promise<Blob>} Decompressed plaintext Blob
 */
export async function decryptAndDecompressInRAM(
  encryptedBlob,
  keyEncoded,
  ivEncoded,
  authTagEncoded,
  mimeType = 'application/octet-stream'
) {
  const compressedBlob = await decryptInRAM(
    encryptedBlob,
    keyEncoded,
    ivEncoded,
    authTagEncoded
  );

  const decompressedStream = compressedBlob
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));

  const decompressedBuffer = await new Response(decompressedStream).arrayBuffer();
  return new Blob([decompressedBuffer], { type: mimeType });
}
