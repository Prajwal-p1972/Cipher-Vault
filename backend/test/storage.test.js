import './setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getStorage,
  generateStorageKey,
  resetStorage,
  MemoryStorage,
  DiskStorage
} from '../src/services/storage/index.js';

describe('Storage Adapter Tests', () => {
  it('generates storage keys matching docs/<uuid>.bin', () => {
    const key = generateStorageKey();
    assert.match(
      key,
      /^docs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.bin$/
    );

    const key2 = generateStorageKey();
    assert.notStrictEqual(key, key2);
  });

  it('provides singleton instance via getStorage matching configured memory driver', () => {
    resetStorage();
    const storage1 = getStorage();
    const storage2 = getStorage();

    assert.strictEqual(storage1, storage2);
    assert.ok(storage1 instanceof MemoryStorage);
  });

  it('supports put, get, exists, and delete operations on memory driver', async () => {
    const storage = new MemoryStorage();
    const key = generateStorageKey();
    const payload = Buffer.from('confidential vault content');

    // Initially does not exist
    assert.strictEqual(await storage.exists(key), false);
    assert.strictEqual(await storage.get(key), null);

    // Put data
    await storage.put(key, payload);
    assert.strictEqual(await storage.exists(key), true);

    // Get data
    const retrieved = await storage.get(key);
    assert.ok(Buffer.isBuffer(retrieved));
    assert.deepStrictEqual(retrieved, payload);

    // Delete data
    const deleted = await storage.delete(key);
    assert.strictEqual(deleted, true);
    assert.strictEqual(await storage.exists(key), false);
    assert.strictEqual(await storage.get(key), null);

    // Delete again returns false
    const deletedAgain = await storage.delete(key);
    assert.strictEqual(deletedAgain, false);
  });

  it('guarantees strict copy-isolation on both put and get', async () => {
    const storage = new MemoryStorage();
    const key = generateStorageKey();

    // 1. Isolation on put: mutating input buffer does NOT alter stored data
    const inputBuffer = Buffer.from('immutable payload');
    await storage.put(key, inputBuffer);

    inputBuffer[0] = 0x58; // mutate 'i' to 'X'
    const fetched1 = await storage.get(key);
    assert.strictEqual(fetched1.toString('utf8'), 'immutable payload');

    // 2. Isolation on get: mutating retrieved buffer does NOT alter stored data
    fetched1[0] = 0x59; // mutate 'i' to 'Y'
    const fetched2 = await storage.get(key);
    assert.strictEqual(fetched2.toString('utf8'), 'immutable payload');
  });

  it('throws on invalid keys or non-Buffer payloads', async () => {
    const storage = new MemoryStorage();

    await assert.rejects(
      async () => storage.put('', Buffer.from('data')),
      /Storage key must be a non-empty string/i
    );

    await assert.rejects(
      async () => storage.put('valid-key', 'string-instead-of-buffer'),
      /Storage payload must be a Buffer/i
    );

    await assert.rejects(
      async () => storage.get(''),
      /Storage key must be a non-empty string/i
    );

    await assert.rejects(
      async () => storage.exists(123),
      /Storage key must be a non-empty string/i
    );

    await assert.rejects(
      async () => storage.delete(null),
      /Storage key must be a non-empty string/i
    );
  });

  describe('DiskStorage Driver Tests', () => {
    const testDir = path.join(os.tmpdir(), `cipher-vault-test-disk-${Date.now()}`);

    it('supports round trip: put, get, exists, delete', async () => {
      const storage = new DiskStorage(testDir);
      const key = generateStorageKey();
      const payload = Buffer.from('encrypted-vault-blob-bytes-12345');

      assert.strictEqual(await storage.exists(key), false);
      assert.strictEqual(await storage.get(key), null);

      await storage.put(key, payload);
      assert.strictEqual(await storage.exists(key), true);

      const retrieved = await storage.get(key);
      assert.ok(Buffer.isBuffer(retrieved));
      assert.deepStrictEqual(retrieved, payload);

      const deleted = await storage.delete(key);
      assert.strictEqual(deleted, true);
      assert.strictEqual(await storage.exists(key), false);
      assert.strictEqual(await storage.get(key), null);
    });

    it('rejects path traversal attempts and invalid key formats', async () => {
      const storage = new DiskStorage(testDir);
      const payload = Buffer.from('traversal-test');

      const traversalAttempts = [
        '../x',
        '../../secret.txt',
        '/etc/passwd',
        'C:\\Windows\\system32',
        'docs\\backslashes.bin',
        'docs/not-a-uuid.bin',
        'docs/../evil.bin',
        'docs/12345.bin'
      ];

      for (const badKey of traversalAttempts) {
        await assert.rejects(
          async () => storage.put(badKey, payload),
          /Invalid storage key format/i,
          `Expected key "${badKey}" to be rejected on put`
        );

        await assert.rejects(
          async () => storage.get(badKey),
          /Invalid storage key format/i,
          `Expected key "${badKey}" to be rejected on get`
        );

        await assert.rejects(
          async () => storage.exists(badKey),
          /Invalid storage key format/i,
          `Expected key "${badKey}" to be rejected on exists`
        );

        await assert.rejects(
          async () => storage.delete(badKey),
          /Invalid storage key format/i,
          `Expected key "${badKey}" to be rejected on delete`
        );
      }
    });

    it('survives re-instantiation (persistence across instances)', async () => {
      const storage1 = new DiskStorage(testDir);
      const key = generateStorageKey();
      const payload = Buffer.from('persisted-ciphertext-data');

      await storage1.put(key, payload);

      // Re-instantiate pointing to the same directory
      const storage2 = new DiskStorage(testDir);
      assert.strictEqual(await storage2.exists(key), true);

      const fetched = await storage2.get(key);
      assert.deepStrictEqual(fetched, payload);

      // Clean up the key
      await storage2.delete(key);
    });

    it('cleans up temporary test directory', async () => {
      const storage = new DiskStorage(testDir);
      await storage.clear();
      try {
        await fs.promises.rm(testDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });
  });
});
