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

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import speakeasy from 'speakeasy';
import { io as ioc } from 'socket.io-client';

// Dynamic imports to ensure process.env variables are initialized
const { default: app } = await import('../../src/app.js');
const { default: mongoose } = await import('mongoose');
const { AuditLog } = await import('../../src/models/AuditLog.js');
const { verifyChain } = await import('../../src/services/auditService.js');
const { initSocketServer, closeSocketServer } = await import('../../src/realtime/socketServer.js');

describe('Phase 3 End-to-End Test Suite: Real-Time Sealed Document Notifications', () => {
  let server;
  let baseUrl;

  // Helper to register and enable MFA for a user
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
    assert.ok(accessToken);

    return { userId, email, accessToken };
  }

  function createSocketClient(token) {
    return ioc(baseUrl, {
      transports: ['websocket'],
      auth: { token },
      autoConnect: true,
      reconnection: false
    });
  }

  before(async () => {
    await mongoose.connect(process.env.MONGO_URI, { autoIndex: true });
    await mongoose.connection.db.dropDatabase();

    server = http.createServer(app);
    initSocketServer(server);

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await closeSocketServer();
    if (mongoose.connection?.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await mongoose.disconnect();
    await new Promise((resolve) => server.close(resolve));
  });

  let sender;
  let receiver;
  let thirdParty;

  test('1. Setup: Register and MFA-enable sender, receiver, and third-party users', async () => {
    sender = await registerAndMfa('p3_sender@vault.test', 'Password123!Secure', 'Alice Sender');
    receiver = await registerAndMfa('p3_receiver@vault.test', 'Password123!Secure', 'Bob Receiver');
    thirdParty = await registerAndMfa('p3_third@vault.test', 'Password123!Secure', 'Eve ThirdParty');

    assert.ok(sender.userId);
    assert.ok(receiver.userId);
    assert.ok(thirdParty.userId);
  });

  test('2. Receiver receives real-time document:sealed within 2s, third party gets nothing, delivered:true audited', async () => {
    const receiverSocket = createSocketClient(receiver.accessToken);
    const thirdPartySocket = createSocketClient(thirdParty.accessToken);

    await Promise.all([
      new Promise((res) => receiverSocket.on('connect', res)),
      new Promise((res) => thirdPartySocket.on('connect', res))
    ]);

    let thirdPartyReceived = false;
    thirdPartySocket.on('document:sealed', () => {
      thirdPartyReceived = true;
    });

    const notificationPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Notification not received within 2s timeout'));
      }, 2000);

      receiverSocket.on('document:sealed', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });
    });

    // Upload document as sender targeting receiver
    const form = new FormData();
    form.append('receiverEmail', receiver.email);
    form.append('delivery', 'qr');
    form.append('oneTimeUse', 'true');
    const pdfBlob = new Blob([Buffer.from('%PDF-1.7\nRealtime notification test document', 'utf8')], {
      type: 'application/pdf'
    });
    form.append('file', pdfBlob, 'dispatch.pdf');

    const uploadRes = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sender.accessToken}`
      },
      body: form
    });

    assert.strictEqual(uploadRes.status, 201);
    const uploadData = await uploadRes.json();
    assert.ok(uploadData.document?.id);

    // Wait for receiver socket notification
    const notification = await notificationPromise;
    assert.strictEqual(notification.documentId, uploadData.document.id);
    assert.strictEqual(notification.originalName, 'dispatch.pdf');
    assert.strictEqual(notification.mimeType, 'application/pdf');
    assert.strictEqual(notification.oneTimeUse, true);

    // Ensure third party socket received nothing
    await new Promise((res) => setTimeout(res, 100));
    assert.strictEqual(thirdPartyReceived, false);

    // Verify DOC_NOTIFIED audit log with delivered: true
    const auditEntry = await AuditLog.findOne({
      action: 'DOC_NOTIFIED',
      'resource.id': uploadData.document.id
    }).lean();

    assert.ok(auditEntry);
    assert.strictEqual(auditEntry.meta.delivered, true);

    receiverSocket.disconnect();
    thirdPartySocket.disconnect();
  });

  test('3. With receiver offline, upload returns 201 and DOC_NOTIFIED audit logs delivered:false', async () => {
    // Both receiver and third party are disconnected
    const form = new FormData();
    form.append('receiverEmail', receiver.email);
    form.append('delivery', 'qr');
    form.append('oneTimeUse', 'false');
    const pdfBlob = new Blob([Buffer.from('%PDF-1.7\nOffline delivery test document', 'utf8')], {
      type: 'application/pdf'
    });
    form.append('file', pdfBlob, 'offline.pdf');

    const uploadRes = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sender.accessToken}`
      },
      body: form
    });

    assert.strictEqual(uploadRes.status, 201);
    const uploadData = await uploadRes.json();
    assert.ok(uploadData.document?.id);
    assert.ok(uploadData.documentKey);

    // Allow async notification promise to finish
    await new Promise((res) => setTimeout(res, 200));

    // Verify DOC_NOTIFIED audit log with delivered: false
    const auditEntry = await AuditLog.findOne({
      action: 'DOC_NOTIFIED',
      'resource.id': uploadData.document.id
    }).lean();

    assert.ok(auditEntry);
    assert.strictEqual(auditEntry.meta.delivered, false);
  });

  test('4. Cryptographic audit chain remains valid and unbroken', async () => {
    const chainVerification = await verifyChain();
    assert.strictEqual(chainVerification.valid, true);
    assert.ok(chainVerification.checked > 0);
  });
});
