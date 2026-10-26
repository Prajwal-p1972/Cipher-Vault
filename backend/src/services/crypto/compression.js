import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { env } from '../../config/env.js';

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

/**
 * Compresses a buffer using gzip at level 6.
 * If compression does not result in a smaller payload, returns the original buffer.
 *
 * @param {Buffer} buffer - Buffer to compress
 * @returns {Promise<{ data: Buffer, compressed: boolean }>}
 */
export async function compress(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('buffer must be a Buffer');
  }

  const compressedData = await gzipAsync(buffer, { level: 6 });

  if (compressedData.length < buffer.length) {
    return {
      data: compressedData,
      compressed: true
    };
  }

  return {
    data: buffer,
    compressed: false
  };
}

/**
 * Decompresses a gzipped buffer with maximum output length enforcement (zip-bomb protection).
 *
 * @param {Buffer} buffer - Gzipped buffer to decompress
 * @param {number} [maxBytes=env.MAX_DECOMPRESSED_BYTES] - Maximum decompressed byte limit
 * @returns {Promise<Buffer>} Decompressed buffer
 */
export async function decompress(buffer, maxBytes = env.MAX_DECOMPRESSED_BYTES) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('buffer must be a Buffer');
  }

  const limit = typeof maxBytes === 'number' && maxBytes > 0 ? maxBytes : env.MAX_DECOMPRESSED_BYTES;

  try {
    const decompressed = await gunzipAsync(buffer, { maxOutputLength: limit });
    return decompressed;
  } catch (err) {
    if (
      err.code === 'ERR_BUFFER_TOO_LARGE' ||
      err.code === 'ERR_OUT_OF_RANGE' ||
      /larger than/i.test(err.message)
    ) {
      throw new Error(
        `Decompression limit exceeded: payload exceeds maximum allowed size of ${limit} bytes (zip-bomb guard)`
      );
    }
    throw err;
  }
}
