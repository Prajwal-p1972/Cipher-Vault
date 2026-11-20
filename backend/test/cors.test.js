import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedOrigin, extractCleanUrl } from '../src/config/cors.js';

describe('CORS & Socket.io Allowed Origins Tests', () => {
  it('extractCleanUrl strips markdown link wrappers', () => {
    assert.strictEqual(
      extractCleanUrl('[https://my-subdomain.trycloudflare.com](https://my-subdomain.trycloudflare.com)'),
      'https://my-subdomain.trycloudflare.com'
    );
    assert.strictEqual(
      extractCleanUrl('http://localhost:3000'),
      'http://localhost:3000'
    );
    assert.strictEqual(extractCleanUrl(''), '');
  });

  it('allows local dev origins, tunneled trycloudflare domains, and vercel cloud deployments', () => {
    assert.strictEqual(isAllowedOrigin('http://localhost:3000'), true);
    assert.strictEqual(isAllowedOrigin('http://127.0.0.1:3000'), true);
    assert.strictEqual(isAllowedOrigin('http://localhost:5000'), true);
    assert.strictEqual(isAllowedOrigin('http://127.0.0.1:5000'), true);
    assert.strictEqual(isAllowedOrigin('https://tunnel-abc-123.trycloudflare.com'), true);
    assert.strictEqual(isAllowedOrigin('https://sub.sub.trycloudflare.com'), true);
    assert.strictEqual(isAllowedOrigin('https://cipher-vault.vercel.app'), true);
    assert.strictEqual(isAllowedOrigin('https://cipher-vault-git-preview-myteam.vercel.app'), true);
    assert.strictEqual(isAllowedOrigin(null), true);
    assert.strictEqual(isAllowedOrigin(undefined), true);
  });

  it('refuses untrusted or malicious origins', () => {
    assert.strictEqual(isAllowedOrigin('http://malicious-origin.evil.com'), false);
    assert.strictEqual(isAllowedOrigin('https://attacker.com'), false);
    assert.strictEqual(isAllowedOrigin('http://trycloudflare.com.attacker.com'), false);
    assert.strictEqual(isAllowedOrigin('https://vercel.app.attacker.com'), false);
  });
});
