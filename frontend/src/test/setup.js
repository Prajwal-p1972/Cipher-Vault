import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';

// Ensure standard Web Crypto subtle API is globally available in jsdom test environment
if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: true,
    configurable: true
  });
}
