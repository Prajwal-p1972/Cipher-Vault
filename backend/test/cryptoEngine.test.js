import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  generateDocumentKey,
  deriveKeys,
  buildAad,
  sealBuffer,
  openBuffer,
  policyHash
} from '../src/services/crypto/cryptoEngine.js';

describe('Cryptographic Engine Tests', () => {
  const validAad = {
    docId: 'doc_test_123',
    senderId: 'user_sender_456',
    receiverId: 'user_receiver_789',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    policyHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  };

  it('performs round-trip encryption/decryption for 1 B, 1 KB, and 5 MB buffers', () => {
    const docKey = generateDocumentKey();
    const sizes = [
      1,
      1024,
      5 * 1024 * 1024
    ];

    for (const size of sizes) {
      const plaintext = crypto.randomBytes(size);
      const aad = { ...validAad, sizeBytes: size };
      const sealed = sealBuffer(plaintext, docKey, aad);

      assert.strictEqual(sealed.algorithm, 'aes-256-gcm');
      assert.strictEqual(sealed.iv.length, 12);
      assert.strictEqual(sealed.authTag.length, 16);
      assert.strictEqual(typeof sealed.hmac, 'string');
      assert.strictEqual(sealed.hmac.length, 64);
      assert.strictEqual(sealed.ciphertext.length, size);

      const decrypted = openBuffer(sealed, docKey, aad);
      assert.deepStrictEqual(decrypted, plaintext);
    }
  });

  it('generates 20000 unique IVs across 20000 seals', () => {
    const docKey = generateDocumentKey();
    const sample = Buffer.from('iv uniqueness test sample');
    const ivs = new Set();
    const total = 20000;

    for (let i = 0; i < total; i++) {
      const sealed = sealBuffer(sample, docKey, validAad);
      ivs.add(sealed.iv.toString('hex'));
    }

    assert.strictEqual(ivs.size, total);
  });

  it('tampered ciphertext, tag, IV, hmac, and EACH AAD field each fail with identical error', () => {
    const docKey = generateDocumentKey();
    const plaintext = Buffer.from('confidential vault content');
    const sealed = sealBuffer(plaintext, docKey, validAad);
    const expectedError = { message: 'Integrity check failed' };

    // Tampered ciphertext
    const badCiphertext = Buffer.from(sealed.ciphertext);
    badCiphertext[0] ^= 0xff;
    assert.throws(
      () => openBuffer({ ...sealed, ciphertext: badCiphertext }, docKey, validAad),
      expectedError
    );

    // Tampered authTag
    const badTag = Buffer.from(sealed.authTag);
    badTag[0] ^= 0xff;
    assert.throws(
      () => openBuffer({ ...sealed, authTag: badTag }, docKey, validAad),
      expectedError
    );

    // Tampered IV
    const badIv = Buffer.from(sealed.iv);
    badIv[0] ^= 0xff;
    assert.throws(
      () => openBuffer({ ...sealed, iv: badIv }, docKey, validAad),
      expectedError
    );

    // Tampered HMAC
    const badHmac = sealed.hmac.slice(0, -1) + (sealed.hmac.endsWith('0') ? '1' : '0');
    assert.throws(
      () => openBuffer({ ...sealed, hmac: badHmac }, docKey, validAad),
      expectedError
    );

    // EACH AAD field tampered
    const aadKeys = ['docId', 'senderId', 'receiverId', 'mimeType', 'sizeBytes', 'policyHash'];
    for (const key of aadKeys) {
      const tamperedAad = {
        ...validAad,
        [key]: key === 'sizeBytes' ? validAad[key] + 1 : `${validAad[key]}_tampered`
      };
      assert.throws(
        () => openBuffer(sealed, docKey, tamperedAad),
        expectedError
      );

      // Missing field
      const missingAad = { ...validAad };
      delete missingAad[key];
      assert.throws(
        () => openBuffer(sealed, docKey, missingAad),
        expectedError
      );
    }
  });

  it('fails with identical error on wrong document key', () => {
    const docKey = generateDocumentKey();
    const wrongKey = generateDocumentKey();
    const plaintext = Buffer.from('payload for wrong key test');
    const sealed = sealBuffer(plaintext, docKey, validAad);

    assert.throws(
      () => openBuffer(sealed, wrongKey, validAad),
      { message: 'Integrity check failed' }
    );
  });

  it('ensures HMAC failure happens BEFORE decryption (decipher is never constructed)', () => {
    const docKey = generateDocumentKey();
    const plaintext = Buffer.from('mac order verification test');
    const sealed = sealBuffer(plaintext, docKey, validAad);

    let decipherConstructed = false;
    const originalCreateDecipheriv = crypto.createDecipheriv;
    crypto.createDecipheriv = function (...args) {
      decipherConstructed = true;
      return originalCreateDecipheriv.apply(this, args);
    };

    try {
      const badHmac = sealed.hmac.slice(0, -2) + '00';
      assert.throws(
        () => openBuffer({ ...sealed, hmac: badHmac }, docKey, validAad),
        { message: 'Integrity check failed' }
      );
      assert.strictEqual(
        decipherConstructed,
        false,
        'crypto.createDecipheriv must never be called when HMAC verification fails'
      );
    } finally {
      crypto.createDecipheriv = originalCreateDecipheriv;
    }
  });

  it('derived keys differ (encKey !== macKey) and are deterministic for identical docKey', () => {
    const docKey = generateDocumentKey();
    const pair1 = deriveKeys(docKey);
    const pair2 = deriveKeys(docKey);

    assert.strictEqual(pair1.encKey.length, 32);
    assert.strictEqual(pair1.macKey.length, 32);
    assert.notDeepStrictEqual(
      pair1.encKey,
      pair1.macKey,
      'encKey and macKey must be distinct keys'
    );
    assert.deepStrictEqual(pair1.encKey, pair2.encKey);
    assert.deepStrictEqual(pair1.macKey, pair2.macKey);

    const differentDocKey = generateDocumentKey();
    const differentPair = deriveKeys(differentDocKey);
    assert.notDeepStrictEqual(pair1.encKey, differentPair.encKey);
  });

  it('policyHash is stable, key-order independent, and produces a 64-char hex string', () => {
    const policyA = {
      action: 'read',
      allowlist: ['user_1', 'user_2'],
      maxViews: 5,
      meta: { dept: 'secops', tier: 1 }
    };

    const policyB = {
      meta: { tier: 1, dept: 'secops' },
      maxViews: 5,
      allowlist: ['user_1', 'user_2'],
      action: 'read'
    };

    const hashA = policyHash(policyA);
    const hashB = policyHash(policyB);

    assert.strictEqual(typeof hashA, 'string');
    assert.strictEqual(hashA.length, 64);
    assert.strictEqual(hashA, hashB);

    const modifiedPolicy = { ...policyA, maxViews: 6 };
    assert.notStrictEqual(hashA, policyHash(modifiedPolicy));
  });
});
