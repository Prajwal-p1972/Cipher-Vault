import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  validatePublicKey,
  computeKeyId,
  fingerprintOf,
  wrapDocumentKey,
  assertEnvelopeShape
} from '../src/services/crypto/keyWrap.js';
import { AppError } from '../src/utils/errors.js';

const { subtle } = crypto.webcrypto;

/**
 * Emulates the frontend Web Crypto API unwrapping process.
 * Matches the shared ECDH P-256 + HKDF-SHA256 + AES-256-GCM contract.
 */
async function webCryptoUnwrap(envelope, privateKey, docId, receiverId) {
  const epkBuf = Buffer.from(envelope.epk, 'base64url');
  const saltBuf = Buffer.from(envelope.salt, 'base64url');
  const ivBuf = Buffer.from(envelope.iv, 'base64url');
  const ctBuf = Buffer.from(envelope.ct, 'base64url');

  const importedEpk = await subtle.importKey(
    'raw',
    epkBuf,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const sharedBits = await subtle.deriveBits(
    { name: 'ECDH', public: importedEpk },
    privateKey,
    256
  );

  const hkdfKey = await subtle.importKey(
    'raw',
    sharedBits,
    'HKDF',
    false,
    ['deriveKey']
  );

  const infoStr = 'cipher-vault/keywrap/v1|' + docId + '|' + receiverId + '|' + envelope.recipientKeyId;
  const info = Buffer.from(infoStr, 'utf8');

  const kek = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBuf, info },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const decrypted = await subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuf, additionalData: info, tagLength: 128 },
    kek,
    ctBuf
  );

  return Buffer.from(decrypted);
}

describe('ECDH P-256 Key Wrapping Specification (Cross-Implementation Contract)', () => {
  test('receiver key pair generated via WebCrypto -> server wrap -> WebCrypto unwrap produces identical 32 bytes', async () => {
    const receiverPair = await subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits', 'deriveKey']
    );

    const rawPub = await subtle.exportKey('raw', receiverPair.publicKey);
    const pubBuf = Buffer.from(rawPub);
    const pubB64Url = pubBuf.toString('base64url');
    const recipientKeyId = computeKeyId(pubBuf);

    const docKey = crypto.randomBytes(32);
    const docKeyCopy = Buffer.from(docKey);
    const docId = '507f1f77bcf86cd799439011';
    const receiverId = '507f1f77bcf86cd799439022';

    const envelope = wrapDocumentKey({
      docKey,
      recipientPublicB64Url: pubB64Url,
      recipientKeyId,
      docId,
      receiverId
    });

    assertEnvelopeShape(envelope);

    const unwrapped = await webCryptoUnwrap(
      envelope,
      receiverPair.privateKey,
      docId,
      receiverId
    );

    assert.strictEqual(unwrapped.length, 32);
    assert.deepStrictEqual(unwrapped, docKeyCopy);
  });

  test('tampering with envelope components or AAD parameters causes unwrap to fail', async () => {
    const receiverPair = await subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits', 'deriveKey']
    );

    const rawPub = await subtle.exportKey('raw', receiverPair.publicKey);
    const pubBuf = Buffer.from(rawPub);
    const pubB64Url = pubBuf.toString('base64url');
    const recipientKeyId = computeKeyId(pubBuf);

    const docKey = crypto.randomBytes(32);
    const docId = '507f1f77bcf86cd799439011';
    const receiverId = '507f1f77bcf86cd799439022';

    const envelope = wrapDocumentKey({
      docKey,
      recipientPublicB64Url: pubB64Url,
      recipientKeyId,
      docId,
      receiverId
    });

    // 1) Tamper EPK
    const tamperedEpkBuf = Buffer.from(envelope.epk, 'base64url');
    tamperedEpkBuf[20] ^= 0x01;
    const badEpkEnv = { ...envelope, epk: tamperedEpkBuf.toString('base64url') };
    await assert.rejects(
      async () => webCryptoUnwrap(badEpkEnv, receiverPair.privateKey, docId, receiverId)
    );

    // 2) Tamper Salt
    const tamperedSaltBuf = Buffer.from(envelope.salt, 'base64url');
    tamperedSaltBuf[5] ^= 0x01;
    const badSaltEnv = { ...envelope, salt: tamperedSaltBuf.toString('base64url') };
    await assert.rejects(
      async () => webCryptoUnwrap(badSaltEnv, receiverPair.privateKey, docId, receiverId)
    );

    // 3) Tamper IV
    const tamperedIvBuf = Buffer.from(envelope.iv, 'base64url');
    tamperedIvBuf[2] ^= 0x01;
    const badIvEnv = { ...envelope, iv: tamperedIvBuf.toString('base64url') };
    await assert.rejects(
      async () => webCryptoUnwrap(badIvEnv, receiverPair.privateKey, docId, receiverId)
    );

    // 4) Tamper Ciphertext
    const tamperedCtBuf = Buffer.from(envelope.ct, 'base64url');
    tamperedCtBuf[10] ^= 0x01;
    const badCtEnv = { ...envelope, ct: tamperedCtBuf.toString('base64url') };
    await assert.rejects(
      async () => webCryptoUnwrap(badCtEnv, receiverPair.privateKey, docId, receiverId)
    );

    // 5) Tamper docId in AAD
    await assert.rejects(
      async () => webCryptoUnwrap(envelope, receiverPair.privateKey, 'tampered_doc_id', receiverId)
    );

    // 6) Tamper receiverId in AAD
    await assert.rejects(
      async () => webCryptoUnwrap(envelope, receiverPair.privateKey, docId, 'tampered_receiver_id')
    );

    // 7) Tamper recipientKeyId
    const tamperedKeyIdEnv = { ...envelope, recipientKeyId: '0'.repeat(64) };
    await assert.rejects(
      async () => webCryptoUnwrap(tamperedKeyIdEnv, receiverPair.privateKey, docId, receiverId)
    );
  });

  test('attempting to unwrap with the wrong receiver key fails', async () => {
    const legitimateReceiver = await subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits', 'deriveKey']
    );

    const attackerReceiver = await subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits', 'deriveKey']
    );

    const rawPub = await subtle.exportKey('raw', legitimateReceiver.publicKey);
    const pubBuf = Buffer.from(rawPub);
    const pubB64Url = pubBuf.toString('base64url');
    const recipientKeyId = computeKeyId(pubBuf);

    const docKey = crypto.randomBytes(32);
    const docId = '507f1f77bcf86cd799439011';
    const receiverId = '507f1f77bcf86cd799439022';

    const envelope = wrapDocumentKey({
      docKey,
      recipientPublicB64Url: pubB64Url,
      recipientKeyId,
      docId,
      receiverId
    });

    await assert.rejects(
      async () => webCryptoUnwrap(envelope, attackerReceiver.privateKey, docId, receiverId)
    );
  });

  test('two wraps of the same document key differ (fresh ephemeral key, salt, and IV)', () => {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    const pubBuf = ecdh.getPublicKey();
    const pubB64Url = pubBuf.toString('base64url');
    const recipientKeyId = computeKeyId(pubBuf);

    const docKey = crypto.randomBytes(32);
    const docId = '507f1f77bcf86cd799439011';
    const receiverId = '507f1f77bcf86cd799439022';

    const env1 = wrapDocumentKey({
      docKey: Buffer.from(docKey),
      recipientPublicB64Url: pubB64Url,
      recipientKeyId,
      docId,
      receiverId
    });

    const env2 = wrapDocumentKey({
      docKey: Buffer.from(docKey),
      recipientPublicB64Url: pubB64Url,
      recipientKeyId,
      docId,
      receiverId
    });

    assert.notStrictEqual(env1.epk, env2.epk);
    assert.notStrictEqual(env1.salt, env2.salt);
    assert.notStrictEqual(env1.iv, env2.iv);
    assert.notStrictEqual(env1.ct, env2.ct);
  });

  test('invalid public keys rejected with generic 400', () => {
    // 1) Wrong length (64 bytes instead of 65)
    const shortKey = Buffer.alloc(64, 4).toString('base64url');
    assert.throws(() => validatePublicKey(shortKey), (err) => err instanceof AppError && err.statusCode === 400);

    // 2) Wrong prefix (65 bytes with prefix 0x02 instead of 0x04)
    const badPrefix = Buffer.alloc(65, 0);
    badPrefix[0] = 0x02;
    assert.throws(
      () => validatePublicKey(badPrefix.toString('base64url')),
      (err) => err instanceof AppError && err.statusCode === 400
    );

    // 3) All zeros with prefix 0x04 (off-curve point)
    const allZeros = Buffer.alloc(65, 0);
    allZeros[0] = 0x04;
    assert.throws(
      () => validatePublicKey(allZeros.toString('base64url')),
      (err) => err instanceof AppError && err.statusCode === 400
    );

    // 4) Arbitrary random off-curve point
    const offCurve = Buffer.alloc(65, 0xaa);
    offCurve[0] = 0x04;
    assert.throws(
      () => validatePublicKey(offCurve.toString('base64url')),
      (err) => err instanceof AppError && err.statusCode === 400
    );

    // 5) Empty string or invalid base64url characters
    assert.throws(() => validatePublicKey(''), (err) => err instanceof AppError && err.statusCode === 400);
    assert.throws(() => validatePublicKey('!!!not-valid-base64url!!!'), (err) => err instanceof AppError && err.statusCode === 400);
    assert.throws(() => validatePublicKey(null), (err) => err instanceof AppError && err.statusCode === 400);
  });

  test('keyId and fingerprint formats adhere to specifications', () => {
    const raw = crypto.randomBytes(65);
    raw[0] = 0x04;
    const keyId = computeKeyId(raw);

    assert.strictEqual(typeof keyId, 'string');
    assert.strictEqual(keyId.length, 64);
    assert.match(keyId, /^[0-9a-f]{64}$/);

    const fp = fingerprintOf(keyId);
    assert.strictEqual(typeof fp, 'string');
    // 8 groups of 4 characters with 7 spaces in between = 32 chars + 7 spaces = 39 characters
    assert.strictEqual(fp.length, 39);
    assert.match(fp, /^[0-9a-f]{4}( [0-9a-f]{4}){7}$/);
    assert.strictEqual(fp.replace(/ /g, ''), keyId.slice(0, 32));
  });

  test('assertEnvelopeShape validates correctly', () => {
    const valid = {
      v: 1,
      alg: 'ECDH-P256-HKDF-SHA256-A256GCM',
      recipientKeyId: 'a'.repeat(64),
      epk: Buffer.alloc(65, 4).toString('base64url'),
      salt: Buffer.alloc(32, 1).toString('base64url'),
      iv: Buffer.alloc(12, 2).toString('base64url'),
      ct: Buffer.alloc(48, 3).toString('base64url')
    };

    assert.strictEqual(assertEnvelopeShape(valid), true);

    assert.throws(() => assertEnvelopeShape(null), /Invalid key envelope/);
    assert.throws(() => assertEnvelopeShape({ ...valid, v: 2 }), /version/);
    assert.throws(() => assertEnvelopeShape({ ...valid, alg: 'AES' }), /algorithm/);
    assert.throws(() => assertEnvelopeShape({ ...valid, recipientKeyId: 'short' }), /recipientKeyId/);
    assert.throws(() => assertEnvelopeShape({ ...valid, epk: 'bad' }), /epk/);
    assert.throws(() => assertEnvelopeShape({ ...valid, salt: 'bad' }), /salt/);
    assert.throws(() => assertEnvelopeShape({ ...valid, iv: 'bad' }), /iv/);
    assert.throws(() => assertEnvelopeShape({ ...valid, ct: 'bad' }), /ct/);
  });
});
