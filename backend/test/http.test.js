import './setup.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../src/app.js';
import { SCOPES, signToken } from '../src/utils/jwt.js';

describe('HTTP Route & Security Hardening Tests (No MongoDB)', () => {
  let server;
  let baseUrl;

  before((t, done) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  after((t, done) => {
    server.close(done);
  });

  test('/health returns 200 with { status: "ok" }', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(body, { status: 'ok' });
  });

  test('unknown route returns 404 with { error: "Not found" }', async () => {
    const res = await fetch(`${baseUrl}/nonexistent/endpoint`);
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.deepStrictEqual(body, { error: 'Not found' });
  });

  test('malformed JSON body returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"invalid": json-without-quotes}'
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error, 'Malformed JSON');
  });

  test('oversized payload (>100kb) returns 413', async () => {
    const hugePayload = JSON.stringify({ email: 'a@b.com', data: 'x'.repeat(105 * 1024) });
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: hugePayload
    });
    assert.strictEqual(res.status, 413);
    const body = await res.json();
    assert.strictEqual(body.error, 'Payload too large');
  });

  test('bad register body returns 400 with validation details', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'invalid-email',
        displayName: '',
        password: 'short'
      })
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error, 'Validation failed');
    assert.ok(Array.isArray(body.details));
  });

  test('NoSQL-injection-shaped login body returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: { $ne: null },
        password: { $ne: null }
      })
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error, 'Validation failed');
  });

  test('/api/auth/me with no token returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`);
    assert.strictEqual(res.status, 401);
  });

  test('/api/auth/me with an mfa_challenge token returns 401 (needs access scope)', async () => {
    const mfaToken = signToken('507f1f77bcf86cd799439011', SCOPES.MFA_CHALLENGE);
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${mfaToken}` }
    });
    assert.strictEqual(res.status, 401);
  });

  test('/api/auth/mfa/setup with no token returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/auth/mfa/setup`, {
      method: 'POST'
    });
    assert.strictEqual(res.status, 401);
  });

  test('/api/auth/mfa/setup with an access token returns 401 (needs mfa_setup scope)', async () => {
    const accessToken = signToken('507f1f77bcf86cd799439011', SCOPES.ACCESS);
    const res = await fetch(`${baseUrl}/api/auth/mfa/setup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    assert.strictEqual(res.status, 401);
  });

  test('/api/audit/verify with no token returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/audit/verify`);
    assert.strictEqual(res.status, 401);
  });

  test('helmet security headers are present and x-powered-by is absent', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.headers.get('x-powered-by'), null);
    assert.ok(
      res.headers.get('x-content-type-options') ||
      res.headers.get('content-security-policy') ||
      res.headers.get('strict-transport-security')
    );
  });
});
