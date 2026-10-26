import { env } from '../config/env.js';

/**
 * Sanitizes an untrusted filename.
 * Strips path separators, control characters, and leading dots.
 * Collapses whitespace and limits length to 255 characters.
 *
 * NOTE: Never use safeName as a storage key on disk or in object storage.
 * Always generate random, opaque UUID-based storage keys.
 *
 * @param {string} name - Raw filename
 * @returns {string} Sanitized filename
 */
export function sanitizeFileName(name) {
  if (typeof name !== 'string') {
    return 'document';
  }

  let safe = name
    .replace(/[\x00-\x1f\x7f-\x9f]/g, '') // strip ASCII control chars
    .replace(/[/\\]/g, '')                 // strip path separators
    .trim()
    .replace(/^\.+/, '')                  // strip leading dots
    .replace(/\s+/g, ' ')                 // collapse multiple whitespace
    .trim();

  if (!safe) {
    return 'document';
  }

  return safe.slice(0, 255);
}

/**
 * Detects MIME type strictly based on magic bytes.
 * Supported allowlist:
 * - application/pdf (starts with %PDF-)
 * - image/jpeg (starts with FF D8 FF)
 * - application/zip (starts with PK\x03\x04 or PK\x05\x06)
 *
 * @param {Buffer} buffer - File buffer
 * @returns {'application/pdf' | 'image/jpeg' | 'application/zip' | null} Detected MIME type or null
 */
export function detectMimeType(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return null;
  }

  // PDF: %PDF- (0x25 0x50 0x44 0x46 0x2D)
  if (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    return 'application/pdf';
  }

  // JPEG: FF D8 FF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }

  // ZIP: PK\x03\x04 (standard) or PK\x05\x06 (empty archive / end of central dir)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    ((buffer[2] === 0x03 && buffer[3] === 0x04) || (buffer[2] === 0x05 && buffer[3] === 0x06))
  ) {
    return 'application/zip';
  }

  return null;
}

/**
 * Validates an uploaded file buffer and metadata.
 * Validates buffer size, magic bytes against allowlist, client declared MIME agreement,
 * and filename safety.
 *
 * @param {{
 *   buffer: Buffer,
 *   originalName: string,
 *   declaredMime: string
 * }} upload
 * @returns {{ mimeType: string, safeName: string }} Validated MIME type and sanitized safeName
 */
export function validateUpload({ buffer, originalName, declaredMime }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Upload validation failed: file is empty');
  }

  if (buffer.length > env.MAX_UPLOAD_BYTES) {
    throw new Error(
      `Upload validation failed: file size (${buffer.length} bytes) exceeds maximum limit (${env.MAX_UPLOAD_BYTES} bytes)`
    );
  }

  if (
    typeof originalName !== 'string' ||
    originalName.trim().length === 0 ||
    originalName.includes('..') ||
    /[/\\]/.test(originalName)
  ) {
    throw new Error('Upload validation failed: invalid file name or path traversal detected');
  }

  const detectedMime = detectMimeType(buffer);
  if (!detectedMime) {
    throw new Error('Upload validation failed: unsupported file type or invalid magic bytes');
  }

  const normalizedDeclared =
    typeof declaredMime === 'string'
      ? declaredMime.split(';')[0].toLowerCase().trim()
      : '';

  if (normalizedDeclared !== detectedMime) {
    throw new Error(
      `Upload validation failed: declared MIME type "${declaredMime}" does not match detected content type "${detectedMime}"`
    );
  }

  const safeName = sanitizeFileName(originalName);

  return {
    mimeType: detectedMime,
    safeName
  };
}
