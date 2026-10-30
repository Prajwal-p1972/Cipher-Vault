import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  registerVaultKey,
  getMyVaultKey,
  getReceiverVaultKey
} from '../src/services/keyService.js';
import { updateKeyLimiter, lookupReceiverLimiter } from '../src/routes/keys.js';
import { AppError } from '../src/utils/errors.js';

function generateValidRawPublicKey() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return ecdh.getPublicKey().toString('base64url');
}

describe('Key Service Specification (Injected Fakes)', () => {
  test('step-up authentication is verified BEFORE storing any key; failures prevent key storage and audit', async () => {
    let stepUpCalled = false;
    let userSaveCalled = false;
    let auditCalled = false;

    const mockUser = {
      _id: '507f1f77bcf86cd799439011',
      email: 'victim@example.com',
      vaultKey: null,
      save: async () => {
        userSaveCalled = true;
      }
    };

    const customDeps = {
      User: {
        findById: () => ({
          exec: async () => mockUser
        })
      },
      verifyStepUp: async () => {
        stepUpCalled = true;
        throw AppError.unauthorized('Invalid verification code');
      },
      audit: async () => {
        auditCalled = true;
      }
    };

    const validPublicKey = generateValidRawPublicKey();

    await assert.rejects(
      async () =>
        registerVaultKey(
          {
            userId: mockUser._id,
            publicKey: validPublicKey,
            code: '000000'
          },
          {},
          customDeps
        ),
      (err) => err instanceof AppError && err.statusCode === 401
    );

    assert.strictEqual(stepUpCalled, true);
    assert.strictEqual(userSaveCalled, false, 'User must not be saved when step-up fails');
    assert.strictEqual(auditCalled, false, 'Audit must not record key registration when step-up fails');
    assert.strictEqual(mockUser.vaultKey, null, 'Vault key must remain null');
  });

  test('initial key registration emits KEY_REGISTERED audit event with meta { keyId }', async () => {
    let auditedAction = null;
    let auditedMeta = null;
    let savedUser = false;

    const mockUser = {
      _id: '507f1f77bcf86cd799439011',
      email: 'alice@example.com',
      vaultKey: null,
      save: async () => {
        savedUser = true;
      }
    };

    const customDeps = {
      User: {
        findById: () => ({
          exec: async () => mockUser
        })
      },
      verifyStepUp: async () => ({ verified: true }),
      audit: async (entry) => {
        auditedAction = entry.action;
        auditedMeta = entry.meta;
      }
    };

    const validPublicKey = generateValidRawPublicKey();

    const result = await registerVaultKey(
      {
        userId: mockUser._id,
        publicKey: validPublicKey,
        code: '123456'
      },
      { ip: '127.0.0.1', userAgent: 'test-agent' },
      customDeps
    );

    assert.strictEqual(savedUser, true);
    assert.strictEqual(auditedAction, 'KEY_REGISTERED');
    assert.ok(auditedMeta.keyId);
    assert.strictEqual(Object.keys(auditedMeta).length, 1, 'Only keyId should be in audit meta');
    assert.strictEqual(result.keyId, auditedMeta.keyId);
    assert.ok(result.fingerprint);
    assert.ok(result.registeredAt);
  });

  test('subsequent key registration emits KEY_ROTATED audit event with meta { keyId }', async () => {
    let auditedAction = null;
    let auditedMeta = null;

    const mockUser = {
      _id: '507f1f77bcf86cd799439011',
      email: 'alice@example.com',
      vaultKey: {
        publicKey: 'existing_key',
        keyId: 'f'.repeat(64),
        registeredAt: new Date(Date.now() - 100000)
      },
      save: async () => {}
    };

    const customDeps = {
      User: {
        findById: () => ({
          exec: async () => mockUser
        })
      },
      verifyStepUp: async () => ({ verified: true }),
      audit: async (entry) => {
        auditedAction = entry.action;
        auditedMeta = entry.meta;
      }
    };

    const validPublicKey = generateValidRawPublicKey();

    const result = await registerVaultKey(
      {
        userId: mockUser._id,
        publicKey: validPublicKey,
        code: '123456'
      },
      {},
      customDeps
    );

    assert.strictEqual(auditedAction, 'KEY_ROTATED');
    assert.strictEqual(auditedMeta.keyId, result.keyId);
    assert.notStrictEqual(result.keyId, 'f'.repeat(64));
  });

  test('getMyVaultKey returns registered status and key metadata', async () => {
    // 1) Unregistered user
    const unregUser = {
      _id: 'user_1',
      vaultKey: null
    };
    const deps1 = {
      User: {
        findById: () => ({
          lean: () => ({
            exec: async () => unregUser
          })
        })
      }
    };
    const res1 = await getMyVaultKey('user_1', deps1);
    assert.deepStrictEqual(res1, { registered: false });

    // 2) Registered user
    const regUser = {
      _id: 'user_2',
      vaultKey: {
        publicKey: 'some_key',
        keyId: 'a'.repeat(64),
        registeredAt: new Date()
      }
    };
    const deps2 = {
      User: {
        findById: () => ({
          lean: () => ({
            exec: async () => regUser
          })
        })
      }
    };
    const res2 = await getMyVaultKey('user_2', deps2);
    assert.strictEqual(res2.registered, true);
    assert.strictEqual(res2.keyId, 'a'.repeat(64));
    assert.ok(res2.fingerprint);
  });

  test('getReceiverVaultKey returns 404 with identical message for non-existent receiver or receiver without key', async () => {
    // 1) Non-existent user
    const deps1 = {
      User: {
        findOne: () => ({
          lean: () => ({
            exec: async () => null
          })
        })
      }
    };
    await assert.rejects(
      async () => getReceiverVaultKey('missing@example.com', deps1),
      (err) => err instanceof AppError && err.statusCode === 404 && err.message === 'Receiver not found or has no vault key'
    );

    // 2) User exists but has no vault key
    const deps2 = {
      User: {
        findOne: () => ({
          lean: () => ({
            exec: async () => ({ _id: 'u2', email: 'nokey@example.com', vaultKey: null })
          })
        })
      }
    };
    await assert.rejects(
      async () => getReceiverVaultKey('nokey@example.com', deps2),
      (err) => err instanceof AppError && err.statusCode === 404 && err.message === 'Receiver not found or has no vault key'
    );

    // 3) User exists with vault key
    const deps3 = {
      User: {
        findOne: () => ({
          lean: () => ({
            exec: async () => ({
              _id: 'u3',
              email: 'haskey@example.com',
              vaultKey: { keyId: 'b'.repeat(64) }
            })
          })
        })
      }
    };
    const res = await getReceiverVaultKey('haskey@example.com', deps3);
    assert.strictEqual(res.registered, true);
    assert.ok(res.fingerprint);
  });

  test('rate limiters enforce configured thresholds', async () => {
    // updateKeyLimiter: max 5 requests
    let updateHits = 0;
    const reqUpdate = {
      ip: '192.168.1.100',
      auth: { userId: 'rate_test_user' },
      headers: {}
    };

    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => {
        updateKeyLimiter(reqUpdate, { setHeader: () => {} }, () => {
          updateHits++;
          resolve();
        });
      });
    }
    assert.strictEqual(updateHits, 5);

    // 6th hit must trigger rate limiter response
    let updateBlocked = false;
    await new Promise((resolve) => {
      const mockSend = () => {
        resolve();
      };
      const res = {
        setHeader: () => {},
        send: mockSend,
        status: (code) => {
          if (code === 429) updateBlocked = true;
          return {
            send: mockSend,
            json: mockSend
          };
        }
      };
      updateKeyLimiter(reqUpdate, res, () => {
        resolve();
      });
    });
    assert.strictEqual(updateBlocked, true);
  });
});
