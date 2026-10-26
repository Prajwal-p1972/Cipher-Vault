/**
 * In-memory storage adapter with strict copy-isolation.
 * Buffers are defensively copied on both write (put) and read (get)
 * to prevent callers or store mutations from leaking.
 */
export class MemoryStorage {
  constructor() {
    /** @type {Map<string, Buffer>} */
    this.store = new Map();
  }

  /**
   * Stores a buffer under the specified key, creating an isolated copy.
   *
   * @param {string} key - Storage key
   * @param {Buffer} buffer - Data buffer
   * @returns {Promise<void>}
   */
  async put(key, buffer) {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new TypeError('Storage key must be a non-empty string');
    }
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError('Storage payload must be a Buffer');
    }

    this.store.set(key, Buffer.from(buffer));
  }

  /**
   * Retrieves a copy of the buffer stored under the specified key.
   *
   * @param {string} key - Storage key
   * @returns {Promise<Buffer|null>} Buffer copy or null if not found
   */
  async get(key) {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new TypeError('Storage key must be a non-empty string');
    }

    const data = this.store.get(key);
    if (!data) {
      return null;
    }

    return Buffer.from(data);
  }

  /**
   * Deletes the item stored under the specified key.
   *
   * @param {string} key - Storage key
   * @returns {Promise<boolean>} True if found and deleted, false otherwise
   */
  async delete(key) {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new TypeError('Storage key must be a non-empty string');
    }

    return this.store.delete(key);
  }

  /**
   * Checks whether an item exists under the specified key.
   *
   * @param {string} key - Storage key
   * @returns {Promise<boolean>} True if exists, false otherwise
   */
  async exists(key) {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new TypeError('Storage key must be a non-empty string');
    }

    return this.store.has(key);
  }

  /**
   * Clears all stored items (primarily for test resets).
   *
   * @returns {Promise<void>}
   */
  async clear() {
    this.store.clear();
  }
}
