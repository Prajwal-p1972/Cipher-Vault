import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as ioc } from 'socket.io-client';
import { initSocket, getIo, notifyUser, closeSocket } from '../src/config/socket.js';
import { signToken, SCOPES } from '../src/utils/jwt.js';

describe('Phase 3: Config Socket.io Server & Notification System', () => {
  it('throws an error if getIo is called before initialization', () => {
    // Ensure clean state
    assert.throws(() => getIo(), /Socket\.io not initialized/i);
  });

  it('rejects connection when no token is provided in handshake', async () => {
    const server = http.createServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}`;

    initSocket(server);

    const client = ioc(url, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: false,
    });

    const error = await new Promise((resolve) => {
      client.on('connect_error', (err) => {
        client.close();
        resolve(err);
      });
    });

    assert.match(error.message, /No token provided/i);
    await closeSocket();
    await new Promise((r) => server.close(r));
  });

  it('rejects connection when an invalid or expired token is provided', async () => {
    const server = http.createServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}`;

    initSocket(server);

    const client = ioc(url, {
      transports: ['websocket'],
      auth: { token: 'invalid.jwt.token' },
      autoConnect: true,
      reconnection: false,
    });

    const error = await new Promise((resolve) => {
      client.on('connect_error', (err) => {
        client.close();
        resolve(err);
      });
    });

    assert.match(error.message, /Token verification failed/i);
    await closeSocket();
    await new Promise((r) => server.close(r));
  });

  it('authenticates valid access token and pushes real-time vault_package_received event', async () => {
    const server = http.createServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}`;

    initSocket(server);

    const targetUserId = '64b1f234567890abcdef1234';
    const validToken = signToken(targetUserId, SCOPES.ACCESS);

    const client = ioc(url, {
      transports: ['websocket'],
      auth: { token: validToken },
      autoConnect: true,
      reconnection: false,
    });

    await new Promise((resolve) => {
      client.on('connect', resolve);
    });

    const payloadPromise = new Promise((resolve) => {
      client.on('vault_package_received', (data) => {
        resolve(data);
      });
    });

    const mockEventData = {
      docId: 'doc_abc123',
      sender: '64a0e1112223334445556667',
      originalName: 'classified_report.pdf',
      timestamp: new Date().toISOString(),
    };

    notifyUser(targetUserId, 'vault_package_received', mockEventData);

    const receivedData = await payloadPromise;
    assert.deepStrictEqual(receivedData, mockEventData);

    client.close();
    await closeSocket();
    await new Promise((r) => server.close(r));
  });
});
