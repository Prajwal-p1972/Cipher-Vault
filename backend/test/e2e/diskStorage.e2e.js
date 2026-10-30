import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const testDiskDir = path.join(os.tmpdir(), `cipher-vault-disk-e2e-${Date.now()}`);

// Environment configuration MUST be set before importing any src modules
process.env.NODE_ENV = 'test';
process.env.PORT = '5003';
process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/cipher_vault_test';
process.env.CLIENT_ORIGIN = 'http://localhost:3000';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
process.env.MFA_ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.AUDIT_HMAC_KEY = 'c'.repeat(40);
process.env.RATE_LIMIT_MAX = '1000';
process.env.STORAGE_DRIVER = 'disk';
process.env.STORAGE_DIR = testDiskDir;
process.env.MAX_UPLOAD_BYTES = '26214400';
process.env.GEO_MAX_ACCURACY_METERS = '500';
process.env.UNLOCK_MAX_PER_15MIN = '100';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import speakeasy from 'speakeasy';

const { default: app } = await import('../../src/app.js');
const { default: mongoose } = await import('mongoose');
const { User } = await import('../../src/models/User.js');
const { Document } = await import('../../src/models/Document.js');
const { AuditLog } = await import('../../src/models/AuditLog.js');
const { resetStorage, getStorage } = await import('../../src/services/storage/index.js');

describe('Disk Storage Driver E2E Persistence & Ciphertext Verification', () => {
  let server;
  let baseUrl;

  let sender;
  let receiver;

  const originalPdfPayload = '%PDF-1.7\n%CONFIDENTIAL CIPHER VAULT HIGH-SECURITY MEMO SECRET TEXT 98765';

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

    const confirmRes = await fetch(`${baseUrl}/api/auth/mfa/enable`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${setupToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ code })
    });
    assert.strictEqual(confirmRes.status, 200);
    const { accessToken } = await confirmRes.json();

    return { id: userId, email, accessToken, totpSecret: manualEntryKey };
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

    sender = await registerAndMfa('alice_disk@vault.test', 'Password123!Secure', 'Alice Sender');
    receiver = await registerAndMfa('bob_disk@vault.test', 'Password123!Secure', 'Bob Receiver');
  });

  after(async () => {
    if (mongoose.connection?.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await mongoose.disconnect();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    try {
      await fs.promises.rm(testDiskDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test('sealed document is written to disk as ciphertext, survives resetStorage, and opens successfully', async () => {
    // 1. Upload/seal document with recipient = receiver.email
    const form = new FormData();
    form.append('receiverEmail', receiver.email);
    form.append('delivery', 'qr');
    form.append('oneTimeUse', 'false');

    const blob = new Blob([Buffer.from(originalPdfPayload, 'utf8')], {
      type: 'application/pdf'
    });
    form.append('file', blob, 'confidential.pdf');

    const sealRes = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sender.accessToken}`
      },
      body: form
    });
    assert.strictEqual(sealRes.status, 201);
    const sealData = await sealRes.json();
    const documentId = sealData.document.id;
    const documentKey = sealData.documentKey;

    // 2. Fetch document record from database to inspect storage key
    const docRecord = await Document.findById(documentId);
    assert.ok(docRecord);
    assert.match(docRecord.storage.key, /^docs\/[0-9a-f-]{36}\.bin$/);

    // 3. Verify the file on disk is purely CIPHERTEXT (no plaintext PDF header or text)
    const diskFilePath = path.join(testDiskDir, docRecord.storage.key);
    assert.ok(fs.existsSync(diskFilePath), 'Ciphertext blob file must exist on disk');

    const fileContent = await fs.promises.readFile(diskFilePath);
    assert.strictEqual(
      fileContent.includes(Buffer.from('%PDF-1.7')),
      false,
      'Disk file must NOT contain plaintext PDF header'
    );
    assert.strictEqual(
      fileContent.includes(Buffer.from('SECRET TEXT')),
      false,
      'Disk file must NOT contain plaintext document content'
    );

    // 4. Simulate server restart: resetStorage()
    resetStorage();
    const newStorage = getStorage();
    assert.strictEqual(await newStorage.exists(docRecord.storage.key), true);

    // 5. Receiver opens the document using the key and TOTP
    await User.findByIdAndUpdate(receiver.id, {
      $set: { 'mfa.lastUsedStep': 0, failedLoginAttempts: 0, lockUntil: null }
    });
    const totpCode = speakeasy.totp({ secret: receiver.totpSecret, encoding: 'base32' });

    const openRes = await fetch(`${baseUrl}/api/documents/${documentId}/open`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${receiver.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        documentKey,
        code: totpCode
      })
    });

    assert.strictEqual(openRes.status, 200);
    assert.strictEqual(openRes.headers.get('content-type'), 'application/pdf');

    const decryptedBuffer = Buffer.from(await openRes.arrayBuffer());
    assert.strictEqual(decryptedBuffer.toString('utf8'), originalPdfPayload);
  });
});
