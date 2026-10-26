import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import speakeasy from 'speakeasy';
import { generateTotpSecret, verifyTotp, TOTP_STEP_SECONDS } from '../src/utils/totp.js';

describe('TOTP Utility Tests', () => {
  const account = 'alice@example.com';
  const creds = generateTotpSecret(account);

  test('generateTotpSecret returns base32 secret and valid OTPAuth URL', () => {
    assert.ok(creds.base32);
    assert.ok(creds.otpauthUrl);
    assert.match(creds.otpauthUrl, /^otpauth:\/\/totp\//);
  });

  test('current code is accepted and returns the integer step', () => {
    const nowStep = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
    const code = speakeasy.totp({
      secret: creds.base32,
      encoding: 'base32'
    });

    const step = verifyTotp(creds.base32, code);
    assert.strictEqual(typeof step, 'number');
    assert.strictEqual(step, nowStep);
  });

  test('adjacent-step codes are accepted within the +/- 1 window', () => {
    const currentStep = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);

    const prevCode = speakeasy.totp({
      secret: creds.base32,
      encoding: 'base32',
      time: (currentStep - 1) * TOTP_STEP_SECONDS
    });
    const nextCode = speakeasy.totp({
      secret: creds.base32,
      encoding: 'base32',
      time: (currentStep + 1) * TOTP_STEP_SECONDS
    });

    const prevMatched = verifyTotp(creds.base32, prevCode);
    const nextMatched = verifyTotp(creds.base32, nextCode);

    assert.strictEqual(prevMatched, currentStep - 1);
    assert.strictEqual(nextMatched, currentStep + 1);

    // Beyond window (+/- 2 steps) must return null
    const tooOldCode = speakeasy.totp({
      secret: creds.base32,
      encoding: 'base32',
      time: (currentStep - 2) * TOTP_STEP_SECONDS
    });
    assert.strictEqual(verifyTotp(creds.base32, tooOldCode), null);
  });

  test('wrong, 5-digit, 7-digit and non-numeric codes return null', () => {
    assert.strictEqual(verifyTotp(creds.base32, '000000'), null);
    assert.strictEqual(verifyTotp(creds.base32, '12345'), null);
    assert.strictEqual(verifyTotp(creds.base32, '1234567'), null);
    assert.strictEqual(verifyTotp(creds.base32, 'abcdef'), null);
    assert.strictEqual(verifyTotp(creds.base32, ''), null);
    assert.strictEqual(verifyTotp(creds.base32, null), null);
    assert.strictEqual(verifyTotp(creds.base32, 123456), null);
  });
});
