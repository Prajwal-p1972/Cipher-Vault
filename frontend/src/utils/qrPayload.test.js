import { describe, it, expect } from 'vitest';
import { encodePayload, parsePayload } from './qrPayload.js';

describe('qrPayload Utility Tests', () => {
  const validDocumentId = '6543210987abcdef01234567'; // 24 hex chars
  const validDocumentKey = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP1'; // 43 chars base64url

  it('performs lossless encode and decode round trip', () => {
    const encoded = encodePayload({
      documentId: validDocumentId,
      documentKey: validDocumentKey
    });

    expect(encoded.startsWith('CV1.')).toBe(true);
    expect(encoded.length).toBeLessThanOrEqual(200);

    const parsed = parsePayload(encoded);
    expect(parsed).toEqual({
      documentId: validDocumentId,
      documentKey: validDocumentKey
    });
  });

  it('rejects payload with wrong prefix', () => {
    const encoded = encodePayload({
      documentId: validDocumentId,
      documentKey: validDocumentKey
    });
    const invalidPrefix = encoded.replace(/^CV1\./, 'CV2.');

    expect(() => parsePayload(invalidPrefix)).toThrow('Invalid QR code');
    expect(() => parsePayload('randomstring')).toThrow('Invalid QR code');
  });

  it('rejects payload with bad base64url encoding', () => {
    expect(() => parsePayload('CV1.***not_base64***')).toThrow('Invalid QR code');
    expect(() => parsePayload('CV1.==bad==')).toThrow('Invalid QR code');
  });

  it('rejects payload with extra keys in JSON', () => {
    const jsonStr = JSON.stringify({
      v: 1,
      d: validDocumentId,
      k: validDocumentKey,
      extra: 'malicious'
    });
    const base64url = btoa(jsonStr)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const encoded = `CV1.${base64url}`;

    expect(() => parsePayload(encoded)).toThrow('Invalid QR code');
  });

  it('rejects payload with invalid version (v !== 1)', () => {
    const jsonStr = JSON.stringify({
      v: 2,
      d: validDocumentId,
      k: validDocumentKey
    });
    const base64url = btoa(jsonStr)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const encoded = `CV1.${base64url}`;

    expect(() => parsePayload(encoded)).toThrow('Invalid QR code');
  });

  it('rejects payload with short or long key', () => {
    // 42 chars (too short)
    const shortKey = validDocumentKey.slice(0, 42);
    const shortJson = JSON.stringify({ v: 1, d: validDocumentId, k: shortKey });
    const shortB64 = btoa(shortJson).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(() => parsePayload(`CV1.${shortB64}`)).toThrow('Invalid QR code');

    // 44 chars (too long)
    const longKey = validDocumentKey + 'a';
    const longJson = JSON.stringify({ v: 1, d: validDocumentId, k: longKey });
    const longB64 = btoa(longJson).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(() => parsePayload(`CV1.${longB64}`)).toThrow('Invalid QR code');
  });

  it('rejects payload with non-hex documentId', () => {
    const nonHexId = 'zzzzzzzzzzzzzzzzzzzzzzzz'; // 24 non-hex
    const badJson = JSON.stringify({ v: 1, d: nonHexId, k: validDocumentKey });
    const badB64 = btoa(badJson).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(() => parsePayload(`CV1.${badB64}`)).toThrow('Invalid QR code');

    const shortId = '12345'; // too short
    const shortIdJson = JSON.stringify({ v: 1, d: shortId, k: validDocumentKey });
    const shortIdB64 = btoa(shortIdJson).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(() => parsePayload(`CV1.${shortIdB64}`)).toThrow('Invalid QR code');
  });

  it('rejects oversize input (> 200 chars)', () => {
    const longPadding = 'a'.repeat(210);
    expect(() => parsePayload(`CV1.${longPadding}`)).toThrow('Invalid QR code');
  });

  it('throws on invalid encode inputs', () => {
    expect(() => encodePayload({ documentId: 'bad', documentKey: validDocumentKey })).toThrow();
    expect(() => encodePayload({ documentId: validDocumentId, documentKey: 'bad' })).toThrow();
  });
});
