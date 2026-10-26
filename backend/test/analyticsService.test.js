// test/analyticsService.test.js
// Unit tests for analyticsService — no real DB; uses injected fake aggregate/query functions.

process.env.NODE_ENV = 'test';
process.env.PORT = '5001';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/cipher_vault_test';
process.env.CLIENT_ORIGIN = 'http://localhost:3000';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
process.env.MFA_ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.AUDIT_HMAC_KEY = 'c'.repeat(40);

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const {
  getMyOverview,
  getMyEvents,
  getSystemOverview,
  getChainHealth,
  _invalidateChainCache
} = await import('../src/services/analyticsService.js');

// ─── forbidden field deep-scan ─────────────────────────────────────────────────

const FORBIDDEN_FIELDS = [
  'ip', 'userAgent', 'meta', 'hash', 'prevHash', 'storage', 'iv',
  'authTag', 'hmac', 'lat', 'lng', 'passwordHash', 'refreshTokenHashes', 'secretEnc'
];

function deepScan(obj, path = '') {
  if (obj === null || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    const fullPath = path ? `${path}.${key}` : key;
    assert.ok(
      !FORBIDDEN_FIELDS.includes(key),
      `Forbidden field '${key}' found at path '${fullPath}'`
    );
    deepScan(obj[key], fullPath);
  }
}

// ─── fake aggregate builder ────────────────────────────────────────────────────

/**
 * Builds a deterministic fake auditAggregate function that returns
 * pre-baked results based on the first $match or $group stage seen.
 */
function makeFakeAuditAggregate({
  totalsResult = null,
  dayRows = [],
  actionRows = [],
  deniedRows = [],
  lockoutsResult = null,
  tokenReuseResult = null,
  failureRows = []
} = {}) {
  let callIndex = 0;
  return async (pipeline) => {
    callIndex++;
    // Detect pipeline intent from stages
    const stages = pipeline.map((s) => Object.keys(s)[0]);
    const firstMatch = pipeline.find((s) => s.$match);
    const groupStage = pipeline.find((s) => s.$group);

    // activityByDay pipelines group by {date, outcome}
    if (groupStage?.$group?._id?.date !== undefined) {
      return dayRows;
    }
    // deniedByReason: match on action = DOC_ACCESS_DENIED
    if (firstMatch?.$match?.action === 'DOC_ACCESS_DENIED') {
      return deniedRows;
    }
    // lockouts
    if (firstMatch?.$match?.action === 'ACCOUNT_LOCKED') {
      return lockoutsResult ? [lockoutsResult] : [];
    }
    // tokenReuse
    if (firstMatch?.$match?.action === 'TOKEN_REUSE_DETECTED') {
      return tokenReuseResult ? [tokenReuseResult] : [];
    }
    // failures pipeline (system)
    if (firstMatch?.$match?.outcome === 'failure') {
      return failureRows;
    }
    // actionBreakdown — groups by '$action'
    if (groupStage?.$group?._id === '$action') {
      return actionRows;
    }
    // totals — groups into _id: null with event counts
    if (groupStage?.$group?._id === null) {
      return totalsResult ? [totalsResult] : [];
    }
    return [];
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('analyticsService.getMyOverview', () => {
  test('returns correct shape with no forbidden fields', async () => {
    const deps = {
      auditAggregate: makeFakeAuditAggregate({
        totalsResult: { events: 10, failures: 2, documentsSent: 3, documentsReceived: 1 },
        dayRows: [],
        actionRows: [{ action: 'LOGIN_PASSWORD_OK', count: 5 }]
      }),
      docAggregate: async () => [{ _id: 'sealed', count: 2 }]
    };
    const result = await getMyOverview('uid1', {}, deps);

    assert.ok('totals' in result);
    assert.ok('activityByDay' in result);
    assert.ok('actionBreakdown' in result);
    assert.ok('documentStatus' in result);
    assert.ok('deniedByReason' in result);
    deepScan(result);
  });

  test('totals default to zero when aggregate returns empty', async () => {
    const deps = {
      auditAggregate: makeFakeAuditAggregate(),
      docAggregate: async () => []
    };
    const { totals } = await getMyOverview('uid1', {}, deps);
    assert.deepEqual(totals, { events: 0, failures: 0, documentsSent: 0, documentsReceived: 0 });
  });

  test('activityByDay has continuous date range (zero-fill)', async () => {
    const from = '2024-01-01';
    const to = '2024-01-05';
    const deps = {
      auditAggregate: makeFakeAuditAggregate({
        dayRows: [
          { _id: { date: '2024-01-02', outcome: 'success' }, count: 3 }
        ]
      }),
      docAggregate: async () => []
    };
    const { activityByDay } = await getMyOverview('uid1', { from, to }, deps);
    assert.strictEqual(activityByDay.length, 5);
    const dates = activityByDay.map((d) => d.date);
    assert.deepEqual(dates, ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05']);
    const jan2 = activityByDay.find((d) => d.date === '2024-01-02');
    assert.strictEqual(jan2.success, 3);
    const jan1 = activityByDay.find((d) => d.date === '2024-01-01');
    assert.strictEqual(jan1.success, 0);
    assert.strictEqual(jan1.failure, 0);
  });

  test('deniedByReason whitelists known codes and collapses unknown to OTHER', async () => {
    const deps = {
      auditAggregate: async (pipeline) => {
        const firstMatch = pipeline.find((s) => s.$match);
        if (firstMatch?.$match?.action === 'DOC_ACCESS_DENIED') {
          return [
            { _id: 'GEO_DENIED', count: 2 },
            { _id: 'EVIL_INJECTION', count: 1 },
            { _id: 'EXPIRED', count: 3 }
          ];
        }
        const group = pipeline.find((s) => s.$group);
        if (group?.$group?._id === null) return [];
        return [];
      },
      docAggregate: async () => []
    };
    const { deniedByReason } = await getMyOverview('uid1', {}, deps);
    const codes = deniedByReason.map((d) => d.code);
    assert.ok(codes.includes('GEO_DENIED'));
    assert.ok(codes.includes('EXPIRED'));
    assert.ok(codes.includes('OTHER'));
    assert.ok(!codes.includes('EVIL_INJECTION'));
    deepScan({ deniedByReason });
  });

  test('rejects reversed date range', async () => {
    await assert.rejects(
      () => getMyOverview('uid1', { from: '2024-05-01', to: '2024-01-01' }, {}),
      (err) => { assert.ok(err.message.includes('from must not be after to')); return true; }
    );
  });

  test('rejects date range exceeding 90 days', async () => {
    await assert.rejects(
      () => getMyOverview('uid1', { from: '2023-01-01', to: '2024-01-01' }, {}),
      (err) => { assert.ok(err.message.includes('90')); return true; }
    );
  });
});

describe('analyticsService.getMyEvents', () => {
  test('returns correct shape with no forbidden fields', async () => {
    const fakeDoc = {
      seq: 5,
      action: 'LOGIN_PASSWORD_OK',
      outcome: 'success',
      createdAt: new Date(),
      resource: { kind: 'User', id: 'abc' }
    };
    const deps = {
      auditFind: async () => [fakeDoc]
    };
    const result = await getMyEvents('uid1', { limit: 10 }, deps);
    assert.ok('events' in result);
    assert.ok('nextCursor' in result);
    assert.strictEqual(result.events.length, 1);
    deepScan(result);
  });

  test('pagination: nextCursor set when more results exist', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      seq: 10 - i,
      action: 'LOGIN_PASSWORD_OK',
      outcome: 'success',
      createdAt: new Date(),
      resource: { kind: 'User', id: null }
    }));
    const deps = { auditFind: async () => rows };
    const result = await getMyEvents('uid1', { limit: 5 }, deps);
    assert.strictEqual(result.events.length, 5);
    assert.ok(result.nextCursor !== null);
  });

  test('limit is capped at 100', async () => {
    let capturedOpts;
    const deps = {
      auditFind: async (q, proj, opts) => { capturedOpts = opts; return []; }
    };
    await getMyEvents('uid1', { limit: 9999 }, deps);
    assert.ok(capturedOpts.limit <= 101); // 100 + 1 for has-more check
  });

  test('no forbidden fields in event items', async () => {
    const fakeDoc = {
      seq: 1,
      action: 'DOC_ACCESS_DENIED',
      outcome: 'failure',
      createdAt: new Date(),
      resource: { kind: 'Document', id: 'xyz' },
      // These fields must NOT appear in output even if present in DB
      ip: '1.2.3.4',
      userAgent: 'Mozilla',
      meta: { code: 'EXPIRED' },
      hash: 'abc',
      prevHash: 'def'
    };
    const deps = { auditFind: async () => [fakeDoc] };
    const { events } = await getMyEvents('uid1', {}, deps);
    deepScan({ events });
  });
});

describe('analyticsService.getSystemOverview', () => {
  test('returns correct shape with no forbidden fields', async () => {
    const deps = {
      auditAggregate: makeFakeAuditAggregate({
        totalsResult: { events: 100, failures: 10 },
        dayRows: [],
        actionRows: [],
        lockoutsResult: { count: 2 },
        tokenReuseResult: { count: 1 }
      }),
      docAggregate: async (pipeline) => {
        if (pipeline[0]?.$group?._id === null) return [{ documents: 50 }];
        return [];
      },
      userCount: async () => 5
    };
    const result = await getSystemOverview({}, deps);
    assert.ok('totals' in result);
    assert.ok('lockouts' in result);
    assert.ok('tokenReuse' in result);
    assert.ok('documentStatus' in result);
    assert.strictEqual(result.totals.users, 5);
    deepScan(result);
  });

  test('totals.users, documents, events, failures all present', async () => {
    const deps = {
      auditAggregate: makeFakeAuditAggregate({
        totalsResult: { events: 7, failures: 3 }
      }),
      docAggregate: async () => [],
      userCount: async () => 2
    };
    const { totals } = await getSystemOverview({}, deps);
    assert.ok(typeof totals.users === 'number');
    assert.ok(typeof totals.documents === 'number');
    assert.ok(typeof totals.events === 'number');
    assert.ok(typeof totals.failures === 'number');
  });
});

describe('analyticsService.getChainHealth', () => {
  beforeEach(() => _invalidateChainCache());

  test('returns valid:true shape', async () => {
    const deps = { verifyFn: async () => ({ valid: true, checked: 42 }) };
    const result = await getChainHealth(deps);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.checked, 42);
    assert.ok(typeof result.checkedAt === 'string');
    assert.ok(!result.brokenAtSeq);
    deepScan(result);
  });

  test('includes brokenAtSeq when invalid', async () => {
    const deps = { verifyFn: async () => ({ valid: false, checked: 10, brokenAtSeq: 5 }) };
    const result = await getChainHealth(deps);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.brokenAtSeq, 5);
    deepScan(result);
  });

  test('cache: second call returns cached result without calling verifyFn again', async () => {
    let callCount = 0;
    const deps = { verifyFn: async () => { callCount++; return { valid: true, checked: 1 }; } };
    await getChainHealth(deps);
    const second = await getChainHealth(deps);
    assert.strictEqual(callCount, 1);
    assert.strictEqual(second.cached, true);
  });

  test('cache: _invalidateChainCache forces re-verification', async () => {
    let callCount = 0;
    const deps = { verifyFn: async () => { callCount++; return { valid: true, checked: 1 }; } };
    await getChainHealth(deps);
    _invalidateChainCache();
    await getChainHealth(deps);
    assert.strictEqual(callCount, 2);
  });
});
