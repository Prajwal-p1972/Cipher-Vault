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

const { default: app } = await import('../../src/app.js');
const { default: mongoose } = await import('mongoose');
const { User } = await import('../../src/models/User.js');
const { Document } = await import('../../src/models/Document.js');
const { AuditLog } = await import('../../src/models/AuditLog.js');
const { verifyChain } = await import('../../src/services/auditService.js');

const { subtle } = crypto.webcrypto;

/**
 * Emulates client-side Web Crypto API unwrapping of document key envelope.
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

  return Buffer.from(decrypted).toString('base64url');
}

describe('Phase 7 End-to-End Test Suite: End-to-End Key Delivery by Public-Key Wrapping', () => {
  let server;
  let baseUrl;

  let sender;
  let receiver;
  let thirdParty;

  let receiverKeyPair;
  let receiverRawPubB64Url;

  const originalPdfPayload = '%PDF-1.7\n%CONFIDENTIAL PHASE 7 PUBLIC-KEY WRAPPING VAULT MEMO';
  const GEOFENCE_LAT = 37.7749;
  const GEOFENCE_LNG = -122.4194;
  const GEOFENCE_RADIUS = 500;

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

  async function resetUserMfaStep(userId) {
    await User.findByIdAndUpdate(userId, {
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

    sender = await registerAndMfa('sender.p7@vault.test', 'Password123!Secure', 'Alice Sender');
    receiver = await registerAndMfa('receiver.p7@vault.test', 'Password123!Secure', 'Bob Receiver');
    thirdParty = await registerAndMfa('third.p7@vault.test', 'Password123!Secure', 'Eve ThirdParty');

    // Generate WebCrypto receiver ECDH P-256 key pair
    receiverKeyPair = await subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits', 'deriveKey']
    );
    const rawPub = await subtle.exportKey('raw', receiverKeyPair.publicKey);
    receiverRawPubB64Url = Buffer.from(rawPub).toString('base64url');
  });

  after(async () => {
    if (mongoose.connection?.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await mongoose.disconnect();
    await new Promise((resolve) => server.close(resolve));
  });

  test('1. Receiver key registration: wrong TOTP code fails with 401 and stores nothing', async () => {
    const res = await fetch(`${baseUrl}/api/keys/me`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${receiver.accessToken}`
      },
      body: JSON.stringify({
        publicKey: receiverRawPubB64Url,
        code: '000000'
      })
    });

    assert.strictEqual(res.status, 401);

    // Verify key status remains unregistered
    const getRes = await fetch(`${baseUrl}/api/keys/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${receiver.accessToken}` }
    });
    assert.strictEqual(getRes.status, 200);
    const getData = await getRes.json();
    assert.strictEqual(getData.registered, false);

    // Verify MongoDB user document
    const userDoc = await User.findById(receiver.userId).lean();
    assert.strictEqual(userDoc.vaultKey?.publicKey ?? null, null);
  });

  test('2. Receiver key registration: valid TOTP code stores key and returns fingerprint', async () => {
    await resetUserMfaStep(receiver.userId);
    const code = speakeasy.totp({ secret: receiver.mfaSecret, encoding: 'base32' });

    const res = await fetch(`${baseUrl}/api/keys/me`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${receiver.accessToken}`
      },
      body: JSON.stringify({
        publicKey: receiverRawPubB64Url,
        code
      })
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('cache-control'), 'no-store');
    const data = await res.json();
    assert.ok(data.keyId);
    assert.ok(data.fingerprint);
    assert.ok(data.registeredAt);

    // Query /api/keys/me
    const getRes = await fetch(`${baseUrl}/api/keys/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${receiver.accessToken}` }
    });
    assert.strictEqual(getRes.status, 200);
    const meData = await getRes.json();
    assert.strictEqual(meData.registered, true);
    assert.strictEqual(meData.keyId, data.keyId);
    assert.strictEqual(meData.fingerprint, data.fingerprint);

    // Query /api/keys/receiver?email=
    const lookupRes = await fetch(
      `${baseUrl}/api/keys/receiver?email=${encodeURIComponent(receiver.email)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${sender.accessToken}` }
      }
    );
    assert.strictEqual(lookupRes.status, 200);
    const lookupData = await lookupRes.json();
    assert.strictEqual(lookupData.registered, true);
    assert.strictEqual(lookupData.fingerprint, data.fingerprint);
  });

  test('3. Sealing wrapped document to receiver WITHOUT a vault key returns 409 conflict', async () => {
    const form = new FormData();
    form.append('receiverEmail', thirdParty.email);
    form.append('delivery', 'wrapped');
    const blob = new Blob([Buffer.from(originalPdfPayload, 'utf8')], { type: 'application/pdf' });
    form.append('file', blob, 'secret.pdf');

    const res = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sender.accessToken}` },
      body: form
    });

    assert.strictEqual(res.status, 409);
    const data = await res.json();
    assert.strictEqual(data.error, 'Receiver has not set up a vault key yet');
  });

  let sealedWrappedDocId;
  test('4. Sealing wrapped document returns 201 with NO documentKey and DB document contains envelope', async () => {
    const form = new FormData();
    form.append('receiverEmail', receiver.email);
    form.append('delivery', 'wrapped');
    form.append('geoLat', String(GEOFENCE_LAT));
    form.append('geoLng', String(GEOFENCE_LNG));
    form.append('geoRadiusMeters', String(GEOFENCE_RADIUS));

    const blob = new Blob([Buffer.from(originalPdfPayload, 'utf8')], { type: 'application/pdf' });
    form.append('file', blob, 'wrapped-memo.pdf');

    const res = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sender.accessToken}` },
      body: form
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.document);
    assert.strictEqual(data.documentKey, undefined, 'Wrapped delivery response must NOT contain documentKey');
    assert.strictEqual(data.document.delivery, 'wrapped');
    assert.strictEqual(data.document.keyEnvelope, undefined, 'toPublicDoc must NEVER leak keyEnvelope');

    sealedWrappedDocId = data.document.id;

    // Direct MongoDB verification
    const dbDoc = await Document.findById(sealedWrappedDocId).lean();
    assert.strictEqual(dbDoc.delivery, 'wrapped');
    assert.ok(dbDoc.keyEnvelope, 'DB document must store keyEnvelope');
    assert.strictEqual(dbDoc.keyEnvelope.v, 1);
    assert.strictEqual(dbDoc.keyEnvelope.alg, 'ECDH-P256-HKDF-SHA256-A256GCM');
    assert.ok(dbDoc.keyEnvelope.epk);
    assert.ok(dbDoc.keyEnvelope.salt);
    assert.ok(dbDoc.keyEnvelope.iv);
    assert.ok(dbDoc.keyEnvelope.ct);

    // Deep scan DB document: ensure no plaintext/raw decryption keys are present
    const docJson = JSON.stringify(dbDoc);
    assert.strictEqual(docJson.includes('documentKey'), false);
    assert.strictEqual(docJson.includes('aesKey'), false);
  });

  test('5. Envelope retrieval access control: sender and thirdParty get 404, receiver gets 200', async () => {
    // Sender gets 404
    const senderRes = await fetch(`${baseUrl}/api/documents/${sealedWrappedDocId}/key-envelope`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${sender.accessToken}` }
    });
    assert.strictEqual(senderRes.status, 404);
    const senderData = await senderRes.json();
    assert.strictEqual(senderData.error, 'Document not found');

    // Third party gets 404
    const thirdRes = await fetch(`${baseUrl}/api/documents/${sealedWrappedDocId}/key-envelope`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${thirdParty.accessToken}` }
    });
    assert.strictEqual(thirdRes.status, 404);
    const thirdData = await thirdRes.json();
    assert.strictEqual(thirdData.error, 'Document not found');

    // Receiver gets 200
    const receiverRes = await fetch(`${baseUrl}/api/documents/${sealedWrappedDocId}/key-envelope`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${receiver.accessToken}` }
    });
    assert.strictEqual(receiverRes.status, 200);
    assert.strictEqual(receiverRes.headers.get('cache-control'), 'no-store');
    const receiverData = await receiverRes.json();
    assert.ok(receiverData.envelope);
    assert.strictEqual(receiverData.envelope.v, 1);
  });

  test('6. Receiver unwraps envelope using WebCrypto and successfully opens document with MFA and geofence', async () => {
    // 1) Fetch envelope
    const envRes = await fetch(`${baseUrl}/api/documents/${sealedWrappedDocId}/key-envelope`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${receiver.accessToken}` }
    });
    const { envelope } = await envRes.json();

    // 2) Unwrap with WebCrypto
    const unwrappedDocKeyB64Url = await webCryptoUnwrap(
      envelope,
      receiverKeyPair.privateKey,
      sealedWrappedDocId,
      receiver.userId
    );
    assert.ok(unwrappedDocKeyB64Url);

    // 3) Attempt open with invalid TOTP -> 401
    const invalidTotpRes = await fetch(`${baseUrl}/api/documents/${sealedWrappedDocId}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${receiver.accessToken}`
      },
      body: JSON.stringify({
        documentKey: unwrappedDocKeyB64Url,
        code: '999999',
        lat: GEOFENCE_LAT,
        lng: GEOFENCE_LNG,
        accuracyMeters: 10
      })
    });
    assert.strictEqual(invalidTotpRes.status, 401);

    // 4) Attempt open with location outside geofence -> 403
    await resetUserMfaStep(receiver.userId);
    const validCode1 = speakeasy.totp({ secret: receiver.mfaSecret, encoding: 'base32' });
    const outsideGeoRes = await fetch(`${baseUrl}/api/documents/${sealedWrappedDocId}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${receiver.accessToken}`
      },
      body: JSON.stringify({
        documentKey: unwrappedDocKeyB64Url,
        code: validCode1,
        lat: GEOFENCE_LAT + 1.0,
        lng: GEOFENCE_LNG + 1.0,
        accuracyMeters: 10
      })
    });
    assert.strictEqual(outsideGeoRes.status, 403);

    // 5) Open with valid TOTP and inside geofence -> 200 with original bytes
    await resetUserMfaStep(receiver.userId);
    const validCode2 = speakeasy.totp({ secret: receiver.mfaSecret, encoding: 'base32' });
    const openRes = await fetch(`${baseUrl}/api/documents/${sealedWrappedDocId}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${receiver.accessToken}`
      },
      body: JSON.stringify({
        documentKey: unwrappedDocKeyB64Url,
        code: validCode2,
        lat: GEOFENCE_LAT,
        lng: GEOFENCE_LNG,
        accuracyMeters: 10
      })
    });
    assert.strictEqual(openRes.status, 200);
    const retrievedBuffer = Buffer.from(await openRes.arrayBuffer());
    assert.strictEqual(retrievedBuffer.toString('utf8'), originalPdfPayload);
  });

  test('7. Stolen-token style key replacement without valid TOTP fails', async () => {
    const maliciousEcdh = crypto.createECDH('prime256v1');
    maliciousEcdh.generateKeys();
    const maliciousKeyB64Url = maliciousEcdh.getPublicKey().toString('base64url');

    const res = await fetch(`${baseUrl}/api/keys/me`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${receiver.accessToken}`
      },
      body: JSON.stringify({
        publicKey: maliciousKeyB64Url,
        code: '111111'
      })
    });
    assert.strictEqual(res.status, 401);

    // Verify receiver key was NOT overwritten
    const checkRes = await fetch(`${baseUrl}/api/keys/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${receiver.accessToken}` }
    });
    const checkData = await checkRes.json();
    const expectedKeyId = crypto.createHash('sha256').update(Buffer.from(receiverRawPubB64Url, 'base64url')).digest('hex').toLowerCase();
    assert.strictEqual(checkData.keyId, expectedKeyId);
  });

  test('8. QR-mode document works as before and key-envelope returns 404', async () => {
    const form = new FormData();
    form.append('receiverEmail', receiver.email);
    form.append('delivery', 'qr');

    const blob = new Blob([Buffer.from(originalPdfPayload, 'utf8')], { type: 'application/pdf' });
    form.append('file', blob, 'qr-memo.pdf');

    const res = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sender.accessToken}` },
      body: form
    });

    assert.strictEqual(res.status, 201);
    const data = await res.json();
    assert.ok(data.documentKey, 'QR-mode document response must contain documentKey');
    assert.strictEqual(data.document.delivery, 'qr');

    const qrDocId = data.document.id;

    // Key envelope endpoint returns 404 for QR mode documents
    const envRes = await fetch(`${baseUrl}/api/documents/${qrDocId}/key-envelope`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${receiver.accessToken}` }
    });
    assert.strictEqual(envRes.status, 404);

    // Opening with documentKey directly works
    await resetUserMfaStep(receiver.userId);
    const code = speakeasy.totp({ secret: receiver.mfaSecret, encoding: 'base32' });
    const openRes = await fetch(`${baseUrl}/api/documents/${qrDocId}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${receiver.accessToken}`
      },
      body: JSON.stringify({
        documentKey: data.documentKey,
        code
      })
    });
    assert.strictEqual(openRes.status, 200);
    const bytes = Buffer.from(await openRes.arrayBuffer());
    assert.strictEqual(bytes.toString('utf8'), originalPdfPayload);
  });

  test('9. Audit chain verifies and contains KEY_REGISTERED and DOC_SEALED meta.delivery without data leaks', async () => {
    const chainVerification = await verifyChain();
    assert.strictEqual(chainVerification.valid, true);

    const logs = await AuditLog.find().sort({ seq: 1 }).lean();

    const registeredLog = logs.find((l) => l.action === 'KEY_REGISTERED');
    assert.ok(registeredLog, 'Audit log must contain KEY_REGISTERED');
    assert.ok(registeredLog.meta?.keyId);

    const sealedLogs = logs.filter((l) => l.action === 'DOC_SEALED');
    assert.ok(sealedLogs.length >= 2, 'Audit log must contain sealed documents');
    assert.ok(sealedLogs.some((l) => l.meta?.delivery === 'wrapped'));
    assert.ok(sealedLogs.some((l) => l.meta?.delivery === 'qr'));

    // Deep scan for sensitive data leakage in audit records
    for (const log of logs) {
      const logStr = JSON.stringify(log);
      assert.strictEqual(logStr.includes('documentKey'), false, 'No documentKey in audit log');
      assert.strictEqual(logStr.includes('keyEnvelope'), false, 'No keyEnvelope in audit log');
      assert.strictEqual(logStr.includes('sharedSecret'), false, 'No sharedSecret in audit log');
      assert.strictEqual(logStr.includes(receiverRawPubB64Url), false, 'Raw public key must not leak into audit logs');
    }
  });
});
