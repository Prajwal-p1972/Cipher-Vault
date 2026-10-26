import './setup.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { io as ioc } from 'socket.io-client';
import { env } from '../src/config/env.js';
import {
  initSocketServer,
  emitToUser,
  closeSocketServer
} from '../src/realtime/socketServer.js';
import { notifyDocumentSealed } from '../src/realtime/notifier.js';
import {
  SCOPES,
  signToken,
  signMfaChallengeToken,
  signMfaSetupToken
} from '../src/utils/jwt.js';

describe('Real-Time Socket.io Server & Notification Tests', () => {
  let server;
  let baseUrl;
  const userA = 'user_socket_test_a';
  const userB = 'user_socket_test_b';
  let tokenA;
  let tokenB;

  before(async () => {
    server = http.createServer();
    initSocketServer(server);

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    tokenA = signToken(userA, SCOPES.ACCESS);
    tokenB = signToken(userB, SCOPES.ACCESS);
  });

  after(async () => {
    await closeSocketServer();
    await new Promise((resolve) => server.close(resolve));
  });

  function createClient(options = {}) {
    return ioc(baseUrl, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: false,
      ...options
    });
  }

  it('rejects connection when no authentication token is provided', async () => {
    const client = createClient({ auth: {} });

    await new Promise((resolve, reject) => {
      client.on('connect', () => {
        client.disconnect();
        reject(new Error('Expected connection to fail'));
      });
      client.on('connect_error', (err) => {
        assert.strictEqual(err.message, 'unauthorized');
        client.disconnect();
        resolve();
      });
    });
  });

  it('rejects tokens with non-access scopes (mfa_challenge, mfa_setup)', async () => {
    const challengeToken = signMfaChallengeToken({ id: userA });
    const client1 = createClient({ auth: { token: challengeToken } });

    await new Promise((resolve, reject) => {
      client1.on('connect', () => {
        client1.disconnect();
        reject(new Error('Expected mfa_challenge token to be rejected'));
      });
      client1.on('connect_error', (err) => {
        assert.strictEqual(err.message, 'unauthorized');
        client1.disconnect();
        resolve();
      });
    });

    const setupToken = signMfaSetupToken({ id: userA });
    const client2 = createClient({ auth: { token: setupToken } });

    await new Promise((resolve, reject) => {
      client2.on('connect', () => {
        client2.disconnect();
        reject(new Error('Expected mfa_setup token to be rejected'));
      });
      client2.on('connect_error', (err) => {
        assert.strictEqual(err.message, 'unauthorized');
        client2.disconnect();
        resolve();
      });
    });
  });

  it('rejects tokens passed in query string to prevent leakage in URL logs', async () => {
    const client = createClient({
      query: { token: tokenA },
      auth: {}
    });

    await new Promise((resolve, reject) => {
      client.on('connect', () => {
        client.disconnect();
        reject(new Error('Expected query string token to be rejected'));
      });
      client.on('connect_error', (err) => {
        assert.strictEqual(err.message, 'unauthorized');
        client.disconnect();
        resolve();
      });
    });
  });

  it('accepts valid access token and successfully connects', async () => {
    const client = createClient({ auth: { token: tokenA } });

    await new Promise((resolve, reject) => {
      client.on('connect', () => {
        assert.ok(client.connected);
        client.disconnect();
        resolve();
      });
      client.on('connect_error', (err) => {
        client.disconnect();
        reject(err);
      });
    });
  });

  it('ensures user A never receives events emitted to user B (room isolation)', async () => {
    const clientA = createClient({ auth: { token: tokenA } });
    const clientB = createClient({ auth: { token: tokenB } });

    await Promise.all([
      new Promise((res) => clientA.on('connect', res)),
      new Promise((res) => clientB.on('connect', res))
    ]);

    let userAReceived = false;
    clientA.on('private:event', () => {
      userAReceived = true;
    });

    const userBReceivedPromise = new Promise((resolve) => {
      clientB.on('private:event', (payload) => {
        resolve(payload);
      });
    });

    const count = emitToUser(userB, 'private:event', { secret: 'for-b-only' });
    assert.strictEqual(count, 1);

    const receivedPayload = await userBReceivedPromise;
    assert.deepStrictEqual(receivedPayload, { secret: 'for-b-only' });

    // Wait a brief tick to ensure clientA did not receive
    await new Promise((res) => setTimeout(res, 50));
    assert.strictEqual(userAReceived, false);

    clientA.disconnect();
    clientB.disconnect();
  });

  it('sealed document notification payload contains no secret fields', async () => {
    const clientB = createClient({ auth: { token: tokenB } });
    await new Promise((res) => clientB.on('connect', res));

    const notificationPromise = new Promise((resolve) => {
      clientB.on('document:sealed', (payload) => {
        resolve(payload);
      });
    });

    const sampleDoc = {
      id: 'doc_sealed_test_123',
      receiver: userB,
      sender: userA,
      originalName: 'tax_return.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4096,
      createdAt: new Date().toISOString(),
      policy: {
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        oneTimeUse: true,
        geofence: { lat: 37.7749, lng: -122.4194, radiusMeters: 500 }
      },
      // Secret internal fields that MUST NOT leak:
      documentKey: 'LEAK_KEY_DATA',
      storage: { key: 'docs/secret.bin' },
      crypto: { iv: 'iv123', authTag: 'tag123', hmac: 'hmac123' }
    };

    let auditedEntry = null;
    await notifyDocumentSealed(
      { document: sampleDoc, senderName: 'Alice' },
      {
        emitToUser,
        audit: async (entry) => {
          auditedEntry = entry;
          return entry;
        }
      }
    );

    const payload = await notificationPromise;

    // Verify allowed fields exist
    assert.strictEqual(payload.documentId, 'doc_sealed_test_123');
    assert.strictEqual(payload.originalName, 'tax_return.pdf');
    assert.strictEqual(payload.mimeType, 'application/pdf');
    assert.strictEqual(payload.sizeBytes, 4096);
    assert.strictEqual(payload.senderName, 'Alice');
    assert.strictEqual(payload.oneTimeUse, true);
    assert.strictEqual(payload.hasGeofence, true);

    // Verify secret fields DO NOT exist
    assert.strictEqual(payload.documentKey, undefined);
    assert.strictEqual(payload.storage, undefined);
    assert.strictEqual(payload.crypto, undefined);
    assert.strictEqual(payload.iv, undefined);
    assert.strictEqual(payload.authTag, undefined);
    assert.strictEqual(payload.hmac, undefined);

    assert.ok(auditedEntry);
    assert.strictEqual(auditedEntry.action, 'DOC_NOTIFIED');
    assert.strictEqual(auditedEntry.meta.delivered, true);

    clientB.disconnect();
  });

  it('disconnects socket and emits auth:expired when token expires', async () => {
    // Generate an access token with a 1-second lifetime
    const shortToken = jwt.sign(
      {},
      env.JWT_ACCESS_SECRET,
      {
        algorithm: 'HS256',
        issuer: 'cipher-vault',
        subject: userA,
        audience: SCOPES.ACCESS,
        expiresIn: '1s'
      }
    );

    const client = createClient({ auth: { token: shortToken } });
    await new Promise((res) => client.on('connect', res));

    let expiredEmitted = false;
    client.on('auth:expired', () => {
      expiredEmitted = true;
    });

    await new Promise((resolve) => {
      client.on('disconnect', () => {
        resolve();
      });
    });

    assert.strictEqual(expiredEmitted, true);
  });

  it('evicts the oldest socket when a 6th concurrent connection is made for a user', async () => {
    const clients = [];

    // Connect 5 sockets
    for (let i = 0; i < 5; i++) {
      const c = createClient({ auth: { token: tokenA } });
      await new Promise((res) => c.on('connect', res));
      clients.push(c);
    }

    assert.strictEqual(clients.every((c) => c.connected), true);

    // Listen for disconnect on the first (oldest) socket
    const oldestDisconnectedPromise = new Promise((resolve) => {
      clients[0].on('disconnect', () => {
        resolve();
      });
    });

    // Connect 6th socket
    const client6 = createClient({ auth: { token: tokenA } });
    await new Promise((res) => client6.on('connect', res));
    clients.push(client6);

    await oldestDisconnectedPromise;
    assert.strictEqual(clients[0].connected, false);

    // Sockets 1-5 (now indices 1 to 5) remain connected
    for (let i = 1; i < clients.length; i++) {
      assert.strictEqual(clients[i].connected, true);
      clients[i].disconnect();
    }
  });

  it('refuses connections from untrusted origins', async () => {
    const client = createClient({
      auth: { token: tokenA },
      extraHeaders: {
        Origin: 'http://malicious-origin.evil.com'
      }
    });

    await new Promise((resolve, reject) => {
      client.on('connect', () => {
        client.disconnect();
        reject(new Error('Expected wrong origin to be refused'));
      });
      client.on('connect_error', () => {
        client.disconnect();
        resolve();
      });
    });
  });

  it('emitToUser returns accurate count of sockets reached', async () => {
    const userCountTest = 'user_count_test';
    const tokenCount = signToken(userCountTest, SCOPES.ACCESS);

    // 0 sockets
    assert.strictEqual(emitToUser(userCountTest, 'test', {}), 0);

    // Connect 2 sockets
    const c1 = createClient({ auth: { token: tokenCount } });
    const c2 = createClient({ auth: { token: tokenCount } });
    await Promise.all([
      new Promise((res) => c1.on('connect', res)),
      new Promise((res) => c2.on('connect', res))
    ]);

    assert.strictEqual(emitToUser(userCountTest, 'test', {}), 2);

    c1.disconnect();
    c2.disconnect();
  });
});
