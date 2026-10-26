import crypto from 'node:crypto';
import { AuditLog } from '../models/AuditLog.js';
import { env } from '../config/env.js';
import { canonicalJson } from '../utils/canonicalJson.js';

export const GENESIS = '0'.repeat(64);
export const GENESIS_PREV_HASH = GENESIS;

/**
 * Computes an HMAC-SHA256 hash over the canonical JSON representation of an audit entry.
 *
 * @param {object} entry - Audit entry data
 * @param {string} [hmacKey=env.AUDIT_HMAC_KEY] - HMAC key
 * @returns {string} Hex-encoded HMAC-SHA256 signature
 */
export function computeHash(entry, hmacKey = env.AUDIT_HMAC_KEY) {
  const createdAtIso =
    entry.createdAt instanceof Date
      ? entry.createdAt.toISOString()
      : new Date(entry.createdAt).toISOString();

  let actorStr = null;
  if (entry.actor) {
    actorStr =
      typeof entry.actor === 'object' && entry.actor._id
        ? entry.actor._id.toString()
        : String(entry.actor);
  }

  const resourceKind =
    entry.resourceKind !== undefined
      ? entry.resourceKind
      : (entry.resource?.kind ?? null);

  const resourceId =
    entry.resourceId !== undefined
      ? (entry.resourceId ? String(entry.resourceId) : null)
      : (entry.resource?.id ? String(entry.resource.id) : null);

  const meta =
    entry.meta && typeof entry.meta === 'object' && Object.keys(entry.meta).length > 0
      ? entry.meta
      : {};

  const userAgentStr = entry.userAgent ? String(entry.userAgent).slice(0, 200) : null;

  const canonicalPayload = {
    action: entry.action,
    actor: actorStr,
    createdAt: createdAtIso,
    ip: entry.ip ?? null,
    meta,
    outcome: entry.outcome,
    prevHash: entry.prevHash,
    resourceId,
    resourceKind,
    seq: entry.seq,
    userAgent: userAgentStr
  };

  const canonicalString = canonicalJson(canonicalPayload);
  return crypto.createHmac('sha256', hmacKey).update(canonicalString).digest('hex');
}

export const computeAuditHash = computeHash;

// In-process promise queue to serialize local hash-chain appends.
// The unique index on `seq` acts as the cross-instance collision guard in multi-replica deployments.
let queue = Promise.resolve();

/**
 * Appends a tamper-evident audit record to the hash chain.
 *
 * @param {object} entryData - Record components
 * @returns {Promise<AuditLog>} Persisted audit document
 */
export function audit(entryData) {
  const task = queue.then(async () => {
    const lastEntry = await AuditLog.findOne().sort({ seq: -1 }).lean().exec();

    const seq = lastEntry ? lastEntry.seq + 1 : 1;
    const prevHash = lastEntry ? lastEntry.hash : GENESIS;
    const createdAt = entryData.createdAt ? new Date(entryData.createdAt) : new Date();
    const userAgent = entryData.userAgent ? String(entryData.userAgent).slice(0, 200) : null;

    const resourceKind = entryData.resourceKind || entryData.resource?.kind || 'System';
    const resourceId = entryData.resourceId || entryData.resource?.id || null;
    const meta =
      entryData.meta && typeof entryData.meta === 'object' ? entryData.meta : {};

    const hash = computeHash(
      {
        seq,
        actor: entryData.actor ?? null,
        action: entryData.action,
        resourceKind,
        resourceId,
        outcome: entryData.outcome,
        ip: entryData.ip ?? null,
        userAgent,
        meta,
        createdAt,
        prevHash
      },
      env.AUDIT_HMAC_KEY
    );

    const logDoc = new AuditLog({
      seq,
      actor: entryData.actor ?? null,
      action: entryData.action,
      resource: { kind: resourceKind, id: resourceId },
      outcome: entryData.outcome,
      ip: entryData.ip ?? null,
      userAgent,
      meta,
      createdAt,
      prevHash,
      hash
    });

    await logDoc.save();
    return logDoc;
  });

  // A failure in one append must not poison later appends in the queue
  queue = task.catch(() => null);

  return task;
}

/**
 * Streams the AuditLog collection and verifies cryptographic chain integrity.
 *
 * @returns {Promise<{ valid: boolean, brokenAtSeq?: number, checked: number }>}
 */
export async function verifyChain() {
  let checked = 0;
  let expectedPrevHash = GENESIS;
  let expectedSeq = 1;

  const cursor = AuditLog.find().sort({ seq: 1 }).lean().cursor();

  for await (const doc of cursor) {
    if (doc.seq !== expectedSeq) {
      return { valid: false, brokenAtSeq: doc.seq, checked };
    }

    if (doc.prevHash !== expectedPrevHash) {
      return { valid: false, brokenAtSeq: doc.seq, checked };
    }

    const calculatedHash = computeHash(
      {
        seq: doc.seq,
        actor: doc.actor,
        action: doc.action,
        resourceKind: doc.resource?.kind,
        resourceId: doc.resource?.id,
        outcome: doc.outcome,
        ip: doc.ip,
        userAgent: doc.userAgent,
        meta: doc.meta,
        createdAt: doc.createdAt,
        prevHash: doc.prevHash
      },
      env.AUDIT_HMAC_KEY
    );

    if (doc.hash !== calculatedHash) {
      return { valid: false, brokenAtSeq: doc.seq, checked };
    }

    expectedPrevHash = doc.hash;
    expectedSeq++;
    checked++;
  }

  return { valid: true, checked };
}
