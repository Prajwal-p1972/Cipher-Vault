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
process.env.STORAGE_DRIVER = 'memory';
process.env.MAX_UPLOAD_BYTES = '26214400';
process.env.GEO_MAX_ACCURACY_METERS = '500';
process.env.UNLOCK_MAX_PER_15MIN = '100';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import speakeasy from 'speakeasy';

// Dynamic imports to ensure process.env variables are initialized
const { default: app } = await import('../../src/app.js');
const { default: mongoose } = await import('mongoose');
const { User } = await import('../../src/models/User.js');
const { Document } = await import('../../src/models/Document.js');
const { AuditLog } = await import('../../src/models/AuditLog.js');
const { verifyChain } = await import('../../src/services/auditService.js');
const { getStorage } = await import('../../src/services/storage/index.js');

describe('Phase 4 End-to-End Test Suite: Context-Gated Opening of Sealed Documents', () => {
  let server;
  let baseUrl;

  let sender;
  let receiver;
  let thirdParty;

  const originalPdfPayload = '%PDF-1.7\n%CONFIDENTIAL CIPHER VAULT HIGH-SECURITY MEMO';
  const GEOFENCE_LAT = 37.7749;
  const GEOFENCE_LNG = -122.4194;
  const GEOFENCE_RADIUS = 500; // 500 meters

  // Registers user, enables MFA, and preserves base32 secret for TOTP generation
  async function registerAndMfa(email, password, displayName) {
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName })
    });
    assert.strictEqual(regRes.status, 201);
    const regData = await regRes.json();
    const userId = regData.user.id;

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    assert.strictEqual(loginRes.status, 200);
    const { setupToken } = await loginRes.json();

    const setupRes = await fetch(`${baseUrl}/api/auth/mfa/setup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${setupToken}` }
    });
    assert.strictEqual(setupRes.status, 200);
    const { manualEntryKey } = await setupRes.json();

    const code = speakeasy.totp({ secret: manualEntryKey, encoding: 'base32' });
    const enableRes = await fetch(`${baseUrl}/api/auth/mfa/enable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${setupToken}`
      },
      body: JSON.stringify({ code })
    });
    assert.strictEqual(enableRes.status, 200);
    const { accessToken } = await enableRes.json();

    return { userId, email, accessToken, mfaSecret: manualEntryKey };
  }

  // Upload helper for sender
  async function uploadDocument(options = {}) {
    const form = new FormData();
    form.append('receiverEmail', receiver.email);
    form.append('delivery', 'qr');
    form.append('oneTimeUse', options.oneTimeUse ? 'true' : 'false');
    if (options.expiresAt) {
      form.append('expiresAt', options.expiresAt);
    }
    if (options.geofence) {
      form.append('geoLat', String(options.geofence.lat));
      form.append('geoLng', String(options.geofence.lng));
      form.append('geoRadiusMeters', String(options.geofence.radiusMeters));
    }

    const payload = options.content || originalPdfPayload;
    const blob = new Blob([Buffer.from(payload, 'utf8')], {
      type: options.mimeType || 'application/pdf'
    });
    form.append('file', blob, options.filename || 'classified.pdf');

    const res = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sender.accessToken}`
      },
      body: form
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    return {
      document: data.document,
      documentKey: data.documentKey
    };
  }

  // Resets MFA lastUsedStep for receiver between rapid tests
  async function resetReceiverMfaStep() {
    await User.findByIdAndUpdate(receiver.userId, {
      $set: { 'mfa.lastUsedStep': 0, failedLoginAttempts: 0, lockUntil: null }
    });
  }

  before(async () => {
    await mongoose.connect(process.env.MONGO_URI, { autoIndex: true });
    await mongoose.connection.db.dropDatabase();

    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });

    sender = await registerAndMfa('sender.p4@vault.test', 'Password123!Secure', 'Alice Sender');
    receiver = await registerAndMfa('receiver.p4@vault.test', 'Password123!Secure', 'Bob Receiver');
    thirdParty = await registerAndMfa('third.p4@vault.test', 'Password123!Secure', 'Eve ThirdParty');
  });

  after(async () => {
    if (mongoose.connection?.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await mongoose.disconnect();
    await new Promise((resolve) => server.close(resolve));
  });

  let geofencedDocId;
  let geofencedDocKey;

  test('1. Setup: Upload a geofenced document with 500m radius', async () => {
    const uploaded = await uploadDocument({
      geofence: { lat: GEOFENCE_LAT, lng: GEOFENCE_LNG, radiusMeters: GEOFENCE_RADIUS },
      oneTimeUse: false
    });
    geofencedDocId = uploaded.document.id;
    geofencedDocKey = uploaded.documentKey;
    assert.ok(geofencedDocId);
    assert.ok(geofencedDocKey);
  });

  test('2. Receiver metadata inspection: receiver sees hasGeofence but NEVER geofence lat/lng/radius', async () => {
    const res = await fetch(`${baseUrl}/api/documents/${geofencedDocId}`, {
      headers: { Authorization: `Bearer ${receiver.accessToken}` }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();

    assert.strictEqual(data.document.id, geofencedDocId);
    assert.strictEqual(data.document.policy.hasGeofence, true);
    assert.strictEqual(data.document.policy.oneTimeUse, false);
    // CRITICAL SECURITY ASSERTION: No coordinates leaked to receiver!
    assert.strictEqual(data.document.policy.geofence, undefined);
  });

  test('3. Geofence denial: missing coordinates -> 403 location_required', async () => {
    await resetReceiverMfaStep();
    const code = speakeasy.totp({ secret: receiver.mfaSecret, encoding: 'base32' });

    const res = await fetch(`${baseUrl}/api/documents/${geofencedDocId}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${receiver.accessToken}`
      },
      body: JSON.stringify({
        documentKey: geofencedDocKey,
        code
      })
    });

    assert.strictEqual(res.status, 403);
    const errData = await res.json();
    assert.strictEqual(errData.code, 'location_required');
  });

  test('4. Geofence denial: poor accuracy (accuracyMeters > 500) -> 403 location_imprecise', async () => {
    await resetReceiverMfaStep();
    const code = speakeasy.totp({ secret: receiver.mfaSecret, encoding: 'base32' });

    const res = await fetch(`${baseUrl}/api/documents/${geofencedDocId}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${receiver.accessToken}`
      },
      body: JSON.stringify({
        documentKey: geofencedDocKey,
        code,
        lat: GEOFENCE_LAT,
        lng: GEOFENCE_LNG,
        accuracyMeters: 501
      })
    });

    assert.strictEqual(res.status, 403);
    const errData = await res.json();
    assert.strictEqual(errData.code, 'location_imprecise');
  });

  test('5. Geofence denial: outside radius -> 403 outside_area and NOT consumed', async () => {
    await resetReceiverMfaStep();
    const code = speakeasy.totp({ secret: receiver.mfaSecret, encoding: 'base32' });

    // Latitude offset by ~1km
    const res = await fetch(`${baseUrl}/api/documents/${geofencedDocId}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${receiver.accessToken}`
      },
      body: JSON.stringify({
        documentKey: geofencedDocKey,
        code,
        lat: GEOFENCE_LAT + 0.01,
        lng: GEOFENCE_LNG,
        accuracyMeters: 10
      })
    });

    assert.strictEqual(res.status, 403);
    const errData = await res.json();
    assert.strictEqual(errData.code, 'outside_area');

    // Document is still sealed
    const dbDoc = await Document.findById(geofencedDocId).lean().exec();
    assert.strictEqual(dbDoc.status, 'sealed');
  });

  test('6. Geofence success: receiver inside radius -> 200 and bytes EQUAL original payload', async () => {
    await resetReceiverMfaStep();
    const code = speakeasy.totp({ secret: receiver.mfaSecret, encoding: 'base32' });

    const res = await fetch(`${baseUrl}/api/documents/${geofencedDocId}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${receiver.accessToken}`
      },
      body: JSON.stringify({
        documentKey: geofencedDocKey,
        code,
        lat: GEOFENCE_LAT,
        lng: GEOFENCE_LNG,
        accuracyMeters: 20
      })
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
    assert.strictEqual(res.headers.get('cache-control'), 'no-store');
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(res.headers.get('content-disposition').includes('attachment;'));

    const arrayBuffer = await res.arrayBuffer();
    const decryptedText = Buffer.from(arrayBuffer).toString('utf8');
    assert.strictEqual(decryptedText, originalPdfPayload);
  });

  test('7. Expiry denial: expiresAt set in the past via DB -> 410 expired', async () => {
    await resetReceiverMfaStep();
    // Force document expiry in the past
    await Document.findByIdAndUpdate(geofencedDocId, {
      $set: { 'policy.expiresAt': new Date(Date.now() - 10000) }
    });

    const code = speakeasy.totp({ secret: receiver.mfaSecret, encoding: 'base32' });
    const res = await fetch(`${baseUrl}/api/documents/${geofencedDocId}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${receiver.accessToken}`
      },
      body: JSON.stringify({
        documentKey: geofencedDocKey,
        code,
        lat: GEOFENCE_LAT,
        lng: GEOFENCE_LNG,
        accuracyMeters: 20
      })
    });

    assert.strictEqual(res.status, 410);
    const errData = await res.json();
    assert.strictEqual(errData.code, 'expired');

    // Document lazily marked expired
    const updated = await Document.findById(geofencedDocId).lean().exec();
    assert.strictEqual(updated.status, 'expired');
  });

  test('8. Step-up denial: wrong TOTP code -> 401, and 5 consecutive failures lock the account (423)', async () => {
    // Fresh active document
    const fresh = await uploadDocument({ oneTimeUse: false });

    await resetReceiverMfaStep();

    // 4 failed attempts -> 401
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${baseUrl}/api/documents/${fresh.document.id}/open`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${receiver.accessToken}`
        },
        body: JSON.stringify({
          documentKey: fresh.documentKey,
          code: '000000'
        })
      });
      assert.strictEqual(res.status, 401);
    }

    // 5th failed attempt -> locks account
    const fifthRes = await fetch(`${baseUrl}/api/documents/${fresh.document.id}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${receiver.accessToken}`
      },
      body: JSON.stringify({
        documentKey: fresh.documentKey,
        code: '000000'
      })
    });
    assert.strictEqual(fifthRes.status, 401);

    // 6th attempt while locked -> 423 Account Locked
    const lockedRes = await fetch(`${baseUrl}/api/documents/${fresh.document.id}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${receiver.accessToken}`
      },
      body: JSON.stringify({
        documentKey: fresh.documentKey,
        code: '000000'
      })
    });
    assert.strictEqual(lockedRes.status, 423);

    // Unlock account for subsequent tests
    await resetReceiverMfaStep();
  });

  test('9. Replay protection: replayed TOTP code -> 401', async () => {
    const fresh = await uploadDocument({ oneTimeUse: false });
    await resetReceiverMfaStep();

    const code = speakeasy.totp({ secret: receiver.mfaSecret, encoding: 'base32' });

    // First use succeeds
    const firstRes = await fetch(`${baseUrl}/api/documents/${fresh.document.id}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${receiver.accessToken}`
      },
      body: JSON.stringify({
        documentKey: fresh.documentKey,
        code
      })
    });
    assert.strictEqual(firstRes.status, 200);

    // Immediate replay of the exact same TOTP code within same step
    const replayRes = await fetch(`${baseUrl}/api/documents/${fresh.document.id}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${receiver.accessToken}`
      },
      body: JSON.stringify({
        documentKey: fresh.documentKey,
        code
      })
    });
    assert.strictEqual(replayRes.status, 401);
  });

  test('10. Wrong document key: 403 integrity check failed, document remains openable with correct key', async () => {
    const fresh = await uploadDocument({ oneTimeUse: false });
    await resetReceiverMfaStep();

    const wrongKey = crypto.randomBytes(32).toString('base64url');
    const code = speakeasy.totp({ secret: receiver.mfaSecret, encoding: 'base32' });

    const failedRes = await fetch(`${baseUrl}/api/documents/${fresh.document.id}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${receiver.accessToken}`
      },
      body: JSON.stringify({
        documentKey: wrongKey,
        code
      })
    });

    assert.strictEqual(failedRes.status, 403);
    const errData = await failedRes.json();
    assert.strictEqual(errData.code, 'integrity');

    // Document is still sealed and can be unlocked with the right key
    await resetReceiverMfaStep();
    const correctCode = speakeasy.totp({ secret: receiver.mfaSecret, encoding: 'base32' });

    const successRes = await fetch(`${baseUrl}/api/documents/${fresh.document.id}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${receiver.accessToken}`
      },
      body: JSON.stringify({
        documentKey: fresh.documentKey,
        code: correctCode
      })
    });
    assert.strictEqual(successRes.status, 200);
  });

  test('11. One-time-use lifecycle: first open 200, second 410, and ciphertext is wiped from storage', async () => {
    const oneTimeDoc = await uploadDocument({ oneTimeUse: true });
    await resetReceiverMfaStep();

    const dbRecord = await Document.findById(oneTimeDoc.document.id).lean().exec();
    const storageKey = dbRecord.storage.key;
    const storage = getStorage();

    // Ciphertext exists prior to unlock
    assert.strictEqual(await storage.exists(storageKey), true);

    const code1 = speakeasy.totp({ secret: receiver.mfaSecret, encoding: 'base32' });
    const firstRes = await fetch(`${baseUrl}/api/documents/${oneTimeDoc.document.id}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${receiver.accessToken}`
      },
      body: JSON.stringify({
        documentKey: oneTimeDoc.documentKey,
        code: code1
      })
    });
    assert.strictEqual(firstRes.status, 200);

    // Wait 100ms for response 'finish' storage deletion
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Ciphertext is gone from storage
    assert.strictEqual(await storage.exists(storageKey), false);

    // Second open attempt -> 410 consumed
    await resetReceiverMfaStep();
    const code2 = speakeasy.totp({ secret: receiver.mfaSecret, encoding: 'base32' });
    const secondRes = await fetch(`${baseUrl}/api/documents/${oneTimeDoc.document.id}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${receiver.accessToken}`
      },
      body: JSON.stringify({
        documentKey: oneTimeDoc.documentKey,
        code: code2
      })
    });
    assert.strictEqual(secondRes.status, 410);
  });

  test('12. Sender and third party access denial: both receive 404', async () => {
    const fresh = await uploadDocument({ oneTimeUse: false });

    // 1. Sender attempt -> 404
    const senderCode = speakeasy.totp({ secret: sender.mfaSecret, encoding: 'base32' });
    const senderRes = await fetch(`${baseUrl}/api/documents/${fresh.document.id}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sender.accessToken}`
      },
      body: JSON.stringify({
        documentKey: fresh.documentKey,
        code: senderCode
      })
    });
    assert.strictEqual(senderRes.status, 404);

    // 2. Third party attempt -> 404
    const thirdCode = speakeasy.totp({ secret: thirdParty.mfaSecret, encoding: 'base32' });
    const thirdRes = await fetch(`${baseUrl}/api/documents/${fresh.document.id}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${thirdParty.accessToken}`
      },
      body: JSON.stringify({
        documentKey: fresh.documentKey,
        code: thirdCode
      })
    });
    assert.strictEqual(thirdRes.status, 404);
  });

  test('13. Audit log verification: entries exist with zero key or coordinate leakage, and hash chain is intact', async () => {
    const logs = await AuditLog.find().lean().exec();
    assert.ok(logs.length > 0);

    const logJson = JSON.stringify(logs);
    assert.strictEqual(logJson.includes(geofencedDocKey), false, 'Audit must never contain document key');
    assert.strictEqual(logJson.includes(String(GEOFENCE_LAT)), false, 'Audit must never contain latitude');
    assert.strictEqual(logJson.includes(String(GEOFENCE_LNG)), false, 'Audit must never contain longitude');

    const actions = logs.map((l) => l.action);
    assert.ok(actions.includes('DOC_ACCESS_GRANTED'));
    assert.ok(actions.includes('DOC_ACCESS_DENIED'));
    assert.ok(actions.includes('DOC_DECRYPTED'));

    // Cryptographic hash chain validation
    const chainResult = await verifyChain();
    assert.strictEqual(chainResult.valid, true);
    assert.ok(chainResult.checked > 0);
  });
});
