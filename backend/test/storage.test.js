import './setup.js';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import crypto from 'node:crypto';
import { createEncryptionStream, createDecryptionStream } from '../src/utils/cryptoStream.js';
import { uploadEncryptedStream, downloadEncryptedStream } from '../src/services/storageService.js';
import { s3Client } from '../src/config/aws.js';
import { env } from '../src/config/env.js';

describe('Phase 2: Cryptographic Engine & AWS S3 Storage Pipeline', () => {
  let originalSend;

  beforeEach(() => {
    originalSend = s3Client.send;
  });

  afterEach(() => {
    s3Client.send = originalSend;
  });

  describe('createEncryptionStream', () => {
    it('produces a unique 256-bit Key and 96-bit IV on each invocation', () => {
      const pipeline1 = createEncryptionStream();
      const pipeline2 = createEncryptionStream();

      assert.ok(Buffer.isBuffer(pipeline1.key), 'Key should be a Buffer');
      assert.strictEqual(pipeline1.key.length, 32, 'Key must be exactly 32 bytes (256-bit)');

      assert.ok(Buffer.isBuffer(pipeline1.iv), 'IV should be a Buffer');
      assert.strictEqual(pipeline1.iv.length, 12, 'IV must be exactly 12 bytes (96-bit nonce)');

      assert.ok(Buffer.isBuffer(pipeline2.key), 'Second key should be a Buffer');
      assert.strictEqual(pipeline2.key.length, 32, 'Second key must be exactly 32 bytes');

      assert.ok(Buffer.isBuffer(pipeline2.iv), 'Second IV should be a Buffer');
      assert.strictEqual(pipeline2.iv.length, 12, 'Second IV must be exactly 12 bytes');

      assert.notDeepStrictEqual(
        pipeline1.key,
        pipeline2.key,
        'Consecutive encryption streams must generate unique keys'
      );
      assert.notDeepStrictEqual(
        pipeline1.iv,
        pipeline2.iv,
        'Consecutive encryption streams must generate unique IVs'
      );
    });

    it('pipes a string through compression and AES-256-GCM encryption, generating an auth tag', async () => {
      const { cipher, compressor, key, iv } = createEncryptionStream();
      const fakePlaintext = 'Confidential payload streamed through gzip and AES-256-GCM';

      let authTag = null;
      cipher.on('end', () => {
        authTag = cipher.getAuthTag();
      });

      const encryptedChunks = [];
      const captureStream = new PassThrough();
      captureStream.on('data', (chunk) => encryptedChunks.push(chunk));

      await pipeline(
        Readable.from([fakePlaintext]),
        compressor,
        cipher,
        captureStream
      );

      const ciphertext = Buffer.concat(encryptedChunks);
      assert.ok(ciphertext.length > 0, 'Encrypted ciphertext must not be empty');
      assert.notStrictEqual(
        ciphertext.toString('utf8'),
        fakePlaintext,
        'Ciphertext must differ from original plaintext'
      );
      assert.ok(Buffer.isBuffer(authTag), 'Authentication tag must be captured on end event');
      assert.strictEqual(authTag.length, 16, 'AES-GCM authentication tag must be 16 bytes');
    });
  });

  describe('uploadEncryptedStream', () => {
    it('captures the authentication tag at the end of the stream and uploads to S3', async () => {
      let capturedBucket = null;
      let capturedKey = null;

      s3Client.send = async (command) => {
        if (command.input) {
          capturedBucket = command.input.Bucket;
          capturedKey = command.input.Key;
          if (command.input.Body) {
            for await (const _ of command.input.Body) {
              // Drain stream to drive cipher completion
            }
          }
        }
        return { ETag: '"mock-s3-etag"' };
      };

      const cryptoPipeline = createEncryptionStream();
      const rawFileStream = Readable.from(['Streaming direct file upload to S3 without disk buffering']);

      const result = await uploadEncryptedStream(rawFileStream, cryptoPipeline);

      assert.ok(result, 'uploadEncryptedStream should resolve with an object');
      assert.ok(typeof result.objectKey === 'string', 'objectKey should be a string');
      assert.match(
        result.objectKey,
        /^[0-9a-f]{32}$/,
        'objectKey must be a 16-byte random hex string (32 hex characters)'
      );

      assert.ok(Buffer.isBuffer(result.authTag), 'authTag must be a Buffer');
      assert.strictEqual(result.authTag.length, 16, 'authTag must be 16 bytes');
      assert.deepStrictEqual(
        result.authTag,
        cryptoPipeline.cipher.getAuthTag(),
        'Returned auth tag must match the cipher authentication tag'
      );

      assert.strictEqual(capturedBucket, env.AWS_S3_BUCKET_NAME);
      assert.strictEqual(capturedKey, result.objectKey);
    });

    it('throws an error if the encryption pipeline fails to produce an authentication tag', async () => {
      s3Client.send = async () => ({ ETag: '"mock-etag"' });

      const fakeCipher = new PassThrough();
      fakeCipher.getAuthTag = () => null;
      const fakeCompressor = new PassThrough();
      const fakePipeline = {
        cipher: fakeCipher,
        compressor: fakeCompressor,
        key: crypto.randomBytes(32),
        iv: crypto.randomBytes(12),
      };

      const rawFileStream = Readable.from(['Broken cipher pipeline']);

      await assert.rejects(
        async () => uploadEncryptedStream(rawFileStream, fakePipeline),
        /Encryption pipeline failed: Auth tag was not generated/i
      );
    });
  });

  describe('downloadEncryptedStream', () => {
    it('fetches the encrypted stream from AWS S3 using GetObjectCommand', async () => {
      const mockEncryptedData = Buffer.from('mock-encrypted-s3-blob');
      let dispatchedCommand = null;

      s3Client.send = async (command) => {
        dispatchedCommand = command;
        return {
          Body: Readable.from([mockEncryptedData]),
        };
      };

      const testKey = 'abc123def456789012345678901234ef';
      const stream = await downloadEncryptedStream(testKey);

      assert.ok(stream, 'downloadEncryptedStream should return a stream');
      assert.strictEqual(dispatchedCommand.input.Bucket, env.AWS_S3_BUCKET_NAME);
      assert.strictEqual(dispatchedCommand.input.Key, testKey);

      const downloadedChunks = [];
      for await (const chunk of stream) {
        downloadedChunks.push(chunk);
      }
      assert.deepStrictEqual(Buffer.concat(downloadedChunks), mockEncryptedData);
    });
  });

  describe('Decryption & Tamper-evidence (AES-256-GCM)', () => {
    it('successfully round-trips compressed and encrypted stream data back to original plaintext', async () => {
      const originalMessage = 'Strictly confidential security report for Cipher Vault 2026';
      const encPipeline = createEncryptionStream();

      let authTag = null;
      encPipeline.cipher.on('end', () => {
        authTag = encPipeline.cipher.getAuthTag();
      });

      const encryptedChunks = [];
      const captureCiphertext = new PassThrough();
      captureCiphertext.on('data', (chunk) => encryptedChunks.push(chunk));

      await pipeline(
        Readable.from([originalMessage]),
        encPipeline.compressor,
        encPipeline.cipher,
        captureCiphertext
      );

      const ciphertext = Buffer.concat(encryptedChunks);
      assert.ok(authTag, 'Auth tag must be captured');

      const decPipeline = createDecryptionStream(encPipeline.key, encPipeline.iv, authTag);
      const decryptedChunks = [];
      const capturePlaintext = new PassThrough();
      capturePlaintext.on('data', (chunk) => decryptedChunks.push(chunk));

      await pipeline(
        Readable.from([ciphertext]),
        decPipeline.decipher,
        decPipeline.decompressor,
        capturePlaintext
      );

      const restoredMessage = Buffer.concat(decryptedChunks).toString('utf8');
      assert.strictEqual(restoredMessage, originalMessage, 'Decrypted plaintext must match original message');
    });

    it('throws an authentication error if authTag is tampered with during decryption', async () => {
      const originalMessage = 'Authenticated sensitive document payload';
      const encPipeline = createEncryptionStream();

      let authTag = null;
      encPipeline.cipher.on('end', () => {
        authTag = encPipeline.cipher.getAuthTag();
      });

      const encryptedChunks = [];
      const captureCiphertext = new PassThrough();
      captureCiphertext.on('data', (chunk) => encryptedChunks.push(chunk));

      await pipeline(
        Readable.from([originalMessage]),
        encPipeline.compressor,
        encPipeline.cipher,
        captureCiphertext
      );

      const ciphertext = Buffer.concat(encryptedChunks);

      // Tamper with authentication tag (flip bits in the first byte)
      const tamperedAuthTag = Buffer.from(authTag);
      tamperedAuthTag[0] ^= 0xff;

      const decPipeline = createDecryptionStream(encPipeline.key, encPipeline.iv, tamperedAuthTag);

      await assert.rejects(
        async () => {
          await pipeline(
            Readable.from([ciphertext]),
            decPipeline.decipher,
            decPipeline.decompressor
          );
        },
        /Unsupported state or unable to authenticate data/i,
        'Tampered authentication tag must cause decipher to throw an authentication failure'
      );
    });

    it('throws an authentication error if ciphertext is tampered with during decryption', async () => {
      const originalMessage = 'Tamper-evident ciphertext stream integrity test';
      const encPipeline = createEncryptionStream();

      let authTag = null;
      encPipeline.cipher.on('end', () => {
        authTag = encPipeline.cipher.getAuthTag();
      });

      const encryptedChunks = [];
      const captureCiphertext = new PassThrough();
      captureCiphertext.on('data', (chunk) => encryptedChunks.push(chunk));

      await pipeline(
        Readable.from([originalMessage]),
        encPipeline.compressor,
        encPipeline.cipher,
        captureCiphertext
      );

      const ciphertext = Buffer.concat(encryptedChunks);

      // Tamper with ciphertext (flip bits in the middle byte)
      const tamperedCiphertext = Buffer.from(ciphertext);
      const midpoint = Math.floor(tamperedCiphertext.length / 2);
      tamperedCiphertext[midpoint] ^= 0xff;

      const decPipeline = createDecryptionStream(encPipeline.key, encPipeline.iv, authTag);

      await assert.rejects(
        async () => {
          await pipeline(
            Readable.from([tamperedCiphertext]),
            decPipeline.decipher,
            decPipeline.decompressor
          );
        },
        /Unsupported state or unable to authenticate data/i,
        'Tampered ciphertext must cause decipher to throw an authentication failure'
      );
    });

    it('throws an authentication error if an incorrect decryption key is used', async () => {
      const originalMessage = 'Key mismatch integrity test';
      const encPipeline = createEncryptionStream();

      let authTag = null;
      encPipeline.cipher.on('end', () => {
        authTag = encPipeline.cipher.getAuthTag();
      });

      const encryptedChunks = [];
      const captureCiphertext = new PassThrough();
      captureCiphertext.on('data', (chunk) => encryptedChunks.push(chunk));

      await pipeline(
        Readable.from([originalMessage]),
        encPipeline.compressor,
        encPipeline.cipher,
        captureCiphertext
      );

      const ciphertext = Buffer.concat(encryptedChunks);
      const wrongKey = crypto.randomBytes(32);

      const decPipeline = createDecryptionStream(wrongKey, encPipeline.iv, authTag);

      await assert.rejects(
        async () => {
          await pipeline(
            Readable.from([ciphertext]),
            decPipeline.decipher,
            decPipeline.decompressor
          );
        },
        /Unsupported state or unable to authenticate data/i,
        'Decryption with incorrect key must fail authentication'
      );
    });

    it('throws an authentication error if an incorrect IV is used', async () => {
      const originalMessage = 'IV mismatch integrity test';
      const encPipeline = createEncryptionStream();

      let authTag = null;
      encPipeline.cipher.on('end', () => {
        authTag = encPipeline.cipher.getAuthTag();
      });

      const encryptedChunks = [];
      const captureCiphertext = new PassThrough();
      captureCiphertext.on('data', (chunk) => encryptedChunks.push(chunk));

      await pipeline(
        Readable.from([originalMessage]),
        encPipeline.compressor,
        encPipeline.cipher,
        captureCiphertext
      );

      const ciphertext = Buffer.concat(encryptedChunks);
      const wrongIv = crypto.randomBytes(12);

      const decPipeline = createDecryptionStream(encPipeline.key, wrongIv, authTag);

      await assert.rejects(
        async () => {
          await pipeline(
            Readable.from([ciphertext]),
            decPipeline.decipher,
            decPipeline.decompressor
          );
        },
        /Unsupported state or unable to authenticate data/i,
        'Decryption with incorrect IV must fail authentication'
      );
    });
  });
});
