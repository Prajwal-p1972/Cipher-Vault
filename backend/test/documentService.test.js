import './setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import {
  sealDocument,
  openDocumentToBuffer,
  listMyDocuments,
  getDocumentMeta,
  validatePolicy
} from '../src/services/documentService.js';
import { MemoryStorage } from '../src/services/storage/memoryStorage.js';

describe('Document Service Unit Tests (Mocked DB & Storage)', () => {
  let docsMap;
  let usersMap;
  let auditLogs;
  let storage;
  let mockDeps;

  const senderId = new mongoose.Types.ObjectId().toString();
  const receiverId = new mongoose.Types.ObjectId().toString();
  const thirdPartyId = new mongoose.Types.ObjectId().toString();
  const receiverEmail = 'alice@example.com';

  beforeEach(() => {
    docsMap = new Map();
    usersMap = new Map();
    auditLogs = [];
    storage = new MemoryStorage();

    usersMap.set(receiverEmail, {
      _id: new mongoose.Types.ObjectId(receiverId),
      email: receiverEmail,
      displayName: 'Alice Receiver'
    });

    const MockDocument = function (data) {
      this._id = data._id || new mongoose.Types.ObjectId();
      Object.assign(this, data);
      this.save = async () => {
        const plain = { ...this };
        docsMap.set(this._id.toString(), plain);
        return this;
      };
      this.toObject = () => ({ ...this });
    };

    MockDocument.findById = (id) => {
      const idStr = id.toString();
      const doc = docsMap.get(idStr);
      return {
        lean: () => ({
          exec: async () => (doc ? JSON.parse(JSON.stringify(doc)) : null)
        }),
        exec: async () => (doc ? new MockDocument(doc) : null)
      };
    };

    MockDocument.find = (query) => {
      let matched = Array.from(docsMap.values()).filter((d) => {
        if (query.sender && d.sender !== query.sender) return false;
        if (query.receiver && d.receiver !== query.receiver) return false;
        return true;
      });
      return {
        sort: () => ({
          limit: (n) => ({
            lean: () => ({
              exec: async () => matched.slice(0, n)
            })
          })
        })
      };
    };

    MockDocument.findByIdAndDelete = (id) => {
      const idStr = id.toString();
      docsMap.delete(idStr);
      return {
        exec: async () => true
      };
    };

    const MockUser = {
      findOne: (query) => ({
        lean: () => ({
          exec: async () => usersMap.get(query.email) || null
        })
      })
    };

    const mockAudit = async (entry) => {
      auditLogs.push(entry);
      return entry;
    };

    mockDeps = {
      Document: MockDocument,
      User: MockUser,
      audit: mockAudit,
      storage
    };
  });

  it('performs seal and open round-trip for PDF, JPEG, and ZIP payloads', async () => {
    const files = [
      {
        buffer: Buffer.from('%PDF-1.7\nSample confidential contract stream'),
        originalName: 'agreement.pdf',
        declaredMime: 'application/pdf'
      },
      {
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x01]),
        originalName: 'passport.jpg',
        declaredMime: 'image/jpeg'
      },
      {
        buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]),
        originalName: 'bundle.zip',
        declaredMime: 'application/zip'
      }
    ];

    for (const file of files) {
      const { document, documentKey } = await sealDocument(
        {
          senderId,
          receiverEmail,
          file,
          policy: { oneTimeUse: true }
        },
        { ip: '127.0.0.1' },
        mockDeps
      );

      assert.ok(document.id);
      assert.strictEqual(document.originalName, file.originalName);
      assert.strictEqual(typeof documentKey, 'string');
      assert.strictEqual(Buffer.from(documentKey, 'base64url').length, 32);

      const opened = await openDocumentToBuffer(
        {
          documentId: document.id,
          documentKeyB64Url: documentKey
        },
        { userId: receiverId },
        mockDeps
      );

      assert.deepStrictEqual(opened.buffer, file.buffer);
      assert.strictEqual(opened.mimeType, file.declaredMime);
      assert.strictEqual(opened.originalName, file.originalName);
    }
  });

  it('rejects tampered stored ciphertext and NEVER constructs the decipher', async () => {
    const file = {
      buffer: Buffer.from('%PDF-1.7\nTop secret content'),
      originalName: 'secret.pdf',
      declaredMime: 'application/pdf'
    };

    const { document, documentKey } = await sealDocument(
      { senderId, receiverEmail, file },
      {},
      mockDeps
    );

    // Tamper with ciphertext in storage
    const storedDoc = docsMap.get(document.id);
    const ct = await storage.get(storedDoc.storage.key);
    ct[0] ^= 0xff;
    await storage.put(storedDoc.storage.key, ct);

    let decipherConstructed = false;
    const originalCreateDecipheriv = crypto.createDecipheriv;
    crypto.createDecipheriv = function (...args) {
      decipherConstructed = true;
      return originalCreateDecipheriv.apply(this, args);
    };

    try {
      await assert.rejects(
        async () =>
          openDocumentToBuffer(
            { documentId: document.id, documentKeyB64Url: documentKey },
            { userId: receiverId },
            mockDeps
          ),
        /Integrity check failed/i
      );

      assert.strictEqual(
        decipherConstructed,
        false,
        'createDecipheriv must not be reached when HMAC fails'
      );
    } finally {
      crypto.createDecipheriv = originalCreateDecipheriv;
    }
  });

  it('rejects decryption with a wrong document key', async () => {
    const file = {
      buffer: Buffer.from('%PDF-1.7\nKey verification content'),
      originalName: 'test.pdf',
      declaredMime: 'application/pdf'
    };

    const { document } = await sealDocument(
      { senderId, receiverEmail, file },
      {},
      mockDeps
    );

    const wrongKey = crypto.randomBytes(32).toString('base64url');

    await assert.rejects(
      async () =>
        openDocumentToBuffer(
          { documentId: document.id, documentKeyB64Url: wrongKey },
          { userId: receiverId },
          mockDeps
        ),
      /Integrity check failed/i
    );
  });

  it('enforces AAD binding: changing receiver or policy in DB row causes integrity failure', async () => {
    const file = {
      buffer: Buffer.from('%PDF-1.7\nAAD binding test content'),
      originalName: 'aad_test.pdf',
      declaredMime: 'application/pdf'
    };

    const { document, documentKey } = await sealDocument(
      {
        senderId,
        receiverEmail,
        file,
        policy: { oneTimeUse: false }
      },
      {},
      mockDeps
    );

    // 1. Mutate receiver in database
    const storedDoc = docsMap.get(document.id);
    const originalReceiver = storedDoc.receiver;
    storedDoc.receiver = new mongoose.Types.ObjectId().toString();

    await assert.rejects(
      async () =>
        openDocumentToBuffer(
          { documentId: document.id, documentKeyB64Url: documentKey },
          { userId: receiverId },
          mockDeps
        ),
      /Integrity check failed/i
    );

    // Restore receiver and mutate policy
    storedDoc.receiver = originalReceiver;
    storedDoc.policy.oneTimeUse = true;

    await assert.rejects(
      async () =>
        openDocumentToBuffer(
          { documentId: document.id, documentKeyB64Url: documentKey },
          { userId: receiverId },
          mockDeps
        ),
      /Integrity check failed/i
    );
  });

  it('guarantees documentKey is never stored in DB, audit logs, or public metadata', async () => {
    const file = {
      buffer: Buffer.from('%PDF-1.7\nZero-knowledge audit test'),
      originalName: 'zero_knowledge.pdf',
      declaredMime: 'application/pdf'
    };

    const { document, documentKey } = await sealDocument(
      { senderId, receiverEmail, file },
      {},
      mockDeps
    );

    const rawKeyBytes = Buffer.from(documentKey, 'base64url');
    const rawKeyHex = rawKeyBytes.toString('hex');

    // 1. Verify DB record
    const storedDoc = docsMap.get(document.id);
    const dbDump = JSON.stringify(storedDoc);
    assert.strictEqual(dbDump.includes(documentKey), false);
    assert.strictEqual(dbDump.includes(rawKeyHex), false);

    // 2. Verify audit logs
    const auditDump = JSON.stringify(auditLogs);
    assert.strictEqual(auditDump.includes(documentKey), false);
    assert.strictEqual(auditDump.includes(rawKeyHex), false);

    // 3. Verify public document metadata has no crypto secrets
    assert.strictEqual(document.storage, undefined);
    assert.strictEqual(document.crypto, undefined);
    assert.strictEqual(document.documentKey, undefined);
  });

  it('triggers orphan cleanup when storage write fails', async () => {
    const failingStorage = {
      put: async () => {
        throw new Error('S3 Outage simulated');
      },
      delete: async () => true,
      get: async () => null,
      exists: async () => false
    };

    const file = {
      buffer: Buffer.from('%PDF-1.7\nOrphan cleanup test'),
      originalName: 'cleanup.pdf',
      declaredMime: 'application/pdf'
    };

    await assert.rejects(
      async () =>
        sealDocument(
          { senderId, receiverEmail, file },
          {},
          { ...mockDeps, storage: failingStorage }
        ),
      /S3 Outage simulated/i
    );

    // Document must have been cleaned up and removed from DB
    assert.strictEqual(docsMap.size, 0);
  });

  it('validates policy edge cases and rejects invalid parameters', async () => {
    const now = Date.now();

    // expiresAt in the past
    assert.throws(
      () => validatePolicy({ expiresAt: new Date(now - 10000).toISOString() }),
      /expiresAt must be in the future/i
    );

    // expiresAt > 30 days
    assert.throws(
      () =>
        validatePolicy({
          expiresAt: new Date(now + 31 * 24 * 60 * 60 * 1000).toISOString()
        }),
      /cannot exceed 30 days/i
    );

    // Geofence incomplete
    assert.throws(
      () => validatePolicy({ geofence: { lat: 40.7128, lng: -74.006 } }),
      /radiusMeters must be between/i
    );

    // Geofence lat out of range
    assert.throws(
      () => validatePolicy({ geofence: { lat: 95, lng: 0, radiusMeters: 500 } }),
      /lat must be between -90 and 90/i
    );

    // Geofence lng out of range
    assert.throws(
      () => validatePolicy({ geofence: { lat: 0, lng: -190, radiusMeters: 500 } }),
      /lng must be between -180 and 180/i
    );

    // Receiver cannot be sender
    const file = {
      buffer: Buffer.from('%PDF-1.7\nSelf send test'),
      originalName: 'self.pdf',
      declaredMime: 'application/pdf'
    };

    await assert.rejects(
      async () =>
        sealDocument(
          { senderId: receiverId, receiverEmail, file },
          {},
          mockDeps
        ),
      /Receiver cannot be the sender/i
    );

    // Receiver missing
    await assert.rejects(
      async () =>
        sealDocument(
          { senderId, receiverEmail: 'unknown@example.com', file },
          {},
          mockDeps
        ),
      /Receiver user not found/i
    );
  });

  it('restricts getDocumentMeta to only sender or receiver (404 for third party)', async () => {
    const file = {
      buffer: Buffer.from('%PDF-1.7\nMeta authorization test'),
      originalName: 'contract.pdf',
      declaredMime: 'application/pdf'
    };

    const { document } = await sealDocument(
      { senderId, receiverEmail, file },
      {},
      mockDeps
    );

    // Sender can view
    const metaSender = await getDocumentMeta(senderId, document.id, mockDeps);
    assert.strictEqual(metaSender.id, document.id);

    // Receiver can view
    const metaReceiver = await getDocumentMeta(receiverId, document.id, mockDeps);
    assert.strictEqual(metaReceiver.id, document.id);

    // Third party gets 404
    await assert.rejects(
      async () => getDocumentMeta(thirdPartyId, document.id, mockDeps),
      /Document not found/i
    );
  });
});
