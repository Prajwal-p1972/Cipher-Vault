import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const KEY_REGEX = /^docs\/[0-9a-f-]{36}\.bin$/;

/**
 * Persistent encrypted disk storage adapter.
 * Enforces key format strictly to prevent path traversal.
 * Writes are atomic (write to temp file in same dir, then rename).
 * Permissions are set to owner-only where supported by the OS (mode 0o600 / 0o700).
 */
export class DiskStorage {
  /**
   * @param {string} [rootDir='./data/blobs'] - Base directory for ciphertext blobs
   */
  constructor(rootDir = './data/blobs') {
    this.rootDir = path.resolve(rootDir);
    fs.mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
  }

  /**
   * Validates key against strict UUID-based pattern to thwart path traversal attempts.
   *
   * @param {string} key
   * @private
   */
  _validateKey(key) {
    if (typeof key !== 'string' || !KEY_REGEX.test(key)) {
      throw new Error(`Invalid storage key format: "${key}". Key must match /^docs\\/[0-9a-f-]{36}\\.bin$/`);
    }
  }

  /**
   * Resolves storage key to absolute file path and ensures it stays within rootDir.
   *
   * @param {string} key
   * @returns {string} Absolute file path
   * @private
   */
  _resolvePath(key) {
    this._validateKey(key);
    const resolvedPath = path.resolve(this.rootDir, key);
    if (!resolvedPath.startsWith(this.rootDir)) {
      throw new Error('Path traversal detected outside storage root directory');
    }
    return resolvedPath;
  }

  /**
   * Stores a buffer under the specified key using an atomic write.
   *
   * @param {string} key - Storage key matching /^docs\/[0-9a-f-]{36}\.bin$/
   * @param {Buffer} buffer - Ciphertext data buffer
   * @returns {Promise<void>}
   */
  async put(key, buffer) {
    const targetPath = this._resolvePath(key);

    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError('Storage payload must be a Buffer');
    }

    const dir = path.dirname(targetPath);
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });

    const tempPath = path.join(dir, `.${crypto.randomUUID()}.tmp`);

    try {
      await fs.promises.writeFile(tempPath, buffer, { mode: 0o600 });
      await fs.promises.rename(tempPath, targetPath);
    } catch (err) {
      try {
        await fs.promises.unlink(tempPath);
      } catch {
        // Ignore failure to delete temp file
      }
      throw err;
    }
  }

  /**
   * Retrieves the buffer stored under the specified key.
   *
   * @param {string} key - Storage key
   * @returns {Promise<Buffer|null>} Buffer or null if not found
   */
  async get(key) {
    const targetPath = this._resolvePath(key);

    try {
      return await fs.promises.readFile(targetPath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Deletes the item stored under the specified key.
   *
   * @param {string} key - Storage key
   * @returns {Promise<boolean>} True if found and deleted, false otherwise
   */
  async delete(key) {
    const targetPath = this._resolvePath(key);

    try {
      await fs.promises.unlink(targetPath);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') {
        return false;
      }
      throw err;
    }
  }

  /**
   * Checks whether an item exists under the specified key.
   *
   * @param {string} key - Storage key
   * @returns {Promise<boolean>} True if exists, false otherwise
   */
  async exists(key) {
    const targetPath = this._resolvePath(key);

    try {
      await fs.promises.access(targetPath, fs.constants.F_OK);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') {
        return false;
      }
      throw err;
    }
  }

  /**
   * Clears all stored items under the root directory (for test cleanup).
   *
   * @returns {Promise<void>}
   */
  async clear() {
    try {
      await fs.promises.rm(this.rootDir, { recursive: true, force: true });
      await fs.promises.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  }
}
