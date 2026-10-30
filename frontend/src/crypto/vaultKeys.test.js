import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import {
  generateVaultKey,
  saveKey,
  getKey,
  listKeyIds,
  unwrapDocumentKey,
  bytesToBase64Url,
  base64UrlToBytes,
  keyIdOf,
  fingerprintOf
} from './vaultKeys.js';

/**
 * Node-side implementation of the ECDH P-256 + HKDF-SHA256 + AES-256-GCM contract
 * matching backend/src/services/crypto/keyWrap.js exactly.
 */
function nodeWrapDocumentKey({ docKeyBytes, recipientPublicBytes, recipientKeyId, docId, receiverId }) {
  const ephemeral = crypto.createECDH('prime256v1');
  ephemeral.generateKeys();
  const epk = ephemeral.getPublicKey().toString('base64url');

  const shared = ephemeral.computeSecret(Buffer.from(recipientPublicBytes));
  const saltBuf = crypto.randomBytes(32);
  const salt = saltBuf.toString('base64url');
  const ivBuf = crypto.randomBytes(12);
  const iv = ivBuf.toString('base64url');

  const infoStr = 'cipher-vault/keywrap/v1|' + String(docId) + '|' + String(receiverId) + '|' + String(recipientKeyId);
  const info = Buffer.from(infoStr, 'utf8');

  const kek = Buffer.from(crypto.hkdfSync('sha256', shared, saltBuf, info, 32));

  const cipher = crypto.createCipheriv('aes-256-gcm', kek, ivBuf);
  cipher.setAAD(info);
  const ctPart = cipher.update(Buffer.from(docKeyBytes));
  const finalPart = cipher.final();
  const tag = cipher.getAuthTag();
  const ct = Buffer.concat([ctPart, finalPart, tag]).toString('base64url');

  return {
    v: 1,
    alg: 'ECDH-P256-HKDF-SHA256-A256GCM',
    recipientKeyId,
    epk,
    salt,
    iv,
    ct
  };
}

describe('Vault Keys & Envelope Unwrapping Specification', () => {
  const testUserId = 'user_vault_test_123';

  it('generates, saves, and reloads an ECDH P-256 vault key in IndexedDB', async () => {
    const keyData = await generateVaultKey();

    expect(keyData.keyId).toMatch(/^[0-9a-f]{64}$/);
    expect(keyData.publicRaw).toHaveLength(65);
    expect(keyData.publicRaw[0]).toBe(0x04);
    expect(keyData.fingerprint).toMatch(/^([0-9a-f]{4} ){7}[0-9a-f]{4}$/);

    await saveKey(testUserId, {
      keyId: keyData.keyId,
      privateKey: keyData.privateKey,
      publicRaw: keyData.publicRaw
    });

    const loaded = await getKey(testUserId, keyData.keyId);
    expect(loaded).toBeTruthy();
    expect(loaded.keyId).toBe(keyData.keyId);
    expect(loaded.privateKey).toBeInstanceOf(CryptoKey);
    expect(new Uint8Array(loaded.publicRaw)).toEqual(keyData.publicRaw);
  });

  it('guarantees that generated private keys are strictly non-extractable', async () => {
    const keyData = await generateVaultKey();
    const cryptoObj = globalThis.crypto || window.crypto;

    // Both PKCS#8 and raw exports must reject for non-extractable keys
    await expect(cryptoObj.subtle.exportKey('pkcs8', keyData.privateKey)).rejects.toThrow();
    await expect(cryptoObj.subtle.exportKey('raw', keyData.privateKey)).rejects.toThrow();
  });

  it('successfully unwraps a document key wrapped by the server-side Node contract', async () => {
    const keyData = await generateVaultKey();
    await saveKey(testUserId, {
      keyId: keyData.keyId,
      privateKey: keyData.privateKey,
      publicRaw: keyData.publicRaw
    });

    const originalDocKey = crypto.randomBytes(32);
    const docId = 'doc_test_abc456';
    const receiverId = testUserId;

    const envelope = nodeWrapDocumentKey({
      docKeyBytes: originalDocKey,
      recipientPublicBytes: keyData.publicRaw,
      recipientKeyId: keyData.keyId,
      docId,
      receiverId
    });

    const unwrappedB64Url = await unwrapDocumentKey({
      envelope,
      docId,
      receiverId,
      userId: testUserId
    });

    const unwrappedBytes = base64UrlToBytes(unwrappedB64Url);
    expect(Buffer.from(unwrappedBytes)).toEqual(originalDocKey);
  });

  it('fails with generic error on any tampering with envelope components or AAD context', async () => {
    const keyData = await generateVaultKey();
    await saveKey(testUserId, {
      keyId: keyData.keyId,
      privateKey: keyData.privateKey,
      publicRaw: keyData.publicRaw
    });

    const originalDocKey = crypto.randomBytes(32);
    const docId = 'doc_tamper_1';
    const receiverId = testUserId;

    const envelope = nodeWrapDocumentKey({
      docKeyBytes: originalDocKey,
      recipientPublicBytes: keyData.publicRaw,
      recipientKeyId: keyData.keyId,
      docId,
      receiverId
    });

    const GENERIC_ERROR = 'Cannot unlock this document on this device';

    // 1. Wrong docId
    await expect(
      unwrapDocumentKey({
        envelope,
        docId: 'wrong_doc_id',
        receiverId,
        userId: testUserId
      })
    ).rejects.toThrow(GENERIC_ERROR);

    // 2. Wrong receiverId
    await expect(
      unwrapDocumentKey({
        envelope,
        docId,
        receiverId: 'wrong_receiver_id',
        userId: testUserId
      })
    ).rejects.toThrow(GENERIC_ERROR);

    // 3. Tampered ciphertext (flip bits in ct)
    const ctBytes = base64UrlToBytes(envelope.ct);
    ctBytes[5] ^= 0xff;
    const tamperedCtEnv = { ...envelope, ct: bytesToBase64Url(ctBytes) };

    await expect(
      unwrapDocumentKey({
        envelope: tamperedCtEnv,
        docId,
        receiverId,
        userId: testUserId
      })
    ).rejects.toThrow(GENERIC_ERROR);

    // 4. Tampered salt
    const saltBytes = base64UrlToBytes(envelope.salt);
    saltBytes[0] ^= 0xff;
    const tamperedSaltEnv = { ...envelope, salt: bytesToBase64Url(saltBytes) };

    await expect(
      unwrapDocumentKey({
        envelope: tamperedSaltEnv,
        docId,
        receiverId,
        userId: testUserId
      })
    ).rejects.toThrow(GENERIC_ERROR);

    // 5. Missing local key (unknown recipientKeyId)
    const unknownKeyEnv = {
      ...envelope,
      recipientKeyId: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    };

    await expect(
      unwrapDocumentKey({
        envelope: unknownKeyEnv,
        docId,
        receiverId,
        userId: testUserId
      })
    ).rejects.toThrow(GENERIC_ERROR);
  });

  it('preserves historical keys after rotation so older documents remain openable', async () => {
    const userRotate = 'user_rotate_999';

    // 1. Create Key 1
    const key1 = await generateVaultKey();
    await saveKey(userRotate, {
      keyId: key1.keyId,
      privateKey: key1.privateKey,
      publicRaw: key1.publicRaw
    });

    // 2. Create Doc 1 wrapped to Key 1
    const docKey1 = crypto.randomBytes(32);
    const env1 = nodeWrapDocumentKey({
      docKeyBytes: docKey1,
      recipientPublicBytes: key1.publicRaw,
      recipientKeyId: key1.keyId,
      docId: 'doc_1',
      receiverId: userRotate
    });

    // 3. Rotate and create Key 2
    const key2 = await generateVaultKey();
    await saveKey(userRotate, {
      keyId: key2.keyId,
      privateKey: key2.privateKey,
      publicRaw: key2.publicRaw
    });

    // Verify both keys exist locally
    const storedIds = await listKeyIds(userRotate);
    expect(storedIds).toContain(key1.keyId);
    expect(storedIds).toContain(key2.keyId);

    // 4. Verify Doc 1 still unwraps successfully using Key 1
    const unwrap1 = await unwrapDocumentKey({
      envelope: env1,
      docId: 'doc_1',
      receiverId: userRotate,
      userId: userRotate
    });
    expect(Buffer.from(base64UrlToBytes(unwrap1))).toEqual(docKey1);

    // 5. Create and unwrap Doc 2 with Key 2
    const docKey2 = crypto.randomBytes(32);
    const env2 = nodeWrapDocumentKey({
      docKeyBytes: docKey2,
      recipientPublicBytes: key2.publicRaw,
      recipientKeyId: key2.keyId,
      docId: 'doc_2',
      receiverId: userRotate
    });

    const unwrap2 = await unwrapDocumentKey({
      envelope: env2,
      docId: 'doc_2',
      receiverId: userRotate,
      userId: userRotate
    });
    expect(Buffer.from(base64UrlToBytes(unwrap2))).toEqual(docKey2);
  });
});
