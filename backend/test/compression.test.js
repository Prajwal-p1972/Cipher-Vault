import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { compress, decompress } from '../src/services/crypto/compression.js';

describe('Compression & Zip-Bomb Guard Tests', () => {
  it('correctly round-trips compressible data', async () => {
    const originalText = 'CONFIDENTIAL-VAULT-RECORD-'.repeat(2000);
    const originalBuffer = Buffer.from(originalText, 'utf8');

    const result = await compress(originalBuffer);
    assert.strictEqual(result.compressed, true);
    assert.ok(result.data.length < originalBuffer.length);

    const decompressed = await decompress(result.data);
    assert.deepStrictEqual(decompressed, originalBuffer);
  });

  it('returns compressed:false and the original buffer for incompressible data', async () => {
    // High-entropy random payload where gzip overhead exceeds raw size
    const highEntropyBuffer = crypto.randomBytes(64);

    const result = await compress(highEntropyBuffer);
    assert.strictEqual(result.compressed, false);
    assert.strictEqual(result.data, highEntropyBuffer);
  });

  it('rejects a crafted zip bomb when maxBytes is exceeded', async () => {
    // 200 MB of zeros compresses to ~200 KB
    const bombPayload = Buffer.alloc(200 * 1024 * 1024, 0);
    const { data: gzippedBomb, compressed } = await compress(bombPayload);
    assert.strictEqual(compressed, true);

    // Guard with a small 1 MB maxBytes limit
    const smallMaxBytes = 1024 * 1024;

    await assert.rejects(
      async () => decompress(gzippedBomb, smallMaxBytes),
      (err) => {
        assert.match(err.message, /zip-bomb/i);
        assert.match(err.message, /exceeds maximum allowed size/i);
        return true;
      }
    );
  });
});
