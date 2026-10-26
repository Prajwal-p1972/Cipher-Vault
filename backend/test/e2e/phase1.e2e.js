// Environment configuration MUST be set before importing any src modules
process.env.NODE_ENV = 'test';
process.env.PORT = '5001';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/cipher_vault_test';
process.env.CLIENT_ORIGIN = 'http://localhost:3000';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
process.env.MFA_ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.AUDIT_HMAC_KEY = 'c'.repeat(40);
process.env.RATE_LIMIT_MAX = '1000';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import speakeasy from 'speakeasy';

// Dynamic imports to ensure process.env variables are completely initialized
const { default: app } = await import('../../src/app.js');
const { default: mongoose } = await import('mongoose');
const { User } = await import('../../src/models/User.js');
const { AuditLog } = await import('../../src/models/AuditLog.js');
const { audit } = await import('../../src/services/auditService.js');
const { sha256Hex } = await import('../../src/utils/crypto.js');

describe('Phase 1 End-to-End Database-Backed Test Suite', () => {
  let server;
  let baseUrl;

  // Helper to extract cookie value
  function extractCookie(res, name = 'cv_refresh') {
    const rawCookies = res.headers.getSetCookie
      ? res.headers.getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie')]
        : [];

    for (const c of rawCookies) {
      const match = c.match(new RegExp(`${name}=([^;]+)`));
      if (match) return match[1];
    }
    return null;
  }

  function getRawCookieHeader(res, name = 'cv_refresh') {
    const rawCookies = res.headers.getSetCookie
      ? res.headers.getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie')]
        : [];
    return rawCookies.find((c) => c.includes(`${name}=`)) || null;
  }

  before(async () => {
    await mongoose.connect(process.env.MONGO_URI, { autoIndex: true });
    await mongoose.connection.db.dropDatabase(); // Start with completely clean slate

    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (mongoose.connection?.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await mongoose.disconnect();
    await new Promise((resolve) => server.close(resolve));
  });

  // Shared state across sequential tests
  let user1Id;
  let user1Email = 'user1@example.com';
  let user1Password = 'ValidPassword123!';
  let setupToken1;
  let manualEntryKey1;
  let accessToken1;
  let mfaToken1;
  let activeRefreshCookie;

  // 1. Register
  test('1. Register -> 201, no tokens. Duplicate email -> 409. Weak password -> 400', async () => {
    // Valid registration
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user1Email,
        displayName: 'User One',
        password: user1Password
      })
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(body.user?.id);
    assert.strictEqual(body.user.email, user1Email);
    assert.strictEqual(body.user.displayName, 'User One');
    assert.strictEqual(body.user.role, 'user');
    assert.strictEqual(body.user.mfaEnabled, false);
    assert.strictEqual(body.accessToken, undefined);
    assert.strictEqual(body.refreshToken, undefined);
    assert.strictEqual(body.setupToken, undefined);
    assert.strictEqual(body.mfaToken, undefined);
    user1Id = body.user.id;

    // Duplicate email
    const dupRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user1Email,
        displayName: 'Duplicate User',
        password: user1Password
      })
    });
    assert.strictEqual(dupRes.status, 409);

    // Weak password (< 12 chars)
    const weakRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'weak@example.com',
        displayName: 'Weak User',
        password: 'short'
      })
    });
    assert.strictEqual(weakRes.status, 400);
  });

  // 2. Login before MFA enrollment
  test('2. Login before MFA enrollment -> 200 MFA_SETUP_REQUIRED with setupToken, NO accessToken', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user1Email,
        password: user1Password
      })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'MFA_SETUP_REQUIRED');
    assert.ok(body.setupToken);
    assert.strictEqual(body.accessToken, undefined);
    setupToken1 = body.setupToken;
  });

  // 3. /me with setupToken -> 401; /mfa/setup with setupToken -> 200 sealed secret in DB
  test('3. /me with setupToken -> 401; /mfa/setup with setupToken -> 200, sealed pendingSecretEnc in DB', async () => {
    // /me rejects setup token (requires access scope)
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${setupToken1}` }
    });
    assert.strictEqual(meRes.status, 401);

    // /mfa/setup accepts setup token
    const setupRes = await fetch(`${baseUrl}/api/auth/mfa/setup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${setupToken1}` }
    });
    assert.strictEqual(setupRes.status, 200);
    const body = await setupRes.json();
    assert.ok(body.manualEntryKey);
    assert.ok(body.otpauthUrl);
    assert.ok(body.qrDataUrl);
    manualEntryKey1 = body.manualEntryKey;

    // Verify DB representation
    const userInDb = await User.findById(user1Id).select('+mfa.pendingSecretEnc');
    assert.ok(userInDb.mfa.pendingSecretEnc);
    assert.notStrictEqual(userInDb.mfa.pendingSecretEnc, manualEntryKey1);
    assert.strictEqual(userInDb.mfa.pendingSecretEnc.split('.').length, 3);
  });

  // 4. /mfa/enable with wrong code -> 401; right code -> 200 with accessToken and cv_refresh cookie
  test('4. /mfa/enable with wrong code -> 401; right code -> 200, accessToken, cv_refresh cookie, no body refresh', async () => {
    // Wrong code
    const wrongRes = await fetch(`${baseUrl}/api/auth/mfa/enable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${setupToken1}`
      },
      body: JSON.stringify({ code: '000000' })
    });
    assert.strictEqual(wrongRes.status, 401);

    // Right code
    const correctCode = speakeasy.totp({
      secret: manualEntryKey1,
      encoding: 'base32'
    });

    const rightRes = await fetch(`${baseUrl}/api/auth/mfa/enable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${setupToken1}`
      },
      body: JSON.stringify({ code: correctCode })
    });
    assert.strictEqual(rightRes.status, 200);
    const body = await rightRes.json();
    assert.ok(body.accessToken);
    assert.strictEqual(body.refreshToken, undefined);
    accessToken1 = body.accessToken;

    const rawCookie = getRawCookieHeader(rightRes);
    assert.ok(rawCookie);
    assert.ok(rawCookie.toLowerCase().includes('httponly'));
    assert.ok(rawCookie.toLowerCase().includes('samesite=strict'));
    activeRefreshCookie = extractCookie(rightRes);
    assert.ok(activeRefreshCookie);

    // Verify DB state
    const userInDb = await User.findById(user1Id).select('+mfa.secretEnc +mfa.pendingSecretEnc');
    assert.strictEqual(userInDb.mfa.enabled, true);
    assert.ok(userInDb.mfa.secretEnc);
    assert.strictEqual(userInDb.mfa.pendingSecretEnc, null);
  });

  // 5. /me with accessToken
  test('5. /me with accessToken -> 200 and leaks no secrets', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken1}` }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.user.email, user1Email);
    assert.strictEqual(body.user.passwordHash, undefined);
    assert.strictEqual(body.user.secretEnc, undefined);
    assert.strictEqual(body.user.refreshTokenHashes, undefined);
  });

  // 6. Login again -> MFA_REQUIRED with mfaToken (no accessToken). /me with mfaToken -> 401
  test('6. Login again -> MFA_REQUIRED with mfaToken (no accessToken). /me with mfaToken -> 401', async () => {
    await User.updateOne({ _id: user1Id }, { $set: { 'mfa.lastUsedStep': 0 } });

    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user1Email,
        password: user1Password
      })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'MFA_REQUIRED');
    assert.ok(body.mfaToken);
    assert.strictEqual(body.accessToken, undefined);
    mfaToken1 = body.mfaToken;

    // /me rejects mfaToken
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${mfaToken1}` }
    });
    assert.strictEqual(meRes.status, 401);
  });

  // 7. /mfa/verify with valid code -> 200 with accessToken
  test('7. /mfa/verify with valid code -> 200 with accessToken', async () => {
    const code = speakeasy.totp({
      secret: manualEntryKey1,
      encoding: 'base32'
    });

    const res = await fetch(`${baseUrl}/api/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mfaToken: mfaToken1,
        code
      })
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.accessToken);
    accessToken1 = body.accessToken;
    activeRefreshCookie = extractCookie(res);
    assert.ok(activeRefreshCookie);
  });

  // 8. TOTP REPLAY
  test('8. TOTP REPLAY: code reuse across tokens rejected with 401 and lastUsedStep matches', async () => {
    // Reset lastUsedStep so fresh code is accepted
    await User.updateOne({ _id: user1Id }, { $set: { 'mfa.lastUsedStep': 0 } });

    // Step A: Login to get mfaTokenA
    const loginResA = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user1Email, password: user1Password })
    });
    const { mfaToken: mfaTokenA } = await loginResA.json();

    const codeC = speakeasy.totp({ secret: manualEntryKey1, encoding: 'base32' });
    const expectedStep = Math.floor(Date.now() / 1000 / 30);

    // Verify first time -> 200
    const verifyResA = await fetch(`${baseUrl}/api/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfaToken: mfaTokenA, code: codeC })
    });
    assert.strictEqual(verifyResA.status, 200);

    // Step B: Login to get mfaTokenB
    const loginResB = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user1Email, password: user1Password })
    });
    const { mfaToken: mfaTokenB } = await loginResB.json();

    // Replay SAME code C -> 401
    const verifyResB = await fetch(`${baseUrl}/api/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfaToken: mfaTokenB, code: codeC })
    });
    assert.strictEqual(verifyResB.status, 401);

    const userInDb = await User.findById(user1Id).select('+mfa.lastUsedStep');
    assert.strictEqual(userInDb.mfa.lastUsedStep, expectedStep);
  });

  // 9. LOCKOUT: wrong passwords
  test('9. LOCKOUT: 5 wrong passwords -> 401s, 6th attempt -> 423. Unlock via DB -> works', async () => {
    // Register user2 and configure MFA
    const u2Email = 'user2@example.com';
    const u2Pass = 'ValidPasswordUser2!';
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: u2Email, displayName: 'User Two', password: u2Pass })
    });

    const logRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: u2Email, password: u2Pass })
    });
    const { setupToken } = await logRes.json();

    const setupRes = await fetch(`${baseUrl}/api/auth/mfa/setup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${setupToken}` }
    });
    const { manualEntryKey } = await setupRes.json();
    const code = speakeasy.totp({ secret: manualEntryKey, encoding: 'base32' });

    await fetch(`${baseUrl}/api/auth/mfa/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${setupToken}` },
      body: JSON.stringify({ code })
    });

    // 5 wrong passwords
    for (let i = 0; i < 5; i++) {
      const wrong = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: u2Email, password: 'WrongPassword!' })
      });
      assert.strictEqual(wrong.status, 401);
    }

    // 6th attempt (even with correct password) -> 423
    const lockedRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: u2Email, password: u2Pass })
    });
    assert.strictEqual(lockedRes.status, 423);

    const u2Db = await User.findOne({ email: u2Email });
    assert.ok(u2Db.lockUntil);
    const diffMinutes = (u2Db.lockUntil.getTime() - Date.now()) / (60 * 1000);
    assert.ok(diffMinutes >= 14 && diffMinutes <= 16);

    // Direct DB unlock
    await User.updateOne({ email: u2Email }, { $set: { lockUntil: null, failedLoginAttempts: 0 } });

    // Login works again
    const unlockRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: u2Email, password: u2Pass })
    });
    assert.strictEqual(unlockRes.status, 200);
  });

  // 10. TOTP lockout
  test('10. TOTP lockout: 5 wrong TOTP codes on /mfa/verify lock the account (423)', async () => {
    const u2Email = 'user2@example.com';
    const u2Pass = 'ValidPasswordUser2!';

    // Reset lastUsedStep and lock
    await User.updateOne({ email: u2Email }, { $set: { lockUntil: null, failedLoginAttempts: 0, 'mfa.lastUsedStep': 0 } });

    const logRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: u2Email, password: u2Pass })
    });
    const { mfaToken } = await logRes.json();

    // 5 wrong codes
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/api/auth/mfa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaToken, code: '000000' })
      });
      assert.strictEqual(res.status, 401);
    }

    // Next attempt -> 423
    const lockedRes = await fetch(`${baseUrl}/api/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfaToken, code: '000000' })
    });
    assert.strictEqual(lockedRes.status, 423);

    const u2Db = await User.findOne({ email: u2Email });
    assert.ok(u2Db.lockUntil > new Date());
  });

  // 11. REFRESH ROTATION
  let rotatedCookie;
  test('11. REFRESH ROTATION: /refresh with cookie -> 200, new cookie differs, DB updated', async () => {
    // Reset user1 for fresh session
    await User.updateOne({ _id: user1Id }, { $set: { lockUntil: null, failedLoginAttempts: 0, 'mfa.lastUsedStep': 0 } });

    const logRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user1Email, password: user1Password })
    });
    const { mfaToken } = await logRes.json();
    const code = speakeasy.totp({ secret: manualEntryKey1, encoding: 'base32' });

    const verRes = await fetch(`${baseUrl}/api/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfaToken, code })
    });
    const oldCookie = extractCookie(verRes);

    const refRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `cv_refresh=${oldCookie}` }
    });
    assert.strictEqual(refRes.status, 200);

    rotatedCookie = extractCookie(refRes);
    assert.ok(rotatedCookie);
    assert.notStrictEqual(rotatedCookie, oldCookie);

    const userDb = await User.findById(user1Id).select('+refreshTokenHashes');
    assert.ok(userDb.refreshTokenHashes.includes(sha256Hex(rotatedCookie)));
    assert.ok(!userDb.refreshTokenHashes.includes(sha256Hex(oldCookie)));
    activeRefreshCookie = oldCookie; // Save old cookie for reuse test
  });

  // 12. REFRESH REUSE
  test('12. REFRESH REUSE: replay old cookie -> 401, DB hashes wiped, TOKEN_REUSE_DETECTED audit', async () => {
    // Replay old cookie
    const reuseRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `cv_refresh=${activeRefreshCookie}` }
    });
    assert.strictEqual(reuseRes.status, 401);

    // DB hashes now empty
    const userDb = await User.findById(user1Id).select('+refreshTokenHashes');
    assert.strictEqual(userDb.refreshTokenHashes.length, 0);

    // Audit entry exists
    const auditEntry = await AuditLog.findOne({ action: 'TOKEN_REUSE_DETECTED' });
    assert.ok(auditEntry);

    // Rotated new cookie ALSO fails now
    const newFailRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `cv_refresh=${rotatedCookie}` }
    });
    assert.strictEqual(newFailRes.status, 401);
  });

  // 13. SESSION CAP
  test('13. SESSION CAP: 7 logins retain at most 5 refresh hashes in DB', async () => {
    for (let i = 0; i < 7; i++) {
      await User.updateOne({ _id: user1Id }, { $set: { 'mfa.lastUsedStep': 0 } });
      const logRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user1Email, password: user1Password })
      });
      const { mfaToken } = await logRes.json();
      const code = speakeasy.totp({ secret: manualEntryKey1, encoding: 'base32' });
      await fetch(`${baseUrl}/api/auth/mfa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaToken, code })
      });
    }

    const userDb = await User.findById(user1Id).select('+refreshTokenHashes');
    assert.ok(userDb.refreshTokenHashes.length <= 5);
    assert.strictEqual(userDb.refreshTokenHashes.length, 5);
  });

  // 14. LOGOUT
  test('14. LOGOUT: 204, clears cookie, removes hash from DB, old cookie returns 401, no cookie -> 204', async () => {
    await User.updateOne({ _id: user1Id }, { $set: { 'mfa.lastUsedStep': 0 } });
    const logRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user1Email, password: user1Password })
    });
    const { mfaToken } = await logRes.json();
    const code = speakeasy.totp({ secret: manualEntryKey1, encoding: 'base32' });
    const verRes = await fetch(`${baseUrl}/api/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfaToken, code })
    });
    const currentCookie = extractCookie(verRes);

    // Logout with cookie
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: `cv_refresh=${currentCookie}` }
    });
    assert.strictEqual(logoutRes.status, 204);

    const userDb = await User.findById(user1Id).select('+refreshTokenHashes');
    assert.ok(!userDb.refreshTokenHashes.includes(sha256Hex(currentCookie)));

    // Refresh with logged-out cookie -> 401
    const refRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `cv_refresh=${currentCookie}` }
    });
    assert.strictEqual(refRes.status, 401);

    // Logout without cookie still -> 204
    const logoutNoCookie = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' });
    assert.strictEqual(logoutNoCookie.status, 204);
  });

  // 15. RBAC
  test('15. RBAC: user -> 403 on /api/audit/verify; after admin promotion -> 200 { valid: true, checked: N > 0 }', async () => {
    await User.updateOne({ _id: user1Id }, { $set: { role: 'user', 'mfa.lastUsedStep': 0 } });
    const logRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user1Email, password: user1Password })
    });
    const { mfaToken } = await logRes.json();
    const code = speakeasy.totp({ secret: manualEntryKey1, encoding: 'base32' });
    const verRes = await fetch(`${baseUrl}/api/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfaToken, code })
    });
    const { accessToken } = await verRes.json();

    // Standard user -> 403
    const forbiddenRes = await fetch(`${baseUrl}/api/audit/verify`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    assert.strictEqual(forbiddenRes.status, 403);

    // Promote to admin directly in DB
    await User.updateOne({ _id: user1Id }, { $set: { role: 'admin' } });

    // Admin -> 200
    const adminRes = await fetch(`${baseUrl}/api/audit/verify`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    assert.strictEqual(adminRes.status, 200);
    const body = await adminRes.json();
    assert.strictEqual(body.valid, true);
    assert.ok(body.checked > 0);
  });

  // 16. AUDIT CHAIN TAMPER
  test('16. AUDIT CHAIN TAMPER: direct update -> valid:false brokenAtSeq:3; restore -> true; delete -> false; Mongoose hooks throw', async () => {
    const rawAuditCollection = mongoose.connection.db.collection('auditlogs');

    // Tamper outcome at seq 3
    const originalEntry3 = await rawAuditCollection.findOne({ seq: 3 });
    assert.ok(originalEntry3);
    const tamperedOutcome = originalEntry3.outcome === 'success' ? 'failure' : 'success';
    await rawAuditCollection.updateOne({ seq: 3 }, { $set: { outcome: tamperedOutcome } });

    // Verify detection
    const adminUser = await User.findById(user1Id);
    assert.strictEqual(adminUser.role, 'admin');

    const check1 = await fetch(`${baseUrl}/api/audit/verify`, {
      headers: { Authorization: `Bearer ${accessToken1}` }
    });
    assert.strictEqual(check1.status, 200);
    const res1 = await check1.json();
    assert.strictEqual(res1.valid, false);
    assert.strictEqual(res1.brokenAtSeq, 3);

    // Restore seq 3
    await rawAuditCollection.updateOne({ seq: 3 }, { $set: { outcome: originalEntry3.outcome } });
    const check2 = await (await fetch(`${baseUrl}/api/audit/verify`, {
      headers: { Authorization: `Bearer ${accessToken1}` }
    })).json();
    assert.strictEqual(check2.valid, true);

    // Delete seq 5
    const entry5 = await rawAuditCollection.findOne({ seq: 5 });
    await rawAuditCollection.deleteOne({ seq: 5 });
    const check3 = await (await fetch(`${baseUrl}/api/audit/verify`, {
      headers: { Authorization: `Bearer ${accessToken1}` }
    })).json();
    assert.strictEqual(check3.valid, false);

    // Restore seq 5
    await rawAuditCollection.insertOne(entry5);
    const check4 = await (await fetch(`${baseUrl}/api/audit/verify`, {
      headers: { Authorization: `Bearer ${accessToken1}` }
    })).json();
    assert.strictEqual(check4.valid, true);

    // Assert Mongoose model operations throw
    await assert.rejects(async () => AuditLog.updateOne({ seq: 1 }, { $set: { outcome: 'failure' } }));
    await assert.rejects(async () => AuditLog.deleteMany({ seq: 1 }));
    const existingDoc = await AuditLog.findOne({ seq: 1 });
    existingDoc.outcome = 'failure';
    await assert.rejects(async () => existingDoc.save());
  });

  // 17. AUDIT CONCURRENCY
  test('17. AUDIT CONCURRENCY: 25 parallel audit() calls result in valid, gap-free chain', async () => {
    const beforeCount = await AuditLog.countDocuments();
    const parallelAppends = [];

    for (let i = 0; i < 25; i++) {
      parallelAppends.push(
        audit({
          actor: user1Id,
          action: 'DOC_NOTIFIED',
          resourceKind: 'Document',
          resourceId: `doc_${i}`,
          outcome: 'success',
          meta: { index: i }
        })
      );
    }

    await Promise.all(parallelAppends);

    const afterCount = await AuditLog.countDocuments();
    assert.strictEqual(afterCount, beforeCount + 25);

    // Verify chain integrity
    const check = await (await fetch(`${baseUrl}/api/audit/verify`, {
      headers: { Authorization: `Bearer ${accessToken1}` }
    })).json();
    assert.strictEqual(check.valid, true);

    // Verify seq gap-free monotonicity
    const allLogs = await AuditLog.find().sort({ seq: 1 }).lean();
    for (let i = 0; i < allLogs.length; i++) {
      assert.strictEqual(allLogs[i].seq, i + 1);
    }
  });

  // 18. AUDIT COVERAGE
  test('18. AUDIT COVERAGE: all required action types exist and no credentials leak in logs', async () => {
    const requiredActions = [
      'USER_REGISTER',
      'LOGIN_PASSWORD_OK',
      'LOGIN_FAILED',
      'ACCOUNT_LOCKED',
      'MFA_ENROLL_STARTED',
      'MFA_ENABLED',
      'MFA_VERIFY_OK',
      'MFA_VERIFY_FAILED',
      'TOKEN_REFRESH',
      'TOKEN_REUSE_DETECTED',
      'LOGOUT'
    ];

    const logs = await AuditLog.find().lean();
    const existingActions = new Set(logs.map((l) => l.action));

    for (const action of requiredActions) {
      assert.ok(existingActions.has(action), `Expected audit log to contain action: ${action}`);
    }

    // Verify that sensitive credentials never leak into meta, userAgent, or ip
    for (const log of logs) {
      const metaStr = JSON.stringify(log.meta || {});
      const userAgentStr = String(log.userAgent || '');
      const ipStr = String(log.ip || '');

      assert.ok(!metaStr.includes(user1Password));
      assert.ok(!userAgentStr.includes(user1Password));
      assert.ok(!ipStr.includes(user1Password));

      if (manualEntryKey1) {
        assert.ok(!metaStr.includes(manualEntryKey1));
      }
      if (accessToken1) {
        assert.ok(!metaStr.includes(accessToken1));
      }
    }
  });
});
