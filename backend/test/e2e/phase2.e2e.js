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

// Dynamic imports to ensure process.env variables are initialized
const { default: app } = await import('../../src/app.js');
const { default: mongoose } = await import('mongoose');
const { User } = await import('../../src/models/User.js');
const { Document } = await import('../../src/models/Document.js');
const { AuditLog } = await import('../../src/models/AuditLog.js');
const { verifyChain } = await import('../../src/services/auditService.js');
const { getStorage } = await import('../../src/services/storage/index.js');

describe('Phase 2 End-to-End Test Suite: Cryptographic Engine, Upload & Storage', () => {
  let server;
  let baseUrl;

  // Helper to register and enable MFA for a user
  async function registerAndMfa(email, password, displayName) {
    // 1. Register
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName })
    });
    assert.strictEqual(regRes.status, 201, `Failed to register ${email}`);
    const regData = await regRes.json();
    const userId = regData.user.id;

    // 2. Login to get setupToken
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    assert.strictEqual(loginRes.status, 200);
    const { setupToken } = await loginRes.json();

    // 3. Initiate MFA setup
    const setupRes = await fetch(`${baseUrl}/api/auth/mfa/setup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${setupToken}` }
    });
    assert.strictEqual(setupRes.status, 200);
    const { manualEntryKey } = await setupRes.json();

    // 4. Generate code and enable MFA
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
  });

  after(async () => {
    if (mongoose.connection?.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await mongoose.disconnect();
    await new Promise((resolve) => server.close(resolve));
  });

  let sender;
  let receiver;
  let thirdParty;
  let createdDocumentId;
  let createdDocumentKey;
  const samplePdfContent = '%PDF-1.7\n%CONFIDENTIAL TOP SECRET VAULT PAYLOAD';

  test('1. Setup: Register and MFA-enable sender, receiver, and third party users', async () => {
    sender = await registerAndMfa('sender@vault.test', 'Password123!Secure', 'Alice Sender');
    receiver = await registerAndMfa('receiver@vault.test', 'Password123!Secure', 'Bob Receiver');
    thirdParty = await registerAndMfa('thirdparty@vault.test', 'Password123!Secure', 'Eve Observer');

    assert.ok(sender.userId);
    assert.ok(receiver.userId);
    assert.ok(thirdParty.userId);
  });

  test('2. Upload a valid multipart PDF as sender -> 201 with documentKey and no secrets leak', async () => {
    const form = new FormData();
    form.append('receiverEmail', receiver.email);
    form.append('delivery', 'qr');
    form.append('oneTimeUse', 'true');
    const pdfBlob = new Blob([Buffer.from(samplePdfContent, 'utf8')], {
      type: 'application/pdf'
    });
    form.append('file', pdfBlob, 'agreement.pdf');

    const res = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sender.accessToken}`
      },
      body: form
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.headers.get('cache-control'), 'no-store');

    const data = await res.json();
    assert.ok(data.document);
    assert.ok(data.document.id);
    assert.strictEqual(data.document.sender, sender.userId);
    assert.strictEqual(data.document.receiver, receiver.userId);
    assert.strictEqual(data.document.originalName, 'agreement.pdf');
    assert.strictEqual(data.document.mimeType, 'application/pdf');
    assert.strictEqual(data.document.status, 'sealed');

    // Confidential internals must not leak in public response
    assert.strictEqual(data.document.storage, undefined);
    assert.strictEqual(data.document.crypto, undefined);
    assert.strictEqual(data.document.documentKey, undefined);

    // Document key returned once
    assert.ok(data.documentKey);
    assert.strictEqual(typeof data.documentKey, 'string');
    assert.strictEqual(Buffer.from(data.documentKey, 'base64url').length, 32);

    createdDocumentId = data.document.id;
    createdDocumentKey = data.documentKey;
  });

  test('3. Receiver lists received documents and sees the sealed document', async () => {
    const res = await fetch(`${baseUrl}/api/documents/received`, {
      headers: {
        Authorization: `Bearer ${receiver.accessToken}`
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('cache-control'), 'no-store');

    const data = await res.json();
    assert.ok(Array.isArray(data.documents));
    const found = data.documents.find((d) => d.id === createdDocumentId);
    assert.ok(found);
    assert.strictEqual(found.originalName, 'agreement.pdf');
    assert.strictEqual(found.sender, sender.userId);
  });

  test('4. Sender lists sent documents and sees the sealed document', async () => {
    const res = await fetch(`${baseUrl}/api/documents/sent`, {
      headers: {
        Authorization: `Bearer ${sender.accessToken}`
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('cache-control'), 'no-store');

    const data = await res.json();
    assert.ok(Array.isArray(data.documents));
    const found = data.documents.find((d) => d.id === createdDocumentId);
    assert.ok(found);
  });

  test('5. Third-party user receives 404 when querying document metadata (/:id)', async () => {
    const res = await fetch(`${baseUrl}/api/documents/${createdDocumentId}`, {
      headers: {
        Authorization: `Bearer ${thirdParty.accessToken}`
      }
    });

    // Zero-knowledge: existence is not revealed to third party
    assert.strictEqual(res.status, 404);
  });

  test('6. Sender cannot send a document to themselves -> 400', async () => {
    const form = new FormData();
    form.append('receiverEmail', sender.email);
    const pdfBlob = new Blob([Buffer.from(samplePdfContent, 'utf8')], {
      type: 'application/pdf'
    });
    form.append('file', pdfBlob, 'self.pdf');

    const res = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sender.accessToken}`
      },
      body: form
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Receiver cannot be the sender/i);
  });

  test('7. Executable (.exe) disguised as .pdf is rejected with 400', async () => {
    const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const form = new FormData();
    form.append('receiverEmail', receiver.email);
    const fakeBlob = new Blob([exeBuffer], { type: 'application/pdf' });
    form.append('file', fakeBlob, 'trojan.pdf');

    const res = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sender.accessToken}`
      },
      body: form
    });

    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /unsupported file type or invalid magic bytes/i);
  });

  test('8. Oversized upload exceeding MAX_UPLOAD_BYTES is rejected with 413', async () => {
    const maxBytes = Number(process.env.MAX_UPLOAD_BYTES);
    const oversizedBuffer = Buffer.alloc(maxBytes + 1024, 0x25); // '%...'

    const form = new FormData();
    form.append('receiverEmail', receiver.email);
    const largeBlob = new Blob([oversizedBuffer], { type: 'application/pdf' });
    form.append('file', largeBlob, 'oversized.pdf');

    const res = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sender.accessToken}`
      },
      body: form
    });

    assert.strictEqual(res.status, 413);
  });

  test('9. Missing authorization token returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/documents/received`);
    assert.strictEqual(res.status, 401);

    const postRes = await fetch(`${baseUrl}/api/documents`, {
      method: 'POST'
    });
    assert.strictEqual(postRes.status, 401);
  });

  test('10. Stored object in storage adapter is pure ciphertext (no plaintext leakage)', async () => {
    const docInDb = await Document.findById(createdDocumentId).lean();
    assert.ok(docInDb);
    assert.ok(docInDb.storage?.key);

    const storage = getStorage();
    const storedBytes = await storage.get(docInDb.storage.key);

    assert.ok(Buffer.isBuffer(storedBytes));
    // Verify PDF magic header and plaintext strings do NOT appear in stored payload
    assert.strictEqual(storedBytes.includes(Buffer.from('%PDF-')), false);
    assert.strictEqual(storedBytes.includes(Buffer.from('TOP SECRET')), false);
    assert.strictEqual(storedBytes.includes(Buffer.from('PAYLOAD')), false);
  });

  test('11. Database Document record strictly contains NO key material', async () => {
    const docInDb = await Document.findById(createdDocumentId).lean();
    const serialized = JSON.stringify(docInDb);

    assert.strictEqual(serialized.includes(createdDocumentKey), false);

    const rawKeyHex = Buffer.from(createdDocumentKey, 'base64url').toString('hex');
    assert.strictEqual(serialized.includes(rawKeyHex), false);
    assert.strictEqual(docInDb.documentKey, undefined);
    assert.strictEqual(docInDb.key, undefined);
  });

  test('12. DOC_SEALED audit entry exists and cryptographic audit chain verifies', async () => {
    const auditEntry = await AuditLog.findOne({
      action: 'DOC_SEALED',
      'resource.id': createdDocumentId
    }).lean();

    assert.ok(auditEntry);
    assert.strictEqual(auditEntry.actor.toString(), sender.userId);
    assert.strictEqual(auditEntry.outcome, 'success');
    assert.strictEqual(auditEntry.resource.kind, 'document');

    const chainVerification = await verifyChain();
    assert.strictEqual(chainVerification.valid, true);
    assert.ok(chainVerification.checked > 0);
  });
});
