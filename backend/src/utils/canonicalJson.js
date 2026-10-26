/**
 * Deterministic JSON serialization with recursively sorted object keys.
 * Handles null, undefined, arrays, nested objects, Date, and ObjectId-like values.
 * Rejects functions, symbols, BigInt, and circular references.
 *
 * @param {any} value - Value to serialize
 * @param {Set<object>} [seen=new Set()] - Set of visited objects for circular reference detection
 * @returns {string} Deterministic canonical JSON string
 */
export function canonicalJson(value, seen = new Set()) {
  if (value === null || value === undefined) {
    return 'null';
  }

  const type = typeof value;

  if (type === 'function') {
    throw new TypeError('Functions cannot be serialized to canonical JSON');
  }

  if (type === 'symbol') {
    throw new TypeError('Symbols cannot be serialized to canonical JSON');
  }

  if (type === 'bigint') {
    throw new TypeError('BigInt cannot be serialized to canonical JSON');
  }

  if (type === 'string' || type === 'number' || type === 'boolean') {
    return JSON.stringify(value);
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  // Handle ObjectId-like values (Mongoose ObjectId / BSON ObjectId)
  if (typeof value.toHexString === 'function' || value._bsontype === 'ObjectID') {
    return JSON.stringify(value.toString());
  }

  if (seen.has(value)) {
    throw new TypeError('Circular structure detected in canonical JSON serialization');
  }

  seen.add(value);

  try {
    if (Array.isArray(value)) {
      const items = value.map((item) => canonicalJson(item, seen));
      return '[' + items.join(',') + ']';
    }

    const rawObj = typeof value.toJSON === 'function' ? value.toJSON() : value;

    if (rawObj === null || rawObj === undefined) {
      return 'null';
    }

    if (typeof rawObj !== 'object') {
      return canonicalJson(rawObj, seen);
    }

    const keys = Object.keys(rawObj).sort();
    const entries = [];

    for (const key of keys) {
      const val = rawObj[key];
      entries.push(JSON.stringify(key) + ':' + canonicalJson(val, seen));
    }

    return '{' + entries.join(',') + '}';
  } finally {
    seen.delete(value);
  }
}

export const canonicalize = canonicalJson;
