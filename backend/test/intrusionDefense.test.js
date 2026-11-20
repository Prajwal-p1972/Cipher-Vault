import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createDocument } from '../src/controllers/documentController.js';
import { sendBreachAlert } from '../src/services/alertService.js';
import { unlockDocument } from '../src/services/accessService.js';
import { evaluatePolicy } from '../src/services/accessPolicy.js';
import { AppError } from '../src/utils/errors.js';

describe('Mandatory Geofencing & Automated 3-Attempt Intrusion Self-Destruct Tests', () => {
  describe('Mandatory Geofencing Validation', () => {
    it('rejects document upload when geofence coordinates are missing with mandatory geofence message', async () => {
      const req = {
        file: {
          buffer: Buffer.from('%PDF-1.4 sample content'),
          originalname: 'contract.pdf',
          mimetype: 'application/pdf'
        },
        body: {
          receiverEmail: 'recipient@example.com',
          delivery: 'qr'
          // geoLat, geoLng, geoRadiusMeters completely omitted
        },
        auth: { userId: new mongoose.Types.ObjectId().toString() },
        ip: '127.0.0.1',
        get: () => 'TestAgent'
      };

      const res = {
        set: () => res,
        status: () => res,
        json: () => res
      };

      await assert.rejects(
        async () => createDocument(req, res),
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(
            err.message,
            'Geofence coordinates (latitude, longitude, radius) are mandatory for all sealed documents'
          );
          return true;
        }
      );
    });

    it('rejects document upload when coordinates are out of bounds', async () => {
      const req = {
        file: {
          buffer: Buffer.from('%PDF-1.4 sample content'),
          originalname: 'contract.pdf',
          mimetype: 'application/pdf'
        },
        body: {
          receiverEmail: 'recipient@example.com',
          delivery: 'qr',
          geoLat: '95', // Out of bounds (> 90)
          geoLng: '-122.4194',
          geoRadiusMeters: '500'
        },
        auth: { userId: new mongoose.Types.ObjectId().toString() },
        ip: '127.0.0.1',
        get: () => 'TestAgent'
      };

      const res = {
        set: () => res,
        status: () => res,
        json: () => res
      };

      await assert.rejects(
        async () => createDocument(req, res),
        (err) => {
          assert.strictEqual(err.statusCode, 400);
          assert.strictEqual(
            err.message,
            'Geofence coordinates (latitude, longitude, radius) are mandatory for all sealed documents'
          );
          return true;
        }
      );
    });
  });

  describe('Multi-Channel Breach Alerting Service', () => {
    it('dispatches WebSocket, formatted email, SMS, and HMAC audit on breach', async () => {
      const auditCalls = [];
      const wsCalls = [];

      const doc = {
        _id: new mongoose.Types.ObjectId(),
        originalName: 'top_secret.pdf',
        sender: new mongoose.Types.ObjectId(),
        receiver: new mongoose.Types.ObjectId(),
        alertPhone: '+15551234567',
        storage: { key: 'docs/secret.bin' }
      };

      const result = await sendBreachAlert(
        {
          doc,
          reason: 'outside_area',
          failedAttempts: 2,
          maxFailedAttempts: 3,
          remainingAttempts: 1,
          isDestroyed: false,
          userId: doc.receiver.toString(),
          ipAddress: '198.51.100.23',
          distanceMeters: 1450
        },
        {
          emitToUser: (uid, evt, payload) => {
            wsCalls.push({ uid, evt, payload });
            return 1;
          },
          audit: async (entry) => {
            auditCalls.push(entry);
            return entry;
          }
        }
      );

      assert.strictEqual(result.dispatched, true);
      assert.strictEqual(result.isDestroyed, false);
      assert.strictEqual(result.wsEvent, 'document:breach_alert');
      assert.match(result.emailSubject, /SECURITY WARNING/i);
      assert.match(result.emailBody, /1450 meters/);
      assert.match(result.smsMessage, /Attempt 2\/3/);

      // Verify audit call
      assert.strictEqual(auditCalls.length, 1);
      assert.strictEqual(auditCalls[0].action, 'DOC_BREACH_ALERT');
      assert.strictEqual(auditCalls[0].meta.failedAttempts, 2);

      // Verify WebSocket calls to sender and receiver
      assert.strictEqual(wsCalls.length, 2);
      assert.strictEqual(wsCalls[0].evt, 'document:breach_alert');
      assert.strictEqual(wsCalls[0].payload.failedAttempts, 2);
    });

    it('formats destruction alert when document is crypto-shredded', async () => {
      const auditCalls = [];
      const doc = {
        _id: new mongoose.Types.ObjectId(),
        originalName: 'critical.pdf',
        sender: new mongoose.Types.ObjectId(),
        receiver: new mongoose.Types.ObjectId(),
        alertPhone: '+15559876543',
        storage: { key: 'docs/destroyed.bin' }
      };

      const result = await sendBreachAlert(
        {
          doc,
          reason: 'outside_area',
          failedAttempts: 3,
          maxFailedAttempts: 3,
          remainingAttempts: 0,
          isDestroyed: true,
          userId: doc.receiver.toString(),
          ipAddress: '203.0.113.88',
          distanceMeters: 5200
        },
        {
          emitToUser: () => 1,
          audit: async (entry) => {
            auditCalls.push(entry);
            return entry;
          }
        }
      );

      assert.strictEqual(result.isDestroyed, true);
      assert.strictEqual(result.wsEvent, 'document:destroyed');
      assert.match(result.emailSubject, /Crypto-Shredded & Destroyed/i);
      assert.match(result.smsMessage, /PERMANENTLY DESTROYED & CRYPTO-SHREDDED/i);
      assert.strictEqual(auditCalls[0].action, 'DOC_DESTROYED_ALERT');
    });
  });

  describe('Intrusion Defense Policy & Unlocking State Transitions', () => {
    it('policy evaluator marks destroyed documents with code destroyed and status 410', () => {
      const doc = {
        status: 'destroyed',
        policy: { geofence: null }
      };
      const res = evaluatePolicy({ doc });
      assert.deepStrictEqual(res, { allowed: false, code: 'destroyed', status: 410 });
    });
  });
});
