import './setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { unlockDocument } from '../src/services/accessService.js';
import { AppError } from '../src/utils/errors.js';

describe('Access Service Unit Tests (Mocked DB & Service Injections)', () => {
  const receiverId = new mongoose.Types.ObjectId().toString();
  const senderId = new mongoose.Types.ObjectId().toString();
  const thirdPartyId = new mongoose.Types.ObjectId().toString();
  const validKey = crypto.randomBytes(32).toString('base64url');
  const validCode = '123456';

  let orderLog;
  let auditLogs;
  let wipedBuffers;
  let docsMap;

  const createBaseDoc = (overrides = {}) => ({
    _id: new mongoose.Types.ObjectId(),
    sender: senderId,
    receiver: receiverId,
    originalName: 'secret.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    status: 'sealed',
    storage: { provider: 'memory', key: 'docs/test-storage.bin' },
    policy: {
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      oneTimeUse: false,
      geofence: null
    },
    ...overrides
  });

  beforeEach(() => {
    orderLog = [];
    auditLogs = [];
    wipedBuffers = [];
    docsMap = new Map();
  });

  function makeMockDeps(options = {}) {
    return {
      Document: {
        findById: (id) => {
          const doc = docsMap.get(id.toString());
          return {
            lean: () => ({
              exec: async () => (doc ? JSON.parse(JSON.stringify(doc)) : null)
            })
          };
        },
        findOneAndUpdate: async (filter, update) => {
          if (update.$inc?.accessCount) {
            orderLog.push('claim');
          } else if (update.$set?.status === 'expired') {
            orderLog.push('mark-expired');
          }
          if (options.claimFails) {
            return null;
          }
          const doc = docsMap.get(filter._id.toString());
          if (!doc) return null;
          if (filter.status && doc.status !== filter.status) return null;
          if (filter.receiver && doc.receiver.toString() !== filter.receiver.toString()) return null;

          if (update.$set) {
            Object.assign(doc, update.$set);
          }
          if (update.$inc) {
            doc.accessCount = (doc.accessCount || 0) + (update.$inc.accessCount || 0);
          }
          return { ...doc };
        }
      },
      storage: {
        get: async () => Buffer.from('ciphertext'),
        delete: async () => true
      },
      audit: async (entry) => {
        auditLogs.push(entry);
        return entry;
      },
      verifyStepUp: async () => {
        orderLog.push('step-up');
        if (options.stepUpFails) {
          throw AppError.unauthorized('Invalid verification code');
        }
        return { verified: true };
      },
      openDocumentToBuffer: async () => {
        orderLog.push('open');
        if (options.openFails) {
          throw new Error('Integrity check failed');
        }
        return {
          buffer: Buffer.from('%PDF-1.7 Plaintext secret payload'),
          mimeType: 'application/pdf',
          originalName: 'secret.pdf'
        };
      },
      wipe: (buf) => {
        orderLog.push('wipe');
        wipedBuffers.push(buf);
      },
      clock: () => new Date()
    };
  }

  it('executes exact order of operations: step-up BEFORE policy, policy BEFORE open, open BEFORE claim', async () => {
    const doc = createBaseDoc({
      policy: {
        geofence: { lat: 37.7749, lng: -122.4194, radiusMeters: 500 },
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        oneTimeUse: false
      }
    });
    docsMap.set(doc._id.toString(), doc);

    const deps = makeMockDeps();
    const result = await unlockDocument(
      {
        userId: receiverId,
        documentId: doc._id.toString(),
        documentKeyB64Url: validKey,
        code: validCode,
        location: { lat: 37.7749, lng: -122.4194, accuracyMeters: 20 }
      },
      {},
      deps
    );

    assert.ok(result.buffer);
    assert.deepStrictEqual(orderLog, ['step-up', 'open', 'claim']);
  });

  it('never calls open or claim when access policy check fails', async () => {
    const expiredDoc = createBaseDoc({
      policy: {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        oneTimeUse: false,
        geofence: null
      }
    });
    docsMap.set(expiredDoc._id.toString(), expiredDoc);

    const deps = makeMockDeps();
    await assert.rejects(
      async () =>
        unlockDocument(
          {
            userId: receiverId,
            documentId: expiredDoc._id.toString(),
            documentKeyB64Url: validKey,
            code: validCode
          },
          {},
          deps
        ),
      (err) => {
        assert.strictEqual(err.statusCode, 410);
        assert.strictEqual(err.code, 'expired');
        return true;
      }
    );

    assert.deepStrictEqual(orderLog, ['step-up', 'mark-expired']);
    assert.strictEqual(orderLog.includes('open'), false);
    assert.strictEqual(orderLog.includes('claim'), false);
  });

  it('never executes claim when document key integrity check fails (wrong key)', async () => {
    const doc = createBaseDoc();
    docsMap.set(doc._id.toString(), doc);

    const deps = makeMockDeps({ openFails: true });
    await assert.rejects(
      async () =>
        unlockDocument(
          {
            userId: receiverId,
            documentId: doc._id.toString(),
            documentKeyB64Url: validKey,
            code: validCode
          },
          {},
          deps
        ),
      (err) => {
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, 'integrity');
        return true;
      }
    );

    assert.deepStrictEqual(orderLog, ['step-up', 'open']);
    assert.strictEqual(orderLog.includes('claim'), false);
    // Verify document was not consumed
    assert.strictEqual(docsMap.get(doc._id.toString()).status, 'sealed');
  });

  it('wipes buffer and throws 410 consumed when atomic claim race is lost', async () => {
    const doc = createBaseDoc();
    docsMap.set(doc._id.toString(), doc);

    const deps = makeMockDeps({ claimFails: true });
    await assert.rejects(
      async () =>
        unlockDocument(
          {
            userId: receiverId,
            documentId: doc._id.toString(),
            documentKeyB64Url: validKey,
            code: validCode
          },
          {},
          deps
        ),
      (err) => {
        assert.strictEqual(err.statusCode, 410);
        assert.strictEqual(err.code, 'consumed');
        return true;
      }
    );

    assert.ok(orderLog.includes('wipe'));
    assert.strictEqual(wipedBuffers.length, 1);
  });

  it('ensures exactly one succeeds when two concurrent unlocks attempt to claim a one-time document', async () => {
    const doc = createBaseDoc({ policy: { oneTimeUse: true } });
    docsMap.set(doc._id.toString(), doc);

    let claimed = false;
    const deps = makeMockDeps();
    deps.Document.findOneAndUpdate = async (filter, update) => {
      const stored = docsMap.get(filter._id.toString());
      if (!stored || stored.status !== 'sealed') {
        return null;
      }
      if (claimed) {
        return null;
      }
      claimed = true;
      Object.assign(stored, update.$set);
      return stored;
    };

    const call1 = unlockDocument(
      { userId: receiverId, documentId: doc._id.toString(), documentKeyB64Url: validKey, code: validCode },
      {},
      deps
    );
    const call2 = unlockDocument(
      { userId: receiverId, documentId: doc._id.toString(), documentKeyB64Url: validKey, code: validCode },
      {},
      deps
    );

    const results = await Promise.allSettled([call1, call2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.strictEqual(fulfilled.length, 1);
    assert.strictEqual(rejected.length, 1);
    assert.strictEqual(rejected[0].reason.statusCode, 410);
  });

  it('never logs document key or receiver coordinates in audit entries', async () => {
    const doc = createBaseDoc({
      policy: {
        geofence: { lat: 37.7749, lng: -122.4194, radiusMeters: 500 }
      }
    });
    docsMap.set(doc._id.toString(), doc);

    const targetLat = 37.7749;
    const targetLng = -122.4194;
    const deps = makeMockDeps();

    await unlockDocument(
      {
        userId: receiverId,
        documentId: doc._id.toString(),
        documentKeyB64Url: validKey,
        code: validCode,
        location: { lat: targetLat, lng: targetLng, accuracyMeters: 15 }
      },
      {},
      deps
    );

    const auditDump = JSON.stringify(auditLogs);
    assert.strictEqual(auditDump.includes(validKey), false, 'Audit must never contain document key');
    assert.strictEqual(auditDump.includes(String(targetLat)), false, 'Audit must never contain lat');
    assert.strictEqual(auditDump.includes(String(targetLng)), false, 'Audit must never contain lng');
  });

  it('returns 404 for a non-receiver, including the sender', async () => {
    const doc = createBaseDoc();
    docsMap.set(doc._id.toString(), doc);

    const deps = makeMockDeps();

    // 1. Sender gets 404
    await assert.rejects(
      async () =>
        unlockDocument(
          {
            userId: senderId,
            documentId: doc._id.toString(),
            documentKeyB64Url: validKey,
            code: validCode
          },
          {},
          deps
        ),
      (err) => {
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.message, 'Document not found');
        return true;
      }
    );

    // 2. Third party gets 404
    await assert.rejects(
      async () =>
        unlockDocument(
          {
            userId: thirdPartyId,
            documentId: doc._id.toString(),
            documentKeyB64Url: validKey,
            code: validCode
          },
          {},
          deps
        ),
      (err) => {
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.message, 'Document not found');
        return true;
      }
    );

    const denyAudit = auditLogs.find((a) => a.action === 'DOC_ACCESS_DENIED');
    assert.ok(denyAudit);
    assert.strictEqual(denyAudit.meta.reason, 'not_receiver');
  });
});
