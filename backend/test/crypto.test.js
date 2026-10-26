import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  getMfaKey,
  secretBox,
  unsealBox,
  hmacSha256,
  sha256Hex,
  safeEqualHex
} from '../src/utils/crypto.js';

describe('Crypto Utility Tests', () => {
  const key = getMfaKey();
  const plaintext = 'SuperSecretPayloadForDocumentExchange123!';

  test('secretBox and unsealBox round-trip correctly', () => {
    const sealed = secretBox(plaintext, key);
    assert.strictEqual(typeof sealed, 'string');
    const unsealed = unsealBox(sealed, key);
    assert.strictEqual(unsealed, plaintext);
  });

  test('5000 calls produce 5000 unique IVs', () => {
    const ivs = new Set();
    const count = 5000;
    for (let i = 0; i < count; i++) {
      const sealed = secretBox(plaintext, key);
      const ivPart = sealed.split('.')[0];
      ivs.add(ivPart);
    }
    assert.strictEqual(ivs.size, count);
  });

  test('Output format has exactly 3 base64 parts, 12-byte IV, and 16-byte tag', () => {
    const sealed = secretBox(plaintext, key);
    const parts = sealed.split('.');
    assert.strictEqual(parts.length, 3);

    const [ivB64, tagB64, ctB64] = parts;
    const ivBuf = Buffer.from(ivB64, 'base64');
    const tagBuf = Buffer.from(tagB64, 'base64');
    const ctBuf = Buffer.from(ctB64, 'base64');

    assert.strictEqual(ivBuf.length, 12);
    assert.strictEqual(tagBuf.length, 16);
    assert.ok(ctBuf.length > 0);
  });

  test('Tampered ciphertext throws an error', () => {
    const sealed = secretBox(plaintext, key);
    const [iv, tag, ct] = sealed.split('.');
    const ctBuf = Buffer.from(ct, 'base64');
    ctBuf[0] ^= 0x01; // Tamper 1 bit
    const tamperedSealed = `${iv}.${tag}.${ctBuf.toString('base64')}`;

    assert.throws(() => unsealBox(tamperedSealed, key));
  });

  test('Tampered tag throws an error', () => {
    const sealed = secretBox(plaintext, key);
    const [iv, tag, ct] = sealed.split('.');
    const tagBuf = Buffer.from(tag, 'base64');
    tagBuf[0] ^= 0x01;
    const tamperedSealed = `${iv}.${tagBuf.toString('base64')}.${ct}`;

    assert.throws(() => unsealBox(tamperedSealed, key));
  });

  test('Wrong key throws on unsealBox', () => {
    const sealed = secretBox(plaintext, key);
    const wrongKey = crypto.randomBytes(32);

    assert.throws(() => unsealBox(sealed, wrongKey));
  });

  test('Malformed sealed string throws on unsealBox', () => {
    assert.throws(() => unsealBox('invalid', key));
    assert.throws(() => unsealBox('a.b', key));
    assert.throws(() => unsealBox('a.b.c.d', key));
    assert.throws(() => unsealBox('', key));
  });

  test('hmacSha256 is deterministic and key-dependent', () => {
    const data = 'AuditChainEntryToSign';
    const hmac1 = hmacSha256('key-a'.repeat(8), data);
    const hmac2 = hmacSha256('key-a'.repeat(8), data);
    const hmac3 = hmacSha256('key-b'.repeat(8), data);

    assert.strictEqual(hmac1, hmac2);
    assert.notStrictEqual(hmac1, hmac3);
    assert.strictEqual(hmac1.length, 64);
  });

  test('safeEqualHex returns true for matching hex and false for mismatch or length difference', () => {
    const h1 = sha256Hex('test-data-1');
    const h2 = sha256Hex('test-data-1');
    const h3 = sha256Hex('test-data-2');

    assert.strictEqual(safeEqualHex(h1, h2), true);
    assert.strictEqual(safeEqualHex(h1, h3), false);
    assert.strictEqual(safeEqualHex(h1, 'short'), false);
    assert.strictEqual(safeEqualHex('1234', '12'), false);
  });
});
