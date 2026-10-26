import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { SCOPES, signToken, verifyToken } from '../src/utils/jwt.js';
import { env } from '../src/config/env.js';

describe('JWT Utility Tests', () => {
  const userId = '507f1f77bcf86cd799439011';

  test('each scope round-trips correctly', () => {
    for (const scope of Object.values(SCOPES)) {
      const token = signToken(userId, scope);
      const payload = verifyToken(token, scope);
      assert.strictEqual(payload.sub, userId);
      assert.strictEqual(payload.aud, scope);
      assert.strictEqual(payload.iss, 'cipher-vault');
    }
  });

  test('a token cannot verify under a different scope', () => {
    const access = signToken(userId, SCOPES.ACCESS);
    const mfa = signToken(userId, SCOPES.MFA_CHALLENGE);
    const setup = signToken(userId, SCOPES.MFA_SETUP);
    const refresh = signToken(userId, SCOPES.REFRESH);

    assert.throws(() => verifyToken(mfa, SCOPES.ACCESS));
    assert.throws(() => verifyToken(access, SCOPES.MFA_CHALLENGE));
    assert.throws(() => verifyToken(setup, SCOPES.ACCESS));
    assert.throws(() => verifyToken(refresh, SCOPES.ACCESS));
    assert.throws(() => verifyToken(access, SCOPES.REFRESH));
  });

  test('wrong issuer, wrong secret, expired token, and tampered token all fail', () => {
    // Wrong issuer
    const wrongIssuer = jwt.sign({}, env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      issuer: 'evil-issuer',
      audience: SCOPES.ACCESS,
      subject: userId,
      expiresIn: '15m'
    });
    assert.throws(() => verifyToken(wrongIssuer, SCOPES.ACCESS));

    // Wrong secret
    const wrongSecret = jwt.sign({}, 'wrong-secret-32-chars-long-12345678', {
      algorithm: 'HS256',
      issuer: 'cipher-vault',
      audience: SCOPES.ACCESS,
      subject: userId,
      expiresIn: '15m'
    });
    assert.throws(() => verifyToken(wrongSecret, SCOPES.ACCESS));

    // Expired token
    const expired = jwt.sign({}, env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      issuer: 'cipher-vault',
      audience: SCOPES.ACCESS,
      subject: userId,
      expiresIn: '-1s'
    });
    assert.throws(() => verifyToken(expired, SCOPES.ACCESS));

    // Tampered token
    const valid = signToken(userId, SCOPES.ACCESS);
    const parts = valid.split('.');
    parts[1] = Buffer.from(JSON.stringify({ sub: 'attacker', aud: 'access' })).toString('base64url');
    assert.throws(() => verifyToken(parts.join('.'), SCOPES.ACCESS));
  });

  test('alg:none unsigned token is rejected', () => {
    const unsigned = jwt.sign({ sub: userId, aud: SCOPES.ACCESS, iss: 'cipher-vault' }, '', {
      algorithm: 'none'
    });
    assert.throws(() => verifyToken(unsigned, SCOPES.ACCESS));
  });

  test('refresh token uses dedicated secret (token signed with access secret fails)', () => {
    // An access-secret-signed token with aud=refresh must fail when verified as refresh
    const fakeRefresh = jwt.sign({}, env.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      issuer: 'cipher-vault',
      audience: SCOPES.REFRESH,
      subject: userId,
      expiresIn: '7d'
    });

    assert.throws(() => verifyToken(fakeRefresh, SCOPES.REFRESH));

    // Dedicated refresh secret succeeds
    const realRefresh = signToken(userId, SCOPES.REFRESH);
    const payload = verifyToken(realRefresh, SCOPES.REFRESH);
    assert.strictEqual(payload.sub, userId);
  });

  test('lifetimes are correct (access 900s, challenge 300s, setup 900s, refresh 604800s)', () => {
    const expectedLifetimes = {
      [SCOPES.ACCESS]: 900,
      [SCOPES.MFA_CHALLENGE]: 300,
      [SCOPES.MFA_SETUP]: 900,
      [SCOPES.REFRESH]: 604800
    };

    for (const [scope, expectedSeconds] of Object.entries(expectedLifetimes)) {
      const token = signToken(userId, scope);
      const decoded = jwt.decode(token);
      const lifetime = decoded.exp - decoded.iat;
      assert.strictEqual(
        lifetime,
        expectedSeconds,
        `Expected lifetime for ${scope} to be ${expectedSeconds}s`
      );
    }
  });
});
