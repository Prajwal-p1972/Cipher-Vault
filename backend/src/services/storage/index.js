import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { DiskStorage } from './diskStorage.js';
import { MemoryStorage } from './memoryStorage.js';
import { S3Storage } from './s3Storage.js';

let storageInstance = null;

/**
 * Returns the configured storage driver singleton (memory, disk, or s3).
 *
 * @returns {MemoryStorage|DiskStorage|S3Storage}
 */
export function getStorage() {
  if (!storageInstance) {
    if (env.STORAGE_DRIVER === 's3') {
      storageInstance = new S3Storage();
    } else if (env.STORAGE_DRIVER === 'disk') {
      storageInstance = new DiskStorage(env.STORAGE_DIR);
    } else {
      storageInstance = new MemoryStorage();
    }
  }
  return storageInstance;
}

/**
 * Generates an opaque, collision-resistant storage key.
 * Never exposes user-supplied file names to the storage layer.
 *
 * @returns {string} Key in the format "docs/<uuid>.bin"
 */
export function generateStorageKey() {
  return `docs/${crypto.randomUUID()}.bin`;
}

/**
 * Resets the active singleton instance (useful in test suites).
 */
export function resetStorage() {
  storageInstance = null;
}

export { MemoryStorage, DiskStorage, S3Storage };
