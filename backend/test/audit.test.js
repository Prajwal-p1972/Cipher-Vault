import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from '../src/utils/canonicalJson.js';
import { computeHash, GENESIS } from '../src/services/auditService.js';

describe('Audit Utility & Service Tests', () => {
  test('canonicalJson is key-order-independent and handles nested structures, arrays, Date, and null', () => {
    const objA = {
      b: [1, 2, { y: 'test', x: null }],
      a: { beta: 2, alpha: 1 },
      date: new Date('2026-10-05T12:00:00.000Z')
    };

    const objB = {
      date: new Date('2026-10-05T12:00:00.000Z'),
      a: { alpha: 1, beta: 2 },
      b: [1, 2, { x: null, y: 'test' }]
    };

    assert.strictEqual(canonicalJson(objA), canonicalJson(objB));
  });

  const baseEntry = {
    seq: 1,
    actor: '507f1f77bcf86cd799439011',
    action: 'LOGIN_PASSWORD_OK',
    resourceKind: 'User',
    resourceId: '507f1f77bcf86cd799439011',
    outcome: 'success',
    ip: '127.0.0.1',
    userAgent: 'Mozilla/5.0 TestBrowser',
    meta: { authMethod: 'totp', step: 100 },
    createdAt: new Date('2026-10-05T12:00:00.000Z'),
    prevHash: GENESIS
  };

  test('computeHash is strictly deterministic for identical input', () => {
    const h1 = computeHash(baseEntry);
    const h2 = computeHash(baseEntry);
    assert.strictEqual(h1, h2);
    assert.strictEqual(h1.length, 64);
  });

  test('computeHash changes when ANY field or prevHash changes', () => {
    const baseHash = computeHash(baseEntry);

    const modifications = [
      { seq: 2 },
      { actor: '507f1f77bcf86cd799439099' },
      { action: 'LOGIN_FAILED' },
      { resourceKind: 'Document' },
      { resourceId: '507f1f77bcf86cd799439088' },
      { outcome: 'failure' },
      { ip: '192.168.1.1' },
      { userAgent: 'DifferentAgent' },
      { meta: { authMethod: 'password' } },
      { createdAt: new Date('2026-10-05T12:00:01.000Z') },
      { prevHash: '1'.repeat(64) }
    ];

    for (const mod of modifications) {
      const modifiedHash = computeHash({ ...baseEntry, ...mod });
      assert.notStrictEqual(
        modifiedHash,
        baseHash,
        `Hash should change when modifying ${Object.keys(mod).join(',')}`
      );
    }
  });

  test('computeHash is identical for an entry before and after dropping empty meta (simulating Mongo round-trip)', () => {
    const entryWithEmptyMeta = {
      ...baseEntry,
      meta: {}
    };

    const entryWithUndefinedMeta = {
      ...baseEntry,
      meta: undefined
    };

    const hashEmpty = computeHash(entryWithEmptyMeta);
    const hashUndefined = computeHash(entryWithUndefinedMeta);

    assert.strictEqual(hashEmpty, hashUndefined);
  });
});
